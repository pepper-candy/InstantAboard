const CACHE = "ia-v1";
const TILE_CACHE = "ia-tiles-v1";
const TILE_HOST = /^(?:[abc]\.)?tile\.openstreetmap\.org$/;
const TILE_MAX = 480;
const TILE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["/", "/add", "/icons/icon-192.png"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (TILE_HOST.test(url.hostname) && url.pathname.endsWith(".png")) {
    event.respondWith(osmTile(req));
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
  );
});

async function osmTile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit && tileAgeMs(hit) < TILE_FRESH_MS) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      void cache.put(req, res.clone()).then(() => trimTiles(cache));
    }
    if (res.ok) return res;
    return hit || res;
  } catch (err) {
    if (hit) return hit;
    throw err;
  }
}

function tileAgeMs(res) {
  const at = Date.parse(res.headers.get("date") || "");
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Date.now() - at);
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  const extra = keys.length - TILE_MAX;
  if (extra <= 0) return;
  await Promise.all(keys.slice(0, extra).map((key) => cache.delete(key)));
}
