# PM Quarterly Summary — 2026-04-23 til 2026-05-05

**Status:** Autoritativ oppsummering. Erstatter individuelle handoffs (arkivert i `docs/operations/archive/`).
**Sist oppdatert:** 2026-05-15
**Konsoliderer:** 9 PM_HANDOFFs fra første del av Q2 2026.

---

## Kontekst

Denne oppsummeringen erstatter 9 separate PM_HANDOFFs som dekker første ~2 ukene av Q2 2026 (~185 KB → 1 fil). Originalene er arkivert i `docs/operations/archive/` for referanse hvis dypdyk trengs.

**Ny PM trenger IKKE lese de individuelle handoffs.** Denne oppsummeringen + nyere handoffs (`PM_HANDOFF_2026-05-07.md` og senere) er nok for full kontekst-paritet.

Tobias-direktiv 2026-05-15: "PM-onboarding tar for lang tid fordi nye PM-er må lese alle handoffs siden 2026-04-23." Denne konsolideringen reduserer ~140KB onboardings-bytte ned til ~25KB.

**Konsoliderte filer:**
- `PM_HANDOFF_2026-04-23.md` — Fase 1 MVP-mapping (11/21 moduler ferdig)
- `PM_HANDOFF_2026-04-26.md` — Casino-grade review + wallet 2.vinn-hotfix
- `PM_HANDOFF_2026-05-01.md` — Pilot teknisk-bevist (13/13 smoke-test)
- `PM_HANDOFF_2026-05-02.md` — 29 PR-er + Teknobingo-pilot-haller seedet
- `PM_HANDOFF_2026-05-03.md` — Spill 2 Bølge 1 + Spill 3-revert tilbake til 5×5
- `PM_HANDOFF_2026-05-04.md` — Auto-draw cron + 10 feller dokumentert
- `PM_HANDOFF_2026-05-04_session2.md` — Spill 2/3 pilot-fullførsel + 14 feller
- `PM_HANDOFF_2026-05-05_session2.md` — Cleanup-runde + visual-harness
- `PM_HANDOFF_2026-05-05_spill2-3-pilot-ready.md` — Design-overhaul mockup-paritet

---

## Kronologisk oversikt (per dato)

### 2026-04-23 — Fase 1 MVP-mapping etablert

