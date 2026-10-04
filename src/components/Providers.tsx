"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useDb } from "@/hooks/useDb";
import { useEtas } from "@/hooks/useEtas";
import { usePins } from "@/hooks/usePins";
import { useSettings } from "@/hooks/useSettings";
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
  updatePinStop: (id: string, stopId: string, stopSeq: number) => void;
  etas: Record<string, Arrival[]>;
  updatedAt: Record<string, number>;
  busy: Record<string, boolean>;
  refreshAll: (ids?: string[]) => Promise<void>;
  refreshPin: (id: string) => Promise<void>;
};

const Ctx = createContext<AppCtx | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const { settings, hydrated, toggleLang, toggleTheme, setFilter, markSeeded } = useSettings();
  const { db, error } = useDb();
  const { pins, ready, addPin, removePin, restorePin, movePin, updatePinStop } = usePins(
    db,
    settings.seeded,
    markSeeded,
    hydrated,
  );
  const { etas, updatedAt, busy, refreshAll, refreshPin } = useEtas(db, pins, settings.lang);

  const value = useMemo<AppCtx>(
    () => ({
      db,
      dbError: error,
      settings,
      toggleLang,
      toggleTheme,
      setFilter,
      pins,
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
    }),
    [
      db,
      error,
      settings,
      toggleLang,
      toggleTheme,
      setFilter,
      pins,
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
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp");
  return ctx;
}
