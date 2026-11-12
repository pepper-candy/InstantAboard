"use client";

import { useCallback, useEffect, useState } from "react";
import { haversine, type LatLng } from "@/lib/geo";
import { clampToServiceBounds } from "@/lib/mapBounds";

const WATCH_OPTS: PositionOptions = { enableHighAccuracy: false, maximumAge: 30_000, timeout: 8000 };
const RECOVER_OPTS: PositionOptions = { enableHighAccuracy: false, maximumAge: 0, timeout: 8000 };
const POLL_MS = 20_000;
const RECOVER_MS = 1_000;
const REQUEST_OPTS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 };

/** GPS → origin; silent clamp if outside service but inside pack. */
function coords(p: GeolocationPosition): LatLng {
  return clampToServiceBounds(p.coords.latitude, p.coords.longitude);
}

/** Permission denied or location services blocked — not timeout / poor accuracy. */
function isGeoBlocked(err: GeolocationPositionError): boolean {
  return err.code === 1;
}

export function useGeo(active: boolean) {
  const [pos, setPos] = useState<LatLng | null>(null);
  const [denied, setDenied] = useState<boolean>(
    () => typeof navigator !== "undefined" && !navigator.geolocation,
  );

  const applyQuiet = useCallback((p: GeolocationPosition) => {
    const next = coords(p);
    setPos((prev) => {
      if (prev && haversine(prev, next) < 25) return prev;
      return next;
    });
    setDenied(false);
  }, []);

  const onError = useCallback((err: GeolocationPositionError) => {
    if (isGeoBlocked(err)) setDenied(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setDenied(true);
      return;
    }
    const watch = navigator.geolocation.watchPosition(applyQuiet, onError, WATCH_OPTS);

    let perm: PermissionStatus | undefined;
    let cancelled = false;
    const onPerm = () => {
      if (perm?.state === "denied") setDenied(true);
    };
    void navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (cancelled) return;
        perm = status;
        status.addEventListener("change", onPerm);
        onPerm();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watch);
      perm?.removeEventListener("change", onPerm);
    };
  }, [active, applyQuiet, onError]);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let inflight = false;
    const tick = () => {
      if (inflight) return;
      inflight = true;
      navigator.geolocation.getCurrentPosition(
        (p) => {
          inflight = false;
          applyQuiet(p);
        },
        (err) => {
          inflight = false;
          onError(err);
        },
        denied ? RECOVER_OPTS : WATCH_OPTS,
      );
    };

    if (denied) tick();
    const poll = window.setInterval(tick, denied ? RECOVER_MS : POLL_MS);
    const onVisible = () => {
      if (denied && document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, applyQuiet, denied, onError]);

  const requestPos = useCallback((opts: PositionOptions = REQUEST_OPTS): Promise<LatLng | null> => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setDenied(true);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const next = coords(p);
          setPos(next);
          setDenied(false);
          resolve(next);
        },
        (err) => {
          if (isGeoBlocked(err)) setDenied(true);
          resolve(null);
        },
        opts,
      );
    });
  }, []);

  return { pos, denied, requestPos };
}