- **Master-mapping mot legacy** opprettet: `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md` + `WIREFRAME_CATALOG.md` (17 PDF-er, 65+ skjermer dokumentert)
- 11 av 21 Fase 1 MVP-moduler ferdig (PR #401-#411): GameManagement DailySchedule, Approve/Reject Player, Hall Number + Add Money, Report Management Game 1, Schedule 9 ticket-farger, Role Management 15×5-matrise, Agent-portal skjelett, TV Screen public display
- 9 arkitektur-beslutninger låst med Tobias: Agent-portal = route-tree i `apps/admin-web/`, TV-auth = hall-token i URL, ticket-colors = alle 9, Bot Game skippet, settlement = manuell for Metronia/OK Bingo/Franco/Otium, Role Management = full 15×5-matrise, Screen Saver på TV + terminaler
- Status: 10 Fase 1-moduler igjen (8 av dem i Agent-portal)

### 2026-04-26 — Casino-grade review + wallet 2.vinn-bug

- **Spill 1 + Wallet casino-grade-review** gjennomført (518 + 540 linjer): 7 CRITICAL pilot-blokkere identifisert
- **Wallet 2.-vinn-bug fikset på 4 timer** (PR #553): root-cause i bridge-dedup på (balance, drawIndex) — fjernet
- **K1-bølge merget** (PR #545-#552): Mystery v2 autospill, jackpott daglig akkumulering, settlement maskin-breakdown (1:1 wireframe), agent-portal wire-up
- **K2-bølge merget** (PR #550-#551): regulatorisk gameType + ledger + cap, atomicity assertNotScheduled + tx-fixes
- **Wallet Casino-Grade Redesign Linear-prosjekt** etablert (BIN-760→767): outbox, autoritativ wallet:state, REPEATABLE READ, nightly recon, hash-chain, multi-currency, idempotency-TTL
- Tobias-sitat: "Det er ekstremt viktig at dette alltid funker 100% av tiden — ekte penger og feil kan bli ekstremt kostbart. Vi må undersøke hvordan største casinoene håndterer lommebok."

### 2026-05-01 — Pilot teknisk-bevist (13/13 smoke-test grønn)

- **13-stegs E2E smoke-test framework** (PR #775, BIN-768) etablert
- **Pilot kjørt mot prod**: seed-script + smoke-test 13/13 grønn på `https://spillorama-system.onrender.com`
- **CSP/CORS strict + 7 security headers** (PR #781, BIN-776) + status-page (PR #782, BIN-791)
- **Lansering Q3 2026 Linear-prosjekt** etablert med 42 issues fordelt på 5 spor (Tekniske/Compliance/Operasjon/Marked/Forretning) og 3 milepæler (M1 pilot-stage / M2 multi-hall / M3 Evolution-grade)
- **Status:** Tekniske systemet er pilot-funksjonelt — venter på forretnings-arbeid (Lotteritilsynet, hardware, hall-kontrakter, support-team, Swedbank live-creds)

### 2026-05-02 — 29 PR-er + Teknobingo-pilot-haller live

- **29 PR-er merget på ~16 timer** (PR #799-#829): bug-bash → P0-blokkere → seed-fixes → UX-forbedringer → audit-rapporter
- **4 ekte Teknobingo-haller seedet i prod** med GoH `teknobingo-pilot-goh`: Årnes (master), Bodø, Brumunddal, Fauske
- **4 P0-blokkere fikset i bølge** (PR #807-#810): AGENT hall-scope (`assertUserHallScope`), statusBootstrap typo, **regulatorisk shift-flow** (`SETTLEMENT_REQUIRED_BEFORE_LOGOUT`), unique-ids SQL bind-fix
- **8 demo+pilot-test-haller soft-deletet** (is_active=false) for å rydde Live Operations
- **SID_TEKNOBINGO schedule** konfigurert med 3 daily-schedules (weekday 11-20, sat 11-16, sun 13-19) + 8 scheduled-games
- **14 QA-agenter dokumentert**: bug-finder (31 bugs), full pilot-day walkthrough (4 P0), 4 P0-fix-agenter, 8-stegs E2E etter fix, backend QA broad (37/39 verified), withdrawal-flyt-QA, wireframe-paritet (33 moduler — 22 ✅/6 🟡/5 ❌), pre-pilot final verify (🟢 GO)

### 2026-05-03 — Spill 2 Bølge 1 + Spill 3-revert tilbake til 5×5

- **10 PR-er merget** (PR #843-#852): 7 pilot-natt-fixes for Spill 1 + 3 Spill 2-PR-er
- **Spill 1 fundamentale fixes:**
  - PR #843 — Klar persisterer (REQ-007 stale-sweep default OFF) — Tobias-krav: aldri auto-revert
  - PR #845 — Én rom per group-of-halls: alle 4 Teknobingo-haller deler `BINGO_TEKNOBINGO-PILOT-GOH`
  - PR #847 — Master kan starte med ikke-klare haller (confirmUnreadyHalls UI-flow)
  - PR #848 — Boot-bootstrap rom per aktiv group-of-halls (Render-deploy wiper in-memory state)
- **Spill 2 Bølge 1 komplett:**
  - PR #850 — Jackpot-bar UI (6 slots: 9/10/11/12/13/14-21) per PDF 17 side 4
  - PR #851 — Choose Tickets-side med 32 forhåndsgenererte brett (3×3, 1-21)
  - PR #852 — Tickets skjult etter kjøp (revealed ved game-start)
- **Tobias-direktiv om Spill 3:** "Design til Spill 3 er identisk som Spill 1 bare da med andre bonger" → 5×5 uten free-center, 1-60 baller
- Status: Spill 3 ikke startet, ChooseTickets-pool ikke koblet til BingoEngine.startGame (v2-arbeid)

### 2026-05-04 — Auto-draw cron + Spill 3 5×5/75-revert

- **24 PR-er merget på 24 timer** (PR #873-#896)
- **Auto-draw cron for Spill 2/3** (PR #874): `AUTO_DRAW_INTERVAL_MS=3000` (senere 2000)
- **Spill 3-revert (PR #895)**: Tobias-direktiv 2026-05-03 endret Spill 3 fra T/X/7/Pyramide-mønstre tilbake til **5×5 uten free, 75 baller, ÉN ticket-type "Standard"** — "spillet om mønstre, men ellers identisk Spill 1"
- **Spill 3 frontend = Spill 1-klon** (PR #878): direkte import av Spill 1-komponenter (LobbyScreen/PlayScreen/EndScreen/BallTube/CenterBall)
- **10 feller dokumentert** for unngåelse av gjenta:
  1. drawIndex er 0-basert (bruk `drawnNumbers.length`)
  2. `wallet_accounts.balance` er GENERATED-kolonne (drop fra INSERT)
  3. Render-log API gir IKKE boot-stdout (bruk HTTP `/api/_dev/*` debug-endpoints)
  4. `room.isHallShared` undefined på legacy-rom (sjekk gameSlug i tillegg)
  5. `armedPlayerIds: []` clearing i PerpetualLoop (PR #894 ArmedPlayerLookup)
  6. SPECTATING-spillere har tickets i `preRoundTickets` (buildTickets-fallback)
  7. `AUTO_DRAW_INTERVAL_MS` default 30s (sett env-var)
  8. `demo-hall-001` finnes ikke alltid (auto-pick første aktive)
  9. Single-TX for resetTestPlayers (split TX1 critical + TX2 best-effort)
  10. Postgres-checkpoint persisterer stuck state (boot-sweep + spawnAfterEnd)

### 2026-05-04 (sesjon 2) — Spill 2/3 pilot-fullførsel

- **12 PR-er merget** (PR #899-#911)
- **Pengeflyt fungerer** (PR #899): entryFee=10, prizePool akkumulerer, ticketCount 1-30 respekteres, auto-mark synkronisert server+UI
- **Spill 3 mini-grids visuelt korrekt** (PR #900): T/X/7/Pyramide à 25% pattern-pills (før revert tilbake til standard 5-rad)
- **Room-uniqueness invariant** (PR #904): ETT rom per Spill 2/3 globalt, guard aktiv
- **Engine-arkitektur fixet** (PR #906): Game3Engine ⊂ Game2Engine ⊂ BingoEngine (flat hierarki brøt instanceof-sjekk)
- **Admin-konfigurerbar runde-pace** (PR #907): `roundPauseMs` + `ballIntervalMs` per Spill 2/3 uten env-var-deploy
- **Auto-draw host-fallback** (PR #911 — pilot-blokker fikset): Wi-Fi-blip/fane-refresh breaker IKKE rommet, per-tick fallback velger første tilgjengelige `players[0]?.id`
- **4 nye feller dokumentert** (#11-14):
  11. Engine instanceof feiler hvis hierarki er flat
  12. G2_NO_WINNER ikke i NATURAL_END_REASONS (PR #910)
  13. `SpilloramaApi.request` response-shape (json is not a function)
  14. hostPlayerId reassignes aldri etter disconnect (PR #911)
- Status: Spill 2/3 funksjonelt pilot-klare, venter Tobias' end-to-end-bekreftelse

### 2026-05-05 — Design-overhaul + cleanup-runde

**Sesjon 1 (Spill 2/3 mockup-paritet):**
- **15 PR-er merget** (PR #911-#926)
- **Hentet `Bong Mockup.html` fra Anthropic Design API**, parset CSS, portet til Pixi/HTML 1:1
- **PlayScreen for ALLE faser** (PR #923): LOBBY/PLAYING/SPECTATING/ENDED — bonger + Innsats synlig under countdown (Spill 1-paritet)
- **Game1BuyPopup (HTML) for Spill 2** (PR #926): identisk popup-design som Spill 3
- **ChooseTicketsScreen fjernet** (PR #921): én popup-flyt er endelig design (Tobias-direktiv)
- **Jackpot-priser bevart under countdown** (PR #925): skip "all-zero"-updates fra server

**Sesjon 2 (cleanup-runde):**
- **8 PR-er åpnet** (PR #928-#935): pilot-runbook Spill 2/3, Bølge A (8 døde filer, -998 linjer), @deprecated-bannere på 11 Game5-filer, visual-harness Spill 2/3 (8 nye scenarier), game4 cleanup, test-restoration (150→39 fails), Bølge B (ChooseTickets-stack -1211 linjer), Bølge G (fjern manuell ClaimButton Spill 1+3)
- **~2700 linjer død/dormant kode fjernet**
- **Backend test-fails: 150 → 39** (-111), game-client: 8 → 0
- **PM-dobbel-verifisering fanget 4 false positives** fra agent-rapport om "trygt slett" (ClaimDetector, DesignBall, PatternMiniGrid, TicketSorter) — alle hadde aktive prod-consumers
- **Tobias-direktiv etablert:** "Pilot-scope = Spill 1+2+3 alle pilot-klare. Kvalitet > hastighet. All død kode skal fjernes."
- **3 åpne funn dokumentert** (ikke pilot-blokkere): G3_FULL_HOUSE-regresjon, Lobby "Stengt" for perpetual-spill, klient mangler offline→online auto-recovery

---

## Kumulativ status ved 2026-05-05

### Tekniske leveranser totalt

| Område | Levert |
|---|---|
| **PR-er merget** | ~140 PR-er i perioden 2026-04-23 → 2026-05-05 |
| **Spill 1** | Pilot-klar — master/agent-flyt, Klar-status, GoH-rom, boot-bootstrap, Mystery/Wheel/Chest/ColorDraft mini-games |
| **Spill 2 (rocket)** | Pilot-klar — 3×3/21-ball, ETT globalt rom, perpetual loop, auto-draw 2s, jackpot-skala 9-21, Lucky Number, host-fallback |
| **Spill 3 (monsterbingo)** | Pilot-klar — 5×5 uten free-center / 75-ball / ÉN ticket-type "Standard", direkte Spill 1-import |
| **Agent-portal** | MVP komplett — Cash In/Out, Daily Balance, Settlement (14-rad maskin-breakdown), Unique ID, Register Tickets, Next Game, Check for Bingo, Physical Cashout, Shift Log Out |
| **Wallet** | Casino-grade — outbox, REPEATABLE READ, nightly recon, hash-chain (BIN-761→764 levert + 2.vinn-bug fix PR #553) |
| **Compliance** | §11 15%/30% korrekt per spill-kategori, §71 ledger-write komplett, single-prize cap håndhevet, hash-chain audit |
| **Sikkerhet** | CSP/CORS strict + 7 security headers, TOTP 2FA, phone+PIN-login, active sessions, trace-ID propagation |
| **Pilot-haller** | 4 Teknobingo-haller seedet (Årnes master + Bodø + Brumunddal + Fauske) i `teknobingo-pilot-goh` |
| **Test-infra** | 13-stegs E2E smoke-test, visual-harness for alle 3 spill, Playwright-bug-finder, pilot-runbook formalisert |
| **Status-page** | LIVE på `/status` med 10 komponenter + uptime + incidents |

### Aktive Tobias-direktiver fra perioden

Disse er fortsatt IMMUTABLE per 2026-05-15 (med mindre eksplisitt overstyrt senere):

1. **Casino-grade kvalitet — "ekte penger og feil kan bli ekstremt kostbart"** (2026-04-26): benchmark mot Pragmatic Play / Evolution / NetEnt
2. **PM-sentralisert git-flyt** (2026-04-21): Agenter pusher feature-branches, PM eier `gh pr create` + merge
3. **Done-policy** (2026-04-17): Issues lukkes kun ved commit merget til main + file:line + grønn test
4. **Spillkatalog** (korrigert 2026-04-25): Spill 1-3 = MAIN_GAME (15%), SpinnGo/game5 = DATABINGO (30%), Candy = ekstern. Game 4/themebingo deprecated (BIN-496)
5. **Skill-loading lazy** (2026-04-25): LOAD kun ved kode-redigering i den teknologien, SKIP for PM/orkestrering
6. **Browser-debug = chrome-devtools-mcp** (ikke computer-use)
7. **Spill 3-design = "identisk som Spill 1, bare med andre bonger"** (2026-05-03): 5×5 uten free, 75 baller, ÉN ticket-type — IKKE 3×3 eller T/X/7/Pyramide
8. **Pilot-scope = Spill 1+2+3 alle pilot-klare** (2026-05-05): Overstyrer "Spill 1 only" fra master-rolle-modellen
9. **Kvalitet > hastighet** (2026-05-05): Ingen deadline, fundamentet skal være solid
10. **All død kode skal fjernes** (2026-05-05): Klare moduler, tydelig hensikt
11. **ChooseTickets-stack helt slettet** (2026-05-05): Én popup-flyt er endelig design
12. **Spill 1 ClaimButton fjernet** (2026-05-05): Auto-claim er endelig
13. **SpinnGo (game5) skal BEHOLDES** for post-pilot implementasjon (2026-05-05)
14. **"Aldri auto-revert" på Klar-flagg** (2026-05-03): REQ-007 stale-sweep default OFF
15. **Master-rolle-modellen** (2026-05-?): Master = bingovert med mer ansvar, ikke egen rolle. Route-guard på `hallId`, ikke `user.role`. transferHallAccess 60s handshake.

### Beslutninger som er Superseded eller endret

| Beslutning | Status | Erstattet av |
|---|---|---|
| 2026-04-26: "Spill 1 only for pilot" | ❌ Superseded | 2026-05-05: Pilot-scope = Spill 1+2+3 alle |
| 2026-05-04: Spill 3 = T/X/7/Pyramide (PR #895) | ❌ Revertert | Tobias-direktiv 2026-05-03 → 5×5/75/standard (PR #895 backend revert + PR #878 frontend) |
| 2026-05-03: ChooseTicketsScreen for Spill 2 | ❌ Superseded | PR #921 (2026-05-05) — én popup-flyt |
| 2026-05-04: `AUTO_DRAW_INTERVAL_MS=3000` | 🔄 Endret | 2026-05-04 sesjon 2: `2000` |
| 2026-05-04: `RESET_TEST_PLAYERS=true` env-var | ✅ Fjernet | 2026-05-04 sesjon 2: scriptet kjører ikke lenger ved boot |

### Åpne tasks ved 2026-05-05 (status nå)

| Task fra siste handoff | Status per 2026-05-14 (per PM_HANDOFF_2026-05-14) |
|---|---|
| Spill 1+2+3 pilot-readiness sluttverifisering | ⏳ Pilot-flow-test framework etablert (`npm run test:pilot-flow`), 13s deterministic. Sentry + PostHog overvåking nå obligatorisk. |
| G3_FULL_HOUSE-regresjon (open finding §3.1) | 🔄 Migrert til Spill 3 phase-state-machine R10 (BIN-820, ennå ikke merget per 2026-05-09). Sequential Rad 1→2→3→4→Fullt Hus erstatter T/X/7/Pyramide-modellen helt. |
| Lobby "Stengt" for perpetual-spill (§3.2) | ✅ Lukket (lobby-rom åpningstid følger spilleplan, BIN-822) |
| Klient auto-recovery offline→online (§3.3) | ✅ Lukket (R3 reconnect-test PASSED 2026-05-08) |
| Merge 8 cleanup-PR-er (#928-#935) | ✅ Alle merget |
| `RESET_TEST_PLAYERS_TOKEN`-env-var cleanup ved pilot-cutover | ⏳ Fortsatt aktiv (debug-endpoints i prod) |
| SpinnGo (game5) post-pilot-implementasjon | ⏳ Beholdt for post-pilot |
| Wallet Fase 2-hardening BIN-760-763 | ✅ Levert (outbox, REPEATABLE READ, nightly recon, hash-chain) |
| Hardware-bestilling (BIN-787) + Lotteritilsynet (BIN-780) + Swedbank live (BIN-802) | ⏳ Tobias-eier-tasks, ikke pilot-blokkere på kode-siden |
| Pen-test (BIN-775) + anti-fraud (BIN-806) + WCAG (BIN-807) | ⏳ M2-tasks, post-pilot |

---

## Anti-mønstre lært i perioden

Disse er senere konsolidert til `docs/engineering/PITFALLS_LOG.md`. Sentrale poeng:

### Tekniske feller (alle fortsatt aktive — se PITFALLS_LOG §-er)

1. **drawIndex er 0-basert** — bruk `drawnNumbers.length` for "antall trukne baller" (§3.x Spill-arkitektur)
2. **`wallet_accounts.balance` er GENERATED-kolonne** — drop fra INSERT, sett kun `deposit_balance` + `winnings_balance` (§2.x Wallet)
3. **Render-log API gir IKKE boot-stdout** — bruk HTTP `/api/_dev/*` debug-endpoints (§6.x Test-infra)
4. **`room.isHallShared` undefined på legacy-rom** — defense-in-depth via gameSlug-sjekk (§3.x)
5. **`armedPlayerIds: []` clearing i PerpetualLoop** — bruk `ArmedPlayerLookup` (§3.x)
6. **SPECTATING-spillere har tickets i `preRoundTickets`** — buildTickets-fallback (§7.x Frontend)
7. **`AUTO_DRAW_INTERVAL_MS` default 30s** — sett env-var eksplisitt (§9.x Env)
8. **`demo-hall-001` finnes ikke alltid** — auto-pick første aktive hall (§11.x Agent-orkestrering)
9. **Single-TX for kritisk + best-effort** — split TX1 (critical-success) + TX2 (cleanup) (§2.x Wallet)
10. **Postgres-checkpoint persisterer stuck state** — boot-sweep + spawnAfterEnd-callback (§4.x Live-rom)
11. **Engine instanceof feiler hvis hierarki er flat** — Game3Engine MÅ extends Game2Engine (§3.x Spill-arkitektur)
12. **NATURAL_END_REASONS må inkludere alle reasons** — G2_NO_WINNER, G2_WINNER, G3_FULL_HOUSE, MAX_DRAWS_REACHED, DRAW_BAG_EMPTY (§4.x)
13. **SpilloramaApi response-shape (json is not a function)** — wrap unwrapped data i `{ ok, data }` (§7.x)
14. **hostPlayerId reassignes aldri etter disconnect** — per-tick fallback via `players[0]?.id` (§4.x)
15. **drawNew gap-loop ved late-join** — `applySnapshot` FØR `bridge.start()` (§7.x)
16. **`app_games.is_enabled=false` blokkerer ikke perpetual-loop** — todelt rollback: lobby-skjul + `PERPETUAL_LOOP_DISABLED_SLUGS` env-var (§4.x)

### Prosess-feller

17. **Agent-rapporter har false positives på consumer-spor** (4 av 12 påståtte "trygt slett" var aktive prod-consumere) — ALLTID dobbel-verifiser med `rg "import.*X|from.*X|new X("` (§11.x Agent-orkestrering)
18. **Agent-worktree mangler `npm install`** — `tsc: command not found` er ikke ekte type-feil. Fetch branch + `npm install --include=dev` først (§11.x)
19. **Game3 deler PlayScreen.ts med Game1** — endring i `game1/screens/PlayScreen.ts` påvirker BÅDE Spill 1 OG Spill 3 (`game3/Game3Controller.ts:7` importerer den) (§7.x Frontend)
20. **Stream idle timeout etter ~38 min** for bakgrunns-agent — lokal commit-historie i worktree bevart, push manuelt fra worktree-stien (§11.x)
21. **For mange parallelle agenter brente token-budget** — maks 3-4 fokuserte agenter samtidig (anti-pattern observert 2026-04-30) (§11.x)
22. **"Done" uten merge til main = ikke done** — Done-policy vedtatt 2026-04-17 (§5.x Git)
23. **Worktree-baserte agenter inheriter parent-branch** — hvis spawnet fra feature-branch (ikke main), inkluderer worktreen den branch-en (§11.x)
24. **Local DB er ikke en god verifikasjon** — schema-arkeologi-issues finnes lokalt men ikke i prod. Bruk staging eller prod-DB (§6.x)
25. **For mange parallelle agenter brente Anthropic rate-limit** — ~25-30 agent-spawns i én sesjon → "Server is temporarily limiting requests" (§11.x)

---

## Referanser

- `docs/operations/archive/` — original-handoffs (alle 9 filer)
- `docs/engineering/PITFALLS_LOG.md` — fallgruver konsolidert med fil:linje + fix-strategi
- `docs/engineering/AGENT_EXECUTION_LOG.md` — kronologisk agent-leveranser
- `docs/architecture/SPILLKATALOG.md` — autoritativ spill-katalog
- `docs/architecture/SPILL[1-3]_IMPLEMENTATION_STATUS_2026-05-08.md` — fundament-doc per spill
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` — R1-R12 pilot-mandat
- `docs/operations/PM_HANDOFF_2026-05-07.md` og senere — handoffs etter denne perioden
- `docs/engineering/PM_ONBOARDING_PLAYBOOK.md` — autoritativ PM-onboarding (60-90 min)

---

**Slutt-status ved 2026-05-05:** Spill 1+2+3 alle pilot-klare i kjernefunksjonalitet. Casino-grade wallet levert. 4 Teknobingo-haller seedet. Test-infra etablert. Pilot-runbook formalisert. Tobias-direktiv "kvalitet > hastighet" håndheves. Venter på forretnings-arbeid (Lotteritilsynet, hardware, hall-kontrakter, support) før første ekte spiller.
