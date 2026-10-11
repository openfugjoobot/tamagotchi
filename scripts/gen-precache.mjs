// Erzeugt dist/precache.json mit allen Build-Artefakten – der Service Worker
// lädt diese Liste beim Install und cached alles vorab (Offline ab Besuch 1).
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const skip = new Set(["/sw.js", "/precache.json"]);
const files = [];

(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const url = "/" + relative(dist, p).split("\\").join("/");
      if (!skip.has(url)) files.push(url);
    }
  }
})(dist);

files.sort();
writeFileSync(join(dist, "precache.json"), JSON.stringify({ generated: new Date().toISOString(), files }));
console.log(`precache.json: ${files.length} Dateien gelistet`);
