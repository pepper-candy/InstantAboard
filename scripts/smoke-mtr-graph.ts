/**
 * Smoke checks for the MTR branch Y-graph (no network, no UI).
 * Fixtures mirror the real routeList entries (EAL UT / LMC-UT / DT / LMC-DT,
 * TKL UT / DT, TKS-UT / TKS-DT) with synthetic polylines that share the
 * spine geometry exactly, so junction cuts are deterministic.
 *
 * Run: npx tsx scripts/smoke-mtr-graph.ts
 */
import { distancesOnPath, haversine, pathLength, type LatLng } from "../src/lib/geo";
import { mtrDestCode, type MtrArmRoute } from "../src/lib/mtrBranches";
import { buildMtrLineGraph } from "../src/lib/mtrLineGraph";
import { placeMtrFleetOnGraph } from "../src/lib/mtrFleet";
import { dedupeMergedArmClocks, type StopClock } from "../src/lib/routeClocks";
import type { EtaDb, RouteListEntry } from "../src/lib/types";

const LOCS: Record<string, [number, number]> = {
  ADM: [22.279, 114.165], EXC: [22.283, 114.173], HUH: [22.303, 114.182],
  MKK: [22.319, 114.169], KOT: [22.33, 114.165], TAW: [22.383, 114.19],
  SHT: [22.382, 114.189], FOT: [22.398, 114.198], UNI: [22.414, 114.211],
  TAP: [22.453, 114.164], TWO: [22.452, 114.171], FAN: [22.492, 114.138],
  SHS: [22.501, 114.128], LOW: [22.529, 114.113], LMC: [22.514, 114.068],
  RAC: [22.4003, 114.2028],
  NOP: [22.291, 114.202], QUB: [22.298, 114.209], YAT: [22.307, 114.223],
  TIK: [22.304, 114.253], TKO: [22.308, 114.265], HAH: [22.3155, 114.2647],
  POA: [22.322, 114.258], LHP: [22.295, 114.273],
};

const EAL_UP = ["ADM", "EXC", "HUH", "MKK", "KOT", "TAW", "SHT", "FOT", "UNI", "TAP", "TWO", "FAN", "SHS", "LOW"];
const EAL_DOWN = ["LOW", "SHS", "FAN", "TWO", "TAP", "UNI", "FOT", "SHT", "TAW", "KOT", "MKK", "HUH", "EXC", "ADM"];
const TKL_UP = ["NOP", "QUB", "YAT", "TIK", "TKO", "HAH", "POA"];
const TKL_DOWN = ["POA", "HAH", "TKO", "TIK", "YAT", "QUB", "NOP"];

let failed = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
}

function pt(code: string): LatLng {
  const loc = LOCS[code];
  if (!loc) throw new Error(`missing loc ${code}`);
  return { lat: loc[0], lng: loc[1] };
}

function lineOf(stops: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i];
    if (!a) continue;
    out.push(a);
    const b = stops[i + 1];
    if (b) out.push({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
  }
  return out;
}

function routeOf(id: string, bound: string, orig: string, dest: string, stops: string[]): RouteListEntry {
  return {
    route: id.startsWith("TKL") ? "TKL" : "EAL",
    co: ["mtr"],
    orig: { en: orig, zh: orig },
    dest: { en: dest, zh: dest },
    fares: null,
    faresHoliday: null,
    freq: null,
    jt: null,
    seq: 0,
    serviceType: "1",
    stops: { mtr: stops },
    bound: { mtr: bound },
    gtfsId: "",
    nlbId: "",
  };
}

function armOf(routeId: string, route: RouteListEntry, dir: "UP" | "DOWN", main: boolean, shapeName: string): MtrArmRoute {
  const stopIds = route.stops.mtr ?? [];
  const stops = stopIds.map(pt);
  return { routeId, route, dir, main, racecourse: false, stops, stopIds, shapeName };
}

function minDist(p: LatLng, path: LatLng[]): number {
  if (path.length === 1) return haversine(p, path[0]!);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const q = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      best = Math.min(best, haversine(p, q));
    }
  }
  return best;
}

