import type { Lang, Terminal } from "./types";

export function t(lang: Lang, en: string, zh: string): string {
  return lang === "zh" ? zh : en;
}

/** Drop JoyYou notes and fare remarks that are not part of the place name. */
function cleanName(raw: string): string {
  return raw
    .replace(/\s*[（(][^）)]*(?:樂悠卡|JoyYou|收費|fare)[^）)]*[）)]/gi, "")
    .replace(/\s*單程成人收費[\s\S]*$/, "")
    .replace(/前往[\s\S]*收費[\s\S]*$/, "")
    .replace(/\s+Single trip fare:[\s\S]*$/i, "")
    .replace(/\s+Pre-paid return trip fare[\s\S]*$/i, "")
    .replace(/\s+Please inquire with the operator[\s\S]*$/i, "")
    .trim();
}

export function nameOf(lang: Lang, value: Terminal | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const raw = (lang === "zh" ? value.zh : value.en) || value.en || value.zh || fallback;
  return cleanName(raw) || fallback;
}
