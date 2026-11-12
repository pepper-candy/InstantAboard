import type { HkBasemapManifest, HkLocalMeta } from "./hkBasemapManifest";

const OPFS_DIR = "hk-basemap";
const META_KEY = "ia.v1.hkBasemap.meta";
const ACTIVE_NAME_KEY = "ia.v1.hkBasemap.activeName";
const PACK_READER_EPOCH_KEY = "ia.v1.hkBasemap.packReaderEpoch";
/** Bump when local pack reader semantics change (e.g. blob: Range → BlobSource). */
export const PACK_READER_EPOCH = 2;
const CACHE_NAME = "ia-hk-basemap-v1";
const CHANGE_EVENT = "ia-hk-basemap-change";
/** Commit partial bytes on this cadence so a killed PWA can Range-resume. */
const PARTIAL_FLUSH_BYTES = 256 * 1024;

let cachedBlobUrl: string | null = null;
let cachedBlobVersion: string | null = null;
let cachedBlobTrusted = false;
let persistGranted = false;

export type DownloadProgress = {
  received: number;
  total: number | null;
  ratio: number | null;
};

type ProgressFn = (p: DownloadProgress) => void;

type Dest =
  | { kind: "opfs"; dir: FileSystemDirectoryHandle }
  | { kind: "cache" };

type PartIndex = { bytes: number; parts: number };

class PackCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackCorruptError";
  }
}

class PackOffsetError extends Error {
  constructor() {
    super("HK pack partial offset mismatch");
    this.name = "PackOffsetError";
  }
}

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

function readStoredEpoch(): number | null {
  if (!canUseWindow()) return null;
  const raw = localStorage.getItem(PACK_READER_EPOCH_KEY);
  if (raw == null) return null;
  const epoch = Number.parseInt(raw, 10);
  return Number.isFinite(epoch) ? epoch : null;
}

function stampPackReaderEpoch(): void {
  if (!canUseWindow()) return;
  localStorage.setItem(PACK_READER_EPOCH_KEY, String(PACK_READER_EPOCH));
}

/** Stored epochs that used FetchSource+Range on blob: URLs and must be re-downloaded. */
function isKnownStaleEpoch(epoch: number): boolean {
  return epoch >= 0 && epoch < PACK_READER_EPOCH;
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
  cachedBlobTrusted = false;
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

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException
    ? e.name === "AbortError"
    : e instanceof Error && e.name === "AbortError";
}

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

async function requestPersistentStorage(): Promise<void> {
  if (persistGranted || !canUseWindow() || !navigator.storage?.persist) return;
  try {
    persistGranted = await navigator.storage.persist();
  } catch {
    /* try again on a later boot or save */
  }
}

/**
 * Ask the browser to keep OPFS/Cache if a pack file already matches its meta.
 * No permission UI — this is the StorageManager call only.
 */
export async function retainHkBasemapStorage(): Promise<void> {
  try {
    if (!(await installedPackMatchesMeta())) return;
    await requestPersistentStorage();
  } catch {
    /* ignore */
  }
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

async function opfsSize(dir: FileSystemDirectoryHandle, name: string): Promise<number> {
  try {
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return file.size;
  } catch {
    return 0;
  }
}

function cacheKey(name: string): string {
  return `https://ia.local/hk-basemap/${name}`;
}

function partKey(name: string, index: number): string {
  return `https://ia.local/hk-basemap/${name}.part.${index}`;
}

function indexKey(name: string): string {
  return `https://ia.local/hk-basemap/${name}.index`;
}

function cacheAvailable(): boolean {
  return "caches" in globalThis;
}

async function cachePut(name: string, data: ArrayBuffer, contentType: string): Promise<void> {
  if (!cacheAvailable()) return;
  const cache = await caches.open(CACHE_NAME);
  const res = new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
    },
  });
  await cache.put(cacheKey(name), res);
}

async function cacheGet(name: string): Promise<ArrayBuffer | null> {
  if (!cacheAvailable()) return null;
  const cache = await caches.open(CACHE_NAME);
  const res = await cache.match(cacheKey(name));
  if (!res) return null;
  return await res.arrayBuffer();
}

function asByteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

