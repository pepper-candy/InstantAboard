import {
  bearing,
  cumulativeDistances,
  distancesOnPath,
  haversine,
  pointAtDistance,
  type LatLng,
} from "./geo";
import { isDueLive, liveSeconds, type StopClock } from "./routeClocks";
import type { BusSimRegion, Company } from "./types";
import { companySpeedMs } from "./vehicle";

/** Metres to keep the painted region off stop markers. */
export const STOP_GAP_M = 32;
/** Bus SVG is treated as covering a stop inside this radius. */
export const BUS_COVER_M = 38;
const MIN_BAND_M = 16;
const CHEVRON_SPACING_M = 22;
const CHEVRON_INSET_M = 14;
const MAX_BUSES = 8;
/** Extra band growth as a fraction of modelled speed while waiting for a poll. */
const EXPAND_FRAC = 0.22;
const EXPAND_STALE_FRAC = 0.38;
/** Short ease onto a new along-track target (poll jump / carve). */
const MOTION_EASE_S = 0.28;

/** Exponential ease of an along-track metre value. */
export function easeToward(current: number, target: number, dt: number): number {
  if (!Number.isFinite(current)) return target;
  const k = 1 - Math.exp(-Math.max(0, dt) / MOTION_EASE_S);
  return current + (target - current) * k;
}

export type SimCore = {
  id: string;
  fetchedAt: number;
  speedMs: number;
  horizonS: number;
  impliedDist: number;
  estimate0: number;
  before0: number;
  ahead0: number;
  floorDist: number;
  flagDist: number;
  atStop: number[];
};

export function etaHorizonS(company: Company): number {
  return company === "lrtfeeder" ? 10 : 60;
}

export function fleetPollMs(company: Company): number {
  return company === "lrtfeeder" ? 10_000 : 60_000;
}

function impliedDistance(
  clock: StopClock,
  atStop: number[],
  speedMs: number,
  now: number,
): { dist: number; floorDist: number; flagDist: number } | null {
  const limit = Math.min(clock.seconds.length, atStop.length);
  let flag = -1;
  const reachedMem = clock.reached ?? -1;
  for (let i = 0; i < limit; i++) {
    if (i <= reachedMem) continue;
    const value = liveSeconds(clock, i, now);
    if (value != null && value > 0) {
      flag = i;
      break;
    }
  }
  let hold = reachedMem;
  const passed = clock.justPassed;
  if (passed != null) hold = Math.max(hold, passed);
  for (let i = 0; i < limit; i++) {
    if (flag >= 0 && i >= flag) break;
    if (isDueLive(liveSeconds(clock, i, now))) hold = Math.max(hold, i);
  }
  if (flag >= 0 && hold >= flag) hold = flag - 1;

  if (flag < 0) {
    if (hold < 0 || hold >= atStop.length) return null;
    const at = atStop[hold];
    if (at == null) return null;
    return { dist: at, floorDist: at, flagDist: at };
  }

  const flagDist = atStop[flag] ?? 0;
  const tFlag = Math.max(0, liveSeconds(clock, flag, now) ?? 0);
  let floorDist = 0;
  if (hold >= 0 && hold < flag) floorDist = atStop[hold] ?? 0;
  floorDist = Math.min(floorDist, flagDist);

  const raw = flagDist - speedMs * tFlag;
  const dist = Math.max(floorDist, Math.min(flagDist, raw));
  return { dist, floorDist, flagDist };
}

/** Keep the open interval off stop points; never reverse the band. */
export function carveBand(
  before: number,
  ahead: number,
  floorDist: number,
  flagDist: number,
  atStop: number[],
  estimate: number,
): { before: number; ahead: number } {
  const loBound = floorDist + STOP_GAP_M;
  const hiBound = Math.max(loBound, flagDist - STOP_GAP_M);
  let lo = Math.max(before, loBound);
  let hi = Math.min(ahead, hiBound);
  for (const stop of atStop) {
    if (stop <= loBound || stop >= hiBound) continue;
    const clearLo = stop - STOP_GAP_M;
    const clearHi = stop + STOP_GAP_M;
    if (hi <= clearLo || lo >= clearHi) continue;
    if (estimate <= stop) hi = Math.min(hi, clearLo);
    else lo = Math.max(lo, clearHi);
  }
  if (hi < lo + MIN_BAND_M) {
    const mid = Math.max(loBound, Math.min(hiBound, estimate));
    lo = Math.max(loBound, mid - MIN_BAND_M / 2);
    hi = Math.min(hiBound, lo + MIN_BAND_M);
    lo = Math.max(loBound, hi - MIN_BAND_M);
  }
  if (hi < lo) return { before: loBound, ahead: Math.max(loBound, hiBound) };
  return { before: lo, ahead: hi };
}

export function slicePath(track: LatLng[], cum: number[], from: number, to: number): LatLng[] {
  const start = pointAtDistance(track, cum, from);
  const end = pointAtDistance(track, cum, to);
  if (!start || !end) return [];
  const pts: LatLng[] = [start];
  for (let i = 0; i < track.length; i++) {
    const d = cum[i] ?? 0;
    if (d > from + 0.5 && d < to - 0.5) {
      const p = track[i];
      if (p) pts.push(p);
    }
  }
  pts.push(end);
  return pts.length >= 2 ? pts : [start, end];
}

