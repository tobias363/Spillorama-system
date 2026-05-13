import { defineConfig } from "vite";
import path from "path";

/**
 * Primary build — library-mode bundle consumed by the web shell.
 *
 * Outputs `main.js` to `apps/backend/public/web/games/`, which lobby.js
 * dynamic-imports via `/web/games/main.js`. Exposes
 * `window.__spilloramaGameClient` with `mountGame()` / `unmountGame()`.
 *
 * The isolated preview page (Spill 1 bonus-games) is produced by a
 * companion config — `vite.preview.config.ts` — and lands in the same
 * output folder as `preview.html` + `preview.js`.
 */
export default defineConfig({
  base: "/web/games/",
  build: {
    outDir: path.resolve(__dirname, "../../apps/backend/public/web/games"),
    // Preview is built AFTER main in the npm-script, so we must NOT clear
    // the output dir on the first pass, and the preview build must not
    // clear it either. We leave emptyOutDir=true here so a clean build
    // starts fresh; the preview config sets emptyOutDir=false.
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/main.ts"),
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      // OBS-2 (2026-05-13): we used to mark @sentry/browser as external
      // (BIN-539), which broke the lazy `await import("@sentry/browser")` at
      // runtime — the host shell never injected it, so Sentry silently
      // stayed disabled in prod. Now we let Rollup bundle it into a lazy
      // chunk so the dynamic import resolves correctly. The chunk is only
      // pulled when VITE_SENTRY_DSN is set, so dev/staging without a DSN
      // pays nothing.
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared-types/src"),
    },
  },
});
