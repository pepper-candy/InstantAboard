import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const db = JSON.parse(fs.readFileSync(path.join(root, "scripts/.cache/routeFareList.min.json"), "utf8"));

const byEn = new Map();
for (const [id, s] of Object.entries(db.stopList || {})) {
  if (!id.startsWith("LR")) continue;
  const en = (s.name?.en || "").trim();
  byEn.set(en.toLowerCase(), { id, en, zh: s.name?.zh || "" });
}

function stopOf(name) {
  const n = name.replace(/\s*\(Platform\s*\d+\)/i, "").trim();
  let hit = byEn.get(n.toLowerCase());
  if (!hit && /tin king/i.test(n)) hit = byEn.get("tin king");
  if (!hit) throw new Error("Unknown stop: " + name);
  return hit;
}

function leg(destEn, first, last) {
  if (!first || first === "-" || !last || last === "-") return null;
  const d = stopOf(destEn);
  return { destEn: d.en, destZh: d.zh, first, last };
}

/** route -> rows: { stop, firstToA, firstToB, lastToA, lastToB } ; A/B are dest names; circular: first,last only */
const ROUTES = [
  {
    route: "505",
    a: "Siu Hong",
    b: "Sam Shing",
    rows: [
      ["Sam Shing", "05:30", "-", "01:10", "-"],
      ["Siu Lun", "05:31", "05:48", "01:11", "01:21"],
      ["On Ting", "05:33", "05:46", "01:13", "01:19"],
      ["Town Centre", "05:35", "05:44", "01:15", "01:17"],
      ["Tuen Mun", "05:37", "05:42", "01:17", "01:15"],
      ["Kin On", "05:39", "05:39", "01:19", "01:12"],
      ["Shan King (South)", "05:41", "-", "01:22", "-"],
      ["Shan King (North)", "05:42", "-", "01:23", "-"],
      ["Ming Kum", "-", "05:37", "-", "01:10"],
      ["Shek Pai", "05:44", "05:35", "01:25", "01:08"],
      ["San Wai", "05:46", "05:33", "01:27", "01:06"],
      ["Leung King", "05:48", "05:32", "01:29", "01:05"],
      ["Tin King", "05:49", "05:31", "01:30", "01:04"],
      ["Kin Sang", "05:51", "05:29", "01:31", "01:02"],
      ["Ching Chung", "05:53", "05:28", "01:33", "01:01"],
      ["Kei Lun", "05:55", "-", "01:35", "-"],
      ["Siu Hong", "-", "05:26", "-", "00:59"],
    ],
  },
  {
    route: "507",
    a: "Tin King",
    b: "Tuen Mun Ferry Pier",
    rows: [
      ["Tuen Mun Ferry Pier", "05:24", "-", "00:56", "-"],
      ["Siu Hei", "05:26", "05:52", "00:58", "01:28"],
      ["Hoi Wong Road", "05:28", "05:49", "01:00", "01:25"],
      ["Goodview Garden", "05:29", "05:48", "01:01", "01:24"],
      ["Siu Lun", "05:31", "05:46", "01:03", "01:22"],
      ["On Ting", "05:33", "05:44", "01:05", "01:20"],
      ["Town Centre", "05:35", "05:41", "01:07", "01:18"],
      ["Tuen Mun", "05:37", "05:39", "01:09", "01:16"],
      ["Ho Tin", "05:39", "05:37", "01:11", "01:14"],
      ["Choy Yee Bridge", "05:40", "05:36", "01:12", "01:13"],
      ["Ngan Wai", "05:41", "05:34", "01:13", "01:11"],
      ["Tai Hing (South)", "05:43", "05:33", "01:15", "01:10"],
      ["Tai Hing (North)", "05:45", "05:31", "01:17", "01:08"],
      ["San Wai", "05:48", "05:29", "01:19", "01:06"],
      ["Leung King", "05:50", "05:28", "01:21", "01:05"],
      ["Tin King (Platform 2)", "-", "05:27", "-", "01:04"],
      ["Tin King (Platform 3)", "-", "05:27", "-", "01:04"],
    ],
  },
  {
    route: "610",
    a: "Yuen Long",
    b: "Tuen Mun Ferry Pier",
    rows: [
      ["Tuen Mun Ferry Pier", "05:21", "-", "00:36", "-"],
      ["Melody Garden", "05:22", "06:02", "00:37", "01:33"],
      ["Butterfly", "05:24", "06:00", "00:39", "01:31"],
      ["Light Rail Depot", "05:25", "05:59", "00:40", "01:30"],
      ["Lung Mun", "05:27", "05:57", "00:42", "01:28"],
      ["Tsing Shan Tsuen", "05:29", "05:55", "00:44", "01:26"],
      ["Tsing Wun", "05:30", "05:54", "00:45", "01:25"],
      ["Ming Kum", "05:32", "05:52", "00:47", "01:23"],
      ["Shek Pai", "05:34", "05:50", "00:49", "01:21"],
      ["Tai Hing (North)", "05:37", "05:48", "00:52", "01:19"],
      ["Tai Hing (South)", "05:39", "05:47", "00:54", "01:18"],
      ["Ngan Wai", "05:40", "05:45", "00:55", "01:16"],
      ["Affluence", "05:42", "05:43", "00:57", "01:14"],
      ["Tuen Mun Hospital", "05:43", "05:42", "00:58", "01:13"],
      ["Siu Hong", "05:45", "05:41", "00:59", "01:12"],
      ["Lam Tei", "05:47", "05:39", "01:01", "01:10"],
      ["Nai Wai", "05:49", "05:37", "01:03", "01:08"],
      ["Chung Uk Tsuen", "05:50", "05:36", "01:04", "01:07"],
      ["Hung Shui Kiu", "05:52", "05:34", "01:06", "01:05"],
      ["Tong Fong Tsuen", "05:55", "05:31", "01:09", "01:02"],
      ["Ping Shan", "05:56", "05:30", "01:10", "01:01"],
      ["Shui Pin Wai", "05:58", "05:28", "01:12", "00:59"],
      ["Fung Nin Road", "06:00", "05:26", "01:14", "00:57"],
      ["Hong Lok Road", "06:02", "05:24", "01:16", "00:55"],
      ["Tai Tong Road", "06:03", "05:22", "01:17", "00:53"],
      ["Yuen Long", "-", "05:20", "-", "00:51"],
    ],
  },
  {
    route: "614",
    a: "Yuen Long",
    b: "Tuen Mun Ferry Pier",
    rows: [
      ["Tuen Mun Ferry Pier", "05:20", "-", "00:44", "-"],
      ["Siu Hei", "05:22", "05:57", "00:46", "01:24"],
      ["Hoi Wong Road", "05:24", "05:54", "00:48", "01:21"],
      ["Goodview Garden", "05:25", "05:53", "00:49", "01:20"],
      ["Siu Lun", "05:27", "05:51", "00:51", "01:18"],
      ["On Ting", "05:29", "05:49", "00:53", "01:16"],
      ["Town Centre", "05:31", "05:47", "00:55", "01:14"],
      ["Pui To", "05:34", "05:45", "00:58", "01:12"],
      ["Hoh Fuk Tong", "05:35", "05:44", "00:59", "01:11"],
      ["San Hui", "05:36", "05:43", "01:00", "01:10"],
      ["Prime View", "05:38", "05:41", "01:02", "01:08"],
      ["Fung Tei", "05:39", "05:40", "01:03", "01:07"],
      ["Siu Hong", "05:41", "05:38", "01:05", "01:05"],
      ["Lam Tei", "05:43", "05:36", "01:07", "01:03"],
      ["Nai Wai", "05:45", "05:34", "01:09", "01:01"],
      ["Chung Uk Tsuen", "05:46", "05:33", "01:10", "01:00"],
      ["Hung Shui Kiu", "05:48", "05:31", "01:12", "00:58"],
      ["Tong Fong Tsuen", "05:51", "05:28", "01:15", "00:55"],
      ["Ping Shan", "05:52", "05:27", "01:16", "00:54"],
      ["Shui Pin Wai", "05:54", "05:25", "01:18", "00:52"],
      ["Fung Nin Road", "05:56", "05:23", "01:20", "00:50"],
      ["Hong Lok Road", "05:58", "05:21", "01:22", "00:48"],
      ["Tai Tong Road", "06:00", "05:19", "01:23", "00:46"],
      ["Yuen Long", "-", "05:17", "-", "00:44"],
    ],
  },
  {
    route: "614P",
    a: "Siu Hong",
    b: "Tuen Mun Ferry Pier",
    rows: [
      ["Tuen Mun Ferry Pier", "05:37", "-", "00:38", "-"],
      ["Siu Hei", "05:39", "06:17", "00:40", "01:32"],
      ["Hoi Wong Road", "05:41", "06:14", "00:42", "01:29"],
      ["Goodview Garden", "05:42", "06:13", "00:43", "01:28"],
      ["Siu Lun", "05:44", "06:11", "00:45", "01:26"],
      ["On Ting", "05:46", "06:09", "00:47", "01:24"],
      ["Town Centre", "05:48", "06:07", "00:49", "01:22"],
      ["Pui To", "05:51", "06:05", "00:52", "01:20"],
      ["Hoh Fuk Tong", "05:52", "06:04", "00:53", "01:19"],
      ["San Hui", "05:53", "06:02", "00:54", "01:17"],
      ["Prime View", "05:55", "06:00", "00:56", "01:15"],
      ["Fung Tei", "05:57", "05:59", "00:57", "01:14"],
      ["Siu Hong", "-", "05:58", "-", "01:13"],
    ],
  },
  {
    route: "615",
    a: "Yuen Long",
    b: "Tuen Mun Ferry Pier",
    rows: [
      ["Tuen Mun Ferry Pier", "05:18", "-", "00:29", "-"],
      ["Melody Garden", "05:19", "06:00", "00:30", "01:10"],
      ["Butterfly", "05:21", "05:58", "00:32", "01:08"],
      ["Light Rail Depot", "05:22", "05:57", "00:33", "01:07"],
      ["Lung Mun", "05:24", "05:55", "00:35", "01:05"],
      ["Tsing Shan Tsuen", "05:26", "05:54", "00:37", "01:03"],
      ["Tsing Wun", "05:27", "05:53", "00:38", "01:02"],
      ["Ming Kum", "05:29", "05:51", "00:40", "01:00"],
      ["Shek Pai", "05:31", "05:49", "00:42", "00:58"],
      ["San Wai", "05:33", "05:47", "00:44", "00:56"],
      ["Leung King", "05:35", "05:46", "00:46", "00:55"],
      ["Tin King", "05:36", "05:45", "00:47", "00:54"],
      ["Kin Sang", "05:37", "05:43", "00:48", "00:52"],
      ["Ching Chung", "05:39", "05:42", "00:50", "00:51"],
      ["Siu Hong", "05:42", "05:39", "00:53", "00:48"],
      ["Lam Tei", "05:44", "05:37", "00:55", "00:46"],
      ["Nai Wai", "05:46", "05:35", "00:57", "00:44"],
      ["Chung Uk Tsuen", "05:47", "05:34", "00:58", "00:43"],
      ["Hung Shui Kiu", "05:49", "05:32", "01:00", "00:41"],
      ["Tong Fong Tsuen", "05:52", "05:29", "01:03", "00:38"],
      ["Ping Shan", "05:53", "05:28", "01:04", "00:37"],
      ["Shui Pin Wai", "05:55", "05:26", "01:06", "00:36"],
      ["Fung Nin Road", "05:57", "05:24", "01:08", "00:34"],
      ["Hong Lok Road", "05:59", "05:22", "01:10", "00:32"],
      ["Tai Tong Road", "06:01", "05:20", "01:11", "00:30"],
      ["Yuen Long", "-", "05:18", "-", "00:28"],
    ],
  },
  {
    route: "615P",
    a: "Siu Hong",
    b: "Tuen Mun Ferry Pier",
    rows: [
      ["Tuen Mun Ferry Pier", "05:35", "-", "00:30", "-"],
      ["Melody Garden", "05:36", "05:52", "00:31", "01:34"],
      ["Butterfly", "05:38", "05:50", "00:33", "01:32"],
      ["Light Rail Depot", "05:39", "05:49", "00:34", "01:31"],
      ["Lung Mun", "05:41", "05:47", "00:36", "01:29"],
      ["Tsing Shan Tsuen", "05:43", "05:45", "00:38", "01:27"],
      ["Tsing Wun", "05:44", "05:44", "00:39", "01:26"],
      ["Ming Kum", "05:46", "05:42", "00:41", "01:24"],
      ["Shek Pai", "05:48", "05:40", "00:43", "01:22"],
      ["San Wai", "05:50", "05:38", "00:45", "01:20"],
      ["Leung King", "05:52", "05:37", "00:47", "01:19"],
      ["Tin King", "05:53", "05:36", "00:48", "01:18"],
      ["Kin Sang", "05:54", "05:34", "00:49", "01:16"],
      ["Ching Chung", "05:56", "05:33", "00:51", "01:15"],
      ["Kei Lun", "05:58", "05:31", "00:53", "01:13"],
      ["Siu Hong", "-", "05:31", "-", "01:13"],
    ],
  },
  {
    route: "751",
    a: "Tin Yat",
    b: "Yau Oi",
    rows: [
      ["Yau Oi", "05:20", "-", "00:45", "-"],
      ["On Ting", "05:21", "-", "00:46", "-"],
      ["Town Centre", "05:23", "06:03", "00:48", "01:31"],
      ["Tuen Mun", "05:25", "06:01", "00:50", "01:29"],
      ["Ho Tin", "05:27", "05:59", "00:52", "01:27"],
      ["Choy Yee Bridge", "05:28", "05:58", "00:53", "01:26"],
      ["Affluence", "05:30", "05:56", "00:55", "01:24"],
      ["Tuen Mun Hospital", "05:31", "05:55", "00:56", "01:23"],
      ["Siu Hong", "05:32", "05:52", "00:57", "01:21"],
      ["Lam Tei", "05:34", "05:50", "00:59", "01:19"],
      ["Nai Wai", "05:36", "05:48", "01:01", "01:17"],
      ["Chung Uk Tsuen", "05:37", "05:47", "01:02", "01:16"],
      ["Hung Shui Kiu", "05:39", "05:45", "01:04", "01:14"],
      ["Hang Mei Tsuen", "05:42", "05:41", "01:07", "01:10"],
      ["Tin Shui Wai", "05:45", "05:38", "01:10", "01:07"],
      ["Tin Tsz", "05:47", "05:36", "01:12", "01:05"],
      ["Tin Wu", "05:48", "05:35", "01:13", "01:04"],
      ["Ginza", "05:49", "05:34", "01:14", "01:03"],
      ["Tin Wing", "05:51", "05:33", "01:16", "01:02"],
      ["Chestwood", "05:53", "05:30", "01:18", "00:59"],
      ["Chung Fu", "05:57", "05:26", "01:22", "00:55"],
      ["Tin Fu", "05:58", "05:25", "01:23", "00:54"],
      ["Tin Yat", "-", "05:25", "-", "00:54"],
    ],
  },
  {
    route: "761P",
    a: "Tin Yat",
    b: "Yuen Long",
    rows: [
      ["Yuen Long", "05:28", "-", "01:05", "-"],
      ["Tai Tong Road", "05:30", "05:49", "01:07", "01:13"],
      ["Hong Lok Road", "05:32", "05:47", "01:09", "01:11"],
      ["Fung Nin Road", "05:34", "05:45", "01:11", "01:09"],
      ["Shui Pin Wai", "05:36", "05:43", "01:13", "01:07"],
      ["Ping Shan", "05:38", "05:41", "01:15", "01:05"],
      ["Tong Fong Tsuen", "05:39", "05:40", "01:16", "01:04"],
      ["Hang Mei Tsuen", "05:42", "05:36", "01:20", "01:01"],
      ["Tin Yiu", "05:45", "05:33", "01:23", "00:58"],
      ["Locwood", "05:46", "05:31", "01:24", "00:56"],
      ["Tin Shui", "05:48", "05:30", "01:26", "00:55"],
      ["Chung Fu", "05:50", "05:27", "01:28", "00:52"],
      ["Tin Fu", "05:51", "05:26", "01:29", "00:51"],
      ["Tin Yat", "-", "05:26", "-", "00:51"],
    ],
  },
];