export function chevronsAlong(
  path: LatLng[],
  spacing = CHEVRON_SPACING_M,
  inset = CHEVRON_INSET_M,
): Array<{ point: LatLng; deg: number }> {
  if (path.length < 2) return [];
  const cum = cumulativeDistances(path);
  const total = cum[cum.length - 1] ?? 0;
  if (total < inset * 2 + 8) return [];
  const out: Array<{ point: LatLng; deg: number }> = [];
  for (let d = inset; d <= total - inset; d += spacing) {
    const point = pointAtDistance(path, cum, d);
    const next = pointAtDistance(path, cum, Math.min(total, d + 8));
    if (!point || !next) continue;
    out.push({ point, deg: bearing(point, next) });
  }
  return out;
}

function flaggedStops(before: LatLng, ahead: LatLng, stops: LatLng[]): number[] {
  const flagged: number[] = [];
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    if (!stop) continue;
    if (haversine(stop, before) <= BUS_COVER_M || haversine(stop, ahead) <= BUS_COVER_M) {
      flagged.push(i);
    }
  }
  return flagged;
}

function uniqueId(used: Set<string>, id: string): string {
  let next = id;
  let n = 2;
  while (used.has(next)) next = `${id}-${n++}`;
  used.add(next);
  return next;
}

export function freezeSimRegions(
  track: LatLng[],
  stops: LatLng[],
  clocks: StopClock[],
  company: Company,
  previous: SimCore[],
  now: number,
): SimCore[] {
  if (track.length < 2 || stops.length < 2 || !clocks.length) return [];
  const cum = cumulativeDistances(track);
  const total = cum[cum.length - 1] ?? 0;
  if (total < 30) return [];
  const atStop = distancesOnPath(track, stops);
  const prevById = new Map(previous.map((core) => [core.id, core]));
  const used = new Set<string>();
  const cores: SimCore[] = [];
  const speedMs = companySpeedMs(company);
  const horizonS = etaHorizonS(company);
  const horizonM = speedMs * horizonS;

  for (const clock of clocks) {
    const implied = impliedDistance(clock, atStop, speedMs, now);
    if (!implied) continue;
    const id = uniqueId(used, clock.id);
    const prev = prevById.get(clock.id) ?? prevById.get(id);
    const prevEst = prev
      ? prev.impliedDist + prev.speedMs * Math.max(0, (now - prev.fetchedAt) / 1000)
      : implied.dist;
    const before0 = prevEst;
    const ahead0 = Math.max(implied.dist + horizonM, before0 + MIN_BAND_M);
    const estimate0 = Math.max(before0, Math.min(ahead0, implied.dist));
    const carved = carveBand(before0, ahead0, implied.floorDist, implied.flagDist, atStop, estimate0);
    cores.push({
      id,
      fetchedAt: now,
      speedMs,
      horizonS,
      impliedDist: implied.dist,
      estimate0: Math.max(carved.before, Math.min(carved.ahead, estimate0)),
      before0: carved.before,
      ahead0: carved.ahead,
      floorDist: implied.floorDist,
      flagDist: implied.flagDist,
      atStop,
    });
    if (cores.length >= MAX_BUSES) break;
  }
  return cores;
}

export function projectSimRegions(
  track: LatLng[],
  stops: LatLng[],
  cores: SimCore[],
  now: number,
  stale: boolean,
): BusSimRegion[] {
  if (track.length < 2 || !cores.length) return [];
  const cum = cumulativeDistances(track);
  const regions: BusSimRegion[] = [];
  const frac = stale ? EXPAND_STALE_FRAC : EXPAND_FRAC;

  for (const core of cores) {
    const elapsed = Math.max(0, (now - core.fetchedAt) / 1000);
    const capM = core.speedMs * core.horizonS;
    const extra = Math.min(capM, core.speedMs * elapsed * frac);
    const grown = carveBand(
      core.before0 - extra,
      core.ahead0 + extra,
      core.floorDist,
      core.flagDist,
      core.atStop,
      core.estimate0 + core.speedMs * elapsed,
    );
    const estimateRaw = core.impliedDist + core.speedMs * elapsed;
    const estimateDist = Math.max(grown.before, Math.min(grown.ahead, estimateRaw));
    const before = pointAtDistance(track, cum, grown.before);
    const ahead = pointAtDistance(track, cum, grown.ahead);
    const estimate = pointAtDistance(track, cum, estimateDist);
    if (!before || !ahead || !estimate) continue;
    const path = slicePath(track, cum, grown.before, grown.ahead);
    if (path.length < 2) continue;
    regions.push({
      id: core.id,
      before,
      ahead,
      estimate,
      path,
      flaggedStopSeqs: flaggedStops(before, ahead, stops),
      beforeM: grown.before,
      aheadM: grown.ahead,
      estimateM: estimateDist,
    });
  }
  return regions;
}

/** Place glyphs and the corridor from already-eased along-track metres. */
export function placeSimSpan(
  track: LatLng[],
  cum: number[],
  stops: LatLng[],
  id: string,
  beforeM: number,
  aheadM: number,
  estimateM: number,
): BusSimRegion | null {
  const lo = Math.min(beforeM, aheadM);
  const hi = Math.max(beforeM, aheadM);
  const est = Math.max(lo, Math.min(hi, estimateM));
  const before = pointAtDistance(track, cum, lo);
  const ahead = pointAtDistance(track, cum, hi);
  const estimate = pointAtDistance(track, cum, est);
  if (!before || !ahead || !estimate) return null;
  const path = slicePath(track, cum, lo, hi);
  if (path.length < 2) return null;
  return {
    id,
    before,
    ahead,
    estimate,
    path,
    flaggedStopSeqs: flaggedStops(before, ahead, stops),
    beforeM: lo,
    aheadM: hi,
    estimateM: est,
  };
}
