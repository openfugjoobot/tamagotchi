import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  // Dev: /api an `npx wrangler dev` (siehe worker/README.md) weiterleiten.
  server: {
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
  build: {
    target: "es2022",
    // The client build owns `dist/`. The server compiles to `dist-server/`
    // (tsconfig.server.json) so a `vite build` — which empties its outDir —
    // can never delete the compiled server entrypoint (Task-9 D1).
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
  },
});