async function readPartIndex(cache: Cache, name: string): Promise<PartIndex> {
  try {
    const res = await cache.match(indexKey(name));
    if (!res) return { bytes: 0, parts: 0 };
    const json = (await res.json()) as { bytes?: unknown; parts?: unknown };
    const parts = asByteCount(json.parts);
    return { bytes: asByteCount(json.bytes), parts: Math.min(parts, 4096) };
  } catch {
    return { bytes: 0, parts: 0 };
  }
}

async function cacheDeleteTree(name: string): Promise<void> {
  if (!cacheAvailable()) return;
  const cache = await caches.open(CACHE_NAME);
  const idx = await readPartIndex(cache, name);
  const jobs: Promise<boolean>[] = [cache.delete(cacheKey(name)), cache.delete(indexKey(name))];
  for (let i = 0; i < idx.parts; i += 1) jobs.push(cache.delete(partKey(name, i)));
  await Promise.all(jobs);
}

async function cacheStoredSize(name: string): Promise<number> {
  if (!cacheAvailable()) return 0;
  const cache = await caches.open(CACHE_NAME);
  const idx = await readPartIndex(cache, name);
  if (idx.parts > 0) return idx.bytes;
  const whole = await cache.match(cacheKey(name));
  if (!whole) return 0;
  const header = Number(whole.headers.get("content-length"));
  if (Number.isFinite(header) && header > 0) return header;
  return (await whole.blob()).size;
}

async function concatParts(cache: Cache, name: string, idx: PartIndex): Promise<ArrayBuffer | null> {
  if (idx.parts <= 0 || idx.bytes <= 0) return null;
  const out = new Uint8Array(idx.bytes);
  let offset = 0;
  for (let i = 0; i < idx.parts; i += 1) {
    const res = await cache.match(partKey(name, i));
    if (!res) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (offset + buf.byteLength > out.byteLength) return null;
    out.set(buf, offset);
    offset += buf.byteLength;
  }
  if (offset !== idx.bytes) return null;
  return out.buffer;
}

async function cacheReadName(name: string): Promise<ArrayBuffer | null> {
  if (!cacheAvailable()) return null;
  const cache = await caches.open(CACHE_NAME);
  const idx = await readPartIndex(cache, name);
  if (idx.parts > 0) return concatParts(cache, name, idx);
  return cacheGet(name);
}

async function removeEverywhere(name: string): Promise<void> {
  const dir = await opfsRoot();
  if (dir) await opfsDelete(dir, name);
  await cacheDeleteTree(name);
}

async function installedByteSize(name: string, expected = 0): Promise<number> {
  const dir = await opfsRoot();
  if (dir) {
    const size = await opfsSize(dir, name);
    if (size > 0 && (expected <= 0 || size === expected)) return size;
  }
  const cached = await cacheStoredSize(name);
  if (cached > 0 && (expected <= 0 || cached === expected)) return cached;
  return 0;
}

/** Byte size only — a full sha here would run before first paint. */
async function installedPackMatchesMeta(): Promise<boolean> {
  const meta = readMeta();
  if (!meta || meta.bytes <= 0) return false;
  const size = await installedByteSize(activeFileName(meta.version), meta.bytes);
  return size === meta.bytes;
}

async function chooseDest(partial: string, finalName: string, expected: number): Promise<Dest> {
  const dir = await opfsRoot();
  const opfsPartial = dir ? await opfsSize(dir, partial) : 0;
  const opfsFinal = dir ? await opfsSize(dir, finalName) : 0;
  const cachePartial = await cacheStoredSize(partial);
  const cacheFinal = await cacheStoredSize(finalName);
  const opfsScore = Math.max(opfsPartial, expected > 0 && opfsFinal === expected ? expected : 0);
  const cacheScore = Math.max(cachePartial, expected > 0 && cacheFinal === expected ? expected : 0);
  if (dir && opfsScore >= cacheScore && (opfsScore > 0 || cacheScore === 0)) return { kind: "opfs", dir };
  if (cacheScore > 0 && cacheAvailable()) return { kind: "cache" };
  if (dir) return { kind: "opfs", dir };
  if (cacheAvailable()) return { kind: "cache" };
  throw new Error("HK pack storage unavailable");
}

