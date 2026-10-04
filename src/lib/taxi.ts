import type { TaxiStand } from "./types";

let cache: TaxiStand[] | null = null;

export async function loadTaxiStands(): Promise<TaxiStand[]> {
  if (cache) return cache;
  const res = await fetch("/data/taxi-stands.json");
  if (!res.ok) return [];
  cache = (await res.json()) as TaxiStand[];
  return cache;
}
