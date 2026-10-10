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

/** Prefer to keep bus-end glyphs off stop markers when the band still has width. */
export const STOP_GAP_M = 32;
/** Bus SVG is treated as covering a stop inside this radius. */
export const BUS_COVER_M = 38;
/** Allow the band onto / slightly past a stop so onboard GPS at the stop stays inside. */
const ARRIVE_SLACK_M = 90;
const MIN_BAND_M = 48;
const CHEVRON_SPACING_M = 22;
const CHEVRON_INSET_M = 14;
const MAX_BUSES = 8;
/** Extra band growth as a fraction of uncertainty speed while waiting for a poll. */
const EXPAND_FRAC = 0.45;
const EXPAND_STALE_FRAC = 0.9;
/** Urban pace used for ±1 min error width; placement still uses `companySpeedMs`. */
const BAND_FLOOR_KMH = 40;

export type SimCore = {
  id: string;
  fetchedAt: number;
  speedMs: number;
  bandSpeedMs: number;
  horizonS: number;
  horizonM: number;
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

/** Metres/second for the visible before↔ahead window (tighter for MTR Bus). */
export function bandSpeedMs(company: Company): number {
  const cruise = companySpeedMs(company);
  if (company === "lrtfeeder") return cruise;
  return Math.max(cruise, (BAND_FLOOR_KMH * 1000) / 3600);
}

export function bandHorizonM(company: Company): number {
  const minHalf = company === "lrtfeeder" ? 50 : 380;
  return Math.max(minHalf, bandSpeedMs(company) * etaHorizonS(company));
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

function lastStopDist(atStop: number[], total: number): number {
  if (!atStop.length) return total;
  return atStop[atStop.length - 1] ?? total;
}

function isTerminus(floorDist: number, flagDist: number, estimate: number, last: number): boolean {
  return flagDist >= last - 8 || floorDist >= last - 8 || estimate >= last - 8;
}

function nudgeEnd(at: number, stops: number[], dir: -1 | 1, min: number, max: number): number {
  let next = at;
  for (const stop of stops) {
    if (Math.abs(next - stop) >= STOP_GAP_M) continue;
    const shifted = dir < 0 ? stop - STOP_GAP_M : stop + STOP_GAP_M;
    if (shifted < min || shifted > max) continue;
    next = shifted;
  }
  return Math.max(min, Math.min(max, next));
}

/**
 * Clamp the band onto the track and keep a usable width through stops.
 * Ends may sit on a stop (🚩) rather than carving the corridor away from GPS.
 */
export function carveBand(
  before: number,
  ahead: number,
  floorDist: number,
  flagDist: number,
  atStop: number[],
  estimate: number,
  total = Number.POSITIVE_INFINITY,
  slackM = ARRIVE_SLACK_M,
): { before: number; ahead: number } {
  const last = lastStopDist(atStop, Number.isFinite(total) ? total : flagDist);
  const span = Number.isFinite(total) ? total : Math.max(flagDist, ahead, last);
  const terminus = isTerminus(floorDist, flagDist, estimate, last);
  const slack = Math.max(ARRIVE_SLACK_M, slackM);
  const loBound = Math.max(0, floorDist - slack);
  const hiBound = terminus ? Math.max(span, flagDist) : Math.min(span, Math.max(flagDist + slack, loBound));
  let lo = Math.max(loBound, Math.min(before, ahead));
  let hi = Math.min(hiBound, Math.max(before, ahead));
  if (hi < lo + MIN_BAND_M) {
    const mid = Math.max(loBound, Math.min(hiBound, estimate));
    lo = Math.max(loBound, mid - MIN_BAND_M / 2);
    hi = Math.min(hiBound, lo + MIN_BAND_M);
    lo = Math.max(loBound, hi - MIN_BAND_M);
  }
  const minKeep = Math.max(MIN_BAND_M, (hi - lo) * 0.85);
  lo = nudgeEnd(lo, atStop, -1, loBound, hi - minKeep);
  hi = nudgeEnd(hi, atStop, 1, lo + minKeep, hiBound);
  lo = Math.min(lo, estimate);
  hi = Math.max(hi, estimate);
  if (hi < lo) return { before: loBound, ahead: Math.max(loBound + MIN_BAND_M, hiBound) };
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

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
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
  const uncertaintyMs = bandSpeedMs(company);
  const horizonS = etaHorizonS(company);
  const horizonM = bandHorizonM(company);

  for (const clock of clocks) {
    const implied = impliedDistance(clock, atStop, speedMs, now);
    if (!implied) continue;
    const id = uniqueId(used, clock.id);
    const prev = prevById.get(clock.id) ?? prevById.get(id);
    const dt = prev ? Math.max(0, (now - prev.fetchedAt) / 1000) : 0;
    const coast = prev ? prev.estimate0 + prev.speedMs * dt : implied.dist;
    // New implied may jump behind a coasting estimate when the minute ETA
    // does not drop; keep the orange dot from flipping behind the rider and
    // let the band span both so the true bus stays inside.
    let estimate0 = clamp(implied.dist, 0, total);
    if (prev && implied.dist < coast) {
      estimate0 = clamp(Math.min(coast, implied.dist + horizonM), 0, total);
    }
    const before0 = Math.min(estimate0, coast, implied.dist) - horizonM;
    const ahead0 = Math.max(estimate0, coast, implied.dist) + horizonM;
    const carved = carveBand(
      before0,
      ahead0,
      implied.floorDist,
      implied.flagDist,
      atStop,
      estimate0,
      total,
      horizonM,
    );
    cores.push({
      id,
      fetchedAt: now,
      speedMs,
      bandSpeedMs: uncertaintyMs,
      horizonS,
      horizonM,
      impliedDist: implied.dist,
      estimate0: clamp(estimate0, carved.before, carved.ahead),
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
  const total = cum[cum.length - 1] ?? 0;
  const regions: BusSimRegion[] = [];
  const frac = stale ? EXPAND_STALE_FRAC : EXPAND_FRAC;

  for (const core of cores) {
    const elapsed = Math.max(0, (now - core.fetchedAt) / 1000);
    const growSpeed = core.bandSpeedMs ?? core.speedMs;
    const capM = core.horizonM ?? growSpeed * core.horizonS;
    const extra = Math.min(capM, growSpeed * elapsed * frac);
    const coastEst = core.estimate0 + core.speedMs * elapsed;
    const grown = carveBand(
      core.before0 - extra,
      core.ahead0 + extra,
      core.floorDist,
      core.flagDist,
      core.atStop,
      coastEst,
      total,
      capM,
    );
    const estimateDist = clamp(coastEst, grown.before, grown.ahead);
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
    });
  }
  return regions;
}
