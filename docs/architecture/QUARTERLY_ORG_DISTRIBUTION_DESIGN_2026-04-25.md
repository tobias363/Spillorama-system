# Kvartalsvis overskuddsfordeling — arkitektur-spec

**Dato:** 2026-04-25
**Forfatter:** Design-agent under PM (Claude Opus 4.7, 1M-kontekst)
**Status:** Design-forslag, venter PM-review og godkjenning før implementasjon
**Bygger på:** [`SPILLKATALOG.md`](./SPILLKATALOG.md) (2026-04-25 korrigert), [`PAYOUT_REPORTING_AUDIT_2026-04-25.md`](../operations/PAYOUT_REPORTING_AUDIT_2026-04-25.md), [`SPILL1_GAMETYPE_INVESTIGATION_2026-04-25.md`](../compliance/SPILL1_GAMETYPE_INVESTIGATION_2026-04-25.md), eksisterende `apps/backend/src/game/ComplianceLedger.ts`-domene
**Ingen kode-endring** — dette dokumentet definerer arkitekturen og veikartet. Implementasjon-PR kommer som separate Linear-issuer pr. fase.

---

## Sammendrag (TL;DR)

Pengespillforskriften §11 krever at **bingomedhjelper (Spillorama som entreprenør) utbetaler organisasjonenes andel kvartalsvis**, ikke per-runde. Dagens implementasjon (`ComplianceLedgerOverskudd.ts`) gjør per-runde-fordeling som er **strukturelt feil** mot regulatorisk-modellen — den kan kjøre wallet-transfer flere ganger om dagen, og har ingen quarter-batch-identitet eller approval-flow. I tillegg har `ComplianceLedgerAggregation.ts:99` formelen `net = grossTurnover − prizesPaid` **uten 70%-cap** på gevinster, som er en bug mot §11.

Fire endringer:

1. **Ny service `QuarterlyOrgDistributionService`** — kalkulerer per (hall × game-type × channel) for et helt kvartal, med 70%-cap på gevinster, 15%/30%-prosent etter game-type, og deterministisk allokering over flere organisasjoner.
2. **Ny tabell `app_quarterly_org_distributions`** — én rad per (hall_id, quarter, status), med `calculated → approved → paid → rolled_back` state-machine og full audit-trail.
3. **Approval + paid-flow** — admin må eksplisitt godkjenne batchen før wallet-transfer kjøres. Kombinerer rapport-generering (Lotteritilsynet halvårsrapport) i samme flow.
4. **Demote eksisterende per-runde-kode** til kun preview/fall-back. Siktemål er å fjerne den i fase 4.

Total dev-effort: **8-10 dev-dager**, fordelt på 4 fase-PRer over ~3-4 sprint-uker. Anbefales merget før Q3-rapportering 2026 (frist 15. okt 2026 for Q3, 15. apr for Q1).

---

## §1. Regulatorisk kontekst

### 1.1 Pengespillforskriften §11 — relevante krav

