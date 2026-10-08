import { nameOf, t, towardLabel } from "@/lib/i18n";
import { formatMtrEta, mtrEtaView } from "@/lib/mtrTime";
import type { Arrival, Company, Lang, Terminal } from "@/lib/types";

export function EtaStrip({
  arrivals,
  lang,
  company,
}: {
  arrivals: Arrival[] | undefined;
  lang: Lang;
  busy?: boolean;
  company?: Company;
}) {
  const rows = arrivals ?? [];
  const mtr = company === "mtr";
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
          <div key={g.dir} className="dir-row">
            {g.plat ? <span className="plat">{g.plat}</span> : null}
            <span className="dir-dest">
              <TowardDests lang={lang} dests={g.dests} />
            </span>
            <div className="dir-mins">
              {g.minutes.map((slot, i) => (
                <span key={i} className="eta-slot">
                  <EtaMinutes minutes={slot?.minutes} lang={lang} mtr={mtr} sm minority={slot?.minority} />
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
          <EtaMinutes minutes={row?.minutes} lang={lang} mtr={mtr} />
        </div>
      ))}
    </div>
  );
}

type Slot = { minutes: number | null; dest?: Terminal; minority: boolean };

export function rankDests(rows: Arrival[], prefer?: Terminal): Terminal[] {
  const map = new Map<string, { dest: Terminal; count: number }>();
  for (const row of rows) {
    const dest = row.dest;
    if (!dest) continue;
    const code = (row.destCode || dest.en || dest.zh || "").toUpperCase();
    if (!code) continue;
    const prev = map.get(code);
    map.set(code, { dest: prev?.dest ?? dest, count: (prev?.count ?? 0) + 1 });
  }
  const ranked = [...map.values()].sort((a, b) => b.count - a.count || (a.dest.en || "").localeCompare(b.dest.en || ""));
  if (!prefer) return ranked.map((row) => row.dest);
  const preferCode = (prefer.en || prefer.zh).toUpperCase();
  const head = ranked.find((row) => (row.dest.en || row.dest.zh).toUpperCase() === preferCode || row.dest.en === prefer.en);
  const rest = ranked.filter((row) => row !== head).map((row) => row.dest);
  return head ? [head.dest, ...rest] : prefer.en || prefer.zh ? [prefer, ...rest] : rest;
}

export function TowardDests({ lang, dests }: { lang: Lang; dests: Terminal[] }) {
  const primary = dests[0];
  if (!primary) return <>{towardLabel(lang, undefined)}</>;
  const extras = dests.slice(1);
  if (!extras.length) return <>{towardLabel(lang, primary)}</>;
  const prefix = lang === "zh" ? "往" : "to";
  return (
    <span className="toward">
      {prefix} {nameOf(lang, primary)}
      {extras.map((dest, i) => (
        <span key={`${dest.en}-${i}`}>
          /<span className="dest-chip">{nameOf(lang, dest)}</span>
        </span>
      ))}
    </span>
  );
}

function groupDirs(rows: Arrival[]) {
  const map = new Map<
    string,
    { dir: string; plats: Set<string>; dests: Map<string, { dest?: Terminal; count: number }>; slots: Arrival[] }
  >();
  for (const row of rows) {
    const key = row.dir || "·";
    if (!map.has(key)) {
      map.set(key, { dir: key, plats: new Set(), dests: new Map(), slots: [] });
    }
    const g = map.get(key)!;
    if (row.plat) g.plats.add(row.plat);
    if (g.slots.length < 3) g.slots.push(row);
    const code = (row.destCode || row.dest?.en || "").toUpperCase();
    if (!code) continue;
    const prev = g.dests.get(code);
    g.dests.set(code, { dest: row.dest ?? prev?.dest, count: (prev?.count ?? 0) + 1 });
  }
  return [...map.values()].map((g) => {
    const destRows = [...g.dests.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
    const majority = destRows[0]?.[0];
    const dests = destRows.map(([, row]) => row.dest).filter((dest): dest is Terminal => Boolean(dest));
    const minutes: Array<Slot | null> = [0, 1, 2].map((i) => {
      const row = g.slots[i];
      if (!row) return null;
      const code = (row.destCode || row.dest?.en || "").toUpperCase();
      return {
        minutes: row.minutes,
        dest: row.dest,
        minority: Boolean(majority && code && code !== majority && destRows.length > 1),
      };
    });
    const plat = [...g.plats].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join("/");
    return { dir: g.dir, plat: plat || undefined, dests, minutes };
  });
}

function EtaMinutes({
  minutes,
  lang,
  mtr,
  sm,
  minority,
}: {
  minutes: number | null | undefined;
  lang: Lang;
  mtr: boolean;
  sm?: boolean;
  minority?: boolean;
}) {
  const view = mtr ? mtrEtaView(minutes) : null;
  const kindClass = view?.kind === "dep" ? " is-dep" : view?.kind === "arr" ? " is-arr" : "";
  const text = mtr ? formatMtrEta(lang, minutes) : formatMinutes(minutes, lang);
  return (
    <span className={`eta-num${sm ? " sm" : ""}${kindClass}${minority ? " is-branch" : ""}`}>{text}</span>
  );
}

function formatMinutes(minutes: number | null | undefined, lang: Lang): string {
  if (minutes == null) return "—";
  if (minutes <= 0) return lang === "zh" ? "到" : "Due";
  return String(minutes);
}
