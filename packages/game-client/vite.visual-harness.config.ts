import { defineConfig } from "vite";
import path from "path";

/**
 * Visual regression harness build.
 *
 * Builds `src/visual-harness/visual-harness.html` as a standalone page that
 * mounts Spill 1 components in deterministic, backend-less states (idle lobby,
 * buy-popup open, draw active, pattern-won). Playwright navigates here and
 * takes pixel-diff snapshots.
 *
 * Output lands in `apps/backend/public/web/games/visual-harness.html`
 * alongside `main.js` + `preview.html`. A tiny static file server
 * (scripts/serve-visual-harness.mjs) serves `apps/backend/public` on port
 * 4173 so `/web/games/assets/...` paths resolve to the same file-layout that
 * production uses.
 *
 * Runs after the main + preview builds; `emptyOutDir: false` prevents wiping
 * their outputs.
 */
export default defineConfig({
  base: "/web/games/",
  root: path.resolve(__dirname, "src/visual-harness"),
  build: {
    outDir: path.resolve(__dirname, "../../apps/backend/public/web/games"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "src/visual-harness/visual-harness.html"),
      output: {
        entryFileNames: "visual-harness.js",
        chunkFileNames: "chunks/harness-[name]-[hash].js",
        assetFileNames: "assets/harness-[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared-types/src"),
    },
  },
});
