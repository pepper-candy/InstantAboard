import type { EtaDb } from "./types";

const SOURCE = "https://data.hkbus.app/routeFareList.min.json";
const IDB_NAME = "instantaboard";
const IDB_STORE = "kv";
const IDB_KEY = "eta-db";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Cached = { at: number; db: EtaDb };

let memory: EtaDb | null = null;
let inflight: Promise<EtaDb> | null = null;

export function getCachedDb(): EtaDb | null {
  return memory;
}

export async function loadEtaDb(): Promise<EtaDb> {
  if (memory) return memory;
  if (inflight) return inflight;
  inflight = (async () => {
    const cached = await readIdb();
    if (cached && Date.now() - cached.at < MAX_AGE_MS) {
      memory = cached.db;
      void refreshInBackground();
      return cached.db;
    }
    try {
      const db = await fetchDb();
      memory = db;
      await writeIdb({ at: Date.now(), db });
      return db;
    } catch (err) {
      if (cached) {
        memory = cached.db;
        return cached.db;
      }
      throw err;
    }
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function refreshInBackground(): Promise<void> {
  try {
    const db = await fetchDb();
    memory = db;
    await writeIdb({ at: Date.now(), db });
  } catch {
    /* keep stale */
  }
}

async function fetchDb(): Promise<EtaDb> {
  const res = await fetch(SOURCE, { cache: "force-cache" });
  if (!res.ok) throw new Error(`route index ${res.status}`);
  return retainMtr((await res.json()) as EtaDb);
}

/** MTR lines and their station stops stay on the db through load. */
export function retainMtr(db: EtaDb): EtaDb {
  const routeList = { ...db.routeList };
  const stopList = { ...db.stopList };
  for (const [id, route] of Object.entries(db.routeList ?? {})) {
    if (!route?.co?.includes("mtr")) continue;
    routeList[id] = route;
    for (const stopId of route.stops?.mtr ?? []) {
      const stop = db.stopList?.[stopId];
      if (stop) stopList[stopId] = stop;
    }
  }
  return { ...db, routeList, stopList };
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function readIdb(): Promise<Cached | null> {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onerror = () => resolve(null);
    req.onsuccess = () => resolve((req.result as Cached | undefined) ?? null);
  });
}

async function writeIdb(value: Cached): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
