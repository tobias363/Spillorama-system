import { defineConfig } from "vite";
import path from "path";

/**
 * Premietabell design-preview-build.
 *
 * Builds `src/premie-design/premie-design.html` as a standalone landing
 * page som viser nytt 5×3 grid-design (Hvit/Gul/Lilla) for premietabellen
 * i Spill 1. Tobias-direktiv 2026-05-14: design polishes på lokal side
 * FØRST, deretter implementeres 1:1 i CenterTopPanel.ts.
 *
 * Output lander i `apps/backend/public/web/games/premie-design.html`
 * sammen med `main.js`, `preview.html`, `visual-harness.html` og
 * `dev-overview.html`.
 *
 * Runs AFTER de andre Vite-buildene i `npm run build`, så
 * `emptyOutDir: false` er påkrevd for å unngå å overskrive de andre
 * outputs.
 *
 * Server-tilgang: `http://localhost:4000/web/games/premie-design.html`
 * (express.static serverer alt under `apps/backend/public/`).
 */
export default defineConfig({
  base: "/web/games/",
  root: path.resolve(__dirname, "src/premie-design"),
  build: {
    outDir: path.resolve(__dirname, "../../apps/backend/public/web/games"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "src/premie-design/premie-design.html"),
      output: {
        entryFileNames: "premie-design.js",
        chunkFileNames: "chunks/premie-design-[name]-[hash].js",
        assetFileNames: "assets/premie-design-[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared-types/src"),
    },
  },
});
