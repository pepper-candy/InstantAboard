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
  shouldNudge,
  shouldSilentUpdate,
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
 * Returning ≥7d + Wi‑Fi → silent swap.
 * Returning ≥30d → nudge toast (button downloads on any network).
 */
function useHkBasemapState(): HkBasemapState {
  const offline = useOffline();
  const [hasLocalPack, setHasLocalPack] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** True only for ≥30d button path (not silent / new-user downloads). */
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const busyRef = useRef(false);

  const refreshLocal = useCallback(() => {
    const meta = getLocalMeta();
    setHasLocalPack(meta != null);
    setNudge(!offline && shouldNudge(meta));
  }, [offline]);

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
        if (local && local.sha256.toLowerCase() === manifest.sha256.toLowerCase()) {
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

  const evaluate = useCallback(() => {
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

    if (shouldNudge(local)) {
      setNudge(true);
    }

    if (shouldSilentUpdate(local) && canSilentDownloadNow()) {
      void runDownload({ fromNudge: false });
    }
  }, [offline, refreshLocal, runDownload]);

  useEffect(() => {
    setHasLocalPack(hasPack());
    setReady(true);
    const unsub = subscribeHkBasemapChange(refreshLocal);
    evaluate();

    const onVis = () => {
      if (document.visibilityState === "visible") evaluate();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", evaluate);
    window.addEventListener("online", evaluate);

    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", evaluate);
      window.removeEventListener("online", evaluate);
    };
  }, [evaluate, refreshLocal]);

  useEffect(() => {
    if (offline) setNudge(false);
    else refreshLocal();
  }, [offline, refreshLocal]);

  const requestUpdate = useCallback(() => {
    void runDownload({ fromNudge: true });
  }, [runDownload]);

  return {
    ready,
    hasLocalPack,
    // Toast only for ≥30d nudge (and its in-progress button download) — never for silent/new-user.
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
