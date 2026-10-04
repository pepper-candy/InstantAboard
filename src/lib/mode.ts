import type { Company, Mode, RouteListEntry } from "./types";

export function companyMode(company: Company): Mode {
  if (company === "gmb") return "minibus";
  if (company === "mtr" || company === "lightRail") return "mtr";
  if (company === "sunferry" || company === "hkkf" || company === "fortuneferry") return "ferry";
  if (company === "tram") return "tram";
  return "bus";
}

export function routeCompanies(route: RouteListEntry): Company[] {
  return route.co.filter((co) => (route.stops[co] ?? []).length > 0);
}

export function primaryCompany(route: RouteListEntry): Company {
  return routeCompanies(route)[0] ?? route.co[0] ?? "kmb";
}

export function filterMatches(filter: Mode | "all", mode: Mode): boolean {
  return filter === "all" || filter === mode;
}
