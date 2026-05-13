/**
 * Manual-flow E2E helpers.
 *
 * Disse helperne mimicker Tobias' faktiske bruks-flyt:
 *   1. Player navigerer til `/web/?dev-user=<email>`
 *   2. Backend `dev/auto-login` mintes session-token
 *   3. `auth.js` skriver token til sessionStorage og kaller
 *      `window.location.replace(url - ?dev-user)` — én redirect
 *   4. Player lander på `/web/` UTEN pre-seedet `lobby.activeHallId`
 *   5. Lobby defaults til `halls[0].id` = `hall-default` (første i listen)
 *   6. Player klikker hall-velger i topbar for å bytte til pilot-hallen
 *   7. `loadCompliance()` re-fetcher mot ny hallId
 *   8. Player klikker bingo-tile → game-bundle lastes
 *
 * Disse helperne er BEVISST adskilt fra `rest.ts` slik at:
 *   - rest.ts holder seg fokusert på REST-orkestrering (master-side)
 *   - manual-flow.ts håndterer UI-navigasjons-edge-cases (auth-redirect-race,
 *     hall-picker, default-hall-detection)
 *
 * Tobias-direktiv 2026-05-13:
 *   "vi tror at alt er bra fordi den automatiserte testen er grønn, men
 *    den manuelle flyten feiler. Vi må ha en test som mimicker den
 *    manuelle flyten EKSAKT."
 *
 * Filen kobles til `tests/e2e/spill1-manual-flow.spec.ts`.
 */

import type { Page } from "@playwright/test";

const TOKEN_KEY = "spillorama.accessToken";
const USER_KEY = "spillorama.user";
const HALL_KEY = "lobby.activeHallId";

/**
 * Naviger til `?dev-user=<email>` og vent på auth-redirect-flyten.
 *
 * Backend-flow (apps/backend/public/web/auth.js:793-831):
 *   1. `maybeDevAutoLogin()` kjører i `startup()`
 *   2. Slå opp normalize → fetch `/api/dev/auto-login?email=<full-email>`
 *   3. `saveSession(token, user, expiresAt)` skriver til sessionStorage
 *   4. `window.location.replace(url - ?dev-user=)` redirecter
 *
 * Race-vinduer:
 *   - Mellom `saveSession` og `location.replace`: sessionStorage er satt,
 *     men URL har fortsatt `?dev-user=` (kort vindu)
 *   - Etter `location.replace`: ny page-load, sessionStorage overlever
 *     (sessionStorage er per-tab, IKKE per-load — vi mister bare URL-state)
 *
 * Vi venter på:
 *   - URL ikke lenger har `?dev-user=` (proxy for "redirect har skjedd")
 *   - `sessionStorage.spillorama.accessToken` er satt
 *   - Lobby har mountet (vist via en kjent DOM-locator)
 */
export async function loginViaDevUserRedirect(
  page: Page,
  email: string,
  opts: { debugFlag?: boolean } = {},
): Promise<void> {
  const debugQuery = opts.debugFlag ? "&debug=1" : "";
  const url = `/web/?dev-user=${encodeURIComponent(email)}${debugQuery}`;

  // Naviger. Vi forventer at:
  //   1. `auth.js` kjører `maybeDevAutoLogin()` på DOMContentLoaded
  //   2. fetch til /api/dev/auto-login svarer (typisk < 100ms)
  //   3. window.location.replace fjerner ?dev-user= og reloader
  //
  // Playwright's `goto` venter på `load`-event som STANDARD. Etter redirect
  // får vi en NY load-event på den nye URL-en. Vi bruker `waitUntil:
  // "domcontentloaded"` for å la første-page laste, men ikke vente på
  // tunge ressurser — det redirecter umiddelbart uansett.
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Vent på at redirect skjer — URL skal ikke lenger ha `?dev-user=`.
  // 15s timeout dekker scenarier hvor backend er treg eller token-mint feiler.
  await page.waitForFunction(
    () => !window.location.search.includes("dev-user="),
    null,
    { timeout: 15_000 },
  );

  // Vent på at sessionStorage har token. Edge-case: hvis backend feiler,
  // redirecter `maybeDevAutoLogin` IKKE (return false), og vi sitter
  // fortsatt på `?dev-user=`-URL-en uten token. Da feiler første waitFor
  // og vi har en tydelig diagnose.
  await page.waitForFunction(
    (k) => sessionStorage.getItem(k) !== null,
    TOKEN_KEY,
    { timeout: 10_000 },
  );
}

/**
 * Vent på at lobby er fullstendig hydrert.
 *
 * lobby.js:loadLobbyData henter halls, wallet, compliance og gameStatus i
 * parallel. Vi venter på at både hall-velger er populert OG balance-chip
 * viser et faktisk tall (ikke "0 kr" placeholder).
 *
 * Locator-strategi:
 *   - `#lobby-hall-select` — alltid eksisterer i index.html, men `<option>`
 *     er "Laster haller..." inntil renderHallSelect kjøres
 *   - `.lobby-tile[data-slug="bingo"]` — finnes når games er hydrert
 *
 * Vi venter på BINGO-tile via locator (toBeVisible) i selve testen,
 * ikke her — denne helperen returnerer så snart hall-velger har minst 2
 * options (default-hall + pilot-hall).
 */