Kilder: [Lovdata pengespillforskriften kap. 11](https://lovdata.no/dokument/SF/forskrift/2022-11-17-1978/kap11), [Forskrift om bingo Kap. 5](https://lovdata.no/dokument/SFO/forskrift/2004-11-30-1528/KAPITTEL_5), Tobias' bekreftelse 2026-04-25.

| Krav | Verdi | Konsekvens |
|---|---|---|
| Hovedspill — minste organisasjon-andel | **15%** av overskudd | Spill 1, 2, 3 |
| Databingo — minste organisasjon-andel | **30%** av overskudd | SpinnGo (Spill 4 / `spillorama`) |
| Gevinst-cap i overskudd-formel | **maks 70%** av brutto-omsetning | Hvis prizesPaid > 0.70 * grossTurnover, behandles bare 0.70-andelen som "reell gevinstutgang" |
| Utbetalings-frekvens | **kvartalsvis** (Q1, Q2, Q3, Q4) | Medhjelper skal IKKE utbetale per-runde — det skaper compliance-risiko og rebalanserings-rot |
| Rapport-frist Q1+Q3 | **2 uker** etter kvartalsslutt | Q1 ender 31. mar, frist 14. apr. Q3 ender 30. sep, frist 14. okt. |
| Rapport-frist Q2+Q4 | Sammen med halvårs-rapport | Q2 inngår i 1. halvår-rapport (frist 1. juli), Q4 i 2. halvår (frist 1. jan) |
| Halvårsrapport | Revisor-godkjent | Lotteritilsynet aksepterer kun bekreftet av autorisert revisor for medhjelper-modellen |
| Spilletid | **07:00–01:00 CET** | Eldre regelverk: ingen bingo 24:00-07:00. Spilletid er ikke direkte relevant for utbetaling, men begrenser når omsetning kan oppstå. |

### 1.2 Overskudd-formelen

Definisjon (Tobias 2026-04-25):

```
overskudd = brutto_omsetning − reell_gevinstutgang
```

der:

```
reell_gevinstutgang = min(faktisk_utbetalt_gevinst, 0.70 * brutto_omsetning)
```

Eksempel:
- Brutto-omsetning Q1: 1 000 000 kr
- Faktisk utbetalt gevinst: 800 000 kr (= 80%)
- **Reell gevinstutgang i §11-formel: min(800k, 700k) = 700k** (kap-applisert)
- Overskudd: 1 000 000 − 700 000 = 300 000 kr
- Min organisasjon-andel (hovedspill): 0.15 × 300 000 = **45 000 kr**

Dette betyr at Spillorama bærer hele tap-risikoen hvis gevinster overstiger 70% — den ekstra 100k er ikke fradragsberettiget i organisasjon-fordelings-formelen. Det skaper et insentiv mot å sette gevinst-prosent for høyt.

### 1.3 Hvor skiller seg dette fra dagens implementasjon

| Område | Dagens kode | Riktig implementasjon |
|---|---|---|
| **Periode** | Per dag eller per runde (callable etter hver omgang) | Per kvartal (Q1 = 2026-01-01 til 2026-03-31) |
| **Gevinst-cap** | Ingen — `net = gross − prizesPaid` direkte | `effectivePrizes = min(prizesPaid, 0.70*gross)`, deretter `net = gross − effectivePrizes` |
| **Atomicitet** | Hver wallet-transfer skrives separat per runde | Én batch per (hall, quarter), all wallet-transfer skjer transaksjonelt etter approval |
| **Approval** | Ingen — kjøres rett ut | `calculated → approved (admin signoff) → paid` med audit |
| **Idempotens** | Per-runde batchId | Unik på (hall_id, quarter_start) — blokkerer dobbeltkjøring |
| **Rapport** | Kun in-memory `OverskuddDistributionBatch` | Persistert som DB-rad + revisor-eksport (PDF/CSV) |

---

## §2. Domain-modell

### 2.1 Aggregerings-nivå

Den minste enheten Lotteritilsynet kan kreve dokumentasjon på er **per hall × per game-type × per channel × per kvartal**. Vi støtter alle fire dimensjoner.

```
                       ┌─────────────────────────────────────┐
                       │  QuarterlyOrgDistribution (en batch)│
                       │  Identitet: (hall_id, quarter_start)│
                       └──────────────────┬──────────────────┘
                                          │
                       ┌──────────────────┼──────────────────┐
                       │ breakdown_json[] │                  │
                       │ — én entry per   │                  │
                       │   (gameType,     │                  │
                       │    channel)      │                  │
                       │   med:           │                  │
                       │   • gross        │                  │
                       │   • prizesPaid   │                  │
                       │   • prizesCapped │                  │
                       │   • netOverskudd │                  │
                       │   • orgPercent   │                  │
                       │   • orgAmount    │                  │
                       └──────────────────┴──────────────────┘
                                          │
                                          ▼
                       ┌─────────────────────────────────────┐
                       │  QuarterlyOrgPayments (mange)        │
                       │  Én rad per organisasjon × batch    │
                       │  med: (org_id, amount, paid_at,     │
                       │        wallet_tx_ids[])             │
                       └─────────────────────────────────────┘
```

For en hall som kjører alle 3 hovedspill (live i hall + internett) + SpinnGo:

```
hall = "hall-oslo"
quarter = 2026-Q1 (start 2026-01-01)

breakdown_json = [
  { gameType: "MAIN_GAME", channel: "HALL",     gross: 500k, prizesPaid: 320k, capPrizes: 350k, effectivePrizes: 320k, net: 180k, pct: 0.15, orgAmount: 27k },
  { gameType: "MAIN_GAME", channel: "INTERNET", gross: 200k, prizesPaid: 130k, capPrizes: 140k, effectivePrizes: 130k, net:  70k, pct: 0.15, orgAmount: 10.5k },
  { gameType: "DATABINGO", channel: "INTERNET", gross: 100k, prizesPaid:  78k, capPrizes:  70k, effectivePrizes:  70k, net:  30k, pct: 0.30, orgAmount:  9k }
]

required_min_org_amount = 27k + 10.5k + 9k = 46 500 kr
```

Hovedspill-kanalene aggregeres ikke fordi 70%-cap-en virker per (gameType, channel) — to kanaler kan ha veldig forskjellig prize-ratio og må vurderes uavhengig.

### 2.2 Identitet på en kvartals-batch

```typescript
interface QuarterlyOrgDistributionBatch {
  /** UUID v7 (sortable, generert ved calculate). */
  id: string;
  /** Hall som distribusjonen gjelder. Aldri NULL — alltid per-hall. */
  hallId: string;
  /** Format: 'YYYY-Q1' | 'YYYY-Q2' | 'YYYY-Q3' | 'YYYY-Q4'. Brukes som menneskelig nøkkel. */
  quarter: string;
  /** ISO-dato, første dag i kvartalet (YYYY-MM-DD). */
  quarterStart: string;
  /** ISO-dato, siste dag i kvartalet (inkluderende). */
  quarterEnd: string;

  /** State-machine. Se §2.3 for transisjoner. */
  status: 'CALCULATED' | 'APPROVED' | 'PAID' | 'ROLLED_BACK';

  /** Per (gameType × channel)-breakdown med 70%-cap. */
  breakdown: QuarterlyOrgDistributionBreakdown[];

  /** Sum av alle breakdown[].orgAmount. */
  requiredMinOrgAmount: number;
  /** Summen av alle org-payments som faktisk er gjort. */
  distributedAmount: number;

  /** Hvilke org-andeler. Snapshot-et ved CALCULATED — endring i hall_organizations etterpå krever ny batch. */
  allocations: OrganizationAllocationSnapshot[];

  /** Audit-trail. */
  calculatedAt: string;        // ISO timestamp
  calculatedBy: string;        // user_id (eller 'SCHEDULER' for auto-calc)
  approvedAt: string | null;
  approvedBy: string | null;   // user_id, må være ADMIN-rolle
  paidAt: string | null;
  paymentReference: string | null; // ekstern referanse, f.eks. bank-batch-ID

  /** Hvis ROLLED_BACK: hvorfor + når. */
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  rollbackReason: string | null;

  /** Versjonering for fremtidige endringer i kalkulasjons-formelen. */
  formulaVersion: string;      // "v1.0" — hvis vi endrer formelen, beholder gamle batcher sin versjon
}

interface QuarterlyOrgDistributionBreakdown {
  gameType: 'MAIN_GAME' | 'DATABINGO';
  channel: 'HALL' | 'INTERNET';

  /** Sum av STAKE-events i ledger. */
  grossTurnover: number;
  /** Sum av PRIZE + EXTRA_PRIZE-events i ledger (faktisk utbetalt). */
  prizesPaid: number;
  /** 0.70 * grossTurnover. */
  prizesCap: number;
  /** min(prizesPaid, prizesCap) — denne brukes i overskudd-formelen. */
  effectivePrizes: number;
  /** grossTurnover - effectivePrizes. */
  netOverskudd: number;

  /** 0.15 for MAIN_GAME, 0.30 for DATABINGO. Snapshot-et fra hall-config. */
  orgMinPercent: number;
  /** roundCurrency(netOverskudd * orgMinPercent). */
  orgAmount: number;

  /** Antall STAKE-events i kvartalet. */
  stakeCount: number;
  /** Antall PRIZE-events. */
  prizeCount: number;
}

interface OrganizationAllocationSnapshot {
  organizationId: string;
  organizationName: string;
  organizationAccountId: string;
  /** Summert til 1.0 over alle org-snapshots i samme batch. */
  sharePercent: number;
}
```

### 2.3 Status-machine

```
        ┌──────────────┐
        │  CALCULATED  │ ─── admin approver ──▶  ┌──────────┐
        └──────────────┘                          │ APPROVED │
              │                                   └──────────┘
              │ admin recalculate                       │
              │ (kun mens CALCULATED)                   │ wallet-transfer kjøres
              ▼                                         ▼
        ┌─────────────────┐                     ┌──────────┐
        │  ROLLED_BACK    │◀──── manual rollback│   PAID   │
        │   (terminal)    │      (kun mens      └──────────┘
        └─────────────────┘       APPROVED)            │
              ▲                       │                │
              │                       │  manual rollback
              └────── manual rollback─┴────────────────┘
                                                       │
                                                       │
                                                      Ingen tilstand etter PAID
                                                      med mindre vi ROLLED_BACK
                                                      (audit-spor bevart)
```

**Regler:**
- Direkte CALCULATED → PAID **ikke tillatt**. Approval er gate.
- Bare brukere med rolle `ADMIN` (eller dedikert `COMPLIANCE_OFFICER` hvis det innføres) kan godkjenne. `HALL_OPERATOR` kan **ikke** godkjenne — selv ikke for egen hall.
- 4-eyes-prinsipp: brukeren som calculated kan ikke approve. Hvis det er ønskelig (anbefalt for compliance), legg til `assert(approvedBy !== calculatedBy)`.
- ROLLED_BACK er terminal — ingen flere overganger. En ny batch må opprettes hvis vi vil prøve igjen.
- PAID er semi-terminal — man kan ROLLED_BACK den hvis betalingen feiler eller en feil oppdages, men det krever kompenserende wallet-transfer-tilbakeføringer i samme transaksjon.

### 2.4 Audit-trail-krav

- Alle status-overganger logges i `app_audit_log` (eksisterende `AuditLogService`) med action `quarterly_org_distribution.{action}` der action ∈ {`calculated`, `approved`, `paid`, `rolled_back`, `recalculated`}.
- Hver wallet-transfer i PAID-fasen skriver én `ORG_DISTRIBUTION`-event i `app_rg_compliance_ledger` (gjenbruk eksisterende ledger-event-type) med `batch_id = <quarterly-batch-id>` så Lotteritilsynet kan korrelere.
- Tabellen `app_quarterly_org_distributions` er **append-only for status-felt** (immutable trigger blokkerer DELETE og UPDATE av alle felt unntatt status-overganger og audit-felt). Forsøk på å endre `breakdown_json` etter CALCULATED kaster.

---

## §3. Beregnings-funksjonen

### 3.1 Pseudokode

```typescript
async function calculateQuarterlyOrgDistribution(input: {
  hallId: string;
  quarter: string;        // 'YYYY-Q1' | ... | 'YYYY-Q4'
  calculatedBy: string;   // user_id eller 'SCHEDULER'
}): Promise<QuarterlyOrgDistributionBatch> {

  // 1. Resolve quarter dates
  const { quarterStart, quarterEnd } = parseQuarter(input.quarter);
  // f.eks. 2026-Q1 → quarterStart='2026-01-01', quarterEnd='2026-03-31'

  // 2. Validate: quarter is in the past (kan ikke kalkulere fremtidige eller pågående kvartaler)
  if (quarterEndAsDate >= today) {
    throw new DomainError("INVALID_INPUT", "Kvartalet er ikke avsluttet ennå.");
  }

  // 3. Validate: idempotens-check — eksisterer det allerede en CALCULATED/APPROVED/PAID-batch?
  const existing = await db.query(
    `SELECT id, status FROM app_quarterly_org_distributions
     WHERE hall_id = $1 AND quarter_start = $2 AND status != 'ROLLED_BACK'`,
    [input.hallId, quarterStart]
  );
  if (existing.rows.length > 0) {
    throw new DomainError("CONFLICT",
      `Batch finnes allerede for ${input.quarter}, hall=${input.hallId}, status=${existing.rows[0].status}`);
  }

  // 4. Hent ledger-data fra `generateRangeReport` (gjenbruker eksisterende kode)
  const rangeReport: RangeComplianceReport = await engine.generateRangeReport({
    startDate: quarterStart,
    endDate: quarterEnd,
    hallId: input.hallId,
    // INGEN gameType/channel-filter — vi vil ha alle dimensjoner
  });

  // 5. Aggreger til (gameType × channel)-buckets — men nå med 70%-cap
  const breakdown = aggregateBreakdownWith70PercentCap(rangeReport, input.hallId);

  // 6. Hent organisasjon-allocations for hallen
  const allocations = await getActiveAllocationsForHall(input.hallId, quarterEnd);
  if (allocations.length === 0) {
    throw new DomainError("MISSING_CONFIG",
      `Ingen aktive organisasjon-allocations konfigurert for hall=${input.hallId}.`);
  }

  // 7. Beregn requiredMinOrgAmount = sum(breakdown[].orgAmount)
  const requiredMinOrgAmount = roundCurrency(
    breakdown.reduce((sum, b) => sum + b.orgAmount, 0)
  );

  // 8. Build batch (status=CALCULATED, distributedAmount=0)
  const batch: QuarterlyOrgDistributionBatch = {
    id: uuidv7(),
    hallId: input.hallId,
    quarter: input.quarter,
    quarterStart,
    quarterEnd,
    status: 'CALCULATED',
    breakdown,
    requiredMinOrgAmount,
    distributedAmount: 0,
    allocations: allocations.map(snapshot),
    calculatedAt: new Date().toISOString(),
    calculatedBy: input.calculatedBy,
    approvedAt: null, approvedBy: null,
    paidAt: null, paymentReference: null,
    rolledBackAt: null, rolledBackBy: null, rollbackReason: null,
    formulaVersion: 'v1.0',
  };

  // 9. Persist + audit-log
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_quarterly_org_distributions (...) VALUES (...)`,
      [batch.id, batch.hallId, batch.quarterStart, ...]
    );
    await auditLog.append({
      actorUserId: input.calculatedBy,
      action: 'quarterly_org_distribution.calculated',
      resourceId: batch.id,
      details: { hallId: input.hallId, quarter: input.quarter,
                 requiredMinOrgAmount, formulaVersion: batch.formulaVersion },
    });
  });

  return batch;
}

