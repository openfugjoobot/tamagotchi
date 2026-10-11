import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        guide: resolve(__dirname, "guide.html"),
      },
    },
  },
});
