/**
 * Tobias 2026-04-27: regression-test for «Feil: HTTP 200» bug.
 *
 * BACKGROUND: PR #667 mergede route-fil + service for ADMIN Super-User
 * Operations Console til main, og PR #668 mergede frontend-UI. Wire-up til
 * `apps/backend/src/index.ts` ble derimot glemt — endpoint
 * /api/admin/ops/overview returnerte SPA-fallback HTML med HTTP 200, og
 * klienten viste «Feil: HTTP 200» fordi `response.json()` ikke kunne
 * parse HTML.
 *
 * Denne testen er en source-level smoke-test som verifiserer at index.ts:
 *   1. Importerer `createAdminOpsRouter` fra `./routes/adminOps.js`
 *   2. Importerer `AdminOpsService` fra `./admin/AdminOpsService.js`
 *   3. Importerer `createAdminOpsEvents` fra `./sockets/adminOpsEvents.js`
 *   4. Faktisk kaller `app.use(createAdminOpsRouter(...))`
 *   5. Faktisk registrerer admin-ops socket-events i io.on('connection')
 *
 * Ved framtidige refaktoreringer er det lett å fjerne wire-up uventet —
 * denne testen fanger det opp før prod-deploy.
 *
 * Pattern: vi inspiserer kildekoden direkte, ikke runtime-mounting, fordi
 * full mounting krever DB + Redis + masse env-variabler. Source-level sjekk
 * er forskjells-spennende (bare ~20ms å lese filen) og fanger nøyaktig den
 * feilen som rammet prod 2026-04-27.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, "..", "index.ts");
const indexSrc = readFileSync(indexPath, "utf8");

test("index.ts importerer createAdminOpsRouter (regression: «Feil: HTTP 200»)", () => {
  // Importen må eksistere — uten den finnes ikke router-fabrikken i scope.
  assert.match(
    indexSrc,
    /import\s*\{[^}]*createAdminOpsRouter[^}]*\}\s*from\s*["']\.\/routes\/adminOps\.js["']/,
    "createAdminOpsRouter må importeres fra ./routes/adminOps.js",
  );
});

test("index.ts importerer AdminOpsService (regression: «Feil: HTTP 200»)", () => {
  assert.match(
    indexSrc,
    /import\s*\{\s*AdminOpsService\s*\}\s*from\s*["']\.\/admin\/AdminOpsService\.js["']/,
    "AdminOpsService må importeres fra ./admin/AdminOpsService.js",
  );
});

test("index.ts importerer createAdminOpsEvents (regression: «Feil: HTTP 200»)", () => {
  assert.match(
    indexSrc,
    /import\s*\{\s*createAdminOpsEvents\s*\}\s*from\s*["']\.\/sockets\/adminOpsEvents\.js["']/,
    "createAdminOpsEvents må importeres fra ./sockets/adminOpsEvents.js",
  );
});

test("index.ts mounter createAdminOpsRouter via app.use (regression: «Feil: HTTP 200»)", () => {
  // Anker-mønster: `app.use(createAdminOpsRouter({...}))` — uten denne wire-up
  // var det IKKE noen route som matchet /api/admin/ops/* og forespørselen
  // falt gjennom til SPA-fallbacken (sendFile(adminFrontendFile)).
  assert.match(
    indexSrc,
    /app\.use\s*\(\s*[\r\n\s]*createAdminOpsRouter\s*\(/,
    "app.use(createAdminOpsRouter(...)) må eksistere — uten den fall request gjennom til SPA-fallback med HTTP 200 + HTML",
  );
});

test("index.ts instansierer AdminOpsService (regression: «Feil: HTTP 200»)", () => {
  assert.match(
    indexSrc,
    /new\s+AdminOpsService\s*\(/,
    "AdminOpsService må instansieres i index.ts",
  );
});

test("index.ts registrerer admin-ops socket-handler i io.on('connection') (regression)", () => {
  // Socket-subscribe er det som gjør live-push fungerer — uten den får
  // klienten kun REST-snapshot men ingen oppdateringer på admin:ops:update.
  assert.match(
    indexSrc,
    /registerAdminOpsEvents\s*\(\s*socket\s*\)/,
    "registerAdminOpsEvents(socket) må kalles i io.on('connection')",
  );
});
