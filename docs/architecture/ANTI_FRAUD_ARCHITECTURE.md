# Anti-fraud Architecture (BIN-806 A13)

**Status:** Implementert 2026-05-08. Pilot-klar.
**Eier:** Tobias Haugen + sikkerhets-team.
**Linear:** BIN-806 — Anti-fraud / velocity-checks + bot-detection.

---

## 1. Oversikt

Spillorama kjører en heuristikk-basert anti-fraud-pipeline pre-commit på
hver wallet-mutasjon (debit, credit, topup, withdraw, transfer). Ingen
ML-modeller i pilot-fasen — vi har 5 tydelig dokumenterte heuristikker
som er konfigurerbare via constructor-options så pilot-justering ikke
krever kode-deploy.

**Designprinsipper:**

1. **Pre-commit blokkering ved CRITICAL.** Kun `risk = "critical"` kaster
   `DomainError("FRAUD_RISK_CRITICAL")` og hindrer wallet-mutasjonen i å
   committe. `high` tillater men flagger for admin-review.
2. **Fail-open ved DB-feil.** Hvis selve assessment-tjenesten feiler
   (DB nede, schema-init feilet), tillater pipelinen mutasjonen. Det
   beskytter wallet-flow mot å falle ned ved sentral-DB-trøbbel.
3. **Audit-trail for ALLE assess-calls** (også `low`). Hver wallet-
   mutasjon med `antiFraudContext` får en rad i `app_anti_fraud_signals`.
   Dette gir admin et fullt trail og lar fremtidige ML-modeller (BIN-806
   follow-up) trene på pattern.
4. **Decorator-pattern.** `AntiFraudWalletAdapter` wrapper en
   `WalletAdapter` uten å endre inner-adapter-koden. Backend-agnostisk
   (Postgres/File/Http/InMemory).
5. **Module-augmentation for context-feltet.** `TransactionOptions
   .antiFraudContext` legges til via TypeScript-augmentation i
   `apps/backend/src/security/walletAdapterAugmentation.ts` istedenfor
   å endre `WalletAdapter.ts`. Conflict-mitigation mot Agent U (BIN-806
   brief).

---

## 2. Komponentkart

```
┌──────────────────────────────────────────────────────────────────┐
│  Route handler (e.g. admin top-up)                              │
│   • req.body.amount, req.user.id, req.ip                        │
│   • bygger options.antiFraudContext = { userId, hallId, ip }    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  AntiFraudWalletAdapter (decorator)                             │
│   • assessOrThrow(options, opType, amount)                      │
│       └─ if antiFraudContext set:                               │
│           call AntiFraudService.assessTransaction()             │
│           if risk === "critical" → throw FRAUD_RISK_CRITICAL    │
│   • delegate to inner adapter (Postgres/File/Http)              │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  AntiFraudService                                                │
│   • runVelocityCheck (DB count over 1h + 24h windows)            │
│   • runAmountDeviationCheck (DB AVG over 30d)                    │
│   • recordIpObservation + runMultiAccountIpCheck (in-memory)     │
│   • runBotTimingCheck (variansanalyse, separat API)              │
│   • aggregate maks-risk → action                                 │
│   • persistSignal → INSERT INTO app_anti_fraud_signals           │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
            ┌─────────────────────────────────┐
            │  Postgres                       │
            │   • wallet_transactions         │
            │     (read-only kilde for        │
            │      velocity + deviation)      │
            │   • app_anti_fraud_signals      │
            │     (audit-trail)               │
            └─────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  GET /api/admin/anti-fraud/signals                              │
│   • RBAC: ADMIN_ANTI_FRAUD_READ                                  │
│   • Filter: hallId / userId / riskLevel / actionTaken / dato     │
│   • Returnerer signaler nyest først, max 500                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Heuristikker

### 3.1 VELOCITY_HOUR / VELOCITY_DAY

**Kilde:** Postgres `wallet_transactions` siste 1h og 24h.

Tellinger over terskler:

| Vindu | Medium | High | Critical |
|---|---:|---:|---:|
| 1h | > 10 | > 30 | > 60 |
| 24h | > 100 | > 200 | > 500 |

Brukstilfelle: rask serie debits/withdraws indikerer bot-misbruk eller
account-takeover. Counters er kumulative — DAY-vinduet inkluderer alle tx
i siste 24t, ikke bare timer 2-24.

### 3.2 AMOUNT_DEVIATION

**Kilde:** Postgres `wallet_transactions.amount` siste 30 dager. Sjekker
ratio = `currentAmountCents / averageAmountCents`.

| Ratio | Level |
|---|---|
| > 5x avg | medium |
| > 10x avg | high |
| > 25x avg | critical |

**Skip-betingelser:**
- `amountCents <= 0` (rene velocity-checks uten beløp).
- `sampleCount < 3` (for lite historikk for å trygt si at nåværende
  beløp er anomali).
- `avgAmountCents <= 0` (defensiv mot tomme aggregat-rader).

### 3.3 MULTI_ACCOUNT_IP

**Kilde:** In-memory cache på service-instansen. Hver `assessTransaction`
med IP-adresse oppdaterer `Map<ip, Set<userId>>`. TTL: 24h
(konfigurerbar via `ipCacheTtlMs`).

| Unike userId per IP | Level |
|---:|---|
| > 3 | medium |
| > 5 | high |
| > 10 | critical |

**Multi-instance-begrensning:** Cachen er ikke delt på tvers av
node-instanser. For ekte multi-host-setup bør dette flyttes til Redis
(BIN-806 follow-up).

### 3.4 BOT_TIMING

**Kilde:** Caller passerer en array `timestampsMs` av ms-stempler for
ticket-marks/claims. Service beregner `stdDev` på timing-deltas.

| StdDev | Level |
|---:|---|
| < 50ms | medium |
| < 25ms | high |
| < 10ms | critical |

**Krav:** Minimum 100 samples (under det → ingen signal). Egen API
(`assessBotTiming`) — kalles av game-laget separat, ikke fra wallet-
pipelinen.

---

## 4. Risiko-aggregering

Pipelinen tar **maksimumsrisiko** på tvers av signaler. Eksempel:

- VELOCITY_HOUR=medium + MULTI_ACCOUNT_IP=high → totalt = high
- AMOUNT_DEVIATION=critical alone → totalt = critical

Mapping risk → action:

| Risk | Action | Wallet-effekt |
|---|---|---|
| low | logged | tillatt + audit-rad |
| medium | logged | tillatt + audit-rad |
| high | flagged_for_review | tillatt + admin-flagg |
| critical | blocked | DomainError(FRAUD_RISK_CRITICAL), wallet uberørt |

---

## 5. Wireup

### 5.1 I `apps/backend/src/index.ts` (follow-up etter Agent U)

```ts
import { AntiFraudService } from "./security/AntiFraudService.js";
import { AntiFraudWalletAdapter } from "./security/AntiFraudWalletAdapter.js";

