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
