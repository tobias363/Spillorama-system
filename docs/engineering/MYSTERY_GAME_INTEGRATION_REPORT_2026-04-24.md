# Mystery Game end-to-end integration — audit 2026-04-24

**Scope:** verifiser at Mystery Game (BIN-MYSTERY M6) er fullstendig wired fra
backend-trigger til klient-overlay til wallet-credit.

**TL;DR:** Backend-siden (engine + orchestrator + draw-trigger + test-dekning)
var allerede komplett og grønn. Klient-siden hadde **to mystery-spesifikke
gaps** (shared-types union + MiniGameRouter dispatch) som hindret at Mystery
overlay noensinne ble rendret, selv når socket-events kom inn. Admin-UI kunne
heller ikke konfigurere `mystery` som aktivt minispill. Alle mystery-gaps
fikset i denne PR-en.

**Pre-existing infrastruktur-gaps som fortsatt gjelder** (ikke mystery-
spesifikke — rammer ALLE M6 minispill likt, må fikses i egen PR): socket-
broadcaster wiring + `mini_game:choice`-handler på backend.

---

## Steg-for-steg verifikasjon (Bakgrunn §1-8)

| # | Steg | Status | Bevis |
|---|------|--------|-------|
| 1 | Backend trigger Mystery ved Fullt Hus | **OK** | `Game1DrawEngineService.ts:1156-1163` kaller `triggerMiniGamesForFullHouse` POST-commit etter Fullt Hus detektert. |
| 2 | Orchestrator kaller `MiniGameMysteryEngine.trigger()` | **OK** | `Game1MiniGameOrchestrator.maybeTriggerFor` (src/game/minigames/Game1MiniGameOrchestrator.ts:260-391) dispatcher via registrert map. `index.ts:1166` registrerer `new MiniGameMysteryEngine()`. |
| 3 | Socket-event emittes til klient | **GAP (felles for alle minispill)** | Orchestrator kaller `broadcaster.onTrigger`, men `setBroadcaster` kalles aldri i `index.ts`. Default er `NoopMiniGameBroadcaster`. Ingen `io.to(...).emit("mini_game:trigger", ...)`-adapter eksisterer. Berører wheel/chest/colordraft/oddsen likt — ikke mystery-spesifikt. |
| 4 | Klient subscriberer på `miniGameTrigger` | **OK** | `SpilloramaSocket.ts:259-261` lytter på `MINI_GAME_TRIGGER` og dispatcher. `GameBridge.ts:185` forwarder. `Game1Controller.ts:197` abonnerer via bridge. **MEN**: router droppet Mystery-trigger med "Unknown miniGameType" fordi `case "mystery"` manglet (fikset i denne PR-en). |
| 5 | Spiller velger opp/ned × 5 | **OK** | `MysteryGameOverlay.show/setOnChoice` (packages/game-client/src/games/game1/components/MysteryGameOverlay.ts) samler directions og kaller `onChoice({ directions })`. Dekket av 28 overlay-tester. |
| 6 | Socket-event tilbake til backend | **GAP (felles for alle minispill)** | Klient sender `SocketEvents.MINI_GAME_CHOICE` via `SpilloramaSocket.sendMiniGameChoice`. Backend har **ingen** `socket.on("mini_game:choice", ...)`-handler. Ingen minispill fungerer end-to-end uten denne handleren. |
| 7 | `handleChoice()` validerer + utbetaler | **OK (server-logikk)** | `MiniGameMysteryEngine.handleChoice` (src/game/minigames/MiniGameMysteryEngine.ts:497-552) rekonstruerer state deterministisk via seeded RNG, validerer directions (INVALID_CHOICE ved feil), returnerer payoutCents + resultJson. Forutsetter at socket-handler kaller `orchestrator.handleChoice`. |
| 8 | Wallet krediteres | **OK** | `Game1MiniGameOrchestrator.creditPayout` (linje 662-681) kaller `walletAdapter.credit(walletId, amountKroner, reason, { idempotencyKey: g1-minigame-<resultId>, to: "winnings" })`. Dekket av integration-test som verifiserer `to: "winnings"` + idempotency-key. |

---

## Identifiserte gaps

### Gap A (mystery-spesifikk, HIGH) — FIKSET

**Fil:** `packages/shared-types/src/socket-events.ts:385`

`M6MiniGameType`-unionen manglet `"mystery"`. Backend-typen
(`apps/backend/src/game/minigames/types.ts:36-41`) inkluderer allerede
`"mystery"`, så typene var out of sync → TypeScript-konsumenter i klienten
kunne ikke referere mystery.

**Fix:** lagt til `"mystery"` i unionen + oppdatert doc-kommentarer for
trigger/choice/result-payload-shapes.

