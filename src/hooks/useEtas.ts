"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchArrivals } from "@/lib/eta";
import type { Arrival, EtaDb, Lang, Pin } from "@/lib/types";

const INTERVAL = 30_000;

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

  const refreshPin = useCallback(async (id: string) => {
    const currentDb = dbRef.current;
    const pin = pinsRef.current.find((p) => p.id === id);
    if (!currentDb || !pin) return;
    setBusy((prev) => ({ ...prev, [id]: true }));
    try {
      const rows = await fetchArrivals(currentDb, pin, langRef.current);
      setEtas((prev) => ({ ...prev, [id]: rows }));
      setUpdatedAt((prev) => ({ ...prev, [id]: Date.now() }));
    } catch {
      setEtas((prev) => ({ ...prev, [id]: prev[id] ?? [] }));
    } finally {
      setBusy((prev) => ({ ...prev, [id]: false }));
    }
  }, []);

  const refreshAll = useCallback(async (ids?: string[]) => {
    const currentDb = dbRef.current;
    const list = ids
      ? pinsRef.current.filter((p) => ids.includes(p.id))
      : pinsRef.current;
    if (!currentDb || list.length === 0) return;
    const marks = Object.fromEntries(list.map((p) => [p.id, true]));
    setBusy((prev) => ({ ...prev, ...marks }));
    const entries = await Promise.all(
      list.map(async (pin) => {
        try {
          const rows = await fetchArrivals(currentDb, pin, langRef.current);
          return [pin.id, rows] as const;
        } catch {
          return [pin.id, null] as const;
        }
      }),
    );
    const at = Date.now();
    setEtas((prev) => {
      const next = { ...prev };
      for (const [id, rows] of entries) {
        if (rows) next[id] = rows;
      }
      return next;
    });
    setUpdatedAt((prev) => {
      const next = { ...prev };
      for (const [id, rows] of entries) {
        if (rows) next[id] = at;
      }
      return next;
    });
    setBusy((prev) => {
      const next = { ...prev };
      for (const pin of list) next[pin.id] = false;
      return next;
    });
  }, []);

  const pinKey = pins.map((p) => `${p.id}:${p.stopId}:${p.stopSeq}`).join("|");

  useEffect(() => {
    if (!db) return;
    void refreshAll();
    const id = window.setInterval(() => {
      void refreshAll();
    }, INTERVAL);
    return () => window.clearInterval(id);
  }, [db, pinKey, lang, refreshAll]);

  return { etas, updatedAt, busy, refreshAll, refreshPin };
}
