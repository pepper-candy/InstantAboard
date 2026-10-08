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

export async function loadMtrHours(): Promise<Pack> {
  if (cache) return cache;
  if (!loading) {
    loading = fetch("/data/mtr-first-last.json")
      .then((res) => (res.ok ? res.json() : { hours: {} }))
      .then((json) => {
        cache = json as Pack;
        return cache;
      })
      .catch(() => {
        cache = { hours: {} };
        return cache;
      });
  }
  return loading;
}

export function stationHours(pack: Pack | null, line: string, stopId: string): MtrStationHours | null {
  if (!pack?.hours) return null;
  const key = `${mtrLineCode(line)}:${stopId.replace(/^mtr:/i, "").toUpperCase()}`;
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