function makeDb(): EtaDb {
  const stopList: EtaDb["stopList"] = {};
  for (const [code, loc] of Object.entries(LOCS)) {
    stopList[code] = { name: { en: code, zh: code }, location: { lat: loc[0], lng: loc[1] } };
  }
  return { holidays: [], routeList: {}, stopList, stopMap: {}, serviceDayMap: {} };
}

function clockOf(dest: string | undefined, n: number, alive: Array<[number, number]>): StopClock {
  const seconds: Array<number | null> = new Array<number | null>(n).fill(null);
  const stamps: Array<number | null> = new Array<number | null>(n).fill(null);
  const now = Date.now();
  for (const [idx, sec] of alive) {
    seconds[idx] = sec;
    stamps[idx] = now;
  }
  return { id: `t-${dest ?? "x"}`, seconds, stamps, dest, bound: "UP", reverse: false };
}

const db = makeDb();

// ---- fixtures ----
const ealUt = routeOf("EAL+1+Admiralty+Lo Wu", "UT", "Admiralty", "Lo Wu", EAL_UP);
const ealLmcUt = routeOf("EAL+1+Admiralty+Lok Ma Chau", "LMC-UT", "Admiralty", "Lok Ma Chau", [...EAL_UP.slice(0, 13), "LMC"]);
const ealDt = routeOf("EAL+1+Lo Wu+Admiralty", "DT", "Lo Wu", "Admiralty", EAL_DOWN);
const ealLmcDt = routeOf("EAL+1+Lok Ma Chau+Admiralty", "LMC-DT", "Lok Ma Chau", "Admiralty", ["LMC", ...EAL_DOWN.slice(1)]);
const tklUt = routeOf("TKL+1+North Point+Po Lam", "UT", "North Point", "Po Lam", TKL_UP);
const tklTksUt = routeOf("TKL+1+Tiu Keng Leng+LOHAS Park", "TKS-UT", "Tiu Keng Leng", "LOHAS Park", ["TIK", "TKO", "LHP"]);
const tklDt = routeOf("TKL+1+Po Lam+North Point", "DT", "Po Lam", "North Point", TKL_DOWN);
const tklTksDt = routeOf("TKL+1+LOHAS Park+Tiu Keng Leng", "TKS-DT", "LOHAS Park", "Tiu Keng Leng", ["LHP", "TKO", "TIK"]);

db.routeList["EAL+1+Admiralty+Lo Wu"] = ealUt;
db.routeList["EAL+1+Admiralty+Lok Ma Chau"] = ealLmcUt;
db.routeList["EAL+1+Lo Wu+Admiralty"] = ealDt;
db.routeList["EAL+1+Lok Ma Chau+Admiralty"] = ealLmcDt;
db.routeList["TKL+1+North Point+Po Lam"] = tklUt;
db.routeList["TKL+1+Tiu Keng Leng+LOHAS Park"] = tklTksUt;
db.routeList["TKL+1+Po Lam+North Point"] = tklDt;
db.routeList["TKL+1+LOHAS Park+Tiu Keng Leng"] = tklTksDt;

// Shared-geometry synthetic lines: branch lines reuse the main line's spine vertices.
const ealUtLine = lineOf(EAL_UP.map(pt));
const shsIdx = ealUtLine.findIndex((p) => Math.abs(p.lat - pt("SHS").lat) < 1e-9 && Math.abs(p.lng - pt("SHS").lng) < 1e-9);
const ealLmcUtLine = [...ealUtLine.slice(0, shsIdx + 1), { lat: (pt("SHS").lat + pt("LMC").lat) / 2, lng: (pt("SHS").lng + pt("LMC").lng) / 2 }, pt("LMC")];
const ealDtLine = lineOf(EAL_DOWN.map(pt));
const ealLmcDtLine = [pt("LMC"), { lat: (pt("LMC").lat + pt("SHS").lat) / 2, lng: (pt("LMC").lng + pt("SHS").lng) / 2 }, ...ealDtLine.slice(ealDtLine.findIndex((p) => Math.abs(p.lat - pt("SHS").lat) < 1e-9 && Math.abs(p.lng - pt("SHS").lng) < 1e-9))];
const tklUtLine = lineOf(TKL_UP.map(pt));
const tklTksUtLine = lineOf(["TIK", "TKO", "LHP"].map(pt));
const tklDtLine = lineOf(TKL_DOWN.map(pt));
const tklTksDtLine = lineOf(["LHP", "TKO", "TIK"].map(pt));

