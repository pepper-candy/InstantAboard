export type Lang = "en" | "zh";
export type Theme = "light" | "dark";

export type Company =
  | "kmb"
  | "ctb"
  | "gmb"
  | "nlb"
  | "lrtfeeder"
  | "lightRail"
  | "mtr"
  | "sunferry"
  | "hkkf"
  | "fortuneferry";

export type Mode = "bus" | "minibus" | "mtr" | "ferry" | "taxi";

export type BoardFilter = "all" | Mode;

export type Terminal = { en: string; zh: string };

export type RouteListEntry = {
  route: string;
  co: Company[];
  orig: Terminal;
  dest: Terminal;
  fares: string[] | null;
  faresHoliday: string[] | null;
  freq: Record<string, Record<string, [string, string] | null>> | null;
  jt: string | null;
  seq: number;
  serviceType: string;
  stops: Partial<Record<Company, string[]>>;
  bound: Partial<Record<Company, string>>;
  gtfsId: string;
  nlbId: string;
};

export type StopListEntry = {
  location: { lat: number; lng: number };
  name: Terminal;
};

export type EtaDb = {
  holidays: string[];
  routeList: Record<string, RouteListEntry>;
  stopList: Record<string, StopListEntry>;
  stopMap: Record<string, Array<Record<string, string>>>;
  serviceDayMap: Record<string, Array<"0" | "1">>;
};

export type Pin = {
  id: string;
  routeId: string;
  company: Company;
  stopId: string;
  stopSeq: number;
};

export type Arrival = {
  minutes: number | null;
  at: string | null;
  remark: Terminal;
  estimated: boolean;
  lat?: number;
  lng?: number;
  gps: boolean;
};

export type VehicleDot = {
  lat: number;
  lng: number;
  gps: boolean;
};

export type TaxiStand = {
  id: string;
  lat: number;
  lng: number;
  name: Terminal;
  region: Terminal;
  district: Terminal;
  kind: Terminal;
};

export type Settings = {
  lang: Lang;
  theme: Theme;
  filter: BoardFilter;
  seeded: boolean;
};
