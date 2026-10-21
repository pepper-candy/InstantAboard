/**
 * Minimal MapLibre `pmtiles://` protocol (PMTiles v3).
 * Vendored subset of https://github.com/protomaps/PMTiles (BSD) — no fflate;
 * gzip uses DecompressionStream when available.
 */

const HEADER_SIZE = 127;

type Entry = { tileId: number; offset: number; length: number; runLength: number };

type Header = {
  rootDirectoryOffset: number;
  rootDirectoryLength: number;
  leafDirectoryOffset: number;
  tileDataOffset: number;
  internalCompression: number;
  tileCompression: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  etag?: string;
};

type RangeResponse = {
  data: ArrayBuffer;
  etag?: string;
  cacheControl?: string;
  expires?: string;
};

function toNum(low: number, high: number): number {
  return (high >>> 0) * 4294967296 + (low >>> 0);
}

function readVarintRemainder(low: number, p: { buf: Uint8Array; pos: number }): number {
  const buf = p.buf;
  let b = buf[p.pos++];
  let h = (b & 112) >> 4;
  if (b < 128) return toNum(low, h);
  b = buf[p.pos++];
  h |= (b & 127) << 3;
  if (b < 128) return toNum(low, h);
  b = buf[p.pos++];
  h |= (b & 127) << 10;
  if (b < 128) return toNum(low, h);
  b = buf[p.pos++];
  h |= (b & 127) << 17;
  if (b < 128) return toNum(low, h);
  b = buf[p.pos++];
  h |= (b & 127) << 24;
  if (b < 128) return toNum(low, h);
  b = buf[p.pos++];
  h |= (b & 1) << 31;
  if (b < 128) return toNum(low, h);
  throw new Error("Expected varint not more than 10 bytes");
}

function readVarint(p: { buf: Uint8Array; pos: number }): number {
  const buf = p.buf;
  let b = buf[p.pos++];
  let val = b & 127;
  if (b < 128) return val;
  b = buf[p.pos++];
  val |= (b & 127) << 7;
  if (b < 128) return val;
  b = buf[p.pos++];
  val |= (b & 127) << 14;
  if (b < 128) return val;
  b = buf[p.pos++];
  val |= (b & 127) << 21;
  if (b < 128) return val;
  b = buf[p.pos];
  val |= (b & 15) << 28;
  return readVarintRemainder(val, p);
}

function rotate(n: number, xy: [number, number], rx: number, ry: number) {
  if (ry === 0) {
    if (rx === 1) {
      xy[0] = n - 1 - xy[0];
      xy[1] = n - 1 - xy[1];
    }
    const t = xy[0];
    xy[0] = xy[1];
    xy[1] = t;
  }
}

const TZ_VALUES = [
  0, 1, 5, 21, 85, 341, 1365, 5461, 21845, 87381, 349525, 1398101, 5592405, 22369621, 89478485,
  357913941, 1431655765, 5726623061, 22906492245, 91625968981, 366503875925, 1466015503701,
  5864062014805, 23456248059221, 93824992236885, 375299968947541, 0x5555555555555,
];

function zxyToTileId(z: number, x: number, y: number): number {
  if (z > 26) throw new Error("Tile zoom level exceeds max safe number limit (26)");
  if (x > 2 ** z - 1 || y > 2 ** z - 1) throw new Error("tile x/y outside zoom level bounds");
  const acc = TZ_VALUES[z];
  let rx = 0;
  let ry = 0;
  let d = 0;
  const xy: [number, number] = [x, y];
  for (let s = 2 ** z / 2; s > 0; s /= 2) {
    rx = (xy[0] & s) > 0 ? 1 : 0;
    ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    rotate(s, xy, rx, ry);
  }
  return acc + d;
}

