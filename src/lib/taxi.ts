import type { Lang, TaxiColor, TaxiStand, Terminal } from "./types";

const COLOR_ORDER: TaxiColor[] = ["red", "green", "blue"];
const COLOR_ZH: Record<TaxiColor, string> = { red: "紅色", green: "綠色", blue: "藍色" };
const COLOR_EN: Record<TaxiColor, string> = { red: "Red", green: "Green", blue: "Blue" };

/** Urban stands are red, New Territories stands green, Lantau stands blue. */
export function taxiColors(kind: Terminal | undefined): TaxiColor[] {
  const en = (kind?.en ?? "").toLowerCase();
  const found = new Set<TaxiColor>();
  if (en.includes("urban") || en.includes("cross harbour")) found.add("red");
  if (/\bnt\b/.test(en)) found.add("green");
  if (en.includes("lantau")) found.add("blue");
  return COLOR_ORDER.filter((color) => found.has(color));
}

export function taxiStandLabel(lang: Lang, colors: TaxiColor[] | undefined): string {
  if (!colors?.length) return lang === "zh" ? "的士站" : "Taxi stand";
  if (lang === "zh") return `${colors.map((color) => COLOR_ZH[color]).join("/")}的士站`;
  return `${colors.map((color) => COLOR_EN[color]).join("/")} taxi stand`;
}

let cache: TaxiStand[] | null = null;

export async function loadTaxiStands(): Promise<TaxiStand[]> {
  if (cache) return cache;
  const res = await fetch("/data/taxi-stands.json");
  if (!res.ok) return [];
  cache = (await res.json()) as TaxiStand[];
  return cache;
}
