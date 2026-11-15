/**
 * Smoke checks for circular (loop) search legs and counterpart-stop flip.
 * Fixtures mirror KMB 51: one outbound bound, shared-ID origin terminus,
 * 上村總站 as the turn, and two-sided stops (荃灣站 / 大帽山).
 *
 * Run: npx tsx scripts/smoke-circular-legs.ts
 */
import { circularCounterpartStop, circularSearchLegs, destAtStop } from "../src/lib/circular";
import { nearestStop } from "../src/lib/nearest";
import { oppositeBound } from "../src/lib/opposite";
import type { EtaDb, Pin, RouteListEntry, StopListEntry, Terminal } from "../src/lib/types";

const name = (zh: string, en: string): Terminal => ({ zh, en });
const loc = (lat: number, lng: number) => ({ lat, lng });

const STOPS: Record<string, { name: Terminal; location: StopListEntry["location"] }> = {
  ORIGIN: { name: name("如心廣場巴士總站", "NINA TOWER BUS TERMINUS"), location: loc(22.36821, 114.11249) },
  TAIHO: { name: name("荃灣大河道", "TAI HO ROAD TSUEN WAN"), location: loc(22.37152, 114.11499) },
  TWS_O: { name: name("荃灣站", "TSUEN WAN STATION"), location: loc(22.374, 114.11771) },
  TMS_O: { name: name("大帽山郊野公園", "TAI MO SHAN COUNTRY PARK"), location: loc(22.40743, 114.10511) },
  TURN: { name: name("上村總站", "SHEUNG TSUEN BUS TERMINUS"), location: loc(22.4321, 114.10328) },
  TMS_I: { name: name("大帽山郊野公園", "TAI MO SHAN COUNTRY PARK"), location: loc(22.4067, 114.10535) },
  TWS_I: { name: name("荃灣站", "TSUEN WAN STATION"), location: loc(22.37416, 114.11797) },
};

const LOOP_IDS = ["ORIGIN", "TAIHO", "TWS_O", "TMS_O", "TURN", "TMS_I", "TWS_I", "ORIGIN"];

function routeOf(
  id: string,
  orig: Terminal,
  dest: Terminal,
  bound: string,
  stopIds: string[],
  company: "kmb" = "kmb",
): RouteListEntry {
  return {
    route: id,
    co: [company],
    orig,
    dest,
    fares: null,
    faresHoliday: null,
    freq: null,
    jt: null,
    seq: 0,
    serviceType: "1",
    stops: { [company]: stopIds },
    bound: { [company]: bound },
    gtfsId: "",
    nlbId: "",
  };
}

const loop = routeOf(
  "51",
  name("荃灣(如心廣場)", "TSUEN WAN (NINA TOWER)"),
  name("上村(循環線)", "SHEUNG TSUEN (CIRCULAR)"),
  "O",
  LOOP_IDS,
);
const out91 = routeOf("91M", name("寶林", "PO LAM"), name("鑽石山", "DIAMOND HILL"), "O", ["A", "B", "C"]);
const in91 = routeOf("91M", name("鑽石山", "DIAMOND HILL"), name("寶林", "PO LAM"), "I", ["C", "B", "A"]);

const db: EtaDb = {
  holidays: [],
  routeList: {
    "51+loop": loop,
    "91M+O": out91,
    "91M+I": in91,
  },
  stopList: Object.fromEntries(
    Object.entries(STOPS).map(([id, stop]) => [id, stop]),
  ) as EtaDb["stopList"],
  stopMap: {},
  serviceDayMap: {},
};
db.stopList.A = { name: name("寶林", "PO LAM"), location: loc(22.32, 114.26) };
db.stopList.B = { name: name("坑口", "HANG HAU"), location: loc(22.315, 114.264) };
db.stopList.C = { name: name("鑽石山", "DIAMOND HILL"), location: loc(22.34, 114.2) };

let failed = 0;
function assert(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
}

function pinOf(routeId: string, stopId: string, stopSeq: number, company: Pin["company"] = "kmb"): Pin {
  return { id: "t", routeId, company, stopId, stopSeq };
}

