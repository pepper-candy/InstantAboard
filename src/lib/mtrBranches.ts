import { mtrLineCode } from "./colors";
import type { LatLng } from "./geo";
import { shapeFileName } from "./shapeFile";
import type { EtaDb, RouteListEntry, Terminal } from "./types";

/** Stable dest key for deduping branch termini. */
export function mtrDestKey(dest: Terminal | undefined): string {
  if (!dest) return "";
  return `${(dest.en || "").trim().toUpperCase()}|${(dest.zh || "").trim()}`;
}

/** Race-day-only East Rail spur (馬場) — not a permanent board terminus. */
export function isRacecourseDest(dest: Terminal | string | undefined): boolean {
  if (!dest) return false;
  if (typeof dest === "string") {
    const raw = dest.replace(/^mtr:/i, "").trim().toUpperCase();
    if (raw === "RAC" || raw === "RACECOURSE") return true;
    return /racecourse|馬場/.test(dest);
  }
  const en = (dest.en || "").trim().toLowerCase();
  const zh = (dest.zh || "").trim();
  if (en === "racecourse" || zh === "馬場") return true;
  return /racecourse/.test(en) || zh.includes("馬場");
}

export function isRacecourseStopId(stopId: string | undefined): boolean {
  if (!stopId) return false;
  const id = stopId.replace(/^mtr:/i, "").toUpperCase();
  return id === "RAC" || id.endsWith(":RAC");
}

export function isRacecourseRoute(route: RouteListEntry): boolean {
  if (isRacecourseDest(route.dest) || isRacecourseDest(route.orig)) return true;
  return (route.stops.mtr ?? []).some(isRacecourseStopId);
}

const MTR_DEST_CODE: Record<string, string> = {
  LOW: "LOW",
  "LO WU": "LOW",
  羅湖: "LOW",
  LMC: "LMC",
  "LOK MA CHAU": "LMC",
  落馬洲: "LMC",
  POA: "POA",
  "PO LAM": "POA",
  寶琳: "POA",
  寶林: "POA",
  LHP: "LHP",
  "LOHAS PARK": "LHP",
  LOHAS: "LHP",
  康城: "LHP",
  日出康城: "LHP",
};

/**
 * Normalize an MTR train destination to its terminus code (LOW | LMC | POA |
 * LHP | RAC). Unknown codes pass through untouched (e.g. "ADM", "NOP") so
 * callers can check membership against the line's arms.
 */
export function mtrDestCode(dest: Terminal | string | undefined): string {
  if (isRacecourseDest(dest)) return "RAC";
  if (typeof dest === "string") {
    const raw = dest.replace(/^mtr:/i, "").trim().toUpperCase();
    return raw ? MTR_DEST_CODE[raw] ?? raw : "";
  }
  const en = (dest?.en || "").trim().toUpperCase();
  const zh = (dest?.zh || "").trim();
  if (en && MTR_DEST_CODE[en]) return MTR_DEST_CODE[en];
  if (zh && MTR_DEST_CODE[zh]) return MTR_DEST_CODE[zh];
  return en;
}

export function mtrBoundDir(bound: string | undefined): "UP" | "DOWN" | null {
  const b = (bound ?? "").toUpperCase();
  if (b === "DT") return "DOWN";
  if (b === "UT") return "UP";
  if (b.includes("DT")) return "DOWN";
  if (b.includes("UT")) return "UP";
  return null;
}

/** Exact UT/DT only — branch suffixes (e.g. LMC-UT) are not “main”. */
export function isMainMtrBound(bound: string | undefined): boolean {
  const b = (bound ?? "").toUpperCase();
  return b === "UT" || b === "DT";
}

/** Variant family for flip preference: main spine vs LMC vs TKS vs Racecourse. */
export function mtrBranchFamily(route: RouteListEntry): string {
  if (isRacecourseRoute(route)) return "RAC";
  return route.route.toUpperCase();
}

export type MtrArmRoute = {
  routeId: string;
  route: RouteListEntry;
  dir: "UP" | "DOWN" | null;
  main: boolean;
  racecourse: boolean;
  stops: LatLng[];
  stopIds: string[];
  shapeName: string;
};

/** Every MTR route entry that belongs to a line code (EAL includes EAL_LMC + Racecourse). */
export function listMtrArmRoutes(db: EtaDb, lineCode: string): MtrArmRoute[] {
  const want = mtrLineCode(lineCode);
  const out: MtrArmRoute[] = [];
  for (const [routeId, route] of Object.entries(db.routeList)) {
    if (!route.co.includes("mtr")) continue;
    if (mtrLineCode(route.route) !== want) continue;
    const stopIds = route.stops.mtr ?? [];
    if (stopIds.length < 2) continue;
    const stops: LatLng[] = [];
    for (const id of stopIds) {
      const loc = db.stopList[id]?.location;
      if (loc) stops.push({ lat: loc.lat, lng: loc.lng });
    }
    if (stops.length < 2) continue;
    out.push({
      routeId,
      route,
      dir: mtrBoundDir(route.bound.mtr),
      main: isMainMtrBound(route.bound.mtr),
      racecourse: isRacecourseRoute(route),
      stops,
      stopIds,
      shapeName: shapeFileName({
        company: "mtr",
        route: route.route,
        bound: route.bound.mtr,
        serviceType: route.serviceType,
        gtfsId: route.gtfsId,
        nlbId: route.nlbId,
      }),
    });
  }
  return out;
}

