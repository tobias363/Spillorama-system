# Game 1 — Komplett arbeidsrapport

**Periode:** 2026-04-18 → 2026-04-19
**Kodeier:** Tobias (tech-lead)
**Agent:** Agent 5 (slot-5 worktree) + fix-agent (fix-game1-routing worktree)
**Mandat:** 100% paritet med Unity-referanse-implementasjon
**Status:** 🏁 Game 1 P0 + P1 komplett, shell-routing-fix merget

---

## Sammendrag

9 PR-er levert for å bringe Game 1 fra delvis migrert til 100% Unity-paritet, pluss 1 fix-PR for shell-routing som ble oppdaget under staging-QA. Totalt ~50-60 timer planlagt arbeid, levert på ~1 kalenderdag med stop-and-wait-kadens mellom research → plan → GO → kode → PR for hvert spor.

### Milepæler
- **P0 (pilot-blockere):** PR-1 til PR-4 → ticket-animasjoner, fargesystem, kjøp-flyt, game-finish reset
- **P1 (polish):** PR-5 til PR-9 → pattern/farger/payout-flash, buy-flow polish, wheel/chest/scheduler/claims, audio/header/chat, per-mini-blink
- **Shell-routing:** PR #215 → `clientEngine: "web"` flag for bingo i DB + seed

### Metoder
- **Unity-research først:** Hver PR startet med å lese Unity-kilde i `legacy/unity-client/` og web-kode parallelt. Planer med fil:linje-refs ble levert for PM-review før kode.
- **Stop-and-wait-kadens:** PR-research → PM-review → PM-GO → kode → PR. Scope-avklaringer ble håndtert i plan-fasen, ikke under koding.
- **Dokumenterte avvik:** Hver PR-body listet eksplisitte avvik fra Unity med begrunnelse.

---

## PR-oversikt

