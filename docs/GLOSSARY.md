# Glossary — Spillorama-system

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Formål:** A-Å av domeneord som brukes i kode, docs og samtaler.

> **Til ny PM:** Når du møter et begrep du ikke kjenner — søk her først. Hvis
> det mangler, legg det til når du har funnet svaret. Det sparer neste PM tid.

---

## A

**ADR** — Architecture Decision Record. Lagres i `docs/adr/NNNN-tittel.md`.
Immutable etter accepted. Nye beslutninger som overstyrer gamle: ny ADR med
`Supersedes ADR-MMMM`.

**Agent** — (1) Bingovert / operativ ansatt i hall. (2) AI-agent (Claude)
som koordinert av PM utfører kode-arbeid.

**Agent-portal** — Admin-portal-seksjon for hall-operatører (cash inn/ut,
settlement, master-konsoll, agent-shift).

**Anti-fraud** — Velocity-, bot-, og pattern-detektorer i `apps/backend/src/security/`.

**Audit-trail** — Hash-chain logg over alle finansielle og spill-events
(BIN-764). Kreves av Lotteritilsynet §11.

## B

**BankID** — Norsk autentiserings-/KYC-leverandør. Adapter:
`apps/backend/src/adapters/BankIdKycAdapter.ts`. KYC_PROVIDER=bankid i prod
(currently `local` i dev).

**Backlog** — `BACKLOG.md` på rot. Aktivt arbeid og pilot-blokkere. Ulik
RISKS.md (kjente risikoer) og decisions-log (Tobias-beslutninger).

**BIN-NNN** — Linear issue-prefiks for prosjektet "Bingosystem".

**Blue-Green** — Render's deploy-strategi: ny versjon kjører parallelt med
gammel før trafikk byttes. Nedetid ~0.

**Bus-faktor** — Antall personer som må fjernes før prosjektet stopper. Per
i dag: 1 (Tobias). Plan for å øke: `docs/operations/BUS_FACTOR_PLAN.md`.

**Bølge / Wave** — Refaktor-fase eller fix-bunt. Eks: "Wave 1 cleanup".

## C

**Candy** — Tredjeparts spill integrert i Spillorama via iframe. Repo:
`tobias363/candy-web`. Wallet-bro: `/api/ext-wallet/*`. Boundary:
`docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md`.

**Casino-grade** — Kvalitet på linje med Evolution Gaming / Playtech Bingo.
Tobias-mandat 2026-04-28.

**CODEOWNERS** — `.github/CODEOWNERS`. Auto-assigner reviewer ved PR. I dag
`@tobias363` for alt (bus-faktor 1).

**Compliance** — Pengespillforskriften-håndhevelse i kode. Lever i
`apps/backend/src/compliance/` + `docs/compliance/`.

**Conventional Commits** — Påkrevd commit-format: `feat(scope): subject`.
Se CONTRIBUTING.md.

**Cowork** — Anthropic Claude desktop-app med MCP-er. Brukt for PM-orkestrering.

## D

**Databingo** — Spillkategori (Spill 4 / SpinnGo). §11 = 30 % + 2500 kr cap.
Player-startet (ulik live).

**Demo-backend** — Sibling repo (`tobias363/demo-backend`) for Candy-demo.
URL: https://candy-backend-ldvg.onrender.com

**DR / Disaster Recovery** — `docs/operations/DISASTER_RECOVERY_PLAN_2026-04-25.md`.
RPO ≤ 5 min, RTO backend ≤ 30 min, RTO DB ≤ 2 t.

**Done-policy** — Issue lukkes kun når commit er på `main` + file:line + grønn
CI. ADR-0010, vedtatt 2026-04-17 etter 4 false Done-funn.

**Draw / Trekning** — Ball-trekning i bingo. Backend-håndtert via
`Game1DrawEngineService` (Spill 1) og `Game2/3Engine` (perpetual).

## E

**Eskaleringskjede** — Kart over hvem som kontaktes ved hva. Se
`docs/operations/STAKEHOLDERS.md` §"Eskalerings-kart".

**Evolution Gaming** — Casino-software-vendor. Kvalitets-benchmark for Spillorama.

## F

**Frankfurt** — Render-region for prod. Single-region (R-003).

## G

**game1, game2, game3, game5** — Code-names for spill (slug-aliaser):
`bingo`, `rocket`, `monsterbingo`, `spillorama`.

