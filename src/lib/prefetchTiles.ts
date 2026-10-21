import type { LatLng } from "./geo";

const TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
/** Zooms used by start / station focus / pinch around “my location”. */
const HOME_ZOOMS = [14, 15, 16, 17, 18] as const;
/** Half-width of tile grid (5×5) for idle home warm. */
const RADIUS = 2;
/** Wider grid before glide zoom (fewer grey boxes). */
const GLIDE_RADIUS = 3;
const CONCURRENCY = 4;
const MOVE_M = 120;

const warmed = new Set<string>();
const inflight = new Map<string, Promise<void>>();
let queue: Promise<void> = Promise.resolve();
let lastAt: LatLng | null = null;

function latLngToTile(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const max = n - 1;
  return { x: Math.min(max, Math.max(0, x)), y: Math.min(max, Math.max(0, y)) };
}

function tileUrl(z: number, x: number, y: number): string {
  const n = 2 ** z;
  const xx = ((x % n) + n) % n;
  if (y < 0 || y >= n) return "";
  return TILE.replace("{z}", String(z)).replace("{x}", String(xx)).replace("{y}", String(y));
}

function ensureUrl(url: string): Promise<void> {
  if (!url || warmed.has(url)) return Promise.resolve();
  const pending = inflight.get(url);
  if (pending) return pending;
  const job = new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    const done = () => {
      warmed.add(url);
      inflight.delete(url);
      resolve();
    };
    img.onload = done;
    img.onerror = done;
    img.referrerPolicy = "no-referrer";
    img.crossOrigin = "anonymous";
    img.src = url;
  });
  inflight.set(url, job);
  return job;
}

function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function intZooms(zooms: readonly number[]): number[] {
  const set = new Set<number>();
  for (const z of zooms) {
    if (!Number.isFinite(z)) continue;
    set.add(Math.round(z));
    set.add(Math.floor(z));
    set.add(Math.ceil(z));
  }
  return [...set].filter((z) => z >= 0 && z <= 22);
}

function urlsAround(lat: number, lng: number, zooms: readonly number[], radius: number): string[] {
  const out: string[] = [];
  for (const z of intZooms(zooms)) {
    const { x, y } = latLngToTile(lat, lng, z);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const u = tileUrl(z, x + dx, y + dy);
        if (u) out.push(u);
      }
    }
  }
  return out;
}

async function runQueue(urls: string[]) {
  const pending = [...new Set(urls.filter(Boolean))];
  let i = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < pending.length) {
      const url = pending[i++];
      await ensureUrl(url);
      await new Promise((r) => setTimeout(r, 16));
    }
  });
  await Promise.all(workers);
}

/**
 * Warm the HTTP cache with OSM tiles around the user for common home zooms.
 * Safe to call often; ignores tiny GPS jitter and dedupes URLs.
 */
export function prefetchLocationTiles(at: LatLng, zooms: readonly number[] = HOME_ZOOMS) {
  if (!Number.isFinite(at.lat) || !Number.isFinite(at.lng)) return;
  if (lastAt && haversineM(lastAt, at) < MOVE_M) return;
  lastAt = { lat: at.lat, lng: at.lng };
  const urls = urlsAround(at.lat, at.lng, zooms, RADIUS);
  queue = queue.then(() => runQueue(urls)).catch(() => {});
}

export function prefetchLocationTilesIdle(at: LatLng) {
  const run = () => prefetchLocationTiles(at);
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 2500 });
  } else {
    window.setTimeout(run, 400);
  }
}

/**
 * Await tiles for a glide target (station, stop, recenter — any region).
 * Not gated by home MOVE_M. Resolves when the batch is in the HTTP cache.
 */
export function prefetchRegionTiles(
  at: LatLng,
  zooms: number | readonly number[],
  radius = GLIDE_RADIUS,
): Promise<void> {
  if (!Number.isFinite(at.lat) || !Number.isFinite(at.lng)) return Promise.resolve();
  const list = typeof zooms === "number" ? [zooms] : zooms;
  const urls = urlsAround(at.lat, at.lng, list, radius);
  const job = runQueue(urls);
  queue = queue.then(() => job).catch(() => {});
  return job;
}
