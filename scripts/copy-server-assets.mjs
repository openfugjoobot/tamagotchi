// After `tsc -p tsconfig.server.json`: copy the non-TS runtime assets the
// compiled server loads at boot into the server outDir.
//
// tsc emits only `.js`. `main.ts` resolves `schema.sql` next to its compiled
// module (`dist-server/server/src/db/schema.sql`), so without this step a fresh
// local boot dies with ENOENT (Task-9 D2). The Dockerfile copies it explicitly;
// this script covers `npm run server:build` / `server:dev` outside Docker.
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const assets = [["server/src/db/schema.sql", "dist-server/server/src/db/schema.sql"]];

for (const [from, to] of assets) {
  const src = resolve(root, from);
  const dst = resolve(root, to);
  if (!existsSync(src)) {
    console.error(`[copy-server-assets] missing source: ${from}`);
    process.exit(1);
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`[copy-server-assets] ${from} -> ${to}`);
}