async function storedSize(dest: Dest, name: string): Promise<number> {
  if (dest.kind === "opfs") return opfsSize(dest.dir, name);
  return cacheStoredSize(name);
}

async function readStored(dest: Dest, name: string): Promise<ArrayBuffer | null> {
  if (dest.kind === "opfs") {
    const data = await opfsRead(dest.dir, name);
    if (data && data.byteLength > 0) return data;
    return null;
  }
  const data = await cacheReadName(name);
  if (data && data.byteLength > 0) return data;
  return null;
}

async function removeStored(dest: Dest, name: string): Promise<void> {
  if (dest.kind === "opfs") {
    await opfsDelete(dest.dir, name);
    return;
  }
  await cacheDeleteTree(name);
}

async function writeWhole(dest: Dest, name: string, data: ArrayBuffer): Promise<void> {
  if (dest.kind === "opfs") {
    await opfsWrite(dest.dir, name, data);
    return;
  }
  if (!cacheAvailable()) throw new Error("HK pack storage unavailable");
  await cachePut(name, data, "application/vnd.pmtiles");
}

async function responseStream(res: Response): Promise<ReadableStream<Uint8Array>> {
  if (res.body) return res.body;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

function parseContentRange(header: string | null): { start: number } | null {
  if (!header) return null;
  const match = /^bytes\s+(\d+)-\d+\/(\d+|\*)\s*$/i.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  if (!Number.isFinite(start)) return null;
  return { start };
}

function rangeIsSuffix(res: Response, have: number, expected: number): boolean {
  const parsed = parseContentRange(res.headers.get("content-range"));
  if (parsed) return parsed.start === have;
  const len = Number(res.headers.get("content-length"));
  if (expected > 0 && Number.isFinite(len) && len === expected) return false;
  return true;
}

async function openPackResponse(
  url: string,
  have: number,
  expected: number,
  signal?: AbortSignal,
): Promise<{ response: Response; append: boolean }> {
  if (have > 0) {
    const ranged = await fetch(url, {
      signal,
      cache: "no-store",
      headers: { Range: `bytes=${have}-` },
    });
    if (ranged.status === 206 && rangeIsSuffix(ranged, have, expected)) {
      return { response: ranged, append: true };
    }
    if (ranged.status === 200 || ranged.status === 206) {
      const len = Number(ranged.headers.get("content-length"));
      if (ranged.status === 200 || (expected > 0 && Number.isFinite(len) && len === expected)) {
        return { response: ranged, append: false };
      }
    }
    try {
      await ranged.body?.cancel();
    } catch {
      /* ignore */
    }
    if (ranged.status >= 400 && ranged.status !== 416) {
      throw new Error(`HK pack download HTTP ${ranged.status}`);
    }
  }
  const full = await fetch(url, { signal, cache: "no-store" });
  if (!full.ok) throw new Error(`HK pack download HTTP ${full.status}`);
  return { response: full, append: false };
}

async function opfsWriteStream(
  dir: FileSystemDirectoryHandle,
  name: string,
  startAt: number,
  body: ReadableStream<Uint8Array>,
  onPos: (n: number) => void,
): Promise<number> {
  const handle = await dir.getFileHandle(name, { create: true });
  let writable: FileSystemWritableFileStream | null = null;
  let pos = startAt;
  if (startAt > 0) {
    const existing = await handle.getFile();
    if (existing.size !== startAt) throw new PackOffsetError();
    try {
      writable = await handle.createWritable({ keepExistingData: true });
      await writable.seek(startAt);
    } catch (e) {
      if (writable) {
        try {
          await writable.close();
        } catch {
          /* ignore */
        }
      }
      if (isAbortError(e) || isQuotaError(e)) throw e;
      throw new PackOffsetError();
    }
  } else {
    writable = await handle.createWritable();
    pos = 0;
  }

  const reader = body.getReader();
  let sinceFlush = 0;
  let open = true;
  let failed: unknown = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (!writable) throw new Error("HK pack writer closed");
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      await writable.write(chunk);
      pos += value.byteLength;
      sinceFlush += value.byteLength;
      onPos(pos);
      if (sinceFlush >= PARTIAL_FLUSH_BYTES) {
        await writable.close();
        open = false;
        let flushed = await opfsSize(dir, name);
        if (flushed < pos) flushed = await opfsSize(dir, name);
        if (flushed < pos) throw new PackOffsetError();
        writable = await handle.createWritable({ keepExistingData: true });
        open = true;
        await writable.seek(pos);
        sinceFlush = 0;
      }
    }
  } catch (e) {
    failed = e;
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  } finally {
    if (open && writable) {
      try {
        await writable.close();
      } catch {
        /* ignore */
      }
    }
  }
  if (failed) throw failed;
  const durable = await opfsSize(dir, name);
  return durable > 0 ? durable : pos;
}

