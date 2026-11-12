"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";

const MIN_MS = 3_000;
const GPS_SETTLE_MS = 500;
const FADE_MS = 480;
const POLL_MS = 100;

let launchConsumed = false;
let launchStartedAt = 0;

function launchClock(): number {
  if (!launchStartedAt) launchStartedAt = Date.now();
  return launchStartedAt;
}

type Props = {
  pinsReady: boolean;
  pinCount: number;
  etasReady: boolean;
  dbError: string | null;
  hydrated: boolean;
  pos: LatLng | null;
  gpsDenied: boolean;
};

export function LaunchOverlay(props: Props) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const gpsAt = useRef<number | null>(null);
  const [hiding, setHiding] = useState(false);
  const [gone, setGone] = useState(launchConsumed);

  useEffect(() => {
    if (gone || launchConsumed) return;
    const started = launchClock();
    const id = window.setInterval(() => {
      const { dbError, hydrated, pinsReady, pinCount, etasReady, pos, gpsDenied } = propsRef.current;
      if (pos && gpsAt.current == null) gpsAt.current = Date.now();
      const now = Date.now();
      const elapsed = now - started;
      const gpsSettled = gpsAt.current != null && now - gpsAt.current >= GPS_SETTLE_MS;
      const waitedMin = elapsed >= MIN_MS;
      const boardReady = Boolean(dbError && hydrated) || (pinsReady && (pinCount === 0 || etasReady));
      if (boardReady && (waitedMin || gpsSettled) && (gpsSettled || gpsDenied || waitedMin)) {
        launchConsumed = true;
        window.clearInterval(id);
        setHiding(true);
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [gone]);

  useEffect(() => {
    if (!hiding) return;
    const id = window.setTimeout(() => setGone(true), FADE_MS);
    return () => window.clearTimeout(id);
  }, [hiding]);

  if (gone) return null;
  return <LaunchSplash hiding={hiding} />;
}

const LaunchSplash = memo(function LaunchSplash({ hiding }: { hiding: boolean }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const inner = innerRef.current;
    if (!overlay || !inner) return;
    const fit = () => {
      const css = getComputedStyle(overlay);
      const avail =
        overlay.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0);
      const need = inner.scrollWidth;
      inner.style.setProperty("--launch-fit", String(need > 0 ? Math.min(1, avail / need) : 1));
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, []);

  return (
    <div
      ref={overlayRef}
      className={`launch-overlay${hiding ? " is-out" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!hiding}
    >
      <div ref={innerRef} className="launch-inner">
        <div className="launch-brand">
          <div className="launch-copy">
            <p className="launch-title">Instant Aboard</p>
            <p className="launch-byline">Created by Pepper Candy</p>
          </div>
          <div className="launch-mark">
            <img src="/icons/app-mark.svg" alt="" width={88} height={88} />
          </div>
        </div>
        <p className="launch-status">
          <span className="launch-spin" aria-hidden />
          <span className="launch-en">Getting live updates...</span>
          <span className="launch-zh">正在整合資料...</span>
        </p>
      </div>
    </div>
  );
});
