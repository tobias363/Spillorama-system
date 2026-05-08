/**
 * Spillorama — Pilot Dev Overview
 * ================================================================
 *
 * Standalone landing page for visual QA and dev-test that consolidates
 * every preview/scenario/TV/admin URL Tobias and the team need during
 * pilot work.
 *
 * Purpose:
 *   - Replace the manual "remember the URL" workflow where dev-team
 *     copies endpoints out of `MASTER_PLAN_*.md` or `WIREFRAME_*.md`.
 *   - Provide an at-a-glance dashboard linking to:
 *       1. Bonus mini-game preview pages (preview.html)
 *       2. Visual-harness scenarios for Spill 1, 2, 3 (visual-harness.html)
 *       3. Live TV-skjerm iframes for the 4 demo-haller (master + 3 deltagere)
 *       4. Admin / master / spiller / backend operational links
 *
 * No backend calls. All TV-iframe URLs are hardcoded against the seeded
 * pilot demo-data (see `apps/backend/scripts/seed-demo-pilot-day.ts`).
 *
 * Build:
 *   - Built by `vite.dev-overview.config.ts` after the main + preview +
 *     visual-harness builds. Outputs `dev-overview.html` + `dev-overview.js`
 *     to `apps/backend/public/web/games/`, served at
 *     `/web/games/dev-overview.html`.
 *
 * Production URL after build:
 *   http://localhost:4000/web/games/dev-overview.html
 */

/**
 * Stamp the build tag in the header. Vite injects `import.meta.env.VITE_GIT_SHA`
 * if the environment variable is set at build time; otherwise we surface
 * "local dev" so the dev-team knows they're looking at a non-tagged build.
 */
function stampBuildInfo(): void {
  const tagEl = document.getElementById("build-tag");
  if (!tagEl) return;

  const sha =
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    typeof import.meta.env.VITE_GIT_SHA === "string"
      ? import.meta.env.VITE_GIT_SHA
      : "";

  if (sha) {
    tagEl.textContent = sha.slice(0, 8);
  } else {
    tagEl.textContent = "local dev";
  }
}

stampBuildInfo();