async function cacheWriteStream(
  name: string,
  startAt: number,
  body: ReadableStream<Uint8Array>,
  onPos: (n: number) => void,
): Promise<number> {
  if (!cacheAvailable()) throw new Error("HK pack storage unavailable");
  const cache = await caches.open(CACHE_NAME);
  let index: PartIndex = { bytes: 0, parts: 0 };
  if (startAt > 0) {
    index = await readPartIndex(cache, name);
    if (index.parts <= 0 || index.bytes !== startAt) throw new PackOffsetError();
  } else {
    await cacheDeleteTree(name);
  }

  const reader = body.getReader();
  const pending: Uint8Array[] = [];
  let pendingBytes = 0;
  const flushPending = async () => {
    if (pendingBytes <= 0) return;
    const merged = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const chunk of pending) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const next: PartIndex = {
      bytes: index.bytes + merged.byteLength,
      parts: index.parts + 1,
    };
    await cache.put(
      partKey(name, index.parts),
      new Response(merged, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(merged.byteLength),
        },
      }),
    );
    await cache.put(
      indexKey(name),
      new Response(JSON.stringify(next), { headers: { "Content-Type": "application/json" } }),
    );
    index = next;
    pending.length = 0;
    pendingBytes = 0;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      pending.push(value.slice());
      pendingBytes += value.byteLength;
      onPos(index.bytes + pendingBytes);
      if (pendingBytes >= PARTIAL_FLUSH_BYTES) await flushPending();
    }
    await flushPending();
  } catch (e) {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    throw e;
  }
  return index.bytes;
}

async function writeStream(
  dest: Dest,
  name: string,
  startAt: number,
  body: ReadableStream<Uint8Array>,
  onPos: (n: number) => void,
): Promise<number> {
  if (dest.kind === "opfs") return opfsWriteStream(dest.dir, name, startAt, body, onPos);
  return cacheWriteStream(name, startAt, body, onPos);
}

async function verifyBuffer(data: ArrayBuffer, manifest: HkBasemapManifest): Promise<string> {
  if (manifest.bytes > 0 && data.byteLength !== manifest.bytes) {
    throw new PackCorruptError(
      `HK pack size mismatch: got ${data.byteLength}, expected ${manifest.bytes}`,
    );
  }
  const digest = (await sha256Hex(data)).toLowerCase();
  if (digest !== manifest.sha256.toLowerCase()) {
    throw new PackCorruptError("HK pack sha256 mismatch");
  }
  return digest;
}

function publishMeta(manifest: HkBasemapManifest, byteLength: number, sha256: string): HkLocalMeta {
  const meta: HkLocalMeta = {
    version: manifest.version,
    builtAt: manifest.builtAt,
    sha256: sha256.toLowerCase(),
    bytes: byteLength,
  };
  revokeCachedBlob();
  writeMeta(meta);
  if (canUseWindow()) {
    localStorage.setItem(ACTIVE_NAME_KEY, activeFileName(manifest.version));
  }
  stampPackReaderEpoch();
  return meta;
}

async function finishInstall(
  manifest: HkBasemapManifest,
  meta: HkLocalMeta,
  prevName: string | null,
): Promise<HkLocalMeta> {
  const finalName = activeFileName(manifest.version);
  try {
    await removeEverywhere(partialFileName(manifest.version));
  } catch {
    /* final copy already verified */
  }
  if (prevName && prevName !== finalName) {
    try {
      await removeEverywhere(prevName);
    } catch {
      /* keep the new pack */
    }
  }
  void requestPersistentStorage();
  emitChange();
  return meta;
}

