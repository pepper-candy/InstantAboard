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
 */
const TILE_TYPE = "absolute";
const TILE_Z = 16;
const TILE_TIMEOUT_MS = 8_000;
const MAX_TILE_BYTES = 1_500_000;
const TILE_URL = "https://api.tomtom.com/traffic/map/4/tile/flow";

function intParam(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && Number.isFinite(n) ? n : null;
}

function quotaStatus(status: number): boolean {
  return status === 429 || status === 403;
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

  let res: Response;
  try {
    res = await fetch(tileUrl, {
      cache: "no-store",
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

  let bytes: Uint8Array;
  try {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_TILE_BYTES) {
      return NextResponse.json({ error: "unavailable" }, { status: 502 });
    }
    bytes = new Uint8Array(buf);
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  const segments = decodeTrafficFlowTile(bytes, z, x, y);
  if (segments == null) {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  return NextResponse.json({
    z,
    x,
    y,
    type: TILE_TYPE,
    segments,
  });
}
