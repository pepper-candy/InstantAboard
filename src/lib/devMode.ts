import type { LatLng } from "./geo";

const KEY = "ia.v1.dev";

export type DevState = {
  on: boolean;
  pin: boolean;
  showAll: boolean;
  spot: LatLng | null;
};

export const DEV_OFF: DevState = { on: false, pin: false, showAll: false, spot: null };

function canUse(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadDev(): DevState {
  if (!canUse()) return DEV_OFF;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEV_OFF;
    const parsed = JSON.parse(raw) as Partial<DevState>;
    const spot =
      parsed.spot && Number.isFinite(parsed.spot.lat) && Number.isFinite(parsed.spot.lng)
        ? { lat: parsed.spot.lat, lng: parsed.spot.lng }
        : null;
    return {
      on: Boolean(parsed.on),
      pin: Boolean(parsed.on && parsed.pin && spot),
      showAll: Boolean(parsed.on && parsed.showAll),
      spot,
    };
  } catch {
    return DEV_OFF;
  }
}

export function saveDev(state: DevState): void {
  if (!canUse()) return;
  localStorage.setItem(KEY, JSON.stringify(state));
}
