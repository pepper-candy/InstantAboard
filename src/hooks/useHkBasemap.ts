"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  downloadAndSwapPack,
  getLocalMeta,
  hasPack,
  subscribeHkBasemapChange,
  type DownloadProgress,
} from "@/lib/hkBasemapCache";
import { fetchHkBasemapManifest } from "@/lib/hkBasemapManifest";
import {
  canForcedDownloadNow,
  canSilentDownloadNow,
  isNewUser,
  packOutOfDate,
  shouldNudgeForManifest,
  shouldSilentUpdateForManifest,
} from "@/lib/hkBasemapPolicy";
import { useOffline } from "./useOffline";

export type HkBasemapState = {
  ready: boolean;
  hasLocalPack: boolean;
  nudge: boolean;
  downloading: boolean;
  progress: DownloadProgress | null;
  error: string | null;
  requestUpdate: () => void;
};

const HkBasemapCtx = createContext<HkBasemapState | null>(null);

/**
 * Bright-first: map mounts online immediately.
 * New user → download on any network.
 * Returning + newer Release (sha/version mismatch) → silent on Wi‑Fi, else nudge immediately.
 * Same sha/version → skip (no 7/30d wait needed; age gates remain in policy helpers only).
 */
function useHkBasemapState(): HkBasemapState {
  const offline = useOffline();
  const [hasLocalPack, setHasLocalPack] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** True only for nudge-button path (not silent / new-user downloads). */
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const busyRef = useRef(false);

  const refreshLocal = useCallback(() => {
    setHasLocalPack(getLocalMeta() != null);
  }, []);

  const runDownload = useCallback(
    async (opts?: { fromNudge?: boolean }) => {
      if (busyRef.current) return;
      if (!canForcedDownloadNow()) {
        setError("offline");
        return;
      }
      busyRef.current = true;
      const fromNudge = opts?.fromNudge === true;
      if (fromNudge) setNudgeBusy(true);
      setDownloading(true);
      setError(null);
      setProgress({ received: 0, total: null, ratio: null });
      try {
        const manifest = await fetchHkBasemapManifest();
        const local = getLocalMeta();
        if (local && !packOutOfDate(local, manifest)) {
          setNudge(false);
          return;
        }
        await downloadAndSwapPack(manifest, {
          onProgress: setProgress,
        });
        setNudge(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "download failed";
        setError(msg);
      } finally {
        busyRef.current = false;
        setDownloading(false);
        setNudgeBusy(false);
        setProgress(null);
        refreshLocal();
      }
    },
    [refreshLocal],
  );

  const evaluate = useCallback(async () => {
    if (offline || busyRef.current) {
      refreshLocal();
      return;
    }
    const local = getLocalMeta();
    refreshLocal();

    if (isNewUser(local)) {
      void runDownload({ fromNudge: false });
      return;
    }

    try {
      const manifest = await fetchHkBasemapManifest();

      // Same Release identity → keep local, no download / no wipe.
      if (!packOutOfDate(local, manifest)) {
        setNudge(false);
        return;
      }

      // Newer Release (or age gate via helpers): Wi‑Fi silent, else nudge now (not 30d wait).
      if (shouldNudgeForManifest(local, manifest)) {
        setNudge(true);
      }
      if (shouldSilentUpdateForManifest(local, manifest) && canSilentDownloadNow()) {
        void runDownload({ fromNudge: false });
      }
    } catch {
      // Manifest fetch failed (flaky net) — keep local pack, do not wipe.
      refreshLocal();
    }
  }, [offline, refreshLocal, runDownload]);

  useEffect(() => {
    setHasLocalPack(hasPack());
    setReady(true);
    const unsub = subscribeHkBasemapChange(refreshLocal);
    void evaluate();

    const onVis = () => {
      if (document.visibilityState === "visible") void evaluate();
    };
    const onFocusOrOnline = () => {
      void evaluate();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocusOrOnline);
    window.addEventListener("online", onFocusOrOnline);

    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocusOrOnline);
      window.removeEventListener("online", onFocusOrOnline);
    };
  }, [evaluate, refreshLocal]);

  useEffect(() => {
    if (offline) setNudge(false);
    else void evaluate();
  }, [offline, evaluate]);

  const requestUpdate = useCallback(() => {
    void runDownload({ fromNudge: true });
  }, [runDownload]);

  return {
    ready,
    hasLocalPack,
    // Toast only for nudge (and its in-progress button download) — never for silent/new-user.
    nudge: !offline && (nudgeBusy || (nudge && !downloading)),
    downloading: nudgeBusy && downloading,
    progress: nudgeBusy ? progress : null,
    error,
    requestUpdate,
  };
}

export function HkBasemapProvider({ children }: { children: ReactNode }) {
  const state = useHkBasemapState();
  return createElement(HkBasemapCtx.Provider, { value: state }, children);
}

export function useHkBasemap(): HkBasemapState {
  const ctx = useContext(HkBasemapCtx);
  if (!ctx) throw new Error("useHkBasemap requires HkBasemapProvider");
  return ctx;
}
