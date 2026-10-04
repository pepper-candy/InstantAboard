import type { Company, EtaDb, RouteListEntry, Terminal } from "./types";

export type TramPack = {
  routes: Array<{
    id: string;
    route: string;
    orig: Terminal;
    dest: Terminal;
    stops: string[];
  }>;
  stops: Record<string, { name: Terminal; location: { lat: number; lng: number } }>;
};

export type FerryPier = {
  id: string;
  lat: number;
  lng: number;
  name: Terminal;
  dests: Terminal[];
};

let tramPack: TramPack | null = null;
let ferryPiers: FerryPier[] | null = null;

export async function loadTramPack(): Promise<TramPack> {
  if (tramPack) return tramPack;
  const res = await fetch("/data/tram.json");
  tramPack = res.ok ? ((await res.json()) as TramPack) : { routes: [], stops: {} };
  return tramPack;
}

export async function loadFerryPiers(): Promise<FerryPier[]> {
  if (ferryPiers) return ferryPiers;
  const res = await fetch("/data/ferry-piers.json");
  ferryPiers = res.ok ? ((await res.json()) as FerryPier[]) : [];
  return ferryPiers;
}

const TRAM_EVERY_DAY: Array<"0" | "1"> = ["1", "1", "1", "1", "1", "1", "1"];

export function mergeTram(db: EtaDb, pack: TramPack): EtaDb {
  const routeList = { ...db.routeList };
  const stopList = { ...db.stopList };
  const serviceDayMap = { ...db.serviceDayMap };
  const freq = tramFreq(serviceDayMap);
  for (const [id, stop] of Object.entries(pack.stops)) {
    if (!stopList[id]) stopList[id] = stop;
  }
  for (const route of pack.routes) {
    if (routeList[route.id]) continue;
    const entry: RouteListEntry = {
      route: route.route,
      co: ["tram"],
      orig: route.orig,
      dest: route.dest,
      fares: null,
      faresHoliday: null,
      freq,
      jt: null,
      seq: 0,
      serviceType: "1",
      stops: { tram: route.stops },
      bound: { tram: "O" },
      gtfsId: "",
      nlbId: "",
    };
    routeList[route.id] = entry;
  }
  return { ...db, routeList, stopList, serviceDayMap };
}

/** Pick service-day keys that exist in the ETA db so timetable ETAs resolve. */
function tramFreq(serviceDayMap: EtaDb["serviceDayMap"]): RouteListEntry["freq"] {
  const days = Object.entries(serviceDayMap);
  const everyday = days.find(([, row]) => row.every((d) => d === "1"))?.[0];
  const weekday = days.find(([, row]) => row.slice(1, 6).every((d) => d === "1") && row[0] === "0" && row[6] === "0")?.[0];
  const weekend = days.find(([, row]) => row[0] === "1" && row[6] === "1" && row.slice(1, 6).every((d) => d === "0"))?.[0];
  if (weekday && weekend) {
    return { [weekday]: { "0600": ["2400", "4"] }, [weekend]: { "0600": ["2400", "6"] } };
  }
  const key = everyday ?? days[0]?.[0] ?? "tram-daily";
  if (!serviceDayMap[key]) serviceDayMap[key] = TRAM_EVERY_DAY;
  return { [key]: { "0600": ["2400", "5"] } };
}

export function tramStopsOf(pack: TramPack) {
  return pack.routes.flatMap((route) =>
    route.stops.map((id) => {
      const stop = pack.stops[id];
      return {
        id,
        lat: stop?.location.lat ?? 0,
        lng: stop?.location.lng ?? 0,
        name: stop?.name ?? { en: id, zh: id },
        routeId: route.id,
        dest: route.dest,
      };
    }),
  );
}

export function asCompany(value: string): Company {
  if (
    value === "kmb" ||
    value === "ctb" ||
    value === "gmb" ||
    value === "nlb" ||
    value === "lrtfeeder" ||
    value === "lightRail" ||
    value === "mtr" ||
    value === "sunferry" ||
    value === "hkkf" ||
    value === "fortuneferry" ||
    value === "tram"
  ) {
    return value;
  }
  return "kmb";
}
