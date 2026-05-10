# R12 — DR-runbook validation plan (BIN-816)

**Status:** Plan klar. Drill-eksekvering avventer Tobias-godkjennelse + on-call-bemanning.
**Generert:** 2026-05-10 av Plan-agent under PM-sesjon (Tobias' direktiv om dokumentasjons-disiplin)
**Linear:** [BIN-816 R12 — DR-runbook validert mot rom-arkitekturen](https://linear.app/bingosystem/issue/BIN-816)
**Mandat:** [`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3 + §6
**Estimat:** 22-28 timer aktiv arbeid (~5-7 kalenderdager ved 1 senior-engineer + 0.5 dag Tobias-gating)
**Eier:** L3 incident commander (foreslått: backend-tech-lead-stedfortreder)
**Sign-off:** Tobias (L4) + compliance-eier + L2 backend on-call + L1 hall-operatør (4 signaturer)

---

## 🚨 Kritisk funn: Navne-kollisjon i S1-S7

**Plan-agent oppdaget 2026-05-10:** Eksisterende `LIVE_ROOM_DR_RUNBOOK.md` bruker S1-S7 for SINE EGNE infrastruktur-scenarier:
- S1: Backend-instans-krasj
- S2: Redis-failover
- S3: Postgres failover
- S4: Region-down
- S5: DDoS
- S6: Rolling restart
- S7: Perpetual-loop-leak

Mens `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` referer til "S1-S7" som application/compliance-scenarier:
- S1: Master-hall fail
- S2: Multi-hall desync
- S3: Ledger poison
- S4: Wallet corruption
- S5: Rate-limit cascade
- S6: RNG drift
- S7: Network partition

**Konsekvens:** Når en runbook sier "S5 = DDoS" og en annen sier "S5 = Rate-limit cascade", kan ops/compliance få feil oppfatning under press. **Må re-numereres eller eksplisitt cross-referenes i §8 av denne planen.**

Denne fallgruven er logget i [`PITFALLS_LOG.md`](../engineering/PITFALLS_LOG.md) §4.X (DR-runbook S1-S7-navne-kollisjon).

---

## 1. Inventory eksisterende DR-runbooks

| Runbook | Primær rolle | Dekker rom-scenario? |
|---|---|---|
| `LIVE_ROOM_DR_RUNBOOK.md` | Rom-spesifikk recovery (S1-S7 i RUNBOOKENS schema) | Delvis — se §2 |
| `DISASTER_RECOVERY_PLAN_2026-04-25.md` | Risikomatrise, RPO/RTO, 8 generelle scenarier | Generell — refererer ut til rom-spesifikk |
| `DR_RUNBOOK.md` (BIN-772) | Operasjonell entry-point + drill-kadens | Peker videre — eier "bevisbyrden" for restore |
| `INCIDENT_RESPONSE_PLAN.md` | P1/P2/P3 + eskaleringstre | Severity-språk, ikke rom-prosedyre |
| `DATABASE_RESTORE_PROCEDURE.md` | Render PITR + drill-prosedyre | Postgres-only, ikke rom-state |
| `REDIS_FAILOVER_PROCEDURE.md` | Redis-utfall + multi-node fanout | Dekker S2 i mandat-schema |
| `WALLET_RECONCILIATION_RUNBOOK.md` | Nattlig `WalletReconciliationService` + alerts | Dekker delvis "wallet corruption" (mandat-S4) |
| `COMPLIANCE_INCIDENT_PROCEDURE.md` | Lotteritilsynet 24t + GDPR 72t-flow | Compliance-prosedyre, ikke teknisk |
| `HOTFIX_PROCESS.md` | Hotfix-trigger + 4-kriterier | Generisk, ikke rom-spesifikk |
| `DEPLOY_ROLLBACK_PROCEDURE.md` | Render redeploy/rollback | Generell |
| `MIGRATION_DEPLOY_RUNBOOK.md` | Migrate-feil under deploy | Generell |
| `ROLLBACK_RUNBOOK.md` | Per-hall `client_variant`-flag | Hall-flip, ikke rom-state |
| `HALL_PILOT_RUNBOOK.md` | SEV-1/2/3 + rollback-trigger | Pilot-vakt, ikke rom-recovery |
| `PILOT_CUTOVER_RUNBOOK.md` | Hall-flip Unity → web | Cutover, ikke recovery |
| `EMERGENCY_RUNBOOK.md` (2026-05-10) | "Tobias utilgjengelig"-quick-card | Decision-tree, ikke prosedyre |
| `R2_FAILOVER_TEST_RESULT.md` | Test-script for backend-failover | Drill-artefakt for runbook-S1 |
| `R10_SPILL3_CHAOS_TEST_RESULT.md` | Spill 3 phase-state chaos-test | Drill-artefakt for Spill 3 phase-recovery |

**Funn:** 13 hoved-runbooks + 4 drill-artefakter. Domenet er forsvarlig dekket på infrastruktur-nivå, men har gaps på application/compliance-nivå.

---

## 2. Gap-analyse mot mandat-S1-S7

| # | Mandat-scenario | Runbook-dekning i dag | Severity |
|---|---|---|---|
| **mandat-S1** | **Master-hall fail** (Spill 1 master dør midt i runde, transferHallAccess-feil) | Eneste touch: 1 setning i `LIVE_ROOM_DR_RUNBOOK §1.1` ("Master-handshake i flight") + "ikke-trygt"-rad i §8.4. INGEN egen scenario-§ for master-fail eller transferHallAccess-handshake-recovery. | **MUST-HAVE** |
| **mandat-S2** | **Multi-hall desync** (haller ser forskjellige draws) | Touchet implisitt i `LIVE_ROOM_DR_RUNBOOK §4.3` ("noen klienter ser nye draws, andre ikke"). Ingen prosedyre. Ingen test. | **MUST-HAVE** |
| **mandat-S3** | **Ledger poison** (corrupt audit-event, hash-chain broken) | `COMPLIANCE_INCIDENT_PROCEDURE.md §1.1` lister "Hash-chain-brudd" som auto-P1, men har INGEN recovery-prosedyre — kun rapport-flow. `WALLET_RECONCILIATION_RUNBOOK.md` dekker balanse-mismatch, ikke chain-brudd. | **MUST-HAVE (største gap)** |
| **mandat-S4** | **Wallet corruption** (saldo-mismatch oppdaget av reconciliation) | `WALLET_RECONCILIATION_RUNBOOK.md` dekker detection + alert. Drill D-RECON-1 bestått 2026-05-01. | Dekket. **Nice-to-have:** live-rom-spesifikk wallet-corruption (R6-relevant). |
| **mandat-S5** | **Rate-limit cascade** (1500 spillere reconnect samtidig, system overload) | `LIVE_ROOM_DR_RUNBOOK §7 (S5 i runbook-schema)` er DDoS, ikke reconnect-storm. Reconnect-grafen nevnes (`spillorama_reconnect_total > 5%/min`) men ingen prosedyre for thundering-herd post-restart. | **MUST-HAVE for pilot >250 spillere** |
| **mandat-S6** | **RNG drift** (draw-engine produserer non-uniform fordeling, compliance-brudd) | INGEN runbook-dekning. RNG-determinisme er testet (`BingoEngine`-tester), men det finnes ingen prosedyre for hva man gjør hvis prod-statistikk avslører drift. | **MUST-HAVE for compliance** |
| **mandat-S7** | **Network partition** (én region får isolert backend-instans) | `LIVE_ROOM_DR_RUNBOOK §6 (S4 i runbook-schema)` dekker full region-down, men IKKE split-brain — to backend-noder som tror de er primær. Multi-node Render-config (BIN-494) gjør dette mulig. | **MUST-HAVE før multi-node-pilot, NICE-TO-HAVE for 1-node-starter** |

---

## 3. Per-spill-spesifikke gaps

### Spill 1 (master-styrt)

| Scenario | Dekket? | Gap |
|---|---|---|
| Master-hall mister internett midt i runde | Nei — kun "hall mister internett" generisk i `DISASTER_RECOVERY_PLAN §5` | Må doc-festes: hva skjer med `pause_at_phase`-flagget? Kan annen hall ta over master via `transferHallAccess`? Hvor lang tap-toleranse? |
| Plan-runtime-state etter master-restart | Delvis — `STALE_PLAN_RUN`-button-flow er nevnt i `LIVE_ROOM_DR_RUNBOOK.md` (master-driven recovery 2026-05-09) og `HALL_PILOT_RUNBOOK §5.1` | Mangler: hva hvis recover-stale-knappen IKKE virker? Eskalerings-sti til DB-edit. Hva skjer med `currentDraw` mid-flight? |
| `transferHallAccess`-handshake-feil (60s-window) | "Ikke-trygt-å-restarte"-flagg i §8.4. Ingen recovery hvis handshake feiler. | Må doc-festes: timeout-håndtering, cancel-prosedyre, idempotency-key for retry |

### Spill 2 (perpetual loop)

| Scenario | Dekket? | Gap |
|---|---|---|
| ROCKET-rom recovery — reconstruere `currentDraw` | `LIVE_ROOM_DR_RUNBOOK §9 (S7 perpetual-loop-leak)` — håndterer leak, men ikke "currentDraw mistet" | Per Tobias-direktiv 2026-05-03: ingen persistent perpetual-state. Det betyr at `currentDraw` recovery er trivielt — neste boot starter ren loop. Men: må doc-festes som EKSPLISITT antakelse. Hva med innesperret prize-pool i `app_game_sessions`? |
| `Spill2Config`-cache-invalidation hvis Redis nede | INGEN runbook-dekning | Må doc-festes: faller `Spill2GlobalRoomService` tilbake til DB-default eller fryser? Konsekvens for jackpot-table-mapping. |
| Jackpot-payout idempotens hvis loop spawner doble runder | `R10_SPILL3_CHAOS_TEST_RESULT.md` invariant I5 (≤ 5 phasesWon) — gjelder Spill 3, ikke Spill 2 | Speiles for Spill 2: invariant for "én gameId = én jackpot-payout" |

### Spill 3 (phase-state-machine)

| Scenario | Dekket? | Gap |
|---|---|---|
| Phase-state recovery (`currentPhaseIndex`, `pausedUntilMs`) | Best-dekket av alle. `R10_SPILL3_CHAOS_TEST_RESULT.md` tester dette med invariants I1-I6 | Drill-test-skriptet finnes men er **ikke kjørt ende-til-ende** ("venter på Docker-stack-kjøring"). Pilot-gating krever faktisk kjøring. |
| Sequential phases-invarianter (R10-test design) | Test-design ferdig, fysisk drill manglende | Inkluderes i Drill F nedenfor |
| Pause-vindu-recovery på tvers av wall-clock-tidshopp (NTP-glitch) | Ikke nevnt | NICE-TO-HAVE: hvis `pausedUntilMs` lagres som wall-clock-timestamp, hva hvis NTP setter klokken bakover? |

---

## 4. Drill-design

For hvert pilot-blokkerende scenario beskrives én drill: pre-state, handling, invariants, estimat.

### Drill A — Master-fail (mandat-S1, Spill 1) — 60 min

**Pre-state:** Demo-stack med 4 haller seedet (`r10-spill3-chaos-test.sh`-pattern). Master = hall_1, deltakere = hall_2/3/4. Aktiv runde i `running` (draw 5/15). Minst én pin-bonded master-PC simulert.

**Handling:**
1. SIGKILL backend-prosessen som master-hall snakker mot.
2. Verifiser at backend auto-restartes innen 90 sek (Render replicate-sim).
3. Master-konsoll skal vise "Henter Spill 1-status..." → tilbake innen 30 sek.
4. Klikk `Resume` i master-konsollet.

**Invariants som verifiseres:**
- I1: `app_game1_draws.draw_sequence` har ingen hull (R2-invariant).
- I2: `master_hall_id` på scheduled_game er uendret.
- I3: Antall ledger-rader pre/post matcher draw-count.
- I4: `pause_at_phase` korrekt etter resume.
- I5: Klient-reconnect < 2 min for alle 4 haller.

**Suksesskriterium:** Recovery-tid < 5 min, 0 datatap. Bruker eksisterende `r2-failover-test.sh` + utvidet for master-rolle.

### Drill B — Multi-hall desync (mandat-S2) — 90 min

**Pre-state:** 2 backend-noder via `docker-compose.chaos.yml`. Begge prosesserer events for samme runde. Socket.IO Redis-adapter aktiv.

**Handling:**
1. `iptables`-regel som dropper pub/sub mellom noden og Redis i 30 sek.
2. Send mock-`bet:arm` fra hall_1 (rutet til node A) og hall_2 (rutet til node B).
3. Snapshot draws sett av hver hall.

**Invariants:**
- Etter Redis-pub/sub-recovery: begge halls ser identisk `drawnNumbers`-sekvens.
- `app_game1_draws.UNIQUE(scheduled_game_id, draw_sequence)` har ikke trigget.
- Ingen klient sitter med "stuck" draw-state > 5 sek.

**Suksesskriterium:** Desync detekteres innen 10 sek, recovery innen 30 sek. **Ny test** — bygges på top av eksisterende `r2-failover-test.sh`.

### Drill C — Ledger poison (mandat-S3) — 120 min

**Pre-state:** Stage med fersk audit-chain. Compliance-eier + Tobias tilstede (kreves for sign-off-trening).

**Handling:**
1. Manuelt korrupter en `app_compliance_audit_log.curr_hash`-rad mid-chain.
2. Kjør `verify:audit-chain` (eller `WalletAuditVerifier`) — skal feile.
3. Følg eksperimentell prosedyre: lås berørte halls, skap forensikk-eksport, signer off-chain-vedlegg, simulér Lotteritilsynet-rapport-skriving (24t-flow).
4. Re-anker chain etter forensikk.

**Invariants:**
- Chain-validering grønn etter re-anker.
- Ingen wallet-touch under låse-perioden.
- Compliance-rapport-template fylt ut innen 24t-vinduet (simulert tids-kompresjon — målet er at compliance-eier kjenner stegene).

**Suksesskriterium:** Compliance-eier kan stå opp og kjøre dette ALENE. **Ny test, krever ny prosedyre i `COMPLIANCE_INCIDENT_PROCEDURE.md`.**

### Drill D — Reconnect-storm (mandat-S5) — 60 min

**Pre-state:** Mock-klient-arsenal (utvid `r3-mock-client.mjs` til 1500 simulerte klienter). Aktiv runde i `running`.

**Handling:**
1. Kill backend.
2. Wait for restart.
3. Trigger alle 1500 mock-klienter til å reconnecte samtidig innen 5 sek.

**Invariants:**
- p95 socket-handshake < 5 sek under storm.
- Backend-CPU stabiliseres < 80% innen 60 sek.
- Ingen `auto.round.tick` glipper under storm.
- 0 wallet-double-debit (idempotency-key-test).

**Suksesskriterium:** 1500 klienter reconnected innen 90 sek, 0 funksjonelle feil. Forutsetter R4-load-test grønt; denne drillen er recovery-side av R4.

### Drill E — RNG drift (mandat-S6) — 90 min

**Pre-state:** Eksport av 30 dager produksjons-/staging-draws (eller syntetisk seedet med kjent bias).

**Handling:**
1. Kjør chi-square-uniformitets-test over draws.
2. Hvis script ikke finnes, bygg minimum-script (Python/Node, ~50 LOC).
3. Sett threshold (foreslått: p < 0.001 over 10 000+ draws).
4. Simulér "drift detektert"-flow: frys aktive runder, manuell trekning, rapport-skriving til Lotteritilsynet.

**Invariants:**
- Script gir konsistent svar på kjent-uniform vs kjent-biased datasett.
- Frys-prosedyre stopper ALLE aktive draws < 60 sek.
- Manuell-fallback-prosedyre (fysiske kuler eller manuell admin-trekk) er definert.

**Suksesskriterium:** Compliance-eier + L2 backend kan kjøre testen. **Helt ny prosedyre + script — bygges fra scratch.**

### Drill F — Spill 3 phase-state (R10 ferdigstillelse) — 60 min

Bruker eksisterende `r10-spill3-chaos-test.sh` ende-til-ende mot Docker-stack (per `R10_SPILL3_CHAOS_TEST_RESULT.md` "venter på Docker-stack-kjøring"). **Bare-bones — kjøre eksisterende script.** Pilot-blokkerende.

### Drill G — Network partition / split-brain (mandat-S7) — 120 min

**Status:** Avhenger av om pilot kjører single-node (Render `starter`) eller multi-node (`pro`). Hvis single-node → kan defereres til post-pilot. **Rekommandasjon: defereres til post-pilot iterasjon med mindre Tobias har bestemt multi-node før go-live.**

---

## 5. Drill-eksekvering

| Drill | Miljø | Infra-krav | Incident commander |
|---|---|---|---|
| A — Master-fail | Staging Docker-stack | Eksisterer (`docker-compose.chaos.yml`); kun pin-mock må legges til | L2 backend |
| B — Desync | Staging Docker-stack | `iptables` på Linux-host (kreves Linux for chaos-ip-manipulering — virker IKKE på dev-Mac uten ekstra setup) | L2 backend + Tobias (split-brain er sensitivt) |
| C — Ledger poison | Staging | Manuell SQL i staging-DB; verify:audit-chain-script finnes | Compliance-eier + Tobias |
| D — Reconnect-storm | Staging | Utvidet `r3-mock-client.mjs` (skalere fra 5 til 1500). Render staging må være sized for 1500 sockets | L2 backend |
| E — RNG drift | Staging + lokal | Chi-square-script bygges (manglende!). 30-dagers draw-eksport tilgjengelig | Compliance-eier |
| F — Spill 3 phase | Staging Docker-stack | Eksisterer | L2 backend |
| G — Split-brain | Defereres | — | — |

**Felles infra-krav:**
- Drill-eier varsler `#ops-cutover` 30 min før (per `LIVE_ROOM_DR_RUNBOOK §12.2`).
- Resultat skrives til `docs/operations/dr-drill-log/<yyyy-mm>-D[X].md`.
- Staging-DB må være isolert fra prod (separate connection-strings — verifisert i §12.4).

**Realistisk tidsbudsjett:**
- Drill A + F er "kjør eksisterende script" → ~2-3 timer hver inkl. rapport-skriving.
- Drill B + D krever script-utvidelse → 4-6 timer hver.
- Drill C + E krever ny prosedyre + script bygges fra scratch → 6-8 timer hver.

---

## 6. Sign-off-kriterier (R12 = ✅)

R12 markeres lukket når:

- [ ] Alle 6 must-have-drills (A, B, C, D, E, F) har kjørt minst én gang i staging og er logget i `dr-drill-log/`.
- [ ] Eksisterende `LIVE_ROOM_DR_RUNBOOK.md` utvidet med nye §§ for mandat-S1 (master), mandat-S2 (desync), mandat-S3 (ledger poison), mandat-S5 (reconnect-storm), mandat-S6 (RNG drift). Eksplisitt mapping mellom mandat-S1-S7 og runbook-S1-S7 (re-numerér eller cross-reference).
- [ ] `COMPLIANCE_INCIDENT_PROCEDURE.md` utvidet med RNG-drift-prosedyre (mandat-S6) og ledger-poison-recovery-prosedyre (mandat-S3).
- [ ] Per-spill-gaps doc-festet: master-fail i Spill 1, Spill2Config-cache-invalidation, Spill 3 phase-recovery (siste er allerede dekket av R10-test-rapport).
- [ ] On-call-rotasjon (`LIVE_ROOM_DR_RUNBOOK §11`) fylt ut med faktiske navn — ikke TBD. Dette er separat ALLEREDE-blokker per skill-instruks.
- [ ] Sign-off fra alle 4 roller per `LIVE_ROOM_DR_RUNBOOK §13`: Tobias, L2 backend, compliance-eier, L1 hall-operatør.
- [ ] Post-mortem-mal validert (kjør én syntetisk drill ende-til-ende inkl. rapport-skriving).
- [ ] Action-items fra alle drills enten lukket eller eskalert til Linear (BIN-XXX) med pilot-blokkerende-flag.

**Hva må dokumenteres etter hver drill:**
- Tidslinje (HH:MM:SS pre-handling, post-handling, recovery-tid).
- Datatap-status (compliance-ledger pre/post-count, mismatch?).
- Sentry-events under drill.
- Findings/gaps i runbook.
- Action-items (hver med Linear-issue eller "akseptert risk").

Per `LIVE_ROOM_DR_RUNBOOK §12.2`, drill-mal eksisterer allerede — gjenbrukes.

---

## 7. Anbefalt rekkefølge

Pilot-blokkerende først, mest-leverte-fundament-først:

1. **Drill F (Spill 3 phase)** — eksisterende script, nesten-ferdig. Lavest hengende frukt. ~2t.
2. **Drill A (Master-fail)** — gjenbruker R2-infra, utvider med pin-handling. Største risiko for Spill 1-pilot. ~4t.
3. **Drill C (Ledger poison)** — compliance-blokker, kan ikke gå live uten. Krever Tobias + compliance-eier samtidig. ~8t.
4. **Drill D (Reconnect-storm)** — pilot kommer til å treffe dette. ~6t.
5. **Drill B (Desync)** — bare hvis multi-node deployes pre-pilot. Kan defereres hvis single-node-`starter`. ~6t.
6. **Drill E (RNG drift)** — nyt script + prosedyre. Lotteritilsynet kan kreve det, men ingen alarm i dag. Kan kjøres siste uka pre-pilot. ~8t.
7. **Drill G (Split-brain)** — defereres til post-pilot iterasjon (forutsetter multi-node).

**Parallellisering:** Drill A + F kan kjøres på samme dag (begge bruker Docker-stack). Drill C + E krever Tobias-tid, koordineres separat.

---

## 8. Hva som krever oppdatering i eksisterende runbooks

Konkret arbeids-liste:

- **`LIVE_ROOM_DR_RUNBOOK.md`** — legg til:
  - §3a Master-fail (mandat-S1) inkl. transferHallAccess-handshake.
  - §3b Multi-hall desync (mandat-S2) inkl. Socket.IO-pub/sub-diagnose.
  - §3c Split-brain / partition (mandat-S7) — defereres med eksplisitt note.
  - §7a Reconnect-storm (mandat-S5) som distinkt fra §7 DDoS.
  - **Mapping-tabell: "Mandat-§3.3 R12-S1...S7" ↔ "denne runbook §3...§9"** (kritisk per navne-kollisjons-funnet).
  - §12.1 utvides med drills A-G + bestått-status.
  - §11 fylles ut med on-call-rotasjon (separat blokker, men hører til R12).

- **`COMPLIANCE_INCIDENT_PROCEDURE.md`** — legg til:
  - Prosedyre for hash-chain-brudd recovery (mandat-S3) — i dag kun "auto-P1"-flagging.
  - Prosedyre for RNG-drift-deteksjon (mandat-S6) — script + threshold + manual-fallback.
  - Test-skript-referanse for `verify:audit-chain`.

- **`WALLET_RECONCILIATION_RUNBOOK.md`** — legg til:
  - Live-rom-spesifikk wallet-corruption-årsak (R6 outbox-relevant) som distinkt fra generell mismatch.

- **`PILOT_RUNBOOK_SPILL2_3_2026-05-05.md`** — legg til:
  - Spill2Config-cache-invalidation-prosedyre.
  - Eksplisitt note: "ingen persistent perpetual-state per Tobias-direktiv 2026-05-03 → boot starter ren loop".

- **`HALL_PILOT_RUNBOOK.md`** §5.1 — utvid eskalerings-tabell med:
  - "Master-pin-tap" → ny rad.
  - "Spill 2/3 perpetual-loop spawner ikke ny runde" → eksisterer i `LIVE_ROOM_DR_RUNBOOK §9`, men bør krysslenke fra §5.1.

Alt skrives på toppen av eksisterende — INGEN nye runbooks.

---

## 9. Realisme-kommentar

22-28 timer er en reell første-iterasjon. Per Tobias-policy ("best effort, fix in drift" er IKKE akseptabelt) bør PM forvente at minst én drill avdekker arkitektur-gap som krever en uke-fix. Ledger-poison-drill (C) er den mest sannsynlige til å trigge dette — vi har ALDRI øvd hash-chain-recovery i prod-likhet. Hvis Drill C avdekker at `WalletAuditVerifier` ikke kan re-ankre uten manuell SQL → eskalér til Tobias per mandat §6.1 før pilot-go-live-møte.

---

## 10. Neste handling

Plan klar for Tobias-godkjennelse. Forslag:

1. **Pre-pilot-go-live-møte:** Tobias gjennomgår denne planen + sign-off-kriterier
2. **Drill F kan kjøres umiddelbart** — eksisterende script, ~2t engineer-tid
3. **Drill A/C/E krever Tobias eller compliance-eier tilstede** — koordineres separat
4. **On-call-rotasjon (separat blokker)** må bemannes før Drill A kan logges som "pilot-validert"

**PM-anbefaling:** Hvis pilot-go-live-dato presser, prioriter Drill A + Drill F + Drill C (master-fail + Spill 3 phase + ledger poison). De 3 dekker pilot-go-live-blokkere i §6 av mandatet. Drill B/D/E kan kjøres post-pilot men før utvidelse til flere haller.

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-10 | Initial — generert av Plan-agent under PM-orkestrering, levert som doc per Tobias' dokumentasjons-direktiv | Plan-agent + PM-AI (Claude Opus 4.7) |
