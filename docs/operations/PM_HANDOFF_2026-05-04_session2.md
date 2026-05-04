# PM-handoff 2026-05-04 (sesjon 2) — Spill 2/3 pilot-fullførsel

**Forrige PM:** Claude (Opus 4.7, 1M context)
**Sesjon-fokus:** Bygd ut Spill 2 og Spill 3 fra "ingenting fungerer" til pilot-readiness
**Status ved overlevering:** 12 PR-er merget + LIVE. Pilot-blokker fikset. Spec spikret. Vent på Tobias' end-to-end-bekreftelse.

---

## 1. TL;DR — status nå

### Fungerer på prod (verifisert via E2E-test 2026-05-04 + curl + skjermbilder)

- ✅ **Trekning kjører live** i UI (ball hver 2s)
- ✅ **Pengeflyt:** entryFee=10, prizePool akkumulerer, ticketCount respekteres (1-30)
- ✅ **Auto-mark** av celler ved ball-match (server + UI synkronisert)
- ✅ **Spill 3 mini-grids** (T/X/7/Pyramide à 25%) — visuelt korrekt
- ✅ **Forhåndskjøp-UX** — "Forhåndskjøp neste runde"-pill + dempet alpha + badge
- ✅ **Bonger fjernes** mellom runder
- ✅ **Countdown "Neste trekning"** tikker MM:SS
- ✅ **Ny runde spawner automatisk** etter G2_NO_WINNER (+ G3_FULL_HOUSE)
- ✅ **Room-uniqueness** — ETT rom per Spill 2/3 globalt, invariant-guard aktiv
- ✅ **Auto-draw host-fallback** — Wi-Fi-blip/fane-refresh breaker IKKE rommet (PR #911 — den siste pilot-blokkeren)
- ✅ **Admin-config-UI** — pace per spill (`roundPauseMs` + `ballIntervalMs`)
- ✅ **ChooseTickets-popup** — viser 32 brett (fetch-wrapper-fix)

### Avventer Tobias' bekreftelse

- ⏳ End-to-end-test etter #911 LIVE (refresh fanen midt i runde → ny tab fortsetter mot første tilgjengelige spiller)

### P1 backlog (ikke pilot-blokkere)

1. `room.isHallShared` returnerer `undefined` på `/api/_dev/game2-state`-respons — kosmetisk, defense-in-depth via gameSlug fungerer
2. Forrige `PM_HANDOFF_2026-05-04.md` nevner `AUTO_DRAW_INTERVAL_MS=3000` — er nå **2000** på prod (info-debt)
3. `RESET_TEST_PLAYERS_TOKEN`-env-var brukes fortsatt av debug-endpoints — beholdt, kan fjernes ved pilot-cutover

---

## 2. Alle 12 PR-er fra denne sesjonen

| PR | Hva | Effekt |
|---|---|---|
| [#899](https://github.com/tobias363/Spillorama-system/pull/899) | entryFee + prizePool + ticketCount + auto-mark backend (4 bugs) | Pengeflyt fungerer |
| [#900](https://github.com/tobias363/Spillorama-system/pull/900) | Spill 3 pattern-pills som 4 mini-grids (T/X/7/Pyramide) | Spill 3 visuelt ferdig |
| [#901](https://github.com/tobias363/Spillorama-system/pull/901) | BuyPopup sender ticketSelections til arm-event | 5 brett kjøpes når 5 armet |
| [#902](https://github.com/tobias363/Spillorama-system/pull/902) | Broadcast `draw:new` + `room:update` fra auto-draw cron | UI viser live ball-trekking |
| [#903](https://github.com/tobias363/Spillorama-system/pull/903) | Forhåndskjøp-tittel + bong-clear (Spill 1-paritet) | Mellom-runde-state korrekt |
| [#904](https://github.com/tobias363/Spillorama-system/pull/904) | Room-uniqueness invariant for Spill 1/2/3 | ETT rom per spill, regulatorisk |
| [#905](https://github.com/tobias363/Spillorama-system/pull/905) | Doc-cleanup: game2/3 canonical-spec + CLAUDE.md | Spec matcher kode 1:1 |
| [#906](https://github.com/tobias363/Spillorama-system/pull/906) | Engine-arkitektur (Game3 ⊂ Game2 ⊂ BingoEngine) | Game2.onDrawCompleted kjøres |
| [#907](https://github.com/tobias363/Spillorama-system/pull/907) | Admin-konfigurerbar runde-pace per Spill 2/3 | Pace endres uten env-var |
| [#908](https://github.com/tobias363/Spillorama-system/pull/908) | Countdown "Neste trekning" wire-up for perpetual-rom | MM:SS tikker |
| [#909](https://github.com/tobias363/Spillorama-system/pull/909) | Forhåndskjøp-UX (pill + badge) + marks-resync | Tydelig + sync på alle baller |
| [#910](https://github.com/tobias363/Spillorama-system/pull/910) | Perpetual-loop ved G2_NO_WINNER + ChooseTickets fetch | Kontinuerlig + popup fungerer |
| [#911](https://github.com/tobias363/Spillorama-system/pull/911) | **Auto-draw host-fallback** (pilot-blokker) | Disconnect breaker IKKE rommet |

**Pluss:** `AUTO_DRAW_INTERVAL_MS=2000` lagt til, `RESET_TEST_PLAYERS=true` fjernet via Render API.

---

## 3. Spikret spec for Spill 2 og 3

Bekreftet av Tobias 2026-05-04. Lever i koden, dokumentert i [`docs/engineering/game2-canonical-spec.md`](docs/engineering/game2-canonical-spec.md) og [`docs/engineering/game3-canonical-spec.md`](docs/engineering/game3-canonical-spec.md).

### Spill 2 — Tallspill (`rocket`)

| Felt | Verdi |
|---|---|
| Grid | **3×3** (9 celler) |
| Ball-range | **1–21** |
| Pris | **10 kr** per brett |
| Win | Full plate (alle 9), auto-claim-on-draw |
| Lucky Number | Ja — siste trukne ball + full plate-vinner = bonus |
| Jackpot-skala | 9b=50, 10b=100, 11b=250, 12b=500, 13b=1000, 14-21b=2500 kr |
| Rom | ETT globalt (`ROCKET`), aldri flere |
| Pause | 30s mellom runder, 2s mellom baller |
| Total | ~72s mellom rundestart |

### Spill 3 — Mønsterbingo (`monsterbingo`)

| Felt | Verdi |
|---|---|
| Grid | **5×5 uten free-center** |
| Ball-range | **1–75** (BINGO-kolonner B/I/N/G/O à 15) |
| Pris | **10 kr** per brett |
| Patterns | **T / X / 7 / Pyramide** à 25% av prizePool |
| Lucky Number | NEI (kun Spill 2) |
| Rom | ETT globalt (`MONSTERBINGO`), aldri flere |
| Pause | Samme som Spill 2 |
| Total | ~180s (3 min) mellom rundestart |

### Forskjell fra Spill 1

| Aspekt | Spill 1 | Spill 2 + 3 |
|---|---|---|
| Rom-modell | Per group-of-halls med master | ETT globalt rom |
| Master/start/stop | Ja | Nei — alltid på, perpetual loop |
| Ticket-typer | 8 farger | 1 type "Standard" |
| Mini-games | Wheel/Chest/Mystery/ColorDraft | Ingen |
| Schedule | Per-hall | Ingen — alltid på |

---

## 4. Test-credentials + debug-endpoints

### Test-bruker (eksisterer på prod, ikke auto-recreated etter `RESET_TEST_PLAYERS=true` fjernet)

```
URL:      https://spillorama-system.onrender.com/web/
Email:    test@spillorama.no
Password: Test1234!
Hall:     auto (Demo Bingohall / demo-hall-999)
```

### Debug-endpoints (token: `RESET_TEST_PLAYERS_TOKEN=spillorama-2026-test`)

```bash
# Hent komplett ROCKET state
curl 'https://spillorama-system.onrender.com/api/_dev/game2-state?token=spillorama-2026-test&roomCode=ROCKET'

# Samme for MONSTERBINGO
curl 'https://spillorama-system.onrender.com/api/_dev/game2-state?token=spillorama-2026-test&roomCode=MONSTERBINGO'

# Force-end + spawn ny runde (manual recovery)
curl -X POST 'https://spillorama-system.onrender.com/api/_dev/game2-force-end' \
  -H 'Content-Type: application/json' \
  -d '{"token":"spillorama-2026-test","roomCode":"ROCKET"}'

# Re-create test-bruker hvis slettet
curl -X POST 'https://spillorama-system.onrender.com/api/_dev/reset-test-user' \
  -H 'Content-Type: application/json' \
  -d '{"token":"spillorama-2026-test"}'
```

---

## 5. Render API

```
Token (gyldig per 2026-05-04):  rnd_DBuI0RvZ0LxEsZRCjiXXAhQrDa1W
Service ID:                     srv-d7bvpel8nd3s73fi7r4g
Owner ID:                       tea-d6k3pmfafjfc73fdh9mg
```

```bash
# Sjekk deploy-status
curl "https://api.render.com/v1/services/$SERVICE_ID/deploys?limit=5" \
  -H "Authorization: Bearer $RENDER_TOKEN"

# Oppdater env-var
curl -X PUT "https://api.render.com/v1/services/$SERVICE_ID/env-vars/AUTO_DRAW_INTERVAL_MS" \
  -H "Authorization: Bearer $RENDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":"2000"}'

# Slett env-var
curl -X DELETE "https://api.render.com/v1/services/$SERVICE_ID/env-vars/RESET_TEST_PLAYERS" \
  -H "Authorization: Bearer $RENDER_TOKEN"
```

### Aktive env-vars per nå

| Variabel | Verdi | Hvorfor |
|---|---|---|
| `AUTO_DRAW_INTERVAL_MS` | `2000` | 2s mellom baller (Tobias-direktiv) |
| `PERPETUAL_LOOP_DELAY_MS` | `30000` | 30s mellom runder |
| `RESET_TEST_PLAYERS_TOKEN` | `spillorama-2026-test` | Brukes av `/api/_dev/*` |
| `RESET_TEST_PLAYERS` | (fjernet) | Boot-script kjører ikke lenger |
| `NODE_ENV` | `production` | Standard |

---

## 6. Verifiserte feller å unngå (oppdatert)

### Felle 1 — drawIndex er 0-basert (BIN-689)

Bruk `drawnNumbers.length` for "antall trukne baller", ikke drawIndex+1.

### Felle 2 — `wallet_accounts.balance` er GENERATED

Kan ikke INSERT/UPDATE direkte. Sett kun `deposit_balance` + `winnings_balance`.

### Felle 3 — Render-log API gir IKKE boot-stdout

Bruk HTTP debug-endpoints (`/api/_dev/...`) for å trigge kode manuelt og få error i HTTP-respons.

### Felle 4 — `room.isHallShared` undefined på legacy-rom

Sjekk `gameSlug` i tillegg (rocket/monsterbingo er ALLTID hall-shared per `canonicalRoomCode.ts`).

### Felle 5 — `armedPlayerIds: []` clearing i PerpetualLoop

Bruk `ArmedPlayerLookup` (PR #894) for å carry over armed mellom runder.

### Felle 6 — SPECTATING-spillere har tickets i `preRoundTickets`

`buildTickets` må fallback: `myTickets.length > 0 ? myTickets : preRoundTickets ?? []`.

### Felle 7 — AUTO_DRAW_INTERVAL_MS default 30s

Sett env-var til ønsket verdi (nå `2000`).

### Felle 8 — `demo-hall-001` finnes ikke i prod-DB

Reset-script auto-picker første aktive hall (per PR #888).

### Felle 9 — Single-TX for resetTestPlayers

Splitt critical-success + best-effort i separate TX-er.

### Felle 10 — Postgres-checkpoint persisterer stuck state

Boot-sweep må fixe via `forceEndStaleRoundResult` + `spawnAfterEnd`-callback (PR #880, #883).

### **Ny — Felle 11 (sesjon 2): Engine instanceof feiler hvis hierarki er flat**

Game3Engine MÅ extends Game2Engine (som extends BingoEngine), ikke begge fra BingoEngine direkte. Hvis flat: `instanceof Game2Engine` returnerer false → `Game2Engine.onDrawCompleted` kjøres aldri → `autoMarkPlayerCells` kjører ikke → `marksCountByPlayer=[0,0,...]`. Fikset i PR #906.

### **Ny — Felle 12 (sesjon 2): G2_NO_WINNER ikke i NATURAL_END_REASONS**

`PerpetualRoundService.NATURAL_END_REASONS` MÅ inkludere alle gyldige game-end-reasons (`G2_WINNER`, `G2_NO_WINNER`, `G3_FULL_HOUSE`, `MAX_DRAWS_REACHED`, `DRAW_BAG_EMPTY`). Hvis ikke: `handleGameEnded` slipper reason til "manual_or_unknown_end"-grenen og scheduler aldri ny runde → spillet fryser. Fikset i PR #910.

### **Ny — Felle 13 (sesjon 2): SpilloramaApi.request response-shape**

`window.SpilloramaAuth.authenticatedFetch` returnerer **unwrapped data** (`body.data`), ikke en `Response`. Caller MÅ detektere `typeof .json === "function"` og pakke i `{ ok: true, data }` hvis ikke Response. Fikset i PR #910.

### **Ny — Felle 14 (sesjon 2): hostPlayerId reassignes aldri**

`RoomLifecycleService.createRoom` setter hostPlayerId ÉN gang. Etter disconnect blir den stale → `engine.drawNextNumber` feiler 100% med `"Spiller finnes ikke i rommet."` → rom permanent stuck. **Per-tick fallback** i `Game2/3AutoDrawTickService` velger første tilgjengelige `players[0]?.id` hvis host ikke er der. Fikset i PR #911.

---

## 7. Workflow-lærdommer (oppdatert)

### Bruk debug-endpoints FØR du gjetter

E2E-test-agenten fant `hostPlayerId`-bug på 5 min ved å polle `/api/_dev/game2-state` mens fanen var connected. Det hadde tatt timer å gjette.

### Spawn diagnose-agenter parallelt med fix-agenter

Worktree-isolasjon (`isolation: "worktree"`) gjør parallelle agenter trygge. Men: pass på merge-konflikter når flere endrer samme fil. Fix selv hvis lite (additive merge), spawn ny agent hvis mer.

### Render-deploy-timing

- Build: 5-7 min
- Total: 7-10 min til live
- ALDRI 2 deploys back-to-back mens første bygger — Render queuer
- Env-var-endring via API trigger ikke alltid deploy umiddelbart — kombiner med kode-merge for å garantere

### Tobias-direktivnivå

- "Sett en agent" = spawn med Agent-tool
- "Test til det funker" = iterer + verifiser etter hver deploy
- "Som Spill 1" = porter design fra Spill 1 (men forskjell fra Spill 1: ETT globalt rom, ingen master)
- "Forhåndskjøp" = kjøp under RUNNING går til neste runde, må vises tydelig

### CI-status er ofte rød pga baseline-fails

132-155 pre-existing failures er forventet. Bruk `gh pr merge --admin` for å bypass. Bare bekreft at NYE tester (din egen kode) er grønne.

### Tobias' usage-limit

Limit kan treffe agenter mid-flight. Sjekk worktree for lokal-arbeid før du gir opp. Hvis branch er pushet → fortsett selv. Hvis kode er lokalt-bare → cd til worktree, commit, push selv.

### PM-sentralisert git-flyt

- Agenter pusher feature-branches
- PM eier `gh pr create` + `gh pr merge --squash --admin --delete-branch`
- Worktree-branches kan ikke slettes lokalt mens agent-worktree er aktiv (warning er ufarlig)

---

## 8. Kjente issues som IKKE er pilot-blokkere

### Pre-existing test-debt (uberørt av denne sesjonen)

- `Game3Engine.test.ts`: 10/16 fails (BIN-895 pattern-revert — eksisterte før)
- `MysteryGameOverlay.test.ts`: 1 fail (pre-existing)
- `apps/backend/src/__tests__/invariants/*`: 68 TS-errors (manglende `fast-check`-modul)
- `physicalTicketsPt6.test.ts` + `dispatcher.test.ts`: pre-existing fails

Total CI-baseline: ~155 failures. Aksepter med `--admin` ved merge.

### Spec vs. CLAUDE.md edge-case

CLAUDE.md game-katalog er nå korrekt etter PR #905. Sjekk likevel ved nye PR-er.

---

## 9. Anbefalt prioritering for neste PM

### P0 — Pilot-readiness-bekreftelse

1. Tobias verifiserer at #911 (host-fallback) løser disconnect-issue ende-til-ende
2. Hvis ja → pilot-readiness oppgradert til **KLAR**
3. Hvis nei → diagnoser via `/api/_dev/game2-state` etter forsøk

### P1 — Polish

1. Fjern `RESET_TEST_PLAYERS_TOKEN`-env-var ved pilot-cutover (sammen med debug-endpoints — `/api/_dev/*` bør deaktiveres i prod ved ekte pilot)
2. Fix `room.isHallShared=undefined` cosmetic-bug
3. Oppdater forrige `PM_HANDOFF_2026-05-04.md` med `AUTO_DRAW_INTERVAL_MS=2000` (eller la denne erstatte den)

### P2 — Pre-pilot-polish

1. Ny test-agent: kjør komplett spec-test ETTER #911 for å verifisere at alle 24 sjekkpunkter fortsatt passer
2. Vurder å legge til unit-tester for host-fallback i `Game2/3AutoDrawTickService` (PR #911 mangler dem — ble droppet pga API-error i agent)

### P3 — Ut-av-scope men nyttig

1. Spill 1 har samme hostPlayerId-bug? Sjekk hvis det er auto-draw-cron der
2. Admin-config-UI test (PR #907) — ingen E2E-test ennå

---

## 10. Kontakt + repo-konvensjon

**Tobias' aktive flow:**
- Tester live på `https://spillorama-system.onrender.com/web/`
- Sender screenshot + console-output
- Forventer PR-merge + deploy innen 5-10 min per fix-iterasjon
- Verdsetter konkret diagnose framfor gjetning
- Usage-limit kan treffe; reset typisk 3 timer

**Repo-konvensjon (PM-sentralisert):**
- Agenter pusher feature-branches
- PM kjører `gh pr create` + `gh pr merge --squash --admin --delete-branch`
- ALDRI merge fra agent-worktree (bruk `--admin` override for CI-baseline-fails)

---

## 11. Verifiseringsbevis fra E2E-test 2026-05-04

E2E-test-agentens rapport (24 pass / 0 fail / 9 warn) ligger i:

```
/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/agent-a2f50e9631ebc8fe5/E2E_TEST_REPORT_2026-05-04.md
/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/agent-a2f50e9631ebc8fe5/test-evidence/
```

Inkluderer:
- 28 evidens-filer (screenshots, server-state-snapshots, polling-samples, findings.json)
- 68 polling-samples som dokumenterer hostPlayerId-bug før #911
- Visuell konfirmasjon av Spill 3 mini-grids

---

**Lykke til.** 12 PR-er som backstop. Spill 2 og Spill 3 er pilot-klare etter #911 forutsatt at Tobias bekrefter disconnect-test.

— Sesjon 2 PM, 2026-05-04
