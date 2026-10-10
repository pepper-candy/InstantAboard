import { t } from "./i18n";
import type { Lang } from "./types";

/** Platform boarding wait used only by the map sim. Tune ~20–45. Does not change ETA labels. */
export const MTR_DWELL_S = 30;

/** Extra motion-only sit after 開出 / API due. Tune ~20–30. Labels stay on 到 / 開出. */
export const MTR_DEPART_LAG_S = 25;

/** Peak coast along the track (km/h). Real MTR is much faster than a 40 km/h crawl. */
export const MTR_SIM_KMH = 80;

/** Accel / brake used to leave and enter a station (m/s²). */
export const MTR_ACCEL_MS2 = 0.9;

export type MtrEtaKind = "minutes" | "arr" | "dep";

export type MtrEtaView = {
  kind: MtrEtaKind;
  /** Remaining minutes to show when `kind === "minutes"`. */
  minutes?: number;
};

/**
 * MTR Next Train is one step late: API 2 min → 1 min, API 1 min → arriving,
 * API 0 / passed → already departing.
 */
export function mtrEtaView(apiMinutes: number | null | undefined): MtrEtaView | null {
  if (apiMinutes == null || !Number.isFinite(apiMinutes)) return null;
  const rounded = Math.round(apiMinutes);
  if (rounded <= 0) return { kind: "dep" };
  if (rounded === 1) return { kind: "arr" };
  return { kind: "minutes", minutes: rounded - 1 };
}

export function formatMtrEta(lang: Lang, apiMinutes: number | null | undefined): string {
  const view = mtrEtaView(apiMinutes);
  if (!view) return "—";
  if (view.kind === "dep") return t(lang, "Dep", "開出");
  if (view.kind === "arr") return t(lang, "Arr", "到");
  return String(view.minutes);
}

/** Seconds until the train should be on the platform (API time minus dwell). Negative = dwelling or gone. */
export function mtrSimSeconds(apiSeconds: number): number {
  return apiSeconds - MTR_DWELL_S;
}

/** True while the train is on the platform: after sim arrival, through 開出, until the motion lag ends. */
export function mtrDwelling(apiSeconds: number): boolean {
  return mtrSimSeconds(apiSeconds) <= 0 && apiSeconds > -MTR_DEPART_LAG_S;
}

/** Seconds since the motion-only depart trigger. Zero while still held on the platform. */
export function mtrDepartedSeconds(apiSeconds: number): number {
  return Math.max(0, -apiSeconds - MTR_DEPART_LAG_S);
}
