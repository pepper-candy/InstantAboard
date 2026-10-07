import { NextResponse } from "next/server";

const FS = "https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638949160594_2844/FeatureServer";

/** CORS/403 workaround: proxy CSDI FeatureServer queries through the Next.js server. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const layer = searchParams.get("layer");
  if (!layer || !/^\d+$/.test(layer)) {
    return NextResponse.json({ error: "invalid layer" }, { status: 400 });
  }
  searchParams.delete("layer");
  const query = searchParams.toString();
  const url = `${FS}/${layer}/query${query ? `?${query}` : ""}`;
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) {
      return NextResponse.json({ error: `csdi ${res.status}` }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "csdi fetch failed" }, { status: 502 });
  }
}
