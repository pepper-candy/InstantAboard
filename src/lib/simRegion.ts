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
const ARRIVE_SLACK_M = 160;
const MIN_BAND_M = 72;
const CHEVRON_SPACING_M = 22;
const CHEVRON_INSET_M = 14;
const MAX_BUSES = 8;
/** Extra paint growth as a fraction of modelled speed while waiting for a poll. */
const EXPAND_FRAC = 0.45;
const EXPAND_STALE_FRAC = 0.9;
/** Stale extra cannot exceed this fraction of the painted half-width. */
const EXPAND_CAP_FRAC = 0.75;
/** Visible half-window around the estimate (not the 1 min ETA predict). */
const PAINT_HALF_S = 28;
const PAINT_HALF_S_FEEDER = 16;
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
  bandSpeedMs: number;
  horizonS: number;
  horizonM: number;
  /** Painted ±metres around the estimate (short; not `horizonM`). */
  paintHalfM: number;
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

/** Metres/second for the visible before↔ahead window (same pace as placement). */
export function bandSpeedMs(company: Company): number {
  return companySpeedMs(company);
}

export function bandHorizonM(company: Company): number {
  const minHalf = company === "lrtfeeder" ? 50 : 160;
  return Math.max(minHalf, bandSpeedMs(company) * etaHorizonS(company));
}

/** Short painted half-length around the estimate (~12 s of cruise). */
export function paintHalfM(company: Company): number {
  const feeder = company === "lrtfeeder";
  const lo = feeder ? 48 : 80;
  const hi = feeder ? 120 : 220;
  const raw = bandSpeedMs(company) * (feeder ? PAINT_HALF_S_FEEDER : PAINT_HALF_S);
  return Math.max(lo, Math.min(hi, raw));
}

/** Wider half-window when ETA is Due/到 so the bus stays visible for a beat. */
export function paintHalfMDue(company: Company): number {
  return Math.min(320, paintHalfM(company) * 1.6);
}

/**
 * Place the bus from ETA rows.
 * - flag = first stop with ETA > 0 (head target)
 * - dueHi = furthest Due/到 before flag (most-arrived)
 * - dueLo = earliest Due/到 before flag (snake tail must cover this)
 * - dist = 1‑min-style predict: flagDist − speed×tFlag, clamped to [dueHi, flag]
 */
