"use client";

import { useEffect, useState } from "react";
import { useOffline } from "@/hooks/useOffline";
import { IconOffline } from "./Icons";

const FADE_MS = 280;

export function OfflineToast() {
  const offline = useOffline();
  const [shown, setShown] = useState(false);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    if (offline) {
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
  }, [offline, shown]);

  if (!shown) return null;
  return (
    <div className={`offline-toast${hiding ? " is-out" : ""}`} role="status" aria-live="polite">
      <IconOffline className="offline-toast-icon" />
      Disconnected
    </div>
  );
}
