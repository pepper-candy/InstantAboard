/**
 * Smoke checks for the TKL/EAL DOWN branch fingerprint (no network, no UI).
 * linkDownArmTrains must assign each DOWN logical train a single origin arm
 * ("comes from" Po Lam / LOHAS) and never fan one shared-station ETA into two
 * full-arm trains.
 *
 * Run: npx tsx scripts/smoke-mtr-down-arms.ts
 */
import { linkDownArmTrains, type MtrHit, type StopClock } from "../src/lib/routeClocks";

const BASE = 1_700_000_000_000; // arbitrary fixed "now" (ms)
const POA_ARM = { key: "POA", main: true, stopIds: ["POA", "HAH", "TKO", "TIK", "NOP"] };
const LHP_ARM = { key: "LHP", main: false, stopIds: ["LHP", "TKO", "TIK", "NOP"] };

let failed = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
}

/** seconds = seconds-until-arrival; etaMs is absolute. */
function hit(seconds: number, dest = "ADM"): MtrHit {
  return { seq: 0, seconds, etaMs: BASE + seconds * 1000, stampMs: BASE, dest };
}

function byCode(rows: Record<string, number[]>): Map<string, MtrHit[]> {
  const map = new Map<string, MtrHit[]>();
  for (const [code, secs] of Object.entries(rows)) map.set(code, secs.map((s) => hit(s)));
  return map;
}

/** Origin (dest) of each clock, plus whether it carries a junction (TKO) ETA. */
function summarize(clocks: StopClock[]): Array<{ dest: string; atTko: boolean }> {
  return clocks.map((c) => {
    // dest is the arm key set by linkDownArmTrains; junction = TKO at index (POA arm:2 / LHP arm:1)
    const tkoIdx = c.dest === "POA" ? 2 : 1;
    return { dest: c.dest ?? "", atTko: (c.seconds[tkoIdx] ?? null) != null };
  });
}

// ---- Scenario A: clean interleaved Po Lam / LOHAS departures ----
// POA train A: POA=100 HAH=250 TKO=400 TIK=550 NOP=700
// LOHAS train B: LHP=200 TKO=350 TIK=500 NOP=650
// POA train C: POA=400 HAH=550 TKO=700 TIK=850 NOP=1000
// LOHAS train D: LHP=500 TKO=650 TIK=800 NOP=950
const a = linkDownArmTrains(
  byCode({
    POA: [100, 400],
    HAH: [250, 550],
    LHP: [200, 500],
    TKO: [350, 400, 650, 700],
    TIK: [500, 550, 800, 850],
    NOP: [650, 700, 950, 1000],
  }),
  [POA_ARM, LHP_ARM],
);
const aSum = summarize(a);
assert(
  "A: one sim per TKO ETA (4 spine trains, no fanning)",
  aSum.filter((s) => s.atTko).length === 4,
  `got ${aSum.filter((s) => s.atTko).length}`,
);
assert(
  "A: origins POA/LHP interleaved correctly",
  aSum.map((s) => s.dest).join(",") === "LHP,POA,LHP,POA",
  aSum.map((s) => s.dest).join(","),
);
assert("A: every clock is bound DOWN", a.every((c) => c.bound === "DOWN"));
assert(
  "A: clocks indexed by their own arm stop list",
  a.every((c) => (c.dest === "POA" ? c.seconds.length === 5 : c.seconds.length === 4)),
);

// ---- Scenario B: in-transit spine train (no stub) + far stub-only train ----
// POA train A: POA=100 HAH=250 TKO=400 TIK=550 NOP=700
// LOHAS train B: LHP=200 TKO=350 TIK=500 NOP=650
// In-transit POA train X (already past HAH): TKO=700 TIK=850 NOP=1000 → gap-fill default POA
// LOHAS train Y still at terminus: LHP=1800 → stub-only LHP
const b = linkDownArmTrains(
  byCode({
    POA: [100],
    HAH: [250],
    LHP: [200, 1800],
    TKO: [350, 400, 700],
    TIK: [500, 550, 850],
    NOP: [650, 700, 1000],
  }),
  [POA_ARM, LHP_ARM],
);
const bSum = summarize(b);
assert(
  "B: 3 spine trains + 1 stub-only train",
  bSum.filter((s) => s.atTko).length === 3 && bSum.length === 4,
  `spine=${bSum.filter((s) => s.atTko).length} total=${bSum.length}`,
);
assert(
  "B: gap-fill defaults the in-transit train to Po Lam",
  bSum.map((s) => s.dest).join(",") === "LHP,POA,POA,LHP",
  bSum.map((s) => s.dest).join(","),
);
assert(
  "B: stub-only LOHAS train sits at LHP with no spine ETA",
  (() => {
    const stub = b.find((c) => c.dest === "LHP" && !bSum[b.indexOf(c)]?.atTko);
    return Boolean(stub && (stub.seconds[0] ?? null) != null && (stub.seconds[1] ?? null) == null);
  })(),
);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
