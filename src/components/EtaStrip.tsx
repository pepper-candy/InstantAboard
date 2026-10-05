import { nameOf, t } from "@/lib/i18n";
import type { Arrival, Lang } from "@/lib/types";

export function EtaStrip({
  arrivals,
  lang,
}: {
  arrivals: Arrival[] | undefined;
  lang: Lang;
  busy?: boolean;
}) {
  const rows = arrivals ?? [];
  const ferryPair = rows.some((r) => r.dir === "depart" || r.dir === "arrive");
  if (ferryPair) {
    const dep = rows.find((r) => r.dir === "depart");
    const arr = rows.find((r) => r.dir === "arrive");
    return (
      <div className="etas ferry-etas" aria-label="ETA">
        <div className="eta">
          <span className="eta-kicker">{t(lang, "Departs", "預計開出")}</span>
          <span className="eta-num">{formatMinutes(dep?.minutes, lang)}</span>
        </div>
        <div className="eta">
          <span className="eta-kicker">{t(lang, "Arrives", "預計到站")}</span>
          <span className="eta-num">{formatMinutes(arr?.minutes, lang)}</span>
        </div>
      </div>
    );
  }
  const directed = rows.some((r) => r.dir || r.plat);
  if (directed) {
    const groups = groupDirs(rows);
    return (
      <div className="etas-dir" aria-label="ETA">
        {groups.map((g) => (
          <div key={`${g.dir}|${g.destCode ?? ""}|${g.plat ?? ""}`} className="dir-row">
            {g.plat ? <span className="plat">{g.plat}</span> : null}
            <span className="dir-dest">{nameOf(lang, g.dest, g.destCode || "—")}</span>
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
    <div className="etas" aria-label="ETA">
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
    const key = `${row.dir || "·"}|${row.destCode || ""}|${row.plat || ""}`;
    if (!map.has(key)) {
      map.set(key, { dir: row.dir || "·", dest: row.dest, destCode: row.destCode, plat: row.plat, minutes: [] });
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