const legs = circularSearchLegs(db, loop, "kmb");
assert("loop has two search legs", legs?.length === 2, JSON.stringify(legs?.map((row) => row.dest.zh)));
assert("out dest", legs?.[0]?.dest.zh === "上村(循環線)");
assert("back dest", legs?.[1]?.dest.zh === "荃灣(如心廣場)");
assert("out orig", legs?.[0]?.orig.zh === "荃灣(如心廣場)");
assert("back orig", legs?.[1]?.orig.zh === "上村(循環線)");
assert("en out dest", legs?.[0]?.dest.en === "SHEUNG TSUEN (CIRCULAR)");
assert("en back dest", legs?.[1]?.dest.en === "TSUEN WAN (NINA TOWER)");

assert("91M is not split", circularSearchLegs(db, out91, "kmb") == null);
assert("91M inbound is not split", circularSearchLegs(db, in91, "kmb") == null);

const twsOut = LOOP_IDS.indexOf("TWS_O");
const twsBack = LOOP_IDS.indexOf("TWS_I");
const tmsOut = LOOP_IDS.indexOf("TMS_O");
const tmsBack = LOOP_IDS.indexOf("TMS_I");
const turn = LOOP_IDS.indexOf("TURN");

assert("tws out dest", destAtStop(db, loop, "kmb", "TWS_O", twsOut).zh === "上村(循環線)");
assert("tws back dest", destAtStop(db, loop, "kmb", "TWS_I", twsBack).zh === "荃灣(如心廣場)");
assert("turn dest is orig", destAtStop(db, loop, "kmb", "TURN", turn).zh === "荃灣(如心廣場)");

const twsFlip = circularCounterpartStop(db, loop, "kmb", "TWS_O", twsOut);
assert("荃灣站 flip", twsFlip?.stopId === "TWS_I" && twsFlip?.stopSeq === twsBack, JSON.stringify(twsFlip));
const tmsFlip = circularCounterpartStop(db, loop, "kmb", "TMS_O", tmsOut);
assert("大帽山 flip", tmsFlip?.stopId === "TMS_I" && tmsFlip?.stopSeq === tmsBack, JSON.stringify(tmsFlip));
assert("turning terminus hides switch", circularCounterpartStop(db, loop, "kmb", "TURN", turn) == null);
assert("shared-id origin hides switch", circularCounterpartStop(db, loop, "kmb", "ORIGIN", 0) == null);
assert(
  "shared-id last hides switch",
  circularCounterpartStop(db, loop, "kmb", "ORIGIN", LOOP_IDS.length - 1) == null,
);
assert("one-sided 荃灣大河道 hides switch", circularCounterpartStop(db, loop, "kmb", "TAIHO", 1) == null);

const loopFlip = oppositeBound(db, pinOf("51+loop", "TWS_O", twsOut));
assert(
  "oppositeBound uses counterpart stop",
  loopFlip?.routeId === "51+loop" && loopFlip?.stopId === "TWS_I",
  JSON.stringify(loopFlip && { id: loopFlip.routeId, stop: loopFlip.stopId, seq: loopFlip.stopSeq }),
);

const twoFlip = oppositeBound(db, pinOf("91M+O", "B", 1));
assert(
  "91M flip is official inbound",
  twoFlip?.routeId === "91M+I" && twoFlip?.stopId == null,
  JSON.stringify(twoFlip && { id: twoFlip.routeId, dest: twoFlip.route.dest.zh, stop: twoFlip.stopId }),
);

const twsLoc = STOPS.TWS_O.location;
const nearOut = nearestStop(db, loop, "kmb", twsLoc, { preferDest: loop.dest });
const nearBack = nearestStop(db, loop, "kmb", twsLoc, { preferDest: loop.orig });
assert("search out prefers outbound 荃灣站", nearOut?.stopId === "TWS_O", JSON.stringify(nearOut));
assert("search back prefers return 荃灣站", nearBack?.stopId === "TWS_I", JSON.stringify(nearBack));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
