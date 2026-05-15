import { defineConfig } from "vite";
import path from "path";

/**
 * Bong-design preview-build.
 *
 * Builds `src/bong-design/bong-design.html` as a standalone landing-page
 * for å tweake bong-designet (5×5 grid, Hvit/Gul/Lilla, FREE-celle med
 * spillorama-logo) i 3 scenarier: ingen marks / mid-spill / Bingo Rad 1.
 *
 * Tobias-direktiv 2026-05-15: rask design-iterasjon uten å starte hele
 * spill-stacken. Når designet er godkjent implementeres endringer 1:1 i
 * `packages/game-client/src/games/game1/components/BingoTicketHtml.ts`.
 *
 * Output lander i `apps/backend/public/web/games/bong-design.html`
 * sammen med `main.js`, `preview.html`, `visual-harness.html`,
 * `dev-overview.html` og `premie-design.html`.
 *
 * Runs AFTER de andre Vite-buildene i `npm run build` (kjedet i
 * `package.json`), så `emptyOutDir: false` er påkrevd for å unngå å
 * overskrive de andre outputs.
 *
 * Server-tilgang: `http://localhost:4000/web/games/bong-design.html`
 * (express.static serverer alt under `apps/backend/public/`).
 */
export default defineConfig({
  base: "/web/games/",
  root: path.resolve(__dirname, "src/bong-design"),
  build: {
    outDir: path.resolve(__dirname, "../../apps/backend/public/web/games"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "src/bong-design/bong-design.html"),
      output: {
        entryFileNames: "bong-design.js",
        chunkFileNames: "chunks/bong-design-[name]-[hash].js",
        assetFileNames: "assets/bong-design-[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared-types/src"),
    },
  },
});