const CIRCULAR = [
  {
    route: "705",
    destEn: "Tin Shui Wai",
    destZh: "天水圍",
    rows: [
      ["Tin Shui Wai", "05:11", "01:02"],
      ["Tin Tsz", "05:12", "01:03"],
      ["Tin Wu", "05:13", "01:04"],
      ["Ginza", "05:14", "01:05"],
      ["Tin Wing", "05:16", "01:07"],
      ["Tin Yuet", "05:19", "01:10"],
      ["Tin Sau", "05:20", "01:11"],
      ["Wetland Park", "05:22", "01:13"],
      ["Tin Heng", "05:23", "01:14"],
      ["Tin Yat", "05:25", "01:16"],
      ["Tin Fu", "05:27", "01:18"],
      ["Chung Fu", "05:28", "01:19"],
      ["Tin Shui", "05:31", "01:22"],
      ["Locwood", "05:32", "01:23"],
      ["Tin Yiu", "05:34", "01:25"],
    ],
  },
  {
    route: "706",
    destEn: "Tin Shui Wai",
    destZh: "天水圍",
    rows: [
      ["Tin Shui Wai", "05:20", "01:10"],
      ["Tin Yiu", "05:22", "01:12"],
      ["Locwood", "05:24", "01:14"],
      ["Tin Shui", "05:26", "01:16"],
      ["Chung Fu", "05:28", "01:18"],
      ["Tin Fu", "05:29", "01:19"],
      ["Tin Yat", "05:30", "01:20"],
      ["Tin Heng", "05:32", "01:22"],
      ["Wetland Park", "05:33", "01:23"],
      ["Tin Sau", "05:35", "01:25"],
      ["Tin Yuet", "05:37", "01:27"],
      ["Tin Wing", "05:40", "01:30"],
      ["Ginza", "05:41", "01:31"],
      ["Tin Wu", "05:42", "01:32"],
      ["Tin Tsz", "05:43", "01:33"],
    ],
  },
];

