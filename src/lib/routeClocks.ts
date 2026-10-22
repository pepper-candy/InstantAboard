import { mtrLineCode } from "./colors";
import { mtrDestCode } from "./mtrBranches";
import type { MtrLineGraph } from "./mtrLineGraph";
import type { Company, RouteListEntry } from "./types";

/** Same rules as `parseLooseMinutes` in eta.ts (LRT time_en / time_ch). */
function parseLrtMinutes(text: string): number | null {
  if (!text) return null;
  if (/arriv|到/i.test(text) && !/\d/.test(text)) return 0;
  const m = text.match(/(\d+)/);
  if (!m) return null;
  return Number(m[1]);
}

/**
 * Seconds from each row's data_timestamp until arrival.
 * Negative means that stop is already Due.
 * Placement and Due checks should use `liveSeconds`, not this raw value —
 * Citybus stamps are often 1–2 min old, so stamp-relative seconds still look
 * like an approach after the board already shows 到.
 */
export type StopClock = {
  id: string;
  seconds: Array<number | null>;
  /** data_timestamp (ms), aligned with `seconds`. */
  stamps: Array<number | null>;
  /** Mean of recent ETA-drop / real-time ratios, in 0–1.2. 1 until two polls exist. */
  progress?: number;
  /** Stop whose ETA vanished on this poll; the bus has just passed it. */
  justPassed?: number | null;
  /** When that pass happened, in ms. Null when `justPassed` is unset. */
  passedAt?: number | null;
  /**
   * Furthest stop this bus is already known to have passed. -1 if none.
   * Stays set after that stop stops saying Due and shows the next bus.
   */
  reached?: number;
  /** MTR Next Train direction. */
  bound?: "UP" | "DOWN";
  /** Place on the reversed stop/track order (the bound opposite the open route). */
  reverse?: boolean;
  /** MTR destination station code (e.g. LOW, LMC, RAC) when known. */
  dest?: string;
};

/** Wall-clock seconds until arrival. Null when that stop has no ETA on this bus. */
export function liveSeconds(clock: Pick<StopClock, "seconds" | "stamps">, index: number, now = Date.now()): number | null {
  const sec = clock.seconds[index];
  if (sec == null) return null;
  const stamp = clock.stamps[index];
  if (stamp == null || !Number.isFinite(stamp)) return sec;
  return (stamp + sec * 1000 - now) / 1000;
}

export function isDueLive(sec: number | null): boolean {
  return sec != null && sec <= 0;
}

type Hit = { seq: number; seconds: number; etaMs: number; stampMs: number };

const POLL_HISTORY = 4;
const PROGRESS_MAX = 1.2;

/** One accepted ETA snapshot for a linked bus. */
export type BusPoll = {
  seconds: Array<number | null>;
  stamps: Array<number | null>;
};

/** Last few polls for the buses on a route, aligned with the previous board. */
export type BusMemory = {
  polls: BusPoll[];
  reached: number;
};

const NOT_OUT = /未開出|未开出|scheduled|not yet departed/i;

function boundLetter(bound?: string): string {
  return (bound ?? "O").slice(0, 1).toUpperCase();
}

function boundSeq(bound?: string): number {
  const b = (bound ?? "").toUpperCase();
  if (b.startsWith("I") || b.includes("DT")) return 2;
  return 1;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

async function pool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  if (!items.length) return;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      await fn(item, index);
    }
  });
  await Promise.all(workers);
}

function readStamp(value: string | null | undefined, fallback: number): number {
  if (value) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return fallback;
}

function pushHit(hits: Hit[], seq: number, iso: string | null | undefined, remark: string, stampMs: number): void {
  if (!iso || NOT_OUT.test(remark) || !Number.isFinite(stampMs)) return;
  const etaMs = Date.parse(iso);
  if (!Number.isFinite(etaMs)) return;
  const seconds = (etaMs - stampMs) / 1000;
  if (seconds < -15 * 60 || seconds > 90 * 60) return;
  hits.push({ seq, seconds, etaMs, stampMs });
}

/**
 * Chain stop ETAs into vehicles. eta_seq is per stop, so a bus is the run of
 * increasing timestamps, not a shared sequence number.
 */
