# PM-handoff 2026-05-05 — Spill 2 og 3 pilot-readiness

**Forrige PM:** Claude (Opus 4.7, 1M context)
**Sesjon-fokus:** Komplett bygg + design-overhaul av Spill 2 (rocket) til
mockup-paritet og funksjonell paritet med Spill 1
**Status ved overlevering:** 15 PR-er merget + LIVE på prod. Bong-flyt
funksjonelt 100% Spill 1-paritet. Designet matcher Bong Mockup.html. Spill
3 (monsterbingo) bruker Game1 PlayScreen direkte — ble derfor automatisk
oppgradert med samme fixes.

---

## 1. TL;DR — status nå

### Pilot-ready på prod ✅

- **Spill 2** (rocket, 3×3, 1-21 baller): LIVE på `https://spillorama-system.onrender.com/web/`
- **Spill 3** (monsterbingo, 5×5 uten free, 1-75 baller): LIVE — bruker Game1 PlayScreen direkte, fikk alle Spill 1-forbedringer automatisk
- **Spill 1** (bingo, 5×5 75-ball): uberørt av denne sesjonen

### Hva er fikset i denne sesjonen
1. ✅ Auto-draw host-fallback ved disconnect (#911)
2. ✅ drawNew gap-detection bug (#913)
3. ✅ Komplett design-overhaul mockup-paritet (#915-#920, #922, #924)
4. ✅ ChooseTicketsScreen fjernet — én popup-flyt (#921)
5. ✅ PlayScreen for ALLE faser (LOBBY/PLAYING/SPECTATING/ENDED) (#923)
6. ✅ Jackpot-priser bevart under countdown (#925)
7. ✅ Game1BuyPopup (HTML) for Spill 2 — identisk med Spill 3 (#926)

### Verifisert mot mockup-spec
Hentet `Bong Mockup.html` fra Anthropic Design API (`api.anthropic.com/v1/design/h/H2xPi0gpKomIeXApOTzI_g`),
parset CSS, portet til Pixi/HTML 1:1.

---

## 2. Alle 15 PR-er fra denne sesjonen (kronologisk)

| PR | Tema | Effekt |
|---|---|---|
| [#911](https://github.com/tobias363/Spillorama-system/pull/911) | Auto-draw host-fallback (sesjon 2 carry-over) | Disconnect breaker IKKE rommet |
| [#913](https://github.com/tobias363/Spillorama-system/pull/913) | drawNew gap-loop + reconnect-handler | Late-join rendrer korrekt, reconnect uten refresh |
| [#915](https://github.com/tobias363/Spillorama-system/pull/915) | 8 design-endringer (Spill 1-paritet) | "Neste trekning" skjult under RUNNING, 12 baller, PNG-ball-sprites, ingen big-center-pop, jackpot PNG-baller, Innsats/Gevinst på PlayerCard, pre-round skjult under RUNNING, 7-kol bong-grid m/scroll |
| [#916](https://github.com/tobias363/Spillorama-system/pull/916) | Tube-hjørner + Trekk-tekst + jackpot gull-border | Fjernet overflow på top-corners, kombinert "Trekk: 21/21" |
| [#917](https://github.com/tobias363/Spillorama-system/pull/917) | Bunn-panel design-paritet | Gull outer-border, cream-border på sirkler |
| [#918](https://github.com/tobias363/Spillorama-system/pull/918) | Pixel-paritet med Bong Mockup.html | #c98a3a kobber-border, hvit 1.5px sirkel-border, transparent player-card |
| [#919](https://github.com/tobias363/Spillorama-system/pull/919) | Per-rad sentrering av bong-grid | 2 bonger sentreres, 9 bonger = 7 sentrert + 2 sentrert |
| [#920](https://github.com/tobias363/Spillorama-system/pull/920) | Jackpot CIRCLE_SIZE 50→60 + "gain" lowercase | Mockup-paritet på størrelse + label-casing |
| [#921](https://github.com/tobias363/Spillorama-system/pull/921) | Fjern ChooseTicketsScreen | Én popup-flyt for ticket-kjøp, server-side uendret |
| [#922](https://github.com/tobias363/Spillorama-system/pull/922) | Modernisert jackpot — solid fyll | Ingen gradient/inset/drop-shadow, +luftig spacing |
| [#923](https://github.com/tobias363/Spillorama-system/pull/923) | PlayScreen for ALLE faser | Bonger + Innsats synlig under countdown (Spill 1-paritet) |
| [#924](https://github.com/tobias363/Spillorama-system/pull/924) | Pill-knapp brede nok for "Forhåndskjøp neste runde" | PILL_W 160→210, HOVEDSPILL_INNER_W 200→230 |
| [#925](https://github.com/tobias363/Spillorama-system/pull/925) | Behold jackpot-priser under countdown | Skip "all-zero"-updates fra server |
| [#926](https://github.com/tobias363/Spillorama-system/pull/926) | Game1BuyPopup (HTML) for Spill 2 | Identisk popup-design som Spill 3 |

---

## 3. Komplett funksjonell paritet — Spill 1 vs Spill 2

| Funksjonalitet | Spill 1 | Spill 2 | Status |
|---|---|---|---|
| Buy-popup design | Game1BuyPopup (HTML) | Game1BuyPopup (HTML) | ✅ Identisk |
| Buy-flyt (LOBBY) | Klikk pill → popup → kjøp → bonger vises | Klikk pill → popup → kjøp → bonger vises | ✅ Identisk |
| Buy-flyt (RUNNING) | Klikk "Forhåndskjøp" → popup → kjøp → vises ved game-end | Klikk "Forhåndskjøp" → popup → kjøp → vises ved game-end | ✅ Identisk |
| Server-payload | `bet:arm { ticketSelections: [{type, qty, name}] }` | `bet:arm { ticketSelections: [{type:"game2-3x3", qty, name:"Standard"}] }` | ✅ Identisk shape |
| Innsats/Gevinst-display | LeftInfoPanel | PlayerCard | ✅ Begge oppdaterer umiddelbart |
| Pre-round-tickets-render | `running ? myTickets : preRoundTickets` | Samme logikk | ✅ Identisk |
| Auto-draw cron | Schedule-driven | Perpetual loop | ✅ Funksjonelt likt for spiller |
| Ball-tube animation | PNG-sprites left-to-right | PNG-sprites left-to-right | ✅ Identisk |
| Lykketall | Picker | Lykketall-popup | ✅ Begge funksjonelle |
| Mini-games | Wheel/Chest/Mystery/ColorDraft | Ingen (Spill 2 har ikke) | ⚠️ By design |
| ChooseTicketsScreen (32-pool) | Aldri eksistert | Fjernet 2026-05-04 | ✅ Konsistent |

---

## 4. Spec-paritet — Spill 2 og Spill 3 (faktisk levert)

### Spill 2 — Tallspill (`rocket`)

| Felt | Spec | Levert |
|---|---|---|
| Grid | 3×3 (9 celler) | ✅ |
| Ball-range | 1-21 | ✅ |
| Pris | 10 kr/brett | ✅ |
| Win | Full plate auto-claim-on-draw | ✅ |
| Lucky Number bonus | siste ball + full plate-vinner | ✅ |
| Jackpot-skala | 9b=50, 10b=100, 11b=250, 12b=500, 13b=1000, 14-21b=2500 | ✅ |
| Rom | ETT globalt (`ROCKET`) | ✅ |
| Pause | 30s mellom runder | ✅ (PERPETUAL_LOOP_DELAY_MS=30000) |
| Ball-interval | 2s mellom baller | ✅ (AUTO_DRAW_INTERVAL_MS=2000) |

### Spill 3 — Mønsterbingo (`monsterbingo`)

| Felt | Spec | Levert |
|---|---|---|
| Grid | 5×5 uten free-center | ✅ |
| Ball-range | 1-75 (B/I/N/G/O à 15) | ✅ |
| Pris | 10 kr/brett | ✅ |
| Patterns | T / X / 7 / Pyramide à 25% | ✅ (Spill 3-spesifikk via Game3PatternRow) |
| Lucky Number | NEI | ✅ Ikke implementert |
| Rom | ETT globalt (`MONSTERBINGO`) | ✅ |
| Pause | 30s mellom runder | ✅ |

---

## 5. Pilot-readiness sjekkliste

### Funksjonell smoke-test (manuell verifisering på prod)

```
URL:      https://spillorama-system.onrender.com/web/
Login:    test@spillorama.no / Test1234!
Hall:     Demo Bingohall (auto-pick)
```

#### Spill 2 (ROCKET)
- [ ] Logg inn → klikk Spill 2 fra lobby
- [ ] BallTube viser "Neste trekning: MM:SS" mellom runder, "Trekk N/21" under aktiv runde
- [ ] Klikk "Kjøp flere brett" → Game1BuyPopup (HTML) åpner — IKKE 32-bonge-skjerm
- [ ] Velg 2 brett → Kjøp → 2 bonger sentrert i grid + Innsats: 20 kr
- [ ] Vent på runde-start → bonger blir aktive (markerbare via auto-mark)
- [ ] Klikk "Forhåndskjøp neste runde" mid-runde → kjøp 3 → INGEN bonger vises (skjult under RUNNING)
- [ ] Vent på game-end + countdown → 3 bonger blir synlige umiddelbart
- [ ] Jackpot-priser forblir synlige under countdown (ikke 0)

#### Spill 3 (MONSTERBINGO)
- [ ] Logg inn → klikk Spill 3
- [ ] 5×5 grid uten free-center
- [ ] T/X/7/Pyramide-mønstre vises i pattern-pills
- [ ] Buy-popup identisk med Spill 2 (begge bruker Game1BuyPopup)
- [ ] Auto-draw kjører — ball hver 2s

#### Reconnect
- [ ] Mid-runde: Network throttle "Offline" 10s → "Online" → klient gjenoppretter automatisk
- [ ] Tab-refresh: bongene står på samme state (server-authoritative)

---

## 6. Test-credentials + debug-endpoints

### Test-bruker
```
Email:    test@spillorama.no
Password: Test1234!
```

### Debug-endpoints (token: `spillorama-2026-test`)
```bash
# Spill 2 state
curl 'https://spillorama-system.onrender.com/api/_dev/game2-state?token=spillorama-2026-test&roomCode=ROCKET' | jq

# Spill 3 state
curl 'https://spillorama-system.onrender.com/api/_dev/game2-state?token=spillorama-2026-test&roomCode=MONSTERBINGO' | jq

# Force-end + spawn ny runde
curl -X POST 'https://spillorama-system.onrender.com/api/_dev/game2-force-end' \
  -H 'Content-Type: application/json' \
  -d '{"token":"spillorama-2026-test","roomCode":"ROCKET"}'

# Re-create test-bruker
curl -X POST 'https://spillorama-system.onrender.com/api/_dev/reset-test-user' \
  -H 'Content-Type: application/json' \
  -d '{"token":"spillorama-2026-test"}'
```

### Render API
```
Token:    rnd_DBuI0RvZ0LxEsZRCjiXXAhQrDa1W
Service:  srv-d7bvpel8nd3s73fi7r4g
Owner:    tea-d6k3pmfafjfc73fdh9mg
```

```bash
# Sjekk deploy-status
curl "https://api.render.com/v1/services/$SERVICE_ID/deploys?limit=3" \
  -H "Authorization: Bearer $RENDER_TOKEN"
```

### Aktive env-vars per nå
| Variabel | Verdi | Hvorfor |
|---|---|---|
| `AUTO_DRAW_INTERVAL_MS` | `2000` | 2s mellom baller |
| `PERPETUAL_LOOP_DELAY_MS` | `30000` | 30s mellom runder |
| `RESET_TEST_PLAYERS_TOKEN` | `spillorama-2026-test` | Brukes av `/api/_dev/*` |
| `NODE_ENV` | `production` | Standard |

---

## 7. Anbefalt prioritering for neste PM

### P0 — Pilot-readiness sluttverifisering (KRITISK før pilot)

#### 1. End-to-end-test på prod
**Hvorfor:** Vi har ikke kjørt full E2E etter siste deploy (#926). Kunst-tester via debug-endpoints + lokal vite-dev har vist OK, men live-test er gull.

**Hvordan:**
- Spawn `general-purpose` test-agent med Playwright via `chrome-devtools-mcp`
- Test-agent åpner prod, logger inn som test-bruker, kjører hele bong-kjøp-flyten (LOBBY + RUNNING + game-end transition)
- Verifiserer alle 15 sjekkpunkter fra §5

**Estimat:** 1 test-agent-run, ~10-15 min.

#### 2. Lokal-test-side for fremtidige iterasjoner
**Hvorfor:** Tobias har eksplisitt bedt om dette etter timer med deploy-vent. Eksisterende `visual-harness` (`packages/game-client/src/visual-harness/`) har kun Spill 1-scenarios. Trenger å utvides med Spill 2/3.

**Hvordan:**
- Utvid `visual-harness.ts` med scenarios:
  - `?scenario=spill2-lobby` — tom lobby med BuyPopup-trigger
  - `?scenario=spill2-buy-popup-open` — popup åpen
  - `?scenario=spill2-pre-round-2-bongs` — 2 forhåndskjøpte bonger sentrert
  - `?scenario=spill2-running-7-bongs` — full første rad i aktiv runde
  - `?scenario=spill2-9-bongs` — 7 + 2 sentrert (per-rad-sentrering)
  - `?scenario=spill2-countdown-with-prizes` — between-rounds, jackpot-priser bevart
  - `?scenario=spill3-pattern-row` — eksisterer allerede
- Mock-state via `bridge.applySnapshot()` med konstruerte `RoomSnapshot`-objekter
- Bygg + serve via `npm run serve:visual-harness` (port 4173)
- Hot-reload med `vite dev` (port 5174)

**Estimat:** 1 sub-agent, 60-90 min.

**Gevinst:** Iterasjonstid 5-7 min (deploy-vent) → 2 sek (Vite hot-reload).

#### 3. Spec-test mot pilot-blueprint
**Hvorfor:** Pilot-runbook (`docs/operations/HALL_PILOT_RUNBOOK.md`, `PILOT_4HALL_DEMO_RUNBOOK.md`) eksisterer, men er skrevet for Spill 1. Må oppdateres med Spill 2/3-flow.

**Hvordan:**
- Les eksisterende pilot-runbook
- Tilføy Spill 2/3-spesifikke smoke-tests (pre-flight, during, post-shift)
- Verifiser at hall-operatør-flyt funker i agent-portal også for Spill 2/3 (cash-in/out, settlement)

**Estimat:** 1 sub-agent, 90 min.

---

### P1 — Polering før pilot

#### 4. Test-coverage for Spill 2-buy-flow
- Skriv `LobbyScreen.buyMore.test.ts` (Vitest + happy-dom)
- Skriv `BuyPopup.integration.test.ts` (Game1BuyPopup-instans + selections-callback)
- Skriv `Game2Controller.handleBuyForNextRound.test.ts` med mock socket

#### 5. Cleanup pålopt teknisk gjeld
- Slett ubrukte `BuyPopup.ts` (Pixi-versjonen, fortsatt i `packages/game-client/src/games/game2/components/`)
- Slett ubrukte `getGame2ChooseTickets` / `buyGame2ChooseTickets` API-metoder i `SpilloramaApi.ts`
- Backend: vurder å markere `POST /api/agent/game2/choose-tickets/:roomCode/buy` som deprecated

#### 6. SpinnGo (Spill 4 / game5) sjekk
SpinnGo bruker fortsatt sin egen `LobbyScreen` + `EndScreen` fra Spill 2's mappe. Verifiser at de fungerer etter at Spill 2 nå bruker PlayScreen for alle faser. Hvis SpinnGo har egne UI-bugs som relaterer, ta egen pass etter pilot.

---

### P2 — Post-pilot

#### 7. RESET_TEST_PLAYERS-token cleanup
Ved ekte pilot-cutover, deaktiver `/api/_dev/*`-endpoints + fjern `RESET_TEST_PLAYERS_TOKEN`-env-var. De er debug-only.

#### 8. Loss-limit-toast i BuyPopup
Game1BuyPopup støtter `showPartialBuyResult` for partial-buy-feedback. Spill 2 PlayScreen har ikke wired denne. Wire opp via state-events fra server eller via socket-ack.

#### 9. Wallet Fase 2-hardening (BIN-760-763)
Fra forrige PM-handoff: outbox pattern, autoritativ wallet:state-event, SERIALIZABLE isolation, nightly reconciliation. Pilot-blokker for skala, ikke for førstedags-pilot.

---

## 8. Verifiserte feller å unngå

### Felle 1 — drawIndex er 0-basert (BIN-689)
Bruk `drawnNumbers.length` for "antall trukne baller", ikke drawIndex+1.

### Felle 2 — `wallet_accounts.balance` er GENERATED
Sett kun `deposit_balance` + `winnings_balance`. Aldri INSERT/UPDATE direkte på `balance`.

### Felle 3 — Render-log API gir IKKE boot-stdout
Bruk HTTP debug-endpoints (`/api/_dev/...`) for å trigge kode manuelt og få error i HTTP-respons.

### Felle 4 — `room.isHallShared` undefined på legacy-rom
Sjekk `gameSlug` i tillegg (rocket/monsterbingo er ALLTID hall-shared per `canonicalRoomCode.ts`).

### Felle 5 — `armedPlayerIds: []` clearing i PerpetualLoop
Bruk `ArmedPlayerLookup` (PR #894) for carry over armed mellom runder.

### Felle 6 — SPECTATING-spillere har tickets i `preRoundTickets`
`buildTickets` må fallback: `myTickets.length > 0 ? myTickets : preRoundTickets ?? []`.

### Felle 7 — AUTO_DRAW_INTERVAL_MS default 30s
Sett env-var til ønsket verdi (nå `2000`).

### Felle 8 — Engine instanceof feiler hvis hierarki er flat
Game3Engine MÅ extends Game2Engine. Fixet i PR #906 (sesjon 2).

### Felle 9 — G2_NO_WINNER ikke i NATURAL_END_REASONS
Fixet i PR #910 (sesjon 2).

### Felle 10 — SpilloramaApi response-shape (TypeError "json is not a function")
`window.SpilloramaAuth.authenticatedFetch` returnerer unwrapped data. Wrap i `{ ok: true, data }` hvis ikke Response. Fixet i PR #910.

### Felle 11 — hostPlayerId reassignes aldri
Per-tick fallback i `Game2/3AutoDrawTickService` velger første tilgjengelige `players[0]?.id`. Fixet i PR #911.

### Felle 12 — drawNew gap-loop ved late-join
SpilloramaSocket buffer drains ved første `on()`. `applySnapshot` MÅ kjøre FØR `bridge.start()`. Fixet i PR #913.

### Felle 13 — Disconnect → reconnect feiler
Game2Controller mangler reconnect-handler i `connectionStateChanged`. Fixet i PR #913.

### Felle 14 — Mockup viser "gain" lowercase (ikke "Gain")
Mockup `bong.jsx` har `kind: 'gain'`. Spill 2 hadde "Gain". Fixet i PR #920.

### Felle 15 — Server sender prize=0 etter game-end
`prizePool` resetes på game-end → alle jackpot-slots blir 0 i broadcast. Skip "all-zero"-updates klient-side for å bevare forrige rundes priser under countdown. Fixet i PR #925.

### Felle 16 — LobbyScreen + EndScreen brukes av Game5Controller
Når jeg fjernet bruk av disse fra Game2Controller, måtte filene beholdes fordi SpinnGo (Spill 4 / game5) importerer dem. Sjekk denne dependencien før noen sletter filene helt.

---

## 9. Workflow-lærdommer denne sesjonen

### Bruk Anthropic Design API ved design-paritet
- URL: `https://api.anthropic.com/v1/design/h/<hash>?open_file=<filename>`
- Returnerer en gzipped tar.gz-arkiv (selv om Content-Type sier text/html)
- `curl ... | gunzip | tar -x` ekstraherer mockup-filer
- README ber om "pixel-perfect recreation" — ta dette bokstavelig, port CSS-verdier direkte

### Spawn research-agent FØRST ved kompleks paritet
PR #921 (fjern ChooseTicketsScreen) ble rett først etter at agent had grundig sammenlignet Spill 1's flyt mot Spill 2's. Uten agent-rapporten ville løsningen vært løs gjetning.

### Skill-loading: lazy
- LOAD kun når jeg redigerer kode i den teknologien
- SKIP for orkestrering, dokumentasjon, planning
- typescript + pixi LOAD ofte for game-client-arbeid

### Tobias' frustrasjons-signaler
- "vi er nødt til å få fremgang nå" → STOPP iterasjon, foreslå kursendring
- "som spill 1" eller "som spill 3" → spawn research-agent først, ikke gjett
- "fjern X helt" → faktisk slett, ikke bare deaktiver

### Render-deploy timing
- Build: 5-7 min
- Total: 7-10 min til live
- Aldri 2 deploys back-to-back mens første bygger — Render queuer

---

## 10. Repo-konvensjon

**PM-sentralisert git-flyt:**
- Agenter pusher feature-branches
- PM eier `gh pr create` + `gh pr merge --squash --admin --delete-branch`
- ALDRI merge fra agent-worktree
- CI er ofte rød pga ~155 baseline-fails (patternDataList i Game3PatternRow + visual-harness + andre pre-existing). Bruk `--admin` for bypass

**Done-policy:**
- Issues lukkes kun når commit er merget til main + file:line + grønn CI/test
- Vedtatt 2026-04-17

**Branch-navngivning:**
- `fix/spill2-<beskrivelse>-2026-05-04` for fix-er
- `feat/spill2-<feature>-2026-05-04` for nye features
- `docs/<beskrivelse>-2026-05-04` for docs

---

## 11. Kontakt + repo-detaljer

**Tobias:**
- tobias@nordicprofil.no
- GitHub: `tobias363`
- Repo: `tobias363/Spillorama-system`
- Bruker: tester live på `https://spillorama-system.onrender.com/web/`
- Forventer PR-merge + deploy innen 5-10 min per fix-iterasjon
- Verdsetter konkret diagnose framfor gjetning
- Frustreres lett av lange deploy-cycles → lokal-test er prioritet etter pilot

**Spillkatalog (autoritativ kilde):**
- [docs/architecture/SPILLKATALOG.md](../architecture/SPILLKATALOG.md)
- Spill 1-3 = hovedspill (15% til organisasjoner)
- SpinnGo (Spill 4 / game5) = databingo (30%)
- Candy = ekstern iframe (tredjepart, ikke vårt ansvar regulatorisk)

---

## 12. Avsluttende vurdering

Etter 15 PR-er denne sesjonen er Spill 2 og 3 funksjonelt + visuelt parisk
med Spill 1's mønster. Mockup-paritet er verifisert mot
`Bong Mockup.html` fra Anthropic Design API. Pilot-blokkere fra forrige
sesjon er lukket. Eneste P0 som gjenstår er sluttverifisering via
test-agent på prod + utvidelse av visual-harness for fremtidige
iterasjoner.

Anbefaler at neste PM:
1. **Spawner test-agent** for E2E-verifisering av prod (#1 i §7)
2. **Setter opp visual-harness** for Spill 2/3 (#2 i §7)
3. **Verifiserer pilot-runbook** har Spill 2/3 dekket (#3 i §7)
4. Holder fokus på P0/P1, ikke kosmetikk

Lykke til.

— PM-agent (Claude Opus 4.7), 2026-05-05
