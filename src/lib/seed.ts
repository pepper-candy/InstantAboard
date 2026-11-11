import { mtrLineCode } from "./colors";
import { primaryCompany } from "./mode";
import { isRacecourseRoute } from "./mtrBranches";
import type { Company, EtaDb, Pin, RouteListEntry } from "./types";

type SeedSpec = {
  route: string;
  company: Company;
  destHint: string[];
  stopHint: string[];
  serviceType?: string;
  bothWays?: boolean;
};

const SEEDS: SeedSpec[] = [
  {
    route: "TKL",
    company: "mtr",
    destHint: ["PO LAM", "LOHAS PARK"],
    stopHint: ["TSEUNG KWAN O"],
    bothWays: true,
  },
  {
    route: "KTL",
    company: "mtr",
    destHint: ["WHAMPOA", "HO MAN TIN"],
    stopHint: ["TIU KENG LENG"],
    bothWays: true,
  },
  {
    route: "TKL",
    company: "mtr",
    destHint: ["NORTH POINT", "ADMIRALTY"],
    stopHint: ["HANG HAU"],
    bothWays: true,
  },
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
    stopHint: ["H.K.U.S.T. (NORTH)", "H.K.U.S.T (NORTH)", "HKUST (NORTH)", "H.K.U.S.T", "HKUST"],
    serviceType: "1",
  },
  {
    route: "91M",
    company: "kmb",
    destHint: ["DIAMOND HILL"],
    stopHint: ["H.K.U.S.T. (NORTH)", "H.K.U.S.T (NORTH)", "HKUST (NORTH)", "H.K.U.S.T", "HKUST"],
    serviceType: "1",
  },
  {
    route: "792M",
    company: "ctb",
    destHint: ["TSEUNG KWAN O STATION"],
    stopHint: ["UNIVERSITY OF SCIENCE", "UNIVERSITY ROAD"],
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

function routeMatches(route: RouteListEntry, spec: SeedSpec): boolean {
  if (!route.co.includes(spec.company)) return false;
  if (spec.serviceType && String(route.serviceType) !== spec.serviceType) return false;
  if (spec.company === "mtr") {
    if (isRacecourseRoute(route)) return false;
    if (mtrLineCode(route.route) !== spec.route.toUpperCase()) return false;
  } else if (route.route.toUpperCase() !== spec.route.toUpperCase()) {
    return false;
  }
  return includesAny(`${route.dest.en} ${route.dest.zh}`, spec.destHint);
}

function destRank(route: RouteListEntry, hints: string[]): number {
  return hintRank(`${route.dest.en} ${route.dest.zh}`, hints);
}

function hintRank(hay: string, hints: string[]): number {
  const upper = hay.toUpperCase();
  const index = hints.findIndex((hint) => upper.includes(hint.toUpperCase()));
  return index < 0 ? hints.length : index;
}

function resolveSeed(db: EtaDb, spec: SeedSpec): Pin | null {
  const matches = Object.entries(db.routeList)
    .filter(([, route]) => routeMatches(route, spec))
    .sort((a, b) => destRank(a[1], spec.destHint) - destRank(b[1], spec.destHint));
  const picked = matches[0];
  if (!picked) return null;
  const [routeId, route] = picked;
  const company = route.co.includes(spec.company) ? spec.company : primaryCompany(route);
  const stopIds = route.stops[company] ?? [];
  let best: { stopSeq: number; stopId: string; rank: number } | null = null;
  for (let i = 0; i < stopIds.length; i++) {
    const stop = db.stopList[stopIds[i]];
    if (!stop) continue;
    const rank = hintRank(`${stop.name.en} ${stop.name.zh}`, spec.stopHint);
    if (rank >= spec.stopHint.length) continue;
    if (!best || rank < best.rank) best = { stopSeq: i, stopId: stopIds[i], rank };
  }
  if (!best) return null;
  const { stopSeq, stopId } = best;
  return {
    id: `seed-${spec.route}-${company}-${routeId}-${stopSeq}`,
    routeId,
    company,
    stopId,
    stopSeq,
    auto: true,
    bothWays: spec.bothWays,
  };
}

function includesAny(hay: string, needles: string[]): boolean {
  const h = hay.toUpperCase();
  return needles.some((n) => h.includes(n.toUpperCase()));
}