export function linkBuses(hits: Hit[], stopCount: number): StopClock[] {
  const sorted = [...hits].sort((a, b) => a.seq - b.seq || a.seconds - b.seconds);
  const buses: { lastSeq: number; lastSec: number; id: string; seconds: Array<number | null>; stamps: Array<number | null> }[] = [];
  for (const hit of sorted) {
    if (hit.seq < 0 || hit.seq >= stopCount) continue;
    if (buses.some((bus) => {
      const have = bus.seconds[hit.seq];
      return have != null && Math.abs(have - hit.seconds) < 20;
    })) {
      continue;
    }
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < buses.length; i++) {
      const bus = buses[i];
      if (!bus) continue;
      const gap = hit.seq - bus.lastSeq;
      if (gap < 1 || gap > 3) continue;
      const dt = hit.seconds - bus.lastSec;
      if (dt < -45) continue;
      const score = gap * 1_000_000 + Math.abs(dt);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) {
      const seconds = Array<number | null>(stopCount).fill(null);
      const stamps = Array<number | null>(stopCount).fill(null);
      seconds[hit.seq] = hit.seconds;
      stamps[hit.seq] = hit.stampMs;
      buses.push({
        lastSeq: hit.seq,
        lastSec: hit.seconds,
        id: `${hit.seq}:${Math.round(hit.etaMs / 120000)}`,
        seconds,
        stamps,
      });
    } else {
      const bus = buses[best];
      if (!bus) continue;
      bus.seconds[hit.seq] = hit.seconds;
      bus.stamps[hit.seq] = hit.stampMs;
      bus.lastSeq = hit.seq;
      bus.lastSec = hit.seconds;
    }
  }
  return buses
    .map((bus) => ({ id: bus.id, seconds: bus.seconds, stamps: bus.stamps }))
    .filter((bus) => bus.seconds.some((value) => value != null && value > -10 * 60))
    .sort((a, b) => {
      const aFlag = a.seconds.find((value) => value != null && value > 0) ?? 9e9;
      const bFlag = b.seconds.find((value) => value != null && value > 0) ?? 9e9;
      return aFlag - bFlag;
    });
}

function firstPositive(clock: StopClock, now = Date.now()): number {
  return firstPositiveFrom(clock, 0, now);
}

function absEta(clock: StopClock, index: number): number | null {
  const sec = clock.seconds[index];
  const stamp = clock.stamps[index];
  if (sec == null || stamp == null) return null;
  return stamp + sec * 1000;
}

function sameSnapshot(a: StopClock, b: StopClock): boolean {
  const n = Math.max(a.seconds.length, b.seconds.length);
  for (let i = 0; i < n; i++) {
    const aSec = a.seconds[i] ?? null;
    const bSec = b.seconds[i] ?? null;
    if ((aSec == null) !== (bSec == null)) return false;
    if (aSec == null || bSec == null) continue;
    if (Math.abs(aSec - bSec) > 1) return false;
    if ((a.stamps[i] ?? null) !== (b.stamps[i] ?? null)) return false;
  }
  return true;
}

function firstPositiveFrom(clock: StopClock, start: number, now = Date.now()): number {
  for (let i = Math.max(0, start); i < clock.seconds.length; i++) {
    const value = liveSeconds(clock, i, now);
    if (value != null && value > 0) return i;
  }
  return -1;
}

/** Highest stop that had an ETA last poll and does not have one now, before the next stop. */
function vanishedStop(prev: StopClock, next: StopClock, flag = firstPositive(next)): number | null {
  let passed = -1;
  const n = Math.max(prev.seconds.length, next.seconds.length);
  for (let i = 0; i < n; i++) {
    if (prev.seconds[i] == null || next.seconds[i] != null) continue;
    if (flag >= 0 && i >= flag) continue;
    passed = i;
  }
  return passed >= 0 ? passed : null;
}

function nextReached(current: number, prev: StopClock | null, next: StopClock, now = Date.now()): number {
  const rawFlag = firstPositive(next, now);
  // A was Due, so this bus is already there. The new future time at A is the next bus.
  // Keep the passed-stop flag, otherwise a long ETA at B draws this bus back before A.
  const rawLive = rawFlag >= 0 ? liveSeconds(next, rawFlag, now) : null;
  const held = rawFlag >= 0 && rawFlag === current && rawLive != null && rawLive > 0;
  const flag = held ? firstPositiveFrom(next, current + 1, now) : rawFlag;
  let reached = current;
  const reachedLive = reached >= 0 ? liveSeconds(next, reached, now) : null;
  if (!held && ((flag >= 0 && reached >= flag) || (reached >= 0 && reachedLive != null && !isDueLive(reachedLive)))) {
    reached = -1;
  }
  if (prev) {
    const vanished = vanishedStop(prev, next, flag);
    if (vanished != null) reached = Math.max(reached, vanished);
  }
  for (let i = 0; i < next.seconds.length; i++) {
    if (flag >= 0 && i >= flag) break;
    const sec = liveSeconds(next, i, now);
    if (isDueLive(sec)) reached = Math.max(reached, i);
  }
  if (flag >= 0 && reached >= flag) reached = flag - 1;
  return reached;
}

