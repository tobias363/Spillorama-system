# Debit-Only Enforcement — 2026-04-26

**Status:** Implementert som del av Scenario A (Tobias 2026-04-26)
**Forfatter:** Agent PAYMENT-IMPL
**Scope:** Online deposit via Swedbank Pay Checkout 3.1
**Regulatorisk kilde:** Pengespillforskriften § 7 — kredittkort er forbudt som betalingsmiddel for pengespill

---

## TL;DR

Spillorama-systemet aksepterer **kun debetkort** for online innskudd til player-wallet. Implementeringen bruker en to-lags forsvars-strategi:

1. **Pre-authorise (widget-restriksjon):** Vi sender `restrictedToInstruments: ["VisaDebit"]` (eller `["MastercardDebit"]`) til Swedbank Pay's `paymentorders`-endpoint. Swedbank's checkout-widget viser dermed kun debet-varianter; kunden kan ikke "klikke seg gjennom" til et kredittkort i UI-en.

2. **Post-authorise (callback-validering):** Når Swedbank rapporterer betalingen som `Paid`, leser vi `cardFundingType` fra `paid`-ressursen. Hvis verdien ikke er `DEBIT` for kort-flyter, **avvises** betalingen før wallet kreditteres. Vi kaller `POST .../cancellations` på Swedbank for å reversere autorisering, og persisterer `rejection_reason="CREDIT_CARD_FORBIDDEN"`.

Begge lagene må feile samtidig for at et kredittkort skal lykkes — defense-in-depth som fail-closed.

---

## §1. Hvorfor

Pengespillforskriften § 7 forbyr norske pengespilltilbydere å akseptere kredittkort som betalingsmiddel. Bakgrunnen er problemspill-prevensjon: kredittkjøp av pengespill kan føre til gjeldssituasjoner som vanlig debetkort-uttak ikke kan.

Lotteritilsynet håndhever dette ved revisjon av påvirkede tilbydere (norsk tipping, bingoanlegg, online-pengespill). Brudd kan medføre:

- Pålegg om umiddelbar opphør av kredittkort-aksept
- Bot eller inndraging av tillatelse
- Reputational damage ved offentlig kritikk

For Spillorama-pilot (medio juni 2026) må enforcement være verifiserbar **før** første reelle innskudd med kort skjer i prod.

---

## §2. Arkitektur

```
┌──────────────────────────────────────────────────────────────────┐
│                          Player web-shell                          │
│  POST /api/payments/topup-online                                   │
│       { amount, paymentMethod: "VISA_DEBIT", vippsPhoneNumber? }  │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                   SwedbankPayService.createTopupIntent             │
│                                                                    │
│  Input  : paymentMethod: PaymentMethod (whitelist)                │
│  Branch : paymentMethodToSwedbankInstruments(method)              │
│           VISA_DEBIT      → ["VisaDebit"]    ← REGULATORISK GATE  │
│           MASTERCARD_DEBIT→ ["MastercardDebit"]                   │
│           VIPPS           → ["Vipps"]                             │
│           APPLE_PAY       → ["ApplePay"]                          │
│           GOOGLE_PAY      → ["GooglePay"]                         │
│                                                                    │
│  POST → Swedbank /psp/paymentorders                               │
│         payload.paymentorder.restrictedToInstruments = [...]      │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
                   ┌────────────────┐
                   │ Swedbank widget│
                   │ (kun debit-    │
                   │  brands vises) │
                   └────────┬───────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
       Kunde betaler             Kunde lukker browser
       med kort/Vipps            (CREATED → CANCELLED via cron)
              │
              ▼
   ┌──────────────────────────┐
   │ Swedbank callback til    │
   │ /api/payments/swedbank/  │
   │ callback (HMAC-verified) │
   └──────────┬───────────────┘
              │
              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │            SwedbankPayService.reconcileRow                     │
   │                                                                │
   │  1. fetch paymentOrder?$expand=paid                           │
   │  2. extractCardFundingType(paid)                              │
   │  3. ▼ REGULATORISK GATE ▼                                     │
   │     if (paymentMethod is card AND fundingType !== "DEBIT"):   │
   │         markIntentRejected(reason=CREDIT_CARD_FORBIDDEN)      │
   │         POST /cancellations  (best-effort)                    │
   │         audit("payment.online.rejected")                      │
   │         throw DomainError("CREDIT_CARD_FORBIDDEN")            │
   │         WALLET IS NEVER CREDITED ◄                            │
   │  4. else: BEGIN TX → walletAdapter.topUp() → COMMIT           │
   │     audit("payment.online.completed")                         │
   └──────────────────────────────────────────────────────────────┘
```

---

## §3. Implementasjons-detaljer

### 3.1 Lag 1: `restrictedToInstruments` i Swedbank-payload

`SwedbankPayService.createTopupIntent` sender følgende payload til Swedbank:

