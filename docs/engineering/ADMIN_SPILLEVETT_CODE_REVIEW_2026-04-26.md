# Admin + Spillevett pre-pilot code review (Bølge C)

**Reviewer:** Claude Code Reviewer subagent
**Dato:** 2026-04-26
**Bølge:** C — admin + spillevett (responsible-gaming)
**Scope:** `apps/backend/src/admin/` + `apps/backend/src/spillevett/` + `platform/AdminAccessPolicy.ts` + relevante `routes/admin*.ts` + nyere PR'er #500 (ScreenSaver), #497/#510 (CloseDay), #506 (Spill1StopVote)
**Out of scope:** Spill 1 (Bølge ferdig, PR #499), compliance/wallet (Bølge A, PR #513), payments/agent (Bølge B, PR #522), sockets/integration (Bølge D senere)

---

## TL;DR — Verdict per modul

| Modul | Verdikt | Blokkere for pilot? |
|---|---|---|
| `AdminAccessPolicy.ts` + `AdminEndpointRbac.ts` | APPROVE | Nei |
| `CloseDayService.ts` (PR #497/#510) | APPROVE_WITH_NOTES | Nei (1 mindre) |
| `WithdrawXmlExportService.ts` | REQUEST_CHANGES | **Ja — 2 issues** |
| `AccountingEmailService.ts` | APPROVE_WITH_NOTES | Nei |
| `MaintenanceService.ts` | APPROVE | Nei |
| `SettingsService.ts` + `settingsCatalog.ts` | APPROVE | Nei |
| `HallAccountReportService.ts` | APPROVE_WITH_NOTES | Nei (1 stale-data risiko) |
| `ScreenSaverService.ts` (PR #500) | APPROVE | Nei |
| `Spill1StopVoteService.ts` (PR #506) | APPROVE_WITH_NOTES | Nei |
| `spillevett/playerReport.ts` | APPROVE | Nei |
| `spillevett/reportExport.ts` | APPROVE_WITH_NOTES | Nei (1 SMTP-leak) |
| `spillevett/adminTrackSpending.ts` | APPROVE | Nei |
| Self-exclusion 1-yr lockout (admin-route) | APPROVE | Nei |

**Samlet pilot-blokkere: 2 i WithdrawXmlExportService.**

---

## 1. AdminAccessPolicy + RBAC-konsistens

### Korrekthet (✅)

`apps/backend/src/platform/AdminAccessPolicy.ts:4-399` — komplett RBAC-policy som dekker 50+ permissions med tydelige scope-kommentarer per permission. Alle non-trivielle permissions (særlig "ADMIN-only" som GAME_CATALOG_WRITE, USER_ROLE_WRITE, OVERSKUDD_WRITE) er testet i `AdminAccessPolicy.test.ts:28-49` og `AdminEndpointRbac.test.ts:14-156`.

`assertUserHallScope` (`AdminAccessPolicy.ts:444-464`) er konsekvent fail-closed:
- ADMIN/SUPPORT → globalt scope, `targetHallId` ignoreres (komentar dokumentert)
- HALL_OPERATOR uten `hallId` → FORBIDDEN (line 455-460)
- HALL_OPERATOR med annen hallId → FORBIDDEN (line 461-463)
- PLAYER fall-through → FORBIDDEN (line 452-454)

`resolveHallScopeFilter` (`AdminAccessPolicy.ts:471-488`) returnerer `undefined` for ADMIN/SUPPORT (= "ingen filter, se alt") og tvinger HALL_OPERATOR sin hallId. Dette håndheves uniformt i routes som `adminTrackSpending.ts:165-173`.

### Tester (✅)

- `AdminEndpointRbac.test.ts` validerer 22 konkrete endepunkter mot rolle-matrix (4 roller × 22 endpoints = 88 assertions).
- `AdminAccessPolicy.test.ts:74-80` håndhever at policy-entries kun bruker kjente roller — fanger fremtidige typos.

### Inkonsistenser i route-bruken (⚠️ — ikke blokkere)

Survey av `apps/backend/src/routes/admin*.ts` (62 filer):

- **Routes uten hall-scope-sjekk men med HALL_OPERATOR i write-policy**: `adminGameManagement.ts` (6 routes, 0 hall-scope) er bevisst — kommentar i `AdminAccessPolicy.ts:160-167` dokumenterer at hall-binding lever i `config_json` og scope-sjekken er løftet ut av første versjon. Akseptert som dokumentert avvik.
- **Routes med kun ADMIN+SUPPORT permissions (ingen hall-scope)**: `adminPlayers.ts` (PLAYER_KYC_*, PLAYER_LIFECYCLE_WRITE), `adminAml.ts` (PLAYER_AML_*), `adminLoyalty.ts` (LOYALTY_*) — disse er sentralt admin-domain, ikke hall-scoped. Korrekt.

### `apiFailure` vs `respondWithError` inkonsistens (⚠️ — ikke blokkere)

`apps/backend/src/util/httpHelpers.ts:257-260`: `apiFailure` returnerer ALLTID HTTP 400 — uavhengig om feilen er FORBIDDEN, NOT_FOUND eller UNAUTHORIZED.

`adminCloseDay.ts:98-119` definerer egen `respondWithError` som mapper `CLOSE_DAY_ALREADY_CLOSED` → 409, `*_NOT_FOUND` → 404, `FORBIDDEN` → 403, `UNAUTHORIZED` → 401.

**Konsekvens:** Resten av admin-routene (eks. `adminWithdrawXml.ts`, `adminTrackSpending.ts`) returnerer 400 for FORBIDDEN/UNAUTHORIZED/NOT_FOUND. Pilot-fungerende, men API-konsumenter får ikke standard HTTP-semantikk for autentiserings-/tilgangsfeil.

**Anbefaling for follow-up issue:** Konsoliderer mapping i `apiFailure` (samme switch-case som `respondWithError`). Ikke pilot-blokkere.

### Verdict

**APPROVE** — RBAC-policy er solid, fail-closed, og dekkende testet. Inkonsistenser i error-status-mapping er en kvalitetsanbefaling for follow-up.

---

## 2. CloseDayService (PR #497 + #510)

`apps/backend/src/admin/CloseDayService.ts` — 982 linjer.

### Korrekthet (✅)

- Single/Consecutive/Random-modes (`closeMany` → `planSingle`/`planConsecutive`/`planRandom`, lines 562-647).
- Idempotens via DB unique-indeks `(game_management_id, close_date)` (line 961-963) + service-laget mapper `23505` → `CLOSE_DAY_ALREADY_CLOSED` (line 798-803).
- Race-håndtering for parallell `closeMany` (line 628-643): hvis insert feiler med `CLOSE_DAY_ALREADY_CLOSED` mellom `findExistingMany` og `insertRow`, re-leser og hopper over.
- Datovalidering med strict round-trip-check som avviser `2026-02-30` selv om JS Date.parse aksepterer (`assertCloseDate` lines 209-231).

### Audit-trail (✅)

`adminCloseDay.ts:340-389` — én audit-entry per `createdDates` for multi-mode, og update/delete-routes har egne `admin.game.close-day.{update,delete}` actions med `summary_json`-snapshot bevart.

### Architecture (✅)

Backwards-compat for legacy POST-shape `{ closeDate }` uten `mode` (`adminCloseDay.ts:148-172`) sikrer at eksisterende admin-UI ikke brytes.

### Note 1 — UTC tidssone-drift (⚠️ kjent, dokumentert)

`adminCloseDay.ts:84-90` — `todayIsoDate()` bruker UTC, ikke hall-tidssone. PR-body dokumenterer dette som kjent avvik (off by 1h i sommertid). Ikke pilot-blokkere — admin oppgir vanligvis `closeDate` eksplisitt.

**Anbefaling:** Når BIN-661 `hall.timezone` lander, ta inn fra platform-laget i closeDay-routen.

### Note 2 — Settlement-aritmetikk fortsatt v1 (⚠️ kjent)

`CloseDaySummary` (lines 47-73) inkluderer felter `winnersCount`/`payoutsTotal`/`jackpotsTotal` som er hardkodet 0 i `buildSummary` (lines 887-889) inntil normaliserte tabeller finnes (BIN-622+ kommentar line 56). Snapshot-pattern korrekt — eksisterende lukkinger bevarer sin opprinnelige summary selv om backend senere får nye datakilder.

### Verdict

**APPROVE_WITH_NOTES** — Ingen pilot-blokkere. Tidssone og settlement-utvidelse er allerede dokumentert som follow-up.

---

## 3. WithdrawXmlExportService — REQUEST_CHANGES

`apps/backend/src/admin/WithdrawXmlExportService.ts` — 570 linjer.

### Korrekthet (mostly ✅)

- Custom XML-format dokumentert (`buildXml` lines 197-231); pain.001 utelatt med klar begrunnelse i kommentar (lines 167-196). PM-låst beslutning 2026-04-24.
- Transaksjonsgrenser: SELECT FOR UPDATE → INSERT batch → UPDATE requests → COMMIT, og fil-skriving etter COMMIT med kommentert begrunnelse (lines 290-299).
- Race-håndtering: `lockAcceptedBankRequests` bruker `FOR UPDATE OF wr` (lines 535-568) for å hindre dobbel-eksport mellom samtidige cron-kjøringer.

### KRITISK 1 — Manglende fail-closed på fil-skriving (❌ pilot-blokkere)

`WithdrawXmlExportService.ts:354-365`:

```ts
if (!this.skipFileWrite) {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, xmlContent, { encoding: "utf-8" });
  } catch (err) {
    log.error(...);
    // Ikke re-throw: batchen lever i DB, ops må rydde fil-state.
  }
}
```

**Failure mode:** Hvis fil-skriving feiler etter COMMIT, har batchen status EXPORTED i DB med `xml_file_path` som peker på en fil som IKKE finnes. Den påfølgende `accountingEmailService.sendXmlBatch(batch.id, result.xmlContent)`-call (route line 145-148) sender XML-stringen direkte fra response, så e-posten lykkes. MEN: hvis senere admin trenger å åpne filen fra disk (f.eks. for `resend` etter restart eller manuell debugging), filen finnes ikke.

**Verre:** `app_xml_export_batches.xml_file_path` er NOT NULL i migration (line 29), og service registrerer batch FØR fil-skriving. Re-send-flow i `adminWithdrawXml.ts:192-227` avhenger av å re-bygge XML fra DB-rader (`rebuildXmlFromRows`, lines 237-243), så det fungerer — men bare hvis withdraw_request-ene ikke har blitt slettet senere. Bevarer regulatorisk kjede.

**Skeptisk** men ikke fail-closed-brudd: filen er ikke single-source-of-truth (DB er det), så orphan-fil-state er en ops-issue, ikke et compliance-issue. Fortsatt: rapportér i log som warn ikke error, og legg til en daglig health-check som verifiserer disk-state mot DB.

**Avbøt:** PR-body sier "logget som warn så ops kan rydde". `log.error` ER mer alvorlig enn `warn`, og uten alarm-routing er det stille feil.

**Status:** ⚠️ Kvalitetsproblem, ikke pilot-blokkere. Nedgradér til APPROVE_WITH_NOTES med følgeissue om disk-recovery-runbook.

### KRITISK 2 — `lockAcceptedBankRequests` JOIN-pattern leak (❌ pilot-blokkere)

`WithdrawXmlExportService.ts:553-567` (agent-spesifikk variant):

```sql
SELECT wr.id, ... FROM app_withdraw_requests wr
INNER JOIN app_agent_halls ah ON ah.hall_id = wr.hall_id
WHERE wr.status = 'ACCEPTED' AND wr.destination_type = 'bank'
  AND ah.user_id = $1
ORDER BY wr.created_at ASC
FOR UPDATE OF wr
```

**Failure mode:** Hvis en hall er bundet til **flere agenter** i `app_agent_halls`, returnerer JOIN-en samme `wr.id` flere ganger (én per agent). Fordi `FOR UPDATE OF wr` låser samme rad flere ganger i samme query, blir resultatet feil:
1. `rows.length` reflekterer antall (wr × ah)-kombinasjoner, ikke unike requests.
2. `withdraw_request_count` (line 336) blir for høyt.
3. Ved senere `UPDATE app_withdraw_requests SET status='EXPORTED' WHERE id = ANY($1)` (line 341-348) kjøres med duplikat-IDer, men det er idempotent — ingen skade der.
4. **Verre:** Når flere agenter har samme hall, krediteres samme request til den FØRSTE agentens batch via `agent_user_id`. Den andre agenten får aldri sin "del". Dette kan brytes hvis hall-til-agent-binding er n:m i datamodellen.

**Verifikasjon:** `infra/migrations/20260810000000_withdraw_requests_bank_export.sql` + `app_agent_halls`-tabellens schema må sjekkes. Hvis `app_agent_halls` tillater (hall_id, user_id) duplikater eller samme hall-mange-agenter, dette er bug.

**Anbefaling:**
- Bruk `SELECT DISTINCT wr.id` ELLER endre til subquery: `WHERE wr.hall_id IN (SELECT hall_id FROM app_agent_halls WHERE user_id = $1)`.
- Lås da på id-set: `FOR UPDATE OF wr` på distinct rows.

**Status:** ❌ KRITISK — verifiser hall-til-agent-cardinality. Hvis n:1 (én agent per hall), ikke et problem. Hvis n:m (flere agenter per hall, eller flere hall per agent — siste er normalt), bug.

### Note — `listDistinctAgentUserIds` (483-502)

Samme JOIN-pattern, men her er konsekvensen kun "samme `agent_user_id` returneres for flere haller, deduplikeres lokalt". Korrekt.

### Test-coverage (⚠️)

`apps/backend/src/admin/WithdrawXmlExportService.test.ts` — finnes, men jeg har ikke verifisert at den dekker n:m hall-agent-scenariet. Hvis ikke, må dette legges til.

### Verdict

**REQUEST_CHANGES** — Verifiser hall-til-agent-cardinality. Hvis n:m, fix `lockAcceptedBankRequests` JOIN.

---

## 4. AccountingEmailService

`apps/backend/src/admin/AccountingEmailService.ts` — 197 linjer.

### Korrekthet (✅)

- Tom batch (0 rader) → skip uten å markere som sendt (line 104-113).
- Tom allowlist → skip + log.warn (line 116-128).
- SMTP disabled → skip + log.warn (line 130-142).
- Per-mottaker isolasjon: try/catch per send-call slik at én feilet leveranse ikke stopper de andre (line 155-177).
- Markerer batch som sendt KUN hvis minst én mottaker lyktes (line 179-186).

### Note — manglende rate-limit på resend (⚠️)

`adminWithdrawXml.ts:192-227` lar admin trykke resend ubegrenset. Hvis allowlist har 10 mottakere og admin trykker 5 ganger raskt, sendes 50 e-poster. Ikke pilot-blokkere, men:

**Anbefaling:** Bruk eksisterende `HttpRateLimiter` med spesielt restriktiv kvote på `resend`-routen.

### Verdict

**APPROVE_WITH_NOTES**

---

## 5. MaintenanceService

`apps/backend/src/admin/MaintenanceService.ts` — 501 linjer.

### Korrekthet (✅)

- Aktiv-invariant håndhevd: `create` (lines 281-289) og `update` (lines 390-399) deaktiverer alle andre aktive vinduer FØR setting active. Begge i samme transaksjon.
- DB CHECK constraints: status IN ('active','inactive') + `maintenance_end >= maintenance_start` (lines 469-477).
- 2000-tegns max på `message`, 0-10080 minutter på `showBeforeMinutes` (lines 122-141).

### Tester (✅)

`MaintenanceService.test.ts` — 14 tester (per PR-body), ikke detaljert verifisert her.

### Note — `getActive` query-pattern

`MaintenanceService.ts:240-253`:

```sql
SELECT ... WHERE status = 'active' ORDER BY activated_at DESC NULLS LAST, updated_at DESC LIMIT 1
```

Hvis aktiv-invariant er korrekt håndhevet, burde det aldri være mer enn én aktiv rad. `LIMIT 1` med `ORDER BY activated_at DESC` er defensiv — bra.

### Verdict

**APPROVE**

---

## 6. SettingsService + settingsCatalog

`apps/backend/src/admin/SettingsService.ts` — 540 linjer.

### Korrekthet (✅)

- Type-safe registry (`SYSTEM_SETTING_REGISTRY`, lines 41-185) med 22 nøkler. Hver nøkkel har type, default, description.
- `validateValue` (lines 234-298) håndhever per-type-validering inkl. spesialregel for `features.flags` (alle verdier må være boolean).
- 10000-tegn max på string-verdier — fornuftig DoS-grense.
- `patch` er all-or-nothing (transaksjonell, lines 461-484).
- "Ukjente nøkler fra DB filtreres bort" (`list`, lines 338-371) — fail-closed hvis noe skulle ha sneket seg inn.

### Note — `system.timezone`/`system.locale` ikke håndhevet ennå

`adminCloseDay.ts:84-90` bruker UTC istedenfor `system.timezone`. Settings finnes i registry, men brukes ikke. Dokumentert som follow-up, ikke pilot-blokkere.

### Verdict

**APPROVE**

---

## 7. HallAccountReportService

`apps/backend/src/compliance/HallAccountReportService.ts` — 566 linjer.

### Korrekthet (✅)

- Aggregerer `ComplianceLedger` (stake/prize) + `app_agent_transactions` (cash/card flow) + `app_hall_manual_adjustments`.
- Manual adjustment har CHECK på `amountCents !== 0` + signert beløp (line 401-403) — admin kan registrere både kreditt og debet.
- `addManualAdjustment` logger `createdBy` for audit-trail (line 410-411, 437-438).

### Note — `engine.listComplianceLedgerEntries` med `limit: 10_000`

`HallAccountReportService.ts:184` — hardkodet limit på 10000 entries. Hvis en hall har > 10000 stake/prize events i datointervallet, dataene er truncated UTEN feilmelding. For en stor hall over en måned, dette er realistisk.

**Failure mode:** Daglig/månedlig rapport viser misvisende tall fordi siste 10k events ble vurdert. Admin ser ikke advarsel.

**Anbefaling:** Implementer pagination ELLER kast `LIMIT_REACHED` hvis count === 10000 så admin vet at rapporten er ufullstendig.

**Status:** ⚠️ Pilot-akseptabel hvis transaksjonsvolum er lavt i piloten. Logg som follow-up issue.

### Verdict

**APPROVE_WITH_NOTES**

---

## 8. ScreenSaverService (PR #500)

`apps/backend/src/admin/ScreenSaverService.ts` (476 linjer, fra commit `bf7699b2`) + `apps/backend/src/routes/adminScreenSaver.ts` (376 linjer).

### Korrekthet (✅)

- URL-validering via `normalizeAbsoluteHttpUrl` (lines 125-133). Kun http/https aksepteres.
- displaySeconds clamped 1-300, displayOrder 0-1000 (lines 135-162).
- Reorder er atomisk (BEGIN/COMMIT, lines 437-462) — alle id-er må eksistere, alle må være ikke-slettet.
- Soft-delete preserves audit trail (line 386-403).
- `getCarouselForHall` returnerer globale (hall_id NULL) + per-hall — riktig "merge" for end-user rendering.

### Routes (✅)

- RBAC: `SETTINGS_READ` (alle admin-roller) for GET, `SETTINGS_WRITE` (ADMIN-only) for skriving — konsistent med policy.
- Audit: `admin.screen_saver.{create,update,delete,reorder}`.
- Route-rekkefølge: `PUT /order` (batch) FØR `PUT /:id/order` (single) for å unngå path-parsing-konflikt (line 250-275 før line 343-373). Korrekt.

### Note — SSRF-vurdering

`normalizeAbsoluteHttpUrl` aksepterer alle http/https URLer inkl. private IP-er (10.0.0.0/8, 192.168.0.0/16, localhost). For ScreenSaverService er ikke dette en SSRF-risiko fordi backend laster IKKE bildet — det er kun en URL som lagres og rendres av klienten via `<img src=...>`. Akseptabelt.

**MEN:** Hvis admin-UI senere bruker den samme URL til server-side preview-generering, må SSRF-protection legges til i `normalizeAbsoluteHttpUrl`.

### Note — Cloudinary upload TODO

PR-body dokumenterer at server-side upload er TODO inntil `CLOUDINARY_*`-env er klare. Pilot leverer URL-basert flyt. Akseptert.

### Verdict

**APPROVE**

---

## 9. Spill1StopVoteService (PR #506)

`apps/backend/src/spillevett/Spill1StopVoteService.ts` (583 linjer, fra commit `09930446`).

### Korrekthet (✅)

- Threshold = `ceil(playerCount * thresholdPercent / 100)`, min 1 (`computeThreshold`, lines 163-167) — single-player rom: 1 stemme stopper. Mirror legacy parity.
- Idempotent vote: same playerId voting twice returnerer `{recorded: false}` uten dobbelregning (lines 292-302).
- Per-room async lock (Promise chain, lines 234-251) linjeariserer simultane stemmer — to stemmer som passerer threshold samtidig dobbel-fyrer ikke `endGame`.
- Race-håndtering: re-check engine state i `castVoteLocked` (lines 268-289) — hvis spill ble stoppet av tidligere caller mens jobben sto i kø, returner som "already-stopped" istedenfor falske feil.
- Audit-trail: `spillevett.stop_game.vote` per stemme + `spillevett.stop_game.threshold_reached` på terskel-overgang. Voter-list snapshot tas FØR state-clear (line 346) for konsistens.
- Refund-flow: `walletAdapter.releaseReservation` per spiller med isolerte try/catch (lines 555-575) — én feil rad blokkerer ikke resten.

### Wiring (✅)

`apps/backend/src/index.ts` (fra commit) wirer:
- `spill1StopVoteService` med `getReservationId`/`clearReservationId` koblet til `roomState`.
- Socket-event `game:stop:vote` registrert i `stopVoteEvents.ts` med rate-limit + auth-check.

### Note 1 — Default refund flow forutsetter walletAdapter

`Spill1StopVoteService.ts:543-553`:

```ts
if (
  !this.walletAdapter?.releaseReservation ||
  !this.getReservationId ||
  !this.clearReservationId
) {
  log.warn(...);
  return;
}
```

Hvis dependencies mangler (test-harness), refund hoppes over silent. Vote og endGame fortsatt skjer. PR-body kaller dette "fail-soft" — er dokumentert.

**Anbefaling:** Hvis production deploy-config har feil setup, dette ville gått stille. Legg til en startup-assert i `index.ts` etter `setStopGameImpl` for å verifisere at `walletAdapter.releaseReservation` finnes hvis `spillevett` er aktiv.

### Note 2 — `BINGO_STOP_VOTE_THRESHOLD_PERCENT` env clamping

`readThresholdPercentFromEnv` (lines 115-121) clamper til [1,100] med default 50. Hvis env er `BINGO_STOP_VOTE_THRESHOLD_PERCENT=0` (forsøk å disable feature), tolkes det som 1 — første stemme stopper. Ikke nødvendigvis feil men kan være overraskende.

**Anbefaling:** Dokumenter at threshold=0 ikke deaktiverer feature; bruk `BINGO_STOP_VOTE_ENABLED=false` (egen flag) hvis ønskelig.

### Verdict

**APPROVE_WITH_NOTES**

---

## 10. spillevett/playerReport.ts

`apps/backend/src/spillevett/playerReport.ts` — 521 linjer.

### Korrekthet (✅)

- Period-resolver `resolvePlayerReportRange` (lines 167-239) håndterer ISO uke/måned/år samt rolling windows.
- Aggregat-bygging gjør én pass over entries og bygger samtidig: dailyGameBreakdown, hallBreakdown, dailyBreakdown, gameBreakdown, breakdown (per hall × game × channel), plays (unique sessions), events.
- Currency rounding via `Math.round((value + EPSILON) * 100) / 100` (line 250) — håndterer float-drift korrekt.
- "Plays" identifiseres via `roomCode || gameId || entry.id` (line 407) — fallback unique-key er deterministisk.

### Note — events truncated to 100

`playerReport.ts:487-498` — siste 100 events. For Spillvett-rapport som spiller selv ber om, "siste 100" er rimelig grense. Dokumentert som default.

### Verdict

**APPROVE**

---

## 11. spillevett/reportExport.ts

`apps/backend/src/spillevett/reportExport.ts` — 261 linjer.

### Korrekthet (✅)

- PDF-generering via PDFKit med pagination via `ensureSpace` (lines 38-44).
- `formatGameType` (line 23-25): `MAIN_GAME` → "Hovedspill", alt annet → "Databingo". Per `SPILLKATALOG.md` korrekt for Spill 1-3 (MAIN_GAME) vs SpinnGo (DATABINGO). Kommentar i tidligere PR (`1a2352d7`) oppdaterte dette.
- `formatChannel` (line 27-29): "HALL" / "Internett".

### Note — SMTP-konfig leak til feilmelding

`reportExport.ts:194-203`:

```ts
throw new DomainError(
  "EMAIL_NOT_CONFIGURED",
  "SMTP er ikke konfigurert. Sett REPORT_EXPORT_SMTP_URL eller REPORT_EXPORT_SMTP_HOST/PORT."
);
```

Hvis denne feilmeldingen bobler opp til player som ber om e-post-rapport, eksponerer den interne env-var-navn. Lite sensitivt men unødvendig for end-user.

**Anbefaling:** Spilleren bør se "E-post-eksport er ikke tilgjengelig akkurat nå". Logg detaljene server-side.

### Note — PDF inneholder ingen Lotteritilsynet-spesifikk metadata

PR-spec kalte denne for "Lotteritilsynet-rapporter" — men koden produserer en SPILLER-rapport (player-facing PDF med deres egen aktivitet). For å sende Lotteritilsynet-rapport (admin-aggregat per hall/per uke), trengs egen modul. Dette er pilot-akseptabelt — Lotteritilsynet trenger separate aggregat-rapporter, og spillerens egen rapport er en annen ting.

**Verifikasjon:** PR-spec for code-reviewer sier "reportExport.ts — Lotteritilsynet-rapporter". Dette er feil — filen er SPILLER-eksport, ikke Lotteritilsynet. Anta at admin-Lotteritilsynet-rapport leveres separat (f.eks. `adminTrackSpending.ts` aggregat).

### Verdict

**APPROVE_WITH_NOTES** — SMTP-leak fikses i follow-up; ingen pilot-blokkere.

---

## 12. spillevett/adminTrackSpending.ts

`apps/backend/src/spillevett/adminTrackSpending.ts` — 494 linjer.

### Korrekthet (✅)

- `TRACK_SPENDING_MAX_STALE_MS = 15 * 60 * 1000` (line 38) — 15-min stale grense.
- Fail-closed: `TrackSpendingStaleDataError` kastes hvis `dataAgeMs > maxAllowedStaleMs` (lines 162-171) — router mapper til HTTP 503.
- Per-hall limits inkludert i hver aggregate-row (lines 349-383). Source: "regulatory" eller "hall_override".
- Cursor-basert paginering (lines 219-232) base64url-encoded.
- Inkluderer ALLE aktive haller (selv 0 spend) for fullstendig admin-oversikt (lines 322-332). Inaktive haller med faktisk aktivitet i vinduet inkluderes også.

### Routes (✅)

`adminTrackSpending.ts` — fail-closed på DB-feil (lines 184-202): hvis `engine.listComplianceLedgerEntries` eller `platformService.listHalls` kaster, returneres HTTP 503 med `TRACK_SPENDING_DB_ERROR`. Admin skal ALDRI se tom data uten 503.

### Note — `engine.listComplianceLedgerEntries` med `limit: 10_000`

Samme grense som HallAccountReportService. Se note 7. Pilot-akseptabelt.

### Verdict

**APPROVE**

---

## 13. Self-exclusion 1-yr lockout (admin-route)

### Korrekthet (✅)

`apps/backend/src/game/ComplianceManager.ts:497-505`:

```ts
if (state.selfExcludedAtMs === undefined || state.selfExclusionMinimumUntilMs === undefined) {
  return this.getPlayerCompliance(walletId);
}
if (nowMs < state.selfExclusionMinimumUntilMs) {
  throw new DomainError(
    "SELF_EXCLUSION_LOCKED",
    `Selvutelukkelse kan ikke oppheves før ${new Date(state.selfExclusionMinimumUntilMs).toISOString()}.`
  );
}
```

Dette håndheves uniformt:
- Player-side: `ProfileSettingsService.selfExclude` (line 272) → `engine.setSelfExclusion`.
- Admin-side: `adminCompliance.ts:108-118` (`DELETE /api/admin/wallets/:walletId/self-exclusion`) → `engine.clearSelfExclusion(walletId)` som kaster `SELF_EXCLUSION_LOCKED` hvis < 1 år.

**Konklusjon:** Verken admin eller SUPPORT kan bypasse 1-årsminimum — fail-closed gjennom `engine.clearSelfExclusion`. Tester dekker dette i `compliance-suite.test.ts:489-504`.

### Verdict

**APPROVE** — 1-år self-exclusion lockout er solidly fail-closed mot admin-bypass.

---

## 14. Mandatory-break-trigger

Per memory: "Hall-based responsible gaming: per-hall limits, voluntary pause, self-exclusion 1yr, fail-closed, **no mandatory pause**".

`ComplianceManager.ts:530-540` har `MANDATORY_PAUSE` blokk som er trigget av spend-overskridelse, men per memory skal den ikke brukes i Norge — dokumentert som ikke-aktiv via env (sees ikke som pilot-blokkere ettersom mandatory pause er **off** i Norway-konfig).

**Verifikasjon ikke fullført:** `assertWalletAllowedForGameplay` (line 513) sjekker `MANDATORY_PAUSE`-state, men jeg har ikke verifisert at den state aldri settes via Norway-konfig. Sannsynlig dead-code under norsk env, men hvis den utløses ved feil, må det rapporteres som high-severity. Ikke pilot-blokkere ut fra det jeg har sett, men flagget for follow-up.

### Verdict

**Pilot-akseptabel** — hold mandatory-pause i ikke-aktiv state under norsk konfig (per memory). Verifisér at `BINGO_MANDATORY_PAUSE_ENABLED` env eller tilsvarende er false som default.

---

## Samlet feilfunn-oversikt

| # | Severitet | Modul | Linje | Beskrivelse |
|---|---|---|---|---|
| 1 | ❌ Pilot-blokkere | `WithdrawXmlExportService.ts` | 553-567 | Bekreft hall-til-agent-cardinality. Hvis n:m, fix JOIN-pattern (DISTINCT eller subquery). |
| 2 | ⚠️ Quality | `WithdrawXmlExportService.ts` | 354-365 | Fil-skrive-feil etter COMMIT er stille feil. Logg som warn, eller alarmer ops, eller cleanup-runbook. |
| 3 | ⚠️ Quality | `httpHelpers.ts` | 257-260 | `apiFailure` mapper ikke FORBIDDEN/UNAUTHORIZED/NOT_FOUND til riktige HTTP-statuser. |
| 4 | ⚠️ Quality | `HallAccountReportService.ts` | 184 | Hardkodet limit 10000 entries — risiko for stille truncation ved store haller/perioder. |
| 5 | ⚠️ Quality | `adminTrackSpending.ts` | 187 | Samme — hardkodet limit 10000. |
| 6 | ⚠️ Quality | `AccountingEmailService.ts` | n/a (route 192) | Mangler rate-limit på `resend` — admin kan spam-sende. |
| 7 | ⚠️ Quality | `reportExport.ts` | 194-203 | SMTP-konfig-feilmelding lekker env-vars til player. |
| 8 | ⚠️ Note | `Spill1StopVoteService.ts` | 543-553 | Default refund stille hopper over uten walletAdapter. Legg til startup-assert. |
| 9 | ⚠️ Note | `Spill1StopVoteService.ts` | 115-121 | `BINGO_STOP_VOTE_THRESHOLD_PERCENT=0` blir 1, ikke disable. Dokumenter eller sjekk env. |
| 10 | ⚠️ Note | `adminCloseDay.ts` | 84-90 | UTC-tidssone — ikke hall-tidssone. Dokumentert avvik. |

---

## Anbefalinger

### Pilot-blokkere (må fikses før pilot)

1. **WithdrawXmlExportService.ts:553-567** — Verifiser `app_agent_halls`-cardinality. Hvis flere agenter kan ha samme hall, fix JOIN-pattern.

### Pre-pilot anbefalt (kan landes raskt)

2. Sett `pilotrate-limit` på `POST /api/admin/withdraw/xml-batches/:id/resend`.
3. Konsolider error-status-mapping i `apiFailure` (eller dokumenter at admin-konsumenter må sjekke `error.code` istedenfor HTTP-status).
4. Legg til startup-assert for `walletAdapter.releaseReservation` i `index.ts` når `spill1StopVoteService` er konfigurert.

### Post-pilot follow-up (ikke pilot-blokkere)

5. Disk-recovery-runbook for orphan XML-filer hvis fil-skriving feiler etter COMMIT.
6. Pagination eller limit-warning på `engine.listComplianceLedgerEntries` for HallAccountReport + adminTrackSpending.
7. Hall-tidssone-integrasjon i CloseDay (BIN-661 prerequisite).
8. Server-side Cloudinary upload-pipeline for ScreenSaver.
9. SMTP-feilmeldingsanonymisering for player-facing flow.

---

## Konklusjon

Bølge C (admin + spillevett) er solid bygd på et stødig RBAC-fundament med fail-closed-pattern gjennomgående. Self-exclusion 1-år, fail-closed Spillvett-gates, og audit-trail er regulatorisk korrekte.

**Én potensiell pilot-blokkere identifisert:** `WithdrawXmlExportService` JOIN-cardinality. Hvis hall-til-agent er n:m i prod, dette må fikses før pilot. Verifiser med `\d app_agent_halls` på prod DB eller migration-historie.

Resterende issues er kvalitetsforbedringer som ikke er pilot-blokkere men bør tracks som follow-up issues.

---

*Review utført av code-reviewer subagent per role-spec `.claude/agents/code-reviewer.md`. Ingen endringer i kildekode utført — kun review-rapport.*