function progressAt(polls: BusPoll[], stop: number): number {
  const recent = polls.slice(-POLL_HISTORY);
  let sum = 0;
  let count = 0;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const cur = recent[i];
    if (!prev || !cur) continue;
    const sec0 = prev.seconds[stop];
    const sec1 = cur.seconds[stop];
    const t0 = prev.stamps[stop];
    const t1 = cur.stamps[stop];
    if (sec0 == null || sec1 == null || t0 == null || t1 == null) continue;
    if (sec0 <= 0 || sec1 <= 0) continue;
    const real = (t1 - t0) / 1000;
    if (!(real > 5)) continue;
    sum += Math.min(PROGRESS_MAX, Math.max(0, (sec0 - sec1) / real));
    count++;
  }
  if (!count) return 1;
  const avg = sum / count;
  return avg < 0.05 ? 0 : avg;
}

function overlapScore(a: StopClock, b: StopClock): number {
  let matches = 0;
  let penalty = 0;
  const n = Math.min(a.seconds.length, b.seconds.length);
  for (let i = 0; i < n; i++) {
    const left = absEta(a, i);
    const right = absEta(b, i);
    if (left == null || right == null) continue;
    const diff = Math.abs(left - right);
    if (diff > 180_000) continue;
    matches++;
    penalty += diff;
  }
  if (!matches) return Infinity;
  if (a.bound && b.bound && a.bound !== b.bound) return Infinity;
  // Branch routing: trains bound for different termini are never the same train.
  if (a.dest && b.dest && a.dest !== b.dest) return Infinity;
  return penalty / matches - matches * 100_000 - (a.id === b.id ? 50_000 : 0);
}