async function abandonUnverifiedFinal(
  dest: Dest,
  finalName: string,
  prevName: string | null,
): Promise<void> {
  if (prevName === finalName) {
    revokeCachedBlob();
    writeMeta(null);
    emitChange();
    return;
  }
  try {
    await removeStored(dest, finalName);
  } catch {
    /* ignore */
  }
}

async function destinationForFinal(partialDest: Dest): Promise<Dest> {
  if (partialDest.kind === "opfs") return partialDest;
  const dir = await opfsRoot();
  if (dir) return { kind: "opfs", dir };
  return partialDest;
}

async function promotePartial(dest: Dest, manifest: HkBasemapManifest): Promise<HkLocalMeta> {
  const partial = partialFileName(manifest.version);
  const finalName = activeFileName(manifest.version);
  const previous = readMeta();
  const prevName = previous ? activeFileName(previous.version) : null;
  const size = await storedSize(dest, partial);
  if (manifest.bytes > 0 && size !== manifest.bytes) {
    if (size > manifest.bytes) {
      try {
        await removeEverywhere(partial);
      } catch {
        /* ignore */
      }
      throw new PackCorruptError(`HK pack size mismatch: got ${size}, expected ${manifest.bytes}`);
    }
    throw new Error(`HK pack download incomplete: got ${size}, expected ${manifest.bytes}`);
  }

  let payload: ArrayBuffer | null = await readStored(dest, partial);
  if (!payload) throw new Error("HK pack partial missing");
  let digest: string;
  try {
    digest = await verifyBuffer(payload, manifest);
  } catch (e) {
    if (e instanceof PackCorruptError) {
      try {
        await removeEverywhere(partial);
      } catch {
        /* ignore */
      }
    }
    throw e;
  }

  const expectedLen = payload.byteLength;
  let finalDest = await destinationForFinal(dest);
  try {
    await writeWhole(finalDest, finalName, payload);
  } catch (e) {
    if (isAbortError(e) || finalDest.kind !== "opfs" || dest.kind !== "cache") {
      if (prevName !== finalName) {
        try {
          await removeStored(finalDest, finalName);
        } catch {
          /* ignore */
        }
      }
      throw e;
    }
    try {
      await opfsDelete(finalDest.dir, finalName);
    } catch {
      /* ignore */
    }
    finalDest = dest;
    await writeWhole(finalDest, finalName, payload);
  }
  payload = null;

  const back = await readStored(finalDest, finalName);
  if (!back || back.byteLength !== expectedLen) {
    await abandonUnverifiedFinal(finalDest, finalName, prevName);
    throw new Error("HK pack read-back failed");
  }
  const backDigest = (await sha256Hex(back)).toLowerCase();
  if (backDigest !== digest) {
    await abandonUnverifiedFinal(finalDest, finalName, prevName);
    throw new Error("HK pack read-back sha256 mismatch");
  }
  if (finalDest.kind === "opfs") {
    try {
      await cacheDeleteTree(finalName);
    } catch {
      /* OPFS copy is the one we verified */
    }
  } else {
    const dir = await opfsRoot();
    if (dir) await opfsDelete(dir, finalName);
  }
  const meta = publishMeta(manifest, back.byteLength, backDigest);
  return finishInstall(manifest, meta, prevName);
}

