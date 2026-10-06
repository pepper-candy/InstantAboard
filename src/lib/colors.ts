import type { Company, Lang } from "./types";

export const TAXI_RED = "#E60A0A";

export const OPERATOR: Record<Company, string> = {
  kmb: "#E10600",
  ctb: "#F5C400",
  gmb: "#1B8F4A",
  nlb: "#F4A000",
  lrtfeeder: "#8B1E3F",
  lightRail: "#C8960C",
  mtr: "#9B1D4A",
  sunferry: "#1E6BB8",
  hkkf: "#1E6BB8",
  fortuneferry: "#1E6BB8",
  tram: "#2D6A4F",
};

export const MODE_COLOR: Record<string, string> = {
  bus: "#E10600",
  minibus: "#1B8F4A",
  mtr: "#7D499D",
  ferry: "#1E6BB8",
  tram: "#2D6A4F",
  taxi: TAXI_RED,
};

export const MTR_LINE: Record<string, string> = {
  AEL: "#007078",
  TCL: "#F7943E",
  TML: "#9A3B26",
  TKL: "#7D499D",
  EAL: "#53B7E8",
  SIL: "#B5BD00",
  TWL: "#C5003E",
  ISL: "#0075C2",
  KTL: "#00A04D",
  DRL: "#F61D40",
  EAL_LMC: "#53B7E8",
};

const MTR_LINE_NAME: Record<string, { en: string; zh: string }> = {
  AEL: { en: "Airport Express", zh: "機場快綫" },
  TCL: { en: "Tung Chung Line", zh: "東涌綫" },
  TML: { en: "Tuen Ma Line", zh: "屯馬綫" },
  TKL: { en: "Tseung Kwan O Line", zh: "將軍澳綫" },
  EAL: { en: "East Rail Line", zh: "東鐵綫" },
  EAL_LMC: { en: "East Rail Line", zh: "東鐵綫" },
  SIL: { en: "South Island Line", zh: "南港島綫" },
  TWL: { en: "Tsuen Wan Line", zh: "荃灣綫" },
  ISL: { en: "Island Line", zh: "港島綫" },
  KTL: { en: "Kwun Tong Line", zh: "觀塘綫" },
  DRL: { en: "Disneyland Resort Line", zh: "迪士尼綫" },
};

/** Line code before a branch suffix. TKL main and the LOHAS branch are both TKL. */
export function mtrLineCode(route: string): string {
  const raw = (route.split("-")[0] ?? route).toUpperCase();
  if (raw === "EAL_LMC") return "EAL";
  return raw;
}

export function mtrLineNames(route: string): { en: string; zh: string; code: string } {
  const code = mtrLineCode(route);
  const name = MTR_LINE_NAME[code] ?? MTR_LINE_NAME[route.toUpperCase()];
  return { en: name?.en ?? code, zh: name?.zh ?? code, code };
}

export function mtrLineName(lang: Lang, route: string): string {
  const name = mtrLineNames(route);
  return lang === "zh" ? name.zh : name.en;
}

/** One colour per line code, sorted by code so a station's ring never changes order. */
export function mtrLineColors(routes: Iterable<string>): string[] {
  const byCode = new Map<string, string>();
  for (const route of routes) {
    const code = mtrLineCode(route);
    if (!code || byCode.has(code)) continue;
    const color = MTR_LINE[code];
    if (color) byCode.set(code, color);
  }
  return [...byCode.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((code) => byCode.get(code)!);
}

export function routeColor(company: Company, route: string): string {
  if (company === "mtr") {
    return MTR_LINE[mtrLineCode(route)] ?? OPERATOR.mtr;
  }
  return OPERATOR[company];
}

export function onRouteColor(company: Company, route: string): string {
  const bg = routeColor(company, route);
  if (company === "ctb" || company === "nlb" || bg === MTR_LINE.SIL || bg === MTR_LINE.EAL) {
    return "#1A1204";
  }
  return "#FFFFFF";
}
