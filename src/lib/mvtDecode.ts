/**
 * Server-only Mapbox Vector Tile decoder for TomTom Traffic flow layers.
 * Not imported by client code — the API route returns JSON.
 *
 * TomTom tiles are gzip-compressed PBF (HTTP Content-Encoding and/or the
 * tile payload itself). Callers must inflate before passing bytes here.
 */

export type FlowTilePoint = { lat: number; lng: number };

export type FlowTileSegment = {
  id: string;
  coordinates: FlowTilePoint[];
  trafficLevel: number | null;
  roadClosure: boolean;
  roadType: string | null;
};

export type FlowTileStats = {
  layers: number;
  layerName: string | null;
  features: number;
  lines: number;
  withTrafficLevel: number;
  keys: string[];
};

export type FlowTileDecode = {
  segments: FlowTileSegment[];
  stats: FlowTileStats;
};

const MAX_SEGMENTS = 500;
const MAX_COORDS = 96;
const WT_VARINT = 0;
const WT_FIXED64 = 1;
const WT_BYTES = 2;
const WT_FIXED32 = 5;

class Pbf {
  readonly buf: Uint8Array;
  readonly view: DataView;
  pos = 0;
  type = 0;
  readonly length: number;

  constructor(bytes: Uint8Array) {
    this.buf = bytes;
    this.length = bytes.length;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  at(end: number): boolean {
    return this.pos >= end || this.pos >= this.length;
  }

  readVarint(): number {
    const buf = this.buf;
    let b = buf[this.pos++] ?? 0;
    if (b < 0x80) return b;
    let val = b & 0x7f;
    b = buf[this.pos++] ?? 0;
    val |= (b & 0x7f) << 7;
    if (b < 0x80) return val;
    b = buf[this.pos++] ?? 0;
    val |= (b & 0x7f) << 14;
    if (b < 0x80) return val;
    b = buf[this.pos++] ?? 0;
    val |= (b & 0x7f) << 21;
    if (b < 0x80) return val;
    b = buf[this.pos++] ?? 0;
    val += (b & 0x0f) * 0x10000000;
    if (b < 0x80) return val;
    // Lengths we care about fit in 32 bits; skip extra remainder bytes.
    while (b >= 0x80 && this.pos < this.length) b = buf[this.pos++] ?? 0;
    return val;
  }

  readSVarint(): number {
    const num = this.readVarint();
    return num % 2 === 1 ? (num + 1) / -2 : num / 2;
  }

  readString(): string {
    const end = this.readVarint() + this.pos;
    const start = this.pos;
    this.pos = Math.min(end, this.length);
    return new TextDecoder().decode(this.buf.subarray(start, this.pos));
  }

  readFloat(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readDouble(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  skip(): void {
    if (this.type === WT_VARINT) this.readVarint();
    else if (this.type === WT_FIXED64) this.pos += 8;
    else if (this.type === WT_BYTES) this.pos = this.readVarint() + this.pos;
    else if (this.type === WT_FIXED32) this.pos += 4;
    else this.pos += 1;
  }

  nextTag(end: number): number {
    if (this.at(end)) return 0;
    const val = this.readVarint();
    this.type = val & 7;
    return val >>> 3;
  }

  packedVarints(): number[] {
    const end = this.type === WT_BYTES ? this.readVarint() + this.pos : this.pos + 1;
    const out: number[] = [];
    while (this.pos < end && this.pos < this.length) out.push(this.readVarint());
    return out;
  }
}

type TileValue = string | number | boolean;

type Layer = {
  name: string;
  extent: number;
  keys: string[];
  values: Array<TileValue | null>;
  features: Array<{ type: number; tags: number[]; geometry: number[]; index: number }>;
};

function emptyStats(): FlowTileStats {
  return { layers: 0, layerName: null, features: 0, lines: 0, withTrafficLevel: 0, keys: [] };
}

function toNum(value: TileValue | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function trafficLevelOf(props: Record<string, TileValue>): number | null {
  for (const [key, value] of Object.entries(props)) {
    if (/^traffic[_-]?level$/i.test(key.trim())) return toNum(value);
  }
  return null;
}

function roadClosureOf(props: Record<string, TileValue>): boolean {
  for (const [key, value] of Object.entries(props)) {
    if (/^road[_-]?closure$/i.test(key.trim())) return value === true || value === 1;
  }
  return false;
}

function roadTypeOf(props: Record<string, TileValue>): string | null {
  for (const [key, value] of Object.entries(props)) {
    if (/^road[_-]?type$/i.test(key.trim()) && typeof value === "string" && value) return value;
  }
  return null;
}

function readValue(pbf: Pbf): TileValue | null {
  const end = pbf.readVarint() + pbf.pos;
  let value: TileValue | null = null;
  let tag: number;
  while ((tag = pbf.nextTag(end))) {
    if (tag === 1) value = pbf.readString();
    else if (tag === 2) value = pbf.readFloat();
    else if (tag === 3) value = pbf.readDouble();
    else if (tag === 4 || tag === 5) value = pbf.readVarint();
    else if (tag === 6) value = pbf.readSVarint();
    else if (tag === 7) value = Boolean(pbf.readVarint());
    else pbf.skip();
  }
  pbf.pos = Math.max(pbf.pos, end);
  return value;
}

function readFeature(
  pbf: Pbf,
  index: number,
): { type: number; tags: number[]; geometry: number[]; index: number } {
  const end = pbf.readVarint() + pbf.pos;
  let type = 2;
  const tags: number[] = [];
  const geometry: number[] = [];
  let tag: number;
  while ((tag = pbf.nextTag(end))) {
    if (tag === 2) tags.push(...pbf.packedVarints());
    else if (tag === 3) type = pbf.readVarint();
    else if (tag === 4) geometry.push(...pbf.packedVarints());
    else pbf.skip();
  }
  pbf.pos = Math.max(pbf.pos, end);
  return { type, tags, geometry, index };
}

function readLayer(pbf: Pbf): Layer {
  const end = pbf.readVarint() + pbf.pos;
  const layer: Layer = { name: "", extent: 4096, keys: [], values: [], features: [] };
  let featureIndex = 0;
  let tag: number;
  while ((tag = pbf.nextTag(end))) {
    if (tag === 1) layer.name = pbf.readString();
    else if (tag === 2) layer.features.push(readFeature(pbf, featureIndex++));
    else if (tag === 3) layer.keys.push(pbf.readString().replace(/\0+$/g, "").trim());
    else if (tag === 4) layer.values.push(readValue(pbf));
    else if (tag === 5) {
      const extent = pbf.readVarint();
      if (extent > 0) layer.extent = extent;
    } else pbf.skip();
  }
  pbf.pos = Math.max(pbf.pos, end);
  return layer;
}

function propsOf(
  tags: number[],
  keys: string[],
  values: Array<TileValue | null>,
): Record<string, TileValue> {
  const out: Record<string, TileValue> = {};
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const key = keys[tags[i] ?? -1];
    const value = values[tags[i + 1] ?? -1];
    if (!key || value == null) continue;
    out[key] = value;
  }
  return out;
}

function tilePixelToLngLat(
  z: number,
  x: number,
  y: number,
  extent: number,
  px: number,
  py: number,
): FlowTilePoint {
  const n = 2 ** z;
  const mercX = (x + px / extent) / n;
  const mercY = (y + py / extent) / n;
  const lng = mercX * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * mercY)));
  return { lat: (latRad * 180) / Math.PI, lng };
}

