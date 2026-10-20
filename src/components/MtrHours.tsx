"use client";

import { useEffect, useMemo, useState } from "react";
import { mtrLineCode, mtrLineName } from "@/lib/colors";
import { destLabel, dirLabel, loadMtrHours, stationHours, type MtrHourLeg, type MtrStationHours } from "@/lib/mtrHours";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { IconInfo } from "./Icons";

export function useMtrHoursData(line: string | undefined, lines: string[] | undefined, stopId: string) {
  const codesKey = (lines?.length ? lines : line ? [line] : []).map(mtrLineCode).join("\0");
  const codes = useMemo(() => [...new Set(codesKey.split("\0").filter(Boolean))], [codesKey]);
  const [rows, setRows] = useState<Array<{ code: string; hours: MtrStationHours }>>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadMtrHours().then((pack) => {
      if (!alive) return;
      setRows(codes.map((code) => ({ code, hours: stationHours(pack, code, stopId) ?? {} })));
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [codes, stopId]);

  const has = rows.some((row) => row.hours.UP?.length || row.hours.DOWN?.length);
  return { codes, rows, ready, has };
}

export function MtrHours({
  line,
  lines,
  stopId,
  lang,
  open: openProp,
  onOpenChange,
  showPanel = true,
}: {
  line?: string;
  lines?: string[];
  stopId: string;
  lang: Lang;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showPanel?: boolean;
}) {
  const data = useMtrHoursData(line, lines, stopId);
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;

  return (
    <div className="mtr-hours">
      <MtrHoursButton lang={lang} open={open} onToggle={() => setOpen(!open)} />
      {showPanel && open ? <MtrHoursPanel lang={lang} data={data} /> : null}
    </div>
  );
}

export function MtrHoursButton({ lang, open, onToggle }: { lang: Lang; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="mtr-hours-btn"
      aria-expanded={open}
      aria-label={t(lang, "First and last trains", "頭班車及尾班車")}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <IconInfo className="icon-sm" />
    </button>
  );
}

export function MtrHoursPanel({
  lang,
  data,
}: {
  lang: Lang;
  data: ReturnType<typeof useMtrHoursData>;
}) {
  const { codes, rows, ready, has } = data;
  return (
    <div className="mtr-hours-panel" onClick={(e) => e.stopPropagation()}>
      <p className="mtr-hours-title">{t(lang, "First / last train (reference)", "頭班車 / 尾班車（僅供參考）")}</p>
      {ready && has ? (
        rows.map((row) =>
          row.hours.UP?.length || row.hours.DOWN?.length ? (
            <div key={row.code} className="mtr-hours-line">
              {codes.length > 1 ? <p className="mtr-hours-line-name">{mtrLineName(lang, row.code)}</p> : null}
              <HourDir lang={lang} dir="UP" legs={row.hours.UP} />
              <HourDir lang={lang} dir="DOWN" legs={row.hours.DOWN} />
            </div>
          ) : null,
        )
      ) : (
        <p className="muted mtr-hours-empty">{t(lang, "Times not loaded yet", "尚未載入時間")}</p>
      )}
    </div>
  );
}

function HourDir({ lang, dir, legs }: { lang: Lang; dir: string; legs?: MtrHourLeg[] }) {
  if (!legs?.length) return null;
  return (
    <div className="mtr-hours-dir">
      {legs.map((leg) => (
        <div key={`${dir}-${leg.destEn}`} className="mtr-hours-row">
          <span className="mtr-hours-dest">{dirLabel(lang, dir, { en: destLabel("en", leg), zh: destLabel("zh", leg) })}</span>
          <span className="mtr-hours-time">
            {leg.first} – {leg.last}
          </span>
        </div>
      ))}
    </div>
  );
}
