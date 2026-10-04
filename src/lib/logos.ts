import { MTR_LINE, TAXI_RED } from "./colors";

export const MTR_MAROON = "#AC2E44";

const LINE_COLORS = new Set(Object.values(MTR_LINE));

export function isMtrLineColor(color: string | undefined): color is string {
  return Boolean(color && LINE_COLORS.has(color));
}

export function safeHex(color: string | undefined): string {
  return color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "";
}

const TAXI_INNER = `
  <path fill="${TAXI_RED}" stroke="#FFFFFF" stroke-width="7.5" stroke-linejoin="round" stroke-linecap="round" d="M24 11h52l10 34H14z"/>
  <g stroke="#FFFFFF" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M25.5 18.5h13M32 18.5v19"/>
    <path d="M41 37.5 48.2 17.5 55.4 37.5M43.4 30.4h9.6"/>
    <path d="M58.6 18.5 71.2 37.5M71.2 18.5 58.6 37.5"/>
    <path d="M76.4 18.5v19"/>
  </g>
`;

const MTR_GLYPH = `
  <ellipse cx="33" cy="26" rx="32" ry="26" fill="${MTR_MAROON}"/>
  <path d="M 33,8 V 44 M 21,9 A 12,12 0 0 0 45,9 M 21,43 A 12,12 0 0 1 45,43" stroke="white" stroke-width="5" fill="none"/>
`;

export function taxiMarkerHtml(selected = false): string {
  const on = selected ? " is-on" : "";
  return `<svg class="taxi-logo${on}" viewBox="0 0 100 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${TAXI_INNER}</svg>`;
}

export function mtrMarkerHtml(line?: string, selected = false): string {
  const ring = isMtrLineColor(line) ? safeHex(line) : "";
  const on = selected ? " is-on" : "";
  if (!ring) {
    return `<svg class="mtr-logo${on}" viewBox="0 0 65 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${MTR_GLYPH}</svg>`;
  }
  return `<svg class="mtr-logo has-ring${on}" viewBox="-7 -7 79 66" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="33" cy="26" rx="35.2" ry="29.2" fill="none" stroke="${ring}" stroke-width="6.4"/>
    ${MTR_GLYPH}
  </svg>`;
}