function findTile(entries: Entry[], tileId: number): Entry | null {
  let m = 0;
  let n = entries.length - 1;
  while (m <= n) {
    const k = (n + m) >> 1;
    const cmp = tileId - entries[k].tileId;
    if (cmp > 0) m = k + 1;
    else if (cmp < 0) n = k - 1;
    else return entries[k];
  }
  if (n >= 0 && (entries[n].runLength === 0 || tileId - entries[n].tileId < entries[n].runLength)) {
    return entries[n];
  }
  return null;
}

async function defaultDecompress(buf: ArrayBuffer, compression: number): Promise<ArrayBuffer> {
  if (compression === 1 || compression === 0) return buf;
  if (compression === 2) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Gzip DecompressionStream unavailable");
    }
    const stream = new Response(buf).body;
    if (!stream) throw new Error("Failed to read response stream");
    const out = stream.pipeThrough(new DecompressionStream("gzip"));
    return new Response(out).arrayBuffer();
  }
  throw new Error("Compression method not supported");
}

function getUint64(v: DataView, offset: number): number {
  const low = v.getUint32(offset + 0, true);
  const high = v.getUint32(offset + 4, true);
  return high * 2 ** 32 + low;
}

function bytesToHeader(bytes: ArrayBuffer, etag?: string): Header {
  const v = new DataView(bytes);
  const specVersion = v.getUint8(7);
  if (specVersion > 3) {
    throw new Error(`Archive is spec version ${specVersion} but this library supports up to 3`);
  }
  return {
    rootDirectoryOffset: getUint64(v, 8),
    rootDirectoryLength: getUint64(v, 16),
    leafDirectoryOffset: getUint64(v, 40),
    tileDataOffset: getUint64(v, 56),
    internalCompression: v.getUint8(97),
    tileCompression: v.getUint8(98),
    tileType: v.getUint8(99),
    minZoom: v.getUint8(100),
    maxZoom: v.getUint8(101),
    minLon: v.getInt32(102, true) / 1e7,
    minLat: v.getInt32(106, true) / 1e7,
    maxLon: v.getInt32(110, true) / 1e7,
    maxLat: v.getInt32(114, true) / 1e7,
    etag,
  };
}

function deserializeIndex(buffer: ArrayBuffer): Entry[] {
  const p = { buf: new Uint8Array(buffer), pos: 0 };
  const numEntries = readVarint(p);
  const entries: Entry[] = [];
  let lastId = 0;
  for (let i = 0; i < numEntries; i++) {
    const diff = readVarint(p);
    entries.push({ tileId: lastId + diff, offset: 0, length: 0, runLength: 1 });
    lastId += diff;
  }
  for (let i = 0; i < numEntries; i++) entries[i].runLength = readVarint(p);
  for (let i = 0; i < numEntries; i++) entries[i].length = readVarint(p);
  for (let i = 0; i < numEntries; i++) {
    const v = readVarint(p);
    if (v === 0 && i > 0) entries[i].offset = entries[i - 1].offset + entries[i - 1].length;
    else entries[i].offset = v - 1;
  }
  return entries;
}

class FetchSource {
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  getKey() {
    return this.url;
  }
  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
    const headers = new Headers();
    headers.set("range", `bytes=${offset}-${offset + length - 1}`);
    const res = await fetch(this.url, { signal, headers });
    if (res.status >= 300) throw new Error(`Bad response code: ${res.status}`);
    return {
      data: await res.arrayBuffer(),
      etag: res.headers.get("Etag") || undefined,
      cacheControl: res.headers.get("Cache-Control") || undefined,
      expires: res.headers.get("Expires") || undefined,
    };
  }
}

class PMTiles {
  source: FetchSource;
  private headerPromise: Promise<Header> | null = null;
  private dirCache = new Map<string, Promise<Entry[]>>();

  constructor(url: string) {
    this.source = new FetchSource(url);
  }

