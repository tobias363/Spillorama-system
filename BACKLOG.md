# Spillorama Backlog

**Sist oppdatert:** 2026-05-06
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

### Faktisk gjenværende kritiske

| ID | Tema | Beskrivelse | Status |
|---|---|---|---|
| W1 | Engine-refactor for system-actor | Fjern hardkodet system-player-id, bruk eksplisitt actorType=SYSTEM | Wave 1 i fremdrift |
| 2A | Strukturerte error-codes | Migrere alle `throw new Error(...)` til `BingoError(code, ...)` | Fase 2A, 60% migrert |
| MED-1 | Trace-ID propagering | Klient → HTTP → Socket.IO → DB samme trace_id | Delvis (klient ✅, backend ⚠️) |
| 2B | Klient-debug-suite | Ring-buffer + debug-overlay + bug-rapport-knapp | Fase 2B, basis på plass |

---

## Pågående waves

### Wave 1 — Engine-refactor (Spill 2/3)
**Mål:** ren separasjon mellom Spill 1 (master-styrt) og Spill 2/3 (perpetual). Fjerne hardkodet
system-player-id. Eksplisitt actorType-felt.

**Trigger:** ADR-001 + ADR-002 + audit-rapport 2026-05-05

**Status:** I fremdrift. Påfølgende PR-er.

**Output:** ren engine-API, færre subtle bugs, audit-trail sannferdig.

### Wave 2 — Outbox-bredkast for compliance og game-events
**Mål:** ADR-004 outbox-pattern for compliance og game-events (wallet er ferdig).

**Status:** Ikke startet. Avhengig av Wave 1 stabilitet.

### Wave 3 — Trace-ID full-stack
**Mål:** klient til DB, samme trace_id alle steder.

**Status:** Klient ✅, backend HTTP ✅, Socket.IO og DB-queries ⚠️.

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