### Gap B (mystery-spesifikk, HIGH) — FIKSET

**Fil:** `packages/game-client/src/games/game1/logic/MiniGameRouter.ts`

Router'ens overlay-dispatch switch manglet `case "mystery"`. Mystery trigger-
events ville truffet default-branchen og blitt silently dropped
(`console.warn("Unknown miniGameType")`). Overlay ble aldri vist, choice ble
aldri sendt, spilleren fikk aldri premie.

**Fix:** importert `MysteryGameOverlay`, lagt til i `MiniGameOverlay`-unionen,
og `case "mystery": return new MysteryGameOverlay(w, h);`. Lagt til 2
router-tester (dispatch + choice-emit) — alle 20 tester grønne.

### Gap C (admin-UI, mystery-spesifikk) — FIKSET

**Fil:** `apps/admin-web/src/pages/games/gameManagement/Spill1Config.ts:191`

`Spill1MiniGameType` manglet `"mystery"`, så admin kunne ikke huke av
"Mystery Game" i "Minispill etter Fullt Hus"-seksjonen. Siden backend leser
`gameConfigJson.spill1.miniGames: string[]`, meant admin-UI-mangel at
mystery ALDRI ble trigget i produksjon.

**Fix:** lagt til `"mystery"` i `Spill1MiniGameType` + `SPILL1_MINI_GAME_TYPES`
+ nye i18n-strings (`gm_minigame_mystery` på no/en) + oppdatert
spill1Config-test. Alle 77 admin-web tester grønne.

### Gap D (pre-existing infrastruktur — ikke mystery-spesifikk)

**Orchestrator-broadcaster og socket-choice-handler er ikke wired.** Ingen av
M6-minispillene (wheel, chest, colordraft, oddsen, mystery) vil fungere
end-to-end før dette fikses. Skal håndteres i egen PR — utenfor scopet
"verifiser Mystery-integrasjonen".

- `Game1MiniGameOrchestrator` eksponerer `setBroadcaster(broadcaster:
  MiniGameBroadcaster)`, men `index.ts` kaller aldri denne. Default er
  `NoopMiniGameBroadcaster` → `mini_game:trigger`/`mini_game:result` emittes
  aldri til klientene.
- Klient emitter `mini_game:choice` via `SpilloramaSocket.sendMiniGameChoice`,
  men backend har ingen `socket.on("mini_game:choice", ...)`-handler →
  choice-ack timer ut.

**Anbefalt oppfølger:** ny PR "M6 socket-wire: broadcaster + choice-handler".
Vil enable alle 5 minispill samtidig. Arkitektur allerede på plass
(NoopBroadcaster + engine.handleChoice-port), så jobben er rent plumbing.

---

## Test-dekning

### Backend (Node test runner, `npx tsx --test`)

- `MiniGameMysteryEngine.test.ts` — 21 unit-tester (RNG, config-parsing,
  getDigitAt, evaluateMysteryRound, trigger, handleChoice validerings- og
  payout-logikk). Alle grønne.
- `MiniGameMysteryEngine.integration.test.ts` — 5 integration-tester
  (orchestrator + engine + fake pool): default-config full flow, admin-
  config override, dobbel handleChoice → ALREADY_COMPLETED, wallet-credit-
  feil fail-closed (rollback), joker-termination. Alle grønne.
- `Game1MiniGameOrchestrator.test.ts` — 36 tester (framework-nivå).
- Samlet: 62 mystery-relaterte + orchestrator-tester passerer.

### Klient (Vitest)

- `MiniGameRouter.test.ts` — 20 tester inkl. **2 nye for mystery** (dispatch +
  directions-choice). Alle grønne.
- `MysteryGameOverlay.test.ts` — 28 tester (rendering, auto-turn, onChoice
  dispatch, animateResult, error handling). Alle grønne.
- Full game-client suite: 460 tester grønne.

### Admin-web (Vitest)

- `spill1Config.test.ts` — 77 tester inkl. oppdatert `SPILL1_MINI_GAME_TYPES`-
  assertion og `validateSpill1Config` som nå inkluderer mystery. Alle grønne.

---

## Konklusjon

Mystery Game-funksjonell logikk (backend + overlay) er fullstendig
implementert og byte-identisk med legacy Unity-mekanikken. Etter denne PR-en
er også shared-types, klient-router-dispatch og admin-UI fikset slik at
Mystery er en førsteklasses borger i framework'et sammen med wheel/chest/
colordraft/oddsen.

**Gjenstår:** fiks generisk socket-broadcaster + `mini_game:choice`-handler
(Gap D). Dette berører ALLE M6-minispill likt og bør tas i egen PR. Mystery
er ikke blokkert av dette mer enn de andre 4 typene.
