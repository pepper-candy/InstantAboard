import { NextResponse } from "next/server";

/**
 * TD franchised bus route centerlines (FB_ROUTE_LINE) — same layer as scripts/build-shapes.ts.
 *
 * TODO: HomeMap develop “route lines” no longer uses this (per-visible-station shapes via
 * loadRouteLine /shapeFileName instead). Keep for build-shapes / ad-hoc CSDI queries until
 * confirmed unused, then delete.
 */
const MS =
  "https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638844988873_41214/MapServer/0";

/** CORS workaround: proxy CSDI MapServer queries through the Next.js server. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.toString();
  const url = `${MS}/query${query ? `?${query}` : ""}`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(180_000) });
    if (!res.ok) {
      return NextResponse.json({ error: `csdi ${res.status}` }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "csdi fetch failed" }, { status: 502 });
  }
}