/**
 * Unique shape jobs for a line: one per shape file name.
 * Prefer a non-racecourse, main-bound arm when several share geometry intent.
 */
export function mtrLineShapeArms(
  db: EtaDb,
  lineCode: string,
  activeRouteId?: string,
): { active?: MtrArmRoute; arms: MtrArmRoute[] } {
  const all = listMtrArmRoutes(db, lineCode);
  const byShape = new Map<string, MtrArmRoute>();
  for (const arm of all) {
    const cur = byShape.get(arm.shapeName);
    if (!cur) {
      byShape.set(arm.shapeName, arm);
      continue;
    }
    if (arm.routeId === activeRouteId) {
      byShape.set(arm.shapeName, arm);
      continue;
    }
    if (cur.routeId === activeRouteId) continue;
    if (cur.racecourse !== arm.racecourse) {
      if (!arm.racecourse) byShape.set(arm.shapeName, arm);
      continue;
    }
    if (cur.main !== arm.main) {
      if (arm.main) byShape.set(arm.shapeName, arm);
      continue;
    }
    if (arm.stops.length > cur.stops.length) byShape.set(arm.shapeName, arm);
  }
  const arms = [...byShape.values()];
  const active = activeRouteId ? all.find((arm) => arm.routeId === activeRouteId) ?? arms[0] : arms[0];
  return { active, arms };
}

/** Union of station dots across every arm of the line (includes 馬場 when present). */
export function mtrLineStationDots(
  db: EtaDb,
  lineCode: string,
): Array<{ lat: number; lng: number; seq: number; stopId: string }> {
  const seen = new Map<string, { lat: number; lng: number; seq: number; stopId: string }>();
  let seq = 0;
  for (const arm of listMtrArmRoutes(db, lineCode)) {
    for (const stopId of arm.stopIds) {
      const key = stopId.replace(/^mtr:/i, "").toUpperCase();
      if (seen.has(key)) continue;
      const loc = db.stopList[stopId]?.location;
      if (!loc) continue;
      seen.set(key, { lat: loc.lat, lng: loc.lng, seq: seq++, stopId });
    }
  }
  return [...seen.values()];
}

export function arrivalIsRacecourse(row: { dest?: Terminal; destCode?: string }): boolean {
  if (row.destCode && isRacecourseDest(row.destCode)) return true;
  return isRacecourseDest(row.dest);
}

export type MergedMtrStop = {
  stopId: string;
  /** Index on the active variant; -1 when the stop only exists on a sibling arm / synthetic. */
  activeSeq: number;
  /** Route to open on tap (sibling arm for branch-only stops). */
  routeId: string;
  /** True when not on the open variant — keep false for list chrome (no indent). */
  branch: boolean;
};

function normMtrStopId(stopId: string): string {
  return stopId.replace(/^mtr:/i, "").toUpperCase();
}

/**
 * Dual termini only — always the first two (DOWN/city-bound) or last two (UP/branch-bound).
 * EAL toward border: …上水, 羅湖, 落馬洲. Toward Admiralty: 落馬洲, 羅湖, 上水…
 * TKL toward Po Lam/LOHAS: …坑口, 寶琳, 康城. Toward North Point: 康城, 寶琳, 坑口…
 */
const MTR_BRANCH_TAIL: Record<string, { UP: string[]; DOWN: string[] }> = {
  EAL: { UP: ["LOW", "LMC"], DOWN: ["LMC", "LOW"] },
  TKL: { UP: ["POA", "LHP"], DOWN: ["LHP", "POA"] },
};

/** Sha Tin Racecourse MTR — spur near Fo Tan; list order 火炭↔馬場↔大學 (not in ETA pack today). */
const RAC_STOP_ID = "RAC";
const RAC_LOCATION = { lat: 22.3997, lng: 114.2028 };

/** Ensure 馬場 exists in stopList so the detail list can show / fly to it. */
export function ensureRacecourseStop(db: EtaDb): string {
  const key =
    db.stopList[RAC_STOP_ID] != null
      ? RAC_STOP_ID
      : db.stopList[`mtr:${RAC_STOP_ID}`] != null
        ? `mtr:${RAC_STOP_ID}`
        : RAC_STOP_ID;
  const existing = db.stopList[key];
  const loc = existing?.location;
  const hasLoc =
    loc != null &&
    Number.isFinite(loc.lat) &&
    Number.isFinite(loc.lng) &&
    !(loc.lat === 0 && loc.lng === 0);
  if (existing && hasLoc) return key;
  db.stopList[key] = {
    name: existing?.name ?? { en: "Racecourse", zh: "馬場" },
    location: { ...RAC_LOCATION },
  };
  return key;
}

