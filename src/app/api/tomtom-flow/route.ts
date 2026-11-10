import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FLOW_URL = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/16/json";
const MAX_POINTS = 5;
const POINT_TIMEOUT_MS = 8_000;

export type TomTomFlowPoint = { lat: number; lng: number };

export type TomTomFlowSegment = {
  currentSpeed: number | null;
  freeFlowSpeed: number | null;
  currentTravelTime: number | null;
  freeFlowTravelTime: number | null;
  confidence: number | null;
  frc: string | null;
  roadClosure: boolean | null;
  coordinates: TomTomFlowPoint[];
};

function finiteNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parsePoint(raw: unknown): TomTomFlowPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { lat?: unknown; lng?: unknown; lon?: unknown };
  const lat = finiteNum(row.lat);
  const lng = finiteNum(row.lng ?? row.lon);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function parseCoordinates(raw: unknown): TomTomFlowPoint[] {
  if (!raw || typeof raw !== "object") return [];
  const pack = raw as { coordinate?: unknown };
  const list = Array.isArray(pack.coordinate) ? pack.coordinate : Array.isArray(raw) ? raw : [];
  const out: TomTomFlowPoint[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { latitude?: unknown; longitude?: unknown; lat?: unknown; lng?: unknown };
    const lat = finiteNum(row.latitude ?? row.lat);
    const lng = finiteNum(row.longitude ?? row.lng);
    if (lat == null || lng == null) continue;
    out.push({ lat, lng });
  }
  return out;
}

function parseSegment(json: unknown): TomTomFlowSegment | null {
  if (!json || typeof json !== "object") return null;
  const root = json as { flowSegmentData?: unknown };
  const data = root.flowSegmentData;
  if (!data || typeof data !== "object") return null;
  const row = data as {
    currentSpeed?: unknown;
    freeFlowSpeed?: unknown;
    currentTravelTime?: unknown;
    freeFlowTravelTime?: unknown;
    confidence?: unknown;
    frc?: unknown;
    roadClosure?: unknown;
    coordinates?: unknown;
  };
  return {
    currentSpeed: finiteNum(row.currentSpeed),
    freeFlowSpeed: finiteNum(row.freeFlowSpeed),
    currentTravelTime: finiteNum(row.currentTravelTime),
    freeFlowTravelTime: finiteNum(row.freeFlowTravelTime),
    confidence: finiteNum(row.confidence),
    frc: typeof row.frc === "string" ? row.frc : null,
    roadClosure: typeof row.roadClosure === "boolean" ? row.roadClosure : null,
    coordinates: parseCoordinates(row.coordinates),
  };
}

function readPoints(body: unknown): TomTomFlowPoint[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { points?: unknown }).points;
  if (!Array.isArray(raw)) return [];
  const out: TomTomFlowPoint[] = [];
  for (const item of raw) {
    if (out.length >= MAX_POINTS) break;
    const point = parsePoint(item);
    if (point) out.push(point);
  }
  return out;
}

async function flowAt(point: TomTomFlowPoint, key: string): Promise<TomTomFlowSegment | null> {
  const url = new URL(FLOW_URL);
  url.searchParams.set("point", `${point.lat},${point.lng}`);
  url.searchParams.set("unit", "KMPH");
  url.searchParams.set("key", key);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(POINT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseSegment(await res.json());
  } catch {
    return null;
  }
}

/** Server-only TomTom Flow Segment proxy. The API key never leaves this handler. */
export async function POST(request: Request) {
  const key = process.env.TOMTOM_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid points" }, { status: 400 });
  }

  const points = readPoints(body);
  if (!points.length) {
    return NextResponse.json({ error: "invalid points" }, { status: 400 });
  }

  const segments = await Promise.all(points.map((point) => flowAt(point, key)));
  return NextResponse.json({ segments });
}