**game4 / themebingo** — DEPRECATED (BIN-496). Ikke bruk.

**Gate (PM)** — `scripts/pm-checkpoint.sh` — vanntett onboarding-gate som PM
må passere før kode-handling. BIN-PM-VT 2026-05-10.

**GoH** — **Group of Halls**. Gruppe av haller som spiller sammen ("link").
Felles canonical-room-kode `BINGO1-<groupId>`.

**GoH-master** — Master-hall i en GoH. Eier draw-engine for Spill 1.

## H

**Hall** — Bingo-lokasjon med agenter. Pilot: Teknobingo Årnes (master),
Bodø, Brumunddal, Fauske.

**Hash-chain** — Tamper-evident audit-log-pattern. Hver event lenkes til
forrige via SHA-hash. BIN-764 + ADR-0015.

**Hovedspill** — Spillkategori (Spill 1/2/3). §11 = 15 % minimum til organisasjoner.

**Husky** — Git-hook-manager. Pre-commit i `.husky/pre-commit`.

## I

**Idempotency-key** — `clientRequestId` eller `idempotencyKey` på alle
mutations. Re-send med samme key skal gi samme resultat.

**Immutable direktiver** — Tobias-direktiver som ikke kan fravikes uten hans
godkjennelse. PM_ONBOARDING_PLAYBOOK §2.

**Intent-verification** — Skill som tvinger restate-blokk før kode-arbeid
(`.claude/skills/intent-verification/SKILL.md`).

## K

**KYC** — Know Your Customer. Spillerverifisering. Provider: BankID i prod,
`local` (alder-sjekk) i dev.

## L

**Linear** — Issue-tracker. Workspace "Bingosystem". MCP koblet til Cowork.

**Live-rom** — Rom som må være alltid tilgjengelig innenfor åpningstid.
Mandat: LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08, mål 99.95 %.

**Lotteritilsynet** — Norsk pengespill-regulator. Kontakt-info i
`docs/operations/STAKEHOLDERS.md`.

## M

**MAIN_GAME** — LedgerGameType for hovedspill (Spill 1/2/3) i compliance-ledger.

**Master / Master-hall** — Hall som styrer game-flow for Spill 1 i en GoH.
Master-actions: start, pause, resume, advance.

**Master-action** — Bevisst kommando fra master-hall. Bridge-pattern via
`MasterActionService`.

**MCP** — Model Context Protocol. Anthropics protokoll for connectors.
Spillorama bruker Linear MCP, GitHub MCP (innebygd), Cowork artifacts.

**MEMORY.md** — `docs/memory/MEMORY.md`. AI-agent-kontekst som auto-loades
hver sesjon via `@docs/memory/MEMORY.md` i CLAUDE.md.

**Monsterbingo** — Slug for Spill 3. 5×5 uten free, 4 sequential phases
(Rad 1-3 + Pyramide à 25 %).

## N

**Nordicprofil** — Tobias' selskap.

## O

**Outbox-pattern** — Wallet-state + event-write i samme transaksjon. BIN-761.
Sikrer at distribuert state og audit-trail er konsistent.

## P

**Pengespillforskriften** — Norsk pengespill-regulering. Kanonisk i Spillorama:
`docs/compliance/`.

**Perpetual loop** — Spill 2/3-arkitektur: ETT globalt rom som kjører
kontinuerlig. Ulik Spill 1 (per-hall + master-styrt).

**Pilot** — 4-hall pilot Q3 2026, deretter 24-hall (betinger 2-4 uker
stabilitet på 4-hall).

**Plan-runtime** — Spill 1 game-plan-execution. `GamePlanRunService`.

**PM** — Project Manager. Koordinerer agenter og git-flyt på toppen.
Sentralisert per ADR-0009.

**PM-gate** — Se "Gate (PM)".

**Postmortem** — Incident-analyse med 5-Whys. Lever i `docs/postmortems/`.

**Postgres** — Versjon 16. System of record for accounts, wallets, compliance.

**Pot-deling** — Premie-pool deles mellom multi-vinnere. Tie-breaker:
`purchase_timestamp ASC, assignmentId ASC` (deterministisk).

## R

**R1–R12** — 12 pilot-gating-tiltak fra
`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08`. R4 = load-test 1000, R6 =
outbox-validering, R9 = 24t leak-test (eksempler).

