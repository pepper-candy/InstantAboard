import { MTR_LINE } from "./colors";

export const MTR_MAROON = "#AC2E44";

const LINE_COLORS = new Set(Object.values(MTR_LINE));

export function isMtrLineColor(color: string | undefined): color is string {
  return Boolean(color && LINE_COLORS.has(color));
}

export function safeHex(color: string | undefined): string {
  return color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "";
}

const TAXI_SHELL = "M 51.3 0.4 L 41.2 2.9 L 35.6 5.4 L 31 7.9 L 27.4 10.5 L 24.3 13 L 21.6 15.5 L 19.2 18 L 17.1 20.5 L 15.2 23.1 L 13.6 25.6 L 12.3 28.1 L 11.1 30.6 L 10 33.2 L 9.1 35.7 L 8.3 38.2 L 7.6 40.7 L 6.7 43.2 L 6 45.8 L 5.3 48.3 L 4.4 50.8 L 3.6 53.3 L 2.9 55.9 L 2 58.4 L 1.3 60.9 L 0.7 63.4 L 0.4 65.9 L 0.2 68.5 L 0.2 71 L 0.4 73.5 L 0.7 76 L 1.3 78.6 L 2.2 81.1 L 3.3 83.6 L 4.7 86.1 L 6.5 88.6 L 8.9 91.2 L 12 93.7 L 16.1 96.2 L 23.4 98.7 L 146.6 98.7 L 153.7 96.2 L 158 93.7 L 160.9 91.2 L 163.3 88.6 L 165.1 86.1 L 166.6 83.6 L 167.8 81.1 L 168.5 78.6 L 169.1 76 L 169.6 73.5 L 169.6 71 L 169.6 68.5 L 169.6 65.9 L 169.1 63.4 L 168.5 60.9 L 167.8 58.4 L 167.1 55.9 L 166.4 53.3 L 165.5 50.8 L 164.7 48.3 L 163.8 45.8 L 163.3 43.2 L 162.4 40.7 L 161.7 38.2 L 160.7 35.7 L 160 33.2 L 158.9 30.6 L 157.7 28.1 L 156.2 25.6 L 154.6 23.1 L 152.8 20.5 L 150.8 18 L 148.2 15.5 L 145.5 13 L 142.4 10.5 L 138.8 7.9 L 134.3 5.4 L 128.5 2.9 L 118.5 0.4 Z";

const TAXI_PANEL = "M 52.1 16.9 L 45.2 19.1 L 41 21.3 L 37.7 23.4 L 35 25.6 L 32.7 27.7 L 30.8 29.9 L 29 32.1 L 27.6 34.2 L 26.5 36.4 L 25.6 38.6 L 24.9 40.7 L 24.1 42.9 L 23.4 45 L 22.9 47.2 L 22.1 49.4 L 21.6 51.5 L 20.9 53.7 L 20.1 55.9 L 19.4 58 L 18.9 60.2 L 18.1 62.3 L 17.4 64.5 L 17.1 66.7 L 16.7 68.8 L 16.7 71 L 17.1 73.2 L 17.6 75.3 L 18.9 77.5 L 20.7 79.6 L 24.1 81.8 L 145.7 81.8 L 149.1 79.6 L 151.1 77.5 L 152.2 75.3 L 152.9 73.2 L 153.1 71 L 153.1 68.8 L 152.9 66.7 L 152.4 64.5 L 151.7 62.3 L 151.1 60.2 L 150.4 58 L 149.7 55.9 L 149.1 53.7 L 148.4 51.5 L 147.7 49.4 L 147.1 47.2 L 146.4 45 L 145.7 42.9 L 145.1 40.7 L 144.4 38.6 L 143.5 36.4 L 142.2 34.2 L 140.8 32.1 L 139.2 29.9 L 137.2 27.7 L 135 25.6 L 132.3 23.4 L 129 21.3 L 124.6 19.1 L 117.9 16.9 Z";