async function adoptFinalIfUntracked(
  dest: Dest,
  manifest: HkBasemapManifest,
  finalName: string,
): Promise<HkLocalMeta | null> {
  const previous = readMeta();
  const prevName = previous ? activeFileName(previous.version) : null;
  if (prevName === finalName) return null;
  let finalDest = await destinationForFinal(dest);
  let size = await storedSize(finalDest, finalName);
  let readDest = finalDest;
  if (!(manifest.bytes > 0 && size === manifest.bytes)) {
    if (dest.kind === finalDest.kind) return null;
    size = await storedSize(dest, finalName);
    if (!(manifest.bytes > 0 && size === manifest.bytes)) return null;
    readDest = dest;
  }
  const data = await readStored(readDest, finalName);
  if (!data) return null;
  let digest: string;
  try {
    digest = await verifyBuffer(data, manifest);
  } catch (e) {
    if (!(e instanceof PackCorruptError)) throw e;
    try {
      await removeStored(readDest, finalName);
    } catch {
      /* ignore */
    }
    return null;
  }
  if (readDest.kind !== "opfs") {
    const opfs = await destinationForFinal(readDest);
    if (opfs.kind === "opfs") {
      try {
        await writeWhole(opfs, finalName, data);
        const back = await readStored(opfs, finalName);
        if (!back || back.byteLength !== data.byteLength) throw new Error("HK pack read-back failed");
        const backDigest = (await sha256Hex(back)).toLowerCase();
        if (backDigest !== digest) throw new Error("HK pack read-back sha256 mismatch");
        finalDest = opfs;
      } catch {
        finalDest = readDest;
      }
    }
  } else {
    finalDest = readDest;
  }
  if (finalDest.kind === "cache") {
    const dir = await opfsRoot();
    if (dir) await opfsDelete(dir, finalName);
  } else {
    try {
      await cacheDeleteTree(finalName);
    } catch {
      /* OPFS copy is the one we verified */
    }
  }
  const meta = publishMeta(manifest, data.byteLength, digest);
  return finishInstall(manifest, meta, prevName);
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Download to `hk.<version>.pmtiles.partial`, flushing as bytes arrive.
 * Resume with Range when a partial already exists and the server sends 206.
 * A full 200 restarts the partial only — the previous final pack stays until
 * the new bytes verify. Meta and activeName are written after a read-back.
 */
export async function downloadAndSwapPack(
  manifest: HkBasemapManifest,
  opts?: { onProgress?: ProgressFn; signal?: AbortSignal },
): Promise<HkLocalMeta> {
  const manifestSha = manifest.sha256.toLowerCase();
  const existing = readMeta();
  const finalName = activeFileName(manifest.version);
  if (
    existing &&
    existing.version === manifest.version &&
    existing.sha256.toLowerCase() === manifestSha &&
    (manifest.bytes <= 0 || existing.bytes === manifest.bytes)
  ) {
    const size = await installedByteSize(finalName, manifest.bytes);
    if (size > 0 && (manifest.bytes <= 0 || size === manifest.bytes)) {
      if (canUseWindow()) localStorage.setItem(ACTIVE_NAME_KEY, finalName);
      stampPackReaderEpoch();
      void requestPersistentStorage();
      return existing;
    }
  }

  const partial = partialFileName(manifest.version);
  const dest = await chooseDest(partial, finalName, manifest.bytes);
  const adopted = await adoptFinalIfUntracked(dest, manifest, finalName);
  if (adopted) return adopted;

  let have = await storedSize(dest, partial);
  if (manifest.bytes > 0 && have > manifest.bytes) {
    await removeEverywhere(partial);
    have = 0;
  } else if (manifest.bytes > 0 && have === manifest.bytes) {
    return promotePartial(dest, manifest);
  }

  const opened = await openPackResponse(manifest.url, have, manifest.bytes, opts?.signal);
  if (!opened.append) {
    await removeEverywhere(partial);
    have = 0;
  }
  const total = manifest.bytes > 0 ? manifest.bytes : null;
  const report = (received: number) => {
    opts?.onProgress?.({
      received,
      total,
      ratio: total ? Math.min(1, received / total) : null,
    });
  };
  report(have);
  const stream = await responseStream(opened.response);
  let written: number;
  try {
    written = await writeStream(dest, partial, have, stream, report);
  } catch (e) {
    if (!(e instanceof PackOffsetError)) throw e;
    try {
      await stream.cancel();
    } catch {
      /* ignore */
    }
    await removeEverywhere(partial);
    const full = await fetch(manifest.url, { signal: opts?.signal, cache: "no-store" });
    if (!full.ok) throw new Error(`HK pack download HTTP ${full.status}`);
    report(0);
    try {
      written = await writeStream(dest, partial, 0, await responseStream(full), report);
    } catch (restartError) {
      if (restartError instanceof PackOffsetError) {
        try {
          await removeEverywhere(partial);
        } catch {
          /* ignore */
        }
      }
      throw restartError;
    }
  }

  if (manifest.bytes > 0 && written !== manifest.bytes) {
    if (written > manifest.bytes) {
      try {
        await removeEverywhere(partial);
      } catch {
        /* ignore */
      }
      throw new PackCorruptError(`HK pack size mismatch: got ${written}, expected ${manifest.bytes}`);
    }
    throw new Error(`HK pack download incomplete: got ${written}, expected ${manifest.bytes}`);
  }
  return promotePartial(dest, manifest);
}

export function hasPack(): boolean {
  return readMeta() != null;
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
    if (cachedBlobTrusted) void requestPersistentStorage();
    return { meta, blobUrl: cachedBlobUrl };
  }

  const name = activeFileName(meta.version);
  const dir = await opfsRoot();
  let data: ArrayBuffer | null = null;
  if (dir) {
    const size = await opfsSize(dir, name);
    if (size > 0 && (meta.bytes <= 0 || size === meta.bytes)) {
      const opfsData = await opfsRead(dir, name);
      if (opfsData && opfsData.byteLength > 0 && (meta.bytes <= 0 || opfsData.byteLength === meta.bytes)) {
        data = opfsData;
      }
    }
  }
  if (!data) {
    const cached = await cacheGet(name);
    if (cached && cached.byteLength > 0 && (meta.bytes <= 0 || cached.byteLength === meta.bytes)) {
      data = cached;
    }
  }
  if (!data || data.byteLength === 0) {
    const current = readMeta();
    if (
      current &&
      current.version === meta.version &&
      current.sha256 === meta.sha256 &&
      current.bytes === meta.bytes
    ) {
      revokeCachedBlob();
      writeMeta(null);
      emitChange();
    }
    return null;
  }
  revokeCachedBlob();
  const trusted = meta.bytes <= 0 || data.byteLength === meta.bytes;
  const blob = new Blob([data], { type: "application/vnd.pmtiles" });
  const blobUrl = URL.createObjectURL(blob);
  cachedBlobUrl = blobUrl;
  cachedBlobVersion = meta.version;
  cachedBlobTrusted = trusted;
  if (trusted) void requestPersistentStorage();
  return { meta, blobUrl };
}

