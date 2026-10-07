import type { Arrival, Company, EtaDb, Pin, RouteListEntry, Terminal } from "./types";
import { hktParts, hktYmd, minutesOfDay, minutesUntilHktClockOpen, minutesUntilIso, parseHhmm } from "./time";

const emptyRemark = (): Terminal => ({ en: "", zh: "" });

export async function fetchArrivals(db: EtaDb, pin: Pin, lang: "en" | "zh"): Promise<Arrival[]> {
  const route = db.routeList[pin.routeId];
  if (!route) return [];
  const company = pin.company;
  try {
    switch (company) {
      case "kmb":
        return await fetchKmb(route, pin);
      case "ctb":
        return await fetchCtb(route, pin);
      case "gmb":
        return await fetchGmb(route, pin);
      case "nlb":
        return await fetchNlb(route, pin);
      case "mtr":
        return await fetchMtr(db, route, pin);
      case "tram":
        return scheduledArrivals(db, route);
      case "lightRail":
        return await fetchLrt(route, pin);
      case "lrtfeeder":
        return await fetchMtrBus(route, pin);
      case "sunferry":
        return await fetchSunFerry(route, pin, db);
      case "hkkf":
      case "fortuneferry":
        return scheduledArrivals(db, route);
      default:
        return scheduledArrivals(db, route);
    }
  } catch (error) {
    if (company === "sunferry" || company === "hkkf" || company === "fortuneferry") {
      return scheduledArrivals(db, route);
    }
    throw error;
  } finally {
    void lang;
  }
}

async function fetchKmb(route: RouteListEntry, pin: Pin): Promise<Arrival[]> {
  const service = route.serviceType || "1";
  const url = `https://data.etabus.gov.hk/v1/transport/kmb/eta/${pin.stopId}/${route.route}/${service}`;
  const json = await getJson<{
    data?: Array<{
      dir?: string;
      dest_en?: string;
      dest_tc?: string;
      eta?: string | null;
      rmk_en?: string;
      rmk_tc?: string;
    }>;
  }>(url);
  const bound = (route.bound.kmb ?? "O").slice(0, 1);
  const dest = route.dest.en.toUpperCase();
  const rows = (json.data ?? []).filter((row) => {
    if (row.dir && row.dir.slice(0, 1) === bound) return true;
    return (row.dest_en ?? "").toUpperCase().includes(dest.slice(0, 8));
  });
  return takeThree(
    rows.map((row) =>
      arrivalFromIso(row.eta, { en: row.rmk_en ?? "", zh: row.rmk_tc ?? "" }),
    ),
  );
}

async function fetchCtb(route: RouteListEntry, pin: Pin): Promise<Arrival[]> {
  const url = `https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${pin.stopId}/${route.route}`;
  const json = await getJson<{
    data?: Array<{
      dir?: string;
      dest_en?: string;
      dest_tc?: string;
      eta?: string | null;
      rmk_en?: string;
      rmk_tc?: string;
    }>;
  }>(url);
  const bound = (route.bound.ctb ?? "O").slice(0, 1);
  const dest = route.dest.en.toUpperCase();
  const rows = (json.data ?? []).filter((row) => {
    if (row.dir && row.dir.slice(0, 1) === bound) return true;
    return (row.dest_en ?? "").toUpperCase().includes(dest.slice(0, 8));
  });
  return takeThree(
    rows.map((row) =>
      arrivalFromIso(row.eta, { en: row.rmk_en ?? "", zh: row.rmk_tc ?? "" }),
    ),
  );
}

async function fetchGmb(route: RouteListEntry, pin: Pin): Promise<Arrival[]> {
  const routeId = route.gtfsId;
  const routeSeq = boundToSeq(route.bound.gmb);
  const stopSeq = pin.stopSeq + 1;
  if (routeId) {
    const url = `https://data.etagmb.gov.hk/eta/route-stop/${routeId}/${routeSeq}/${stopSeq}`;
    const json = await getJson<{
      data?: { eta?: Array<{ timestamp?: string; remarks_en?: string; remarks_tc?: string; diff?: number }> };
    }>(url);
    const rows = json.data?.eta ?? [];
    if (rows.length) {
      return takeThree(
        rows.map((row) =>
          arrivalFromIso(row.timestamp, { en: row.remarks_en ?? "", zh: row.remarks_tc ?? "" }, row.diff),
        ),
      );
    }
  }
  const stopUrl = `https://data.etagmb.gov.hk/eta/stop/${pin.stopId}`;
  const stopJson = await getJson<{
    data?: Array<{
      route_id?: number | string;
      route_seq?: number;
      eta?: Array<{ timestamp?: string; remarks_en?: string; remarks_tc?: string; diff?: number }>;
    }>;
  }>(stopUrl);
  const wanted = String(routeId);
  const match = (stopJson.data ?? []).find(
    (row) => String(row.route_id) === wanted && (!row.route_seq || row.route_seq === routeSeq),
  );
  const rows = match?.eta ?? [];
  return takeThree(
    rows.map((row) =>
      arrivalFromIso(row.timestamp, { en: row.remarks_en ?? "", zh: row.remarks_tc ?? "" }, row.diff),
    ),
  );
}

