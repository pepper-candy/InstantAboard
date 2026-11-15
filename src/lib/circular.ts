/**
 * Circular / loop routes (循環線) keep one official dest for the whole trip.
 * Direction at a stop comes from its place on that loop relative to the
 * turning terminus (e.g. KMB 51: 上村總站), not from a second bound.
 */
import { haversine } from "./geo";
import type { Company, EtaDb, Pin, RouteListEntry, Terminal } from "./types";

const CIRCULAR_RE = /循環|circular/i;
const PLACE_SUFFIX_RE =
  /巴士總站|公共交通交匯處|巴士站|總站|車站|\b(?:bus\s+terminus|bus\s+station|terminus|station|b\/t)\b/gi;
const CJK_RE = /[\u3400-\u9fff]/;
const ORIGIN_GAP_M = 60;
const MIN_STOPS = 3;

type TurnCache = { seq: number | null };
const turnCache = new WeakMap<RouteListEntry, Map<Company, TurnCache>>();

function hasCircularDest(dest: Terminal | undefined): boolean {
  if (!dest) return false;
  return CIRCULAR_RE.test(dest.en) || CIRCULAR_RE.test(dest.zh);
}

function hasOrig(orig: Terminal | undefined): boolean {
  return Boolean(orig && (orig.en.trim() || orig.zh.trim()));
}

function stripCircular(raw: string): string {
  return raw.replace(/[（(][^）)]*(?:循環線|循環|circular)[^）)]*[）)]/gi, " ").trim();
}