/**
 * Kjernen: applisere 70%-cap per (gameType, channel)-rad fra range-rapporten.
 * Aggregerer alle rader i samme (gameType, channel) til ett breakdown-entry.
 */
function aggregateBreakdownWith70PercentCap(
  report: RangeComplianceReport,
  hallId: string,
): QuarterlyOrgDistributionBreakdown[] {

  // Aggreger på tvers av dager: én bucket per (gameType, channel)
  const buckets = new Map<string, {
    gameType: LedgerGameType;
    channel: LedgerChannel;
    grossTurnover: number;
    prizesPaid: number;
    stakeCount: number;
    prizeCount: number;
  }>();

  for (const day of report.days) {
    for (const row of day.rows) {
      if (row.hallId !== hallId) continue; // safety check
      const key = `${row.gameType}::${row.channel}`;
      const bucket = buckets.get(key) ?? {
        gameType: row.gameType, channel: row.channel,
        grossTurnover: 0, prizesPaid: 0, stakeCount: 0, prizeCount: 0,
      };
      bucket.grossTurnover += row.grossTurnover;
      bucket.prizesPaid    += row.prizesPaid;
      bucket.stakeCount    += row.stakeCount;
      bucket.prizeCount    += row.prizeCount + row.extraPrizeCount;
      buckets.set(key, bucket);
    }
  }

  // Beregn 70%-cap, netto, og org-andel per bucket
  return [...buckets.values()].map((bucket) => {
    const grossTurnover = roundCurrency(bucket.grossTurnover);
    const prizesPaid    = roundCurrency(bucket.prizesPaid);

    // §11-cap: gevinst kan ikke settes høyere enn 70% av omsetning i overskudd-formelen
    const prizesCap       = roundCurrency(0.70 * grossTurnover);
    const effectivePrizes = roundCurrency(Math.min(prizesPaid, prizesCap));

    // Negativ netto er teoretisk umulig nå (cap holder den nede til ≥ 30% av gross)
    const netOverskudd = Math.max(0, roundCurrency(grossTurnover - effectivePrizes));

    // §11-prosent etter game-type
    const orgMinPercent = bucket.gameType === 'DATABINGO' ? 0.30 : 0.15;
    const orgAmount = roundCurrency(netOverskudd * orgMinPercent);

    return {
      gameType: bucket.gameType,
      channel:  bucket.channel,
      grossTurnover, prizesPaid, prizesCap, effectivePrizes, netOverskudd,
      orgMinPercent, orgAmount,
      stakeCount: bucket.stakeCount, prizeCount: bucket.prizeCount,
    };
  })
  .filter((b) => b.grossTurnover > 0); // tom-rader (ingen omsetning) drop-pes
}
```

### 3.2 Approval-funksjonen

```typescript
async function approveQuarterlyOrgDistribution(
  batchId: string,
  approvedBy: string,
): Promise<QuarterlyOrgDistributionBatch> {
  return db.transaction(async (tx) => {
    const batch = await loadBatch(tx, batchId, { lock: true });
    if (batch.status !== 'CALCULATED') {
      throw new DomainError("INVALID_STATE",
        `Kan ikke approve i state=${batch.status}.`);
    }
    if (batch.calculatedBy === approvedBy) {
      throw new DomainError("FORBIDDEN", "4-eyes: kan ikke godkjenne egen kalkulasjon.");
    }
    await assertUserHasRole(tx, approvedBy, 'ADMIN');

    await tx.query(
      `UPDATE app_quarterly_org_distributions
       SET status='APPROVED', approved_at=now(), approved_by=$2
       WHERE id=$1 AND status='CALCULATED'`,
      [batchId, approvedBy]
    );
    await auditLog.append({ actorUserId: approvedBy, action: 'quarterly_org_distribution.approved',
                            resourceId: batchId });

    return loadBatch(tx, batchId);
  });
}
```

### 3.3 Pay-funksjonen

```typescript
async function payQuarterlyOrgDistribution(
  batchId: string,
  triggeredBy: string,
): Promise<QuarterlyOrgDistributionBatch> {
  return db.transaction(async (tx) => {
    const batch = await loadBatch(tx, batchId, { lock: true });
    if (batch.status !== 'APPROVED') {
      throw new DomainError("INVALID_STATE", `Kan ikke pay i state=${batch.status}.`);
    }

    // For hver breakdown-entry: split orgAmount over allocations og kjør wallet-transfer
    const payments: QuarterlyOrgPayment[] = [];
    for (const breakdown of batch.breakdown) {
      if (breakdown.orgAmount <= 0) continue;

      const sourceAccountId = makeHouseAccountId(
        batch.hallId, breakdown.gameType, breakdown.channel
      );
      const parts = allocateAmountByShares(
        breakdown.orgAmount,
        batch.allocations.map(a => a.sharePercent)
      );
      // (allocateAmountByShares finnes allerede i ComplianceLedgerOverskudd.ts:44 — gjenbrukes)

      for (let i = 0; i < batch.allocations.length; i += 1) {
        const amount = parts[i];
        if (amount <= 0) continue;
        const allocation = batch.allocations[i];

        const transfer = await walletAdapter.transfer(
          sourceAccountId,
          allocation.organizationAccountId,
          amount,
          `Q-overskudd ${batch.id} ${batch.quarter}`,
        );

        // Skriv ORG_DISTRIBUTION til regulatorisk ledger (compliance)
        await complianceLedger.recordOrgDistribution({
          hallId: batch.hallId,
          gameType: breakdown.gameType,
          channel:  breakdown.channel,
          amount,
          sourceAccountId,
          targetAccountId: allocation.organizationAccountId,
          batchId: batch.id,    // KOBLING — Lotteritilsynet kan join på dette
          metadata: {
            organizationId: allocation.organizationId,
            quarter: batch.quarter,
            formulaVersion: batch.formulaVersion,
          },
        });

        payments.push({
          batchId: batch.id, organizationId: allocation.organizationId,
          gameType: breakdown.gameType, channel: breakdown.channel,
          amount, walletTxIds: [transfer.fromTx.id, transfer.toTx.id],
          paidAt: new Date().toISOString(),
        });
      }
    }

    // Persist payments + flip status
    for (const p of payments) {
      await tx.query(`INSERT INTO app_quarterly_org_payments (...) VALUES (...)`, [...]);
    }
    const distributedAmount = roundCurrency(payments.reduce((s, p) => s + p.amount, 0));
    await tx.query(
      `UPDATE app_quarterly_org_distributions
       SET status='PAID', paid_at=now(), distributed_amount=$2
       WHERE id=$1 AND status='APPROVED'`,
      [batchId, distributedAmount]
    );
    await auditLog.append({ actorUserId: triggeredBy, action: 'quarterly_org_distribution.paid',
                            resourceId: batchId, details: { distributedAmount, paymentCount: payments.length } });

    return loadBatch(tx, batchId);
  });
}
```

### 3.4 Hvordan håndtere edge cases

| Edge case | Håndtering |
|---|---|
| `prizesPaid > 0.70 * gross` | `effectivePrizes = 0.70*gross`, `netOverskudd ≥ 0.30*gross > 0`. Aldri negativ. |
| `gross = 0` (ingen omsetning) | Bucket droppes (filter på linje "grossTurnover > 0"). Hvis hele hallen har 0, batch genereres tom med `requiredMinOrgAmount=0`. PAID-fasen er no-op. |
| `prizesPaid > gross` (fysisk umulig — gevinst > omsetning) | Cap-en redder oss: 70%-cap garanterer netto ≥ 30%. Logger warning hvis dette skjer (sannsynligvis ledger-corruption). |
| `allocations.length === 0` for hall | Kalkulasjon kaster i §3.1 punkt 6. Admin må først konfigurere via `app_rg_hall_organizations` (eksisterende tabell). |
| Allocation-prosenter ikke summert til 100 | `allocateAmountByShares` (eksisterende, line 44 i `ComplianceLedgerOverskudd.ts`) håndterer ikke-summen-100 ved proportional splitting. Vi normaliserer ikke — admin er ansvarlig for å konfigurere riktig. **Validering ved CRUD av allocation: sum(sharePercent) must equal 1.0 ± 0.001.** |

### 3.5 Hvor `roundCurrency` slår inn

`roundCurrency` (eksisterende `apps/backend/src/util/currency.ts`) runder til 2 desimaler. Den kalles:

1. På hver bucket-aggregering (`grossTurnover`, `prizesPaid`).
2. På `prizesCap`, `effectivePrizes`, `netOverskudd`.
3. På `orgAmount = netOverskudd * orgMinPercent` (kjernen).
4. På `requiredMinOrgAmount` (sum over alle breakdowns).
5. På hver allocation-part (`allocateAmountByShares` håndterer rest-til-første-rad).
6. På `distributedAmount` ved PAID.

Invariant: `distributedAmount === requiredMinOrgAmount` etter PAID, **modulo allocation-rundinger som kan gi ±0.01-rest** (rest tillegges første allocation, så distributed kan være 0.01 mer enn required hvis det er mismatch på rounding).

---

## §4. DB-schema (migrations)

Ny migration: `apps/backend/migrations/20260901000000_quarterly_org_distributions.sql`

```sql
-- Q-OD-1: Kvartalsvis overskudd-fordeling per hall.
--
-- Pengespillforskriften §11 krever at bingomedhjelper (Spillorama som
-- entreprenør) utbetaler organisasjonenes andel kvartalsvis. Denne tabellen
-- erstatter per-runde-fordelingen i ComplianceLedgerOverskudd.ts som var
-- strukturelt feil mot regulatorisk modell.
--
-- Append-only for de fleste felt — kun status-overgangs-felt og audit-felt
-- (approved_*, paid_*, rolled_back_*, distributed_amount) er writable.
-- Trigger blokkerer DELETE og UPDATE av (breakdown_json, allocations_json,
-- required_min_org_amount, calculated_at, calculated_by) etter CREATE.
--
-- Idempotens: UNIQUE(hall_id, quarter_start) hvor status != 'ROLLED_BACK'
-- — bare én aktiv batch per (hall, quarter). Rolled-back batcher beholder
-- audit-spor men frigjør slot-en for ny calculate.

