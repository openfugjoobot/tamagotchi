import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  // Dev: /api und /ws an den lokalen Server weiterleiten (`npm run server:dev`,
  // Default-Port 8080). ws:true ist für den WebSocket-Upgrade-Pfad nötig.
  server: {
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/ws": { target: "http://localhost:8080", changeOrigin: true, ws: true },
    },
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
