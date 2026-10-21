/** Esri XYZ — {z}/{y}/{x} order. World Topo (hillshade). No API key. */
export const BASEMAP_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";

export const BASEMAP_ATTR =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, TomTom, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors, and the GIS User Community';

/** Absolute tile URL for HTTP-cache warm (same Topo XYZ as the map). */
export function basemapTileUrl(z: number, x: number, y: number): string {
  return BASEMAP_URL.replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x));
}
