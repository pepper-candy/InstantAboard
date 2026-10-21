/** Stable HTTPS URL for the daily-published HK basemap manifest (Release tag `hk-basemap`). */
export const HK_BASEMAP_MANIFEST_URL =
  process.env.NEXT_PUBLIC_HK_BASEMAP_MANIFEST_URL ??
  "https://github.com/pepper-candy/InstantAboard/releases/download/hk-basemap/manifest.json";

/** Geofabrik HK coverage (west, south, east, north). */
export const HK_BOUNDS: [number, number, number, number] = [113.8, 22.15, 114.45, 22.57];

export type HkBasemapManifest = {
  version: string;
  builtAt: string;
  url: string;
  bytes: number;
  sha256: string;
  minZoom: number;
  maxZoom: number;
  bounds: [number, number, number, number];
  attribution: string;
};

export type HkLocalMeta = {
  version: string;
  builtAt: string;
  sha256: string;
  bytes: number;
};

export function packAgeDays(builtAt: string, now = new Date()): number {
  const built = Date.parse(builtAt);
  if (!Number.isFinite(built)) return Number.POSITIVE_INFINITY;
  const ms = now.getTime() - built;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function isManifestValid(m: unknown): m is HkBasemapManifest {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.version === "string" &&
    typeof o.builtAt === "string" &&
    typeof o.url === "string" &&
    typeof o.bytes === "number" &&
    typeof o.sha256 === "string" &&
    typeof o.minZoom === "number" &&
    typeof o.maxZoom === "number" &&
    Array.isArray(o.bounds) &&
    o.bounds.length === 4 &&
    typeof o.attribution === "string" &&
    o.url.startsWith("https://")
  );
}

export async function fetchHkBasemapManifest(
  signal?: AbortSignal,
): Promise<HkBasemapManifest> {
  const res = await fetch(HK_BASEMAP_MANIFEST_URL, {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`HK basemap manifest HTTP ${res.status}`);
  }
  const json: unknown = await res.json();
  if (!isManifestValid(json)) {
    throw new Error("HK basemap manifest invalid or missing url");
  }
  return json;
}

/** True when a Leaflet/map bounds rect intersects the HK pack coverage. */
export function boundsIntersectHk(
  west: number,
  south: number,
  east: number,
  north: number,
  hk: readonly [number, number, number, number] = HK_BOUNDS,
): boolean {
  const [hw, hs, he, hn] = hk;
  return !(east < hw || west > he || north < hs || south > hn);
}
