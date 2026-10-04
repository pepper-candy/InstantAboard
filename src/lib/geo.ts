export type LatLng = { lat: number; lng: number };

export const HANG_HAU: LatLng = { lat: 22.3155, lng: 114.2647 };
export const HKUST: LatLng = { lat: 22.3376, lng: 114.263 };

export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function rad(d: number): number {
  return (d * Math.PI) / 180;
}

export function formatDistance(meters: number, lang: "en" | "zh"): string {
  if (meters < 1000) {
    return lang === "zh" ? `${Math.round(meters)}米` : `${Math.round(meters)}m`;
  }
  const km = meters / 1000;
  return lang === "zh" ? `${km.toFixed(1)}公里` : `${km.toFixed(1)}km`;
}

export function interpolateAlong(path: LatLng[], distanceFromEnd: number): LatLng | null {
  if (path.length < 2) return path[0] ?? null;
  let remain = Math.max(0, distanceFromEnd);
  for (let i = path.length - 1; i > 0; i--) {
    const a = path[i];
    const b = path[i - 1];
    const seg = haversine(a, b);
    if (seg <= 1) continue;
    if (remain <= seg) {
      const t = remain / seg;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      };
    }
    remain -= seg;
  }
  return path[0] ?? null;
}

export function pathLength(path: LatLng[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += haversine(path[i - 1], path[i]);
  return n;
}

function closestOnSegment(a: LatLng, b: LatLng, p: LatLng): { point: LatLng; distance: number } {
  const lat0 = (((a.lat + b.lat + p.lat) / 3) * Math.PI) / 180;
  const cos = Math.cos(lat0);
  const x = (lng: number) => lng * cos * 111_320;
  const y = (lat: number) => lat * 110_540;
  const ax = x(a.lng);
  const ay = y(a.lat);
  const bx = x(b.lng);
  const by = y(b.lat);
  const px = x(p.lng);
  const py = y(p.lat);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  return { point, distance: haversine(point, p) };
}

function nearestFrom(shape: LatLng[], target: LatLng, start: number): { index: number; point: LatLng } {
  const begin = Math.max(0, Math.min(start, Math.max(0, shape.length - 2)));
  let bestD = Infinity;
  let bestI = begin;
  let bestP = shape[Math.min(begin, shape.length - 1)] ?? target;
  for (let i = begin; i < shape.length - 1; i++) {
    const hit = closestOnSegment(shape[i], shape[i + 1], target);
    if (hit.distance < bestD) {
      bestD = hit.distance;
      bestI = i;
      bestP = hit.point;
    }
  }
  return { index: bestI, point: bestP };
}

function orientShape(shape: LatLng[], stops: LatLng[]): LatLng[] {
  if (stops.length < 2 || shape.length < 2) return shape;
  const start = nearestFrom(shape, stops[0], 0);
  const end = nearestFrom(shape, stops[stops.length - 1], 0);
  if (end.index < start.index) return [...shape].reverse();
  return shape;
}

/** Road geometry from the start of `shape` through the last stop, following stop order. */
export function sliceShapeToStops(shape: LatLng[], stops: LatLng[]): LatLng[] {
  if (shape.length < 2 || stops.length === 0) return stops.length ? [...stops] : [...shape];
  const oriented = orientShape(shape, stops);
  let cursor = 0;
  let endIndex = 0;
  let endPoint = oriented[0];
  for (const stop of stops) {
    const hit = nearestFrom(oriented, stop, cursor);
    cursor = hit.index;
    endIndex = hit.index;
    endPoint = hit.point;
  }
  const out = oriented.slice(0, endIndex + 1);
  const tail = out[out.length - 1];
  if (!tail || haversine(tail, endPoint) > 2) out.push(endPoint);
  return out.length >= 2 ? out : [...stops];
}
