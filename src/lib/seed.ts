import { primaryCompany } from "./mode";
import type { Company, EtaDb, Pin, RouteListEntry } from "./types";

type SeedSpec = {
  route: string;
  company: Company;
  destHint: string[];
  stopHint: string[];
  serviceType?: string;
};

const SEEDS: SeedSpec[] = [
  {
    route: "91M",
    company: "kmb",
    destHint: ["DIAMOND HILL"],
    stopHint: ["HANG HAU STATION"],
    serviceType: "1",
  },
  {
    route: "91M",
    company: "kmb",
    destHint: ["PO LAM"],
    stopHint: ["H.K.U.S.T. (NORTH)", "H.K.U.S.T (NORTH)", "科技大學(北)"],
    serviceType: "1",
  },
  {
    route: "11M",
    company: "gmb",
    destHint: ["SCIENCE AND TECHNOLOGY", "HKUST", "科技大學"],
    stopHint: ["HANG HAU STATION PUBLIC TRANSPORT", "坑口站公共運輸"],
  },
  {
    route: "792M",
    company: "ctb",
    destHint: ["TSEUNG KWAN O STATION", "將軍澳站"],
    stopHint: ["UNIVERSITY OF SCIENCE", "UNIVERSITY ROAD", "科技大學"],
  },
];

export function buildSeedPins(db: EtaDb): Pin[] {
  const pins: Pin[] = [];
  for (const spec of SEEDS) {
    const pin = resolveSeed(db, spec);
    if (pin) pins.push(pin);
  }
  return pins;
}

function resolveSeed(db: EtaDb, spec: SeedSpec): Pin | null {
  const matches = Object.entries(db.routeList).filter(([, route]) => {
    if (route.route.toUpperCase() !== spec.route.toUpperCase()) return false;
    if (!route.co.includes(spec.company)) return false;
    if (spec.serviceType && String(route.serviceType) !== spec.serviceType) return false;
    return includesAny(`${route.dest.en} ${route.dest.zh}`, spec.destHint);
  });
  const picked = matches[0];
  if (!picked) return null;
  const [routeId, route] = picked;
  const company = route.co.includes(spec.company) ? spec.company : primaryCompany(route);
  const stopIds = route.stops[company] ?? [];
  let stopSeq = 0;
  let stopId = stopIds[0] ?? "";
  for (let i = 0; i < stopIds.length; i++) {
    const stop = db.stopList[stopIds[i]];
    if (!stop) continue;
    if (includesAny(`${stop.name.en} ${stop.name.zh}`, spec.stopHint)) {
      stopSeq = i;
      stopId = stopIds[i];
      break;
    }
  }
  if (!stopId) return null;
  return {
    id: `seed-${spec.route}-${company}-${stopSeq}-${routeId.length}`,
    routeId,
    company,
    stopId,
    stopSeq,
  };
}

function includesAny(hay: string, needles: string[]): boolean {
  const h = hay.toUpperCase();
  return needles.some((n) => h.includes(n.toUpperCase()));
}

export function routeLabel(route: RouteListEntry): string {
  return route.route;
}
