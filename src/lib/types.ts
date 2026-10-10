import type { LatLng } from "./geo";

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
  | "fortuneferry"
  | "tram";

export type Mode = "bus" | "minibus" | "mtr" | "ferry" | "tram" | "taxi";

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
  auto?: boolean;
  bothWays?: boolean;
};

export type Arrival = {
  minutes: number | null;
  at: string | null;
  remark: Terminal;
  estimated: boolean;
  lat?: number;
  lng?: number;
  gps: boolean;
  dest?: Terminal;
  destCode?: string;
  plat?: string;
  dir?: string;
};

export type VehicleDot = {
  /** Stable across polls so the marker eases instead of remounting. */
  id?: string;
  lat: number;
  lng: number;
  gps: boolean;
  speedMs: number;
  /** Metres still to travel along the full track. Omitted for a GPS fix. */
  remainM?: number;
  /** Metres from the end of the track the marker must not pass (the next stop). */
  remainFloor?: number;
  /** Metres from the end of the last stop this bus has passed. It must not fall behind that. */
  remainCeil?: number;
  /** Remain-metres of every stop, same basis as `remainM`. */
  stopRemains?: number[];
  /** Travel heading in degrees (0 = north). Used by MTR chevrons. */
  headingDeg?: number;
  /** Per-vehicle path when it does not follow the shared overlay track (MTR reverse bound). */
  track?: LatLng[];
};

/** Visible ETA error band for a road bus: two bus glyphs, chevron trail, estimated dot. */
export type BusSimRegion = {
  id: string;
  before: LatLng;
  ahead: LatLng;
  estimate: LatLng;
  path: LatLng[];
  /** Stop sequence indexes whose markers sit under a terminal bus SVG. */
  flaggedStopSeqs: number[];
  /** Metres along the track; used to ease markers without 1s jumps. */
  beforeM: number;
  aheadM: number;
  estimateM: number;
};

export type TaxiColor = "red" | "green" | "blue";

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

export type NearbyPlace = {
  id: string;
  lat: number;
  lng: number;
  name: Terminal;
  mode: Mode;
  color: string;
  kind: "stop" | "station" | "pier" | "taxi" | "tram";
  /** Taxi colours allowed to queue at this stand, in red, green, blue order. */
  taxiColors?: TaxiColor[];
  /** MTR line colours at this station, de-duplicated and sorted by line code. */
  lineColors?: string[];
  routes: Array<{
    routeId: string;
    company: Company;
    route: string;
    dest: Terminal;
  }>;
  dests?: Terminal[];
};