const TAXI_WORD = `
  <path d="M38 39 H61 V44.6 H52.7 V69.2 H46.3 V44.6 H38 Z"/>
  <path fill-rule="evenodd" d="M75.8 39.2 L89.2 69.2 H82.2 L79.5 60.4 H72.1 L69.4 69.2 H62.4 Z M75.8 48.4 L73.5 55.4 H78.1 Z"/>
  <path d="M94.2 39.4 L102.4 39.4 L106.4 49.2 L110.4 39.4 L118.6 39.4 L110.2 54.2 L118.6 69 L110.4 69 L106.4 59.2 L102.4 69 L94.2 69 L102.6 54.2 Z"/>
  <path d="M124.2 39 H130.6 V69.2 H124.2 Z"/>
`;

/** Shared roof-sign drawing: white shell, red panel, white TAXI wordmark. */
export const taxiLogoInner = `
  <path fill="#FFFFFF" d="${TAXI_SHELL}"/>
  <path fill="#E31C23" d="${TAXI_PANEL}"/>
  <g fill="#FFFFFF">${TAXI_WORD}</g>
`;

const MTR_GLYPH = `
  <ellipse cx="33" cy="26" rx="32" ry="26" fill="${MTR_MAROON}"/>
  <path d="M 33,8 V 44 M 21,9 A 12,12 0 0 0 45,9 M 21,43 A 12,12 0 0 1 45,43" stroke="white" stroke-width="5" fill="none"/>
`;

const RING_CX = 33;
const RING_CY = 26;
/** Offset from the maroon oval by half the stroke, so the whole ring sits outside the logo. */
const RING_RX = 38.4;
const RING_RY = 32.4;
/** Twice the previous 6.4 stroke. */
export const MTR_RING_STROKE = 12.8;
const RING_PAD = 18;
/** Degrees clockwise from 12 o'clock. */
const RING_START = 20;

export type MtrRingArc = { color: string; d: string };

function ringPoint(deg: number): [number, number] {
  const wrapped = ((deg % 360) + 360) % 360;
  const phi = (wrapped * Math.PI) / 180;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const t = 1 / Math.hypot(s / RING_RX, c / RING_RY);
  return [RING_CX + t * s, RING_CY - t * c];
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Elliptical arc from deg0 to deg1, clockwise from 12 o'clock. Pieces stay under 90° so each sweep is unambiguous. */
function ellipseArc(deg0: number, deg1: number): string {
  const [x0, y0] = ringPoint(deg0);
  let d = `M ${fmt(x0)} ${fmt(y0)}`;
  let a = deg0;
  while (a < deg1 - 1e-9) {
    const b = Math.min(a + 90, deg1);
    const [x, y] = ringPoint(b);
    d += ` A ${RING_RX} ${RING_RY} 0 0 1 ${fmt(x)} ${fmt(y)}`;
    a = b;
  }
  return d;
}

/** N equal arcs, one per colour, in the given order. One colour is a full ring. */
export function mtrRingArcs(colors: readonly string[]): MtrRingArc[] {
  const list: string[] = [];
  for (const color of colors) {
    const hex = safeHex(color);
    if (isMtrLineColor(hex)) list.push(hex);
  }
  const n = list.length;
  if (n === 0) return [];
  const span = 360 / n;
  return list.map((color, i) => ({
    color,
    d: ellipseArc(RING_START + i * span, RING_START + (i + 1) * span),
  }));
}

export function mtrRingViewBox(hasRing: boolean): string {
  const pad = hasRing ? RING_PAD : 0;
  return `${-pad} ${-pad} ${65 + pad * 2} ${52 + pad * 2}`;
}

export function taxiMarkerHtml(selected = false): string {
  const on = selected ? " is-on" : "";
  return `<svg class="taxi-logo${on}" viewBox="0 0 170 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${taxiLogoInner}</svg>`;
}

export function mtrMarkerHtml(line?: string | string[], selected = false): string {
  const arcs = mtrRingArcs(Array.isArray(line) ? line : line ? [line] : []);
  const on = selected ? " is-on" : "";
  if (arcs.length === 0) {
    return `<svg class="mtr-logo${on}" viewBox="0 0 65 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${MTR_GLYPH}</svg>`;
  }
  const ring = arcs
    .map((arc) => `<path d="${arc.d}" fill="none" stroke="${arc.color}" stroke-width="${MTR_RING_STROKE}" stroke-linecap="butt"/>`)
    .join("");
  return `<svg class="mtr-logo has-ring${on}" viewBox="${mtrRingViewBox(true)}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ring}${MTR_GLYPH}</svg>`;
}