CREATE TABLE IF NOT EXISTS app_quarterly_org_distributions (
  id                       TEXT PRIMARY KEY,
  hall_id                  TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  quarter                  TEXT NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  quarter_start            DATE NOT NULL,
  quarter_end              DATE NOT NULL CHECK (quarter_end >= quarter_start),

  status                   TEXT NOT NULL DEFAULT 'CALCULATED'
                             CHECK (status IN ('CALCULATED','APPROVED','PAID','ROLLED_BACK')),

  -- Per (gameType × channel)-breakdown med 70%-cap. Format: array av
  -- QuarterlyOrgDistributionBreakdown (se §2.2 typescript-grensesnitt).
  breakdown_json           JSONB NOT NULL,
  -- Snapshot av aktive allocations ved CALCULATE-tid. Format: array av
  -- OrganizationAllocationSnapshot.
  allocations_json         JSONB NOT NULL,

  required_min_org_amount  NUMERIC(14, 2) NOT NULL CHECK (required_min_org_amount >= 0),
  distributed_amount       NUMERIC(14, 2) NOT NULL DEFAULT 0
                             CHECK (distributed_amount >= 0),

  formula_version          TEXT NOT NULL DEFAULT 'v1.0',

  calculated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  calculated_by            TEXT NOT NULL,  -- user_id eller 'SCHEDULER'
  approved_at              TIMESTAMPTZ NULL,
  approved_by              TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  paid_at                  TIMESTAMPTZ NULL,
  payment_reference        TEXT NULL,      -- ekstern referanse f.eks. bank-batch-id
  rolled_back_at           TIMESTAMPTZ NULL,
  rolled_back_by           TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  rollback_reason          TEXT NULL,

  CONSTRAINT q_org_dist_status_consistency CHECK (
    (status = 'CALCULATED'  AND approved_at IS NULL AND paid_at IS NULL AND rolled_back_at IS NULL) OR
    (status = 'APPROVED'    AND approved_at IS NOT NULL AND paid_at IS NULL AND rolled_back_at IS NULL) OR
    (status = 'PAID'        AND approved_at IS NOT NULL AND paid_at IS NOT NULL AND rolled_back_at IS NULL) OR
    (status = 'ROLLED_BACK' AND rolled_back_at IS NOT NULL AND rolled_back_by IS NOT NULL)
  )
);

-- Idempotens: kun én aktiv batch per (hall, quarter)
CREATE UNIQUE INDEX IF NOT EXISTS uq_quarterly_org_dist_active
  ON app_quarterly_org_distributions(hall_id, quarter_start)
  WHERE status != 'ROLLED_BACK';

CREATE INDEX IF NOT EXISTS idx_quarterly_org_dist_status
  ON app_quarterly_org_distributions(status, quarter_start DESC);

CREATE INDEX IF NOT EXISTS idx_quarterly_org_dist_hall
  ON app_quarterly_org_distributions(hall_id, quarter_start DESC);

COMMENT ON TABLE app_quarterly_org_distributions IS
  'Kvartalsvis overskudd-fordeling per hall (pengespillforskriften §11). En rad per (hall_id, quarter), state-machine: CALCULATED → APPROVED → PAID med ROLLED_BACK som terminal exit-state.';

-- Per-organisasjon-payment-rader (én per allocation × breakdown-bucket)
CREATE TABLE IF NOT EXISTS app_quarterly_org_payments (
  id                       TEXT PRIMARY KEY,
  batch_id                 TEXT NOT NULL REFERENCES app_quarterly_org_distributions(id) ON DELETE RESTRICT,
  organization_id          TEXT NOT NULL,
  organization_account_id  TEXT NOT NULL,

  game_type                TEXT NOT NULL CHECK (game_type IN ('MAIN_GAME','DATABINGO')),
  channel                  TEXT NOT NULL CHECK (channel IN ('HALL','INTERNET')),

  amount                   NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  wallet_tx_ids            JSONB NOT NULL DEFAULT '[]'::jsonb,

  paid_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_q_org_payments_batch
  ON app_quarterly_org_payments(batch_id);

CREATE INDEX IF NOT EXISTS idx_q_org_payments_org
  ON app_quarterly_org_payments(organization_id, paid_at DESC);

COMMENT ON TABLE app_quarterly_org_payments IS
  'Detalj-rader for kvartalsvis org-distribusjon. Én rad per (batch × organisasjon × gameType × channel). FK til app_quarterly_org_distributions.';

-- ── Immutability-trigger ───────────────────────────────────────────────────
-- Audit-felt og status-overgangs-felt er writable. Andre felt blokkeres
-- etter CREATE — gjenbruker mønster fra app_regulatory_ledger.

CREATE OR REPLACE FUNCTION app_q_org_dist_block_immutable_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.breakdown_json IS DISTINCT FROM NEW.breakdown_json) OR
     (OLD.allocations_json IS DISTINCT FROM NEW.allocations_json) OR
     (OLD.required_min_org_amount IS DISTINCT FROM NEW.required_min_org_amount) OR
     (OLD.calculated_at IS DISTINCT FROM NEW.calculated_at) OR
     (OLD.calculated_by IS DISTINCT FROM NEW.calculated_by) OR
     (OLD.formula_version IS DISTINCT FROM NEW.formula_version) OR
     (OLD.hall_id IS DISTINCT FROM NEW.hall_id) OR
     (OLD.quarter_start IS DISTINCT FROM NEW.quarter_start) OR
     (OLD.quarter_end IS DISTINCT FROM NEW.quarter_end) THEN
    RAISE EXCEPTION 'Kjerne-felt på app_quarterly_org_distributions er append-only.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_q_org_dist_block_immutable ON app_quarterly_org_distributions;
CREATE TRIGGER trg_q_org_dist_block_immutable
  BEFORE UPDATE ON app_quarterly_org_distributions
  FOR EACH ROW EXECUTE FUNCTION app_q_org_dist_block_immutable_updates();

-- DELETE blokkeres helt — bruk ROLLED_BACK-status i stedet.
CREATE OR REPLACE FUNCTION app_q_org_dist_block_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'app_quarterly_org_distributions er append-only — bruk status=ROLLED_BACK i stedet.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_q_org_dist_block_delete ON app_quarterly_org_distributions;
CREATE TRIGGER trg_q_org_dist_block_delete
  BEFORE DELETE ON app_quarterly_org_distributions
  FOR EACH ROW EXECUTE FUNCTION app_q_org_dist_block_delete();

