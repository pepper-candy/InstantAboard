import type { HkBasemapManifest, HkLocalMeta } from "./hkBasemapManifest";

const OPFS_DIR = "hk-basemap";
const META_KEY = "ia.v1.hkBasemap.meta";
const ACTIVE_NAME_KEY = "ia.v1.hkBasemap.activeName";
const PACK_READER_EPOCH_KEY = "ia.v1.hkBasemap.packReaderEpoch";
/** Bump when local pack reader semantics change (e.g. blob: Range → BlobSource). */
export const PACK_READER_EPOCH = 2;
const CACHE_NAME = "ia-hk-basemap-v1";
const CHANGE_EVENT = "ia-hk-basemap-change";

let cachedBlobUrl: string | null = null;
let cachedBlobVersion: string | null = null;

export type DownloadProgress = {
  received: number;
  total: number | null;
  ratio: number | null;
};

type ProgressFn = (p: DownloadProgress) => void;

function canUseWindow(): boolean {
  return typeof window !== "undefined";
}

function readMeta(): HkLocalMeta | null {
  if (!canUseWindow()) return null;
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HkLocalMeta;
    if (
      !parsed ||
      typeof parsed.version !== "string" ||
      typeof parsed.builtAt !== "string" ||
      typeof parsed.sha256 !== "string" ||
      typeof parsed.bytes !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeMeta(meta: HkLocalMeta | null): void {
  if (!canUseWindow()) return;
  if (!meta) {
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(ACTIVE_NAME_KEY);
    return;
  }
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

function activeFileName(version: string): string {
  return `hk.${version}.pmtiles`;
}

function partialFileName(version: string): string {
  return `hk.${version}.pmtiles.partial`;
}

function revokeCachedBlob(): void {
  if (cachedBlobUrl) {
    URL.revokeObjectURL(cachedBlobUrl);
    cachedBlobUrl = null;
    cachedBlobVersion = null;
  }
}

function emitChange(): void {
  if (!canUseWindow()) return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeHkBasemapChange(cb: () => void): () => void {
  if (!canUseWindow()) return () => {};
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!canUseWindow() || !navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_DIR, { create: true });
  } catch {
    return null;
  }
}

async function opfsWrite(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: ArrayBuffer,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function opfsRead(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<ArrayBuffer | null> {
  try {
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

async function opfsDelete(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch {
    /* missing ok */
  }
}

async function opfsExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function cachePut(name: string, data: ArrayBuffer, contentType: string): Promise<void> {
  if (!("caches" in globalThis)) return;
  const cache = await caches.open(CACHE_NAME);
  const res = new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
    },
  });
  await cache.put(`https://ia.local/hk-basemap/${name}`, res);
}

async function cacheGet(name: string): Promise<ArrayBuffer | null> {
  if (!("caches" in globalThis)) return null;
  const cache = await caches.open(CACHE_NAME);
  const res = await cache.match(`https://ia.local/hk-basemap/${name}`);
  if (!res) return null;
  return await res.arrayBuffer();
}

async function cacheDelete(name: string): Promise<void> {
  if (!("caches" in globalThis)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(`https://ia.local/hk-basemap/${name}`);
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function downloadBytes(
  url: string,
  expectedBytes: number,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HK pack download HTTP ${res.status}`);

  const totalHeader = Number(res.headers.get("content-length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : expectedBytes || null;

  if (!res.body) {
    const buf = await res.arrayBuffer();
    onProgress?.({
      received: buf.byteLength,
      total: buf.byteLength,
      ratio: 1,
    });
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress?.({
        received,
        total,
        ratio: total ? Math.min(1, received / total) : null,
      });
    }
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/**
 * Atomic swap:
 * 1. Download to `hk.<version>.pmtiles.partial`
 * 2. Verify bytes + sha256
 * 3. Move to final name; write local meta
 * 4. Point active reader at new file; then delete previous pack
 * Never delete old pack before new one verifies.
 */
export async function downloadAndSwapPack(
  manifest: HkBasemapManifest,
  opts?: { onProgress?: ProgressFn; signal?: AbortSignal },
): Promise<HkLocalMeta> {
  const previous = readMeta();
  const prevName = previous ? activeFileName(previous.version) : null;
  const partial = partialFileName(manifest.version);
  const finalName = activeFileName(manifest.version);

  const data = await downloadBytes(manifest.url, manifest.bytes, opts?.onProgress, opts?.signal);

  if (manifest.bytes > 0 && data.byteLength !== manifest.bytes) {
    throw new Error(`HK pack size mismatch: got ${data.byteLength}, expected ${manifest.bytes}`);
  }

  const digest = await sha256Hex(data);
  if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
    throw new Error("HK pack sha256 mismatch");
  }

  const dir = await opfsRoot();
  if (dir) {
    await opfsWrite(dir, partial, data);
    // Promote partial → final (write final, then delete partial)
    await opfsWrite(dir, finalName, data);
    await opfsDelete(dir, partial);
    if (prevName && prevName !== finalName) {
      await opfsDelete(dir, prevName);
    }
  } else {
    await cachePut(partial, data, "application/vnd.pmtiles");
    await cachePut(finalName, data, "application/vnd.pmtiles");
    await cacheDelete(partial);
    if (prevName && prevName !== finalName) {
      await cacheDelete(prevName);
    }
  }

  const meta: HkLocalMeta = {
    version: manifest.version,
    builtAt: manifest.builtAt,
    sha256: manifest.sha256.toLowerCase(),
    bytes: data.byteLength,
  };
  revokeCachedBlob();
  writeMeta(meta);
  if (canUseWindow()) {
    localStorage.setItem(ACTIVE_NAME_KEY, finalName);
  }
  emitChange();
  return meta;
}

export function hasPack(): boolean {
  return readMeta() != null;
}

export function localBuiltAt(): string | null {
  return readMeta()?.builtAt ?? null;
}

export function getLocalMeta(): HkLocalMeta | null {
  return readMeta();
}

export async function getLocalPack(): Promise<{
  meta: HkLocalMeta;
  blobUrl: string;
} | null> {
  const meta = readMeta();
  if (!meta) return null;

  if (cachedBlobUrl && cachedBlobVersion === meta.version) {
    return { meta, blobUrl: cachedBlobUrl };
  }

  const name = activeFileName(meta.version);
  const dir = await opfsRoot();
  let data: ArrayBuffer | null = null;
  if (dir && (await opfsExists(dir, name))) {
    data = await opfsRead(dir, name);
  }
  if (!data) {
    data = await cacheGet(name);
  }
  if (!data) {
    revokeCachedBlob();
    writeMeta(null);
    emitChange();
    return null;
  }
  revokeCachedBlob();
  const blob = new Blob([data], { type: "application/vnd.pmtiles" });
  const blobUrl = URL.createObjectURL(blob);
  cachedBlobUrl = blobUrl;
  cachedBlobVersion = meta.version;
  return { meta, blobUrl };
}

/** Drop local pack (tests / recovery). */
export async function clearLocalPack(): Promise<void> {
  const meta = readMeta();
  const name = meta ? activeFileName(meta.version) : null;
  const dir = await opfsRoot();
  if (dir && name) await opfsDelete(dir, name);
  if (name) await cacheDelete(name);
  revokeCachedBlob();
  writeMeta(null);
  emitChange();
}

/**
 * One-shot migration: packs written under an older reader (e.g. FetchSource+Range on
 * blob: URLs) are cleared so the client re-downloads without a manual site-data wipe.
 * Always advances the stored epoch to PACK_READER_EPOCH.
 */
export async function migratePackReaderEpoch(): Promise<void> {
  if (!canUseWindow()) return;
  const raw = localStorage.getItem(PACK_READER_EPOCH_KEY);
  const epoch = raw != null ? Number.parseInt(raw, 10) : 0;
  if (Number.isFinite(epoch) && epoch >= PACK_READER_EPOCH) return;
  if (hasPack()) {
    await clearLocalPack();
  }
  localStorage.setItem(PACK_READER_EPOCH_KEY, String(PACK_READER_EPOCH));
}
