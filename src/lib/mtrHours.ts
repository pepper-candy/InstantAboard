import { mtrLineCode } from "./colors";
import type { Lang, Terminal } from "./types";

export type MtrHourLeg = {
  destEn: string;
  destZh: string;
  first: string;
  last: string;
};

export type MtrStationHours = {
  UP?: MtrHourLeg[];
  DOWN?: MtrHourLeg[];
};

type Pack = { hours?: Record<string, MtrStationHours> };

let cache: Pack | null = null;
let loading: Promise<Pack> | null = null;

async function fetchHoursPack(url: string): Promise<Pack> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { hours: {} };
    return (await res.json()) as Pack;
  } catch {
    return { hours: {} };
  }
}

export async function loadMtrHours(): Promise<Pack> {
  if (cache) return cache;
  if (!loading) {
    loading = Promise.all([
      fetchHoursPack("/data/mtr-first-last.json"),
      fetchHoursPack("/data/lrt-first-last.json"),
    ]).then(([mtr, lrt]) => {
      cache = { hours: { ...(mtr.hours ?? {}), ...(lrt.hours ?? {}) } };
      return cache;
    });
  }
  return loading;
}

/** MTR: EAL:ADM — LRT: 610:LR50 (zero-padded LR050 collapses to LR50). */
function hoursStopKey(stopId: string): string {
  const raw = stopId.replace(/^mtr:/i, "").replace(/^lrt:/i, "");
  if (/^LR/i.test(raw) || /^\d+$/.test(raw)) {
    const num = raw.replace(/^LR/i, "").replace(/^0+/, "") || "0";
    return `LR${num}`.toUpperCase();
  }
  return raw.toUpperCase();
}

export function stationHours(pack: Pack | null, line: string, stopId: string): MtrStationHours | null {
  if (!pack?.hours) return null;
  const key = `${mtrLineCode(line)}:${hoursStopKey(stopId)}`;
  return pack.hours[key] ?? null;
}

export function destLabel(lang: Lang, leg: MtrHourLeg): string {
  return lang === "zh" ? leg.destZh || leg.destEn : leg.destEn || leg.destZh;
}

export function dirLabel(lang: Lang, dir: string, dest?: Terminal): string {
  if (dest?.en || dest?.zh) {
    const name = lang === "zh" ? dest.zh || dest.en : dest.en || dest.zh;
    return lang === "zh" ? `往${name}` : `to ${name}`;
  }
  if (dir === "UP") return lang === "zh" ? "上行" : "Up";
  if (dir === "DOWN") return lang === "zh" ? "下行" : "Down";
  return dir;
}
