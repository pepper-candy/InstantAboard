"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { IconGpsOff } from "./Icons";

const FADE_MS = 280;

export function GpsToast({ lang, denied }: { lang: Lang; denied: boolean }) {
  const [shown, setShown] = useState(false);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    if (denied) {
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
  }, [denied, shown]);

  if (!shown) return null;
  return (
    <div className={`offline-toast${hiding ? " is-out" : ""}`} role="status" aria-live="polite">
      <IconGpsOff className="offline-toast-icon" />
      {t(lang, "GPS blocked", "定位已關閉")}
    </div>
  );
}
