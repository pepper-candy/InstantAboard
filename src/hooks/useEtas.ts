"use client";

import { useEffect, useState } from "react";
import { fetchArrivals } from "@/lib/eta";
import type { Arrival, EtaDb, Lang, Pin } from "@/lib/types";

const INTERVAL = 30_000;

export function useEtas(db: EtaDb | null, pins: Pin[], lang: Lang) {
  const [etas, setEtas] = useState<Record<string, Arrival[]>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), INTERVAL);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!db || pins.length === 0) return;
    let alive = true;
    const run = async () => {
      const entries = await Promise.all(
        pins.map(async (pin) => {
          try {
            const rows = await fetchArrivals(db, pin, lang);
            return [pin.id, rows] as const;
          } catch {
            return [pin.id, [] as Arrival[]] as const;
          }
        }),
      );
      if (!alive) return;
      setEtas((prev) => {
        const next = { ...prev };
        for (const [id, rows] of entries) next[id] = rows;
        return next;
      });
    };
    void run();
    return () => {
      alive = false;
    };
  }, [db, pins, lang, tick]);

  return etas;
}
