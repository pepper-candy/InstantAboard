import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

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
    note: "TD routes-fares GeoJSON (JSON_BUS.json etc.) is Point-per-stop, not route LineStrings, and has no browser CORS. InstantAboard draws polylines through hkbus stop coordinates instead.",
    source: "https://static.data.gov.hk/td/routes-fares-geojson/JSON_BUS.json",
    paths: {},
  };
  await writeFile(dest, JSON.stringify(note));
}

async function writeIcons() {
  await writeFile(path.join(ICONS, "icon-192.png"), pngIcon(192));
  await writeFile(path.join(ICONS, "icon-512.png"), pngIcon(512));
}

function pngIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bg = [18, 17, 15, 255];
  const card = [225, 6, 0, 255];
  const ink = [244, 239, 230, 255];
  const pad = Math.round(size * 0.16);
  const badgeX0 = pad;
  const badgeY0 = pad;
  const badgeX1 = Math.round(size * 0.62);
  const badgeY1 = Math.round(size * 0.55);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      let px = bg;
      if (x >= badgeX0 && x <= badgeX1 && y >= badgeY0 && y <= badgeY1) px = card;
      const barY = Math.round(size * 0.68);
      if (y >= barY && y <= barY + Math.round(size * 0.08)) {
        const gap = Math.round(size * 0.04);
        const w = Math.round((size - pad * 2 - gap * 2) / 3);
        if (x >= pad && x < pad + w) px = ink;
        if (x >= pad + w + gap && x < pad + 2 * w + gap) px = ink;
        if (x >= pad + 2 * w + 2 * gap && x < pad + 3 * w + 2 * gap) px = [155, 146, 134, 255];
      }
      raw[o] = px[0];
      raw[o + 1] = px[1];
      raw[o + 2] = px[2];
      raw[o + 3] = px[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat(chunks);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const crc = crc32(body);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function round(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