**Redis** — Cache for rom-state, sesjoner, rate-limiting. Versjon 7.
Ephemeral — ikke system of record.

**Render** — PaaS-leverandør. Hoster prod i Frankfurt.

**REPEATABLE READ** — Postgres isolation-nivå brukt for wallet-transaksjoner.

**Responsible Gaming** — "Spillvett" — limits, self-exclusion, pause.

**RNG** — Random Number Generator. In-house (ikke 3rd party). GLI-19-sertifisering
post-pilot ved EU-ekspansjon.

**Rocket** — Slug for Spill 2. 21-ball 3×3 full plate. ETT globalt rom (`ROCKET`).

**ROOM_NOT_FOUND** — Vanlig feil hvis canonical-room-kode mangler.
Lowercase pilot-haller hadde dette i pilot-cutover (#659).

## S

**Scheduled-game** — Spill 1 game-instans i en plan. Ulik plan-run (state).

**SESSION_HANDOFF_PROTOCOL** — `docs/SESSION_HANDOFF_PROTOCOL.md`. Mal for
sesjons-handoff.

**Shift-settlement** — Agent-skift-oppgjør ved end-of-day.

**Skill** — `.claude/skills/<navn>/SKILL.md`. Prosjekt-spesifikk kontekst
auto-aktivert ved relevant arbeid. 35+ stk.

**Slug** — URL-safe spill-identifikator. `bingo`, `rocket`, `monsterbingo`,
`spillorama`, `candy`.

**Socket.IO** — Real-time framework. Versjon 4.8.

**Spill 1, 2, 3, 4** — Marketing-navn for de fire hovedspillene.
Spill 4 = SpinnGo (databingo).

**Spill71 / §71** — Pengespillforskriften §71 (regulatorisk daglig rapportering).
Implementert via `app_regulatory_ledger` (ADR-0015).

**SpinnGo** — Marketing-navn for Spill 4 (databingo).

**SYSTEM_DESIGN_PRINCIPLES** — `docs/SYSTEM_DESIGN_PRINCIPLES.md`. Design-
filosofi, "true north".

**Swedbank Pay** — Payment-leverandør. KRITISK vendor (eneste payment-vei).

## T

**Tier A/B/C** — Kategorisering av kode-områder etter delegerings-mulighet.
Tier A = Tobias-only (compliance/wallet/RNG). Se `BUS_FACTOR_PLAN.md`.

**Tobias-direktiv** — Bestilling fra Tobias som er immutable inntil han
eksplisitt overstyrer. Eks: "Quality > speed" (2026-05-05).

**TOTP** — Time-based One-Time Password. 2FA i admin-portal.

**Trace-ID** — Request-correlation-ID på tvers av HTTP/Socket. Skill
`trace-id-observability`.

**Trekning** — Se "Draw".

## U

**Unity** — Legacy game-client. 1:1 funksjonell paritet med web (Pixi)
påkrevd. Visuell paritet er valgfri.

## V

**Vendor** — Tredjeparts-leverandør. Liste: `docs/operations/VENDORS.md`.

**Vite** — Frontend-bundler. Versjon 6.3.

## W

**Wallet** — Spiller-balanse-system. Outbox + REPEATABLE READ + hash-chain.
Skill `wallet-outbox-pattern`.

**Wave** — Se "Bølge".

**Wireframe** — Legacy UI-mockups. `docs/wireframes/` (PDF) +
`docs/architecture/WIREFRAME_*.md` (analyse).

---

## §-paragrafer (Pengespillforskriften)

| § | Hva | Hvor i koden |
|---|---|---|
| §11 | Distribusjon til organisasjoner (15 % hovedspill, 30 % databingo) | `apps/backend/src/compliance/` |
| §23 | 1-års self-exclusion | `apps/backend/src/game/ComplianceManager.ts` |
| §66 | Mandatory pause etter 60 min spilling | `apps/backend/src/game/ComplianceManager.ts` |
| §71 | Regulatorisk daglig rapportering, ledger | ADR-0015, `app_regulatory_ledger`-tabell |

---

## Når du ser et begrep som mangler

1. Søk i koden: `Grep` etter begrepet for kontekst
2. Sjekk skills: `ls .claude/skills/` etter relatert
3. Spør Tobias hvis fortsatt uklart
4. **Legg det til her** når du har funnet svaret — det sparer neste PM tid
