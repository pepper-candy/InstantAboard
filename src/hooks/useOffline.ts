"use client";

import { useEffect, useState } from "react";
import { RECONNECT_EVENT, subscribeOffline, watchBrowserOnline } from "@/lib/online";

export function useOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const stopWatch = watchBrowserOnline();
    const unsub = subscribeOffline(setOffline);
    return () => {
      stopWatch();
      unsub();
    };
  }, []);
  return offline;
}

export function useReconnectTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener(RECONNECT_EVENT, on);
    return () => window.removeEventListener(RECONNECT_EVENT, on);
  }, []);
  return tick;
}
