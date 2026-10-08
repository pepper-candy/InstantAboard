import { t } from "./i18n";
import type { Lang } from "./types";

/** Seconds of dwell/boarding baked into MTR Next Train arrival times. Tune 30–60. */
export const MTR_DWELL_S = 45;

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

/** Wall-clock seconds until the real arrival (API time minus dwell). */
export function mtrSimSeconds(apiSeconds: number): number {
  return apiSeconds - MTR_DWELL_S;
}
