import { mtrLineCode } from "./colors";
import type { EtaDb, RouteListEntry, Terminal } from "./types";

/** True when dest is Tiu Keng Leng (short-turn - not a TKL title terminus). */
export function isTiuKengLengDest(dest: Terminal | string | undefined): boolean {
  if (!dest) return false;
  if (typeof dest === "string") {
    const raw = dest.replace(/^mtr:/i, "").trim().toUpperCase();
    if (raw === "TIK" || raw === "TIU KENG LENG") return true;
    return /tiu keng leng|\u8abf\u666f\u5dba/.test(dest);
  }
  const en = (dest.en || "").trim().toLowerCase();
  const zh = (dest.zh || "").trim();
  return en === "tiu keng leng" || zh === "\u8abf\u666f\u5dba" || /tiu keng leng/.test(en);
}

function nameOr(
  db: EtaDb | null | undefined,
  stopId: string,
  en: string,
  zh: string,
): Terminal {
  return db?.stopList?.[stopId]?.name ?? { en, zh };
}

/**
 * Big-title termini for RouteDetail / board header.
 * - TKL: North Point | Po Lam / LOHAS Park (never Tiu Keng Leng)
 * - EAL: Admiralty | Lo Wu / Lok Ma Chau
 */
export function mtrTitleDests(
  db: EtaDb | null | undefined,
  route: Pick<RouteListEntry, "route" | "dest">,
  alongDir: "UP" | "DOWN",
): Terminal[] {
  const line = mtrLineCode(route.route);
  if (line === "TKL") {
    if (alongDir === "DOWN") {
      return [nameOr(db, "NOP", "North Point", "\u5317\u89d2")];
    }
    return [
      nameOr(db, "POA", "Po Lam", "\u5bf6\u7433"),
      nameOr(db, "LHP", "LOHAS Park", "\u5eb7\u57ce"),
    ];
  }
  if (line === "EAL") {
    if (alongDir === "DOWN") {
      return [nameOr(db, "ADM", "Admiralty", "\u91d1\u9418")];
    }
    return [
      nameOr(db, "LOW", "Lo Wu", "\u7f85\u6e56"),
      nameOr(db, "LMC", "Lok Ma Chau", "\u843d\u99ac\u6d32"),
    ];
  }
  return [route.dest];
}

/** Drop mid-line short-turn termini from title/chip lists (TKL: Tiu Keng Leng). */
export function filterMtrTitleVariants<T extends { dest: Terminal }>(
  lineCode: string,
  refs: T[],
): T[] {
  const line = mtrLineCode(lineCode);
  if (line !== "TKL") return refs;
  const kept = refs.filter((ref) => !isTiuKengLengDest(ref.dest));
  return kept.length ? kept : refs;
}