async function fetchNlb(route: RouteListEntry, pin: Pin): Promise<Arrival[]> {
  const routeId = route.nlbId;
  if (!routeId) return [];
  const url = `https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrival&routeId=${encodeURIComponent(routeId)}&stopId=${encodeURIComponent(pin.stopId)}&language=en`;
  const json = await getJson<{
    estimatedArrivals?: Array<{ estimatedArrivalTime?: string; departed?: number; routeVariantName?: string }>;
  }>(url);
  return takeThree(
    (json.estimatedArrivals ?? [])
      .filter((row) => !row.departed)
      .map((row) => arrivalFromIso(row.estimatedArrivalTime, emptyRemark())),
  );
}

async function fetchMtr(db: EtaDb, route: RouteListEntry, pin: Pin): Promise<Arrival[]> {
  const line = (route.route.split("-")[0] ?? route.route).toUpperCase();
  const sta = pin.stopId.replace(/^mtr:/i, "").toUpperCase();
  const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(sta)}`;
  const res = await fetch(url);
  const json = (await res.json().catch(() => null)) as {
    data?: Record<string, { UP?: MtrTrain[]; DOWN?: MtrTrain[] }>;
  } | null;
  const key = `${line}-${sta}`;
  const block = json?.data?.[key] ?? Object.values(json?.data ?? {})[0];
  if (!res.ok) throw new Error(`mtr ${res.status}`);
  const up = block?.UP ?? [];
  const down = block?.DOWN ?? [];
  if (!block || (up.length === 0 && down.length === 0)) {
    if (process.env.NODE_ENV !== "production") console.warn("[mtr]", url, json);
    if (!block) return [];
  }
  const label = (code?: string): Terminal => {
    if (!code) return emptyRemark();
    return db.stopList[code]?.name ?? { en: code, zh: code };
  };
  const toRows = (trains: MtrTrain[], dir: string) =>
    trains.slice(0, 8).map((t) => {
      const minutes = t.ttnt != null ? Math.max(0, Number(t.ttnt)) : minutesUntilIso(t.time ?? null);
      return {
        minutes: Number.isFinite(minutes) ? minutes : null,
        at: t.time ?? null,
        remark: emptyRemark(),
        estimated: false,
        gps: false,
        dest: label(t.dest),
        destCode: t.dest,
        plat: t.plat,
        dir,
      };
    });
  if (pin.bothWays !== false) {
    return [...toRows(up, "UP"), ...toRows(down, "DOWN")];
  }
  const bound = (route.bound.mtr ?? "UT").toUpperCase();
  const dir = bound.includes("DT") ? "DOWN" : "UP";
  const trains = dir === "DOWN" ? down : up;
  return toRows(trains.length ? trains : [...up, ...down], dir);
}

type MtrTrain = { dest?: string; ttnt?: string | number; time?: string; plat?: string };

async function fetchLrt(route: RouteListEntry, pin: Pin): Promise<Arrival[]> {
  const stationId = pin.stopId.replace(/^LR/i, "");
  const url = `https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule?station_id=${encodeURIComponent(stationId)}`;
  const json = await getJson<{
    platform_list?: Array<{
      route_list?: Array<{
        route_no?: string;
        dest_en?: string;
        dest_ch?: string;
        time_en?: string;
        time_ch?: string;
      }>;
    }>;
  }>(url);
  const dest = route.dest.en.toUpperCase();
  const rows = (json.platform_list ?? []).flatMap((p) => p.route_list ?? []).filter((row) => {
    if ((row.route_no ?? "").replace(/\*/g, "") !== route.route.replace(/\*/g, "")) return false;
    const d = (row.dest_en ?? "").toUpperCase();
    return !d || dest.includes(d.slice(0, 6)) || d.includes(dest.slice(0, 6));
  });
  return takeThree(
    rows.map((row) => {
      const minutes = parseLooseMinutes(row.time_en ?? row.time_ch ?? "");
      return {
        minutes,
        at: null,
        remark: { en: row.time_en ?? "", zh: row.time_ch ?? "" },
        estimated: false,
        gps: false,
      };
    }),
  );
}

async function fetchMtrBus(route: RouteListEntry, pin: Pin): Promise<Arrival[]> {
  const res = await fetch("https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "en", routeName: route.route.replace(/\*/g, "") }),
  });
  if (!res.ok) throw new Error(`mtr bus ${res.status}`);
  const json = (await res.json()) as {
    busStop?: Array<{
      busStopId?: string;
      bus?: Array<{
        departureTimeInSecond?: string;
        arrivalTimeInSecond?: string;
        isScheduled?: string;
        busLocation?: { latitude?: number; longitude?: number };
        busRemark?: string | null;
      }>;
    }>;
  };
  const match =
    (json.busStop ?? []).find((s) => s.busStopId === pin.stopId) ??
    (json.busStop ?? []).find((s) => (s.busStopId ?? "").endsWith(pin.stopId)) ??
    (json.busStop ?? []).find((s) => pin.stopId.endsWith(s.busStopId ?? ""));
  const buses = match?.bus ?? [];
  return takeThree(
    buses.map((bus) => {
      const sec = Number(bus.departureTimeInSecond ?? bus.arrivalTimeInSecond ?? NaN);
      const minutes = Number.isFinite(sec) && sec < 20000 ? Math.max(0, Math.round(sec / 60)) : null;
      const lat = Number(bus.busLocation?.latitude ?? 0);
      const lng = Number(bus.busLocation?.longitude ?? 0);
      const gps = lat !== 0 && lng !== 0;
      return {
        minutes,
        at: null,
        remark: { en: bus.busRemark ?? "", zh: bus.busRemark ?? "" },
        estimated: bus.isScheduled === "1",
        lat: gps ? lat : undefined,
        lng: gps ? lng : undefined,
        gps,
      };
    }),
  );
}

type SunFerryLiveRow = {
  eta?: string;
  rmk_en?: string | null;
  rmk_tc?: string | null;
  depart_time?: string;
  lat?: number | string;
  lng?: number | string;
};

const sunLiveCache = new Map<string, { at: number; rows: SunFerryLiveRow[] }>();
const SUN_LIVE_TTL_MS = 12_000;

async function sunFerryLive(code: string): Promise<SunFerryLiveRow[]> {
  const key = code.trim().toUpperCase();
  const hit = sunLiveCache.get(key);
  if (hit && Date.now() - hit.at < SUN_LIVE_TTL_MS) return hit.rows;
  const url = `https://www.sunferry.com.hk/eta/?route=${encodeURIComponent(key)}`;
  const json = await getJson<{ data?: SunFerryLiveRow[] }>(url);
  const rows = json.data ?? [];
  sunLiveCache.set(key, { at: Date.now(), rows });
  return rows;
}

