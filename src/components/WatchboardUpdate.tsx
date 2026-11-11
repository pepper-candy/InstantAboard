"use client";

import { useEffect, useState } from "react";
import { mtrLineName } from "@/lib/colors";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import { mtrTitleDests } from "@/lib/mtrTitle";
import { loadSeedRev, WATCHBOARD_SEED_REV } from "@/lib/storage";
import type { EtaDb, Lang, Pin } from "@/lib/types";
import { TowardDests } from "./EtaStrip";

export function WatchboardUpdate({
  db,
  pins,
  pinsReady,
  lang,
  applyWatchboardSeeds,
}: {
  db: EtaDb | null;
  pins: Pin[];
  pinsReady: boolean;
  lang: Lang;
  applyWatchboardSeeds: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!pinsReady) return;
    if (loadSeedRev() >= WATCHBOARD_SEED_REV) return;
    setOpen(true);
  }, [pinsReady]);

  if (!open) return null;

  return (
    <div className="watch-update" role="dialog" aria-modal="true" aria-labelledby="watch-update-title">
      <div className="watch-update-card">
        <h2 id="watch-update-title">{t(lang, "Watchboard update", "時間板已更新")}</h2>
        <p>
          {t(
            lang,
            "Starred routes are now by station and direction, and the default list has been refreshed. If you had custom pins, please add them again. Your current list is below — you can screenshot it before continuing.",
            "收藏已改為以車站及方向為準，預設列表亦已更新。如你有自訂收藏，請重新加入。你目前的列表如下，可先截圖再繼續。",
          )}
        </p>
        <h3>{t(lang, "Your current list", "目前列表")}</h3>
        <div className="watch-update-list">
          {pins.length === 0 ? (
            <p className="muted">{t(lang, "The list is empty.", "列表是空的。")}</p>
          ) : (
            <ul>
              {pins.map((pin) => (
                <li key={pin.id}>{pinSummary(db, pin, lang)}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className="update-map-toast-btn"
          disabled={!db}
          onClick={() => {
            applyWatchboardSeeds();
            setOpen(false);
          }}
        >
          {t(lang, "Understood", "明白")}
        </button>
      </div>
    </div>
  );
}

function pinSummary(db: EtaDb | null, pin: Pin, lang: Lang) {
  const route = db?.routeList[pin.routeId];
  const stop = db?.stopList[pin.stopId];
  const line = pin.company === "mtr" ? mtrLineName(lang, route?.route ?? "") : route?.route || pin.routeId;
  const station = nameOf(lang, stop?.name);
  const alongDir = (route?.bound[pin.company] ?? "").toUpperCase().includes("DT") ? "DOWN" : "UP";
  const dests = pin.company === "mtr" && route ? mtrTitleDests(db, route, alongDir) : [route?.dest];
  const toward =
    dests.length > 1 ? (
      <TowardDests lang={lang} dests={dests.filter((dest): dest is NonNullable<typeof dest> => Boolean(dest))} />
    ) : (
      towardLabel(lang, dests[0])
    );
  return (
    <>
      <span>{line}</span>
      <span> · </span>
      <span>{station}</span>
      <span> · </span>
      <span>{toward}</span>
    </>
  );
}