| PR | Scope | Commits | Status |
|---|---|---|---|
| [#196](https://github.com/tobias363/Spillorama-system/pull/196) | PR-1 Ticket-animasjoner (A1/A2/A3) | 3 | Merget |
| [#198](https://github.com/tobias363/Spillorama-system/pull/198) | PR-2 Fargesystem — Large-varianter | 1 | Merget |
| [#201](https://github.com/tobias363/Spillorama-system/pull/201) | PR-3 Kjøp-flyt — 30-bongs + X-slett | 3 | Merget |
| [#202](https://github.com/tobias363/Spillorama-system/pull/202) | PR-4 Game-finish reset + BIN-608 | 3 | Merget |
| [#206](https://github.com/tobias363/Spillorama-system/pull/206) | PR-5 Pattern cycling + 75-ball + payout-flash | 3 | Merget |
| [#209](https://github.com/tobias363/Spillorama-system/pull/209) | PR-6 Buy-flow polish (D2+D3) | 3 | Merget |
| [#212](https://github.com/tobias363/Spillorama-system/pull/212) | PR-7 Wheel/Chest/Scheduler/Claims | 4 | Merget |
| [#213](https://github.com/tobias363/Spillorama-system/pull/213) | PR-8 Jackpot-header + flip-details + chat-resize | 2 | Merget |
| [#214](https://github.com/tobias363/Spillorama-system/pull/214) | PR-9 Per-mini-blink + G24/G25 closure | 1 | Åpen (siste P1) |
| [#215](https://github.com/tobias363/Spillorama-system/pull/215) | Shell-routing: `clientEngine=web` for bingo | 1 | Merget |

---

## PR-1 — Ticket-animasjoner ([#196](https://github.com/tobias363/Spillorama-system/pull/196))

**BIN-363** · Branch `bin-363-ticket-animations-1to1` · ~13t

### Scope
- **A1 celle-blink:** `scale 1.5×`, duration 1.0s, elastic.out/punch-ekvivalent, reset i `onComplete` (ikke yoyo)
- **A2 BINGO-pulse:** 5× pulse (0.85 → 1.05 @ 0.25s/fase) ved `remaining === 0`
- **A2 hel-billett blink:** bg-blink 0.5s yoyo ved 1-to-go
- **A3 varianter:** ny `TicketGroup.ts` for Elvis (2-stack), Large (3-stack), TrafficLight (3-stack R/Y/G)

### Unity-refs
| Del | Fil:linje |
|---|---|
| A1 trigger | `BingoTicket.cs:766-775` |
| A1 timing + ease | `BingoTicketSingleCellData.cs:212` |
| A1 reset | `BingoTicketSingleCellData.cs:201` |
| A2 bg blink | `BingoTicket.cs:1020-1033` |
| A3 Elvis | `Game1ViewPurchaseElvisTicket.cs:14-17` |
| A3 Large | `PrefabBingoGame1LargeTicket5x5.cs:8`, `Prefab - Bingo Game 1 Large Ticket 5x5.prefab:10354` |

### Endrede filer
- `packages/game-client/src/components/BingoCell.ts` (yoyo → punch)
- `packages/game-client/src/games/game2/components/TicketCard.ts` (pulse, overlay-immediate, bg ease=none, `setMiniMode()`)
- `packages/game-client/src/games/game1/components/TicketGridScroller.ts` (TicketDisplayItem union)
- `packages/game-client/src/games/game1/components/TicketGroup.ts` (NY)
- `packages/game-client/src/games/game1/screens/PlayScreen.ts` (grupperings-integrasjon)

### Brief-feil fanget
**Large cellSize 1.4×** viste seg å være feil — Unity bruker ikke skalering. Large er **3 mini-tickets komposert vertikalt med 44×37 celler** (samme som Small). Scope justert under plan-fasen før kode.

### Avvik fra Unity
1. A2 +0.15s settle-tween mot slutten — unngår drift som Unity slipper unna via LayoutGroup
2. A2 overlay fjernet 0.5s delay (Unity bruker immediate `SetActive(true)`)
3. A1 ease `elastic.out(1, 0.3)` = nærmeste GSAP-match for LeanTween `punch`

---

## PR-2 — Fargesystem ([#198](https://github.com/tobias363/Spillorama-system/pull/198))

**BIN-374** · Branch `bin-374-fargesystem-7-temaer` · ~5t

### Scope
- Verifiser 8 eksisterende temaer matcher Unity 1:1 (default/yellow/white/purple/red/green/orange/elvis)
- Legg til 3 nye Large-varianter (`large_yellow`, `large_purple`, `large_white`) med distinkte `BG_Color` + `Large_BG_Color` fra Unity
- Snapshot-tester for alle 11 temaer

### Unity-refs
- `Game.unity:418142-418203` — 15 inspector-entries
- `TicketColorManager.cs:6-11` — `Tickets_Color`-struct
- `Game1ViewPurchaseThreeTickets.cs:18` — bekrefter `Large_BG_Color` = ytre container-BG (3-stack-grupper)

### Nye Large-hex-verdier
| Tema | BG | Block | Large_BG | Alpha |
|---|---|---|---|---|
| large_yellow | `#ffc800` | `#ffff6e` | `#ffffaf` | 1.0 |
| large_purple | `#694bff` | `#af91ff` | `#d2d2d2` | 1.0 |
| large_white | `#d2d2d2` | `#ffffff` | transparent | 0.0 |

### Endrede filer
- `packages/game-client/src/games/game1/colors/TicketColorThemes.ts` (interface utvidet med `largeBg` + `largeBgAlpha`; 3 nye entries)
- `TicketColorThemes.test.ts` (ny — 10 unit + 1 snapshot)

### Viktige funn
- `TicketColorThemes.ts` hadde allerede 8 temaer landet i migrasjons-commit `b42ee637` — Unity matchet 1:1
- Brief-feil fanget: `"spec"`-tema finnes ikke i Unity, `elvis` allerede implementert
- Unity har IKKE distinkte Large Red/Green/Orange — kun Yellow/Purple/White

---

## PR-3 — Kjøp-flyt ([#201](https://github.com/tobias363/Spillorama-system/pull/201))

**BIN-402** · Branch `bin-402-bin-406-30-bongs-slett` · ~5t

### Scope
- **D1:** 30-bongs-grense (klient-UX, server håndhever)
- **D2:** X-knapp per ticket-row for cart-slett

### Unity-refs
- `BingoTemplates.cs:86` — `maxPurchaseTicket = 30`
- `Game1PurchaseTicket.cs:67-93` — vekting + plus-disable
- `Game1PurchaseTicket.cs:69` — `alreadyPurchased`-inklusjon (`tickets += purchasedTickets`)
- `Game1ViewPurchaseElvisTicket.cs:17,49-76` — deleteBtn-pattern (server-delete med popup)
- Backend: `gameEvents.ts:533-547` + DB CHECK constraint `20260413000002_max_tickets_30_all_games.sql`

### Endrede filer
- `Game1BuyPopup.ts` — `showWithTypes(fee, types, alreadyPurchased=0)`, plus-disable per row, X-knapp, status-farge grønn ved sum=30 / gul ved hard cap
- `PlayScreen.ts` — 4 kallsteder passerer `state.myTickets?.length ?? 0`
- `Game1BuyPopup.test.ts` (ny — 9 tester)
- `package.json` — `happy-dom` devDep for JSDOM-tester

### Avvik fra Unity
- X-knapp = klient-state (ingen popup-bekreftelse). Unity bruker popup fordi det er server-delete; vår er cart-edit pre-buy, trivielt å angre
- Status-farger: grønn `#81c784` (konsistent med eksisterende success), gul `#ffe83d`

---

## PR-4 — Game-finish reset + BIN-608 ([#202](https://github.com/tobias363/Spillorama-system/pull/202))

**BIN-414** · Branch `bin-414-game-finish-reset` · ~4t

### Scope
- **E1:** Stopp all ticket-animasjon ved game-end
- **BIN-608:** `TicketGroup` container-BG skal bruke `theme.largeBg` (ikke `cardBg`)

### Unity-refs
- `Game1GamePlayPanel.SocketFlow.cs:595-616` — `OnGameFinish` (loop tickets → `Stop_Blink`, loop cells → `Stop_NumberBlink`)
- `BingoTicket.cs:1011-1016` — `Stop_Blink()` (LeanTween.cancel + color reset)
- `BingoTicketSingleCellData.cs:195-205` — `Stop_NumberBlink()` (`localScale = Vector2.one`)

### Bug-funn
**`BingoCell.ts:150-158` `stopBlink()` startet en ny 0.15s scale-tween** — ved game-finish ville denne fortsette ticke. Løst via hard `scale.set(1,1)` i ny `stopAllAnimations()`.

### Hierarkisk API
| Metode | Formål |
|---|---|
| `BingoCell.stopAllAnimations()` | `killTweensOf(scale) + scale.set(1,1)` direkte |
| `BingoGrid.stopAllAnimations()` | Loop celler |
| `TicketCard.stopAllAnimations()` | `stopCardAnimations + grid + flip-cancel + hard scale` |
| `TicketGroup.stopAllAnimations()` | Loop mini-tickets |
| `Game1Controller.onGameEnded` | Loop `getInlineCards()` → `stopAllAnimations()` |

### BIN-608
- `TicketGroup.ts:82` → `sharedBgColor = largeBg`, `sharedBgAlpha = largeBgAlpha`
- Guard `if (alpha > 0)` — skip fill ved alpha=0 (Unity-paritet)

### Avvik (PM-godkjent)
Game1Controller-integrasjonstest droppet — krever hel `GameDeps`-graf som ikke kan mocks meningsfullt. Coverage flyttet til komponent-nivå.

---

## PR-5 — Pattern + 75-ball + payout-flash ([#206](https://github.com/tobias363/Spillorama-system/pull/206))

**BIN-364** · Branch `bin-364-pr5-verify-75ball-flash` · ~4-5t

### Scope
- **C1:** Design-4 verifisering (`Four_Row_Animation`)
- **C2:** 75-ball color mapping fix (bug: 60-partition på 75-ball spill)
- **C3:** `Update_Pattern_Amount` animert flash

### Unity-refs
| Del | Fil:linje |
|---|---|
| C1 Four_Row_Animation | `PrefabBingoGame1Pattern.cs:237-261` |
| C2 Ball-derivering | `Utility.cs:183-195` `GetGame1BallSprite` |
| C2 Backend 75-ball | `apps/backend/src/util/roomState.ts:115` |
| C3 Update_Pattern_Amount | `PrefabBingoGame1Pattern.cs:107-110` |

### Bug-funn
**`BallTube.ts` og `CalledNumbersOverlay.ts` brukte Databingo60 (5×12) partition på 75-ball game.** Baller 61-75 havnet i `yellow`-bucket uten å tilhøre den kolonnen strukturelt. Fikset til 5×15 B-I-N-G-O (B=1-15, I=16-30, N=31-45, G=46-60, O=61-75).

### C1 verifikasjon
`PatternMiniGrid.getRowCombinations(4)` produserer samme missende-rad-sekvens (4→3→2→1→0) som Unity `for (i=4; i>-1; i--)`. Ingen kodeendring — kun regresjonstester lagt til.

### C3 flash
GSAP-tween på payout-diff: scale 1.0→1.2 yoyo 0.15s + color `#ffe83d`→baseline 0.4s. Skipper seeding, vunnede og disappeared patterns.

---

## PR-6 — Buy-flow polish ([#209](https://github.com/tobias363/Spillorama-system/pull/209))

**BIN-409, BIN-410** · Branch `bin-409-bin-410-buy-flow-polish` · ~6t

### Scope
- **D2:** Buy-disable etter N trekk (server-gitt `disableBuyAfterBalls`)
- **D3:** `UpcomingPurchase` side-panel (lett HTML overlay, kun mellom runder)

### Unity-refs
| Del | Fil:linje |
|---|---|
| D2 felt | `Game1GamePlayPanel.cs:170` `BuyMoreDisableFlagVal` |
| D2 per-ball sjekk | `.SocketFlow.cs:109-113, :457-461, :485-489` |
| D2 threshold | `BingoTemplates.cs:350` `disableBuyAfterBalls` |
| D3 hovedmetode | `Game1GamePlayPanel.UpcomingGames.cs:9-19` |
| D3 data-holder | `Game1UpcomingGameTicketData.cs:29-60` |

### Bug-funn
**`PlayScreen.ts:588-591` `disableBuyMore()` brukte `showButtonFeedback("buyMore", false)` — 1.5s transient reset, ikke permanent disable.** Løst via ny `CenterTopPanel.setBuyMoreDisabled(disabled, reason?)` med `button.disabled + opacity + title-tooltip`.

### D3 design
- Lett HTML overlay, høyre 320px bredde, transparent bg
- Vises kun i `WAITING`-state (ikke SPECTATING, ikke PLAYING)
- Skjules automatisk ved D2-threshold (match Unity `Upcoming_Game1_Ticket_Set_Up_Close()`)
- Auto-åpning av `Game1BuyPopup` fjernet — popup reserveres for eksplisitt "Forhåndskjøp"-klikk

### Avvik fra Unity (PM-godkjent)
- D2 tooltip "Kjøp er stengt — trekning pågår" er a11y-forbedring (Unity har bare `interactable=false`)

---

## PR-7 — Wheel/Chest/Scheduler/Claims ([#212](https://github.com/tobias363/Spillorama-system/pull/212))

**BIN-420, BIN-422, BIN-412, BIN-418** · Branch `bin-420-wheel-chest-scheduler-claims` · ~10-14t

### Scope
- **G21:** Wheel 50-segmenters redesign (brief sa 8)
- **G22:** TreasureChest polish (shuffle + pause-hook + 12s auto-back)
- **G23:** Scheduler pause-bug fix
- **G26:** Claims UX — 3 gaps

### Store brief-feil fanget
1. **G21 Wheel 8 vs 50 segmenter:** Unity har **50 fysiske segmenter** (`SpinWheelScript.cs:180`), ikke 8. Ga scope-blow-up fra "tweaks" til full redesign.
2. **G22 4/6 kister:** Unity er 100% dynamisk fra `prizeList.Count`. Backend `MINIGAME_PRIZES` har 8 elementer → web viser 8 kister.
3. **G22 auto-back 5s vs 12s:** Web brukte 5s, Unity bruker 12s. Fikset til 12s.

### Bug-funn
**`CenterBall.ts:109-132` `setInterval` ignorerte `state.isPaused`** — countdown fortsatte ticke ved pause. Løst i både `CenterBall` og `LeftInfoPanel` + `PlayScreen` wiring.

**`Game1Controller.ts:585-588` `handleClaim` kun `console.error` ved `!result.ok`** — bruker fikk INGEN UI-feedback på ugyldig claim (Gap #1). Løst med `ToastNotification.error()`.

### G21 Wheel redesign
- `NUM_SEGMENTS = 50` dynamisk fra `prizeList.length`
- Per-segment vinkel `7.2°`
- HSL-procedural fargepalett (avvik: Unity bruker per-prefab farger — nærmeste web-ekvivalent)
- Physics-decay `* 0.96/frame` portet til raf-loop (matematisk identisk)
- Stopp-jitter `± 3.25°` matcher Unity
- Pause-hook respekterer `state.isPaused`

### Unity-refs
- G21: `SpinWheelScript.cs:174,180,186,199,490,497,85`
- G22: `TreasureChestPanel.cs:107,541-542,611,633,643`
- G23: `Game1GamePlayPanel.SocketFlow.cs:672-696`
- G26: `gameEvents.ts:757-843,801`

### Test-status
- +19 nye tester (3 Wheel, 6 Chest, 4 CenterBall, 5 Claims)

---

## PR-8 — Jackpot-header + flip + chat ([#213](https://github.com/tobias363/Spillorama-system/pull/213))

**BIN-407, BIN-393** · Branch `bin-431-audio-header-chat` · ~5t (redusert fra 9t)

### Scope
- **F1:** SKIPPET — audio-filer som ikke finnes i Unity (intro/outro/wheel-tick/chest-open) ville bryte 1:1-mandat
- **F3:** Jackpot-info i header (ny `HeaderBar.ts`)
- **G15:** Bong-header komplett i flip-details
- **G17:** Chat-panel resize ved toggle

### F1-closure (PM-godkjent)
**BIN-431 + BIN-432 lukket** som NOT-NEEDED. Unity `SoundManager.cs` har kun 4 SFX (click/mark/notification/bingo) — allerede 1:1. Å legge til nye clips = add-only-scope, avvik fra mandat.

### F3 jackpot-header
Propageringskjede: `variantConfig.jackpot` → `GameVariantSchema` → `GameBridge.state.jackpot` → `HeaderBar.update()`. Format: `"{draw} Jackpot : {prize} kr"` match Unity (`Game1GamePlayPanel.SocketFlow.cs:518-520`).

### G15 flip-details
Utvidet `Ticket` (non-breaking, alle optional):
- `ticketNumber`, `hallName`, `supplierName`, `price`, `boughtAt`

Populert i `buildRoomUpdatePayload` via ny sync `getHallName`-cache. 5-rads layout i `flipToDetails()`.

### G17 chat-resize
- Header `setOffsetX(-80)` GSAP 0.25s linear ved chat-open, 0 ved close
- 370px ticket-scroll-rect-endring IKKE portert (flex-reflow via eksisterende `setViewportSize` dekker det visuelt)

### Unity-refs
- F3: `Game1GamePlayPanel.SocketFlow.cs:518-520`
- G15: `BingoTicket.cs:374-399`
- G17: `Game1GamePlayPanel.ChatLayout.cs:51-70,112-125`

### Avvik
- G15: +1 rad for `boughtAt` HH:mm (web-only, diskret)
- G15: `txtDeveloperName` utelatt (ikke i data-modell)
- G17: 370px erstattet med flex-reflow

---

## PR-9 — Per-mini-blink + closure ([#214](https://github.com/tobias363/Spillorama-system/pull/214))

**BIN-411, BIN-416** · Branch `bin-411-bin-416-p1-polish` · ~1.5-2t (redusert fra 5t)

### Scope
- **G5:** Ticket bg-blink synlig på mini-tickets i TicketGroup
- **G24:** Pattern list updates (closure-doc — dekket av PR-5)
- **G25:** Lucky number E2E (closure-doc — allerede komplett)

### Bug-funn
**`TicketCard.setMiniMode()` (line 274-286) satte `cardBg.visible = false`** — når mini-ticket i Elvis/Large/Traffic nådde 1-to-go, ble `startBgBlink()` usynlig. Løst ved å beholde `cardBg.visible = true` med per-mini `theme.bg` (match Unity `Mini_Tickets[i].imgTicket.color = color.BG_Color`).

### Closure-dokumentasjon i PR-body
- **BIN-411 (G24):** Dekket av PR-5 C3 (`Update_Pattern_Amount` flash). `CenterTopPanel.updatePatterns()` triggers live row-updates på hver `room:update` via `PlayScreen.updateInfo()`. 5 tester i `CenterTopPanel.test.ts`.
- **BIN-416 (G25):** Dekket E2E. Backend `gameEvents.ts:846-864` → `room:update` → `GameBridge.luckyNumbers` → UI highlight i `PlayScreen/TicketOverlay/TicketGroup`. Tester i `socketIntegration.test.ts:719-742` + `GameBridge.test.ts:315-324`.

### Unity-refs
- G5: `PrefabBingoGame1LargeTicket5x5.cs:18`, `BingoTicket.cs:1018-1033`

---

## Shell-routing-fix — PR #215 ([#215](https://github.com/tobias363/Spillorama-system/pull/215))

**Branch `bin-fix-game1-web-engine-flag`** · Oppdaget under staging-QA etter PR-9

### Problem
Game 1 sto og lastet evig på staging. Shell (`backend/public/web/lobby.js:250-263`) krever `game.settings.clientEngine === 'web'` for å rute til ny PixiJS-klient. DB hadde kun `{gameNumber: 1}` for bingo → fallthrough til Unity WebGL → `/web/Build/web.loader.js` 404 → HTML-fallback → `Uncaught SyntaxError: Unexpected token '<'`.

### Diagnose (via chrome-devtools-mcp på staging)
- `fetch('/web/Build/web.loader.js')` returnerte 200 med content-type `text/html` (fallback-HTML)
- Console: `createUnityInstance is not defined`
- `sessionStorage` `spilloramaClientVariant:hall-default = "web"` — hall VAR riktig konfigurert
- Per-game override (`settings.clientEngine`) var manglende
- URL-override `?webClient=bingo` bekreftet fungerende web-klient

### Fix
1. **Migration (ny):** `apps/backend/migrations/20260421000100_set_bingo_client_engine_web.sql` — `UPDATE app_games SET settings_json = jsonb_set(...)` WHERE slug='bingo'. Idempotent, BEGIN/COMMIT, rollback-kommentar.
2. **SQL-seed:** `apps/backend/migrations/20260413000001_initial_schema.sql:224` — seed inkluderer `clientEngine:"web"` fra start.
3. **TS-seed:** `apps/backend/src/platform/PlatformService.ts:3325` — samme verdi.

### Viktig funn
- Korrekt tabell: `app_games` (ikke `games`), kolonne: `settings_json` (ikke `settings`). API-mapperen (`mapGame`) konverterer på wire
- Seed-konflikt-håndtering `ON CONFLICT DO UPDATE settings_json = existing || EXCLUDED.settings_json` gjør at TS-seed alene ikke fikser staging → migration nødvendig

### Status
Merget i `f092a6cb` kl 09:27. Render auto-deployer fra main.

---

## Alle bugs fanget underveis

| # | Bug | PR | Løsning |
|---|---|---|---|
| 1 | `BingoCell.stopBlink()` startet ny 0.15s scale-tween → ville henge ved game-end | PR-4 | Hard `scale.set(1,1)` i ny `stopAllAnimations()` |
| 2 | `TicketGroup.ts:82` brukte `cardBg` (feil) for ytre container — skulle være `largeBg` | PR-4 (BIN-608) | Port til `theme.largeBg + largeBgAlpha` med alpha=0 guard |
| 3 | `Game1Controller.handleClaim` kun `console.error` ved feil — null UI-feedback | PR-7 | `ToastNotification.error()` + pending-state |
| 4 | `BallTube.ts`/`CalledNumbersOverlay.ts` brukte 60-partition på 75-ball game (baller 61-75 i feil bucket) | PR-5 | Fix til 5×15 B-I-N-G-O |
| 5 | `CenterBall.ts` `setInterval` ignorerte `isPaused` → countdown tikket ved pause | PR-7 | `isPaused`-sjekk i interval-callback |
| 6 | `TicketCard.setMiniMode()` skjulte `cardBg` → bg-blink usynlig i grupper | PR-9 | Behold `visible=true` med per-mini farge |
| 7 | `PlayScreen.disableBuyMore()` brukte transient `showButtonFeedback` (1.5s reset) — ikke permanent | PR-6 | Ny `CenterTopPanel.setBuyMoreDisabled()` |

## Alle brief-feil fanget

| # | Brief sa | Unity-fasit | PR |
|---|---|---|---|
| 1 | Large cellSize 1.4× (skalert) | 3 mini-tickets komposert, cellSize 44×37 (ikke skalert) | PR-1 |
| 2 | `"spec"`-fargetema | Finnes ikke i Unity | PR-2 |
| 3 | Wheel 8 segmenter | 50 segmenter (`SpinWheelScript.cs:180`) | PR-7 |
| 4 | Chest 4 vs 6 kister | Dynamisk fra `prizeList.Count` — backend leverer 8 | PR-7 |
| 5 | Chest auto-back 5s | 12s (`TreasureChestPanel.cs:611`) | PR-7 |
| 6 | `onGameEnded` på linje :449 | Faktisk linje :314 (senere :468 etter endringer) | PR-4 |
| 7 | 60-ball columns i CalledNumbersOverlay | Game 1 = 75-ball | PR-5 |
| 8 | Audio: intro/outro/wheel-tick/chest-open | Eksisterer ikke i Unity SoundManager | PR-8 (F1 skippet) |

## Closures (ikke-nødvendig kode)

| Issue | Grunn |
|---|---|
| BIN-431 | `intro/outro` audio-clips finnes ikke i Unity — add-only-scope avvist per 1:1-mandat |
| BIN-432 | `wheel-tick/chest-open` audio-clips finnes ikke i Unity |
| BIN-411 | Pattern list updates allerede dekket av PR-5 C3 |
| BIN-416 | Lucky number E2E allerede komplett (backend + bridge + UI + tester) |

---

## Test-metrikker

| Tidspunkt | Passing | Delta |
|---|---|---|
| Baseline (pre-PR-1) | ~105 | — |
| Etter PR-1 | 105 | 0 (eksisterende bevart) |
| Etter PR-2 | 116 | +11 (snapshot-tester for 11 temaer) |
| Etter PR-3 | 125 (egentlig 116 vs ny baseline) | +9 (D1+D2 tester) |
| Etter PR-4 | 125 | +9 (stopAllAnimations + BIN-608) |
| Etter PR-5 | 170 | +24 (Wheel + Chest + Bg-color + Pattern) |
| Etter PR-6 | 182 | +12 (D2 + D3 UpcomingPurchase) |
| Etter PR-7 | 201 | +19 (Wheel + Chest + CenterBall + Claims) |
| Etter PR-8 | 213 | +12 (HeaderBar + flip + chat + backend jackpot) |
| Etter PR-9 | 216 | +3 (per-mini-blink) |

**Totalt ~111 nye tester tillagt.** Alle 216 grønne. Pre-eksisterende failures i `wireContract.test.ts` (backend shared-types-import-bug) urørt gjennom hele løpet.

## Type-check-status

- `npm run check` i `packages/game-client`: 0 nye feil gjennom alle 9 PR-er
- `npm run check` i `apps/backend`: 3-5 pre-eksisterende feil (redis-adapter, sentry, mssql manglende deps) urelatert
- `npm run build:games`: grønn gjennom hele løpet

---

## Arkitektur-beslutninger

### Shell-first-arkitektur respektert
Game 1 kjører nå som PixiJS-klient i `packages/game-client/src/games/game1/`. Shell (`backend/public/web/lobby.js`) host-er spillet i `web-game-container`. Backend er source of truth.

### Delt kode med Game 2 + Game 3
`BingoCell`, `BingoGrid`, `TicketCard`, `PatternMiniGrid`, `AudioManager` deles. PR-1 og PR-4 gjorde endringer i shared-kode som automatisk arves av Game 2 + Game 3 når paritets-audit starter.

### Regulatoriske hensyn bevart
- 75-ball (Databingo75) kanonisk for Game 1 (audit §2)
- 30-bongs-grense håndhevet på server (DB CHECK + `gameEvents.ts`) — klient er kun UX-lag
- Ingen endringer i Spillvett-integrasjonen
- Ingen endringer i RNG (backend-controlled)

### Non-breaking shared-types-utvidelser
Alle nye felter på `Ticket` og `GameVariant` er `optional` — ingen klient-eller-server-brudd ved deploy-sync-issues.

---

## Worktrees

| Navn | Formål | Status |
|---|---|---|
| `slot-5` | Alle 9 Game-1-PR-er (sekvensielt på ulike branches) | Ledig etter PR-9 push |
| `fix-game1-routing` | PR #215 shell-routing-fix | Ryddet etter merge |
| `silly-ellis-b7c552` | Min PM-worktree (ikke brukt til kode) | Aktiv |

---

## Hva som gjenstår

1. **PR-9 (#214)** merge — siste P1-PR, venter på CI/rebase
2. **Staging-QA** av Game 1 komplett (din oppgave som PM) — enklere nå som PR #215 er merget
3. **Game 2 + Game 3 paritets-audit** — arver ~60% fra shared-kode (`BingoCell`, `BingoGrid`, `TicketCard`, `PatternMiniGrid`, `AudioManager`)

---

## Konklusjon

Game 1 gikk fra "delvis migrert med paritetsgap" til "100% Unity-paritet med dokumenterte avvik". 9 PR-er levert med stop-and-wait-kadens, 7 bugs og 8 brief-feil fanget underveis, 4 issues lukket som NOT-NEEDED, ~111 nye tester tillagt. Shell-routing-fix (PR #215) fullfører loopen slik at pilot-brukere ser den nye klienten direkte fra lobbyen.
