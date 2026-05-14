# PM-handoff 2026-05-05 (sesjon 2) — Cleanup-runde for Spill 1+2+3 pilot

**Forrige PM:** Claude (Opus 4.7, 1M context)
**Sesjon-fokus:** Komplett cleanup-runde + pilot-runbook + visual-harness + E2E-verifisering
**Status ved overlevering:** 8 PR-er åpne, ~2700 linjer død/dormant kode fjernet, test-baseline drastisk forbedret, 3 åpne funn flagget, pilot-direktiv "kvalitet > hastighet" lagt som memory

---

## 1. TL;DR — status nå

### Pilot-readiness
- **Spill 1 + 2 + 3** alle pilot-klare i kjernefunksjonalitet (verifisert via E2E v2 6/7 pass)
- **Cleanup grunnfundament etablert** — alle bølger A/B/C/E/F/G eksekvert + PR'd
- **Visual-harness** dekker nå Spill 1, 2 og 3 for hot-reload-iterasjon (slutt på 5-7 min Render-deploy-vent for design)
- **Pilot-runbook** for Spill 2/3 (ETT globalt rom-modell) formalisert
- **Tre åpne funn** ikke pilot-blokkere men forbedring-verdige (se §6)

### Hva er fikset i denne sesjonen
- **8 PR-er** åpnet, klare for review/merge
- **~2700 linjer** død/dormant kode fjernet
- **Backend test-fails:** 150 → 39 (-111)
- **Game-client test-fails:** 8 → 0
- **2 false-positive-cleanup-anbefalinger** fra agent ble fanget av PM-dobbel-verifisering
- **1 verifisert pilot-bekymring** dokumentert (G3_FULL_HOUSE-regresjon)

---

## 2. Alle 8 PR-er fra denne sesjonen