// ---- build graphs ----
const ealUp = buildMtrLineGraph(db, "EAL", "UP", [
  { arm: armOf("EAL+1+Admiralty+Lo Wu", ealUt, "UP", true, "mtr-EAL-UT-1-0.json"), line: ealUtLine },
  { arm: armOf("EAL+1+Admiralty+Lok Ma Chau", ealLmcUt, "UP", false, "mtr-EAL-LMC-UT-1-0.json"), line: ealLmcUtLine },
], "EAL+1+Admiralty+Lo Wu");
const ealDown = buildMtrLineGraph(db, "EAL", "DOWN", [
  { arm: armOf("EAL+1+Lo Wu+Admiralty", ealDt, "DOWN", true, "mtr-EAL-DT-1-0.json"), line: ealDtLine },
  { arm: armOf("EAL+1+Lok Ma Chau+Admiralty", ealLmcDt, "DOWN", false, "mtr-EAL-LMC-DT-1-0.json"), line: ealLmcDtLine },
], "EAL+1+Lo Wu+Admiralty");
const tklUp = buildMtrLineGraph(db, "TKL", "UP", [
  { arm: armOf("TKL+1+North Point+Po Lam", tklUt, "UP", true, "mtr-TKL-UT-1-0.json"), line: tklUtLine },
  { arm: armOf("TKL+1+Tiu Keng Leng+LOHAS Park", tklTksUt, "UP", false, "mtr-TKL-TKS-UT-1-0.json"), line: tklTksUtLine },
], "TKL+1+North Point+Po Lam");
const tklDown = buildMtrLineGraph(db, "TKL", "DOWN", [
  { arm: armOf("TKL+1+Po Lam+North Point", tklDt, "DOWN", true, "mtr-TKL-DT-1-0.json"), line: tklDtLine },
  { arm: armOf("TKL+1+LOHAS Park+Tiu Keng Leng", tklTksDt, "DOWN", false, "mtr-TKL-TKS-DT-1-0.json"), line: tklTksDtLine },
], "TKL+1+Po Lam+North Point");

if (!ealUp || !ealDown || !tklUp || !tklDown) {
  console.log("FAIL graph construction returned null");
  process.exit(1);
}

// ---- EAL UP ----
assert("EAL UP: arms LOW/LMC/RAC", ealUp.arms.map((a) => a.key).join(",") === "LOW,LMC,RAC");
const lowArm = ealUp.arms.find((a) => a.key === "LOW");
const lmcArm = ealUp.arms.find((a) => a.key === "LMC");
const racArmUp = ealUp.arms.find((a) => a.key === "RAC");
assert("EAL UP: spine is the LOW arm", Boolean(lowArm && lowArm.path === ealUp.spine));
assert("EAL UP: LMC arm has SHS then LMC", Boolean(lmcArm && lmcArm.stopIds[lmcArm.stopIds.length - 1] === "LMC" && lmcArm.stopIds.includes("SHS")));
assert("EAL UP: 2 stubs (LMC stub + RAC peel→RAC)", ealUp.stubs.length === 2, `got ${ealUp.stubs.length}`);
const lmcStub = ealUp.stubs.find((s) => s.length && minDist(pt("LMC"), s) < 150);
const racSpur = ealUp.stubs.find((s) => minDist(pt("RAC"), s) < 60);
assert("EAL UP: LMC stub starts at SHS", Boolean(lmcStub && minDist(pt("SHS"), [lmcStub[0]!]) < 100));
// Spine drawn once: apart from the junction itself, no stub vertex may ride the spine.
assert("EAL UP: LMC stub leaves the spine after the junction", Boolean(lmcStub && lmcStub.every((p) => minDist(p, [pt("SHS")]) < 100 || minDist(p, ealUp.spine) > 40)));
assert("EAL UP: RAC peel→RAC spur drawn", Boolean(racSpur));
if (lmcArm) {
  const dists = distancesOnPath(lmcArm.path, lmcArm.stops);
  const total = pathLength(lmcArm.path);
  assert("EAL UP: LMC past SHS along the path", dists[12]! < dists[13]! && total - dists[13]! < total * 0.05, `SHS=${dists[12]?.toFixed(0)}m LMC=${dists[13]?.toFixed(0)}m total=${total.toFixed(0)}m`);
  assert("EAL UP: LMC path never visits LOW", minDist(pt("LOW"), lmcArm.path) > 2000);
}
if (racArmUp) {
  assert("EAL UP: RAC arm ends at 馬場", minDist(pt("RAC"), [racArmUp.path[racArmUp.path.length - 1]!]) < 200);
  assert("EAL UP: RAC arm stops end with RAC", racArmUp.stopIds[racArmUp.stopIds.length - 1] === "RAC");
}

