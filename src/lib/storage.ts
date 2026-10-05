import type { Lang, Pin, Settings, Theme } from "./types";

const PINS_KEY = "ia.v1.pins";
const SETTINGS_KEY = "ia.v1.settings";

const defaultSettings = (): Settings => ({
  lang: "zh",
  theme: "light",
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

export function loadSettings(): Settings {
  const base = defaultSettings();
  if (!canUse()) return base;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
        return { ...base, lang: "zh", theme: "light" };
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
}

export function detectInitial(): { lang: Lang; theme: Theme } {
  if (typeof document === "undefined") return { lang: "zh", theme: "light" };
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  return { lang: loadSettings().lang, theme };
}
