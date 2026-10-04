import type { Company } from "./types";

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
  taxi: "#F4C400",
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

export function routeColor(company: Company, route: string): string {
  if (company === "mtr") {
    const line = route.split("-")[0]?.toUpperCase() ?? route;
    return MTR_LINE[line] ?? OPERATOR.mtr;
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
