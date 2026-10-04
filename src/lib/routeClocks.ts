import type { Company, RouteListEntry } from "./types";

/** Seconds until arrival at each stop. Negative means that stop is already Due. */
export type StopClock = {
  id: string;
  seconds: Array<number | null>;
};

type Hit = { seq: number; seconds: number; etaMs: number };

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

function pushHit(hits: Hit[], seq: number, iso: string | null | undefined, remark: string): void {
  if (!iso || NOT_OUT.test(remark)) return;
  const etaMs = Date.parse(iso);
  if (!Number.isFinite(etaMs)) return;
  const seconds = (etaMs - Date.now()) / 1000;
  if (seconds < -15 * 60 || seconds > 90 * 60) return;
  hits.push({ seq, seconds, etaMs });
}

/**
 * Chain stop ETAs into vehicles. eta_seq is per stop, so a bus is the run of
 * increasing timestamps, not a shared sequence number.
 */
export function linkBuses(hits: Hit[], stopCount: number): StopClock[] {
  const sorted = [...hits].sort((a, b) => a.seq - b.seq || a.seconds - b.seconds);
  const buses: { lastSeq: number; lastSec: number; id: string; seconds: Array<number | null> }[] = [];
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
      seconds[hit.seq] = hit.seconds;
      buses.push({
        lastSeq: hit.seq,
        lastSec: hit.seconds,
        id: `${hit.seq}:${Math.round(hit.etaMs / 120000)}`,
        seconds,
      });
    } else {
      const bus = buses[best];
      if (!bus) continue;
      bus.seconds[hit.seq] = hit.seconds;
      bus.lastSeq = hit.seq;
      bus.lastSec = hit.seconds;
    }
  }
  return buses
    .map((bus) => ({ id: bus.id, seconds: bus.seconds }))
    .filter((bus) => bus.seconds.some((value) => value != null && value > -10 * 60))
    .sort((a, b) => {
      const aFlag = a.seconds.find((value) => value != null && value > 0) ?? 9e9;
      const bFlag = b.seconds.find((value) => value != null && value > 0) ?? 9e9;
      return aFlag - bFlag;
    });
}

async function fetchKmb(route: RouteListEntry, stopCount: number): Promise<StopClock[]> {
  const service = route.serviceType || "1";
  const bound = boundLetter(route.bound.kmb);
  const url = `https://data.etabus.gov.hk/v1/transport/kmb/route-eta/${encodeURIComponent(route.route)}/${encodeURIComponent(service)}`;
  const json = await getJson<{
    data?: Array<{
      dir?: string;
      seq?: number;
      eta?: string | null;
      service_type?: number | string;
      rmk_en?: string;
      rmk_tc?: string;
    }>;
  }>(url);
  const hits: Hit[] = [];
  for (const row of json.data ?? []) {
    if (row.service_type != null && String(row.service_type) !== String(service)) continue;
    if (row.dir && row.dir.slice(0, 1).toUpperCase() !== bound) continue;
    if (typeof row.seq !== "number") continue;
    pushHit(hits, row.seq - 1, row.eta, `${row.rmk_en ?? ""} ${row.rmk_tc ?? ""}`);
  }
  return linkBuses(hits, stopCount);
}

async function fetchCtb(route: RouteListEntry, stopIds: string[]): Promise<StopClock[]> {
  const bound = boundLetter(route.bound.ctb);
  const hits: Hit[] = [];
  await pool(stopIds, 6, async (stopId, index) => {
    try {
      const json = await getJson<{
        data?: Array<{ dir?: string; seq?: number; eta?: string | null; rmk_en?: string; rmk_tc?: string }>;
      }>(`https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${encodeURIComponent(stopId)}/${encodeURIComponent(route.route)}`);
      const rows = (json.data ?? []).filter((row) => !row.dir || row.dir.slice(0, 1).toUpperCase() === bound);
      const nearest = rows.reduce<number | null>((best, row) => {
        if (typeof row.seq !== "number") return best;
        if (best == null) return row.seq;
        return Math.abs(row.seq - (index + 1)) < Math.abs(best - (index + 1)) ? row.seq : best;
      }, null);
      for (const row of rows) {
        if (nearest != null && row.seq != null && row.seq !== nearest) continue;
        pushHit(hits, index, row.eta, `${row.rmk_en ?? ""} ${row.rmk_tc ?? ""}`);
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
        data?: { eta?: Array<{ timestamp?: string; remarks_en?: string | null; remarks_tc?: string | null }> };
      }>(`https://data.etagmb.gov.hk/eta/route-stop/${encodeURIComponent(routeId)}/${routeSeq}/${index + 1}`);
      for (const row of json.data?.eta ?? []) {
        pushHit(hits, index, row.timestamp, `${row.remarks_en ?? ""} ${row.remarks_tc ?? ""}`);
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
        estimatedArrivals?: Array<{ estimatedArrivalTime?: string; departed?: number }>;
      }>(
        `https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrival&routeId=${encodeURIComponent(routeId)}&stopId=${encodeURIComponent(stopId)}&language=en`,
      );
      for (const row of json.estimatedArrivals ?? []) {
        if (row.departed) continue;
        pushHit(hits, index, row.estimatedArrivalTime, "");
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
