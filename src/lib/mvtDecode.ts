/**
 * Server-only Mapbox Vector Tile decoder for TomTom Traffic flow layers.
 * Not imported by client code — the API route returns JSON.
 */

export type FlowTilePoint = { lat: number; lng: number };

export type FlowTileSegment = {
  id: string;
  coordinates: FlowTilePoint[];
  trafficLevel: number | null;
  roadClosure: boolean;
  roadType: string | null;
};

const MAX_SEGMENTS = 500;
const MAX_COORDS = 96;

class PbfReader {
  private readonly bytes: Uint8Array;
  private i = 0;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get pos(): number {
    return this.i;
  }

  get end(): number {
    return this.bytes.length;
  }

  atEnd(): boolean {
    return this.i >= this.bytes.length;
  }

  varint(): number {
    let n = 0;
    let shift = 0;
    while (this.i < this.bytes.length) {
      const b = this.bytes[this.i++] ?? 0;
      n += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 49) break;
    }
    return n;
  }

  skip(wireType: number): void {
    if (wireType === 0) {
      this.varint();
    } else if (wireType === 1) {
      this.i += 8;
    } else if (wireType === 2) {
      this.i += this.varint();
    } else if (wireType === 5) {
      this.i += 4;
    } else if (wireType === 3) {
      while (this.i < this.bytes.length) {
        const key = this.varint();
        if ((key & 7) === 4) break;
        this.skip(key & 7);
      }
    }
  }

  bytesOf(n: number): Uint8Array {
    const start = this.i;
    this.i += n;
    return this.bytes.subarray(start, Math.min(this.i, this.bytes.length));
  }

  string(n: number): string {
    return new TextDecoder().decode(this.bytesOf(n));
  }

  float32(): number {
    const v = this.view.getFloat32(this.i, true);
    this.i += 4;
    return v;
  }

  float64(): number {
    const v = this.view.getFloat64(this.i, true);
    this.i += 8;
    return v;
  }
}

function zigzag(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}

function packedVarints(reader: PbfReader, wireType: number): number[] {
  const out: number[] = [];
  if (wireType === 2) {
    const end = reader.pos + reader.varint();
    while (reader.pos < end && reader.pos < reader.end) out.push(reader.varint());
  } else if (wireType === 0) {
    out.push(reader.varint());
  }
  return out;
}

type TileValue = string | number | boolean;

function readValue(reader: PbfReader): TileValue | null {
  const end = reader.pos + reader.varint();
  let value: TileValue | null = null;
  while (reader.pos < end && reader.pos < reader.end) {
    const key = reader.varint();
    const field = key >> 3;
    const wt = key & 7;
    if (field === 1 && wt === 2) {
      value = reader.string(reader.varint());
    } else if (field === 2 && wt === 5) {
      value = reader.float32();
    } else if (field === 3 && wt === 1) {
      value = reader.float64();
    } else if (field === 4 && wt === 0) {
      value = reader.varint();
    } else if (field === 5 && wt === 0) {
      value = reader.varint();
    } else if (field === 6 && wt === 0) {
      value = zigzag(reader.varint());
    } else if (field === 7 && wt === 0) {
      value = reader.varint() !== 0;
    } else {
      reader.skip(wt);
    }
  }
  return value;
}

function asNumber(value: TileValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBool(value: TileValue | undefined): boolean {
  return value === true || value === 1;
}

function asString(value: TileValue | undefined): string | null {
  return typeof value === "string" && value ? value : null;
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
      // ClosePath — Traffic flow is linestrings; ignore ring close.
    } else {
      break;
    }
  }
  if (line && line.length >= 2) lines.push(line);
  return lines;
}

type Layer = {
  name: string;
  extent: number;
  keys: string[];
  values: Array<TileValue | null>;
  features: Array<{ type: number; tags: number[]; geometry: number[]; index: number }>;
};

function readFeature(
  reader: PbfReader,
  index: number,
): { type: number; tags: number[]; geometry: number[]; index: number } {
  const end = reader.pos + reader.varint();
  let type = 2;
  let tags: number[] = [];
  let geometry: number[] = [];
  while (reader.pos < end && reader.pos < reader.end) {
    const key = reader.varint();
    const field = key >> 3;
    const wt = key & 7;
    if (field === 2) {
      tags = packedVarints(reader, wt);
    } else if (field === 3 && wt === 0) {
      type = reader.varint();
    } else if (field === 4) {
      geometry = packedVarints(reader, wt);
    } else {
      reader.skip(wt);
    }
  }
  return { type, tags, geometry, index };
}

function readLayer(reader: PbfReader): Layer {
  const end = reader.pos + reader.varint();
  const layer: Layer = { name: "", extent: 4096, keys: [], values: [], features: [] };
  let featureIndex = 0;
  while (reader.pos < end && reader.pos < reader.end) {
    const key = reader.varint();
    const field = key >> 3;
    const wt = key & 7;
    if (field === 1 && wt === 2) {
      layer.name = reader.string(reader.varint());
    } else if (field === 2 && wt === 2) {
      layer.features.push(readFeature(reader, featureIndex++));
    } else if (field === 3 && wt === 2) {
      layer.keys.push(reader.string(reader.varint()));
    } else if (field === 4 && wt === 2) {
      layer.values.push(readValue(reader));
    } else if (field === 5 && wt === 0) {
      const extent = reader.varint();
      if (extent > 0) layer.extent = extent;
    } else {
      reader.skip(wt);
    }
  }
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

/** Decode the TomTom "Traffic flow" layer. Returns null if the buffer is not a vector tile. */
export function decodeTrafficFlowTile(
  bytes: Uint8Array,
  z: number,
  x: number,
  y: number,
): FlowTileSegment[] | null {
  if (!bytes.length) return [];
  try {
    const reader = new PbfReader(bytes);
    const layers: Layer[] = [];
    while (!reader.atEnd()) {
      const key = reader.varint();
      const field = key >> 3;
      const wt = key & 7;
      if (field === 3 && wt === 2) {
        layers.push(readLayer(reader));
      } else {
        reader.skip(wt);
      }
    }
    const layer =
      layers.find((row) => row.name === "Traffic flow") ??
      layers.find((row) => /flow/i.test(row.name));
    if (!layer) return [];
    const out: FlowTileSegment[] = [];
    for (const feature of layer.features) {
      if (out.length >= MAX_SEGMENTS) break;
      if (feature.type !== 2) continue;
      const props = propsOf(feature.tags, layer.keys, layer.values);
      const trafficLevel = asNumber(props.traffic_level);
      const roadClosure = asBool(props.road_closure);
      const roadType = asString(props.road_type);
      const rings = decodeLines(feature.geometry);
      for (let r = 0; r < rings.length; r++) {
        if (out.length >= MAX_SEGMENTS) break;
        const ring = rings[r];
        if (!ring || ring.length < 2) continue;
        const coordinates = downsample(
          ring.map((pt) => tilePixelToLngLat(z, x, y, layer.extent, pt.x, pt.y)),
        );
        if (coordinates.length < 2) continue;
        out.push({
          id: `t:${z}/${x}/${y}:${feature.index}:${r}`,
          coordinates,
          trafficLevel,
          roadClosure,
          roadType,
        });
      }
    }
    return out;
  } catch {
    return null;
  }
}
