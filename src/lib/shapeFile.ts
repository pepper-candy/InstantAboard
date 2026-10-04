/** Filesystem-safe `/shapes/{operator}-{route}-{dir}.json` name shared by the build and the app. */
export function shapeFileName(input: {
  company: string;
  route: string;
  bound?: string | null;
  serviceType?: string | null;
  gtfsId?: string | null;
  nlbId?: string | null;
}): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9.+_-]+/g, "_").replace(/^_+|_+$/g, "") || "x";
  const dir = [input.bound || "x", input.serviceType || "1", input.gtfsId || input.nlbId || "0"]
    .map((part) => safe(String(part)))
    .join("-");
  return `${safe(input.company)}-${safe(input.route)}-${dir}.json`;
}
