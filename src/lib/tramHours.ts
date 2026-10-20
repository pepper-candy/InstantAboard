import { nameOf } from "./i18n";
import { hktParts, hktYmd } from "./time";
import type { Lang, RouteListEntry, Terminal } from "./types";

/** Encoded from HK Tramways schedules-fares + TD Tramways Schedule of Services (not live). */
export type TramDayKind = "wd" | "sat" | "sun";

export type TramClockSpan = { first: string; last: string };

export type TramHourDay = {
  wd: TramClockSpan;
  sat?: TramClockSpan;
  sun?: TramClockSpan;
};

export type TramCorridor = {
  /** Sorted cleaned English ends, e.g. "kennedy town|shau kei wan". */
  key: string;
  a: Terminal;
  b: Terminal;
  /** Scheduled terminus duration a→b / b→a, minutes (TD journey time). */
  durationAb: number;
  durationBa: number;
  /** First/last departure from a toward b / from b toward a. */
  hoursAb: TramHourDay;
  hoursBa: TramHourDay;
  /** Typical headway used for the map sim (minutes). */
  headwayMin: number;
  /** Published headway label. */
  headwayEn: string;
  headwayZh: string;
};

const SAME = (first: string, last: string): TramHourDay => ({ wd: { first, last } });

const CORRIDORS: TramCorridor[] = [
  {
    key: "kennedy town|shau kei wan",
    a: { en: "Kennedy Town", zh: "堅尼地城" },
    b: { en: "Shau Kei Wan", zh: "筲箕灣" },
    durationAb: 96,
    durationBa: 92,
    hoursAb: SAME("05:30", "19:00"),
    hoursBa: SAME("07:00", "19:10"),
    headwayMin: 30,
    headwayEn: "2/hour",
    headwayZh: "每小時2班",
  },
  {
    key: "shau kei wan|western market",
    a: { en: "Western Market", zh: "上環(西港城)" },
    b: { en: "Shau Kei Wan", zh: "筲箕灣" },
    durationAb: 72,
    durationBa: 66,
    hoursAb: SAME("06:40", "00:06"),
    hoursBa: SAME("05:42", "00:06"),
    headwayMin: 8,
    headwayEn: "5–12 min",
    headwayZh: "5–12分鐘",
  },
  {
    key: "north point|shek tong tsui",
    a: { en: "Shek Tong Tsui", zh: "石塘咀" },
    b: { en: "North Point", zh: "北角" },
    durationAb: 58,
    durationBa: 60,
    hoursAb: SAME("05:00", "22:05"),
    hoursBa: SAME("05:50", "23:00"),
    headwayMin: 8,
    headwayEn: "5–15 min",
    headwayZh: "5–15分鐘",
  },
  {
    key: "causeway bay|shek tong tsui",
    a: { en: "Shek Tong Tsui", zh: "石塘咀" },
    b: { en: "Causeway Bay", zh: "銅鑼灣" },
    durationAb: 50,
    durationBa: 44,
    hoursAb: {
      wd: { first: "06:45", last: "18:15" },
      sat: { first: "08:45", last: "18:45" },
      sun: { first: "08:45", last: "18:45" },
    },
    hoursBa: {
      wd: { first: "07:30", last: "19:00" },
      sat: { first: "09:30", last: "19:30" },
      sun: { first: "09:30", last: "19:30" },
    },
    headwayMin: 30,
    headwayEn: "30 min",
    headwayZh: "30分鐘",
  },
  {
    key: "happy valley|kennedy town",
    a: { en: "Kennedy Town", zh: "堅尼地城" },
    b: { en: "Happy Valley", zh: "跑馬地" },
    durationAb: 67,
    durationBa: 65,
    hoursAb: SAME("05:00", "00:00"),
    hoursBa: SAME("05:45", "00:45"),
    headwayMin: 6,
    headwayEn: "5–10 min",
    headwayZh: "5–10分鐘",
  },
  {
    key: "happy valley|shau kei wan",
    a: { en: "Happy Valley", zh: "跑馬地" },
    b: { en: "Shau Kei Wan", zh: "筲箕灣" },
    durationAb: 54,
    durationBa: 50,
    hoursAb: SAME("06:29", "00:00"),
    hoursBa: SAME("05:46", "23:15"),
    headwayMin: 8,
    headwayEn: "5–15 min",
    headwayZh: "5–15分鐘",
  },
];

function placeKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/terminus/g, "")
    .replace(/\bwhitty street\b/g, "shek tong tsui")
    .replace(/\bwestern market\b.*/g, "western market")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function endKey(name: Terminal): string {
  return placeKey(nameOf("en", name, ""));
}

