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
let kaitoPack: KaitoPack | null = null;
const kaitoByRouteId = new Map<string, KaitoService>();

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

/** Stable token for `shapeFileName` — every tram corridor is otherwise named "Tram". */
export function tramShapeId(routeId: string): string {
  return routeId
    .replace(/^tram\+/i, "")
    .replace(/\s*\(\$2 for JoyYou[^)]*\)/gi, "")
    .replace(/\+/g, "-")
    .trim();
}

export function mergeTram(db: EtaDb, pack: TramPack): EtaDb {
  const routeList = { ...db.routeList };
  const stopList = { ...db.stopList };
  const serviceDayMap = { ...db.serviceDayMap };
  for (const [id, stop] of Object.entries(pack.stops)) {
    if (!stopList[id]) stopList[id] = stop;
  }
  for (const route of pack.routes) {
    if (routeList[route.id]) continue;
    // TD JSON: locStart/locEnd are corridor ends. routeSeq 2 travels dest → orig.
    const inbound = route.id.startsWith("tram+2+");
    const entry: RouteListEntry = {
      route: route.route,
      co: ["tram"],
      orig: inbound ? route.dest : route.orig,
      dest: inbound ? route.orig : route.dest,
      fares: null,
      faresHoliday: null,
      freq: null,
      jt: null,
      seq: 0,
      serviceType: "1",
      stops: { tram: route.stops },
      bound: { tram: inbound ? "I" : "O" },
      // All corridors are named "Tram"; this keeps /shapes filenames unique per bound.
      gtfsId: tramShapeId(route.id),
      nlbId: "",
    };
    routeList[route.id] = entry;
  }
  return { ...db, routeList, stopList, serviceDayMap };
}

export type KaitoDay = {
  raw: string;
  days: number[];
  holiday: boolean | null;
  excludeHoliday: boolean;
  onDemand: boolean;
};

export type KaitoScheduleRow =
  | {
      type: "headway";
      day: KaitoDay;
      from: string;
      serviceStart: string;
      serviceEnd: string;
      headwayMin: { min: number; max: number } | null;
      raw: string | string[];
    }
  | {
      type: "clocks";
      day: KaitoDay;
      from: string;
      times: string[];
      directionHint?: string | null;
      raw: string | string[];
    }
  | {
      type: "onDemand";
      day: KaitoDay;
      from: string;
      times?: string[];
      serviceStart?: string;
      serviceEnd?: string;
      raw: string | string[];
    }
  | { type: "note"; text: string };

export type KaitoStop = {
  id: string;
  name: Terminal;
  lat: number;
  lng: number;
};

export type KaitoGeoRoute = {
  id: string;
  orig: Terminal;
  dest: Terminal;
  stopIds: string[];
};

export type KaitoService = {
  code: string;
  title: Terminal;
  timetableUrl: Terminal;
  geoRoutes: KaitoGeoRoute[];
  stops: KaitoStop[];
  schedule: KaitoScheduleRow[];
};

export type KaitoPack = { services: KaitoService[] };

function indexKaito(pack: KaitoPack) {
  kaitoByRouteId.clear();
  for (const svc of pack.services) {
    const id = svc.geoRoutes[0]?.id;
    if (id) kaitoByRouteId.set(id, svc);
  }
}

export async function loadKaitoPack(): Promise<KaitoPack> {
  if (kaitoPack) return kaitoPack;
  const res = await fetch("/data/kaito.json");
  kaitoPack = res.ok ? ((await res.json()) as KaitoPack) : { services: [] };
  indexKaito(kaitoPack);
  return kaitoPack;
}

export function kaitoServiceOf(routeId: string): KaitoService | undefined {
  return kaitoByRouteId.get(routeId);
}

export function kaitoDestAt(routeId: string, stopId: string): Terminal | undefined {
  const svc = kaitoByRouteId.get(routeId);
  if (!svc) return undefined;
  const geo =
    svc.geoRoutes.find((row) => row.stopIds[0] === stopId) ??
    svc.geoRoutes.find((row) => row.stopIds.includes(stopId) && row.stopIds[row.stopIds.length - 1] !== stopId);
  return geo?.dest ?? svc.title;
}

export function kaitoPiersOf(pack: KaitoPack): FerryPier[] {
  const seen = new Set<string>();
  const out: FerryPier[] = [];
  for (const svc of pack.services) {
    for (const stop of svc.stops) {
      if (seen.has(stop.id)) continue;
      seen.add(stop.id);
      out.push({
        id: stop.id,
        lat: stop.lat,
        lng: stop.lng,
        name: stop.name,
        dests: svc.stops.filter((item) => item.id !== stop.id).map((item) => item.name),
      });
    }
  }
  return out;
}

export function mergeKaito(db: EtaDb, pack: KaitoPack): EtaDb {
  indexKaito(pack);
  const routeList = { ...db.routeList };
  const stopList = { ...db.stopList };
  for (const svc of pack.services) {
    const geo = svc.geoRoutes[0];
    if (!geo || routeList[geo.id]) continue;
    for (const stop of svc.stops) {
      if (!stopList[stop.id]) {
        stopList[stop.id] = { name: stop.name, location: { lat: stop.lat, lng: stop.lng } };
      }
    }
    routeList[geo.id] = {
      route: svc.code,
      co: ["kaito"],
      orig: geo.orig,
      dest: svc.title,
      fares: null,
      faresHoliday: null,
      freq: null,
      jt: null,
      seq: 0,
      serviceType: "1",
      stops: { kaito: svc.stops.map((stop) => stop.id) },
      bound: { kaito: "O" },
      gtfsId: geo.id,
      nlbId: "",
    };
  }
  return { ...db, routeList, stopList };
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
    value === "kaito" ||
    value === "tram"
  ) {
    return value;
  }
  return "kmb";
}