// ---- EAL DOWN ----
const lmcArmDown = ealDown.arms.find((a) => a.key === "LMC");
assert("EAL DOWN: arms LOW/LMC/RAC", ealDown.arms.map((a) => a.key).join(",") === "LOW,LMC,RAC");
if (lmcArmDown) {
  const first = lmcArmDown.path[0]!;
  const last = lmcArmDown.path[lmcArmDown.path.length - 1]!;
  assert("EAL DOWN: LMC arm starts at LMC, ends at ADM", minDist(pt("LMC"), [first]) < 300 && minDist(pt("ADM"), [last]) < 300);
  const dists = distancesOnPath(lmcArmDown.path, lmcArmDown.stops);
  const monotonic = dists.every((d, i) => i === 0 || d >= (dists[i - 1] ?? 0) - 1);
  assert("EAL DOWN: merge concat follows travel order (no double-back)", monotonic);
  assert("EAL DOWN: LMC arm never visits LOW", minDist(pt("LOW"), lmcArmDown.path) > 2000);
}

// ---- TKL UP ----
const lhpArm = tklUp.arms.find((a) => a.key === "LHP");
const poaArm = tklUp.arms.find((a) => a.key === "POA");
assert("TKL UP: arms POA/LHP", tklUp.arms.map((a) => a.key).join(",") === "POA,LHP");
assert("TKL UP: LHP arm extends the spine to NOP", Boolean(lhpArm && lhpArm.stopIds.join(",") === "NOP,QUB,YAT,TIK,TKO,LHP"), lhpArm?.stopIds.join(","));
assert("TKL UP: Hang Hau is NOT on the LHP arm", Boolean(lhpArm && !lhpArm.stopIds.includes("HAH")));
if (lhpArm) assert("TKL UP: LHP path stays clear of Hang Hau", minDist(pt("HAH"), lhpArm.path) > 300, `${minDist(pt("HAH"), lhpArm.path).toFixed(0)}m`);
if (poaArm) assert("TKL UP: Po Lam (main) arm passes Hang Hau", minDist(pt("HAH"), poaArm.path) < 100);
const lhpStub = tklUp.stubs.find((s) => s.length && minDist(pt("LHP"), s) < 150);
assert("TKL UP: LHP stub starts at the TKO junction", Boolean(lhpStub && minDist(pt("TKO"), [lhpStub[0]!]) < 100));