function downsample(pts: FlowTilePoint[]): FlowTilePoint[] {
  if (pts.length <= MAX_COORDS) return pts;
  const out: FlowTilePoint[] = [];
  const last = pts.length - 1;
  const step = last / (MAX_COORDS - 1);
  for (let i = 0; i < MAX_COORDS - 1; i++) {
    const p = pts[Math.round(i * step)];
    if (p) out.push(p);
  }
  const end = pts[last];
  if (end) out.push(end);
  return out;
}

function decodeLines(geometry: number[]): Array<Array<{ x: number; y: number }>> {
  const lines: Array<Array<{ x: number; y: number }>> = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let cmd = 1;
  let length = 0;
  let line: Array<{ x: number; y: number }> | null = null;
  const zigzag = (n: number) => (n % 2 === 1 ? (n + 1) / -2 : n / 2);
  while (i < geometry.length) {
    if (length <= 0) {
      const cmdLen = geometry[i++] ?? 0;
      cmd = cmdLen & 7;
      length = cmdLen >> 3;
    }
    length--;
    if (cmd === 1 || cmd === 2) {
      x += zigzag(geometry[i++] ?? 0);
      y += zigzag(geometry[i++] ?? 0);
      if (cmd === 1) {
        if (line && line.length >= 2) lines.push(line);
        line = [];
      }
      if (line) line.push({ x, y });
    } else if (cmd === 7) {
      // ClosePath — Traffic flow is linestrings.
    } else {
      break;
    }
  }
  if (line && line.length >= 2) lines.push(line);
  return lines;
}

