import type { LatLng } from "./geo";

const KEY = "ia.v1.dev";

export type DevPinMode = "off" | "follow" | "locked";

export type DevState = {
  on: boolean;
  pinMode: DevPinMode;
  showAll: boolean;
  spot: LatLng | null;
};

export const DEV_OFF: DevState = { on: false, pinMode: "off", showAll: false, spot: null };

function asPinMode(value: unknown, pin: unknown, hasSpot: boolean): DevPinMode {
  if (value === "follow" || value === "locked" || value === "off") return value;
  if (pin && hasSpot) return "locked";
  return "off";
}

function canUse(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadDev(): DevState {
  if (!canUse()) return DEV_OFF;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEV_OFF;
    const parsed = JSON.parse(raw) as Partial<DevState> & { pin?: boolean };
    const spot =
      parsed.spot && Number.isFinite(parsed.spot.lat) && Number.isFinite(parsed.spot.lng)
        ? { lat: parsed.spot.lat, lng: parsed.spot.lng }
        : null;
    const pinMode = asPinMode(parsed.pinMode, parsed.pin, Boolean(spot));
    return {
      on: Boolean(parsed.on),
      pinMode: pinMode === "follow" && !spot ? "off" : pinMode,
      showAll: Boolean(parsed.showAll),
      spot: pinMode === "off" ? null : spot,
    };
  } catch {
    return DEV_OFF;
  }
}

export function saveDev(state: DevState): void {
  if (!canUse()) return;
  localStorage.setItem(KEY, JSON.stringify(state));
}
