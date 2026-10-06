import { mtrLineCode, mtrLineNames } from "./colors";
import type { Terminal } from "./types";

function norm(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(raw: string): string[] {
  return norm(raw).split(" ").filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (a.length > 32 || b.length > 32) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length];
}

function closeToken(hay: string, needle: string): boolean {
  if (!hay || !needle) return false;
  if (hay === needle || hay.startsWith(needle) || hay.includes(needle)) return true;
  const allow = needle.length >= 6 ? 2 : 1;
  if (Math.abs(hay.length - needle.length) > allow) return false;
  return levenshtein(hay, needle) <= allow;
}

function fuzzySubseq(hay: string, needle: string, skip: number): boolean {
  let i = 0;
  let missed = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i += 1;
    if (i >= needle.length) return true;
  }
  for (let s = 0; s < needle.length && missed <= skip; s++) {
    if (hay.includes(needle.slice(0, s) + needle.slice(s + 1))) return true;
    missed += 1;
  }
  return false;
}

/** Lower is better. Null means no name match. */
export function scoreName(hay: string, needle: string): number | null {
  const h = norm(hay);
  const q = norm(needle);
  if (!h || !q) return null;
  if (h === q) return 0;
  if (h.startsWith(q)) return 8;
  if (h.includes(q)) return 16;
  const qw = words(q);
  const hw = words(h);
  if (qw.length >= 2) {
    const hit = qw.filter((w) => hw.some((x) => closeToken(x, w))).length;
    if (hit >= 2 || hit / qw.length >= 2 / 3) return 24 + (qw.length - hit);
  }
  if (qw.length === 1 && qw[0].length >= 3) {
    const w = qw[0];
    if (hw.some((x) => closeToken(x, w))) return 36;
    if (h.length <= 24 && levenshtein(h, w) <= (w.length >= 6 ? 2 : 1)) return 40;
  }
  if (q.length >= 2 && !/[a-z0-9]/.test(q)) {
    if (fuzzySubseq(h.replace(/\s/g, ""), q.replace(/\s/g, ""), q.length >= 4 ? 1 : 0)) return 28;
  }
  return null;
}

export function scoreTerminal(name: Terminal | undefined, needle: string): number | null {
  if (!name) return null;
  const scores = [scoreName(name.en, needle), scoreName(name.zh, needle)].filter((n): n is number => n != null);
  return scores.length ? Math.min(...scores) : null;
}

/** Route numbers: exact or prefix only (`91` → 91, 91M, 91R — not 19). */
export function scoreRouteNumber(route: string, needle: string): number | null {
  const r = route.trim().toUpperCase();
  const q = needle.trim().toUpperCase();
  if (!r || !q) return null;
  if (r === q) return 0;
  if (r.startsWith(q)) return 4;
  return null;
}

export function scoreMtrLine(route: string, needle: string): number | null {
  const names = mtrLineNames(route);
  const code = mtrLineCode(route);
  const q = needle.trim();
  const parts = [scoreRouteNumber(code, q), scoreRouteNumber(route, q), scoreName(names.en, q), scoreName(names.zh, q)];
  const hits = parts.filter((n): n is number => n != null);
  return hits.length ? Math.min(...hits) : null;
}

export function bestScore(scores: Array<number | null | undefined>): number | null {
  const hits = scores.filter((n): n is number => n != null);
  return hits.length ? Math.min(...hits) : null;
}
