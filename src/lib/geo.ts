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

/** Compass bearing in degrees (0 = north) from `from` toward `to`. */
export function bearing(from: LatLng, to: LatLng): number {
  const φ1 = rad(from.lat);
  const φ2 = rad(to.lat);
  const Δλ = rad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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

/** Distance from the start of `path` to each vertex. */
export function cumulativeDistances(path: LatLng[]): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push((cum[i - 1] ?? 0) + haversine(path[i - 1], path[i]));
  return cum;
}

export function pointAtDistance(path: LatLng[], cum: number[], distance: number): LatLng | null {
  if (!path.length) return null;
  if (path.length === 1 || distance <= 0) return path[0];
  const total = cum[cum.length - 1] ?? 0;
  if (distance >= total) return path[path.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] ?? 0) <= distance) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[lo + 1];
  if (!a || !b) return path[path.length - 1] ?? null;
  const seg = (cum[lo + 1] ?? 0) - (cum[lo] ?? 0);
  const t = seg <= 1 ? 0 : (distance - (cum[lo] ?? 0)) / seg;
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Nearest point on `path` at or after `minDist` metres from the start. */
export function projectForward(path: LatLng[], cum: number[], target: LatLng, minDist: number): number {
  if (path.length < 2) return 0;
  let start = 0;
  for (let i = 0; i < path.length - 1; i++) {
    if ((cum[i + 1] ?? 0) >= minDist - 25) {
      start = i;
      break;
    }
  }
  let best = Math.max(0, minDist);
  let bestD = Infinity;
  for (let i = start; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    const hit = closestOnSegment(a, b, target);
    const dist = (cum[i] ?? 0) + haversine(a, hit.point);
    if (dist + 25 < minDist) continue;
    if (hit.distance < bestD) {
      bestD = hit.distance;
      best = dist;
    }
  }
  return best;
}

type Snap = { point: LatLng; along: number; distance: number };

/** First nearby point ahead, otherwise the closest point ahead within maxM. */
function snapAhead(line: LatLng[], cum: number[], dot: LatLng, minDist: number, nearM: number, maxM: number): Snap | null {
  let start = 0;
  for (let i = 0; i < line.length - 1; i++) {
    if ((cum[i + 1] ?? 0) >= minDist - 25) {
      start = i;
      break;
    }
  }
  let first: Snap | null = null;
  let closest: Snap | null = null;
  for (let i = start; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    if (!a || !b) continue;
    const hit = closestOnSegment(a, b, dot);
    const seg = (cum[i + 1] ?? 0) - (cum[i] ?? 0);
    const along = (cum[i] ?? 0) + hit.t * seg;
    if (along + 25 < minDist) continue;
    if (!closest || hit.distance < closest.distance) closest = { point: hit.point, along, distance: hit.distance };
    if (!first && hit.distance <= nearM) first = { point: hit.point, along, distance: hit.distance };
    if (first && along > first.along + 300) break;
  }
  return first ?? (closest && closest.distance <= maxM ? closest : null);
}

/** Drop each stop onto the route, in order, at the first nearby point ahead. */
export function placeOnPath(line: LatLng[], dots: LatLng[], nearM = 45, maxM = 120): LatLng[] {
  if (line.length < 2) return dots.map((dot) => ({ ...dot }));
  const cum = cumulativeDistances(line);
  let minDist = 0;
  return dots.map((dot) => {
    const pick = snapAhead(line, cum, dot, minDist, nearM, maxM);
    if (!pick) return { ...dot };
    minDist = pick.along;
    return pick.point;
  });
}

/** Metres along the route for each stop, using the same snap as the drawn dots. */
export function distancesOnPath(line: LatLng[], dots: LatLng[], nearM = 45, maxM = 120): number[] {
  if (line.length < 2) return dots.map(() => 0);
  const cum = cumulativeDistances(line);
  let minDist = 0;
  return dots.map((dot) => {
    const pick = snapAhead(line, cum, dot, minDist, nearM, maxM);
    if (!pick) {
      const fallback = projectForward(line, cum, dot, minDist);
      minDist = fallback;
      return fallback;
    }
    minDist = pick.along;
    return pick.along;
  });
}

function closestOnSegment(a: LatLng, b: LatLng, p: LatLng): { point: LatLng; distance: number; t: number } {
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
  return { point, distance: haversine(point, p), t };
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
