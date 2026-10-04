import type { Lang, Terminal } from "./types";

export function t(lang: Lang, en: string, zh: string): string {
  return lang === "zh" ? zh : en;
}

/** Fare-note suffixes carried on some tram stop names. */
function cleanName(raw: string): string {
  return raw
    .replace(/\s*[（(][^）)]*樂悠卡[^）)]*[）)]/g, "")
    .replace(/\s*[（(][^）)]*JoyYou[^）)]*[）)]/gi, "")
    .trim();
}

export function nameOf(lang: Lang, value: Terminal | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const raw = (lang === "zh" ? value.zh : value.en) || value.en || value.zh || fallback;
  return cleanName(raw) || fallback;
}
