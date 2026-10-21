"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

function Ext({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const ITEMS: { en: ReactNode; zh: ReactNode }[] = [
  {
    en: (
      <>
        <strong>Real-time ETA</strong>: KMB/LWB, Citybus, NLB, MTR, Light Rail, MTR Bus (via{" "}
        <Ext href="https://data.gov.hk">DATA.GOV.HK</Ext> /{" "}
        <Ext href="https://rt.data.gov.hk">rt.data.gov.hk</Ext>); GMB (
        <Ext href="https://data.etagmb.gov.hk">data.etagmb.gov.hk</Ext>)
      </>
    ),
    zh: (
      <>
        <strong>實時到站</strong>：九巴／龍運、城巴、新巴、港鐵、輕鐵、港鐵巴士、嶼巴（經{" "}
        <Ext href="https://data.gov.hk">DATA.GOV.HK</Ext> /{" "}
        <Ext href="https://rt.data.gov.hk">rt.data.gov.hk</Ext>）；專線小巴（
        <Ext href="https://data.etagmb.gov.hk">data.etagmb.gov.hk</Ext>）
      </>
    ),
  },
  {
    en: (
      <>
        <strong>Sun Ferry schedules</strong>: Sun Ferry Services Company Limited
      </>
    ),
    zh: (
      <>
        <strong>新渡輪班次</strong>：新世界第一渡輪服務有限公司
      </>
    ),
  },
  {
    en: (
      <>
        <strong>Tram</strong>: Transport Department open route/stop data
      </>
    ),
    zh: (
      <>
        <strong>電車</strong>：運輸署公開路線／站點數據
      </>
    ),
  },
  {
    en: (
      <>
        <strong>Taxi stands</strong>: Transport Department (
        <Ext href="https://portal.csdi.gov.hk">CSDI Portal</Ext>)
      </>
    ),
    zh: (
      <>
        <strong>的士站</strong>：運輸署（
        <Ext href="https://portal.csdi.gov.hk">CSDI 空間數據共享平台</Ext>）
      </>
    ),
  },
  {
    en: (
      <>
        <strong>Ferry piers</strong>: Transport Department ferry GeoJSON
      </>
    ),
    zh: (
      <>
        <strong>碼頭設施</strong>：運輸署渡輪 GeoJSON
      </>
    ),
  },
  {
    en: (
      <>
        <strong>Route & stop index</strong>: HK Bus Crawling@2021 (
        <Ext href="https://github.com/hkbus/hk-bus-crawling">hkbus</Ext>)
      </>
    ),
    zh: (
      <>
        <strong>公車／小巴路線與站點索引</strong>：HK Bus Crawling@2021（
        <Ext href="https://github.com/hkbus/hk-bus-crawling">hkbus</Ext>）
      </>
    ),
  },
  {
    en: (
      <>
        <strong>Franchised bus route lines</strong>: Transport Department{" "}
        <Ext href="https://portal.csdi.gov.hk">CSDI</Ext> bus route layer
      </>
    ),
    zh: (
      <>
        <strong>專營巴士路線軌跡</strong>：運輸署{" "}
        <Ext href="https://portal.csdi.gov.hk">CSDI</Ext> 巴士路線圖層
      </>
    ),
  },
  {
    en: (
      <>
        <strong>MTR / Light Rail / tram track geometry</strong>: ©{" "}
        <Ext href="https://www.openstreetmap.org/copyright">OpenStreetMap</Ext> contributors
      </>
    ),
    zh: (
      <>
        <strong>港鐵／輕鐵／電車軌道路線</strong>：©{" "}
        <Ext href="https://www.openstreetmap.org/copyright">OpenStreetMap</Ext> 貢獻者
      </>
    ),
  },
  {
    en: (
      <>
        <strong>Base map</strong>: © <Ext href="https://www.openstreetmap.org/copyright">OpenStreetMap</Ext> contributors
        (ODbL)
      </>
    ),
    zh: (
      <>
        <strong>地圖底圖</strong>：© <Ext href="https://www.openstreetmap.org/copyright">OpenStreetMap</Ext> 貢獻者（ODbL）
      </>
    ),
  },
  {
    en: (
      <>
        <strong>Routing fallback</strong>: <Ext href="https://project-osrm.org">OSRM Project</Ext>
      </>
    ),
    zh: (
      <>
        <strong>路線規劃輔助（無軌跡時）</strong>：<Ext href="https://project-osrm.org">OSRM Project</Ext>
      </>
    ),
  },
];

export function DataSources({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="sources" ref={root} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="sources-toggle"
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
      >
        <span>
          {t(lang, "ETA data from operator open APIs and DATA.GOV.HK ", "預計抵達時間 (ETA) 數據來自各營辦商開放接口及 DATA.GOV.HK")}
          {t(lang, "(", "（")}
          <span className="sources-hint">{t(lang, "View data sources", "查看資料來源")}</span>
          {t(lang, ")", "）")}
        </span>
      </button>
      <div className={`mtr-hours-fold${open ? " is-open" : ""}`}>
        <div className="mtr-hours-fold-inner">
          <div className="mtr-hours-panel sources-panel">
            <p className="mtr-hours-title">{t(lang, "Detailed Data Sources", "詳細資料來源")}</p>
            <ul>
              {ITEMS.map((item, i) => (
                <li key={i}>{lang === "zh" ? item.zh : item.en}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