  async getHeader(): Promise<Header> {
    if (!this.headerPromise) {
      this.headerPromise = (async () => {
        const first = await this.source.getBytes(0, 16384);
        if (new DataView(first.data).getUint16(0, true) !== 19792) {
          throw new Error("Wrong magic number for PMTiles archive");
        }
        const headerBytes = first.data.slice(0, HEADER_SIZE);
        const header = bytesToHeader(headerBytes, first.etag);
        const rootSlice = first.data.slice(
          header.rootDirectoryOffset,
          header.rootDirectoryOffset + header.rootDirectoryLength,
        );
        const key = `${header.rootDirectoryOffset}|${header.rootDirectoryLength}`;
        this.dirCache.set(
          key,
          defaultDecompress(rootSlice, header.internalCompression).then(deserializeIndex),
        );
        return header;
      })();
    }
    return this.headerPromise;
  }

  private async getDirectory(offset: number, length: number, header: Header): Promise<Entry[]> {
    const key = `${offset}|${length}`;
    let cached = this.dirCache.get(key);
    if (!cached) {
      cached = (async () => {
        const res = await this.source.getBytes(offset, length);
        const raw = await defaultDecompress(res.data, header.internalCompression);
        return deserializeIndex(raw);
      })();
      this.dirCache.set(key, cached);
    }
    return cached;
  }

  async getZxy(
    z: number,
    x: number,
    y: number,
    signal?: AbortSignal,
  ): Promise<RangeResponse | undefined> {
    const tileId = zxyToTileId(z, x, y);
    const header = await this.getHeader();
    if (z < header.minZoom || z > header.maxZoom) return undefined;
    let dirOffset = header.rootDirectoryOffset;
    let dirLength = header.rootDirectoryLength;
    for (let depth = 0; depth <= 3; depth++) {
      const directory = await this.getDirectory(dirOffset, dirLength, header);
      const entry = findTile(directory, tileId);
      if (!entry) return undefined;
      if (entry.runLength > 0) {
        const tile = await this.source.getBytes(
          header.tileDataOffset + entry.offset,
          entry.length,
          signal,
        );
        return {
          data: await defaultDecompress(tile.data, header.tileCompression),
          cacheControl: tile.cacheControl,
          expires: tile.expires,
        };
      }
      dirOffset = header.leafDirectoryOffset + entry.offset;
      dirLength = entry.length;
    }
    throw new Error("Maximum directory depth exceeded");
  }
}

type RequestParameters = {
  url: string;
  type?: string;
};

/** Matches MapLibre `AddProtocolResponseData` (ArrayBuffer | image | string | object). */
type ProtocolResponse = {
  data: ArrayBuffer | object;
  cacheControl?: string;
  expires?: string;
};

/**
 * MapLibre GL JS protocol. Register once: `addProtocol("pmtiles", protocol.tile)`.
 */
export class Protocol {
  tiles = new Map<string, PMTiles>();

  tile = async (
    params: RequestParameters,
    abortController: AbortController,
  ): Promise<ProtocolResponse> => {
    if (params.type === "json") {
      const url = params.url.slice("pmtiles://".length);
      let instance = this.tiles.get(url);
      if (!instance) {
        instance = new PMTiles(url);
        this.tiles.set(url, instance);
      }
      const header = await instance.getHeader();
      return {
        data: {
          tiles: [`${params.url}/{z}/{x}/{y}`],
          minzoom: header.minZoom,
          maxzoom: header.maxZoom,
          bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
        },
      };
    }

    const match = params.url.match(/pmtiles:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) throw new Error("Invalid PMTiles protocol URL");
    const sourceUrl = match[1];
    let instance = this.tiles.get(sourceUrl);
    if (!instance) {
      instance = new PMTiles(sourceUrl);
      this.tiles.set(sourceUrl, instance);
    }
    const z = +match[2];
    const x = +match[3];
    const y = +match[4];
    const header = await instance.getHeader();
    const result = await instance.getZxy(z, x, y, abortController.signal);
    if (result) {
      return {
        data: result.data,
        cacheControl: result.cacheControl,
        expires: result.expires,
      };
    }
    // Empty vector tile / missing raster — ArrayBuffer, not null.
    return { data: new ArrayBuffer(0) };
  };
}