function matchIndexes(previous: StopClock[], incoming: StopClock[]): number[] {
  const pairs: { incoming: number; prev: number; score: number }[] = [];
  for (let i = 0; i < incoming.length; i++) {
    const clock = incoming[i];
    if (!clock) continue;
    for (let p = 0; p < previous.length; p++) {
      const other = previous[p];
      if (!other) continue;
      const score = overlapScore(other, clock);
      if (score < 1e8) pairs.push({ incoming: i, prev: p, score });
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  const usedIn = new Set<number>();
  const usedPrev = new Set<number>();
  const match = Array<number>(incoming.length).fill(-1);
  for (const pair of pairs) {
    if (usedIn.has(pair.incoming) || usedPrev.has(pair.prev)) continue;
    usedIn.add(pair.incoming);
    usedPrev.add(pair.prev);
    match[pair.incoming] = pair.prev;
  }
  return match;
}

function passInstant(prev: StopClock, index: number): number | null {
  const sec = prev.seconds[index];
  const stamp = prev.stamps[index];
  if (sec == null || stamp == null) return null;
  return Math.min(Date.now(), stamp + sec * 1000);
}

function remember(clock: StopClock, mem: BusMemory, prev: StopClock | null, now = Date.now()): { clock: StopClock; memory: BusMemory } {
  const polls = mem.polls.slice(-(POLL_HISTORY - 1));
  polls.push({ seconds: clock.seconds.slice(), stamps: clock.stamps.slice() });
  const reached = nextReached(mem.reached, prev, clock, now);
  const flag = firstPositiveFrom(clock, reached + 1, now);
  const justPassed = prev ? vanishedStop(prev, clock, flag) : null;
  return {
    clock: {
      id: clock.id,
      seconds: clock.seconds,
      stamps: clock.stamps,
      progress: flag >= 0 ? progressAt(polls, flag) : 0,
      justPassed,
      passedAt: prev && justPassed != null ? passInstant(prev, justPassed) : null,
      reached,
      bound: clock.bound ?? prev?.bound,
      reverse: clock.reverse ?? prev?.reverse,
      dest: clock.dest ?? prev?.dest,
    },
    memory: { polls, reached },
  };
}

/**
 * Fold one ETA poll into the previous board.
 * A bus whose data_timestamp values are unchanged is not a new observation.
 */
export function absorbPoll(
  previous: StopClock[],
  incoming: StopClock[],
  memory: BusMemory[],
): { clocks: StopClock[]; memory: BusMemory[]; changed: boolean } {
  const match = matchIndexes(previous, incoming);
  const clocks: StopClock[] = [];
  const nextMemory: BusMemory[] = [];
  let changed = incoming.length !== previous.length;
  const used = new Set<number>();

  for (let i = 0; i < incoming.length; i++) {
    const clock = incoming[i];
    if (!clock) continue;
    const index = match[i] ?? -1;
    if (index < 0) {
      changed = true;
      const created = remember(clock, { polls: [], reached: -1 }, null);
      clocks.push(created.clock);
      nextMemory.push(created.memory);
      continue;
    }
    used.add(index);
    const prev = previous[index];
    const mem = memory[index] ?? { polls: [], reached: prev?.reached ?? -1 };
    if (prev && sameSnapshot(prev, clock)) {
      const now = Date.now();
      const reached = nextReached(mem.reached, prev, prev, now);
      const flag = firstPositiveFrom(prev, reached + 1, now);
      if (reached !== (prev.reached ?? -1)) changed = true;
      clocks.push({
        ...prev,
        reached,
        progress: flag >= 0 ? progressAt(mem.polls, flag) : prev.progress,
      });
      nextMemory.push({ ...mem, reached });
      continue;
    }
    changed = true;
    const created = remember({ ...clock, id: prev?.id ?? clock.id }, mem, prev ?? null);
    clocks.push(created.clock);
    nextMemory.push(created.memory);
  }

  if (used.size !== previous.length) changed = true;
  if (!changed) return { clocks: previous, memory, changed: false };
  return { clocks, memory: nextMemory, changed };
}

async function fetchKmb(route: RouteListEntry, stopCount: number): Promise<StopClock[]> {
  const service = route.serviceType || "1";
  const bound = boundLetter(route.bound.kmb);
  const url = `https://data.etabus.gov.hk/v1/transport/kmb/route-eta/${encodeURIComponent(route.route)}/${encodeURIComponent(service)}`;
  const json = await getJson<{
    generated_timestamp?: string;
    data?: Array<{
      dir?: string;
      seq?: number;
      eta?: string | null;
      service_type?: number | string;
      rmk_en?: string;
      rmk_tc?: string;
      data_timestamp?: string;
    }>;
  }>(url);
  const hits: Hit[] = [];
  const fallback = readStamp(json.generated_timestamp, Date.now());
  for (const row of json.data ?? []) {
    if (row.service_type != null && String(row.service_type) !== String(service)) continue;
    if (row.dir && row.dir.slice(0, 1).toUpperCase() !== bound) continue;
    if (typeof row.seq !== "number") continue;
    pushHit(hits, row.seq - 1, row.eta, `${row.rmk_en ?? ""} ${row.rmk_tc ?? ""}`, readStamp(row.data_timestamp, fallback));
  }
  return linkBuses(hits, stopCount);
}

async function fetchCtb(route: RouteListEntry, stopIds: string[]): Promise<StopClock[]> {
  const bound = boundLetter(route.bound.ctb);
  const hits: Hit[] = [];
  await pool(stopIds, 6, async (stopId, index) => {
    try {
      const json = await getJson<{
        generated_timestamp?: string;
        data?: Array<{ dir?: string; seq?: number; eta?: string | null; rmk_en?: string; rmk_tc?: string; data_timestamp?: string }>;
      }>(`https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${encodeURIComponent(stopId)}/${encodeURIComponent(route.route)}`);
      const fallback = readStamp(json.generated_timestamp, Date.now());
      const rows = (json.data ?? []).filter((row) => !row.dir || row.dir.slice(0, 1).toUpperCase() === bound);
      const nearest = rows.reduce<number | null>((best, row) => {
        if (typeof row.seq !== "number") return best;
        if (best == null) return row.seq;
        return Math.abs(row.seq - (index + 1)) < Math.abs(best - (index + 1)) ? row.seq : best;
      }, null);
      for (const row of rows) {
        if (nearest != null && row.seq != null && row.seq !== nearest) continue;
        pushHit(hits, index, row.eta, `${row.rmk_en ?? ""} ${row.rmk_tc ?? ""}`, readStamp(row.data_timestamp, fallback));
      }
    } catch {
      /* one stop failing leaves a gap the linker can skip */
    }
  });
  return linkBuses(hits, stopIds.length);
}

async function fetchGmb(route: RouteListEntry, stopCount: number): Promise<StopClock[]> {
  const routeId = route.gtfsId;
  if (!routeId) return [];
  const routeSeq = boundSeq(route.bound.gmb);
  const hits: Hit[] = [];
  const indexes = Array.from({ length: stopCount }, (_, index) => index);
  await pool(indexes, 6, async (index) => {
    try {
      const json = await getJson<{
        generated_timestamp?: string;
        data?: { eta?: Array<{ timestamp?: string; data_timestamp?: string; remarks_en?: string | null; remarks_tc?: string | null }> };
      }>(`https://data.etagmb.gov.hk/eta/route-stop/${encodeURIComponent(routeId)}/${routeSeq}/${index + 1}`);
      const fallback = readStamp(json.generated_timestamp, Date.now());
      for (const row of json.data?.eta ?? []) {
        pushHit(hits, index, row.timestamp, `${row.remarks_en ?? ""} ${row.remarks_tc ?? ""}`, readStamp(row.data_timestamp, fallback));
      }
    } catch {
      /* gap */
    }
  });
  return linkBuses(hits, stopCount);
}

async function fetchNlb(route: RouteListEntry, stopIds: string[]): Promise<StopClock[]> {
  const routeId = route.nlbId;
  if (!routeId) return [];
  const hits: Hit[] = [];
  await pool(stopIds, 4, async (stopId, index) => {
    try {
      const json = await getJson<{
        generated_timestamp?: string;
        estimatedArrivals?: Array<{ estimatedArrivalTime?: string; departed?: number; data_timestamp?: string; generateTime?: string }>;
      }>(
        `https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrival&routeId=${encodeURIComponent(routeId)}&stopId=${encodeURIComponent(stopId)}&language=en`,
      );
      const fallback = readStamp(json.generated_timestamp, Date.now());
      for (const row of json.estimatedArrivals ?? []) {
        if (row.departed) continue;
        pushHit(hits, index, row.estimatedArrivalTime, "", readStamp(row.data_timestamp ?? row.generateTime, fallback));
      }
    } catch {
      /* gap */
    }
  });
  return linkBuses(hits, stopIds.length);
}

export async function fetchRouteClocks(
  company: Company,
  route: RouteListEntry,
  stopIds: string[],
): Promise<StopClock[]> {
  if (stopIds.length < 2) return [];
  switch (company) {
    case "kmb":
      return fetchKmb(route, stopIds.length);
    case "ctb":
      return fetchCtb(route, stopIds);
    case "gmb":
      return fetchGmb(route, stopIds.length);
    case "nlb":
      return fetchNlb(route, stopIds);
    case "mtr":
      return fetchMtr(route, stopIds);
    case "lightRail":
      return fetchLightRail(route, stopIds);
    case "lrtfeeder":
      return fetchMtrBus(route, stopIds);
    default:
      return [];
  }
}

function matchFeederStop(busStopId: string, stopIds: string[]): number {
  const exact = stopIds.indexOf(busStopId);
  if (exact >= 0) return exact;
  for (let i = 0; i < stopIds.length; i++) {
    const id = stopIds[i] ?? "";
    if (id.endsWith(busStopId) || busStopId.endsWith(id)) return i;
  }
  return -1;
}

/** One POST for the whole MTR Bus / Feeder route — fetch once, then link. */
async function fetchMtrBus(route: RouteListEntry, stopIds: string[]): Promise<StopClock[]> {
  const res = await fetch("https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "en", routeName: route.route.replace(/\*/g, "") }),
  });
  if (!res.ok) throw new Error(`mtr bus ${res.status}`);
  const json = (await res.json()) as {
    busStop?: Array<{
      busStopId?: string;
      bus?: Array<{
        departureTimeInSecond?: string;
        arrivalTimeInSecond?: string;
        isScheduled?: string;
      }>;
    }>;
  };
  const stampMs = Date.now();
  const hits: Hit[] = [];
  for (const stop of json.busStop ?? []) {
    if (!stop.busStopId) continue;
    const seq = matchFeederStop(stop.busStopId, stopIds);
    if (seq < 0) continue;
    for (const bus of stop.bus ?? []) {
      const sec = Number(bus.departureTimeInSecond ?? bus.arrivalTimeInSecond ?? NaN);
      if (!Number.isFinite(sec) || sec < -15 * 60 || sec > 90 * 60) continue;
      const etaMs = stampMs + sec * 1000;
      hits.push({ seq, seconds: sec, etaMs, stampMs });
    }
  }
  return linkBuses(hits, stopIds.length);
}

type MtrHit = Hit & { dest: string };

type MtrTrainRow = {
  dest?: string;
  ttnt?: string | number;
  time?: string;
  valid?: string;
};

function mtrRouteDir(bound?: string): "UP" | "DOWN" {
  const b = (bound ?? "").toUpperCase();
  return b.includes("DT") ? "DOWN" : "UP";
}

function parseMtrStamp(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const iso = value.trim().replace(" ", "T");
  const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}+08:00`;
  const ms = Date.parse(withTz);
  return Number.isFinite(ms) ? ms : fallback;
}

function pushMtrHit(hits: MtrHit[], seq: number, row: MtrTrainRow, stampMs: number): void {
  if (row.valid && row.valid.toUpperCase() === "N") return;
  const dest = (row.dest ?? "").toUpperCase();
  const fromTtnt = Number(row.ttnt);
  const etaFromTime = parseMtrStamp(row.time, Number.NaN);
  let etaMs: number;
  if (Number.isFinite(etaFromTime)) etaMs = etaFromTime;
  else if (Number.isFinite(fromTtnt)) etaMs = stampMs + Math.max(0, fromTtnt) * 60_000;
  else return;
  const seconds = (etaMs - stampMs) / 1000;
  if (seconds < -15 * 60 || seconds > 90 * 60) return;
  hits.push({ seq, seconds, etaMs, stampMs, dest });
}

/**
 * Chain per-station Next Train rows into vehicles. A train's ETA at station
 * n+1 should be later than at n by about the inter-station run time.
 */
export function linkMtrTrains(hits: MtrHit[], stopCount: number): StopClock[] {
  const sorted = [...hits].sort((a, b) => a.seq - b.seq || a.seconds - b.seconds);
  const trains: {
    lastSeq: number;
    lastSec: number;
    dest: string;
    id: string;
    seconds: Array<number | null>;
    stamps: Array<number | null>;
  }[] = [];
  for (const hit of sorted) {
    if (hit.seq < 0 || hit.seq >= stopCount) continue;
    if (
      trains.some((train) => {
        const have = train.seconds[hit.seq];
        return have != null && Math.abs(have - hit.seconds) < 25;
      })
    ) {
      continue;
    }
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < trains.length; i++) {
      const train = trains[i];
      if (!train) continue;
      const gap = hit.seq - train.lastSeq;
      if (gap < 1 || gap > 2) continue;
      const dt = hit.seconds - train.lastSec;
      if (dt < -25 || dt > gap * 8 * 60) continue;
      if (train.dest && hit.dest && train.dest !== hit.dest) continue;
      const destBonus = train.dest && hit.dest && train.dest === hit.dest ? -500_000 : 0;
      const score = gap * 1_000_000 + Math.abs(dt - 150 * gap) + destBonus;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) {
      const seconds = Array<number | null>(stopCount).fill(null);
      const stamps = Array<number | null>(stopCount).fill(null);
      seconds[hit.seq] = hit.seconds;
      stamps[hit.seq] = hit.stampMs;
      trains.push({
        lastSeq: hit.seq,
        lastSec: hit.seconds,
        dest: hit.dest,
        id: `${hit.dest || "x"}:${hit.seq}:${Math.round(hit.etaMs / 60_000)}`,
        seconds,
        stamps,
      });
    } else {
      const train = trains[best];
      if (!train) continue;
      train.seconds[hit.seq] = hit.seconds;
      train.stamps[hit.seq] = hit.stampMs;
      train.lastSeq = hit.seq;
      train.lastSec = hit.seconds;
      if (!train.dest && hit.dest) train.dest = hit.dest;
    }
  }
  return trains
    .map((train) => ({
      id: train.id,
      seconds: train.seconds,
      stamps: train.stamps,
      dest: train.dest || undefined,
    }))
    .filter((train) => train.seconds.some((value) => value != null && value > -10 * 60))
    .sort((a, b) => {
      const aFlag = a.seconds.find((value) => value != null && value > 0) ?? 9e9;
      const bFlag = b.seconds.find((value) => value != null && value > 0) ?? 9e9;
      return aFlag - bFlag;
    });
}

async function fetchMtr(route: RouteListEntry, stopIds: string[]): Promise<StopClock[]> {
  const line = mtrLineCode(route.route);
  const alongDir = mtrRouteDir(route.bound.mtr);
  const alongHits: MtrHit[] = [];
  await pool(stopIds, 6, async (stopId, index) => {
    const sta = stopId.replace(/^mtr:/i, "").toUpperCase();
    try {
      const json = await getJson<{
        sys_time?: string;
        curr_time?: string;
        data?: Record<string, { UP?: MtrTrainRow[]; DOWN?: MtrTrainRow[]; curr_time?: string; sys_time?: string }>;
      }>(`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(sta)}`);
      const key = `${line}-${sta}`;
      const block = json.data?.[key] ?? Object.values(json.data ?? {})[0];
      const stampMs = parseMtrStamp(block?.curr_time ?? json.curr_time ?? block?.sys_time ?? json.sys_time, Date.now());
      const along = alongDir === "UP" ? block?.UP : block?.DOWN;
      for (const row of along ?? []) pushMtrHit(alongHits, index, row, stampMs);
    } catch {
      /* one station failing leaves a gap the linker can skip */
    }
  });
  return linkMtrTrains(alongHits, stopIds.length).map((clock) => ({
    ...clock,
    id: `${alongDir}:${clock.id}`,
    bound: alongDir,
    reverse: false,
  }));
}

function normMtrClockStop(stopId: string): string {
  return stopId.replace(/^mtr:/i, "").toUpperCase();
}

/**
 * Drop phantom chains left over from merge-direction (DOWN) linking, where
 * rows at shared stations feed both arms' linkers. A chain without a hit at
 * its own terminus that matches another arm's chain is a duplicate of that
 * train, not a second train. Real trains keep their terminus hits; a phantom
 * matching a real train is dropped, and when both sides are phantoms the
 * main arm's copy survives.
 */
export function dedupeMergedArmClocks(
  arms: Array<{ key: string; main: boolean; stopIds: string[]; clocks: StopClock[] }>,
): StopClock[] {
  const mainArm = arms.find((arm) => arm.main) ?? arms[0];
  if (!mainArm || arms.length < 2) return arms.flatMap((arm) => arm.clocks);
  const others = arms.filter((arm) => arm !== mainArm);
  const overlap = (a: StopClock, idsA: string[], b: StopClock, idsB: string[]): boolean => {
    const n = Math.min(a.seconds.length, b.seconds.length);
    for (let i = 0; i < n; i++) {
      if (idsA[i] !== idsB[i]) continue;
      const secA = a.seconds[i];
      const secB = b.seconds[i];
      if (secA == null || secB == null) continue;
      const etaA = (a.stamps[i] ?? 0) + secA * 1000;
      const etaB = (b.stamps[i] ?? 0) + secB * 1000;
      if (Math.abs(etaA - etaB) <= 3000) return true;
    }
    return false;
  };
  const hasTerminus = (clock: StopClock) => clock.seconds[0] != null;
  const mainClocks = mainArm.clocks;
  const mainKept: StopClock[] = [];
  const otherKept: StopClock[] = [];
  for (const clock of mainClocks) {
    if (hasTerminus(clock)) {
      mainKept.push(clock);
      continue;
    }
    const twin = others.some((arm) =>
      arm.clocks.some((other) => hasTerminus(other) && overlap(clock, mainArm.stopIds, other, arm.stopIds)),
    );
    if (!twin) mainKept.push(clock);
  }
  for (const arm of others) {
    for (const clock of arm.clocks) {
      const twin =
        !hasTerminus(clock) && mainClocks.some((other) => overlap(clock, arm.stopIds, other, mainArm.stopIds));
      if (!twin) otherKept.push(clock);
    }
  }
  return [...mainKept, ...otherKept];
}

/**
 * Poll every station on a branched MTR line once and link trains per arm.
 * UP (peel): each row's `dest` picks the arm, so trains route to Lo Wu /
 * Lok Ma Chau / Po Lam / LOHAS Park cleanly. DOWN (merge): rows only say
 * ADM/NOP, so rows at arm-only stations pin their arm and rows at shared
 * stations feed every arm containing the station; `dedupeMergedArmClocks`
 * then removes the phantom chains. Racecourse rows (dest RAC) are always
 * dest-routed and never duplicated.
 */
export async function fetchMtrBranchClocks(route: RouteListEntry, graph: MtrLineGraph): Promise<StopClock[]> {
  const line = mtrLineCode(route.route);
  const alongDir = mtrRouteDir(route.bound.mtr);
  const merge = alongDir === "DOWN";
  const armDefs = graph.arms.map((arm) => ({
    key: arm.key,
    main: arm.main,
    racecourse: arm.racecourse,
    stopIds: arm.stopIds.map(normMtrClockStop),
  }));
  const byKey = new Map(armDefs.map((arm) => [arm.key, arm]));
  const wantKey = mtrDestCode(route.dest);
  const fallback = armDefs.find((arm) => arm.key === wantKey) ?? armDefs.find((arm) => arm.main) ?? armDefs[0];
  if (!fallback) return [];
  const codes = new Set<string>();
  for (const arm of armDefs) for (const id of arm.stopIds) codes.add(id);
  const staged: Array<{ code: string; hit: MtrHit }> = [];
  await pool([...codes], 6, async (code) => {
    try {
      const json = await getJson<{
        sys_time?: string;
        curr_time?: string;
        data?: Record<string, { UP?: MtrTrainRow[]; DOWN?: MtrTrainRow[]; curr_time?: string; sys_time?: string }>;
      }>(`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(code)}`);
      const key = `${line}-${code}`;
      const block = json.data?.[key] ?? Object.values(json.data ?? {})[0];
      const stampMs = parseMtrStamp(block?.curr_time ?? json.curr_time ?? block?.sys_time ?? json.sys_time, Date.now());
      const along = alongDir === "UP" ? block?.UP : block?.DOWN;
      for (const row of along ?? []) {
        const hits: MtrHit[] = [];
        pushMtrHit(hits, -1, row, stampMs);
        for (const hit of hits) staged.push({ code, hit });
      }
    } catch {
      /* one station failing leaves a gap the linker can skip */
    }
  });
  const perArm = new Map<string, MtrHit[]>(armDefs.map((arm) => [arm.key, []]));
  for (const { code, hit } of staged) {
    const destKey = mtrDestCode(hit.dest);
    const target =
      destKey && byKey.has(destKey)
        ? [byKey.get(destKey)!]
        : merge
          ? armDefs.filter((arm) => arm.stopIds.includes(code))
          : [fallback];
    for (const arm of target) {
      const seq = arm.stopIds.indexOf(code);
      if (seq < 0) continue;
      perArm.get(arm.key)?.push({ ...hit, seq });
    }
  }
  const linked: StopClock[] = [];
  const mergeArms: Array<{ key: string; main: boolean; stopIds: string[]; clocks: StopClock[] }> = [];
  const raceClocks: StopClock[] = [];
  const regularCount = armDefs.filter((arm) => !arm.racecourse).length;
  for (const arm of armDefs) {
    const clocks = linkMtrTrains(perArm.get(arm.key) ?? [], arm.stopIds.length).map((clock) => ({
      ...clock,
      id: `${alongDir}:${arm.key}:${clock.id}`,
      bound: alongDir,
      reverse: false,
      dest: arm.key,
    }));
    if (arm.racecourse) {
      raceClocks.push(...clocks);
    } else if (merge && regularCount > 1) {
      mergeArms.push({ key: arm.key, main: arm.main, stopIds: arm.stopIds, clocks });
    } else {
      linked.push(...clocks);
    }
  }
  const regular = mergeArms.length > 1 ? dedupeMergedArmClocks(mergeArms) : linked;
  return [...regular, ...raceClocks];
}

type LrtScheduleRow = {
  route_no?: string;
  dest_en?: string;
  dest_ch?: string;
  time_en?: string;
  time_ch?: string;
};

function lrtRouteNo(route: string): string {
  return route.replace(/\*/g, "");
}

function lrtDestMatch(rowDest: string, routeDest: string): boolean {
  const d = rowDest.toUpperCase();
  const dest = routeDest.toUpperCase();
  return !d || dest.includes(d.slice(0, 6)) || d.includes(dest.slice(0, 6));
}

/**
 * Per-stop MTR Corp LRT schedule → StopClock[] via the same linker as heavy rail.
 * No GPS; times are loose English/Chinese strings (e.g. "2 min", "Arriving").
 */
async function fetchLightRail(route: RouteListEntry, stopIds: string[]): Promise<StopClock[]> {
  const wantRoute = lrtRouteNo(route.route);
  const routeDest = route.dest.en;
  const hits: MtrHit[] = [];
  await pool(stopIds, 6, async (stopId, index) => {
    const stationId = stopId.replace(/^LR/i, "");
    try {
      const json = await getJson<{
        platform_list?: Array<{ route_list?: LrtScheduleRow[] }>;
      }>(`https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule?station_id=${encodeURIComponent(stationId)}`);
      const stampMs = Date.now();
      const rows = (json.platform_list ?? []).flatMap((p) => p.route_list ?? []).filter((row) => {
        if (lrtRouteNo(row.route_no ?? "") !== wantRoute) return false;
        return lrtDestMatch(row.dest_en ?? "", routeDest);
      });
      for (const row of rows) {
        const minutes = parseLrtMinutes(row.time_en ?? row.time_ch ?? "");
        if (minutes == null || !Number.isFinite(minutes)) continue;
        const seconds = Math.max(0, minutes) * 60;
        if (seconds > 90 * 60) continue;
        const dest = (row.dest_en ?? "").toUpperCase();
        hits.push({
          seq: index,
          seconds,
          etaMs: stampMs + seconds * 1000,
          stampMs,
          dest,
        });
      }
    } catch {
      /* one station failing leaves a gap the linker can skip */
    }
  });
  return linkMtrTrains(hits, stopIds.length).map((clock) => ({
    ...clock,
    id: `lrt:${clock.id}`,
    reverse: false,
  }));
}
