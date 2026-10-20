"use client";

import { useMemo } from "react";
import { t, towardLabel } from "@/lib/i18n";
import { dayKindLabel, headwayLabel, tramHoursAtStop, type TramStopHours } from "@/lib/tramHours";
import type { EtaDb, Lang } from "@/lib/types";
import type { TramStation } from "@/lib/stopIndex";

export function useTramHoursData(db: EtaDb | null, station: TramStation) {
  const rows = useMemo(() => {
    if (!db) return [];
    const out: TramStopHours[] = [];
    const seen = new Set<string>();
    for (const line of station.lines) {
      for (const ref of [line.dirs.OUT, line.dirs.IN]) {
        if (!ref) continue;
        const route = db.routeList[ref.routeId];
        if (!route) continue;
        const hours = tramHoursAtStop(route, ref.stopSeq);
        if (!hours) continue;
        const key = `${hours.dest.en}|${hours.first}|${hours.last}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(hours);
      }
    }
    return out;
  }, [db, station]);
  return { rows, ready: true, has: rows.length > 0 };
}

export function TramHoursPanel({
  lang,
  data,
}: {
  lang: Lang;
  data: ReturnType<typeof useTramHoursData>;
}) {
  const { rows, has } = data;
  return (
    <div className="mtr-hours-panel" onClick={(e) => e.stopPropagation()}>
      <p className="mtr-hours-title">{t(lang, "First / last tram (reference)", "頭班車 / 尾班車（僅供參考）")}</p>
      {has ? (
        rows.map((row) => <HourBlock key={`${row.dest.en}-${row.first}`} lang={lang} hours={row} />)
      ) : (
        <p className="muted mtr-hours-empty">{t(lang, "Times not loaded yet", "尚未載入時間")}</p>
      )}
    </div>
  );
}

export function RouteTramHours({ hours, lang }: { hours: TramStopHours | null; lang: Lang }) {
  if (!hours) return null;
  return (
    <div className="mtr-hours">
      <TramHoursPanel lang={lang} data={{ rows: [hours], ready: true, has: true }} />
    </div>
  );
}

function HourBlock({ lang, hours }: { lang: Lang; hours: TramStopHours }) {
  const kinds = hours.days.map((d) => d.kind);
  return (
    <div className="mtr-hours-line">
      <div className="mtr-hours-dir">
        {hours.days.map((day) => (
          <div key={day.kind} className="mtr-hours-row">
            <span className="mtr-hours-dest">
              {towardLabel(lang, hours.dest)}
              {dayKindLabel(lang, day.kind, kinds) ? ` · ${dayKindLabel(lang, day.kind, kinds)}` : ""}
            </span>
            <span className="mtr-hours-time">
              {day.first} – {day.last}
            </span>
          </div>
        ))}
        <p className="muted mtr-hours-empty">
          {t(lang, "Headway", "班次")} {headwayLabel(lang, hours)}
        </p>
      </div>
    </div>
  );
}

