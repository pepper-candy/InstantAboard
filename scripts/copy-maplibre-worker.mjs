import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(path.dirname(require.resolve("maplibre-gl/package.json", { paths: [root] })), "dist");
const dest = path.join(root, "public", "maplibre");
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(dest, { recursive: true });
for (const file of files) {
  const source = path.join(dist, file);
  if (!existsSync(source)) throw new Error(`Missing MapLibre worker asset: ${source}`);
  const out = path.join(dest, file);
  if (file.endsWith(".mjs")) {
    // Drop sourceMappingURL so DevTools does not 404 on missing .map (paint is unrelated).
    const text = readFileSync(source, "utf8").replace(/\n?\/\/# sourceMappingURL=.*$/m, "\n");
    writeFileSync(out, text);
  } else {
    copyFileSync(source, out);
  }
}