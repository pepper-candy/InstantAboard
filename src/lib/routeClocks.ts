import type { Company, RouteListEntry } from "./types";

/**
 * Seconds from each row's data_timestamp until arrival.
 * Negative means that stop is already Due.
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
};

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

function firstPositive(clock: StopClock): number {
  for (let i = 0; i < clock.seconds.length; i++) {
    const value = clock.seconds[i];
    if (value != null && value > 0) return i;
  }
  return -1;
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

function firstPositiveFrom(clock: StopClock, start: number): number {
  for (let i = Math.max(0, start); i < clock.seconds.length; i++) {
    const value = clock.seconds[i];
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

function nextReached(current: number, prev: StopClock | null, next: StopClock): number {
  const rawFlag = firstPositive(next);
  // A was Due, so this bus is already there. The new future time at A is the next bus.
  // Keep the passed-stop flag, otherwise a long ETA at B draws this bus back before A.
  const held = rawFlag >= 0 && rawFlag === current && (next.seconds[rawFlag] ?? 0) > 0;
  const flag = held ? firstPositiveFrom(next, current + 1) : rawFlag;
  let reached = current;
  if (!held && ((flag >= 0 && reached >= flag) || (reached >= 0 && next.seconds[reached] != null))) reached = -1;
  if (prev) {
    const vanished = vanishedStop(prev, next, flag);
    if (vanished != null) reached = Math.max(reached, vanished);
  }
  for (let i = 0; i < next.seconds.length; i++) {
    const sec = next.seconds[i];
    if (sec != null && sec <= 0 && (flag < 0 || i < flag)) reached = Math.max(reached, i);
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

function remember(clock: StopClock, mem: BusMemory, prev: StopClock | null): { clock: StopClock; memory: BusMemory } {
  const polls = mem.polls.slice(-(POLL_HISTORY - 1));
  polls.push({ seconds: clock.seconds.slice(), stamps: clock.stamps.slice() });
  const reached = nextReached(mem.reached, prev, clock);
  const flag = firstPositiveFrom(clock, reached + 1);
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
      clocks.push(prev);
      nextMemory.push(mem);
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
    default:
      return [];
  }
}
