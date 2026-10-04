import { nameOf } from "@/lib/i18n";
import type { Arrival, Lang } from "@/lib/types";

export function EtaStrip({
  arrivals,
  lang,
  busy = false,
}: {
  arrivals: Arrival[] | undefined;
  lang: Lang;
  busy?: boolean;
}) {
  const rows = arrivals ?? [];
  const directed = rows.some((r) => r.dir || r.plat);
  if (directed) {
    const groups = groupDirs(rows);
    return (
      <div className={`etas-dir ${busy ? "is-busy" : ""}`} aria-label="ETA">
        {groups.map((g) => (
          <div key={g.dir} className="dir-row">
            <span className="dir-tag">{g.dir}</span>
            <span className="dir-dest">{nameOf(lang, g.dest, g.destCode || "—")}</span>
            {g.plat ? <span className="plat">{g.plat}</span> : null}
            <div className="dir-mins">
              {g.minutes.map((m, i) => (
                <span key={i} className="eta-num sm">
                  {formatMinutes(m, lang)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  const slots = [0, 1, 2].map((i) => rows[i] ?? null);
  return (
    <div className={`etas ${busy ? "is-busy" : ""}`} aria-label="ETA">
      {slots.map((row, i) => (
        <div key={i} className="eta">
          <span className="eta-num">{formatMinutes(row?.minutes, lang)}</span>
        </div>
      ))}
    </div>
  );
}

function groupDirs(rows: Arrival[]) {
  const map = new Map<string, { dir: string; dest?: Arrival["dest"]; destCode?: string; plat?: string; minutes: Array<number | null> }>();
  for (const row of rows) {
    const key = row.dir || "·";
    if (!map.has(key)) {
      map.set(key, { dir: key, dest: row.dest, destCode: row.destCode, plat: row.plat, minutes: [] });
    }
    const g = map.get(key);
    if (g && g.minutes.length < 3) g.minutes.push(row.minutes);
  }
  return [...map.values()].map((g) => ({
    ...g,
    minutes: [0, 1, 2].map((i) => g.minutes[i] ?? null),
  }));
}

function formatMinutes(minutes: number | null | undefined, lang: Lang): string {
  if (minutes == null) return "—";
  if (minutes <= 0) return lang === "zh" ? "到" : "Due";
  return String(minutes);
}
