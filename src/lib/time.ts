const HKT = "Asia/Hong_Kong";

export function hktParts(date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: HKT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: weekdayMap[bag.weekday ?? "Sun"] ?? 0,
  };
}

export function hktYmd(date = new Date()): string {
  const p = hktParts(date);
  return `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`;
}

export function minutesUntilIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - Date.now()) / 60000));
}

export function minutesUntilHktClock(clock: string): number | null {
  const m = clock.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const p = hktParts();
  let target = Date.UTC(p.year, p.month - 1, p.day, Number(m[1]), Number(m[2])) - 8 * 3600 * 1000;
  const now = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - 8 * 3600 * 1000;
  if (target + 60_000 < now) target += 24 * 3600 * 1000;
  return Math.max(0, Math.round((target - now) / 60000));
}

/** Minutes until today's clock. Null if that time has already passed. */
export function minutesUntilHktClockOpen(clock: string): number | null {
  const m = clock.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const p = hktParts();
  const target = Date.UTC(p.year, p.month - 1, p.day, Number(m[1]), Number(m[2])) - 8 * 3600 * 1000;
  const now = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - 8 * 3600 * 1000;
  if (target + 60_000 < now) return null;
  return Math.max(0, Math.round((target - now) / 60000));
}

export function parseHhmm(raw: string): { hour: number; minute: number } | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 3) return null;
  const padded = digits.padStart(4, "0").slice(0, 4);
  const hour = Number(padded.slice(0, 2));
  const minute = Number(padded.slice(2, 4));
  if (hour > 27 || minute > 59) return null;
  return { hour: hour % 24, minute };
}

export function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}
