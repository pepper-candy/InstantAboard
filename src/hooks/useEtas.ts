"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchArrivals } from "@/lib/eta";
import type { Arrival, EtaDb, Lang, Pin } from "@/lib/types";

const INTERVAL = 5_000;

function sameArrivals(prev: Arrival[] | undefined, next: Arrival[]): boolean {
  if (!prev || prev.length !== next.length) return false;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a.minutes !== b.minutes) return false;
    if (a.at !== b.at) return false;
    if ((a.plat ?? "") !== (b.plat ?? "")) return false;
    if ((a.dest?.en ?? "") !== (b.dest?.en ?? "")) return false;
    if ((a.dest?.zh ?? "") !== (b.dest?.zh ?? "")) return false;
    if (a.gps !== b.gps) return false;
    if (a.lat !== b.lat) return false;
    if (a.lng !== b.lng) return false;
  }
  return true;
}

export function useEtas(db: EtaDb | null, pins: Pin[], lang: Lang) {
  const [etas, setEtas] = useState<Record<string, Arrival[]>>({});
  const [updatedAt, setUpdatedAt] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const dbRef = useRef(db);
  dbRef.current = db;
  const langRef = useRef(lang);
  langRef.current = lang;
  const inflight = useRef(new Map<string, Promise<Arrival[] | null>>());

  const loadPin = useCallback((id: string) => {
    const pending = inflight.current.get(id);
    if (pending) return pending;
    const job = (async (): Promise<Arrival[] | null> => {
      const currentDb = dbRef.current;
      const pin = pinsRef.current.find((item) => item.id === id);
      if (!currentDb || !pin) return null;
      try {
        return await fetchArrivals(currentDb, pin, langRef.current);
      } catch {
        return null;
      }
    })();
    inflight.current.set(id, job);
    void job.finally(() => {
      if (inflight.current.get(id) === job) inflight.current.delete(id);
    });
    return job;
  }, []);

  const refreshPins = useCallback(
    async (list: Pin[], silent: boolean) => {
      if (!dbRef.current || list.length === 0) return;
      if (!silent) {
        setBusy((prev) => {
          const next = { ...prev };
          for (const pin of list) next[pin.id] = true;
          return next;
        });
      }
      try {
        const entries = await Promise.all(
          list.map(async (pin) => [pin.id, await loadPin(pin.id)] as const),
        );
        const at = Date.now();
        setEtas((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [id, rows] of entries) {
            if (rows == null) continue;
            if (sameArrivals(prev[id], rows)) continue;
            next[id] = rows;
            changed = true;
          }
          return changed ? next : prev;
        });
        setUpdatedAt((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [id, rows] of entries) {
            if (rows == null) continue;
            next[id] = at;
            changed = true;
          }
          return changed ? next : prev;
        });
      } finally {
        if (!silent) {
          setBusy((prev) => {
            const next = { ...prev };
            for (const pin of list) next[pin.id] = false;
            return next;
          });
        }
      }
    },
    [loadPin],
  );

  const refreshAll = useCallback(
    async (ids?: string[]) => {
      const list = ids ? pinsRef.current.filter((pin) => ids.includes(pin.id)) : pinsRef.current;
      await refreshPins(list, false);
    },
    [refreshPins],
  );

  const refreshPin = useCallback(
    async (id: string) => {
      const pin = pinsRef.current.find((item) => item.id === id);
      if (!pin) return;
      await refreshPins([pin], false);
    },
    [refreshPins],
  );

  const pinKey = pins.map((p) => `${p.id}:${p.stopId}:${p.stopSeq}`).join("|");

  useEffect(() => {
    if (!db) return;
    let timer: number | null = null;
    const stop = () => {
      if (timer != null) window.clearInterval(timer);
      timer = null;
    };
    const poll = () => {
      if (document.hidden) return;
      void refreshPins(pinsRef.current, true);
    };
    const start = () => {
      stop();
      timer = window.setInterval(poll, INTERVAL);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      poll();
      start();
    };
    if (!document.hidden) {
      poll();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [db, pinKey, lang, refreshPins]);

  return { etas, updatedAt, busy, refreshAll, refreshPin };
}