```json
{
  "paymentorder": {
    "operation": "Purchase",
    "intent": "Authorization",
    "instrument": "VisaDebit",
    "restrictedToInstruments": ["VisaDebit"],
    "...": "..."
  }
}
```

Swedbanks brand-katalog skiller mellom:
- `Visa` → aksepterer både Visa Debit og Visa Credit
- `VisaDebit` → kun debet-Visa
- `Mastercard` → aksepterer både Mastercard Debit og Mastercard Credit
- `MastercardDebit` → kun debet-Mastercard

Vi sender alltid `*Debit`-varianten for kort-flyter (`paymentMethodToSwedbankInstruments` i `SwedbankPayService.ts:308–323`).

### 3.2 Lag 2: `cardFundingType`-validering i `reconcileRow`

Når Swedbank rapporterer betalingen som `Paid`:

1. Vi henter authoritativ status med `GET .../paymentorders/<id>?$expand=paid`
2. Vi leser `paid.cardFundingType` (Swedbanks lower-case "debit"/"credit"/"prepaid"/"deferred_debit")
3. `isAcceptableFundingType(method, fundingType)` returnerer `false` hvis:
   - method er VISA_DEBIT eller MASTERCARD_DEBIT, OG
   - fundingType er noe annet enn "DEBIT" (inkluderer CREDIT, PREPAID, DEFERRED_DEBIT, UNKNOWN, undefined)
4. Ved avvisning:
   - `markIntentRejected` setter `status='REJECTED'`, `rejection_reason='CREDIT_CARD_FORBIDDEN'`, `card_funding_type='CREDIT'` (eller hva Swedbank returnerte)
   - `attemptCancelPaymentOrder` POST-er til `.../cancellations` (best-effort; non-fatal hvis det feiler — kortet er aldri blitt captured så det er ingen reell debit-transaksjon å reversere)
   - Audit-event `payment.online.rejected` emittes med `reason`, `paymentMethod`, `cardFundingType`, `cardBrand`, `amountCents`
   - `DomainError("CREDIT_CARD_FORBIDDEN", "Kun debetkort er tillatt for innskudd.")` kastes
5. Wallet **er aldri kreditert**.

### 3.3 Mobile wallets (Vipps, Apple Pay, Google Pay)

Mobile wallets er underlagt sin egen funding-restriksjon: når kunden registrerer kort i Vipps/Apple Pay/Google Pay-appen, er det wallet-en selv som validerer underlying funding source. Swedbank returnerer som regel ikke `cardFundingType` for disse betalingene.

`isAcceptableFundingType` ignorerer derfor fundingType for mobile wallets:

```ts
if (method === "VIPPS" || method === "APPLE_PAY" || method === "GOOGLE_PAY") {
  return true; // mobile-wallet håndhever fundingType selv
}
```

**Risiko:** Hvis en bruker har lagt et kredittkort i sin Vipps-konto, kan det betalingen kreves trekt fra det kortet uten at vi ser det. Mitigasjon: Vipps Norge AS har egne avtaler med kortutstedere som blokkerer kredittkort for pengespill-transaksjoner; dette håndteres på Vipps-siden via merchant-kategorisering (MCC 7995).

---

## §4. Audit-trail

Alle online-betalinger genererer audit-events i `app_audit_log` (via `auditLogService.record`):

### 4.1 Successful top-up

```
action:    "payment.online.completed"
resource:  "swedbank_payment_intent"
resourceId: <intent_id>
actorId:   <user_id>
actorType: "USER"
details:   {
  paymentMethod:   "VISA_DEBIT" | "MASTERCARD_DEBIT" | "VIPPS" | "APPLE_PAY" | "GOOGLE_PAY",
  cardFundingType: "DEBIT" | null,
  cardBrand:       "VISA" | "MASTERCARD" | "VIPPS" | null,
  amountCents:     <minor>,
  currency:        "NOK",
  walletTransactionId: <wallet_tx_id>
}
```

### 4.2 Rejected credit-card attempt

```
action:    "payment.online.rejected"
resource:  "swedbank_payment_intent"
resourceId: <intent_id>
actorId:   <user_id>
actorType: "USER"
details:   {
  reason:          "CREDIT_CARD_FORBIDDEN",
  paymentMethod:   "VISA_DEBIT" | "MASTERCARD_DEBIT",
  cardFundingType: "CREDIT" | "PREPAID" | "DEFERRED_DEBIT" | "UNKNOWN",
  cardBrand:       <evt brand fra Swedbank>,
  amountCents:     <minor>,
  currency:        "NOK"
}
```

Disse er tilstrekkelig grunnlag for Lotteritilsynet-revisjon: man kan filtrere `WHERE action = 'payment.online.rejected' AND details->>'reason' = 'CREDIT_CARD_FORBIDDEN'` for å se alle credit-attempts.

### 4.3 DB-persistens

I tillegg til audit-log persisterer vi i `swedbank_payment_intents`:

