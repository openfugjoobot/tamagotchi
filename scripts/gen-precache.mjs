// Nach dem Build: precache.json erzeugen und eine Build-Version in sw.js stempeln.
//
// 1) precache.json listet alle Build-Artefakte – der Service Worker laedt die
//    Liste beim Install und cached alles vorab (Offline ab dem ersten Besuch).
// 2) Die Version ist ein Inhalts-Hash ueber alle Artefakte und ersetzt den
//    Platzhalter __SW_VERSION__ in dist/sw.js. Ohne das muesste der Cache-Name
//    bei jeder Aenderung von Hand hochgezogen werden – das wurde vergessen,
//    und ein Icon-Update erreichte bestehende Installationen nicht.
//    Der Hash aendert sich nur, wenn sich wirklich etwas aendert.
import { createHash } from "node:crypto";
import { readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const skip = new Set(["/sw.js", "/precache.json", "/version.json"]);
const all = [];

(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else all.push(p);
  }
})(dist);

const rel = (p) => "/" + relative(dist, p).split("\\").join("/");

// ---- 1) Precache-Liste -----------------------------------------------------
const files = all.map(rel).filter((u) => !skip.has(u));
files.sort();
writeFileSync(
  join(dist, "precache.json"),
  JSON.stringify({ generated: new Date().toISOString(), files }),
);

// ---- 2) Build-Version stempeln --------------------------------------------
const hash = createHash("sha256");
for (const p of [...all].sort()) {
  const url = rel(p);
  if (url === "/sw.js" || url === "/precache.json" || url === "/version.json") continue;
  hash.update(url);
  hash.update(readFileSync(p));
}
const version = hash.digest("hex").slice(0, 12);

const swPath = join(dist, "sw.js");
const src = readFileSync(swPath, "utf8");
if (!src.includes("__SW_VERSION__")) {
  console.error("sw.js: Platzhalter __SW_VERSION__ fehlt – Version nicht gestempelt.");
  process.exit(1);
}
writeFileSync(swPath, src.replace(/__SW_VERSION__/g, version));

// Version separat, damit die Seite sie auch ohne Service Worker anzeigen kann.
writeFileSync(
  join(dist, "version.json"),
  JSON.stringify({ version, generated: new Date().toISOString() }),
);

console.log(
  `precache.json: ${files.length} Dateien · sw.js: Version ${version} gestempelt`,
);