function impliedDistance(
  clock: StopClock,
  atStop: number[],
  speedMs: number,
  now: number,
): {
  dist: number;
  floorDist: number;
  flagDist: number;
  dueLoDist: number;
  tFlag: number;
  allDue: boolean;
} | null {
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
  let dueHi = reachedMem;
  let dueLo = -1;
  const passed = clock.justPassed;
  if (passed != null) dueHi = Math.max(dueHi, passed);
  for (let i = 0; i < limit; i++) {
    if (flag >= 0 && i >= flag) break;
    if (!isDueLive(liveSeconds(clock, i, now))) continue;
    dueHi = Math.max(dueHi, i);
    if (dueLo < 0) dueLo = i;
  }
  if (flag >= 0 && dueHi >= flag) dueHi = flag - 1;
  if (dueLo > dueHi) dueLo = dueHi;

  if (flag < 0) {
    if (dueHi < 0 || dueHi >= atStop.length) return null;
    const at = atStop[dueHi];
    if (at == null) return null;
    const lo = dueLo >= 0 ? (atStop[dueLo] ?? at) : at;
    return {
      dist: at,
      floorDist: at,
      flagDist: at,
      dueLoDist: Math.min(lo, at),
      tFlag: 0,
      allDue: true,
    };
  }

  const flagDist = atStop[flag] ?? 0;
  const tFlag = Math.max(0, liveSeconds(clock, flag, now) ?? 0);
  let floorDist = 0;
  if (dueHi >= 0 && dueHi < flag) floorDist = atStop[dueHi] ?? 0;
  floorDist = Math.min(floorDist, flagDist);
  const dueLoDist =
    dueLo >= 0 && dueLo < flag ? Math.min(atStop[dueLo] ?? floorDist, floorDist) : floorDist;

  // 1‑min predict into the guessing buffer: metres left ≈ speed × seconds-to-flag.
  const raw = flagDist - speedMs * tFlag;
  const dist = Math.max(floorDist, Math.min(flagDist, raw));
  return { dist, floorDist, flagDist, dueLoDist, tFlag, allDue: false };
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
  const est = Number.isFinite(estimate) ? estimate : (before + ahead) / 2;
  const arriving = est >= flagDist - ARRIVE_SLACK_M;
  const loBound = Math.max(0, floorDist - slack);
  // 🚩 only when the estimate is actually on the stop. Otherwise keep hi off
  // the next ETA stop so a 2 min approach is not a bus→flag corridor.
  const hiBound = arriving
    ? Math.min(span, Math.max(flagDist + slack, terminus ? last + slack : flagDist + slack))
    : Math.min(span, Math.max(loBound + MIN_BAND_M, flagDist - STOP_GAP_M));
  const want = Math.max(MIN_BAND_M, Math.abs(ahead - before) || MIN_BAND_M);
  let lo = Math.max(loBound, Math.min(before, ahead));
  let hi = Math.min(hiBound, Math.max(before, ahead));
  // Keep the estimate inside by sliding the window, never by stretching it
  // out to a runaway coast / floor↔flag pair.
  if (est < lo) {
    lo = Math.max(loBound, est);
    hi = Math.min(hiBound, lo + want);
  } else if (est > hi) {
    hi = Math.min(hiBound, est);
    lo = Math.max(loBound, hi - want);
  }
  if (hi < lo + MIN_BAND_M) {
    const mid = Math.max(loBound, Math.min(hiBound, est));
    lo = Math.max(loBound, mid - MIN_BAND_M / 2);
    hi = Math.min(hiBound, lo + MIN_BAND_M);
    lo = Math.max(loBound, hi - MIN_BAND_M);
  }
  const minKeep = Math.max(MIN_BAND_M, (hi - lo) * 0.85);
  lo = nudgeEnd(lo, atStop, -1, loBound, hi - minKeep);
  hi = nudgeEnd(hi, atStop, 1, lo + minKeep, hiBound);
  if (hi < lo) {
    const mid = Math.max(loBound, Math.min(hiBound, est));
    lo = Math.max(loBound, mid - MIN_BAND_M / 2);
    hi = Math.min(hiBound, Math.max(lo + MIN_BAND_M, mid + MIN_BAND_M / 2));
  }
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
  const paintMCruise = paintHalfM(company);
  const paintMDue = paintHalfMDue(company);
  /** Treat flag as "arriving" inside one predict horizon (1 min for KMB/CTB). */
  const arrivingS = horizonS;

  for (const clock of clocks) {
    const implied = impliedDistance(clock, atStop, speedMs, now);
    if (!implied) continue;
    const id = uniqueId(used, clock.id);
    const prev = prevById.get(clock.id) ?? prevById.get(id);
    const dt = prev ? Math.max(0, (now - prev.fetchedAt) / 1000) : 0;
    const coast = prev ? prev.estimate0 + prev.speedMs * dt : implied.dist;
    // New implied may jump behind a coasting estimate when the minute ETA
    // does not drop; keep the orange dot from flipping behind the rider.
    // Cap that hold to one predict horizon; paint uses a much shorter half.
    let estimate0 = clamp(implied.dist, 0, total);
    if (prev && implied.dist < coast) {
      estimate0 = clamp(Math.min(coast, implied.dist + horizonM), 0, total);
    }
    const arriving =
      implied.allDue ||
      implied.tFlag <= arrivingS ||
      estimate0 >= implied.flagDist - ARRIVE_SLACK_M;
    const multiDue = implied.dueLoDist < implied.floorDist - 8;
    // Arriving: head sits on the flag stop. Multi-到: tail covers earliest due
    // so the snake spans previous arrived → arriving (not a short ±paint blob).
    let before0: number;
    let ahead0: number;
    let paintM: number;
    if (arriving) {
      paintM = paintMDue;
      ahead0 = implied.flagDist + ARRIVE_SLACK_M;
      before0 = multiDue
        ? implied.dueLoDist - ARRIVE_SLACK_M
        : Math.min(estimate0 - paintM, implied.floorDist - ARRIVE_SLACK_M);
      // Always cover the most-arrived stop (floor) as the near tail.
      before0 = Math.min(before0, implied.floorDist - STOP_GAP_M);
    } else {
      paintM = paintMCruise;
      before0 = estimate0 - paintM;
      ahead0 = estimate0 + paintM;
    }
    const carved = carveBand(
      before0,
      ahead0,
      implied.dueLoDist,
      implied.flagDist,
      atStop,
      estimate0,
      total,
    );
    cores.push({
      id,
      fetchedAt: now,
      speedMs,
      bandSpeedMs: uncertaintyMs,
      horizonS,
      horizonM,
      paintHalfM: paintM,
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
    const predictM = core.horizonM ?? growSpeed * core.horizonS;
    const paintM = core.paintHalfM ?? Math.min(110, predictM * 0.2);
    const extra = Math.min(paintM * EXPAND_CAP_FRAC, growSpeed * elapsed * frac);
    const coastEst = core.estimate0 + core.speedMs * elapsed;
    // Slide a short paint window with the coast. Do not use the 1 min predict
    // length as painted half-width (that reached the next stop at ETA 2).
    const half = paintM + extra;
    const grown = carveBand(
      coastEst - half,
      coastEst + half,
      core.floorDist,
      core.flagDist,
      core.atStop,
      coastEst,
      total,
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