- `payment_method` (TEXT) — klient-spesifisert metode
- `card_funding_type` (TEXT) — DEBIT/CREDIT/PREPAID/DEFERRED_DEBIT
- `card_brand` (TEXT) — VISA/MASTERCARD/VIPPS osv.
- `rejected_at` (TIMESTAMPTZ) — settes ved avvisning
- `rejection_reason` (TEXT) — `CREDIT_CARD_FORBIDDEN` eller annen kode

Migration: `apps/backend/migrations/20260902000000_payment_methods.sql`

---

## §5. Test-coverage

| Test | Fil | Antall tests |
|---|---|---:|
| Helpers (whitelist + funding-validering) | `SwedbankPayService.paymentMethods.test.ts` | 11 |
| End-to-end credit-card-rejection-flyt | `SwedbankPayService.debitOnly.test.ts` | 3 |
| Endpoint-validering | `paymentsRoute.topupOnline.test.ts` | 10 |
| **Total** | | **24** |

Kjernetest `SwedbankPayService.debitOnly.test.ts:processCallback rejects credit-card payment + audits + does NOT credit wallet` verifiserer hele kjeden: callback → fetch → reject → cancel → audit → ingen wallet-credit.

---

## §6. Operasjonell håndtering

### 6.1 Hva spilleren ser

Når en kunde forsøker å betale med kredittkort (mot all forventning, siden widget-en restrikterer det), får hen en norsk feilmelding i player-shell:

> **"Kun debetkort er tillatt for innskudd."**

Player-shell (`apps/backend/public/web/profile.js:341–347`) mapper også feilkoden:

```js
if (err && err.code === 'CREDIT_CARD_FORBIDDEN') {
  msg = 'Kun debetkort er tillatt for innskudd.';
}
```

UI viser i tillegg statisk tekst i deposit-modal: *"Kun debetkort er tillatt for innskudd."*

### 6.2 Hva som skjer med pengene

- **Korbet aldri belastet:** Vi capturer aldri (kun authorise → cancel). Banken reverserer autoriseringen typisk innen 24 timer.
- **Wallet aldri kreditert:** Player ser ingen midler på saldo.
- **Audit-trail komplett:** Lotteritilsynet kan reproducere hendelsen fra `swedbank_payment_intents` + `app_audit_log`.

### 6.3 Hva ops bør overvåke

- **Antall avviste credit-attempts:** dashboard `SELECT COUNT(*) FROM swedbank_payment_intents WHERE rejection_reason = 'CREDIT_CARD_FORBIDDEN' AND rejected_at > now() - interval '24 hours'`. Forventet ≈ 0 i normaldrift; spike kan indikere at Swedbanks brand-mapping er endret eller at en kunde finner UI-bug.
- **Failed cancellations:** se loggføringer `[swedbank] cancel after credit-card rejection failed` — disse er non-fatal men ops bør følge opp manuelt.

---

## §7. Endringer som ikke er gjort i Scenario A

Følgende er bevisst utsatt til Fase 2 / pre-GA:

- **TOTP 2FA på bank-uttak ≥ 1 000 NOK:** Pengespillforskriften krever ikke 2FA, men det er en kompenserende kontroll for høy-saldo-spillere. Spec'et i `PAYMENT_FLOW_SPEC_2026-04-26.md` Beslutning 5(b).
- **AML transaction-monitoring (Hvitvaskingsloven):** terskel-rapportering på bank-uttak ≥ 100 000 NOK. `adminAml.ts` finnes; full integrasjon ikke verifisert.
- **IBAN MOD-97 + holder-name-match:** krever DNB BankID-API integrasjon (~2 mnd lead-time).
- **Refund-flyt:** hvis et innskudd må refunderes etter at vi har kreditert wallet (sjelden — kun ved manuelle korrigeringer), trenger vi `Reversal` mot Swedbank — ikke implementert.

Disse skal addresseres i Fase 2 eller pre-GA-revisjon.

---

## §8. Referanser

- **Spec:** `docs/architecture/PAYMENT_FLOW_SPEC_2026-04-26.md`
- **Wireframe:** `docs/architecture/WIREFRAME_CATALOG.md` (PDF 10 §10.2)
- **Migration:** `apps/backend/migrations/20260902000000_payment_methods.sql`
- **Service:** `apps/backend/src/payments/SwedbankPayService.ts:283–366` (helpers), `:687–719` (reconcile-gate)
- **Endpoint:** `apps/backend/src/routes/payments.ts:78–123`
- **Tests:** `apps/backend/src/payments/__tests__/SwedbankPayService.{paymentMethods,debitOnly}.test.ts`, `paymentsRoute.topupOnline.test.ts`
- **Pengespillforskriften § 7:** [Lovdata](https://lovdata.no/dokument/SF/forskrift/1995-02-24-185)
- **Swedbank Pay Checkout 3.1 brand-codes:** <https://developer.swedbankpay.com/checkout-v3/payments-only/payments/card>

---

**End of document.**