/** Drop local pack (tests / recovery). Does not touch pins. */
export async function clearLocalPack(): Promise<void> {
  const meta = readMeta();
  const epochBefore = readStoredEpoch();
  const name = meta ? activeFileName(meta.version) : null;
  const dir = await opfsRoot();
  const advanced = () => {
    const now = readStoredEpoch();
    return now != null && now >= PACK_READER_EPOCH && now !== epochBefore;
  };
  if (advanced()) return;
  if (dir && name) await opfsDelete(dir, name);
  if (advanced()) return;
  if (name) await cacheDeleteTree(name);
  if (advanced()) return;
  revokeCachedBlob();
  writeMeta(null);
  emitChange();
}

/**
 * Missing epoch + a pack whose file size matches meta: stamp epoch and keep it.
 * Clear only for a stored epoch below PACK_READER_EPOCH (old blob: Range reader).
 * A just-saved pack stamps its own epoch, so this must not delete that file.
 */
export async function migratePackReaderEpoch(): Promise<void> {
  if (!canUseWindow()) return;
  const before = readStoredEpoch();
  if (before != null && before >= PACK_READER_EPOCH) return;

  if (before != null && isKnownStaleEpoch(before)) {
    const meta = readMeta();
    const partial = meta ? partialFileName(meta.version) : null;
    const now = readStoredEpoch();
    if (now != null && now >= PACK_READER_EPOCH) return;
    if (meta || (await installedPackMatchesMeta())) {
      if (readStoredEpoch() != null && readStoredEpoch()! >= PACK_READER_EPOCH) return;
      await clearLocalPack();
      if (readStoredEpoch() != null && readStoredEpoch()! >= PACK_READER_EPOCH) return;
      if (partial) {
        try {
          await removeEverywhere(partial);
        } catch {
          /* ignore */
        }
      }
    }
    if (readStoredEpoch() != null && readStoredEpoch()! >= PACK_READER_EPOCH) return;
    stampPackReaderEpoch();
    return;
  }

  if (await installedPackMatchesMeta()) {
    if (readStoredEpoch() != null && readStoredEpoch()! >= PACK_READER_EPOCH) return;
    stampPackReaderEpoch();
  }
}