-- Down Migration
-- DROP TABLE IF EXISTS app_quarterly_org_payments;
-- DROP TABLE IF EXISTS app_quarterly_org_distributions;
-- DROP FUNCTION IF EXISTS app_q_org_dist_block_immutable_updates();
-- DROP FUNCTION IF EXISTS app_q_org_dist_block_delete();
```

### 4.1 Migrasjons-kompabilitet med eksisterende kode

`app_rg_overskudd_batches` (eksisterende, fra `20260413000001_initial_schema.sql:402`) **beholdes** men frosses (read-only fra service-laget). Migrasjonen gjør IKKE drop på denne tabellen — eksisterende rader er audit-spor av gamle kalkulasjoner som må bevares for revisjons-formål.

Service-laget skal:
- Skrive til **kun** `app_quarterly_org_distributions` etter fase 2.
- Lese fra `app_rg_overskudd_batches` kun for historisk visning ("vis gamle batcher før fase 2").
- Ny code path bruker UUIDv7 for sortable IDs; gamle batcher beholder sin eksisterende format.

`app_rg_hall_organizations` (eksisterende) **gjenbrukes** uendret som kilde for `OrganizationAllocationSnapshot`. Strukturelt har den allerede `hall_id`, `organization_id`, `share_percent`, `game_type` (NULL = alle), `channel` (NULL = alle) — riktig granularitet.

---

## §5. Edge cases

### 5.1 Negativt overskudd

**Kan ikke skje** med 70%-cap. Cap garanterer `netOverskudd ≥ 0.30 * gross > 0` så lenge `gross > 0`. Hvis gross=0 droppes bucket-en helt.

Hvis 70%-cap ikke var aktiv (legacy-data): clamp til 0 i `Math.max(0, …)`. Dette håndteres allerede av eksisterende `computeRowsWithMinimum` på linje 76: `const net = Math.max(0, row.net);` — vi gjenbruker semantikken.

### 5.2 Tom hall (ingen omsetning i kvartalet)

`buckets.size === 0` etter aggregering ⇒ tom `breakdown[]` ⇒ `requiredMinOrgAmount = 0`. Batch lagres uansett (selv med 0-beløp) som "vi har vurdert dette kvartalet og det skylder ingen utbetaling". Lotteritilsynet kan kreve dokumentasjon på at ingen omsetning fant sted.

Pay-fasen er no-op (ingen wallet-transfers), men status flippes likevel til `PAID` for konsistens.

### 5.3 Splitt-perioder (hall byttet eier midt i kvartal)

Pengespillforskriften har ingen eksplisitt regel for dette, men praksis er:
- Hvis eier byttet ved start av nytt kvartal: gammel eier rapporterer Q1, ny eier Q2. Trivielt.
- Hvis bytte midt i kvartal: gammel eier ansvarlig for omsetning frem til byttet, ny eier resten.

**Anbefaling:** kreve at hall_id endres ved eierbytte (egen migration: `app_halls.replaced_by_hall_id` + cutoff-dato). Hver hall_id-versjon har sin egen kvartals-batch. Spørsmål til PM — se §10.

### 5.4 Forsinket data

Ledger er append-only og ALLE entries har `created_at_ms`. `generateRangeReport` filtrerer på dette. Hvis en STAKE-event som logisk hører til Q1 skrives først 5. april (etter quarter slutt), inkluderes den **ikke** i Q1-batch hvis batch allerede er PAID — den vil dukke opp i Q2-batch.

**Hvorfor er dette OK:** Lotteritilsynet aksepterer dato-stempling per `created_at_ms`. Vi rapporterer faktisk inntekts-tidspunkt, ikke logisk runde-tidspunkt. Hvis en sjelden timing-sak skaper dispute, skriver vi en kompenserende `ADJUSTMENT`-event i compliance-ledger og dokumenterer i revisor-notatet.

**Edge:** hvis en batch er CALCULATED men ikke ennå APPROVED, og forsinket data kommer inn — bruk `recalculateBatch(batchId)` som re-kjører `aggregateBreakdownWith70PercentCap` med oppdaterte ledger-data, sletter rad og oppretter ny CALCULATED-batch. Audit-log: `quarterly_org_distribution.recalculated`.

Etter APPROVED kan vi ikke recalculate — kun ROLLED_BACK + ny calculate.

### 5.5 Korreksjon etter approval

Hvis det oppdages feil i en APPROVED eller PAID batch:

1. Admin kjører `rollbackBatch(batchId, reason)` — flipper status til `ROLLED_BACK`, logger audit-event.
2. Hvis batch var PAID: i samme transaksjon kjøres reverse-wallet-transfers for hver `app_quarterly_org_payments`-rad. Dette krever at organisasjonens wallet-konto har tilstrekkelig saldo — hvis ikke, må det dekkes manuelt og logges som `ADJUSTMENT`.
3. Admin kan så kjøre ny `calculateQuarterlyOrgDistribution` for samme (hall, quarter). Idempotens-sjekken slipper gjennom siden gammel batch er ROLLED_BACK.
4. Lotteritilsynet skal varsles om korreksjonen — hvis forrige batch allerede er rapportert (Q1+Q3), trenger vi en korreksjons-rapport. Sett av som manuell prosess (revisor-koordinering).

### 5.6 Q1+Q3 → 2 uker frist; hva hvis ikke approved i tide?

Frist 14. apr (Q1) eller 14. okt (Q3). Hvis approval ikke skjer i tide:

- **Konsekvens regulatorisk:** medhjelper kan miste autorisasjon midlertidig. Real-world: Lotteritilsynet sender purring først.
- **Mitigering i system:** scheduled job `quarterlyReportTick` (kjører 1. april/juli/oktober/januar) skal:
  - Auto-calculate batch (status=CALCULATED).
  - Send e-post via `AccountingEmailService` til admin-allowlist med "vennligst godkjenn før X dato".
  - Hvis dato overskrides uten approval: send eskalering til både admin og PM.
  - Vurdér om vi skal legge til auto-approval etter X dager (anbefales ikke — fjerner human verifikasjon).

---

## §6. Konfigurasjon per hall

### 6.1 Allocations (organisasjon-andeler)

Eksisterende tabell `app_rg_hall_organizations` (initial_schema linje 418-433):

```
hall_id, organization_id, organization_name, organization_account_id,
share_percent, game_type (NULL=alle), channel (NULL=alle), is_active
```

Dette er allerede tilstrekkelig granulært for kvartal-kalkulasjonen. Logikk:

```typescript
async function getActiveAllocationsForHall(
  hallId: string,
  quarterEnd: string,
): Promise<HallOrganization[]> {
  // Hent rader gjeldende ved kvartals-slutt — brukes hvis vi senere innfører
  // valid_from/valid_to-felt for tidsbegrenset gyldighet.
  return db.query(
    `SELECT * FROM app_rg_hall_organizations
     WHERE hall_id = $1 AND is_active = 1
     ORDER BY created_at ASC`,
    [hallId]
  );
}
```

### 6.2 Hvis prosenter varierer per hall

§11 spesifiserer minimum (15%/30%). En hall kan **avtale høyere prosent** med organisasjonene (f.eks. 20%). Vi må støtte dette.

**Forslag:** legg til kolonne i `app_halls`:

```sql
ALTER TABLE app_halls ADD COLUMN org_main_game_percent NUMERIC(5,4) NULL;
ALTER TABLE app_halls ADD COLUMN org_databingo_percent NUMERIC(5,4) NULL;

-- NULL = bruk forskrift-default (0.15 / 0.30). Verdi = override (må være ≥ default).
ALTER TABLE app_halls ADD CONSTRAINT chk_halls_main_game_pct
  CHECK (org_main_game_percent IS NULL OR org_main_game_percent >= 0.15);
ALTER TABLE app_halls ADD CONSTRAINT chk_halls_databingo_pct
  CHECK (org_databingo_percent IS NULL OR org_databingo_percent >= 0.30);
```

Service-laget:

```typescript
function resolveOrgMinPercent(
  hall: Hall,
  gameType: 'MAIN_GAME' | 'DATABINGO',
): number {
  if (gameType === 'MAIN_GAME') {
    return hall.org_main_game_percent ?? 0.15;
  }
  return hall.org_databingo_percent ?? 0.30;
}
```

`breakdown.orgMinPercent` snapshottes ved CALCULATE-tid og bevarer verdien selv om hall-config endres senere.

### 6.3 Hvis hall har spesielle game-types eller kanal-restriksjoner

`app_rg_hall_organizations.game_type` og `.channel` kan filtrere allocation per dimensjon. Eksempel:
- "Org A får 100% av MAIN_GAME-andelen" → row med (org_a, game_type=MAIN_GAME, channel=NULL, share_percent=1.0)
- "Org B får 50% av DATABINGO-andelen, Org C får andre 50%" → 2 rader

**Implementasjons-forslag fase 2:** vi grupperer allocations per (game_type, channel) og bruker bare den matchende undergruppen for hver breakdown-entry. Hvis ingen matcher: fallback til allocations med (game_type=NULL, channel=NULL).

```typescript
function selectAllocationsForBreakdown(
  allAllocations: HallOrganization[],
  breakdown: QuarterlyOrgDistributionBreakdown,
): HallOrganization[] {
  // 1. Specific match: game_type + channel
  let matched = allAllocations.filter(a =>
    a.game_type === breakdown.gameType && a.channel === breakdown.channel);
  if (matched.length > 0) return matched;

  // 2. Game-type-only match
  matched = allAllocations.filter(a =>
    a.game_type === breakdown.gameType && a.channel === null);
  if (matched.length > 0) return matched;

  // 3. Default: alle med (game_type=NULL, channel=NULL)
  return allAllocations.filter(a => a.game_type === null && a.channel === null);
}
```

---

## §7. Halvårsrapport

### 7.1 Hva Lotteritilsynet trenger

Per [Forskrift om bingo §5](https://lovdata.no/dokument/SFO/forskrift/2004-11-30-1528/KAPITTEL_5) og PAYOUT_REPORTING_AUDIT-en:

- **Halvårsrapport (Q1+Q2 / Q3+Q4)** med:
  - Brutto omsetning per game-type
  - Faktisk gevinst utbetalt (før 70%-cap)
  - Effective gevinst (etter 70%-cap)
  - Netto overskudd
  - Andel utbetalt til organisasjoner
  - Spillerantall (unique players per kvartal)
  - Antall spilte runder
- **Revisor-bekreftelse** — autorisert revisor må signere på at tallene stemmer.
- **Format:** Altinn-skjema LS-0003 (interaktivt, ikke API).

### 7.2 Eksport-flow

Gjenbruk eksisterende `pdfExport.ts`-pattern. Ny funksjon:

```typescript
// apps/backend/src/util/pdfExport.ts