function fold(raw: string): string {
  return stripCircular(raw)
    .normalize("NFKC")
    .toLowerCase()
    .replace(PLACE_SUFFIX_RE, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameKeys(name: Terminal | undefined): string[] {
  if (!name) return [];
  const keys = new Set<string>();
  for (const raw of [name.zh, name.en]) {
    if (!raw) continue;
    const stripped = stripCircular(raw);
    const full = fold(stripped);
    if (full.length >= 2) keys.add(full);
    const noParen = fold(stripped.replace(/[（(][^）)]*[）)]/g, " "));
    if (noParen.length >= 2) keys.add(noParen);
  }
  return [...keys];
}

function containsCore(hay: string, core: string): boolean {
  if (!hay || !core || hay.length < core.length) return false;
  if (hay === core) return true;
  if (hay.startsWith(`${core} `) || hay.endsWith(` ${core}`) || hay.includes(` ${core} `)) return true;
  if (CJK_RE.test(core) && hay.includes(core)) return true;
  return false;
}

function similarName(a: Terminal | undefined, b: Terminal | undefined): boolean {
  const left = nameKeys(a);
  const right = nameKeys(b);
  if (!left.length || !right.length) return false;
  return left.some((x) => right.some((y) => x === y || containsCore(x, y) || containsCore(y, x)));
}

function lastStopIsOrigin(db: EtaDb, route: RouteListEntry, company: Company): boolean {
  const ids = route.stops[company] ?? [];
  if (ids.length < MIN_STOPS) return false;
  const firstId = ids[0];
  const lastId = ids[ids.length - 1];
  if (!firstId || !lastId) return false;
  if (firstId === lastId) return true;
  const first = db.stopList[firstId];
  const last = db.stopList[lastId];
  if (similarName(first?.name, last?.name)) return true;
  if (similarName(last?.name, route.orig)) return true;
  if (first?.location && last?.location && haversine(first.location, last.location) < ORIGIN_GAP_M) return true;
  return false;
}

function boundKey(bound: string | undefined): string {
  return (bound ?? "").trim().toUpperCase();
}

/** True when another variant of this route number runs the opposite official bound. */
function hasOtherBound(db: EtaDb, route: RouteListEntry, company: Company): boolean {
  const here = boundKey(route.bound[company]);
  for (const other of Object.values(db.routeList)) {
    if (other === route || other.route !== route.route || !other.co.includes(company)) continue;
    const there = boundKey(other.bound[company]);
    if (there !== here) return true;
  }
  return false;
}

function isCircularRoute(db: EtaDb, route: RouteListEntry, company: Company): boolean {
  const ids = route.stops[company] ?? [];
  if (ids.length < MIN_STOPS) return false;
  if (hasCircularDest(route.dest)) return true;
  return lastStopIsOrigin(db, route, company) && !hasOtherBound(db, route, company);
}

function matchScore(stop: Terminal, cores: string[]): number {
  const raw = `${stop.zh} ${stop.en}`;
  let best = 0;
  for (const hay of nameKeys(stop)) {
    for (const core of cores) {
      if (hay === core) best = Math.max(best, 100);
      else if (hay.startsWith(`${core} `) || (CJK_RE.test(core) && hay.startsWith(core))) best = Math.max(best, 80);
      else if (containsCore(hay, core)) best = Math.max(best, 50);
    }
  }
  if (best <= 0) return 0;
  if (/總站|terminus/i.test(raw)) best += 15;
  else if (/站|\bstation\b/i.test(raw)) best += 8;
  return best;
}

function findTurningSeq(db: EtaDb, route: RouteListEntry, company: Company): number | null {
  if (!isCircularRoute(db, route, company)) return null;
  const ids = route.stops[company] ?? [];
  const cores = nameKeys(route.dest);
  if (!cores.length) return null;
  const mid = (ids.length - 1) / 2;
  let best: { seq: number; score: number; dist: number } | null = null;
  for (let seq = 1; seq < ids.length - 1; seq++) {
    const stopId = ids[seq];
    if (!stopId) continue;
    const stop = db.stopList[stopId]?.name;
    if (!stop) continue;
    const score = matchScore(stop, cores);
    if (score < 50) continue;
    const dist = Math.abs(seq - mid);
    if (
      !best ||
      score > best.score ||
      (score === best.score && dist < best.dist) ||
      (score === best.score && dist === best.dist && seq > best.seq)
    ) {
      best = { seq, score, dist };
    }
  }
  return best?.seq ?? null;
}

function cachedTurn(db: EtaDb, route: RouteListEntry, company: Company): number | null {
  let byCo = turnCache.get(route);
  if (!byCo) {
    byCo = new Map();
    turnCache.set(route, byCo);
  }
  const hit = byCo.get(company);
  if (hit !== undefined) return hit.seq;
  const seq = findTurningSeq(db, route, company);
  byCo.set(company, { seq });
  return seq;
}

function resolveSeq(ids: string[], stopId: string, stopSeq?: number): number | null {
  if (stopSeq != null && ids[stopSeq] === stopId) return stopSeq;
  const idx = stopId ? ids.indexOf(stopId) : -1;
  if (idx >= 0) return idx;
  if (stopSeq != null && stopSeq >= 0 && stopSeq < ids.length) return stopSeq;
  return null;
}

function sameTerminal(a: Terminal | undefined, b: Terminal | undefined): boolean {
  if (!a || !b) return false;
  return a.zh === b.zh && a.en === b.en;
}

function namePairScore(a: Terminal | undefined, b: Terminal | undefined): number {
  const left = nameKeys(a);
  const right = nameKeys(b);
  let best = 0;
  for (const x of left) {
    for (const y of right) {
      if (x === y) best = Math.max(best, 100);
      else if (containsCore(x, y) || containsCore(y, x)) best = Math.max(best, 50);
    }
  }
  return best;
}

const COUNTERPART_NAME_M = 220;
const COUNTERPART_NEAR_M = 110;

/** Official dest before the turning terminus; origin after (and at) that stop. */
export function destAtStop(
  db: EtaDb,
  route: RouteListEntry,
  company: Company,
  stopId: string,
  stopSeq?: number,
): Terminal {
  const dest = route.dest;
  const turn = cachedTurn(db, route, company);
  if (turn == null || !hasOrig(route.orig)) return dest;
  const seq = resolveSeq(route.stops[company] ?? [], stopId, stopSeq);
  if (seq == null) return dest;
  return seq >= turn ? route.orig : dest;
}

/** Both search rows for a one-bound loop: official dest, then origin as dest. */
export function circularSearchLegs(
  db: EtaDb,
  route: RouteListEntry,
  company: Company,
): Array<{ dest: Terminal; orig: Terminal }> | null {
  if (hasOtherBound(db, route, company)) return null;
  const turn = cachedTurn(db, route, company);
  if (turn == null || !hasOrig(route.orig)) return null;
  if (sameTerminal(route.orig, route.dest)) return null;
  return [
    { dest: route.dest, orig: route.orig },
    { dest: route.orig, orig: route.dest },
  ];
}

/**
 * Same-place stop on the other circular leg, or null when a flip would be a
 * no-op (shared-ID origin, turning terminus, or a one-sided stop).
 */
export function circularCounterpartStop(
  db: EtaDb,
  route: RouteListEntry,
  company: Company,
  stopId: string,
  stopSeq?: number,
): { stopId: string; stopSeq: number } | null {
  const turn = cachedTurn(db, route, company);
  if (turn == null || !hasOrig(route.orig)) return null;
  const ids = route.stops[company] ?? [];
  const seq = resolveSeq(ids, stopId, stopSeq);
  if (seq == null) return null;
  const hereId = ids[seq];
  if (!hereId) return null;
  const here = db.stopList[hereId];
  const hereDest = destAtStop(db, route, company, hereId, seq);
  const outbound = seq < turn;
  let best: { stopId: string; stopSeq: number; score: number; dist: number } | null = null;
  for (let i = 0; i < ids.length; i++) {
    if ((i < turn) === outbound) continue;
    const otherId = ids[i];
    if (!otherId || otherId === hereId) continue;
    const other = db.stopList[otherId];
    if (!other) continue;
    if (sameTerminal(destAtStop(db, route, company, otherId, i), hereDest)) continue;
    const dist =
      here?.location && other.location ? haversine(here.location, other.location) : Number.POSITIVE_INFINITY;
    const hasDist = Number.isFinite(dist);
    const names = namePairScore(here?.name, other.name);
    let score = 0;
    if (names >= 100 && (!hasDist || dist <= COUNTERPART_NAME_M)) score = 100;
    else if (names >= 50 && hasDist && dist <= COUNTERPART_NAME_M) score = 50;
    else if (hasDist && dist <= COUNTERPART_NEAR_M) score = 20;
    else continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && dist < best.dist) ||
      (score === best.score && dist === best.dist && i > best.stopSeq)
    ) {
      best = { stopId: otherId, stopSeq: i, score, dist };
    }
  }
  return best ? { stopId: best.stopId, stopSeq: best.stopSeq } : null;
}

export function destAtPin(db: EtaDb | null | undefined, pin: Pin | null | undefined): Terminal | undefined {
  if (!db || !pin) return undefined;
  const route = db.routeList[pin.routeId];
  if (!route) return undefined;
  return destAtStop(db, route, pin.company, pin.stopId, pin.stopSeq);
}
