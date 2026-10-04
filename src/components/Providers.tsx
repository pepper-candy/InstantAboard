"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useDb } from "@/hooks/useDb";
import { useEtas } from "@/hooks/useEtas";
import { useGeo } from "@/hooks/useGeo";
import { usePins } from "@/hooks/usePins";
import { useSettings } from "@/hooks/useSettings";
import { HANG_HAU, type LatLng } from "@/lib/geo";
import { resolvePin } from "@/lib/nearest";
import type { Arrival, EtaDb, Pin, Settings } from "@/lib/types";

type AppCtx = {
  db: EtaDb | null;
  dbError: string | null;
  settings: Settings;
  toggleLang: () => void;
  toggleTheme: () => void;
  setFilter: ReturnType<typeof useSettings>["setFilter"];
  pins: Pin[];
  pinsReady: boolean;
  addPin: (pin: Pin) => void;
  removePin: (id: string) => void;
  restorePin: (pin: Pin, index: number) => void;
  movePin: (from: number, to: number) => void;
  updatePinStop: (id: string, stopId: string, stopSeq: number, auto?: boolean) => void;
  etas: Record<string, Arrival[]>;
  updatedAt: Record<string, number>;
  busy: Record<string, boolean>;
  refreshAll: (ids?: string[]) => Promise<void>;
  refreshPin: (id: string) => Promise<void>;
  pos: LatLng | null;
  origin: LatLng;
};

const Ctx = createContext<AppCtx | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const { settings, hydrated, toggleLang, toggleTheme, setFilter, markSeeded } = useSettings();
  const { db, error } = useDb();
  const { pos } = useGeo(true);
  const origin = pos ?? HANG_HAU;
  const { pins, ready, addPin, removePin, restorePin, movePin, updatePinStop } = usePins(
    db,
    settings.seeded,
    markSeeded,
    hydrated,
  );
  const resolved = useMemo(() => pins.map((p) => resolvePin(db, p, origin)), [pins, db, origin]);
  const { etas, updatedAt, busy, refreshAll, refreshPin } = useEtas(db, resolved, settings.lang);

  const value = useMemo<AppCtx>(
    () => ({
      db,
      dbError: error,
      settings,
      toggleLang,
      toggleTheme,
      setFilter,
      pins: resolved,
      pinsReady: ready,
      addPin,
      removePin,
      restorePin,
      movePin,
      updatePinStop,
      etas,
      updatedAt,
      busy,
      refreshAll,
      refreshPin,
      pos,
      origin,
    }),
    [
      db,
      error,
      settings,
      toggleLang,
      toggleTheme,
      setFilter,
      resolved,
      ready,
      addPin,
      removePin,
      restorePin,
      movePin,
      updatePinStop,
      etas,
      updatedAt,
      busy,
      refreshAll,
      refreshPin,
      pos,
      origin,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp");
  return ctx;
}
