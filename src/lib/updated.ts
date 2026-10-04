import type { Lang } from "./types";

export function updatedLabel(lang: Lang, at: number | undefined, now: number): string {
  if (!at) return "—";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return lang === "zh" ? `${seconds}秒前` : `updated ${seconds}s ago`;
}

export function latestStamp(stamps: Array<number | undefined>): number | undefined {
  let max = 0;
  for (const n of stamps) {
    if (n && n > max) max = n;
  }
  return max || undefined;
}
