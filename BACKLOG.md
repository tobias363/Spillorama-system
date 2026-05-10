# Spillorama Backlog

**Sist oppdatert:** 2026-05-10 (BIN-823 lukket: Spill 2 åpningstid-guard fikset, K1-K4 alle merget; Wave 3a/3b også merget)
**Eier:** Tobias Haugen
**Formål:** Oversikt over åpne pilot-blokkere, pågående waves, og post-pilot-arbeid.

> **Til ny PM:** Dette er ikke Linear. Linear har detaljert task-tracking. **Dette er strategisk
> oversikt** — hva er åpent, hva er pågående, hva er ferdig. Snitt-detaljer ligger i Linear-issues
> (BIN-NNN). Detaljerte handoffs ligger i `docs/operations/PM_HANDOFF_*.md`.

---

## Pilot-status (2026-05-06)

**Pilot-skala:** 24 haller × 1500 spillere = 36 000 samtidige

### Live på prod
- Spill 1 (`bingo`) — full funksjonalitet
- Spill 2 (`rocket`) — pilot-readiness 2026-05-05
- Spill 3 (`monsterbingo`) — pilot-readiness 2026-05-05

### Tobias-direktiv 2026-05-05
- Spill 1, 2, 3 alle skal være pilot-klare
- Ingen deadline — kvalitet over hastighet
- All død kode skal fjernes

---

## Åpne pilot-blokkere (KRITISK)

Disse må lukkes før pilot kan kjøre. Kategoriene fra `docs/architecture/SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md`.

### K1 - Compliance og Settlement (alle merget)
Status: ✅ Lukket. Se ADR-002, ADR-007, PR #443, PR #441/#547/#573.