const hours = {};

function pushLeg(bucket, dir, item) {
  if (!item) return;
  const list = bucket[dir] ?? (bucket[dir] = []);
  if (list.some((x) => x.destEn === item.destEn && x.first === item.first && x.last === item.last)) return;
  list.push(item);
}

for (const r of ROUTES) {
  for (const row of r.rows) {
    const [stopName, fA, fB, lA, lB] = row;
    const stop = stopOf(stopName);
    const key = `${r.route}:${stop.id}`;
    const bucket = hours[key] ?? (hours[key] = {});
    pushLeg(bucket, "UP", leg(r.a, fA, lA));
    pushLeg(bucket, "DOWN", leg(r.b, fB, lB));
  }
}

for (const r of CIRCULAR) {
  for (const [stopName, first, last] of r.rows) {
    const stop = stopOf(stopName);
    const key = `${r.route}:${stop.id}`;
    const bucket = hours[key] ?? (hours[key] = {});
    pushLeg(bucket, "UP", { destEn: "Circular", destZh: "循環", first, last });
  }
}

const out = {
  source: "https://www.mtr.com.hk/en/customer/services/schedule_index.html",
  note: "Light Rail first/last trains (reference). Subject to change.",
  hours,
};

const dest = path.join(root, "public/data/lrt-first-last.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log("wrote", dest, "keys", Object.keys(hours).length);
