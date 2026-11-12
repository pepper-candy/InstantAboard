import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "public", "data");
const ICONS = path.join(ROOT, "public", "icons");

const TAXI_URL =
  "https://portal.csdi.gov.hk/server/services/common/td_rcd_1697081907714_17556/MapServer/WFSServer?service=WFS&version=2.0.0&request=GetFeature&typeNames=TAXI_STANDS&outputFormat=GEOJSON&srsName=EPSG:4326";

async function main() {
  await mkdir(DATA, { recursive: true });
  await mkdir(ICONS, { recursive: true });
  await writeIcons();
  await writeTaxi();
  await writeTram();
  await writeFerry();
  await writeRoutePathsNote();
}

async function writeTaxi() {
  const dest = path.join(DATA, "taxi-stands.json");
  try {
    const res = await fetch(TAXI_URL, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`taxi ${res.status}`);
    const geo = await res.json();
    const stands = (geo.features ?? []).flatMap((f) => {
      const g = f.geometry;
      const p = f.properties ?? {};
      if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) return [];
      const [lng, lat] = g.coordinates;
      return [
        {
          id: String(p.OBJECTID ?? p.GmlID ?? `${lat},${lng}`),
          lat: round(lat),
          lng: round(lng),
          name: { en: p.Location_EN ?? "", zh: p.Location_TC ?? "" },
          region: { en: p.Region_EN ?? "", zh: p.Region_TC ?? "" },
          district: { en: p.District_EN ?? "", zh: p.District_TC ?? "" },
          kind: { en: p.Status_EN ?? "", zh: p.Status_TC ?? "" },
        },
      ];
    });
    if (stands.length < 20) throw new Error("too few taxi stands");
    await writeFile(dest, JSON.stringify(stands));
    console.log(`taxi stands: ${stands.length}`);
  } catch (err) {
    console.warn("taxi preprocess skipped:", err instanceof Error ? err.message : err);
  }
}

async function writeTram() {
  const dest = path.join(DATA, "tram.json");
  try {
    const res = await fetch("https://static.data.gov.hk/td/routes-fares-geojson/JSON_TRAM.json", {
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`tram ${res.status}`);
    const geo = await res.json();
    const stops = {};
    const routes = new Map();
    for (const f of geo.features ?? []) {
      const p = f.properties ?? {};
      const g = f.geometry;
      if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) continue;
      const [lng, lat] = g.coordinates;
      const stopId = String(p.stopId ?? `${p.routeId}-${p.stopSeq}`);
      stops[stopId] = {
        name: { en: p.stopNameE ?? "", zh: p.stopNameC ?? "" },
        location: { lat: round(lat), lng: round(lng) },
      };
      const rid = `${p.routeId}-${p.routeSeq}`;
      if (!routes.has(rid)) {
        routes.set(rid, {
          id: `tram+${p.routeSeq}+${p.locStartNameE}+${p.locEndNameE}`,
          route: "Tram",
          orig: { en: p.locStartNameE ?? "", zh: p.locStartNameC ?? "" },
          dest: { en: p.locEndNameE ?? "", zh: p.locEndNameC ?? "" },
          stops: [],
        });
      }
      const route = routes.get(rid);
      if (!route.stops.includes(stopId)) route.stops.push(stopId);
    }
    const pack = { routes: [...routes.values()], stops };
    if (pack.routes.length < 1) throw new Error("no tram routes");
    await writeFile(dest, JSON.stringify(pack));
    console.log(`tram routes: ${pack.routes.length} stops: ${Object.keys(stops).length}`);
  } catch (err) {
    console.warn("tram preprocess skipped:", err instanceof Error ? err.message : err);
  }
}

async function writeFerry() {
  const dest = path.join(DATA, "ferry-piers.json");
  try {
    const res = await fetch("https://static.data.gov.hk/td/routes-fares-geojson/JSON_FERRY.json", {
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`ferry ${res.status}`);
    const geo = await res.json();
    const piers = new Map();
    for (const f of geo.features ?? []) {
      const p = f.properties ?? {};
      const g = f.geometry;
      if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) continue;
      const [lng, lat] = g.coordinates;
      const nameEn = p.stopNameE || p.locStartNameE || "";
      const nameZh = p.stopNameC || p.locStartNameC || "";
      const key = `${nameEn}|${round(lat)}|${round(lng)}`;
      if (!piers.has(key)) {
        piers.set(key, {
          id: String(p.stopId ?? key),
          lat: round(lat),
          lng: round(lng),
          name: { en: nameEn, zh: nameZh },
          dests: [],
        });
      }
      const dest = { en: p.locEndNameE ?? "", zh: p.locEndNameC ?? "" };
      const pier = piers.get(key);
      if (dest.en && !pier.dests.some((d) => d.en === dest.en)) pier.dests.push(dest);
    }
    const list = [...piers.values()];
    if (list.length < 5) throw new Error("too few piers");
    await writeFile(dest, JSON.stringify(list));
    console.log(`ferry piers: ${list.length}`);
  } catch (err) {
    console.warn("ferry preprocess skipped:", err instanceof Error ? err.message : err);
  }
}

async function writeRoutePathsNote() {
  const dest = path.join(DATA, "route-paths.json");
  const note = {
    note: "Per-route road lines are generated into public/shapes by scripts/build-shapes.ts. TD routes-fares GeoJSON is stop points; franchised bus lines come from the CSDI FB_ROUTE_LINE layer. The headway GTFS zip has no shapes.txt.",
    source: "https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638844988873_41214/MapServer/0",
    paths: {},
  };
  await writeFile(dest, JSON.stringify(note));
}

async function writeIcons() {
  const src = path.join(ICONS, "app-mark.svg");
  const out192 = path.join(ICONS, "icon-192.png");
  const out512 = path.join(ICONS, "icon-512.png");
  try {
    await access(src);
    try {
      await access(out192);
      await access(out512);
      console.log("icons: app-mark.svg (icon-192/512.png already built)");
    } catch {
      console.warn("icons: run powershell -ExecutionPolicy Bypass -File scripts/build-icons.ps1");
    }
  } catch {
    console.warn("icons: missing public/icons/app-mark.svg");
  }
}

function round(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