const antiFraudService = new AntiFraudService({
  pool: sharedPool,
  schema: pgSchema,
  // Pilot-defaults; juster via env eller direct edit
  // thresholds: { velocityHour: { ... } },
});

// Wrap eksisterende WalletStateNotifyingAdapter
const walletAdapter = new AntiFraudWalletAdapter(
  walletStateNotifyingAdapter, // existing
  antiFraudService,
);

app.use(createAdminAntiFraudRouter({
  platformService,
  antiFraudService,
}));
```

### 5.2 I route handlers (eksempel)

```ts
import "../security/walletAdapterAugmentation.js"; // type-augmentation

await walletAdapter.debit(walletId, amount, "Player buy-in", {
  idempotencyKey: requestId,
  antiFraudContext: {
    userId: user.id,
    hallId: user.hallId,
    ipAddress: req.ip,
  },
});
```

System-interne flow (e.g. house→house refund) kan utelate
`antiFraudContext` — decorator-en blir pass-through.

---

## 6. Database-skjema

```sql
CREATE TABLE app_anti_fraud_signals (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  hall_id         TEXT NULL,
  transaction_id  TEXT NULL,  -- NULL ved blocked-flow
  risk_level      TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  signals_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_taken    TEXT NOT NULL CHECK (action_taken IN ('logged','flagged_for_review','blocked')),
  ip_address      TEXT NULL,
  amount_cents    BIGINT NULL,
  operation_type  TEXT NULL,
  assessed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Indekser (alle partial for hot-paths):
- `idx_app_anti_fraud_signals_review_queue` (`assessed_at DESC`,
  WHERE `action_taken IN ('flagged_for_review','blocked')`)
- `idx_app_anti_fraud_signals_hall` (`(hall_id, assessed_at DESC)`,
  WHERE `hall_id IS NOT NULL`)
- `idx_app_anti_fraud_signals_user` (`(user_id, assessed_at DESC)`)
- `idx_app_anti_fraud_signals_risk_level`
  (`(risk_level, assessed_at DESC)`)

---

## 7. Test-strategi

42 tester totalt:

- `AntiFraudService.test.ts` (25 tester) — heuristikk-isolasjon + aggregat
  + persistens + filtrering. Bruker pg.Pool-stub som etterligner
  `wallet_transactions` og `app_anti_fraud_signals`.
- `AntiFraudWalletAdapter.test.ts` (7 tester) — pass-through, critical-
  blokkering, fail-open ved DB-feil, operationType-mapping.
- `adminAntiFraud.test.ts` (10 tester) — RBAC (ADMIN/SUPPORT in,
  HALL_OPERATOR/PLAYER ut), query-parameter-validering, ISO-8601-håndtering.

Kjør med:

```bash
npx tsx --test \
  apps/backend/src/security/__tests__/AntiFraudService.test.ts \
  apps/backend/src/security/__tests__/AntiFraudWalletAdapter.test.ts \
  apps/backend/src/routes/__tests__/adminAntiFraud.test.ts
```

---

## 8. Avgrensninger og fremtidsplan

**Pilot-mangler (akseptert):**
- IP-cache er per-instance. Multi-host setup trenger Redis.
- Audit-skriving er fail-soft mot DB. Hvis DB er nede mister vi enkelt-
  rader (sjelden — kun under DB-incident).
- ML-modeller ikke implementert. Heuristikkene er dokumenterte og
  konfigurerbare; pattern-data samles i `app_anti_fraud_signals` for
  fremtidig trening.

**Roadmap (post-pilot):**
1. Redis-backed IP-cache for multi-host.
2. ML-modell trent på `app_anti_fraud_signals` for å oppdage subtile
   pattern (f.eks. coordinated multi-account "round-trip"-attacker).
3. Webhook-utgang til ekstern AML-verktøy (Sumsub, Refinitiv etc.).
4. Auto-handling: medium-risiko trigger ekstra step-up-auth (2FA)
   istedenfor å bare logge.

---

## 9. Referanser

- `apps/backend/src/security/AntiFraudService.ts`
- `apps/backend/src/security/AntiFraudWalletAdapter.ts`
- `apps/backend/src/security/walletAdapterAugmentation.ts`
- `apps/backend/src/routes/adminAntiFraud.ts`
- `apps/backend/migrations/20261217000000_app_anti_fraud_signals.sql`
- Linear BIN-806
- Brief: M2 Multi-hall-launch, Spor A — Tekniske
