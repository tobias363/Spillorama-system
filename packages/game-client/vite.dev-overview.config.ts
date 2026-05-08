import { defineConfig } from "vite";
import path from "path";

/**
 * Pilot Dev Overview build.
 *
 * Builds `src/dev-overview/dev-overview.html` as a standalone landing page
 * that surfaces every preview/scenario/TV/admin URL the dev-team uses
 * during pilot QA. Output lands in
 * `apps/backend/public/web/games/dev-overview.html` alongside `main.js`,
 * `preview.html`, and `visual-harness.html`.
 *
 * Runs AFTER the main + preview + visual-harness builds in `npm run
 * build`, so `emptyOutDir: false` is required to avoid wiping the other
 * outputs.
 */
export default defineConfig({
  base: "/web/games/",
  root: path.resolve(__dirname, "src/dev-overview"),
  build: {
    outDir: path.resolve(__dirname, "../../apps/backend/public/web/games"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "src/dev-overview/dev-overview.html"),
      output: {
        entryFileNames: "dev-overview.js",
        chunkFileNames: "chunks/dev-overview-[name]-[hash].js",
        assetFileNames: "assets/dev-overview-[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared-types/src"),
    },
  },
});
