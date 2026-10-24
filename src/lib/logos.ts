import { LRT_ROUTE, MTR_LINE, OPERATOR } from "./colors";

export const MTR_MAROON = "#AC2E44";
export const LRT_GOLD = OPERATOR.lightRail;

const LINE_COLORS = new Set(Object.values(MTR_LINE));
const LRT_COLORS = new Set([...Object.values(LRT_ROUTE), LRT_GOLD]);

export function isMtrLineColor(color: string | undefined): color is string {
  return Boolean(color && LINE_COLORS.has(color));
}

export function isLrtLineColor(color: string | undefined): color is string {
  return Boolean(color && LRT_COLORS.has(color));
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

/** Gold oval + Wikimedia LR tram glyph (public/icons/mtr-lightrail.svg); rim drawn by marker chrome. */
const LRT_GLYPH = `
  <ellipse cx="33" cy="26" rx="32" ry="26" fill="${LRT_GOLD}"/>
  <g fill="#FFFFFF" transform="translate(11.0000 4.0000) scale(0.088000)">
    <path d="M322.9,448.6l18.4,36.3h24.9l-29.5-36.3H322.9z M203.3,437.6h-1.8c3.5,0,5.6,0,5.6,0l0,0h88.9v-15.6h-92.6  V437.6z M132.2,485h24.9l19.7-36.3h-13.8L132.2,485z M390.4,129.8c0-24.4-27.4-34.1-27.4-34.1l-7-18.3l-108-0.1l-0.3,0.3l-2-0.1  l-2,0.1l-0.3-0.3l-100.6-0.1l-6.3,18.4c0,0-15,9.3-27.2,34.2c0,0,0.3,252.7,0.3,265.4c0,1,0.2,2.2,0.5,3.4  c1.8,18.5,15.5,33.9,33.5,37.1c2.7,1.1,5.3,1.7,7.8,1.7c13.7,0,27,0,36,0.1v-30.7h125.3v30.3h16.3l0,0.7c0,0,1.1-0.4,21.8-0.4  c4.1,0,8.2-1.5,12-3.9c13.7-5.3,24.7-18.3,26.7-33.4c0.9-2.3,1.5-4,1.5-4.9C390.9,376.8,390.4,129.8,390.4,129.8z M132.6,313.3  c0,0-7.7-5.5-7.7-15.6l-0.1-124.8c0-13.7,7.9-15.7,7.9-15.7c8.6,0,7.8,7,7.8,15.6v132.7C140.5,314.1,141.2,313.3,132.6,313.3z   M202.8,357.4v10.4c0,3.8-1.4,6.9-5.2,6.9h-23.2c-0.6,0.1-1.2,0.2-1.8,0.2c-0.6,0-1.1-0.1-1.7-0.2h-0.5c-0.1,0-0.2-0.1-0.3-0.1  c-0.4-0.1-0.7-0.2-1-0.3c-0.1,0-0.2,0-0.3-0.1c-5.6-1.7-13.3-10.7-13.3-16.9c0-0.2,0.1-6.5,0.1-6.7v6.8c0-3.8,1.6-13,5.4-13h7.6  c0.2,0,0.4-0.1,0.6-0.1c0.2,0,0.4,0.1,0.6,0.1H201C204.9,344.4,202.8,353.5,202.8,357.4z M331,374.2c-0.1,0-0.2,0-0.3,0.1  c-0.3,0.1-0.7,0.2-1,0.3c-0.1,0-0.2,0.1-0.3,0.1h-0.5c-0.6,0.1-1.1,0.2-1.7,0.2c-0.6,0-1.2-0.1-1.8-0.2h-23.2  c-3.8,0-5.2-3.1-5.2-6.9v-10.4c0-3.8-2.1-13,1.7-13h31.3c0.2,0,0.4-0.1,0.6-0.1c0.2,0,0.4,0.1,0.6,0.1h7.6c3.8,0,5.4,9.1,5.4,13  v-6.8c0,0.2,0.1,6.5,0.1,6.7C344.3,363.5,336.7,372.5,331,374.2z M344.7,155.8c0,0,0,0.1,0,0.2v140.6c0,0.1,0,0.1,0,0.2v7.8  c0,4.3-3.5,7.8-7.8,7.8h-15.6c0,0,0,0,0,0h-62.2c-0.6,0-1.1-0.1-1.7-0.2c-0.6,0.1-1.1,0.2-1.7,0.2h-91.9c-4.3,0-7.8-3.5-7.8-7.8  v-6.1c-0.1-0.6-0.2-1.1-0.2-1.7v-141c0-0.6,0.1-1.1,0.2-1.7v-6c0-4.3,3.5-7.8,7.8-7.8h6.5c0.4,0,0.7-0.1,1.1-0.1h84.3  c0.4,0,0.7,0.1,1.1,0.1h1.1c0.4,0,0.7-0.1,1.1-0.1h70c0.4,0,0.8,0.1,1.1,0.1h6.7c4.3,0,7.8,3.5,7.8,7.8L344.7,155.8L344.7,155.8z   M374.9,297.7c0,10-8.2,15.6-8.2,15.6c-8.6,0-8,0.8-8-7.8V172.7c0-8.6-0.8-15.6,7.8-15.6c0,0,8.4,2,8.4,15.7L374.9,297.7z   M297.2,30.4c0,0,12.2-1.1,18.3,7.5c6.2,8.6,2.5-22.9-11.1-22.9H189.2c-13.6,0-17.3,31.5-11.1,22.9c6.2-8.6,16.9-7.5,16.9-7.5  l48.2,46.9l4.8,0L297.2,30.4z M245.6,65.9l-0.8-0.9v0.2l-36.5-34.8l38.5,0l36.5,0l-37,34.8v-0.2L245.6,65.9z M314.7,126.3H185.3  V92.4h129.4V126.3z"/>
  </g>
`;

/** React/SVG inner markup for LrtLogo (no outer svg). */
export const lrtLogoInner = LRT_GLYPH;

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

/** Thin white separator ring between the LRT gold oval and the colour rim. */
const LRT_GAP_RX = 35.2;
const LRT_GAP_RY = 29.2;
const LRT_GAP_STROKE = 2.8;
/** Full white ellipse drawn on top of the colour ring's inner edge, under the gold oval. */
export const LRT_RING_SEPARATOR = `<ellipse cx="${RING_CX}" cy="${RING_CY}" rx="${LRT_GAP_RX}" ry="${LRT_GAP_RY}" fill="none" stroke="#FFFFFF" stroke-width="${LRT_GAP_STROKE}"/>`;

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

function ringArcsFrom(colors: readonly string[], allow: (hex: string) => boolean): MtrRingArc[] {
  const list: string[] = [];
  for (const color of colors) {
    const hex = safeHex(color);
    if (hex && allow(hex)) list.push(hex);
  }
  const n = list.length;
  if (n === 0) return [];
  const span = 360 / n;
  return list.map((color, i) => ({
    color,
    d: ellipseArc(RING_START + i * span, RING_START + (i + 1) * span),
  }));
}

/** N equal arcs, one per colour, in the given order. One colour is a full ring. */
export function mtrRingArcs(colors: readonly string[]): MtrRingArc[] {
  return ringArcsFrom(colors, isMtrLineColor);
}

/** Light Rail route-colour ring (multi-colour when several LR routes serve the stop). */
export function lrtRingArcs(colors: readonly string[]): MtrRingArc[] {
  return ringArcsFrom(colors, (hex) => Boolean(safeHex(hex)));
}

export function mtrRingViewBox(hasRing: boolean): string {
  const pad = hasRing ? RING_PAD : 0;
  return `${-pad} ${-pad} ${65 + pad * 2} ${52 + pad * 2}`;
}

/** Front-view Hong Kong tram: green disc, white body, windows cut through to the disc. */
export const TRAM_GREEN = "#12824A";

export const tramLogoInner = `
  <circle cx="50" cy="50" r="50" fill="${TRAM_GREEN}"/>
  <path fill="#fff" d="M47.2 14 L50.6 2.2 L53.2 2.6 L49.6 14 Z"/>
  <path fill="#fff" d="M40 14 H60 V20 H66 C70 20 71 24 71 28 V76 C71 82 67 85 62 86 L69 97 H31 L38 86 C33 85 29 82 29 76 V28 C29 24 30 20 34 20 H40 Z"/>
  <g fill="${TRAM_GREEN}">
    <rect x="36" y="27" width="8" height="11" rx="1.4"/>
    <rect x="46" y="27" width="8" height="11" rx="1.4"/>
    <rect x="56" y="27" width="8" height="11" rx="1.4"/>
    <rect x="44" y="42" width="12" height="7" rx="1.2"/>
    <rect x="36" y="53" width="12" height="8" rx="1.2"/>
    <rect x="52" y="53" width="12" height="8" rx="1.2"/>
    <rect x="36" y="63" width="12" height="8" rx="1.2"/>
    <rect x="52" y="63" width="12" height="8" rx="1.2"/>
  </g>
  <circle cx="50" cy="76.5" r="3.3" fill="#fff"/>
  <circle cx="50" cy="76.5" r="1.7" fill="${TRAM_GREEN}"/>
  <path d="M40 81.2 Q50 86 60 81.2" fill="none" stroke="${TRAM_GREEN}" stroke-width="1.7" stroke-linecap="round"/>
`;

export function tramMarkerHtml(selected = false): string {
  const on = selected ? " is-on" : "";
  return `<svg class="tram-logo${on}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${tramLogoInner}</svg>`;
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

/** Light Rail map pin: wiki-style LR glyph + route-colour rim (never heavy-rail maroon M). */
export function lrtMarkerHtml(line?: string | string[], selected = false): string {
  const arcs = lrtRingArcs(Array.isArray(line) ? line : line ? [line] : []);
  const on = selected ? " is-on" : "";
  if (arcs.length === 0) {
    return `<svg class="lrt-logo${on}" viewBox="0 0 65 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${LRT_GLYPH}</svg>`;
  }
  const ring = arcs
    .map((arc) => `<path d="${arc.d}" fill="none" stroke="${arc.color}" stroke-width="${MTR_RING_STROKE}" stroke-linecap="butt"/>`)
    .join("");
  return `<svg class="lrt-logo has-ring${on}" viewBox="${mtrRingViewBox(true)}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ring}${LRT_RING_SEPARATOR}${LRT_GLYPH}</svg>`;
}
