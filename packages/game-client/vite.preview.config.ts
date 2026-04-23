import { defineConfig } from "vite";
import path from "path";

/**
 * Secondary build — isolated Spill 1 bonus-game preview page.
 *
 * Produces `preview.html` + `preview.js` in
 * `apps/backend/public/web/games/` (alongside `main.js` from the primary
 * build). Served live at `/web/games/preview.html`.
 *
 * Runs AFTER the main build in the `build` npm-script, so
 * `emptyOutDir: false` is required to avoid wiping `main.js`.
 */
export default defineConfig({
  base: "/web/games/",
  root: path.resolve(__dirname, "src/preview"),
  build: {
    outDir: path.resolve(__dirname, "../../apps/backend/public/web/games"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "src/preview/preview.html"),
      output: {
        entryFileNames: "preview.js",
        chunkFileNames: "chunks/preview-[name]-[hash].js",
        assetFileNames: "assets/preview-[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared-types/src"),
    },
  },
});