function corridorKey(a: Terminal, b: Terminal): string {
  const x = endKey(a);
  const y = endKey(b);
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

export function tramCorridorOf(route: RouteListEntry): TramCorridor | null {
  const key = corridorKey(route.orig, route.dest);
  return CORRIDORS.find((row) => row.key === key) ?? null;
}

export function tramDayKind(holidays: string[], at = new Date()): TramDayKind {
  const p = hktParts(at);
  if (p.weekday === 0 || holidays.includes(hktYmd(at))) return "sun";
  if (p.weekday === 6) return "sat";
  return "wd";
}

export function spanForDay(day: TramHourDay, kind: TramDayKind): TramClockSpan {
  if (kind === "sat") return day.sat ?? day.wd;
  if (kind === "sun") return day.sun ?? day.sat ?? day.wd;
  return day.wd;
}

function clockMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatClock(min: number): string {
  const wrap = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrap / 60)).padStart(2, "0")}:${String(wrap % 60).padStart(2, "0")}`;
}

/** Inclusive window on a 48h clock so last-after-midnight works. */
export function serviceWindow(span: TramClockSpan): { start: number; end: number } {
  const start = clockMin(span.first);
  let end = clockMin(span.last);
  if (end <= start) end += 1440;
  return { start, end };
}

export function nowMinutesHkt(at = new Date()): number {
  const p = hktParts(at);
  return p.hour * 60 + p.minute + p.second / 60;
}

function towardB(route: RouteListEntry, corridor: TramCorridor): boolean {
  const orig = endKey(route.orig);
  const dest = endKey(route.dest);
  const a = endKey(corridor.a);
  const b = endKey(corridor.b);
  if (orig === a && dest === b) return true;
  if (orig === b && dest === a) return false;
  return dest === b || orig === a;
}

export function tramTripDurationMin(route: RouteListEntry): number | null {
  const corridor = tramCorridorOf(route);
  if (!corridor) return null;
  return towardB(route, corridor) ? corridor.durationAb : corridor.durationBa;
}

export function tramHeadwayMin(route: RouteListEntry): number | null {
  return tramCorridorOf(route)?.headwayMin ?? null;
}

export type TramStopHours = {
  dest: Terminal;
  first: string;
  last: string;
  headwayEn: string;
  headwayZh: string;
  days: Array<{ kind: TramDayKind; first: string; last: string }>;
};

function offsetSpan(span: TramClockSpan, addMin: number): TramClockSpan {
  return {
    first: formatClock(clockMin(span.first) + addMin),
    last: formatClock(clockMin(span.last) + addMin),
  };
}

function uniqueDays(day: TramHourDay, addMin: number): Array<{ kind: TramDayKind; first: string; last: string }> {
  const wd = offsetSpan(day.wd, addMin);
  const sat = offsetSpan(day.sat ?? day.wd, addMin);
  const sun = offsetSpan(day.sun ?? day.sat ?? day.wd, addMin);
  const same = wd.first === sat.first && wd.last === sat.last && sat.first === sun.first && sat.last === sun.last;
  if (same) return [{ kind: "wd", ...wd }];
  const rows: Array<{ kind: TramDayKind; first: string; last: string }> = [{ kind: "wd", ...wd }];
  if (sat.first !== wd.first || sat.last !== wd.last) rows.push({ kind: "sat", ...sat });
  if (sun.first !== sat.first || sun.last !== sat.last) rows.push({ kind: "sun", ...sun });
  else if (rows.length === 1) rows.push({ kind: "sat", ...sat });
  return rows;
}

/** First/last at this stop: origin timetable plus travel share along the bound. */
export function tramHoursAtStop(route: RouteListEntry, stopSeq: number): TramStopHours | null {
  const corridor = tramCorridorOf(route);
  if (!corridor) return null;
  const n = (route.stops.tram ?? []).length;
  const frac = n <= 1 ? 0 : Math.max(0, Math.min(1, stopSeq / (n - 1)));
  const toB = towardB(route, corridor);
  const duration = toB ? corridor.durationAb : corridor.durationBa;
  const add = Math.round(duration * frac);
  const hours = toB ? corridor.hoursAb : corridor.hoursBa;
  const today = spanForDay(hours, "wd");
  const shifted = offsetSpan(today, add);
  return {
    dest: route.dest,
    first: shifted.first,
    last: shifted.last,
    headwayEn: corridor.headwayEn,
    headwayZh: corridor.headwayZh,
    days: uniqueDays(hours, add),
  };
}

export function tramInService(route: RouteListEntry, holidays: string[], at = new Date()): boolean {
  const corridor = tramCorridorOf(route);
  if (!corridor) return false;
  const toB = towardB(route, corridor);
  const hours = toB ? corridor.hoursAb : corridor.hoursBa;
  const duration = toB ? corridor.durationAb : corridor.durationBa;
  const span = spanForDay(hours, tramDayKind(holidays, at));
  const { start, end } = serviceWindow(span);
  let now = nowMinutesHkt(at);
  if (now < start - 12 * 60) now += 1440;
  return now >= start && now <= end + duration;
}

export function tramDepartures(route: RouteListEntry, holidays: string[], at = new Date()): number[] {
  const corridor = tramCorridorOf(route);
  if (!corridor) return [];
  const toB = towardB(route, corridor);
  const hours = toB ? corridor.hoursAb : corridor.hoursBa;
  const span = spanForDay(hours, tramDayKind(holidays, at));
  const { start, end } = serviceWindow(span);
  const step = Math.max(4, corridor.headwayMin);
  const times: number[] = [];
  for (let t = start; t <= end + 0.01; t += step) times.push(t);
  return times;
}

export function dayKindLabel(lang: Lang, kind: TramDayKind, kinds: TramDayKind[]): string {
  if (kinds.length <= 1) return "";
  if (kind === "wd") return lang === "zh" ? "平日" : "Mon–Fri";
  if (kind === "sat" && !kinds.includes("sun")) return lang === "zh" ? "星期六、日及公眾假期" : "Sat, Sun & PH";
  if (kind === "sat") return lang === "zh" ? "星期六" : "Sat";
  return lang === "zh" ? "日及公眾假期" : "Sun & PH";
}

export function headwayLabel(lang: Lang, hours: TramStopHours): string {
  return lang === "zh" ? hours.headwayZh : hours.headwayEn;
}