function reverseSunCode(route: string): string | null {
  const code = route.trim().toUpperCase();
  if (code.length !== 4) return null;
  const swapped = `${code.slice(2)}${code.slice(0, 2)}`;
  return swapped && swapped !== code ? swapped : null;
}

function reverseSunFerry(db: EtaDb, route: RouteListEntry): RouteListEntry | null {
  const origEn = route.orig.en.trim().toLowerCase();
  const destEn = route.dest.en.trim().toLowerCase();
  const origZh = route.orig.zh.trim();
  const destZh = route.dest.zh.trim();
  for (const other of Object.values(db.routeList)) {
    if (other === route || !other.co.includes("sunferry")) continue;
    const oEn = other.orig.en.trim().toLowerCase();
    const dEn = other.dest.en.trim().toLowerCase();
    const oZh = other.orig.zh.trim();
    const dZh = other.dest.zh.trim();
    const enSwap = Boolean(origEn && destEn && oEn === destEn && dEn === origEn);
    const zhSwap = Boolean(origZh && destZh && oZh === destZh && dZh === origZh);
    if (enSwap || zhSwap) return other;
  }
  const swapped = reverseSunCode(route.route);
  if (!swapped) return null;
  return (
    Object.values(db.routeList).find(
      (other) => other.co.includes("sunferry") && other.route.trim().toUpperCase() === swapped,
    ) ?? null
  );
}

function firstOpenClock(rows: SunFerryLiveRow[], field: "depart_time" | "eta"): { minutes: number; remark: Terminal } | null {
  for (const row of rows) {
    const minutes = minutesUntilHktClockOpen(row[field] ?? "");
    if (minutes == null) continue;
    return { minutes, remark: { en: row.rmk_en ?? "", zh: row.rmk_tc ?? "" } };
  }
  return null;
}

function sunBoatGps(rows: SunFerryLiveRow[]): { lat: number; lng: number } | null {
  for (const row of rows) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
      return { lat, lng };
    }
  }
  return null;
}

function sunLabeled(
  dir: "depart" | "arrive",
  minutes: number | null,
  remark: Terminal,
  estimated: boolean,
  boat: { lat: number; lng: number } | null,
): Arrival {
  return {
    minutes,
    at: null,
    remark,
    estimated,
    dir,
    dest: dir === "depart" ? { en: "Departs", zh: "預計開出" } : { en: "Arrives", zh: "預計到站" },
    gps: Boolean(boat),
    lat: boat?.lat,
    lng: boat?.lng,
  };
}

