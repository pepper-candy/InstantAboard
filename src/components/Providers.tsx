"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDb } from "@/hooks/useDb";
import { useEtas } from "@/hooks/useEtas";
import { useGeo } from "@/hooks/useGeo";
import { usePins } from "@/hooks/usePins";
import { useSettings } from "@/hooks/useSettings";
import { DEV_OFF, loadDev, saveDev, type DevState } from "@/lib/devMode";
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
  devOn: boolean;
  devArmed: boolean;
  devPin: boolean;
  devShowAll: boolean;
  armDev: () => void;
  confirmDev: () => void;
  cancelDev: () => void;
  exitDev: () => void;
  setDevPin: (on: boolean, spot?: LatLng | null) => void;
  setDevShowAll: (on: boolean) => void;
  setDevSpot: (spot: LatLng) => void;
  adding: boolean;
  setAdding: (on: boolean) => void;
  goHome: () => void;
  homeSeq: number;
};

const Ctx = createContext<AppCtx | null>(null);

function useDevSession() {
  const [dev, setDev] = useState<DevState>(DEV_OFF);
  const [ready, setReady] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    setDev(loadDev());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveDev(dev);
  }, [dev, ready]);

  const armDev = useCallback(() => setArmed(true), []);
  const confirmDev = useCallback(() => {
    setArmed(false);
    setDev((s) => ({ ...s, on: true }));
  }, []);
  const cancelDev = useCallback(() => setArmed(false), []);
  const exitDev = useCallback(() => {
    setArmed(false);
    setDev(DEV_OFF);
  }, []);
  const setDevPin = useCallback((on: boolean, spot?: LatLng | null) => {
    setDev((s) => ({ ...s, pin: on, spot: spot === undefined ? s.spot : spot }));
  }, []);
  const setDevShowAll = useCallback((on: boolean) => {
    setDev((s) => ({ ...s, showAll: on }));
  }, []);
  const setDevSpot = useCallback((spot: LatLng) => {
    setDev((s) => {
      if (s.spot && Math.abs(s.spot.lat - spot.lat) < 1e-6 && Math.abs(s.spot.lng - spot.lng) < 1e-6) return s;
      return { ...s, spot };
    });
  }, []);

  return { dev, armed, armDev, confirmDev, cancelDev, exitDev, setDevPin, setDevShowAll, setDevSpot };
}

export function Providers({ children }: { children: ReactNode }) {
  const { settings, hydrated, toggleLang, toggleTheme, setFilter, markSeeded } = useSettings();
  const { db, error } = useDb();
  const { pos } = useGeo(true);
  const { dev, armed, armDev, confirmDev, cancelDev, exitDev, setDevPin, setDevShowAll, setDevSpot } = useDevSession();
  const [adding, setAdding] = useState(false);
  const [homeSeq, setHomeSeq] = useState(0);
  const goHome = useCallback(() => {
    setAdding(false);
    setHomeSeq((n) => n + 1);
  }, []);
  const origin = dev.on && dev.pin && dev.spot ? dev.spot : (pos ?? HANG_HAU);
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
      devOn: dev.on,
      devArmed: armed,
      devPin: dev.on && dev.pin,
      devShowAll: dev.on && dev.showAll,
      armDev,
      confirmDev,
      cancelDev,
      exitDev,
      setDevPin,
      setDevShowAll,
      setDevSpot,
      adding,
      setAdding,
      goHome,
      homeSeq,
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
      dev,
      armed,
      armDev,
      confirmDev,
      cancelDev,
      exitDev,
      setDevPin,
      setDevShowAll,
      setDevSpot,
      adding,
      goHome,
      homeSeq,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp");
  return ctx;
}
