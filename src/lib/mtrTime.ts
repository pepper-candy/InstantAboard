import { t } from "./i18n";
import type { Lang } from "./types";

/** Platform boarding wait used only by the map sim. Tune ~20–45. Does not change ETA labels. */
export const MTR_DWELL_S = 30;

/** Extra seconds after 開出 before the marker leaves. Motion only. */
export const MTR_DEPART_LAG_S = 25;

/** Peak coasting speed along the track (km/h). */
export const MTR_SIM_KMH = 80;

/** Leave-stop acceleration (m/s²). Reach 80 km/h in ~V/a seconds. */
export const MTR_ACCEL_MS2 = 0.85;

/** Approach braking (m/s²). Slightly firmer than accel. */
export const MTR_DECEL_MS2 = 1.0;

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

/** True on the platform: arrived, and not yet past the 開出 + lag. */
export function mtrDwelling(apiSeconds: number): boolean {
  return mtrSimSeconds(apiSeconds) <= 0 && mtrDepartedSeconds(apiSeconds) <= 0;
}

/** Seconds since the sim may leave. Zero through 開出 plus MTR_DEPART_LAG_S. */
export function mtrDepartedSeconds(apiSeconds: number): number {
  return Math.max(0, -apiSeconds - MTR_DEPART_LAG_S);
}

function peakMs(): number {
  return (MTR_SIM_KMH * 1000) / 3600;
}

/** Trapezoid (or triangle) along one inter-station gap. */
export function mtrLegProfile(distanceM: number): {
  vPeak: number;
  tAcc: number;
  tCoast: number;
  tDec: number;
  tTotal: number;
  sAcc: number;
  sDec: number;
} {
  const D = Math.max(0, distanceM);
  const a = MTR_ACCEL_MS2;
  const d = MTR_DECEL_MS2;
  const vMax = peakMs();
  if (D < 1 || a <= 0 || d <= 0) {
    return { vPeak: 0, tAcc: 0, tCoast: 0, tDec: 0, tTotal: 0, sAcc: 0, sDec: 0 };
  }
  const vTri = Math.sqrt((2 * D * a * d) / (a + d));
  const vPeak = Math.min(vMax, vTri);
  const tAcc = vPeak / a;
  const tDec = vPeak / d;
  const sAcc = 0.5 * a * tAcc * tAcc;
  const sDec = 0.5 * d * tDec * tDec;
  const sCoast = Math.max(0, D - sAcc - sDec);
  const tCoast = vPeak > 0.05 ? sCoast / vPeak : 0;
  return { vPeak, tAcc, tCoast, tDec, tTotal: tAcc + tCoast + tDec, sAcc, sDec };
}

/** Distance from the previous stop and instantaneous speed, t seconds after leaving. */
export function mtrAlongLeg(distanceM: number, t: number): { dist: number; speedMs: number } {
  const D = Math.max(0, distanceM);
  const p = mtrLegProfile(D);
  if (t <= 0 || D <= 0) return { dist: 0, speedMs: 0 };
  if (t >= p.tTotal) return { dist: D, speedMs: 0 };
  if (t < p.tAcc) {
    return { dist: 0.5 * MTR_ACCEL_MS2 * t * t, speedMs: MTR_ACCEL_MS2 * t };
  }
  const intoCoast = t - p.tAcc;
  if (intoCoast < p.tCoast) {
    return { dist: p.sAcc + p.vPeak * intoCoast, speedMs: p.vPeak };
  }
  const tToGo = p.tTotal - t;
  return {
    dist: D - 0.5 * MTR_DECEL_MS2 * tToGo * tToGo,
    speedMs: MTR_DECEL_MS2 * tToGo,
  };
}

/** Metres still to the next stop, assuming peak then brake, given seconds until arrival. */
export function mtrRemainToStop(tToGo: number): { remainM: number; speedMs: number } {
  const t = Math.max(0, tToGo);
  if (t <= 0) return { remainM: 0, speedMs: 0 };
  const vMax = peakMs();
  const d = MTR_DECEL_MS2;
  const tDec = vMax / d;
  const sDec = 0.5 * d * tDec * tDec;
  if (t <= tDec) return { remainM: 0.5 * d * t * t, speedMs: d * t };
  return { remainM: sDec + vMax * (t - tDec), speedMs: vMax };
}
