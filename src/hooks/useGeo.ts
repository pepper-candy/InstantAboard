"use client";

import { useCallback, useEffect, useState } from "react";
import { haversine, type LatLng } from "@/lib/geo";

const WATCH_OPTS: PositionOptions = { enableHighAccuracy: false, maximumAge: 30_000, timeout: 8000 };
const POLL_MS = 20_000;
const REQUEST_OPTS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 };

function coords(p: GeolocationPosition): LatLng {
  return { lat: p.coords.latitude, lng: p.coords.longitude };
}

export function useGeo(active: boolean) {
  const [pos, setPos] = useState<LatLng | null>(null);
  const [denied, setDenied] = useState(false);

  const applyQuiet = useCallback((p: GeolocationPosition) => {
    const next = coords(p);
    setPos((prev) => {
      if (prev && haversine(prev, next) < 25) return prev;
      return next;
    });
    setDenied(false);
  }, []);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(applyQuiet, () => setDenied(true), WATCH_OPTS);
    const poll = window.setInterval(() => {
      navigator.geolocation.getCurrentPosition(applyQuiet, () => undefined, WATCH_OPTS);
    }, POLL_MS);
    return () => {
      navigator.geolocation.clearWatch(watch);
      window.clearInterval(poll);
    };
  }, [active, applyQuiet]);

  const requestPos = useCallback((): Promise<LatLng | null> => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const next = coords(p);
          setPos(next);
          setDenied(false);
          resolve(next);
        },
        () => {
          setDenied(true);
          resolve(null);
        },
        REQUEST_OPTS,
      );
    });
  }, []);

  return { pos, denied, requestPos };
}
