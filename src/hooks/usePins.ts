"use client";

import { useCallback, useEffect, useState } from "react";
import { loadPins, savePins } from "@/lib/storage";
import { buildSeedPins } from "@/lib/seed";
import type { EtaDb, Pin } from "@/lib/types";

export function usePins(db: EtaDb | null, seeded: boolean, markSeeded: () => void, hydrated: boolean) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    const stored = loadPins();
    if (stored && stored.length) {
      setPins(dedupePins(stored));
      setReady(true);
      if (!seeded) markSeeded();
      return;
    }
    if (stored && stored.length === 0 && seeded) {
      setPins([]);
      setReady(true);
      return;
    }
    if (db && !seeded) {
      const seed = buildSeedPins(db);
      setPins(seed);
      savePins(seed);
      markSeeded();
      setReady(true);
    }
  }, [db, seeded, markSeeded, hydrated]);

  useEffect(() => {
    if (ready) savePins(pins);
  }, [pins, ready]);

  const addPin = useCallback((pin: Pin) => {
    setPins((prev) => {
      const next = prev.filter((p) => p.routeId !== pin.routeId);
      return [...next, { ...pin, auto: true }];
    });
  }, []);

  const removePin = useCallback((id: string) => {
    setPins((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const restorePin = useCallback((pin: Pin, index: number) => {
    setPins((prev) => {
      const copy = prev.filter((p) => p.id !== pin.id);
      copy.splice(Math.max(0, Math.min(index, copy.length)), 0, pin);
      return copy;
    });
  }, []);

  const movePin = useCallback((from: number, to: number) => {
    setPins((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
  }, []);

  const updatePinStop = useCallback((id: string, stopId: string, stopSeq: number, auto = false) => {
    setPins((prev) => prev.map((p) => (p.id === id ? { ...p, stopId, stopSeq, auto } : p)));
  }, []);

  const updatePin = useCallback((id: string, patch: Partial<Pin>) => {
    setPins((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)));
  }, []);

  return { pins, ready, addPin, removePin, restorePin, movePin, updatePinStop, updatePin };
}

function dedupePins(pins: Pin[]): Pin[] {
  const seen = new Set<string>();
  const out: Pin[] = [];
  for (const pin of pins) {
    let id = pin.id;
    if (seen.has(id)) id = `${pin.id}:${pin.routeId}:${pin.stopSeq}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id === pin.id ? pin : { ...pin, id });
  }
  return out;
}
