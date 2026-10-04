import type { Arrival, Lang } from "@/lib/types";

export function EtaStrip({
  arrivals,
  lang,
  busy = false,
}: {
  arrivals: Arrival[] | undefined;
  lang: Lang;
  busy?: boolean;
}) {
  const slots = [0, 1, 2].map((i) => arrivals?.[i] ?? null);
  return (
    <div className={`etas ${busy ? "is-busy" : ""}`} aria-label="ETA">
      {slots.map((row, i) => (
        <div key={i} className="eta">
          <span className="eta-num">{formatMinutes(row?.minutes, lang)}</span>
        </div>
      ))}
    </div>
  );
}

function formatMinutes(minutes: number | null | undefined, lang: Lang): string {
  if (minutes == null) return "—";
  if (minutes <= 0) return lang === "zh" ? "到" : "Due";
  return String(minutes);
}
