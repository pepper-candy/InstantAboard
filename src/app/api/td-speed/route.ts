import { NextResponse } from "next/server";

const SPEED_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/irnAvgSpeed-all.xml";

/** Browser CORS workaround for TD live speeds. */
export async function GET() {
  try {
    const res = await fetch(SPEED_URL, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `td ${res.status}` }, { status: res.status });
    }
    return new NextResponse(await res.text(), {
      headers: { "content-type": "application/xml; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "td fetch failed" }, { status: 502 });
  }
}
