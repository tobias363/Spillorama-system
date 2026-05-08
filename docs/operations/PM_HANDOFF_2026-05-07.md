# PM-handoff 2026-05-07: Spilleplan-redesign + Pilot-fixes

**Forrige PM-handoff:** [docs/operations/PM_HANDOFF_2026-04-26.md](./PM_HANDOFF_2026-04-26.md)
**Sist oppdatert:** 2026-05-07 av Claude (forrige PM-AI) i samarbeid med Tobias Haugen
**Branch / commit på main:** `8076cc6f` (PR #990 — special-editors siste merge)

---

## Tl;dr — Sesjonens deliverables

**22 PR-er merget på én sesjon (#974-#990).** Tre store oppgaver levert:

1. **Pilot-fixes** (PR #974-#979): Spill 2 jackpot-redesign + bottom panel + reschedule-endpoint + Start-knapp UX-fix + system-account-API-key + 75 callsites object-form-migrasjon
2. **Spilleplan-redesign Fase 1-4** (PR #980-#986): Komplett refaktor fra 9 schedule-tabeller → 4. Inkludert engine-bridge, data-migrasjon, deprecation-plan, og 2 hotfixes etter code-review
3. **Spilleplan UX-utvidelser** (PR #987-#990): Sidebar-cleanup, per-item bonus-override (Tolkning A), auto-multiplikator (1x/2x/3x), special-editors for Trafikklys + Oddsen

**Live i prod nå:**
- Backend: commit `8076cc6f` med ny spilleplan-modell + alle hotfixes
- 13 katalog-spill opprettet via API (9 standard + 1 generic bingo + 3 Oddsen-varianter + 1 Trafikklys-spesial)
- 4 bonus-spill-valg (Lykkehjul/Fargekladd/Skattekiste/Mystery Joker) — kun via per-item override
- Feature flag `ff:useNewGamePlan` aktivert i Tobias' Chrome
- ADMIN-bruker: `tobias@nordicprofil.no`

**Kritisk gjenstår (1 oppfølger-PR):**
- ⚠️ **Engine-bridge må forstå `gameVariant=oddsen` + `gameVariant=trafikklys`** før feature-flag-aktivering for ekte spill-kjøring. I dag bruker engine-bridge fallback-premier for spesialspill — ikke korrekt for Trafikklys (rad-farge) eller Oddsen (target-draw). Detaljer i seksjon "Hva gjenstår".

---

## 🎯 Hovedleveranse: Spilleplan-redesign

### Problem (før denne sesjonen)

Schedule-flyten hadde **9 tabeller** og krevde **5+ admin-skjermer** for å lage én spilleplan. Tobias' kommentar: *"unødvendig mye som skal til for at man skal kunne opprette en spilleplan slik som det er nå."*

Tabellene som var i bruk:
- `app_schedules` (templates)
- `app_daily_schedules` (instanser)
- `app_game1_scheduled_games` (runtime)
- `app_game_management` (game-config)
- `app_game_types` (typer)
- `app_sub_games` (sub-spill-instances)
- `hall_game_schedules` (hall-binding)
- `hall_schedule_log` (audit)
- `app_spill1_prize_defaults` (premier)

### Løsning: Ny katalog + plan-modell (4 tabeller)

```
app_game_catalog       — Spillkatalog (hovedspill, definert én gang)
app_game_plan          — Spilleplan-template (binding til hall + ukedag + tider)
app_game_plan_item     — Sekvens-rader (drag-and-drop fra katalog)
app_game_plan_run      — Runtime-state (current_position + status + jackpot-overrides)
```

### Datamodell-detaljer

#### `app_game_catalog`

```sql
id, slug, display_name, description,
rules_json,                         -- spill-spesifikke regler (gameVariant, targetDraw, rowColors osv.)
ticket_colors_json,                 -- ["hvit","gul","lilla"]
ticket_prices_cents_json,           -- {"hvit":500,"gul":1000,"lilla":1500}
prizes_cents_json,                  -- { rad1, rad2, rad3, rad4, bingoBase | bingo: { hvit, gul, lilla } }
bonus_game_slug,                    -- katalog-default (kan overstyres per item)
bonus_game_enabled,
requires_jackpot_setup,
prize_multiplier_mode,              -- "auto" (default) | "explicit_per_color"
is_active, sort_order, created_at, updated_at
```

**Viktige varianter:**
- `prize_multiplier_mode = "auto"` (default for standard-spill): én `prizesCents.bingoBase` (gjelder 5 kr-bong). Backend skalerer: `actualPrize = bingoBase × (ticketPriceCents / 500)`
- `prize_multiplier_mode = "explicit_per_color"` (Trafikklys): per-farge eksplisitt
- `rules.gameVariant`: "standard" (default) | "trafikklys" | "oddsen"

#### `app_game_plan_item`

```sql
id, plan_id, position, game_catalog_id,
bonus_game_override,                -- NULL = bruk catalog-default; ellers override per posisjon
notes, created_at
UNIQUE(plan_id, position)
```

**Forrang ved engine:** `plan_item.bonus_game_override ≠ null` → override; ellers `catalog.bonus_game_slug`. Hvis `catalog.bonus_game_enabled = false` → ingen bonus uansett.

#### `app_game_plan_run`

```sql
id, plan_id, hall_id, business_date,
current_position, status,           -- 'idle' | 'running' | 'paused' | 'finished'
jackpot_overrides_json,             -- per posisjon: { draw, prizesCents }
started_at, finished_at, master_user_id
UNIQUE(hall_id, business_date)
```

---

## 🎨 Spillkatalog (live i prod)

13 hovedspill, alle med konsistente priser **hvit 5 / gul 10 / lilla 15 kr** (untatt Trafikklys 15/15/15):

| Slug | Navn | Variant | Bingo (5 kr-base) | Jackpot-popup | Mode |
|---|---|---|---|---|---|
| `bingo` | Bingo | standard | 1000 | — | auto |
| `1000-spill` | 1000-spill | standard | 1000 | — | auto |
| `5x500` | 5x500 | standard | 500 | — | auto |
| `ball-x-10` | Ball x 10 | standard | varierer | — | auto |
| `bokstav` | Bokstav | standard | varierer | — | auto |
| `innsatsen` | Innsatsen | standard | 500-2000 | — | auto |
| `jackpot` | Jackpot | standard | master setter i popup | ✅ ja | auto |
| `kvikkis` | Kvikkis | standard | 1000 | — | auto |
| `oddsen-55` | Oddsen 55 | **oddsen** | low 500 / high 1500 | — | auto + rules |
| `oddsen-56` | Oddsen 56 | **oddsen** | low 500 / high 1500 | — | auto + rules |
| `oddsen-57` | Oddsen 57 | **oddsen** | low 500 / high 1500 | — | auto + rules |
| `trafikklys` | Trafikklys | **trafikklys** | per rad-farge | — | **explicit_per_color** |
| `tv-extra` | TV-Extra | standard | 3000 | — | auto |

**Deaktiverte (ikke hovedspill — er bonus-mini-spill):**
- Lykkehjulet
- Fargekladden
- Skattekisten
- Elvis (forkastet av Tobias)

---

## 🎁 Bonus-spill (per-item override)

4 bonus-mini-spill kan velges per spilleplan-posisjon (ikke i katalog):
- `wheel_of_fortune` — Lykkehjul
- `color_draft` — Fargekladd
- `treasure_chest` — Skattekiste
- `mystery` — Mystery Joker

Aktiveres ved fullt hus i hovedspillet. Frontend-display-navn defineres i `BONUS_GAME_DISPLAY_NAMES` (`apps/admin-web/src/api/admin-game-plans.ts`).

**Mekanikk:**
1. I katalog-editor: `bonus_game_slug` (default for spillet)
2. I spilleplan-builder: per-item dropdown overstyrer default
3. Engine-bridge bruker forrang: `plan_item.bonus_game_override` > `catalog.bonus_game_slug` > ingen
4. Hvis `catalog.bonus_game_enabled = false` → ingen bonus uansett (off-switch)

---

## ⚡ Spesialspill: Trafikklys + Oddsen

### Trafikklys

**Mekanikk:**
- Én flat pris (15 kr) på alle bonger
- Premier avhenger av RAD-FARGE (rød/grønn/gul), ikke bongfarge
- Master/system trekker rad-farge ved spill-start

**Datamodell (`rules`):**
```json
{
  "gameVariant": "trafikklys",
  "ticketPriceCents": 1500,
  "rowColors": ["grønn", "gul", "rød"],
  "prizesPerRowColor": { "grønn": 10000, "gul": 15000, "rød": 5000 },
  "bingoPerRowColor": { "grønn": 100000, "gul": 150000, "rød": 50000 }
}
```

**Premier i kr:**
- Rad: rød 50, grønn 100, gul 150
- Bingo: rød 500, grønn 1000, gul 1500

**Frontend-editor (PR #990):** Variant-velger "Trafikklys (spesial)" → 3 rad-farge-chips + per-farge prize/bingo-inputs.

### Oddsen (3 varianter: 55/56/57)

**Mekanikk:**
- Standard bongpriser (5/10/15 kr)
- HØY bingo-premie hvis fullt hus på `targetDraw` (55/56/57)
- LAV bingo-premie ellers
- Auto-multiplikator gjelder: 5 kr → low 500/high 1500, 10 kr → 1000/3000, 15 kr → 1500/4500

**Datamodell (`rules`):**
```json
{
  "gameVariant": "oddsen",
  "targetDraw": 55,
  "bingoBaseLow": 50000,             // 500 kr (5 kr-bong base)
  "bingoBaseHigh": 150000,           // 1500 kr (5 kr-bong base)
  "bingoLowPerColor":  { "hvit": 50000, "gul": 100000, "lilla": 150000 },
  "bingoHighPerColor": { "hvit": 150000, "gul": 300000, "lilla": 450000 }
}
```

**Frontend-editor (PR #990):** Variant-velger "Oddsen (spesial)" → target-trekk + bingoBaseLow + bingoBaseHigh + auto-preview-tabell.

---

## 💰 Auto-multiplikator (PR #989)

For standard hovedspill (alle untatt Trafikklys):

**Formel:** `actualPrize = base × (ticketPriceCents / 500)` (500 = 5 kr i øre)

**Eksempel — Innsatsen med bingoBase 100000 (1000 kr):**
- Hvit (5 kr) → 1000 kr × 1 = 1000 kr
- Gul (10 kr) → 1000 × 2 = 2000 kr
- Lilla (15 kr) → 1000 × 3 = 3000 kr

**Editor:** Radio-toggle "Premie-modus":
- **Auto** (default): ÉN bingo-base-felt + live preview-tabell
- **Spesialpris** (eller `explicit_per_color`): per-farge bingo-input (gammel modell, brukes av Trafikklys)

**Helper:** `calculateActualPrize(catalog, base, ticketPriceCents)` i `GameCatalogService.ts`.

---

## 🔧 Tekniske detaljer

### Filer endret denne sesjonen (kjernedokumenter)

**Backend:**
- `apps/backend/migrations/20261210000000_app_game_catalog_and_plan.sql` (Fase 1)
- `apps/backend/migrations/20261210010000_app_game1_scheduled_games_catalog_link.sql` (Fase 4)
- `apps/backend/migrations/20261210010100_app_game1_scheduled_games_nullable_legacy_fks.sql` (Fase 4)
- `apps/backend/migrations/20261210010200_app_game_plan_item_bonus_override.sql` (PR #988)
- `apps/backend/migrations/20261210010300_app_game_catalog_prize_multiplier_mode.sql` (PR #989, inkl. data-migrasjon)
- `apps/backend/src/game/GameCatalogService.ts`
- `apps/backend/src/game/GamePlanService.ts`
- `apps/backend/src/game/GamePlanRunService.ts`
- `apps/backend/src/game/GamePlanEngineBridge.ts`
- `apps/backend/src/game/gameCatalog.types.ts`
- `apps/backend/src/game/gamePlan.types.ts`
- `apps/backend/src/routes/adminGameCatalog.ts`
- `apps/backend/src/routes/adminGamePlans.ts`
- `apps/backend/src/routes/agentGamePlan.ts`

**Frontend:**
- `apps/admin-web/src/pages/games/catalog/GameCatalogState.ts`
- `apps/admin-web/src/pages/games/catalog/GameCatalogEditorPage.ts`
- `apps/admin-web/src/pages/games/plans/GamePlanState.ts`
- `apps/admin-web/src/pages/games/plans/GamePlanEditorPage.ts`
- `apps/admin-web/src/api/admin-game-catalog.ts`
- `apps/admin-web/src/api/admin-game-plans.ts`
- `apps/admin-web/src/api/agent-game-plan.ts`
- `apps/admin-web/src/api/agent-master-actions.ts`
- `apps/admin-web/src/api/agent-game-plan-adapter.ts`
- `apps/admin-web/src/utils/featureFlags.ts`
- `apps/admin-web/src/shell/sidebarSpec.ts`
- `apps/admin-web/src/shell/Sidebar.ts`
- `apps/admin-web/src/pages/agent-portal/JackpotSetupModal.ts`

**Skript:**
- `apps/backend/scripts/migrate-game-plan-2026-05-07.ts` (data-migrasjon med dry-run/execute/rollback)
- `apps/backend/scripts/verify-game-plan-migration.ts` (diff-sjekk pre/post)

**Dokumentasjon:**
- `docs/architecture/GAME_PLAN_REDESIGN_DEPRECATION_PLAN_2026-05-07.md` (T+0 → T+90 rollout-plan)

### API-endepunkter (alle live i prod)

**Admin (kun ADMIN-rolle, USER_ROLE_WRITE):**
- `GET/POST/PUT/DELETE /api/admin/game-catalog[/:id]`
- `GET/POST/PUT/DELETE /api/admin/game-plans[/:id]`
- `PUT /api/admin/game-plans/:id/items` (atomic drag-and-drop save med per-item bonus)

**Agent (master-hall, GAME1_MASTER_WRITE):**
- `GET /api/agent/game-plan/current` — plan + items + currentItem + jackpotSetupRequired
- `POST /api/agent/game-plan/start` — krever alle haller klar
- `POST /api/agent/game-plan/advance` — neste posisjon (med jackpot-blokk hvis spill krever popup)
- `POST /api/agent/game-plan/jackpot-setup` — submit jackpot-popup (draw + prizesCents)
- `POST /api/agent/game-plan/pause` / `/resume`

### Feature flag

`ff:useNewGamePlan` (localStorage):
- **`false`** (default): Master-dashbord leser legacy `app_game1_scheduled_games`. Sidebar viser gamle entries (Tidsplanadministrasjon, Opprettelse av spill, Lagret spillliste).
- **`true`**: Master-dashbord leser nye plan-modell via adapter. Sidebar viser kun nye entries (Spillkatalog, Spilleplaner).

Aktiver:
```js
localStorage.setItem('ff:useNewGamePlan', 'true')
```

Deaktiver:
```js
localStorage.removeItem('ff:useNewGamePlan')
```

### Test-status

| Kategori | Antall | Status |
|---|---|---|
| Service-tester (catalog/plan/run) | 88+18+9 | 🟢 grønne |
| Route-tester (admin + agent) | 20+13+6 | 🟢 grønne |
| Engine-bridge-tester | 16+3+4 | 🟢 grønne |
| Frontend-tester (catalog + plan + agent) | 16+8+10+11+8 | 🟢 grønne |
| **Total spilleplan-related** | **~250** | 🟢 alle grønne |
| Pre-eksisterende failures | ~21 | 🟡 ikke regrensjon (også feiler på main pre-#988) |

E2E-testbranch: `test/spilleplan-redesign-e2e-2026-05-07` (47 backend + 8 frontend tester) — IKKE merget enda. Vurder å merge for ekstra confidence.

---

## ⚠️ Hva gjenstår (kritiske oppfølger-PR-er)

### 1. Engine-bridge må forstå spesialspill-varianter (HØYESTE PRIORITET)

I dag bruker `GamePlanEngineBridge.buildEngineTicketConfig`:
- `auto`-modus: skalerer `bingoBase × multiplier` per bongfarge → OK
- `explicit_per_color`-modus: bruker `prizesCents.bingo[farge]` → fungerer for Trafikklys' fallback

**Men IKKE for spesial-mekanikkene:**
- ❌ **Trafikklys**: må bruke `rules.prizesPerRowColor[radFarge]` ved fullt hus, ikke per-bongfarge bingo
- ❌ **Oddsen**: må sjekke `ballsDrawn === rules.targetDraw` → `bingoBaseHigh × multiplier`; ellers `bingoBaseLow × multiplier`

**Konsekvens:** Hvis feature flag aktiveres for ekte runder, blir Trafikklys og Oddsen-utbetalinger feil.

**Estimat:** 2-3 timer for agent.

### 2. Test-engineer-branch merge (47+8 tester)

`test/spilleplan-redesign-e2e-2026-05-07` (commit `8c9b36cc`) inneholder ende-til-ende-tester men er ikke merget. Vurder å merge for regresjon-vern.

### 3. OpenAPI-spec for nye endepunkter (LOW)

✅ **Landet** i branch `docs/openapi-spilleplan-endpoints-2026-05-08`
(2026-05-08). Alle 17 nye admin/agent-endepunkter dokumentert i
`apps/backend/openapi.yaml` med 3 nye tags (`Admin — Game Catalog`,
`Admin — Game Plans`, `Agent — Game Plan`) og ~20 nye schemas
(GameCatalogEntry, GamePlan, GamePlanRun, JackpotOverride, etc.).
`npm run spec:lint` grønn.

### 4. Trafikklys + Oddsen i admin-master-data

I dag har 13 hovedspill korrekte priser men premiene er fortsatt i gammel explicit-format på flere standard-spill. Migration #20261210010300 har konvertert til auto-mode med `bingoBase` kopiert fra `bingo.hvit`. **Verifiser** at dette ble korrekt for hver spill — Tobias bør gå gjennom katalog-editor manuelt.

✅ **Landet 2026-05-08** (`fix/spill1-pot-per-bongsize-runtime-2026-05-08`):
   bridge skriver nå kanonisk `spill1.ticketColors[]` med slug-form-keys
   (small_yellow / large_white / etc.) i både `ticket_config_json` og
   `game_config_json`. Auto-multiplikator (hvit×1, gul×2, lilla×3) +
   small/large-skalering (×2) er bakt inn via `calculateActualPrize`.
   Engine sin payout-pipeline implementerer nå **pot-per-bongstørrelse**
   per §9 i SPILL_REGLER_OG_PAYOUT.md: separate potter per bongstørrelse,
   floor-split blant vinnere i samme størrelse, multi-bong-per-spiller
   gir summen av andelene.

   Oddsen Fullt Hus HIGH/LOW-overstyring er også implementert i samme
   PR — bridgen skriver `spill1.oddsen` blokk når
   `catalog.rules.gameVariant === "oddsen"`, og engine bytter pot-base
   basert på `drawSequenceAtWin <= targetDraw`. Compliance-ledger får
   §9.6-felter (`bongMultiplier`, `potCentsForBongSize`,
   `winningTicketsInSameSize`, `winningPlayersInSameSize`, `gameVariant`,
   `oddsenBucket`, `oddsenTargetDraw`).

   Trafikklys-rad-farge (rød/grønn/gul) er FORTSATT ikke implementert —
   det er separat path via `rules.gameVariant === "trafikklys"` +
   `rules.prizesPerRowColor`. Cap-fjerning for hovedspill (per §4 — kun
   databingo skal cappes) er flagget som oppfølger-PR; krever endring i
   `PrizePolicyManager` defaults og berører flere call-sites på tvers
   av Game1/2/3-engines.

### 5. Bonus-spill display-navn for "Mystery Joker"

I dag bruker vi slug `mystery` i whitelist (`BONUS_GAME_SLUG_VALUES`). Display-navn "Mystery Joker" leveres via `BONUS_GAME_DISPLAY_NAMES`. Hvis Tobias vil ha separat slug `mystery_joker`, må whitelist utvides.

---

## 🚧 Code-review + bug-cycle (samme sesjon)

Spawn-et 2 testagenter etter Fase 1-4 ble merget:
- **Code-reviewer**: 7 funn (2 CRITICAL + 2 HIGH + 2 MEDIUM + 1 LOW)
- **Test-engineer**: 8 funn (1 CRITICAL + 3 nye HIGH/MEDIUM + 47 nye tester)

**Alle CRITICAL + HIGH fikset i hotfixes:**
- C1: `app_audit_log` BIGSERIAL bug i migrasjons-skript
- C2: Engine-bridge `ticketTypesData` array-shape (engine forventet array, bridge ga record)
- H1: Jackpot-config-shape (`prizeByColor` path)
- H2: Race-condition-test for `getOrCreateForToday`
- HIGH #2: Frontend driver-knapper for ny runtime
- HIGH #3: Frontend-typer manglet `scheduledGameId` + `bridgeError`
- MEDIUM #4-#6: Doc-feil + route-validering

**Deferred til post-pilot:**
- LOW #7: OpenAPI-spec
- L1: FK på `group_of_halls_id` (gruppene-tabell heter `app_hall_groups`, ikke `app_groups`)

---

## 🌍 Operasjonell info for ny PM

### Tobias' identitet i prod

- **Admin-bruker:** `tobias@nordicprofil.no` med role `ADMIN`
- **Agent-bruker:** `tobias-arnes@spillorama.no` med role `AGENT` (master for Teknobingo Årnes)
- **Passord:** Spillorama123! (deler kun via direkte chat — Anthropic-policy hindrer AI å fylle inn passord på vegne av ham)

### Render API-key (for ops-tasks)

```
RENDER_API_KEY="rnd_LityRuPwpcgvbblID3ZQkcrPcJYp"
```

**Service:** `srv-d7bvpel8nd3s73fi7r4g`
**Owner:** `tea-d6k3pmfafjfc73fdh9mg`

Bruk for å:
- Sjekke deploy-status
- Hente build/app-logger
- Trigge manuell redeploy ved Render-flake

### System-account API-key (PR #978)

`POST /api/admin/system-accounts` (kun ADMIN) genererer langlevende API-keys for ops/CI/AI:
- Format: `sa_<32-hex-chars>`
- Audit-logged ved hver bruk
- Permissions + hall-scope-håndhevet (PR #979 migrerte 75 callsites til object-form)

**Bruk:** Tobias har IKKE opprettet noen ennå. Hvis ny PM vil automatisere ops-tasks via AI, opprett en `pilot-ops`-key med scoped permissions.

### Pilot-status (per memory)

- **4 testhaller**: Teknobingo Årnes (master) + Bodø + Brumunddal + Fauske
- **Hall-IDer i prod:**
  - Årnes: `b18b7928-3469-4b71-a34d-3f81a1b09a88`
  - Bodø: `afebd2a2-52d7-4340-b5db-64453894cd8e`
  - Brumunddal: `46dbd01a-4033-4d87-86ca-bf148d0359c1`
  - Fauske: `ff631941-f807-4c39-8e41-83ca0b50d879`
- **Game ID for Teknobingo Pilot Spill 1:** `7020f09f-f474-44d9-ad64-b666a2580ef2` (master_hall_id = Årnes)

---

## 🔄 Render deploy-historikk (sesjon)

| Status | Commit | Tema |
|---|---|---|
| 🟢 LIVE | `8076cc6f` | PR #990 special-editors |
| ⚫ deactivated | `92de504e` | PR #989 auto-multiplikator |
| ⚫ deactivated | `8fb5de60` | PR #988 per-item bonus |
| ⚫ deactivated | `0989fe6e` | PR #987 sidebar-cleanup |
| ⚫ deactivated | `082534f1` | PR #986 hotfix 1 |
| ⚫ deactivated | `78ee6ff6` | PR #985 hotfix 2 |
| ⚫ deactivated | `8e428d4a` | PR #984 migration timestamp fix |
| ❌ build_failed | `12b29924` | PR #983 Fase 4 (uten timestamp-fix) |
| ❌ build_failed | `181f4c0f` | PR #982 Fase 3 (uten timestamp-fix) |
| ❌ build_failed | `81308510` | PR #981 Fase 2 (uten timestamp-fix) |
| ❌ build_failed | `31db7f42` | PR #980 Fase 1 (uten timestamp-fix) |

**Lærdom:** Render migration-runneren krever streng tidsstempel-rekkefølge. Nye migration-filer MÅ ha timestamp ETTER siste eksisterende migration. Build feiler stille hvis ikke. PR #984 fikset alle 3 nye migrations til `20261210xxxxxx`.

---

## 🎯 Spilleplan-redesign — full kontekst for ny PM

### Tobias' opprinnelige problemstilling (sitat)

> *"Vi må ikke blande spillene. fargekladden, skatteskisten, lykkehujl, mysteri joker er kun bonusspill. dette er da ikke spillene som vises på spilleplanene, dette er bonusspill som aktiveres når kunde da treffer fullt hus"*

### Slik flyten fungerer nå (post-redesign)

1. **Spillkatalog** (`/admin/#/games/catalog`)
   - 13 hovedspill definert
   - Per spill: bongfarger, priser, premier (auto-skalert), variant (standard/trafikklys/oddsen), default bonus-spill (kan overstyres)
2. **Spilleplan** (`/admin/#/games/plans`)
   - Velg hall ELLER group + ukedager + åpningstid
   - Drag-and-drop hovedspill fra katalog inn i sekvens (1..40)
   - Per posisjon: dropdown for å overstyre bonus-spill (Lykkehjul/Fargekladd/Skattekiste/Mystery Joker)
3. **Master-dashbord** (`/admin/#/agent/cashinout` — UENDRET utseende)
   - Når feature flag er på: leser plan-data via adapter, kaller ny `/api/agent/game-plan/*`-API
   - Når av: leser legacy `/api/agent/game1/current-game`
   - Master-flyt: alle haller "klar" → master "Start" → engine-bridge spawner runde

### Spillpriser og premier (Tobias' bekreftede regler)

**Bongpriser ALLTID:**
- Hvit: 5 kr
- Gul: 10 kr
- Lilla: 15 kr

**Premier (auto-multiplikator):**
- Sett base for billigste bong (5 kr)
- Backend skalerer for dyrere: 10 kr = 2× base, 15 kr = 3× base
- Eks: Innsatsen base 1000 kr → hvit vinner 1000, gul 2000, lilla 3000

**Spesialspill avviker:**
- **Trafikklys**: alle bonger 15 kr, premier per RAD-FARGE (rød 50, grønn 100, gul 150)
- **Oddsen**: target-trekk gir høy premie (1500 base), andre trekk gir lav (500 base)

### Bonus-spill (4 typer, valgbar per spilleplan-item)

| Slug | Display-navn | Trigges ved |
|---|---|---|
| `wheel_of_fortune` | Lykkehjul | Fullt hus |
| `color_draft` | Fargekladd | Fullt hus |
| `treasure_chest` | Skattekiste | Fullt hus |
| `mystery` | Mystery Joker | Fullt hus |

### Jackpot-mekanikk (uendret fra Fase 1)

For spill med `requires_jackpot_setup = true`:
1. Master prøver å starte → backend returnerer `JACKPOT_SETUP_REQUIRED`
2. Frontend viser popup: input "Hvilket trekk?" + 3 inputs (premier per bongfarge gul/hvit/lilla)
3. Master submitter → lagres i `app_game_plan_run.jackpot_overrides_json[position]`
4. Engine bruker overrides ved utbetaling

---

## 📋 Anbefalt arbeidsflyt for ny PM

### Første dag

1. **Les denne handover-doc'en** (du leser den nå)
2. **Sjekk live-status:** `https://spillorama-system.onrender.com/health` skal returnere `ok: true`
3. **Verifiser pull from main** lokalt: `git pull origin main` → siste commit `8076cc6f`
4. **Tobias' Chrome:** sjekk at feature flag er aktivt: `localStorage.getItem('ff:useNewGamePlan')` skal returnere `'true'`
5. **Sjekk katalog:** Naviger til `/admin/#/games/catalog` → 13 spill skal være listet

### Første prioritet (bør gjøres ASAP)

**Engine-bridge-oppdatering for spesialspill** — kritisk før Tobias bruker ny modus i ekte runder. Spec:

```typescript
// apps/backend/src/game/GamePlanEngineBridge.ts
export class GamePlanEngineBridge {
  // I createScheduledGameForPlanRunPosition:
  // Hvis catalog.rules.gameVariant === "trafikklys":
  //   Sett ticket_config_json med rules.prizesPerRowColor + rules.bingoPerRowColor
  //   Engine må slå opp rad-farge ved utbetaling
  
  // Hvis catalog.rules.gameVariant === "oddsen":
  //   Sett ticket_config_json med low + high + targetDraw
  //   Engine må sjekke ballsDrawn ved fullt hus
}
```

Test mot prod-data: opprett en test-plan med Trafikklys + Oddsen, kjør runde, verifiser utbetaling.

### Andre prioritet

- **Merge test-engineer-branch** for ekstra regresjon-vern
- **Lag OpenAPI-spec** for de 17 nye endepunktene
- **Verifiser at eksisterende katalog-data** har korrekte premier (gå gjennom hver i UI)
- **Bygg full 40-spill-spilleplan** — Tobias har ikke gjort dette enda i ny modell

### Pilot-readiness-sjekk

Per [docs/operations/PM_HANDOFF_2026-04-26.md](./PM_HANDOFF_2026-04-26.md) er pilot-blokkere lukket. Spilleplan-redesignen er **opt-in via feature flag**, så ingen impact på legacy-flyt.

**Før Tobias slår på flagget for produksjons-pilot:**
1. Engine-bridge oppdatert for Trafikklys + Oddsen ✅ (må gjøres)
2. Manuell verifisering av alle 13 katalog-spill premiene
3. Manuell verifisering av en testkjørt runde via ny modell
4. Sett opp staging-test med 1 hall (Årnes) før global rollout

---

## 📊 Konvensjoner brukt i sesjonen

### Git-flyt (PM-sentralisert)

- **Agenter**: commit + push branch — **aldri** opprett PR
- **PM (Claude i sesjonen)**: opprett PR + auto-merge med `--squash --auto --delete-branch`
- **Tobias (PM)**: i nye sesjoner kan han delegere til ny AI-PM

### Branch-naming

- `feat/<scope>-<topic>-<date>` for nye features
- `fix/<scope>-<topic>-<date>` for hotfixes
- `cleanup/<scope>-<topic>-<date>` for opprydning
- `chore/<scope>-<topic>-<date>` for ikke-funksjonelle endringer
- `test/<scope>-<topic>-<date>` for tester

### Migration-tidsstempel

`YYYYMMDDHHMMSS_<descriptive_name>.sql`

**KRITISK:** Tidsstempel må være **etter** siste eksisterende migration. Render migration-runner avviser back-dated migrations når senere allerede er kjørt. Sjekk `ls apps/backend/migrations/ | tail -5` før du lager ny.

### Skill-loading-protokoll

Hver brukerprompt har et skill-loading-protokoll i system-prompten. AI skal:
1. SCAN listed skills og decide LOAD or SKIP per skill
2. Invoke `Skill(name)` for hver LOAD
3. Deretter skrive kode

Tobias har eksplisitt valgt lazy per-task-modus: **LOAD kun når koden skrives selv** (ikke når delegert til agent).

---

## 🔗 Referanser

- **Spill-regler + payout (KANONISK — les FØR payout-endringer):** [docs/architecture/SPILL_REGLER_OG_PAYOUT.md](../architecture/SPILL_REGLER_OG_PAYOUT.md) — autoritativt dokument for bongpriser, auto-multiplikator, cap, spesialspill og engine-bridge-shape
- **Forrige PM-handoff:** [docs/operations/PM_HANDOFF_2026-04-26.md](./PM_HANDOFF_2026-04-26.md)
- **Spilleplan deprecation-plan:** [docs/architecture/GAME_PLAN_REDESIGN_DEPRECATION_PLAN_2026-05-07.md](../architecture/GAME_PLAN_REDESIGN_DEPRECATION_PLAN_2026-05-07.md)
- **Game catalog:** [docs/architecture/SPILLKATALOG.md](../architecture/SPILLKATALOG.md)
- **Master-plan pilot:** [docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md](../architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md)
- **Pilot-readiness:** docs/architecture/PILOT_READINESS_2026-05-01.md (sjekk eksistens)
- **Architecture overview:** [docs/architecture/ARKITEKTUR.md](../architecture/ARKITEKTUR.md)
- **Pilot-flow manuell test (2026-05-08):** [docs/operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md](./PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md) — Tobias-checklist for end-to-end-verifisering (admin → ready → master → kunde → pot-deling). Smoke-test-script: `apps/backend/scripts/pilot-smoke-test.sh`.

---

## 🙏 Avskjedshilsen

Tobias' kommentar fra sesjon-slutt: *"du har gjort en meget god jobb og jeg trenger ny PM til å ha alt informasjon du har med en gang."*

Sterk leveranse i dag — fra pilot-fixes via stor arkitektur-refaktor til full bug-cycle med independent review, e2e-tester, og hotfixes — alt i én sesjon. **22 PR-er + 13 katalog-spill + komplett spilleplan-redesign på én dag.**

Til ny PM: bruk denne handover-doc'en som referanse, men ikke vær redd for å spørre Tobias om kontekst. Han er presis og raskt på tilbakemelding.

**Ny PM, du får et solid utgangspunkt — kjør på!**

— Forrige PM-AI (Claude Opus 4.7)