// ---- placement on the Y-graph ----
if (lowArm && lmcArm && racArmUp) {
  const lowClock = clockOf("LOW", 14, [[13, 60]]);
  const lmcClock = clockOf("LMC", 14, [[13, 60]]);
  const racClock = clockOf("RAC", racArmUp.stopIds.length, [[racArmUp.stopIds.length - 1, 60]]);
  const noDestClock = clockOf(undefined, 14, [[13, 60]]);
  const dots = placeMtrFleetOnGraph(ealUp, [lowClock, lmcClock, racClock, noDestClock], Date.now());
  assert("placement: 4 dots for 4 clocks", dots.length === 4, `got ${dots.length}`);
  const byDest = new Map<string, (typeof dots)[number][]>();
  for (const dot of dots) {
    const key = dot.track ? (minDist(pt("RAC"), dot.track) < 200 ? "RAC" : minDist(pt("LMC"), dot.track) < 200 ? "LMC" : "LOW") : "none";
    const list = byDest.get(key) ?? [];
    list.push(dot);
    byDest.set(key, list);
  }
  assert("placement: RAC clock rides the spur", (byDest.get("RAC")?.length ?? 0) === 1);
  assert("placement: LMC clock rides the LMC arm", (byDest.get("LMC")?.length ?? 0) === 1);
  assert("placement: LOW + unknown-dest clocks ride the spine arm", (byDest.get("LOW")?.length ?? 0) === 2);
  const onlyRegular = placeMtrFleetOnGraph(ealUp, [lowClock, lmcClock, noDestClock], Date.now());
  // Non-RAC tracks may legitimately pass ~240m from the synthetic RAC point (the
  // FOT–UNI chord); the spur itself ends AT the RAC vertex, so a cart on the
  // spur would measure ≈0m.
  assert(
    "placement: no RAC cart without a RAC clock",
    onlyRegular.every((dot) => !dot.track || minDist(pt("RAC"), dot.track) > 100),
    onlyRegular.map((dot) => (dot.track ? minDist(pt("RAC"), dot.track).toFixed(0) : "no-track")).join(","),
  );
}

// ---- DOWN travel order: reversed branch shape must not double-back ----
{
  const reversedLmcDtLine = [...ealLmcDtLine].reverse();
  const badDown = buildMtrLineGraph(db, "EAL", "DOWN", [
    { arm: armOf("EAL+1+Lo Wu+Admiralty", ealDt, "DOWN", true, "mtr-EAL-DT-1-0.json"), line: ealDtLine },
    { arm: armOf("EAL+1+Lok Ma Chau+Admiralty", ealLmcDt, "DOWN", false, "mtr-EAL-LMC-DT-1-0.json"), line: reversedLmcDtLine },
  ], "EAL+1+Lo Wu+Admiralty");
  const badLmc = badDown?.arms.find((a) => a.key === "LMC");
  // Without the terminal guard the concat would run ADM→SHS + SHS→ADM (a double-back
  // twice as long as the branch's own line). The guard must fall back instead.
  assert(
    "DOWN: reversed branch shape falls back, no double-back concat",
    Boolean(badLmc && badLmc.path.length === reversedLmcDtLine.length),
    badLmc ? `path=${badLmc.path.length} branch=${reversedLmcDtLine.length}` : "no arm",
  );
}

// ---- DOWN merge dedupe ----
const mainIds = ["LOW", "SHS", "FAN", "ADM"];
const branchIds = ["LMC", "SHS", "FAN", "ADM"];
const mk = (id: string, values: Array<number | null>): StopClock => {
  const now = Date.now();
  return { id, seconds: values, stamps: values.map((v) => (v == null ? null : now)), dest: id.startsWith("LMC") ? "LMC" : "LOW", bound: "DOWN", reverse: false };
};
const mainReal = mk("A", [300, 600, 900, 1200]);
const mainPhantom = mk("P", [null, 600, 900, 1200]);
const branchReal = mk("Z", [300, 600, 900, 1200]);
const branchPhantom = mk("Q", [null, 600, 900, 1200]);
const deduped = dedupeMergedArmClocks([
  { key: "LOW", main: true, stopIds: mainIds, clocks: [mainReal, mainPhantom] },
  { key: "LMC", main: false, stopIds: branchIds, clocks: [branchReal, branchPhantom] },
]);
assert("dedupe: keeps the two real trains", deduped.length === 2 && deduped.some((c) => c.id === "A") && deduped.some((c) => c.id === "Z"), deduped.map((c) => c.id).join(","));
assert("dedupe: drops both phantom chains", !deduped.some((c) => c.id === "P" || c.id === "Q"));

// ---- dest code normalization ----
assert("mtrDestCode: names → codes", mtrDestCode("LO WU") === "LOW" && mtrDestCode("Lok Ma Chau") === "LMC" && mtrDestCode({ en: "LOHAS Park", zh: "康城" }) === "LHP" && mtrDestCode("馬場") === "RAC");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
