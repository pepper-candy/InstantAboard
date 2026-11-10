import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { decodeTrafficFlowTile } from "@/lib/mvtDecode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vector Flow Tiles, type=absolute: traffic_level is current speed in km/h.
 * Relative (0–1 vs free-flow) is not fetched — pairing it would double tile
 * quota; the overlay uses current vs 50 km/h when free-flow is absent.
 * Zoom is locked to 16 (~520 m tiles in HK) so urban pieces stay short
 * without a low-zoom corridor merge.
 *
 * TomTom returns gzip-compressed PBF (Content-Encoding and/or the tile
 * payload). We request identity then inflate 1f 8b ourselves.
 */
const TILE_TYPE = "absolute";
const TILE_Z = 16;
const TILE_TIMEOUT_MS = 8_000;
const MAX_TILE_BYTES = 1_500_000;
const EMPTY_BUT_FAT = 256;
const TILE_URL = "https://api.tomtom.com/traffic/map/4/tile/flow";
const TILE_TAGS = "[road_type,traffic_level,traffic_road_coverage,left_hand_traffic,road_closure]";

function intParam(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && Number.isFinite(n) ? n : null;
}

function quotaStatus(status: number): boolean {
  return status === 429 || status === 403;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function inflateTile(bytes: Uint8Array): { bytes: Uint8Array; gzip: boolean } | null {
  let out = bytes;
  let gzip = false;
  for (let i = 0; i < 2; i++) {
    if (!isGzip(out)) break;
    try {
      out = new Uint8Array(gunzipSync(out));
      gzip = true;
    } catch {
      return null;
    }
  }
  if (out.byteLength > MAX_TILE_BYTES) return null;
  return { bytes: out, gzip };
}

/** Server-only Vector Flow Tile proxy. The API key never leaves this handler. */
export async function GET(request: Request) {
  const key = process.env.TOMTOM_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const url = new URL(request.url);
  const z = intParam(url.searchParams.get("z"));
  const x = intParam(url.searchParams.get("x"));
  const y = intParam(url.searchParams.get("y"));
  const max = 2 ** TILE_Z;
  if (z !== TILE_Z || x == null || y == null || x < 0 || y < 0 || x >= max || y >= max) {
    return NextResponse.json({ error: "invalid tile" }, { status: 400 });
  }

  const tileUrl = new URL(`${TILE_URL}/${TILE_TYPE}/${z}/${x}/${y}.pbf`);
  tileUrl.searchParams.set("key", key);
  tileUrl.searchParams.set("tags", TILE_TAGS);

  let res: Response;
  try {
    res = await fetch(tileUrl, {
      cache: "no-store",
      headers: { "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
    });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  if (quotaStatus(res.status)) {
    return NextResponse.json({ error: "quota" }, { status: res.status });
  }
  if (!res.ok) {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  let raw: Uint8Array;
  try {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_TILE_BYTES) {
      return NextResponse.json({ error: "unavailable" }, { status: 502 });
    }
    raw = new Uint8Array(buf);
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  const inflated = inflateTile(raw);
  if (!inflated) {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  const decoded = decodeTrafficFlowTile(inflated.bytes, z, x, y);
  if (decoded == null) {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
  // Urban tiles are tens of KB. A fat body with no flow lines is a parse miss.
  if (inflated.bytes.byteLength >= EMPTY_BUT_FAT && decoded.stats.lines === 0) {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  return NextResponse.json({
    z,
    x,
    y,
    type: TILE_TYPE,
    bytes: raw.byteLength,
    inflated: inflated.bytes.byteLength,
    gzip: inflated.gzip,
    layer: decoded.stats.layerName,
    layers: decoded.stats.layers,
    features: decoded.stats.features,
    withTrafficLevel: decoded.stats.withTrafficLevel,
    keys: decoded.stats.keys,
    segments: decoded.segments,
  });
}
