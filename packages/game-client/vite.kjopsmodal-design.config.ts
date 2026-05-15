import { defineConfig } from "vite";
import path from "path";

/**
 * Kjøpsmodal-design preview-build.
 *
 * Builds `src/kjopsmodal-design/kjopsmodal-design.html` as a standalone
 * landing-page for å verifisere buy-popup-designet (Figma-export 2026-05-15).
 *
 * Inneholder: premietabell øverst (5 phases × 3 farger), ticket-steppers,
 * "Du kjøper"-summary, kjøp-knapp i grønn primær. Brukes som master-
 * referanse for `Game1BuyPopup.ts` (jf. iterasjons-notater i den filen).
 *
 * Tobias-direktiv 2026-05-15: rask design-iterasjon uten å starte hele
 * spill-stacken. Når designet er godkjent implementeres endringer 1:1 i
 * `packages/game-client/src/games/game1/components/Game1BuyPopup.ts`.
 *
 * Output lander i `apps/backend/public/web/games/kjopsmodal-design.html`
 * sammen med `main.js`, `preview.html`, `visual-harness.html`,
 * `dev-overview.html`, `premie-design.html` og `bong-design.html`.
 *
 * Runs AFTER de andre Vite-buildene i `npm run build` (kjedet i
 * `package.json`), så `emptyOutDir: false` er påkrevd for å unngå å
 * overskrive de andre outputs.
 *
 * Server-tilgang: `http://localhost:4000/web/games/kjopsmodal-design.html`
 * (express.static serverer alt under `apps/backend/public/`).
 */
export default defineConfig({
  base: "/web/games/",
  root: path.resolve(__dirname, "src/kjopsmodal-design"),
  build: {
    outDir: path.resolve(__dirname, "../../apps/backend/public/web/games"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "src/kjopsmodal-design/kjopsmodal-design.html"),
      output: {
        entryFileNames: "kjopsmodal-design.js",
        chunkFileNames: "chunks/kjopsmodal-design-[name]-[hash].js",
        assetFileNames: "assets/kjopsmodal-design-[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared-types/src"),
    },
  },
});