export async function generateQuarterlyOrgDistributionPdf(input: {
  batch: QuarterlyOrgDistributionBatch;
  hall: Hall;
  payments: QuarterlyOrgPayment[];
}): Promise<Buffer> {
  // PDF-template med:
  //   • Header: hall-info, quarter, batch-id
  //   • Section 1: regnskap (breakdown_json formattert som tabell)
  //     - Per (gameType × channel)-rad med gross/prizes/cap/effective/net
  //     - Total-rad nederst
  //   • Section 2: organisasjon-fordeling (payments grouped by org)
  //     - Per organisasjon: navn, account-id, sum, antall transfers
  //   • Section 3: signatur-felt for revisor (manuell utfylling)
  //   • Footer: formula_version, calculated_at, approved_by
}

// Kombinert halvårsrapport: 2 batches → 1 PDF
export async function generateHalfYearOrgDistributionPdf(input: {
  batches: QuarterlyOrgDistributionBatch[];  // [Q1, Q2] eller [Q3, Q4]
  hall: Hall;
}): Promise<Buffer> { ... }
```

### 7.3 Mailout-flow

```typescript
// apps/backend/src/jobs/quarterlyReportTick.ts (NY)

export async function runQuarterlyReportTick(deps: {
  service: QuarterlyOrgDistributionService;
  emailService: AccountingEmailService;
  now: Date;
}): Promise<void> {
  const { quarter, isReportingDeadline } = computeReportingState(deps.now);
  // F.eks. now=2026-04-01, quarter='2026-Q1', isReportingDeadline=true (Q1+Q3 er
  // egne innsendinger, så cron kjører 1. apr og 1. okt)

  const halls = await listActiveHalls();
  for (const hall of halls) {
    const existing = await deps.service.findActiveBatch(hall.id, quarter);
    if (!existing) {
      // Auto-calculate
      const batch = await deps.service.calculate({
        hallId: hall.id, quarter, calculatedBy: 'SCHEDULER'
      });
      await deps.emailService.sendQuarterlyReportNotification({
        hallId: hall.id,
        recipients: await getRegulatoryAllowlistForHall(hall.id),
        batch,
        action: 'PLEASE_REVIEW_AND_APPROVE',
      });
    } else if (existing.status === 'CALCULATED' && isReportingDeadline) {
      // Påminnelse hvis ikke approved i tide
      await deps.emailService.sendApprovalReminder({ hallId: hall.id, batchId: existing.id });
    }
  }
}
```

Schedule i `apps/backend/src/util/schedulerSetup.ts`:

```typescript
scheduler.register({
  name: 'quarterly-org-distribution',
  cron: '0 6 1 1,4,7,10 *', // 06:00 første dag i Q+1
  job: () => runQuarterlyReportTick({ service, emailService, now: new Date() }),
});
```

### 7.4 Admin-UI

Ny side: `apps/admin-web/src/pages/regulatory/QuarterlyOrgDistributionPage.ts` som viser:
- Alle batcher per hall med filter på quarter + status
- Detail-view: breakdown-tabell, allocations, payment-rader
- Knapper: "Approve" (CALCULATED → APPROVED), "Pay now" (APPROVED → PAID), "Rollback" (med dialog for grunn)
- "Last ned PDF" + "Last ned CSV"
- "Send til regnskap-allowlist" (re-send e-post manuelt)

RBAC:
- `HALL_OPERATOR`: read-only på egen hall.
- `ADMIN`: full access. Approval må følge 4-eyes (kan ikke approve egen calculate).
- `COMPLIANCE_OFFICER` (hvis innført): kan approve men ikke calculate.

---

## §8. Refactor-veikart

Total: ~8-10 dev-dager fordelt på 4 fase-PRer.

### Fase 1: Implementer ny service parallelt (~3 dev-dager)

**Mål:** Ny `QuarterlyOrgDistributionService` lever side-by-side med eksisterende `ComplianceLedgerOverskudd.ts`. Ingen endring i eksisterende code paths.

**Endringer:**
- `apps/backend/migrations/20260901000000_quarterly_org_distributions.sql` (ny)
- `apps/backend/src/compliance/QuarterlyOrgDistributionService.ts` (ny) — implementerer §3 calc/approve/pay/rollback
- `apps/backend/src/compliance/QuarterlyOrgDistributionTypes.ts` (ny) — typer fra §2
- `apps/backend/src/compliance/QuarterlyOrgDistributionRepository.ts` (ny) — DB-lag
- `apps/backend/src/compliance/QuarterlyOrgDistributionService.test.ts` (ny) — full unit-test-suite
- `apps/backend/src/routes/adminQuarterlyOrgDistribution.ts` (ny) — admin endpoints
- Wiring i `apps/backend/src/index.ts` + `apps/backend/src/routes/index.ts`

**Akseptansekriterier:**
- Ny service kan kalles via `POST /api/admin/quarterly-org-distribution/calculate`
- 70%-cap er korrekt applisert (test-fixture med `prizesPaid > 0.70 * gross`)
- Status-machine respekterer state-transitions (kan ikke approve uten calculated, etc.)
- Idempotens-sjekk på (hall_id, quarter_start) virker

### Fase 2: Disable per-runde `recordOrgDistribution` med config-flagg (~1.5 dev-dager)

**Mål:** Stopp ny per-runde-fordeling. Eksisterende per-runde-data (i `app_rg_overskudd_batches`) bevares. `OverskuddDistributionBatch`-API beholdes for **preview-only**.

**Endringer:**
- `apps/backend/src/game/ComplianceLedgerOverskudd.ts:108` — `createOverskuddDistributionBatch` deprecates: kaster med `DEPRECATED_USE_QUARTERLY` med mindre `process.env.LEGACY_PER_ROUND_DISTRIBUTION === '1'`
- `previewOverskuddDistribution` beholdes uendret — brukes av admin-UI-preview-knapper
- Konfig-flagg dokumentasjon i `docs/operations/REGULATORY_REPORTING_RUNBOOK.md` (NY)
- Tester: nye assertions for å verifisere at `createOverskuddDistributionBatch` kaster i default-mode

**Akseptansekriterier:**
- Default-mode: kall til `createOverskuddDistributionBatch` → throws DEPRECATED
- Med flag satt: behavior uendret (for fallback/migration-window)
- Audit-log markerer hvis legacy-pathen brukes

### Fase 3: Run første kvartal manuelt for å validere (~2 dev-dager + 2 uker pilot)

**Mål:** Q3 2026 (1. juli - 30. sep) genereres med ny service mot pilot-hall, sendes til pilot-regnskap, valideres mot Lotteritilsynet-feltene.

**Endringer:**
- Ingen kode-endring; kun deployment + manuell test.
- **Manuelt:** Tobias eller PM kjører `POST /api/admin/quarterly-org-distribution/calculate` for hver pilot-hall.
- **Manuelt:** generer PDF og sender til pilot-hall sin regnskapsfører for review.
- **Iterér:** hvis felt-mapping ikke matcher LS-0003: fix i PDF-template og kjør på nytt (kun calculate er idempotent — approval re-runs er semantisk OK siden de gir samme breakdown).
- Update runbook basert på feedback.

**Akseptansekriterier:**
- Minst én pilot-hall har CALCULATED + APPROVED + PAID-batch for Q3 2026.
- PDF-format er signed off av regnskapsfører.
- Lotteritilsynet-rapportering Q3 2026 (frist 14. okt) kjørt med ny system.

### Fase 4: Fjern død per-runde-kode (~1.5 dev-dager)

**Mål:** Når fase 3 er suksessfullt verifisert i 2 kvartaler (~6 måneder reell drift), fjern legacy-pathen.

**Endringer:**
- `apps/backend/src/game/ComplianceLedgerOverskudd.ts` — fjern `createOverskuddDistributionBatch`. `previewOverskuddDistribution` kan beholdes som "sneak-peek" uten persistens.
- Fjern `LEGACY_PER_ROUND_DISTRIBUTION`-flagg.
- Fjern `BingoEngine.createOverskuddDistributionBatch()`-method (sjekk `BingoEngine.ts:88` for å bekrefte API).
- Marker `app_rg_overskudd_batches` som arkiv-tabell i `docs/architecture/REPO_STRUCTURE.md`.
- Oppdater alle docs som refererer til per-runde-modellen.

**Akseptansekriterier:**
- Ingen prod-code path kaller per-runde-fordeling.
- Compliance-suite-tester oppdatert.
- Rollback-strategi: fase 4-PR kan reverteres hvis det oppdages issue.

---

## §9. Test-strategi

### 9.1 Unit-tester (`QuarterlyOrgDistributionService.test.ts`)

```typescript
describe('QuarterlyOrgDistributionService', () => {
  describe('calculateQuarterlyOrgDistribution', () => {
    it('applies 70% cap when prizesPaid > 0.70 * gross', async () => {
      // Fixture: gross=1000, prizesPaid=800 (80%)
      // Forventet: effectivePrizes=700, net=300, orgAmount=45 (15%)
    });

    it('skips cap when prizesPaid < 0.70 * gross', async () => {
      // Fixture: gross=1000, prizesPaid=500 (50%)
      // Forventet: effectivePrizes=500, net=500, orgAmount=75
    });

    it('applies 30% rate for DATABINGO', async () => {
      // Fixture: gameType=DATABINGO, gross=1000, prizes=500
      // Forventet: orgAmount=150 (30% av 500)
    });

    it('aggregates separately per (gameType, channel)', async () => {
      // Fixture: ledger med både MAIN_GAME/HALL og MAIN_GAME/INTERNET
      // Forventet: 2 separate breakdown-entries
    });

    it('throws on idempotency violation', async () => {
      // Calculate én gang, så kalle igjen for samme (hall, quarter)
      // Forventet: DomainError("CONFLICT")
    });

    it('throws if quarter is not yet ended', async () => {
      // now=2026-04-15, quarter='2026-Q2' (slutter 30. juni)
      // Forventet: DomainError("INVALID_INPUT")
    });

    it('throws if no allocations configured', async () => {
      // Hall uten rader i app_rg_hall_organizations
      // Forventet: DomainError("MISSING_CONFIG")
    });

    it('handles empty hall (no turnover) gracefully', async () => {
      // Fixture: ledger uten entries for hallen
      // Forventet: batch med breakdown=[], requiredMinOrgAmount=0
    });

    it('handles negative net via Math.max(0, ...)', async () => {
      // Fysisk umulig pga 70%-cap, men sanity-check med corrupted data
    });
  });

  describe('approveQuarterlyOrgDistribution', () => {
    it('blocks 4-eyes (calculatedBy === approvedBy)', async () => {
      // Forventet: DomainError("FORBIDDEN")
    });

    it('blocks non-ADMIN users', async () => {
      // Forventet: DomainError("FORBIDDEN")
    });

    it('blocks approval after PAID', async () => {
      // Forventet: DomainError("INVALID_STATE")
    });
  });

  describe('payQuarterlyOrgDistribution', () => {
    it('creates one ORG_DISTRIBUTION ledger event per (org × breakdown)', async () => {
      // Verifiser at app_rg_compliance_ledger har korrekte entries med batch_id-link
    });

    it('respects allocateAmountByShares (rest til første allocation)', async () => {
      // Fixture: orgAmount=100, allocations=[1/3, 1/3, 1/3]
      // Forventet: parts=[33.34, 33.33, 33.33]
    });

    it('rolls back wallet-transfer på partial-failure', async () => {
      // Mock: walletAdapter.transfer kaster på 2. transfer
      // Forventet: ingen wallet-state endret, batch-status fortsatt APPROVED
    });
  });

  describe('rollbackQuarterlyOrgDistribution', () => {
    it('reverses wallet-transfers when rolling back PAID batch', async () => {
      // Verifiser at wallet-balances tilbake til pre-PAID state
    });

    it('frees up (hall, quarter)-slot for new calculate', async () => {
      // Kall rollback, deretter ny calculate på samme (hall, quarter) — skal lykkes
    });
  });
});
```

### 9.2 Integration-tester mot ledger-fixtures

Ny test-fixture `apps/backend/src/__fixtures__/quarterly-org-distribution-fixtures.ts`:

```typescript
export const fixtures = {
  // Q1 2026 simulert: 90 dager med daglig STAKE+PRIZE-events
  smallHall: { hallId: 'hall-test-1', dailyGross: 1000, dailyPrizes: 600 },
  // Q1 2026 simulert med høy prize-ratio (utløser cap)
  highPrizeHall: { hallId: 'hall-test-2', dailyGross: 1000, dailyPrizes: 850 },
  // Hall med blanding av MAIN_GAME og DATABINGO
  mixedHall: { hallId: 'hall-test-3', mainGameHall: 500/300, mainGameInternet: 200/120, databingo: 100/65 },
};
```

Integration-test-flow:
1. Seed ledger med fixture-data via `BingoEngine.appendLedgerEntry`
2. Kall `service.calculate({ hallId, quarter: '2026-Q1' })`
3. Asserter på breakdown-shape og orgAmount
4. Kall `service.approve({ batchId, approvedBy: 'admin-1' })`
5. Kall `service.pay({ batchId, triggeredBy: 'admin-2' })`
6. Verifiser wallet-balance + ledger ORG_DISTRIBUTION-events

### 9.3 E2E-test for én full kvartalsbatch

`apps/backend/src/__e2e__/QuarterlyOrgDistribution.e2e.test.ts`:

- Start med fresh DB (test-instance)
- Seed: 1 hall, 2 organisasjoner med 60/40-split, 90 dager med ledger-events
- Kall `POST /api/admin/quarterly-org-distribution/calculate?hallId=X&quarter=2026-Q1` med ADMIN-bruker
- Kall `POST /api/admin/quarterly-org-distribution/approve` med annen ADMIN-bruker (4-eyes)
- Kall `POST /api/admin/quarterly-org-distribution/pay`
- Verifiser via `GET /api/admin/quarterly-org-distribution/:id`:
  - status === 'PAID'
  - distributedAmount === requiredMinOrgAmount (± rounding)
  - 2 rader i `app_quarterly_org_payments`
  - 2 ORG_DISTRIBUTION-events i `app_rg_compliance_ledger`
- Generer PDF og verifiser at den parser uten error (kan bruke pdfkit-test-helpers)

### 9.4 Compliance-suite-tilpasning

`apps/backend/src/compliance/compliance-suite.test.ts` har eksisterende §11-tester. Oppdater:
- Marker eksisterende `createOverskuddDistributionBatch`-tester som **legacy** (kjører fortsatt med flag, validerer bakover-kompabilitet)
- Add ny test-gruppe: "§11 — kvartalsvis fordeling (post-fase-1)"
- Add 70%-cap-validering som eksplisitt §11-invariant-sjekk

---

## §10. Open questions for PM

| # | Spørsmål | Anbefaling | Avhenger av |
|---|---|---|---|
| 1 | Skal vi støtte hall-eierbytte midt i kvartal, eller kreve at det skjer ved kvartal-grense? | **Krev kvartal-grense** for V1. Tilfelle midt-i-kvartal: manuell avgjørelse + revisor-koordinering. | Foreligger eierbytte i pilot-haller? |
| 2 | Skal hall-spesifikke prosenter (over 15%/30%-minimum) støttes i V1, eller utsettes? | **Inkluder i V1** (§6.2). Lite ekstra arbeid og åpner for forretnings-fleksibilitet. | Krever `app_halls`-migration. PM må bekrefte om noen pilot-haller faktisk har høyere avtaler. |
| 3 | Skal vi auto-approve etter X dager hvis admin glemmer? | **Nei** — krever human verifikasjon. Bruk e-post-eskalering i stedet. | Hvor strikse er Lotteritilsynet på 2-uker-fristen? |
| 4 | Skal `COMPLIANCE_OFFICER`-rolle innføres separat, eller bare ADMIN approve? | **Bare ADMIN i V1.** `COMPLIANCE_OFFICER` kan komme i V2 hvis tobias ønsker rolle-separasjon. | RBAC-ambisjons-nivå |
| 5 | Skal halvårsrapport (Q1+Q2 / Q3+Q4) ha separat batch-tabell, eller bare PDF-aggregering? | **Bare PDF-aggregering.** Kvartalene er kanoniske enheter; halvår er bare en visnings-aggregat. | Ingen DB-implikasjon |
| 6 | Hvem mottar kvartalsrapport-e-post — eksisterende `app_withdraw_email_allowlist` eller ny `app_regulatory_email_allowlist`? | **Ny tabell** for å skille rolletyper. Wallet-uttak er driftsbruk; regnskap-rapport er audit-bruk. | Email-konfig-arkitektur |
| 7 | 4-eyes på approval: må håndheves i kode, eller bare anbefalt prosess? | **Håndheves** (se §3.2 — `assert(approvedBy !== calculatedBy)`). Strenger ikke kostnaden. | OK i alle pilot-haller? |
| 8 | Hvis pilot-hall har bare én bingovert (admin = same person som kalkulerer): hvordan løses 4-eyes? | **PM eller annen ADMIN i system** approve-er. Alternativt: skriv en escape-hatch som bruker `OPERATOR_OVERRIDE`-rolle med audit-hot-flag. | Pilot-hall organisasjons-struktur |
| 9 | Skal PDF inkludere revisor-signatur-blokk eller kun bare regnskap-data? | **Inkluder signatur-blokk** (manuell utfylling med pen-kombi). Lotteritilsynet aksepterer detached signatures fra autoriserte revisorer. | Lotteritilsynet-format-krav |
| 10 | Skal vi støtte cross-hall-grupper (hall_groups) i kvartalsrapport? | **Nei i V1.** Hver hall rapporterer separat. Group-aggregering kan legges til senere som visnings-feature. | Cross-hall-spill-modellen |
| 11 | Hva skjer hvis en `ORG_DISTRIBUTION`-event allerede finnes for samme (hall, quarter, gameType, channel) fra legacy per-runde-flow? | **Ignorer i kalkulasjon** (filtrer på event_type=STAKE/PRIZE/EXTRA_PRIZE). Rapporter dem som "tidligere utbetalt" i admin-UI for context, men ikke trekk fra `requiredMinOrgAmount`. | Hvor mange legacy ORG_DISTRIBUTION-events finnes ved migrasjon? |
| 12 | Bør formula_version-feltet ha en formell endrings-logg som dokumenterer hvilke endringer som er gjort i hver versjon? | **Ja** — `docs/architecture/QUARTERLY_FORMULA_CHANGELOG.md`. | Compliance-trail |

---

## §11. Sammenheng med øvrig arkitektur

| Område | Påvirkning |
|---|---|
| `apps/backend/src/game/ComplianceLedger.ts` | Beholder rolle som event-store. Ny service leser via eksisterende `generateRangeReport`. Eksisterende write-API uendret. |
| `apps/backend/src/game/ComplianceLedgerOverskudd.ts` | Demotert i fase 2, fjernet i fase 4. `allocateAmountByShares` (linje 44) flyttes til `apps/backend/src/util/currency.ts` for gjenbruk. |
| `apps/backend/src/compliance/HallAccountReportService.ts` | Uendret — fortsatt per-dag-rapportering. Kan utvide med "Q1 sum" hvis admin-UI ønsker det. |
| `apps/backend/src/compliance/AuditLogService.ts` | Får nye action-typer: `quarterly_org_distribution.{calculated,approved,paid,rolled_back,recalculated}`. |
| `apps/backend/src/admin/AccountingEmailService.ts` | Får ny method: `sendQuarterlyReportNotification(...)` + `sendApprovalReminder(...)`. |
| `apps/backend/src/util/pdfExport.ts` | Får 2 nye funksjoner: `generateQuarterlyOrgDistributionPdf` og `generateHalfYearOrgDistributionPdf`. |
| `apps/admin-web/` | Ny side: `QuarterlyOrgDistributionPage.ts` + tilhørende route. |
| Lotteritilsynet halvårsrapport | Manuell innsending via Altinn LS-0003 — vi sender PDF til regnskap som vedlegg. |

---

## §12. Forventet total dev-effort

Cross-check med Linear-issue (~6-9 dev-dager): **8-10 dev-dager** for full implementasjon, fordelt:

| Fase | Effort | Kritisk path |
|---|---|---|
| Fase 1 (ny service parallelt) | 3 dev-dager | Migration + service + tester |
| Fase 2 (demote per-runde) | 1.5 dev-dager | Config-flagg + dokumentasjon |
| Fase 3 (pilot Q3 2026) | 2 dev-dager (+ 2-uker validering) | PDF-iterasjon, regnskap-feedback |
| Fase 4 (fjern død kode) | 1.5 dev-dager | Kun cleanup, ingen ny funksjonalitet |
| **Total** | **8 dev-dager** + buffer | Pilot-feedback kan utvide fase 3 |

Hvis pilot-hall avdekker felt-mapping-issues (sannsynlig 1-2 runder): legg til 2 dev-dager buffer. **Endelig estimat: 10 dev-dager / ~2 sprint-uker.**

---

## §13. Suksesskriterier

- [ ] Q3 2026 (sept-30) — første ekte kvartal kjørt med ny service for minst pilot-hall
- [ ] Q3 2026 — Lotteritilsynet-rapport innsendt 14. okt 2026 med data fra ny system
- [ ] Compliance-suite + nye tester grønne
- [ ] Per-runde-kode (`createOverskuddDistributionBatch`) fjernet senest 1. apr 2027 (etter 2 vellykkede kvartaler)
- [ ] PDF-format godkjent av minst én autorisert revisor

---

## §14. Risiko og mitigering

| Risiko | Sannsynlighet | Konsekvens | Mitigering |
|---|---|---|---|
| 70%-cap-tolkning er feil (Tobias' bekreftelse stemmer ikke med Lotteritilsynet) | Lav | Høy (regulatorisk-feil) | Kjør pilot Q3 2026 med revisor-validering før Q4 |
| Pilot-hall får annen LS-0003-feltkrav enn vi har designet for | Medium | Medium | Iterér i fase 3, buffer i estimat |
| Wallet-transfer feiler midt i pay-loop | Medium | Høy (penger på avveie) | DB-transaksjon + reverse-on-fail i `payQuarterlyOrgDistribution` |
| Forsinket ledger-data (sjeldent) | Lav | Lav | Inkluderes i neste kvartals-batch, dokumenteres i revisor-notat |
| Fase 4 (cleanup) reverteres pga unforeseen edge case | Lav | Lav | Backup-PR strategi: fase 4 PR kan reverteres uten DB-impact |

---

## §15. Referanser

### Eksterne kilder
- [Forskrift om pengespill (pengespillforskriften) Kap. 11 — Lovdata](https://lovdata.no/dokument/SF/forskrift/2022-11-17-1978/kap11)
- [Forskrift om bingo Kap. 5 — Krav til regnskap, Lovdata](https://lovdata.no/dokument/SFO/forskrift/2004-11-30-1528/KAPITTEL_5)
- [Altinn LS-0003 Rapporteringsskjema — Lotteri- og stiftelsestilsynet](https://info.altinn.no/skjemaoversikt/lotteri--og-stiftelsestilsynet/rapporteringsskjema/)

### Interne avhengigheter
- `docs/architecture/SPILLKATALOG.md` — game-classification kanonisk
- `docs/operations/PAYOUT_REPORTING_AUDIT_2026-04-25.md` — strategi for Lotteritilsynet-rapportering
- `docs/compliance/SPILL1_GAMETYPE_INVESTIGATION_2026-04-25.md` — game-type-klassifisering
- `docs/architecture/PHYSICAL_TICKETS_PILOT_DESIGN_2026-04-22.md` — eksempel på pilot-design-pattern
- `apps/backend/src/game/ComplianceLedger.ts` — eksisterende ledger-domene
- `apps/backend/src/game/ComplianceLedgerOverskudd.ts` — kode som demoteres i fase 2
- `apps/backend/src/game/ComplianceLedgerAggregation.ts` — `generateRangeReport` gjenbrukes
- `apps/backend/src/game/ComplianceLedgerTypes.ts` — typer gjenbrukes
- `apps/backend/src/compliance/AuditLogService.ts` — audit-trail for status-overganger
- `apps/backend/src/admin/AccountingEmailService.ts` — e-post-flow for regnskap
- `apps/backend/src/util/pdfExport.ts` — PDF-template-pattern
- `apps/backend/migrations/20260413000001_initial_schema.sql:402-433` — eksisterende `app_rg_*`-tabeller
- `apps/backend/migrations/20260417000005_regulatory_ledger.sql` — append-only-trigger-mønster (gjenbrukes)

---

## §16. For nestemann som leser dette

Hvis du skal implementere en del av denne arkitekturen:

1. **Start med fase 1** — bare den nye service-en, ingen endring i eksisterende kode. Vi har full bakover-kompabilitet.
2. **Les `ComplianceLedgerOverskudd.ts` først** — det er der dagens logikk lever, og du må forstå semantikken før du erstatter den.
3. **Spør om 70%-cap-tolkningen** — hvis det er noe usikkerhet, dobbeltsjekk med Tobias eller en autorisert revisor før du implementerer.
4. **Test mot fixtures, ikke prod-data** — kvartal-batcher er regulatorisk-kritiske; bug-fixes er dyre etter PAID.
5. **Hvis du ser en use case som ikke er dekket her** — legg til en åpen-spørsmål-rad i §10 og spør PM før du designer rundt det.

Hvis du fortsatt er usikker: konsulter `docs/architecture/SPILLKATALOG.md` og `docs/operations/PAYOUT_REPORTING_AUDIT_2026-04-25.md` for kontekst, deretter spør Tobias.
