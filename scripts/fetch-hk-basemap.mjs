/**
 * Pull HK offline pack from the GitHub Release into public/hk-basemap/
 * so the browser loads same-origin static files (GitHub Releases have no CORS).
 * Runs in prebuild. Never commits the .pmtiles (gitignored).
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { createWriteStream, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public", "hk-basemap");
const RELEASE =
  process.env.HK_BASEMAP_RELEASE_URL ??
  "https://github.com/pepper-candy/InstantAboard/releases/download/hk-basemap";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`fetch ${url} → HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
  if (process.env.HK_BASEMAP_SKIP_FETCH === "1") {
    console.log("==> HK basemap fetch skipped (HK_BASEMAP_SKIP_FETCH=1)");
    return;
  }

  await mkdir(OUT, { recursive: true });
  const packPath = path.join(OUT, "hk.pmtiles");
  const manPath = path.join(OUT, "manifest.json");

  console.log(`==> Fetch HK basemap manifest from ${RELEASE}`);
  const manRes = await fetch(`${RELEASE}/manifest.json`, { redirect: "follow" });
  if (!manRes.ok) throw new Error(`manifest HTTP ${manRes.status}`);
  const man = await manRes.json();
  if (!man || typeof man !== "object" || !man.sha256 || !man.bytes) {
    throw new Error("manifest missing sha256/bytes");
  }

  const force = process.env.HK_BASEMAP_FORCE_FETCH === "1";
  let needPack = force || !(await exists(packPath));
  if (!needPack) {
    const st = statSync(packPath);
    if (man.bytes > 0 && st.size !== man.bytes) needPack = true;
  }

  if (needPack) {
    console.log(`==> Download hk.pmtiles (${man.bytes} bytes)…`);
    await download(`${RELEASE}/hk.pmtiles`, packPath);
  } else {
    console.log("==> hk.pmtiles already present — keep");
  }

  const st = statSync(packPath);
  if (man.bytes > 0 && st.size !== man.bytes) {
    throw new Error(`pack size mismatch local=${st.size} expected=${man.bytes}`);
  }

  // Clients must use same-origin path (served from /hk-basemap/).
  const outMan = {
    ...man,
    url: "/hk-basemap/hk.pmtiles",
    bytes: st.size,
  };
  await writeFile(manPath, `${JSON.stringify(outMan, null, 2)}\n`, "utf8");
  console.log(
    `==> Wrote public/hk-basemap/ version=${outMan.version} bytes=${st.size} sha256=${outMan.sha256.slice(0, 12)}…`,
  );
}

main().catch((err) => {
  console.error("HK basemap fetch failed:", err);
  if (process.env.VERCEL || process.env.CI || process.env.HK_BASEMAP_REQUIRE === "1") {
    process.exit(1);
  }
  console.warn("==> Continuing without pack (online-only basemap this run)");
  process.exit(0);
});
