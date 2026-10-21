"use client";

import { useEffect, useState } from "react";
import { useHkBasemap } from "@/hooks/useHkBasemap";
import { useOffline } from "@/hooks/useOffline";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

const FADE_MS = 280;

/**
 * Stale-pack nudge (≥30 days). Mirrors OfflineToast visuals; offline toast wins when offline.
 */
export function UpdateMapToast({ lang }: { lang: Lang }) {
  const offline = useOffline();
  const { nudge, downloading, progress, requestUpdate } = useHkBasemap();
  const show = !offline && (nudge || downloading);
  const [shown, setShown] = useState(false);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    if (show) {
      setShown(true);
      setHiding(false);
      return;
    }
    if (!shown) return;
    setHiding(true);
    const id = window.setTimeout(() => {
      setShown(false);
      setHiding(false);
    }, FADE_MS);
    return () => window.clearTimeout(id);
  }, [show, shown]);

  if (!shown) return null;

  const pct =
    downloading && progress?.ratio != null
      ? Math.round(progress.ratio * 100)
      : null;

  return (
    <div
      className={`offline-toast update-map-toast${hiding ? " is-out" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="update-map-toast-copy">
        <span className="update-map-toast-title">
          {t(lang, "Update map", "更新地圖")}
        </span>
        <span className="update-map-toast-sub">
          {downloading && pct != null
            ? t(lang, `Downloading… ${pct}%`, `下載中… ${pct}%`)
            : downloading
              ? t(lang, "Downloading…", "下載中…")
              : t(lang, "Map data outdated", "地圖資料已過期")}
        </span>
      </div>
      <button
        type="button"
        className="update-map-toast-btn"
        disabled={downloading}
        onClick={() => requestUpdate()}
      >
        {downloading
          ? t(lang, "Updating…", "更新中…")
          : t(lang, "Update map", "更新地圖")}
      </button>
    </div>
  );
}