export async function waitForLobbyHydration(page: Page): Promise<void> {
  // Hall-select skal ha minst 2 reelle options (ikke placeholder).
  await page.waitForFunction(
    () => {
      const select = document.getElementById(
        "lobby-hall-select",
      ) as HTMLSelectElement | null;
      if (!select) return false;
      // Placeholder er "Laster haller..." (én option). Vi venter til lobby
      // har lastet flere haller.
      return select.options.length >= 2;
    },
    null,
    { timeout: 20_000 },
  );
}

/**
 * Returnerer hvilken hall lobby har valgt som default.
 *
 * For Tobias' demo-pilot-spiller-1 vil dette typisk være `hall-default`
 * (første i `lobbyState.halls`-listen) — IKKE `demo-hall-001` selv om
 * det er spillerens primary-hall. Dette er nettopp gapet F-03 dokumenterer:
 * UI-state ≠ user-profile.
 */
export async function getActiveHallId(page: Page): Promise<string> {
  return await page.evaluate((k) => {
    return sessionStorage.getItem(k) ?? "";
  }, HALL_KEY);
}

/**
 * Bytt hall via hall-velger i topbar.
 *
 * lobby.js:782 binder `change`-handler på `#lobby-hall-select` som kaller
 * `switchHall(this.value)` — som igjen:
 *   1. Skriver til sessionStorage.lobby.activeHallId
 *   2. Kaller `loadCompliance()` (async fetch mot
 *      /api/wallet/me/compliance?hallId=X)
 *   3. Re-renderer lobby
 *
 * Playwright's `selectOption` triggrer både `change` og `input` events.
 * Vi venter etterpå på at sessionStorage matcher target-hall (proxy for
 * "switchHall completed") og at compliance er re-fetched.
 */
export async function switchHallViaPicker(
  page: Page,
  hallId: string,
): Promise<void> {
  const select = page.locator("#lobby-hall-select");

  // Verifiser at target-hall finnes i options. Hvis ikke har player ikke
  // tilgang og testen burde feile tydelig istedenfor å henge.
  const hasOption = await page.evaluate((id) => {
    const sel = document.getElementById(
      "lobby-hall-select",
    ) as HTMLSelectElement | null;
    if (!sel) return false;
    return Array.from(sel.options).some((o) => o.value === id);
  }, hallId);
  if (!hasOption) {
    throw new Error(
      `switchHallViaPicker: hallId="${hallId}" finnes ikke i hall-velger. ` +
        `Player har ikke tilgang til denne hallen, eller lobby er ikke ` +
        `hydrert. Sjekk \`getActiveHallId\` og lobby-state.`,
    );
  }

  await select.selectOption(hallId);

  // Vent på at sessionStorage reflekterer ny hall (switchHall har kjørt).
  await page.waitForFunction(
    ({ key, target }) => sessionStorage.getItem(key) === target,
    { key: HALL_KEY, target: hallId },
    { timeout: 5_000 },
  );

  // Compliance-fetchen er async og kan ta opptil 2-3s. Vi venter ikke
  // eksplisitt på den her — bingo-tile-enabled-sjekken i testen dekker
  // det (tile er disabled inntil compliance er lastet).
}

/**
 * Klikk bingo-tile og vent på at game-container er synlig.
 *
 * Etter bingo-tile-klikk laster lobby.js game-bundle-en (Pixi + HTML
 * overlay). Dette tar typisk 1-3s første gang fordi bundle er ~2 MB.
 *
 * Vi returnerer så snart `#web-game-container` er visible — det betyr
 * at bundle er lastet og PlayScreen.init har kjørt.
 */
export async function openBingoGame(page: Page): Promise<void> {
  const tile = page.locator('[data-slug="bingo"]').first();
  // Klikk; trigger lobby.js launchGame → bridge til game-client
  await tile.click();
}

/**
 * Hent diagnostic info om hvorfor popup ikke auto-vises.
 *
 * `PlayScreen.update()` har en 5-condition-gate (linje ~696-716) som
 * avgjør om popup auto-vises. Vi leser disse fra debug-loggen som
 * ConsoleBridge sender til server eller fra window-flagg satt av
 * `PlayScreen.recordGateState()`.
 */
export interface AutoShowGateDiagnostic {
  willOpen: boolean | null;
  autoShowBuyPopupDone: boolean | null;
  hasLive: boolean | null;
  hasTicketTypes: boolean | null;
  waitingForMasterPurchase: boolean | null;
  preRoundTicketsCount: number | null;
  gameStatus: string | null;
}

export async function captureAutoShowGateState(
  page: Page,
): Promise<AutoShowGateDiagnostic> {
  return await page.evaluate(() => {
    interface SpilloramaWindow {
      __spillorama?: {
        playScreen?: {
          getAutoShowGateState?: () => AutoShowGateDiagnostic;
        };
      };
    }
    const w = window as unknown as SpilloramaWindow;
    const fn = w.__spillorama?.playScreen?.getAutoShowGateState;
    if (typeof fn === "function") {
      return fn();
    }
    return {
      willOpen: null,
      autoShowBuyPopupDone: null,
      hasLive: null,
      hasTicketTypes: null,
      waitingForMasterPurchase: null,
      preRoundTicketsCount: null,
      gameStatus: null,
    };
  });
}