async function fetchSunFerry(route: RouteListEntry, pin: Pin, db: EtaDb): Promise<Arrival[]> {
  const stops = route.stops[pin.company] ?? [];
  const last = Math.max(0, stops.length - 1);
  const atOrigin = pin.stopSeq === 0 || (stops[0] != null && pin.stopId === stops[0]);
  const atDest = last > 0 && (pin.stopSeq === last || pin.stopId === stops[last]);
  const reverse = reverseSunFerry(db, route);
  const reverseCode = reverse?.route ?? reverseSunCode(route.route);
  const outbound = atOrigin || !atDest;
  const [here, other] = await Promise.all([
    sunFerryLive(route.route).catch(() => [] as SunFerryLiveRow[]),
    reverseCode ? sunFerryLive(reverseCode).catch(() => [] as SunFerryLiveRow[]) : Promise.resolve([] as SunFerryLiveRow[]),
  ]);
  const boat = sunBoatGps(here);
  const liveDepart = firstOpenClock(outbound ? here : other, "depart_time");
  let depMin = liveDepart?.minutes ?? null;
  let depRemark = liveDepart?.remark ?? emptyRemark();
  let depEstimated = false;
  if (depMin == null) {
    const schedRoute = outbound ? route : reverse;
    const next = schedRoute ? scheduledArrivals(db, schedRoute)[0] : undefined;
    if (next?.minutes != null) {
      depMin = next.minutes;
      depRemark = next.remark;
      depEstimated = true;
    }
  }
  const liveArrive = firstOpenClock(atDest ? here : other, "eta");
  return [
    sunLabeled("depart", depMin, depRemark, depEstimated, outbound ? boat : null),
    sunLabeled("arrive", liveArrive?.minutes ?? null, liveArrive?.remark ?? emptyRemark(), false, atDest && !outbound ? boat : null),
  ];
}

export function scheduledArrivals(db: EtaDb, route: RouteListEntry): Arrival[] {
  const freq = route.freq;
  if (!freq) return [];
  const p = hktParts();
  const ymd = hktYmd();
  const holiday = db.holidays.includes(ymd);
  const dow = holiday ? 0 : p.weekday;
  const nowMin = minutesOfDay(p.hour, p.minute);
  const times: number[] = [];
  for (const [key, table] of Object.entries(freq)) {
    const row = db.serviceDayMap[key];
    if (row && row[dow] !== "1") continue;
    if (!row && !holiday) continue;
    for (const [startRaw, span] of Object.entries(table)) {
      const start = parseHhmm(startRaw);
      if (!start) continue;
      if (!span) {
        times.push(minutesOfDay(start.hour, start.minute));
        continue;
      }
      const end = parseHhmm(span[0]);
      const interval = Math.max(1, Number(span[1]) || 15);
      if (!end) {
        times.push(minutesOfDay(start.hour, start.minute));
        continue;
      }
      let t = minutesOfDay(start.hour, start.minute);
      const endMin = minutesOfDay(end.hour, end.minute) + (end.hour < start.hour ? 1440 : 0);
      while (t <= endMin) {
        times.push(t % 1440);
        t += interval;
      }
    }
  }
  const unique = [...new Set(times)].sort((a, b) => a - b);
  const upcoming: number[] = [];
  for (const t of unique) {
    if (t >= nowMin) upcoming.push(t);
    if (upcoming.length >= 3) break;
  }
  if (upcoming.length < 3) {
    for (const t of unique) {
      upcoming.push(t + 1440);
      if (upcoming.length >= 3) break;
    }
  }
  return upcoming.slice(0, 3).map((t) => ({
    minutes: Math.max(0, t - nowMin),
    at: null,
    remark: { en: "Timetable", zh: "時間表" },
    estimated: true,
    gps: false,
  }));
}

function arrivalFromIso(iso: string | null | undefined, remark: Terminal, diff?: number): Arrival {
  const minutes = iso ? minutesUntilIso(iso) : typeof diff === "number" ? Math.max(0, diff) : null;
  return { minutes, at: iso ?? null, remark, estimated: /schedul/i.test(`${remark.en} ${remark.zh}`), gps: false };
}

function takeThree(rows: Arrival[]): Arrival[] {
  return rows.filter((r) => r.minutes != null).slice(0, 3);
}

function boundToSeq(bound?: string): number {
  if (!bound) return 1;
  const b = bound.toUpperCase();
  if (b.startsWith("I") || b.includes("DT")) return 2;
  return 1;
}

function parseLooseMinutes(text: string): number | null {
  if (!text) return null;
  if (/arriv|到/i.test(text) && !/\d/.test(text)) return 0;
  const m = text.match(/(\d+)/);
  if (!m) return null;
  return Number(m[1]);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}
