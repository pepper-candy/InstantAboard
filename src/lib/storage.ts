import type { Lang, Pin, Settings, Theme } from "./types";

const PINS_KEY = "ia.v1.pins";
const SETTINGS_KEY = "ia.v1.settings";
const SEED_REV_KEY = "ia.v1.seedRev";

/** Bump when the default watchboard seed list must be offered once to everyone. */
export const WATCHBOARD_SEED_REV = 2;

const defaultSettings = (): Settings => ({
  lang: "zh",
  theme: "dark",
  filter: "all",
  seeded: false,
});

function canUse(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadPins(): Pin[] | null {
  if (!canUse()) return null;
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pin[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((p) => p && typeof p.id === "string" && typeof p.routeId === "string");
  } catch {
    return null;
  }
}

export function savePins(pins: Pin[]): void {
  if (!canUse()) return;
  localStorage.setItem(PINS_KEY, JSON.stringify(pins));
}

export function loadSeedRev(): number {
  if (!canUse()) return 0;
  try {
    const raw = localStorage.getItem(SEED_REV_KEY);
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function saveSeedRev(rev: number): void {
  if (!canUse()) return;
  localStorage.setItem(SEED_REV_KEY, String(rev));
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  if (!canUse()) return base;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...base, lang: "zh", theme: "dark" };
    }
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      lang: parsed.lang === "en" ? "en" : "zh",
      theme: parsed.theme === "dark" ? "dark" : "light",
      // A fresh open always starts on All.
      filter: "all",
      seeded: Boolean(parsed.seeded),
    };
  } catch {
    return base;
  }
}

export function saveSettings(settings: Settings): void {
  if (!canUse()) return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  const color = theme === "light" ? "#efe8dc" : "#12110f";
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", color);
}

export function applyLang(lang: Lang): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
}