### K2 - Agent-workflow (alle merget)
Status: ✅ Lukket. Customer Unique ID (PR #464), agent-portal cash-inout, ticket-farger.

### K3 - Hall-binding (alle merget)
Status: ✅ Lukket. transferHallAccess (PR #453), auto-escalation, payout-cap.

### K4 — Regulatorisk åpningstid-håndhevelse (✅ Lukket BIN-823)

**Severity:** Pilot-go-live-blokker (Lotteritilsynet-krav).
**Status:** ✅ Lukket — fixet 2026-05-08 via `PerpetualRoundOpeningWindowGuard.ts` factory + 19 unit-tester + 4 wiring-regression-tester. Begge Spill 2 (`rocket`/`game_2`/`tallspill`) og Spill 3 (`monsterbingo`) dekkes av samme factory-mønster.
**Linear:** [BIN-823](https://linear.app/bingosystem/issue/BIN-823) (Done).

**Verifikasjon:**
- **Fil:** `apps/backend/src/game/PerpetualRoundOpeningWindowGuard.ts` (eksisterer)
- **Tester:** `apps/backend/src/game/PerpetualRoundOpeningWindowGuard.test.ts` (eksisterer) + `apps/backend/src/__tests__/indexWiring.spill2OpeningWindowGuard.test.ts` (eksisterer)
- **Wireup:** `apps/backend/src/index.ts:281, 3025-3026` — `createPerpetualRoundOpeningWindowGuard({ ... })` factory-pattern injectes som `canSpawnRound`-callback til `PerpetualRoundService`
- **Merget commits:** PR #1051 (`96bba71f` fix(spill2): åpningstid-guard for ROCKET perpetual-loop), `1a12d0a0` fix(spill2): wire åpningstid-guard, `12207204` feat(spill2): PerpetualRoundOpeningWindowGuard factory + edge-case-tester, `e6981335` test(spill2): unit + integrasjonstest
- **Doc-ref:** [`SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md` §3.8 + §10.2](./docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md), [`SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md` §3.8](./docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md)

| § | Tema | Status |
|---|---|---|
| Spill 2 | `canSpawnRound` for `rocket` | ✅ Lukket — guard wired via factory; runder spawner ikke utenfor `[openingTimeStart, openingTimeEnd)`-vinduet (Oslo-tz). DB-feil → fail-open (returnerer null). |

**Tobias-direktiv 2026-05-08:**
> *"Veldig viktig at det ikke er mulig å kunne spille spillene etter stengetid. Er strenge regler på det fra Lotteritilsynt."*

### Pilot-blokkere lukket 2026-05-06 (Wave 1+2)

| § | Tema | Fix |
|---|---|---|
| §2.1 | endGame ACL bypass (én spiller kunne brikke 1500-rom) | ✅ [PR #950](https://github.com/tobias363/Spillorama-system/pull/950) — system-actor sentinel |
| §2.6 | PerpetualRoundService stale host | ✅ [PR #950](https://github.com/tobias363/Spillorama-system/pull/950) |
| §2.7 | Slug-aliaser (`tallspill`/`game_2`/`mønsterbingo`/`game_3`) | ✅ [PR #950](https://github.com/tobias363/Spillorama-system/pull/950) — `isPerpetualSlug` |
| §5.1 | Game3 stuck-recovery (henging på ball #75) | ✅ [PR #948](https://github.com/tobias363/Spillorama-system/pull/948) |
| §9.1 | DATABINGO hardkodet for Spill 2/3 (regulatorisk §11) | ✅ [PR #948](https://github.com/tobias363/Spillorama-system/pull/948) — MAIN_GAME-paritet |

**Verifisert prod 2026-05-06:** ROCKET `autoDraw.errors=0`, MONSTERBINGO 75/75 ENDED + perpetual-restart scheduled. Trekninger faktisk skjer.

### Wave 3 — performance-engineering ✅ LUKKET 2026-05-06

| § | Tema | Fix |
|---|---|---|
| §3.1 | onDrawCompleted slow at scale | ✅ Wave 3a — batched parallel mass-payout. PR #952 (`08f6ef95`) |
| §3.4 | room.players mutex missing | ✅ Wave 3a — snapshot iterator + race-detector. PR #952 (`08f6ef95`) |
| §6.1 | room:update payload size | ✅ Wave 3b — per-spiller-strip i `emitRoomUpdate`, 314 KB → 0.8 KB pr. mottaker. PR #953 (`0444aff9`) |
| §6.4 | Postgres pool exhaustion | ✅ Wave 3b mitigated — pool-stats-metrics + 5s→3s fail-fast timeout. Se [`SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md`](./docs/architecture/SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md). |

**ADR-ref:** ADR-011 + audit-banner + module-READMEs for Wave 3b (commit `9fec8e10`).

### Andre åpne saker

| ID | Tema | Status |
|---|---|---|
| MED-1 | Trace-ID full-stack (klient → DB) | Klient ✅, HTTP ✅, Socket.IO ⚠️, DB-queries ⚠️ |
| MED-2 | Migrasjons-rekkefølge bug (`20260425` ALTER før `20260724` CREATE) | ✅ Lukket 2026-05-06 — idempotent CREATE+ALTER. Se ADR-012. |
| Wave 4 | Outbox-bredkast for compliance + game-events | Ikke startet (post-Wave-3) |

---

## Tidligere wave-status (referanse)

### Wave 1 — system-actor for Spill 2/3 ✅ LUKKET 2026-05-06
- PR #950 — `SystemActor.ts` sentinel + `isPerpetualSlug` + assertHost + AutoDrawTickServices
- Engine-refaktor for separasjon Spill 1 (master) vs Spill 2/3 (perpetual)

### Wave 2 — MAIN_GAME-paritet + Game3-recovery ✅ LUKKET 2026-05-06
- PR #948 — prize-cap binder MAIN_GAME for Spill 2/3 (regulatorisk §11)
- Game3AutoDrawTickService stuck-recovery paritet med PR #876

### Wave 3a — performance fixes (mass-payout + room.players race) ✅ LUKKET 2026-05-06
- PR #952 — batched parallel mass-payout (§3.1) + snapshot-iterator/race-detector (§3.4)

### Wave 3b — payload-stripping + pool-tuning ✅ LUKKET 2026-05-06
- PR #953 — per-recipient broadcast for `room:update` (§6.1) + Postgres pool fail-fast (§6.4)
- ADR-011 introdusert for per-spiller-strip-pattern

---

## Post-pilot (lavere prioritet)

| Tema | Beskrivelse | Estimert |
|---|---|---|
| SpinnGo (Spill 4) full implementasjon | Player-startet databingo med ruletthjul | 2-3 sesjoner |
| Frittstående Agent-portal | Eks-trakt fra admin-web til separat app | 1-2 sesjoner |
| Norsk Tipping/Rikstoto API-integrasjon | Erstatt manuell innlegging med API | 2-3 sesjoner |
| Bot Game-runtime | Pre-genererte bot-spillere for hall-fyll | 1-2 sesjoner |
| Game 5 admin-multipliers | Pattern-vise multiplier (1x-5x) | 1 sesjon |
| Screen Saver setting | Multi-image på TV med per-image timing | 1 sesjon |
| Language toggle NO/EN | Header-toggle, dynamisk i18n | 2-3 sesjoner |
| BankID full integrasjon (Phase 3) | Erstatt local KYC med BankID | 2-3 sesjoner |

---

## Ferdig (referanse)

### Casino-grade infrastruktur (2026-04 til 2026-05)
- ✅ Casino-grade wallet (BIN-761→764) — outbox, REPEATABLE READ, hash-chain
- ✅ TOTP 2FA + active sessions (REQ-129/132)
- ✅ Phone+PIN-login (REQ-130)
- ✅ Multi-currency readiness (BIN-766)
- ✅ Idempotency-key 90-dager TTL cleanup (BIN-767)
- ✅ Hash-chain audit-trail (BIN-764, ADR-003)
- ✅ Daglig audit-anchor + verify-script

### Spill 1 pilot-blokker (2026-04-24 til 2026-05-04)
- ✅ Compliance multi-hall-binding (PR #443)
- ✅ Settlement maskin-breakdown (PR #441/#547/#573)
- ✅ Customer Unique ID (PR #464 + #599)
- ✅ transferHallAccess 60s handshake (PR #453)
- ✅ Manuell Bingo-check UI (PR #433)
- ✅ Mystery Game client-overlay (PR #430)
- ✅ Lucky Number Bonus + Jackpott daglig akkumulering
- ✅ Per-agent ready-state, shift-end checkboxer
- ✅ Per-hall payout-cap, auto-escalation
- ✅ XML-Withdraw pipeline

### Spill 2/3 pilot-readiness (2026-05-05)
- ✅ 15 PR-er merget i én sesjon (#911-#926)
- ✅ Bong Mockup.html paritet
- ✅ Auto-draw host-fallback
- ✅ Reconnect uten refresh
- ✅ Game1BuyPopup unified (Spill 2 + 3)

---

## Hvordan oppdatere dette dokumentet

Ved sesjons-slutt:
1. Hvis pilot-blokker er lukket: flytt fra "Åpne" til "Ferdig"
2. Hvis ny pilot-blokker oppdaget: legg til "Åpne" med ID + tema + beskrivelse
3. Hvis wave er ferdig: marker som ✅ og oppdater status-seksjonen
4. Oppdater "Sist oppdatert"-dato

Ved nye Linear-issues:
- Bare reflekter strategisk endring her — ikke kopier hver issue

---

## Referanser

- [`docs/architecture/SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md`](./docs/architecture/SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md) (ikke i agent-worktree, hovedversjon på main)
- [`docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md`](./docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md)
- [`docs/operations/PM_HANDOFF_*.md`](./docs/operations/) — siste handoff er state-of-the-art
- [Linear: Bingosystem](https://linear.app/bingosystem)
