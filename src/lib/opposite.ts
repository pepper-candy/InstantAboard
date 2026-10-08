import { mtrLineCode } from "./colors";
import type { Company, EtaDb, Pin, RouteListEntry } from "./types";

function sameStopId(a: string, b: string): boolean {
  return a.replace(/^mtr:/i, "") === b.replace(/^mtr:/i, "");
}

function mtrDir(bound: string | undefined): "UP" | "DOWN" | null {
  const b = (bound ?? "").toUpperCase();
  if (b.includes("DT")) return "DOWN";
  if (b.includes("UT")) return "UP";
  return null;
}

function isMainMtrBound(bound: string | undefined): boolean {
  const b = (bound ?? "").toUpperCase();
  return b === "UT" || b === "DT";
}

function inbound(bound: string | undefined): boolean {
  const b = (bound ?? "").toUpperCase();
  return b.startsWith("I") || b.includes("DT") || b === "2";
}

function stopSeq(route: RouteListEntry, company: Company, stopId: string): number {
  return (route.stops[company] ?? []).findIndex((id) => sameStopId(id, stopId));
}

/** Opposite bound of the same line/route at this stop, or null if none. */
export function oppositePin(db: EtaDb, pin: Pin): Pick<Pin, "routeId" | "stopId" | "stopSeq"> | null {
  const route = db.routeList[pin.routeId];
  if (!route) return null;
  const company = pin.company;

  if (company === "mtr") {
    const line = mtrLineCode(route.route);
    const here = mtrDir(route.bound.mtr);
    const want = here === "UP" ? "DOWN" : "UP";
    let best: { routeId: string; stopSeq: number; main: boolean; stops: number } | null = null;
    for (const [id, other] of Object.entries(db.routeList)) {
      if (!other.co.includes("mtr")) continue;
      if (mtrLineCode(other.route) !== line) continue;
      if (mtrDir(other.bound.mtr) !== want) continue;
      const seq = stopSeq(other, "mtr", pin.stopId);
      if (seq < 0) continue;
      const main = isMainMtrBound(other.bound.mtr);
      const stops = (other.stops.mtr ?? []).length;
      if (!best || (main && !best.main) || (main === best.main && stops > best.stops)) {
        best = { routeId: id, stopSeq: seq, main, stops };
      }
    }
    return best ? { routeId: best.routeId, stopId: pin.stopId, stopSeq: best.stopSeq } : null;
  }

  const hereIn = inbound(route.bound[company]);
  let best: { routeId: string; stopSeq: number; stops: number } | null = null;
  for (const [id, other] of Object.entries(db.routeList)) {
    if (id === pin.routeId || !other.co.includes(company)) continue;
    if (other.route !== route.route) continue;
    if (inbound(other.bound[company]) === hereIn) continue;
    const seq = stopSeq(other, company, pin.stopId);
    if (seq < 0) continue;
    const stops = (other.stops[company] ?? []).length;
    if (!best || stops > best.stops) best = { routeId: id, stopSeq: seq, stops };
  }
  return best ? { routeId: best.routeId, stopId: pin.stopId, stopSeq: best.stopSeq } : null;
}
