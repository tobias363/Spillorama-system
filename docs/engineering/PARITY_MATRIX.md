# Paritet-matrise — Legacy-avkobling Game 1, 2, 3, 5

**Eier:** Teknisk leder
**Linear-referanse:** [BIN-525](https://linear.app/bingosystem/issue/BIN-525)
**Prosjekt:** [Legacy-avkobling: Game 1–5 + backend-paritet](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a)
**Sist oppdatert:** 2026-04-17

> **Release-gate:** Legacy kan **ikke** slås av for et spill før alle rader i dets tabell står **Release-klar = ✅**.
> Denne fila er eneste autoritative statuskilde for paritet-arbeidet. Ved uenighet mellom dette dokumentet og Linear-issuer, stemmer begge oppdateres samtidig.
> Game 4 utgår per [BIN-496](https://linear.app/bingosystem/issue/BIN-496) — ingen matrise.

---

## 1. Legende

| Symbol | Betydning |
|--------|-----------|
| ✅ | Fullført — verifisert mot kode |
| 🟡 | Delvis — startet, mangler ett eller flere akseptkriterier |
| ❌ | Ikke startet |
| 🔵 | Ikke relevant for dette spillet |

**Kolonne-definisjoner:**

- **Legacy i bruk?** Kjører legacy-koden for denne featuren fortsatt i prod (`legacy/unity-backend/` + `legacy/unity-client/`)? "✅" her betyr legacy IKKE lenger brukes (fullt avkoblet).
- **Backend-paritet:** Er featuren implementert i `apps/backend/`?
- **Klient-paritet:** Er featuren implementert i `packages/game-client/` web-native klient?
- **Legacy-refs fjernet?** Finnes det aktive kall fra ny stack til `legacy/` for denne featuren? "✅" betyr ingen kall.
- **Release-klar:** Alle tester grønne + verifisert i staging + ingen blockere. "✅" = klar for hall-for-hall cutover.

Alle fire kolonner må være **✅** for at raden er fullført.

---

## 2. Game 1 — Classic Bingo / Databingo

**Canonical spec:** [`game1-canonical-spec.md`](game1-canonical-spec.md)
**Slug:** `bingo` / `game_1`
**Grid:** 5×5 (fri sentercelle) — 75-ball range

### 2.1 Kjerne-features

| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Rom-join + authoritative state | ✅ | ✅ | ✅ | ✅ | 🟡 | — |
| Billett-kjøp (per-type `TicketSelection[]`) | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Server-autoritativ stake | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `ticket:mark` (privat, ikke full fanout) | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-499](https://linear.app/bingosystem/issue/BIN-499) ✅ merged #108 |
| Claim LINE + BINGO (server-validert) | ✅ | ✅ | ✅ | ✅ | 🟡 | — |
| Trekning (draw:new, drawIndex) | ✅ | ✅ | ✅ | ✅ | 🟡 | — |
| `drawIndex` gap-deteksjon | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-502](https://linear.app/bingosystem/issue/BIN-502) ✅ merged |
| Checkpoint + recovery | ✅ | ✅ | 🔵 | ✅ | 🟡 | — |
| Event-buffer (late-join) | ❌ | ✅ | ❌ | ✅ | ❌ | [BIN-501](https://linear.app/bingosystem/issue/BIN-501) |
| Chat (sanntids) | ✅ | ✅ | ✅ | ✅ | 🟡 | — |
| Chat-persistens (DB) | 🔴 | ❌ | 🔵 | ❌ | ❌ | [BIN-516](https://linear.app/bingosystem/issue/BIN-516) |
| Audio (3 stemmepakker, 60 clips) | ✅ | 🔵 | ✅ | ✅ | ✅ | — |
| Double-announce toggle | ✅ | 🔵 | ✅ | ✅ | ✅ | — |
| Spectator-fase (SPECTATING) | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-507](https://linear.app/bingosystem/issue/BIN-507) ✅ merged |
| Loader-barriere (late-join sync) | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-500](https://linear.app/bingosystem/issue/BIN-500) ✅ merged |
| MAX_DRAWS 75 (fiks fra 60) | ✅ | ✅ | 🔵 | ✅ | ✅ | [BIN-520](https://linear.app/bingosystem/issue/BIN-520) ✅ merged |

### 2.2 Game-specific features

| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Mini-game rotasjon — Wheel of Fortune | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Mini-game rotasjon — Treasure Chest | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Mini-game rotasjon — Mystery | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-505](https://linear.app/bingosystem/issue/BIN-505) ✅ merged #122 |
| Mini-game rotasjon — ColorDraft | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-506](https://linear.app/bingosystem/issue/BIN-506) ✅ merged #122 |
| Elvis replace (real in-place swap) | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-509](https://linear.app/bingosystem/issue/BIN-509) ✅ merged #121 |
| `replaceAmount` debitering | ✅ | ✅ | 🔵 | ✅ | 🟡 | [BIN-509](https://linear.app/bingosystem/issue/BIN-509) ✅ merged (dekker BIN-521) |
| Lucky number picker (60-tall) | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Host manual start | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Per-hall player-data | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Billett-animasjoner (GSAP-parametre) | ✅ | 🔵 | ✅ | ✅ | ✅ | — |

### 2.3 Infrastruktur og drift

| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Socket.IO Redis-adapter (multi-node) | 🔵 | ✅ | 🔵 | ✅ | 🟡 | [BIN-494](https://linear.app/bingosystem/issue/BIN-494) ✅ merged #108 |
| Hall-display / TV-skjerm broadcast | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-498](https://linear.app/bingosystem/issue/BIN-498) |
| AdminHallDisplayLogin | 🔴 | 🟡 | ❌ | ❌ | ❌ | [BIN-503](https://linear.app/bingosystem/issue/BIN-503) |
| Admin hall-events (ready, countdowns) | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-515](https://linear.app/bingosystem/issue/BIN-515) |
| Admin-dashboard m/ rapporter | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-517](https://linear.app/bingosystem/issue/BIN-517) |
| Spillvett cross-game-test | 🔵 | ❌ | 🔵 | ✅ | ❌ | [BIN-541](https://linear.app/bingosystem/issue/BIN-541) |
| E2E pengeflyt-test | 🔵 | ❌ | 🔵 | ✅ | ❌ | [BIN-526](https://linear.app/bingosystem/issue/BIN-526) |
| Wire-kontrakt-test (Zod) | 🔵 | 🟡 | 🟡 | ✅ | 🟡 | [BIN-527](https://linear.app/bingosystem/issue/BIN-527) / [BIN-545](https://linear.app/bingosystem/issue/BIN-545) ✅ merged |
| Load-test 1000+ spillere | 🔵 | ✅ | 🔵 | ✅ | 🟡 | [BIN-508](https://linear.app/bingosystem/issue/BIN-508) ✅ merged, venter på første nattlig-kjøring |
| Observability (Sentry + funnel) | 🔵 | ✅ | ✅ | ✅ | 🟡 | [BIN-539](https://linear.app/bingosystem/issue/BIN-539) — backend + klient + runbook i denne PR |
| Feature-flag rollback-runbook | 🔵 | ❌ | ❌ | ✅ | ❌ | [BIN-540](https://linear.app/bingosystem/issue/BIN-540) |
| iOS Safari WebGL context-loss test | 🔵 | 🔵 | ❌ | ✅ | ❌ | [BIN-542](https://linear.app/bingosystem/issue/BIN-542) |
| GSAP-lisensavklaring | 🔵 | 🔵 | ❌ | ✅ | ❌ | [BIN-538](https://linear.app/bingosystem/issue/BIN-538) |
| Asset-pipeline (Unity → PixiJS) | 🔵 | 🔵 | 🟡 | ✅ | ❌ | [BIN-543](https://linear.app/bingosystem/issue/BIN-543) |
| PlayerPrefs → localStorage mapping | 🔵 | 🔵 | ❌ | ✅ | ❌ | [BIN-544](https://linear.app/bingosystem/issue/BIN-544) |

**Game 1 totalt:** 32 rader — 14 ✅, 16 🟡, 2 ❌. Release-klar: 10 / 32 (31 %). Denne sesjonen: BIN-494, BIN-499, BIN-502, BIN-500, BIN-507, BIN-520 (✅ fullført), BIN-505, BIN-506, BIN-509 (backend ✅), BIN-545, BIN-508, BIN-539 (alle 🟡 release-klar, venter på staging).

---

## 3. Game 2 — Rocket Bingo

**Canonical spec:** [`game2-canonical-spec.md`](game2-canonical-spec.md) (BIN-529 levert)
**Slug:** `rocket`
**Grid:** 3×5 (15 celler) — 60-ball range

### 3.1 Kjerne-features

| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Rom-join + authoritative state | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Billett-kjøp (1 type "standard") | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Ticket-mark (slim) | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-499](https://linear.app/bingosystem/issue/BIN-499) shared (merged) |
| Claim LINE + BINGO | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Trekning + drawIndex | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-502](https://linear.app/bingosystem/issue/BIN-502) shared (merged) |
| Lucky number | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Chat | 🔴 | ✅ | ❌ | ❌ | ❌ | Egen issue må opprettes |
| Audio (nummerannouncement) | 🔴 | 🔵 | ❌ | ❌ | ❌ | Egen issue må opprettes |
| Loader-barriere (late-join) | ❌ | ✅ | ❌ | ✅ | ❌ | Port BIN-500-mønster til G2 |
| SPECTATING-fase | ❌ | ✅ | ❌ | ✅ | ❌ | Port BIN-507-mønster til G2 |
| Eksplisitt kjøp (fjern auto-arm) | ❌ | ✅ | ❌ | ✅ | ❌ | G1 har dette, G2 mangler |

### 3.2 Game-specific features

| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Rakettstabling / animasjon (MVP) | 🔴 | 🔵 | 🟡 | ❌ | ❌ | Polish: egen issue |
| Paginering (multiple tickets) | 🔴 | 🔵 | 🟡 | ❌ | 🟡 | — |
| Blind ticket purchase (`Game2BuyBlindTickets`) | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-511](https://linear.app/bingosystem/issue/BIN-511) |

### 3.3 Canonical spec status

- [x] **BIN-529** — `docs/engineering/game2-canonical-spec.md` skrevet med YAML front-matter (levert)
- Rader verifisert mot kode + legacy `Sockets/game2.js`. Se spec §11 for kjente avvik.

**Game 2 totalt:** 14 rader — 0 ✅, 9 🟡, 5 ❌. **Release-klar: 0/14 (0 %) — MVP-nivå, trenger flere features + staging-integrasjon.**

---

## 4. Game 3 — Monster Bingo / Mønsterbingo

**Canonical spec:** *skal skrives — [BIN-530](https://linear.app/bingosystem/issue/BIN-530)*
**Slug:** (TBD)
**Grid:** 5×5 + animert kulekø

### 4.1 Kjerne-features

| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Rom-join + authoritative state | ❌ | 🟡 | ✅ | ❌ | ❌ | [BIN-530](https://linear.app/bingosystem/issue/BIN-530) |
| Billett-kjøp | ❌ | 🟡 | ✅ | ❌ | ❌ | [BIN-530](https://linear.app/bingosystem/issue/BIN-530) |
| Ticket-mark (slim) | 🔴 | 🔴 | ❌ | ❌ | ❌ | [BIN-499](https://linear.app/bingosystem/issue/BIN-499) (shared) |
| Claim LINE + BINGO | ❌ | 🟡 | ✅ | ❌ | ❌ | [BIN-530](https://linear.app/bingosystem/issue/BIN-530) |
| Trekning + drawIndex | ❌ | ✅ | ✅ | ❌ | ❌ | [BIN-502](https://linear.app/bingosystem/issue/BIN-502) (shared) |
| Chat | ❌ | ✅ | ✅ | ❌ | ❌ | — |

### 4.2 Game-specific features

| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Animert kulekø (velocity + akselerasjon) | 🔴 | 🔵 | 🟡 | ❌ | ❌ | [BIN-530](https://linear.app/bingosystem/issue/BIN-530) |
| Kulekø FIFO (maks 5) | 🔴 | 🔵 | 🟡 | ❌ | ❌ | [BIN-530](https://linear.app/bingosystem/issue/BIN-530) |
| Mønsteranimasjon (ping-pong) | 🔴 | 🔵 | 🟡 | ❌ | ❌ | [BIN-530](https://linear.app/bingosystem/issue/BIN-530) |

### 4.3 Canonical spec status

- [ ] **BIN-530** — skriv `docs/engineering/game3-canonical-spec.md`

**Game 3 totalt:** 9 rader — 0 ✅, 5 🟡, 4 ❌. **Venter på canonical spec.**

---

## 5. Game 5 — Spillorama Bingo

**Canonical spec:** [`game5-canonical-spec.md`](game5-canonical-spec.md) (BIN-531 levert)
**Slug:** `spillorama`
**Grid:** 3×5 (15 celler) — 60-ball range + ruletthjul

### 5.1 Kjerne-features

| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Rom-join + authoritative state | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Billett-kjøp (1 type "standard") | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Ticket-mark (slim) | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-499](https://linear.app/bingosystem/issue/BIN-499) shared (merged) |
| Claim LINE + BINGO | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Trekning + drawIndex | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-502](https://linear.app/bingosystem/issue/BIN-502) shared (merged) |
| Chat | 🔴 | ✅ | ❌ | ❌ | ❌ | Egen issue må opprettes |
| Audio | 🔴 | 🔵 | ❌ | ❌ | ❌ | Egen issue må opprettes |
| Loader-barriere (late-join) | ❌ | ✅ | ❌ | ✅ | ❌ | Port BIN-500-mønster til G5 |
| SPECTATING-fase | ❌ | ✅ | ❌ | ✅ | ❌ | Port BIN-507-mønster til G5 |
| Eksplisitt kjøp (fjern auto-arm) | ❌ | ✅ | ❌ | ✅ | ❌ | G1 har dette, G5 mangler |
| KYC-gatekeep (verified player) | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-514](https://linear.app/bingosystem/issue/BIN-514) |

### 5.2 Game-specific features

| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Ruletthjul (ren GSAP, MVP) | 🔴 | 🔵 | ✅ | ❌ | 🟡 | — |
| Ruletthjul m/ fysikk (matter.js) | 🔴 | 🔵 | 🟡 | ❌ | ❌ | Egen issue: fysikk-port |
| DrumRotation (kontinuerlig) | 🔴 | 🔵 | ❌ | ❌ | ❌ | Egen issue |
| Free Spin Jackpot | 🔴 | ❌ | 🟡 (stub) | ❌ | ❌ | [BIN-531](https://linear.app/bingosystem/issue/BIN-531) oppfølger |
| `SwapTicket` (bytt midt i runde) | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-510](https://linear.app/bingosystem/issue/BIN-510) |
| `SelectWofAuto` / `SelectRouletteAuto` | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-519](https://linear.app/bingosystem/issue/BIN-519) |
| `checkForWinners` eksplisitt | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-512](https://linear.app/bingosystem/issue/BIN-512) |
| Billettfarger (4 varianter) | 🔴 | 🔵 | ❌ | ❌ | ❌ | Egen issue som del av G5 paritet |

### 5.3 Canonical spec status

- [x] **BIN-531** — `docs/engineering/game5-canonical-spec.md` skrevet med YAML front-matter (levert)
- Rader verifisert mot kode + legacy `Sockets/game5.js`. Se spec §11 for kjente avvik.

**Game 5 totalt:** 20 rader — 0 ✅, 11 🟡, 9 ❌. **Release-klar: 0/20 (0 %) — MVP-nivå.**

---

## 6. Overordnet fremdrift

| Spill | Rader | ✅ | 🟡 | ❌ | Release-klar % |
|-------|------:|---:|---:|---:|---------------:|
| Game 1 (Databingo) | 32 | 14 | 16 | 2 | 31 % |
| Game 2 (Rocket) | 14 | 0 | 9 | 5 | 0 % |
| Game 3 (Monster) | 9 | 0 | 5 | 4 | 0 % |
| Game 5 (Spillorama) | 20 | 0 | 11 | 9 | 0 % |
| **Totalt** | **75** | **14** | **41** | **20** | **19 %** |

Totalsum regnet per **Release-klar**-kolonnen — det er den som styrer cutover-beslutning per [`LEGACY_DECOUPLING_STATUS.md`](../architecture/LEGACY_DECOUPLING_STATUS.md).

---

## 7. Fremdriftssekvens (anbefaling)

Rekkefølgen som gir raskest path til GO-staging:

1. **Fundament (alle spill)** — uten disse er per-spill-paritet meningsløst:
   - BIN-494 Redis-adapter
   - BIN-499 ticket:mark slim
   - BIN-520 envConfig clamp
   - BIN-501 event-buffer
   - BIN-502 drawIndex gap
   - BIN-545 Zod shared-types
   - BIN-527 wire-kontrakt-test
2. **Release-gates** — trenger fundamentet før de gir verdi:
   - BIN-508 load-test 1000
   - BIN-526 E2E pengeflyt
   - BIN-541 Spillvett cross-game
3. **Per-spill paritet** (parallelt):
   - BIN-529 Game 2 canonical + gaps
   - BIN-530 Game 3 canonical + gaps
   - BIN-531 Game 5 canonical + gaps
4. **Pre-pilot**:
   - BIN-539 observability
   - BIN-540 feature-flag + rollback
   - BIN-542 iOS Safari test
5. **Pilot én hall** — feature-flag én hall til web
6. **Hall-for-hall cutover**
7. **Fase 5 legacy-sletting** (BIN-537)

---

## 8. Redigerings-policy

Denne fila **må** oppdateres i samme PR som lukker en parity-task. Ingen merge uten at matrisen reflekterer endringen.

**Prosess per PR som endrer matrise:**

1. Identifiser hvilken rad (eller nye rader) berøres
2. Oppdater status-kolonnene basert på faktisk kode-verifikasjon (ikke PR-intensjon)
3. Legg til commit-SHA i "Revisjonshistorikk" (§9) hvis større endring
4. PR-reviewer validerer at matrisen stemmer mot diffen

Automatisk generator fra YAML front-matter i per-spill canonical specs er planlagt — se [BIN-528](https://linear.app/bingosystem/issue/BIN-528)-oppfølgere når G2/G3/G5 specs er på plass.

---

## 9. Revisjonshistorikk

| Dato | Commit-ref | Endring |
|------|-----------|---------|
| 2026-04-17 | (denne PR) | Initial versjon. G1 verifisert mot kode og canonical spec (BIN-528). G2/G3/G5 delvis utfyllt fra README — venter på respektive canonical specs (BIN-529/530/531). |
| 2026-04-17 | BIN-502 PR | Oppdatert G1-rader: BIN-494 Redis-adapter ✅ (backend i main), BIN-499 ticket:mark slim ✅ (backend i main) — begge levert av slot-2 via PR #108. BIN-502 drawIndex gap-deteksjon ✅ (klient i main) — levert i denne PR. Alle tre nå 🟡 "Release-klar" (venter på integrasjon-test i staging). |
| 2026-04-17 | BIN-500 PR | BIN-500 Loader-barriere ✅ (klient i main) — syncReady-checkliste + "Syncer..."-overlay ved RUNNING late-join + syncGap-telemetri. Rad nå 🟡 Release-klar (venter på manuell late-join-test mot staging). |
| 2026-04-17 | BIN-520/545/508 batch | Agent 2 leverte: BIN-520 envConfig MAX_DRAWS 60→75 (✅ fullført), BIN-545 Zod-schema-fundament i packages/shared-types/ (🟡 3 av mange events dekket), BIN-508 Artillery 1000-player load-test (🟡 merged, venter på første nattlig-kjøring). G1 release-klar nå 10/32 (31 %); totalt 14 ✅, 25 🟡, 24 ❌. |
| 2026-04-17 | BIN-539 PR | Observability-fundament: backend Sentry init (`apps/backend/src/observability/sentry.ts`) + errorReporter middleware + ackFailure auto-capture; tre nye Prometheus-metrikker (claim_submitted_total, payout_amount histogram, reconnect_total); klient Sentry sidecar (`packages/game-client/src/telemetry/Sentry.ts`) koblet til eksisterende Telemetry; 30s gap-watchdog via GameBridge.getGapMetrics(); runbook i `docs/operations/OBSERVABILITY_RUNBOOK.md` med terskler + rollback-eierskap. Rad nå 🟡 Release-klar — venter på Grafana-dashboards provisjonert. |
| 2026-04-17 | BIN-507 PR | BIN-507 SPECTATING-fase ✅ (klient i main) — ny phase i Game1Controller, transitions fra start/onGameStarted/handleReconnect, live draws via onSpectatorNumberDrawn, server-guards verifisert (PLAYER_NOT_PARTICIPATING, NOT_ARMED_FOR_GAME, MARKS_NOT_FOUND). Rad nå 🟡 Release-klar (venter på manuell late-join-test mot staging). G1 totalt: 14 ✅, 12 🟡, 6 ❌. |
| 2026-04-17 | BIN-529 PR | Game 2 canonical spec levert — `docs/engineering/game2-canonical-spec.md` med YAML front-matter. G2-matrise utvidet fra 10 → 14 rader (verifisert mot kode + legacy `Sockets/game2.js`): 0 ✅, 9 🟡, 5 ❌. Spec §11 lister avvik fra G1 (SPECTATING, loader-barriere, eksplisitt kjøp) som egne port-issues. Totalsum 67 rader (G1: 32, G2: 14, G3: 9, G5: 12). |
| 2026-04-17 | BIN-509/505/506 batch | Agent 2 leverte: BIN-509 Elvis-replace + replaceAmount debitering (PR #121 `41740f2f`); BIN-505/506 Mystery + ColorDraft 4-way rotation (PR #122 `f31f36c2`). BIN-521 (replaceAmount) dekket via BIN-509. G1 4 rader flyttet ❌ → 🟡. Totalsum G1: 14 ✅, 16 🟡, 2 ❌. |
| 2026-04-17 | BIN-531 PR | Game 5 canonical spec levert — `docs/engineering/game5-canonical-spec.md` med YAML front-matter. G5-matrise utvidet fra 12 → 20 rader: 0 ✅, 11 🟡, 9 ❌. Spec §11 lister 8 G5-unike avvik (rulett-fysikk, Free Spin Jackpot, SwapTicket, KYC, billettfarger, auto-select m.fl.) + G1-paritets-avvik. Totalsum 75 rader (G1: 32, G2: 14, G3: 9, G5: 20). |
