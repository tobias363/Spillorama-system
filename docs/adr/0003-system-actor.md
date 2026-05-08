# ADR-0003 — System-actor for engine-mutasjoner

**Status:** Accepted
**Dato:** 2026-05-04
**Deciders:** Tobias Haugen
**Konsulterer:** —

> **Migrering 2026-05-08:** Migrert fra `docs/decisions/ADR-002-system-actor.md` til ny struktur. Innhold uendret.

## Kontekst

BingoEngine produserer audit-events ved hver mutering: ball trukket, claim submittet, prize paid out,
room state-overgang. Hvert event krever et "actor"-felt som svarer på "hvem gjorde dette?".

For Spill 1 (master-styrt) er svaret enkelt: hall-master eller agenten som klikker "Start Next Game"
er actor. For Spill 2/3 (perpetual loop, ADR-0002) er det ingen menneskelig actor — system-cron eller
auto-draw-tick produserer eventet.

Tidlig kode hardkodet en "system-player-id" (literal `"00000000-0000-0000-0000-000000000000"`) som
falsk actor. Dette ga to problemer:

1. **Audit-revisjon krever entydig svar:** "Hvem trakk ball 17 i runde 4983?" — svar "player 0" er en
   løgn (det er ingen player med den ID).
2. **Compliance-ledger-binding:** Game1TicketPurchaseService brukte tidligere master-hall sin
   house-account uavhengig av kjøpe-hall (BIN-661 bug, fikset i PR #443). Hvis vi binder system-events
   til en falsk player-id, mister vi sporbar kobling til regulatorisk kategori.

## Beslutning

Innfør eksplisitt **system-actor** i audit-modellen:

- Audit-event har `actorType: "USER" | "ADMIN" | "AGENT" | "SYSTEM" | "PLAYER"`
- For system-driven actions: `actorType = "SYSTEM"`, `actorId = null`, `details.subsystem = "perpetual-loop" | "auto-draw" | "cron-escalation"` etc.
- Compliance-ledger-rader binder `actor_hall_id` til **kjøpe-hallen** (ikke master-hall), uansett om
  trekningen er per-hall eller global.

System-actor får ikke wallet eller permissions — den er kun en audit-kategori.

## Konsekvenser

### Positive
- **Audit-revisjon entydig:** "Hvem trakk ball X?" har klart svar (USER/ADMIN/AGENT/SYSTEM)
- **Compliance-binding korrekt:** §71 hall-rapport kan trygt summere per actor_hall_id uten
  master-hall-bias (BIN-661 fix)
- **Subsystem-detalj:** vi kan filtrere SYSTEM-events på subsystem for diagnose (cron vs auto-draw vs
  recovery)

### Negative
- **Migrering kreves:** Wave 1-engine-refactor må erstatte hardkodet system-player-id med proper
  actorType. Status: i fremdrift.
- **Eksisterende audit-rader med system-player-id må enten beholdes (legacy) eller migreres** — vurderes
  som del av Wave 1.

### Nøytrale
- Krever disiplin i nye engine-call-sites: aldri pass `actorPlayerId: someConst`, alltid pass
  `actor: { type: "SYSTEM", subsystem: "..." }`.

## Alternativer vurdert

### Alternativ A: Behold falsk system-player-id
Avvist:
- Audit-revisjon-svar er en løgn
- Brudd med casino-grade-prinsippet (audit-trail må være sannferdig)

### Alternativ B: Skip audit-events for system-driven actions
Avvist:
- Pengespillforskriften krever sporbarhet på alle trekninger
- Mister diagnose-evne ved post-mortem

### Alternativ C: Bruk hall-master sin user-id som actor (Spill 1-style)
Avvist:
- For Spill 2/3 er det ingen master-hall (ADR-0002)
- Ville gi falsk skyld til en spesifikk admin

## Implementasjon

- ✅ Type-skjemaet er på plass (`AuditActorType` i `shared-types`)
- ⚠️ Wave 1 engine-refactor utskifting av hardkodet system-id i fremdrift
- ✅ Compliance-binding fix er deployet (PR #443)

Skills som bør oppdateres: `audit-hash-chain`, `wallet-outbox-pattern`, `pengespillforskriften-compliance`.

## Referanser

- `packages/shared-types/src/index.ts` — `AuditActorType`-enum
- `apps/backend/src/compliance/AuditLogService.ts`
- PR [#443](https://github.com/tobias363/Spillorama-system/pull/443) — Compliance multi-hall-binding
- ADR-0002 (perpetual-rom) for kontekst
- `docs/architecture/SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md`