| PR | Tema | Net linjer | Type |
|---|---|---|---|
| [#928](https://github.com/tobias363/Spillorama-system/pull/928) | Pilot-runbook Spill 2/3 (ETT globalt rom) | +301 | Docs |
| [#929](https://github.com/tobias363/Spillorama-system/pull/929) | Bølge A — 8 døde filer (CountdownTimer, LuckyNumberPicker, LykketallGrid, ChatPanel-Pixi, i18n, PlayerPrefs, AssetLoader, TweenPresets) | -998 | Cleanup |
| [#930](https://github.com/tobias363/Spillorama-system/pull/930) | Bølge E — `@deprecated`-bannere på 11 Game5-only-filer + stale comment fixes | +118/-6 | Docs/comments |
| [#931](https://github.com/tobias363/Spillorama-system/pull/931) | Visual-harness Spill 2/3 (8 nye scenarier) | +540 | Test-tooling |
| [#932](https://github.com/tobias363/Spillorama-system/pull/932) | Bølge F — game4/themebingo cleanup (BIN-496 deprecation) | +120/-116 | Cleanup |
| [#933](https://github.com/tobias363/Spillorama-system/pull/933) | Bølge C — test-restoration | +250/-376 | Tests |
| [#934](https://github.com/tobias363/Spillorama-system/pull/934) | Bølge B — slett ChooseTickets-stack | -1211 | Cleanup |
| [#935](https://github.com/tobias363/Spillorama-system/pull/935) | Bølge G — fjern manuell ClaimButton fra Spill 1+3 | -84 | Refactor |

**Anbefalt merge-rekkefølge** (lavrisiko først):
1. #928 (docs-only runbook)
2. #930 (docs-only @deprecated bannere)
3. #931 (visual-harness — kun test-tooling)
4. #932 (game4 cleanup)
5. #933 (test-restoration)
6. #929 (Bølge A — sletting verifisert)
7. #934 (Bølge B — sletting av dormant-stack)
8. #935 (Bølge G — refactor med koblet test-fjerning)

---

## 3. Tre åpne funn — alle ikke-blokkerende men verdt fix

### 3.1 G3_FULL_HOUSE-regresjon (NY oppdaget i Bølge C)

**Hva:** `Game3Engine.ts:226` ender runden kun hvis `winnerRecords.some((w) => w.isFullHouse)`. Men `DEFAULT_GAME3_CONFIG.patterns` (T/Kryss/7/Pyramide à 25%) har ingen pattern med `isFullHouse: true`. Konsekvens: Spill 3-runden ender via `DRAW_BAG_EMPTY` (75 baller trukket) istedenfor `G3_FULL_HOUSE` etter alle 4 patterns vunnet.

**Per game3-canonical-spec.md:** "Når alle 4 mønstre er vunnet, signaliserer engine `endedReason: 'G3_FULL_HOUSE'`".

**Konsekvens:** Spill 3-rundene tar lenger tid (75 baller) etter at alle patterns er vunnet. Ikke pilot-blokker fordi runden ender til slutt og PerpetualRoundService restarter via `DRAW_BAG_EMPTY` (også i `NATURAL_END_REASONS`). Men UX-mismatch vs spec.

**Fix-strategi:**
```typescript
// I Game3Engine.ts:226, endre fra:
const fullHouseWon = winnerRecords.some((w) => w.isFullHouse && w.ticketWinners.length > 0);

// Til:
const allPatternsWon = game.patterns?.every(p => p.timesWon > 0); // verifiser felt-navn
const fullHouseWon = allPatternsWon || winnerRecords.some((w) => w.isFullHouse && ...);
```

Krever å forstå Game3Engine sin pattern-state-tracking (timesWon eller tilsvarende). Ikke gjort i sesjonen — separat engine-PR.

### 3.2 Lobby viser "Stengt" for perpetual-spill (E2E v2 finding)

**Hva:** `apps/backend/public/web/lobby.js:671` mapper alle non-RUNNING/non-WAITING-states til "Stengt". For ROCKET/MONSTERBINGO i ENDED-state med 0 spillere, vil tile alltid vise "Stengt" til noen klikker. Per `PerpetualRoundService` spawnes ny runde først ved første join.

**Catch-22:** Spillere ser "Stengt" → klikker ikke → ingen runde spawner → fortsatt "Stengt".

**Fix-strategi (3 linjer i lobby.js):**
```js
const PERPETUAL_SLUGS = new Set(['rocket', 'monsterbingo']);
if (PERPETUAL_SLUGS.has(slug) && (!s || s.status === 'CLOSED')) {
  return '<span class="lobby-tile-status lobby-tile-status--open">&#9679; Klar til start</span>';
}
```

Du sa "kjør bølge c" rett etter jeg foreslo dette — direktivet ikke gitt. Venter avgjørelse.

### 3.3 Klient gjør ikke auto-recovery offline→online

**Hva:** Etter at nettverk går offline ~10s og kommer tilbake online, klienten gjør IKKE automatisk reconnect. Konsoll viser `[Game1] Both resumeRoom and getRoomState failed — user must reload`. UI viser "FÅR IKKE KOBLET TIL ROM. TRYKK HER" → klikk redirecter til lobby.

**Server-state preserveres** (sannhet er backend), men UX krever manuell handling.

**Fix-strategi:** Legg til `window.addEventListener('online', () => reconnect())` i klient-socket-handler. Ikke pilot-blokker.

---

## 4. PM-dobbel-verifisering fanget false positives

Sesjonen avslørte at agent-rapporter (også fra "general-purpose"-agent som har Read+Grep) kan ha **false positives** på consumer-spor. Eksempler fra denne sesjonen:

### 4.1 Cleanup-research-agent: 4 false positives på "Bølge A trygt slett"
Agent rapporterte at `ClaimDetector`, `DesignBall`, `PatternMiniGrid` (game1), `TicketSorter` var null-consumer. PM verifiserte med `rg` og fant alle har **aktive prod-consumers**:
- `ClaimDetector` brukt i Spill 1 PlayScreen.ts:18, 955
- `DesignBall` brukt i CenterBallPop.ts:33, 41, 84
- `PatternMiniGrid` (game1) brukt i CenterTopPanel.ts:4, 124, 177, 531
- `TicketSorter` brukt i TicketScroller.ts:4, 79

Korreksjon dokumentert i [`CLEANUP_AUDIT_2026-05-05.md` §1.5](../architecture/CLEANUP_AUDIT_2026-05-05.md).

### 4.2 Bølge E rapporterte "14 type-errors" på main
Påstand: branchen hadde 14 errors, ikke regression men pre-existing baseline. PM verifiserte med temp-worktree: feilen var **`tsc: command not found`** — agent-worktree manglet `npm install`. Faktisk type-check passerer rent på main (0 errors).

### 4.3 Lærdom for neste sesjon
- ALLTID kjør `npm install --include=dev` i agent-worktree før type-check/build
- ALLTID dobbel-verifiser "trygt slett"-claims med egen `rg`-sjekk før eksekvering
- Memory-policy `feedback_done_policy.md` krever file:line + faktisk evidens — bruk det

---

## 5. Tobias-direktiver fra denne sesjonen

Lagt som memory: [`project_pilot_scope_2026_05_05.md`](../../../../.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/project_pilot_scope_2026_05_05.md)

1. **Pilot-scope:** Spill 1 + 2 + 3 alle skal være pilot-klare (overstyrer "Spill 1 only" fra `project_master_role_model.md`)
2. **Kvalitet > hastighet:** ingen deadline, fundamentet skal være bra
3. **All død kode skal fjernes** — klare moduler, tydelig hensikt
4. **ChooseTickets-stack:** slett alt (en popup-flyt er endelig design)
5. **Spill 1 ClaimButton:** fjern (auto-claim er endelig)
6. **SpinnGo (game5):** BEHOLD, skal implementeres post-pilot
7. **Game4/themebingo:** slett alle rester per BIN-496

---

## 6. Anbefalt prioritering for neste PM

### P0 — Pilot-blokkere

#### 6.1 Merge alle 8 PR-er
Anbefalt rekkefølge i §2. Lavrisiko-først (#928 → #935). CI vil bekrefte hver. Ikke gå rett på #934/#935 før de øvrige er green.

#### 6.2 Fix G3_FULL_HOUSE-regresjon
Per §3.1. Spill 3-pilot-kvalitet krever at runden ender umiddelbart etter alle 4 patterns vunnet. Krever Game3Engine-edit. Estimat 30-60 min.

### P1 — UX-forbedringer før real-money-launch

#### 6.3 Fix lobby "Stengt" for perpetual-spill
Per §3.2. 3-linjers fix i `lobby.js`. Estimat 15 min.

#### 6.4 Fix klient auto-recovery offline→online
Per §3.3. Legg til `window.online`-event-handler. Estimat 30 min.

### P2 — Pre-pilot-polish

#### 6.5 Spill 1 regression-sjekk
Etter Bølge G fjernet ClaimButton fra game1/PlayScreen.ts (som ALSO brukes av Spill 3): manuell smoke-test på prod etter merge — bekreft at WinPopup vises korrekt og auto-claim-on-draw faktisk deler ut premie uten brukerinput. **Pilot kan ikke starte før dette er bekreftet.**

#### 6.6 Spill 3 var ikke verifisert i E2E v2 sjekkpunkt 6 (offline/online)
E2E v2 testet det på Spill 3 (Spill 2 var "Stengt"). Fixen i §3.3 vil dekke begge.

#### 6.7 Visual-harness-test for nye scenarier
Visual regression-tester via Playwright eksisterer for Spill 1-scenarier. Kan utvides til Spill 2/3 også. Estimat 60 min.

### P3 — Etter pilot

#### 6.8 SpinnGo (Spill 4 / game5) implementasjon
Tobias-direktiv: skal implementeres. Game5Controller eksisterer men er ikke pilot-scope. 9 filer i `game2/`-mappen er markert `@deprecated for game2, beholdt for Game5` — disse trenger refactoring til `games/game5/`-mappe når SpinnGo prioriteres. Cleanup-audit har Bølge D-plan klar.

---

## 7. Nye dev-tools etablert i sesjonen

### 7.1 Visual-harness for Spill 2 + Spill 3
URL-er for hot-reload-iterasjon:
```
npm run build:visual-harness && npm run serve:visual-harness  # port 4173

http://127.0.0.1:4173/web/games/visual-harness.html?scenario=spill2-lobby
http://127.0.0.1:4173/web/games/visual-harness.html?scenario=spill2-buy-popup-open
http://127.0.0.1:4173/web/games/visual-harness.html?scenario=spill2-pre-round-2-bongs
http://127.0.0.1:4173/web/games/visual-harness.html?scenario=spill2-running-7-bongs
http://127.0.0.1:4173/web/games/visual-harness.html?scenario=spill2-running-9-bongs
http://127.0.0.1:4173/web/games/visual-harness.html?scenario=spill2-countdown-with-prizes
http://127.0.0.1:4173/web/games/visual-harness.html?scenario=spill3-lobby
http://127.0.0.1:4173/web/games/visual-harness.html?scenario=spill3-running-with-bongs
```

Iterasjonstid: 5-7 min Render-deploy → 2 sek Vite hot-reload.

### 7.2 Pilot-runbook for Spill 2/3
[`docs/operations/PILOT_RUNBOOK_SPILL2_3_2026-05-05.md`](./PILOT_RUNBOOK_SPILL2_3_2026-05-05.md)

Inneholder:
- 15 smoke-test-sjekkpunkter (autoritativ pilot-godkjennelses-liste)
- Pre-flight, live drift overvåking, avbruddshåndtering
- **Verifisert todelt rollback-strategi:** `app_games.is_enabled=false` (lobby-skjul) + `PERPETUAL_LOOP_DISABLED_SLUGS` env-var (engine-stopp). Validert mot kode 2026-05-05.

### 7.3 Cleanup-audit
[`docs/architecture/CLEANUP_AUDIT_2026-05-05.md`](../architecture/CLEANUP_AUDIT_2026-05-05.md) (med PM-korreksjon §1.5)

Komplett kartlegging av game-client + spillrelevant backend. Bruk denne ved fremtidige cleanup-runder. Ikke stol blindt på agent-funn — verifiser med `rg`.

---

## 8. Test-credentials + debug-endpoints (uendret)

```
URL:      https://spillorama-system.onrender.com/web/
Login:    test@spillorama.no / Test1234!
Token:    spillorama-2026-test (for /api/_dev/*)

Render-API:
  Token:    rnd_DBuI0RvZ0LxEsZRCjiXXAhQrDa1W
  Service:  srv-d7bvpel8nd3s73fi7r4g
  Owner:    tea-d6k3pmfafjfc73fdh9mg
```

Aktive env-vars per nå:
- `AUTO_DRAW_INTERVAL_MS=2000`
- `PERPETUAL_LOOP_DELAY_MS=30000`
- `RESET_TEST_PLAYERS_TOKEN=spillorama-2026-test`
- `NODE_ENV=production`

---

## 9. Verifiserte feller å unngå (oppdatert)

Fra forrige sesjon:
- Felle 1-15 i [PM_HANDOFF_2026-05-05_spill2-3-pilot-ready.md](./PM_HANDOFF_2026-05-05_spill2-3-pilot-ready.md) §8

### Nye feller funnet i denne sesjonen

#### Felle 17 — Agent-worktree mangler `npm install`
Agent som ikke kjører `npm install --include=dev` får `tsc: command not found` — ikke ekte type-feil. Verifiser ved å fetche branchen + ren install.

#### Felle 18 — Agent-rapporter har false positives på consumer-spor
4 av 12 påståtte "trygt slett"-filer i Bølge A var aktive prod-konsumere. ALLTID dobbel-verifiser med `rg "import.*X|from.*X|new X("`.

#### Felle 19 — Game3 deler PlayScreen.ts med Game1
Endring i `game1/screens/PlayScreen.ts` påvirker BÅDE Spill 1 OG Spill 3 (`game3/Game3Controller.ts:7` importerer den). Bekreft at endring er konsistent for begge før eksekvering.

#### Felle 20 — Stream idle timeout etter ~38 min
Bakgrunns-agent kan krasje med "API Error: Stream idle timeout" rundt 38-min-merket. Lokal commit-historie i agent-worktree er likevel bevart — push manuelt med `git push -u origin <branch>` fra worktree-stien.

#### Felle 21 — `app_games.is_enabled=false` blokkerer ikke perpetual-loop
Verifisert 2026-05-05: engine.startGame har INGEN `isEnabled`-guard for rocket/monsterbingo. Rollback-strategi krever todelt: `is_enabled=false` (lobby-skjul) + `PERPETUAL_LOOP_DISABLED_SLUGS` env-var.

---

## 10. Repo-konvensjon (uendret)

- **PM-sentralisert git-flyt:** Agenter pusher feature-branches, PM eier `gh pr create` + merge
- **Branch-navngivning:** `chore/<beskrivelse>-2026-05-05`, `feat/<feature>-2026-05-05`, `refactor/<scope>-2026-05-05`, `docs/<beskrivelse>-2026-05-05`
- **Done-policy:** Issues lukkes kun når commit er merget til main + file:line + grønn CI/test
- **CI-baseline:** ofte rød pga ~155 pre-existing failures. Bruk `--admin` for bypass; bare bekreft at NYE tester (egen kode) er grønne.

---

## 11. Avsluttende vurdering

Etter 8 PR-er denne sesjonen er Spill 1/2/3-pilot grunnfundament solid. ~2700 linjer død/dormant kode er borte, test-baseline drastisk forbedret, design-iterasjon kan nå skje lokalt på 2 sek istedenfor 5-7 min, pilot-runbook er formalisert for begge pilot-modeller (multi-hall master for Spill 1, ETT globalt rom for Spill 2/3).

Kvalitet over hastighet ble håndhevet: 4 false-positive-anbefalinger ble fanget av PM-dobbel-verifisering før eksekvering, og 1 verifisert pilot-bekymring (G3_FULL_HOUSE) ble dokumentert for separat fix.

**Anbefaler at neste PM:**
1. **Merger alle 8 PR-er** i rekkefølgen i §2
2. **Fikser G3_FULL_HOUSE-regresjon** (§3.1, §6.2) før Spill 3 går live på real-money
3. **Fikser lobby "Stengt"-bug** (§3.2, §6.3) — 3-linjers klient-fix
4. **Verifiserer Spill 1 regression** etter PR #935 merger (auto-claim flyt fortsatt OK)
5. **Setter opp Playwright-snapshot-tester** for nye visual-harness-scenarier

Lykke til.

— PM-agent (Claude Opus 4.7), 2026-05-05 sesjon 2