function resolveStopId(db: EtaDb, code: string, arms: MtrArmRoute[]): string | null {
  const want = code.toUpperCase();
  for (const arm of arms) {
    for (const id of arm.stopIds) {
      if (normMtrStopId(id) === want) return id;
    }
  }
  if (db.stopList[want]) return want;
  const pref = `mtr:${want}`;
  if (db.stopList[pref]) return pref;
  return null;
}

function armForStop(arms: MtrArmRoute[], stopId: string, preferRouteId: string): MtrArmRoute | undefined {
  const key = normMtrStopId(stopId);
  const hit = arms.filter((arm) => arm.stopIds.some((id) => normMtrStopId(id) === key));
  if (!hit.length) return undefined;
  return hit.find((arm) => arm.routeId === preferRouteId) ?? hit.find((arm) => arm.main) ?? hit[0];
}

/** Insert RAC between FOT and UNI (UP: after FOT; DOWN: after UNI) — matches map spur by Fo Tan. */
function withRacecourseBetween(ids: string[], dir: "UP" | "DOWN", racId: string): string[] {
  const out: string[] = [];
  const racKey = normMtrStopId(racId);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (normMtrStopId(id) === racKey) continue;
    out.push(id);
    const key = normMtrStopId(id);
    const next = ids[i + 1];
    const nextKey = next ? normMtrStopId(next) : "";
    if (dir === "UP" && key === "FOT" && nextKey === "UNI") out.push(racId);
    if (dir === "DOWN" && key === "UNI" && nextKey === "FOT") out.push(racId);
  }
  // If FOT/UNI adjacent check failed (missing neighbour), still place RAC beside FOT.
  if (!out.some((id) => normMtrStopId(id) === racKey)) {
    const fot = out.findIndex((id) => normMtrStopId(id) === "FOT");
    if (fot >= 0) {
      if (dir === "UP") out.splice(fot + 1, 0, racId);
      else out.splice(fot, 0, racId);
    }
  }
  return out;
}

/**
 * Canonical merged station list for branched MTR lines (EAL / TKL).
 * Same order every time for a given direction — dual termini only at the ends.
 * Racecourse sits between Fo Tan and University like any other stop (EAL only); map spur is the red loop by Fo Tan.
 */
export function mergeMtrDetailStops(db: EtaDb, activeRouteId: string): MergedMtrStop[] {
  const active = db.routeList[activeRouteId];
  if (!active?.co.includes("mtr")) return [];
  const activeIds = active.stops.mtr ?? [];
  if (activeIds.length < 2) {
    return activeIds.map((stopId, activeSeq) => ({
      stopId,
      activeSeq,
      routeId: activeRouteId,
      branch: false,
    }));
  }

  const lineCode = mtrLineCode(active.route);
  const activeDir = mtrBoundDir(active.bound.mtr);
  const tailCodes = activeDir ? MTR_BRANCH_TAIL[lineCode]?.[activeDir] : undefined;
  if (!tailCodes || !activeDir) {
    return activeIds.map((stopId, activeSeq) => ({
      stopId,
      activeSeq,
      routeId: activeRouteId,
      branch: false,
    }));
  }

  const arms = listMtrArmRoutes(db, lineCode).filter(
    (arm) => !arm.racecourse && arm.dir === activeDir,
  );
  if (arms.length < 1) {
    return activeIds.map((stopId, activeSeq) => ({
      stopId,
      activeSeq,
      routeId: activeRouteId,
      branch: false,
    }));
  }

  // Longest main spine — short branch arms must not shrink the list.
  const spine = [...arms].sort((a, b) => {
    if (a.main !== b.main) return a.main ? -1 : 1;
    return b.stopIds.length - a.stopIds.length;
  })[0];

  const tailSet = new Set(tailCodes.map((c) => c.toUpperCase()));
  let core = spine.stopIds.filter((id) => !tailSet.has(normMtrStopId(id)));
  const tailIds = tailCodes
    .map((code) => resolveStopId(db, code, arms))
    .filter((id): id is string => Boolean(id));

  if (lineCode === "EAL") {
    const racId = ensureRacecourseStop(db);
    core = withRacecourseBetween(core, activeDir, racId);
  }

  const ordered = activeDir === "UP" ? [...core, ...tailIds] : [...tailIds, ...core];

  const activeIndex = new Map(activeIds.map((id, seq) => [normMtrStopId(id), seq]));
  return ordered.map((stopId) => {
    const key = normMtrStopId(stopId);
    const seq = activeIndex.get(key);
    const onActive = seq != null;
    const arm = armForStop(arms, stopId, activeRouteId);
    return {
      stopId,
      activeSeq: onActive ? seq! : arm ? arm.stopIds.findIndex((id) => normMtrStopId(id) === key) : -1,
      routeId: onActive ? activeRouteId : arm?.routeId ?? activeRouteId,
      // Never mark list rows as "branch" chrome — termini / RAC look like normal stops.
      branch: false,
    };
  });
}
