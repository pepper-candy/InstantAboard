import type { LatLng } from "./geo";

const OSRM = "https://router.project-osrm.org/route/v1/driving";

export function parseShape(data: unknown): LatLng[] | null {
  if (!Array.isArray(data) || data.length < 2) return null;
  const line: LatLng[] = [];
  for (const item of data) {
    if (!Array.isArray(item) || item.length < 2) return null;
    const lat = Number(item[0]);
    const lng = Number(item[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    line.push({ lat, lng });
  }
  return line.length >= 2 ? line : null;
}

function cacheKey(stops: LatLng[]): string {
  let hash = 2166136261;
  const raw = stops.map((stop) => `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`).join(";");
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `ia.osrm.v1.${stops.length}.${hash >>> 0}`;
}

function readCache(stops: LatLng[]): LatLng[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(stops));
    if (!raw) return null;
    return parseShape(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writeCache(stops: LatLng[], line: LatLng[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(cacheKey(stops), JSON.stringify(line.map((p) => [round(p.lat), round(p.lng)])));
  } catch {
    /* quota */
  }
}

function round(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

function coord(stop: LatLng): string {
  return `${stop.lng.toFixed(5)},${stop.lat.toFixed(5)}`;
}

function chunkStops(stops: LatLng[]): LatLng[][] {
  const chunks: LatLng[][] = [];
  let index = 0;
  while (index < stops.length - 1) {
    let end = index + 1;
    let length = coord(stops[index]).length;
    while (end < stops.length) {
      const next = length + 1 + coord(stops[end]).length;
      if (end > index + 1 && next > 1600) break;
      length = next;
      end++;
    }
    chunks.push(stops.slice(index, end));
    if (end >= stops.length) break;
    index = end - 1;
  }
  return chunks;
}

async function osrmLeg(stops: LatLng[]): Promise<LatLng[] | null> {
  const path = stops.map(coord).join(";");
  const res = await fetch(`${OSRM}/${path}?overview=full&geometries=geojson`);
  if (!res.ok) return null;
  const body = (await res.json()) as { routes?: Array<{ geometry?: { coordinates?: number[][] } }> };
  const coordinates = body.routes?.[0]?.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;
  return coordinates.map(([lng, lat]) => ({ lat, lng }));
}

/** Snap a stop sequence to roads. Returns null when the public router fails. */
export async function osrmShape(stops: LatLng[]): Promise<LatLng[] | null> {
  if (stops.length < 2) return null;
  try {
    const chunks = chunkStops(stops);
    const line: LatLng[] = [];
    for (const chunk of chunks) {
      const leg = await osrmLeg(chunk);
      if (!leg) return null;
      if (line.length) leg.shift();
      line.push(...leg);
    }
    return line.length >= 2 ? line : null;
  } catch {
    return null;
  }
}

/**
 * Local shape file, then a cached or live OSRM driving route.
 * Null means the caller should draw straight stop-to-stop segments.
 * Rail passes `road: false` so a missing track file never becomes a driving route.
 */
export async function loadRouteLine(
  fileName: string,
  stops: LatLng[],
  options?: { road?: boolean },
): Promise<LatLng[] | null> {
  try {
    const res = await fetch(`/shapes/${fileName}`);
    if (res.ok) {
      const line = parseShape((await res.json()) as unknown);
      if (line) return line;
    }
  } catch {
    /* missing shape */
  }
  if (options?.road === false) return null;
  const cached = readCache(stops);
  if (cached) return cached;
  const routed = await osrmShape(stops);
  if (routed) writeCache(stops, routed);
  return routed;
}