function pickFlowLayer(layers: Layer[]): Layer | undefined {
  return (
    layers.find((row) => row.name === "Traffic flow") ??
    layers.find((row) => /traffic\s*flow/i.test(row.name)) ??
    layers.find((row) => /flow/i.test(row.name)) ??
    [...layers].sort((a, b) => b.features.length - a.features.length)[0]
  );
}

/** Decode the TomTom "Traffic flow" layer. Returns null if the buffer is not a vector tile. */
export function decodeTrafficFlowTile(
  bytes: Uint8Array,
  z: number,
  x: number,
  y: number,
): FlowTileDecode | null {
  if (!bytes.length) return { segments: [], stats: emptyStats() };
  if (bytes[0] === 0x7b || bytes[0] === 0x5b) return null;
  try {
    const pbf = new Pbf(bytes);
    const layers: Layer[] = [];
    let tag: number;
    while ((tag = pbf.nextTag(pbf.length))) {
      if (tag === 3) layers.push(readLayer(pbf));
      else pbf.skip();
    }
    const layer = pickFlowLayer(layers);
    const stats: FlowTileStats = {
      layers: layers.length,
      layerName: layer?.name || null,
      features: layer?.features.length ?? 0,
      lines: 0,
      withTrafficLevel: 0,
      keys: layer?.keys.slice(0, 12) ?? [],
    };
    if (!layer) return { segments: [], stats };
    const out: FlowTileSegment[] = [];
    for (const feature of layer.features) {
      if (out.length >= MAX_SEGMENTS) break;
      const props = propsOf(feature.tags, layer.keys, layer.values);
      const trafficLevel = trafficLevelOf(props);
      const roadClosure = roadClosureOf(props);
      const roadType = roadTypeOf(props);
      // GeomType 2 = linestring; still try geometry if type is missing/unknown.
      if (feature.type !== 0 && feature.type !== 2) continue;
      const rings = decodeLines(feature.geometry);
      for (let r = 0; r < rings.length; r++) {
        if (out.length >= MAX_SEGMENTS) break;
        const ring = rings[r];
        if (!ring || ring.length < 2) continue;
        const coordinates = downsample(
          ring.map((pt) => tilePixelToLngLat(z, x, y, layer.extent, pt.x, pt.y)),
        );
        if (coordinates.length < 2) continue;
        stats.lines += 1;
        if (trafficLevel != null) stats.withTrafficLevel += 1;
        out.push({
          id: `t:${z}/${x}/${y}:${feature.index}:${r}`,
          coordinates,
          trafficLevel,
          roadClosure,
          roadType,
        });
      }
    }
    return { segments: out, stats };
  } catch {
    return null;
  }
}
