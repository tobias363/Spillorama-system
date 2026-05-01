# AGENT Withdrawal Flow — Prod QA 2026-05-01

**Tester:** QA-agent (curl mot https://spillorama-system.onrender.com)
**Rolle under test:** AGENT (`demo-agent-1@spillorama.no`, hall `demo-hall-001`)
**Scope:** verifisere at AGENT kan eksekvere full withdrawal-flyt for sin egen hall via backend-rutene som driver `Uttaksadministrasjon`-menyen i admin-web.

## Resultater per steg

| # | Steg | Status | HTTP | Kommentar |
|---|------|--------|------|-----------|
| 1 | Spiller `POST /api/payments/withdraw-request` (HALL 100 NOK + BANK 500 NOK) | ✅ | 200 | Begge requests opprettet PENDING. **MERK:** når klienten ikke sender `destinationType`, lagres feltet som `null` i DB (ikke `'hall'`). Påvirker steg 4 nedenfor. |
| 2 | AGENT `GET /api/admin/payments/requests?type=withdraw&status=PENDING&hallId=demo-hall-001` | ✅ | 200 | Returnerer både hall- og bank-request, sammen med tidligere PENDING fra demo-pilot-spiller-2. |
| 3 | AGENT `POST /api/admin/payments/requests/{id}/accept` på begge | ✅ | 200 | `status=ACCEPTED`, `walletTransactionId` satt, `acceptedBy=demo-agent-1`. Wallet-debit verifisert. |
| 4 | AGENT `GET /api/admin/withdrawals/history?type=hall|bank|all&hallId=demo-hall-001` | 🟡 | 200 | `type=bank` ✅, `type=all` ✅, `type=hall` returnerer **0** for requests opprettet uten `destinationType`. Etter ny request med eksplisitt `destinationType:"hall"` → `type=hall` returnerer 1. Se BUG-1 nedenfor. |
| 5 | AGENT `GET /api/admin/withdraw/xml-batches?limit=10` | ✅ | 200 | Tom liste (ingen batch generert ennå) — forventet. |
| 6 | AGENT `POST /api/admin/withdraw/xml-batches/export` body `{agentUserId:null}` | ✅ | 200 | `rowCount=0` fordi accepted bank-row var allerede prosessert utenfor agent-scope. Endepunkt eksisterer og er åpent for AGENT (PAYMENT_REQUEST_WRITE). |
| 7 | AGENT `GET /api/admin/security/withdraw-emails` (e-post-allowlist) | ❌ | 200 | `{ok:false,code:FORBIDDEN}` — endepunkt bruker `SECURITY_READ` som **kun gir ADMIN+SUPPORT** tilgang. AGENT (og HALL_OPERATOR) er låst ute. Se BUG-2. |
| 8 | AGENT cross-hall scope (`hallId=demo-hall-002`) | ✅ | 200/403 | `requests?hallId=demo-hall-002` → 403 FORBIDDEN. `withdrawals/history?hallId=demo-hall-002` → 0 items (auto-scope rewriter filteret). PENDING-listing uten `hallId` auto-scopes til egen hall. |
| Bonus | AGENT `POST /requests/{id}/reject` med reason | ✅ | 200 | `status=REJECTED`, `rejectionReason` lagret, `rejectedBy=demo-agent-1`. |

## Bugs funnet

### 🟡 BUG-1: `type=hall` filter savner null-destinationType (frontend-bug)
- **Trigger:** Spiller-klienten kaller `POST /api/payments/withdraw-request` uten `destinationType` (kun `amountCents`+`hallId`). DB lagrer `destination_type=NULL`.
- **Effekt:** `GET /api/admin/withdrawals/history?type=hall` filtrerer på `destination_type='hall'` og finner ingen NULL-rader. Admin-web `/withdraw/history/hall` viser tom liste selv om accepted hall-uttak finnes.
- **Verifisert:** `f68a3268-...` ble akseptert (`destinationType:null`), `8df7498e-...` opprettet med eksplisitt `"hall"` → kun sistnevnte vises i `type=hall`.
- **Fix:** enten (a) backend: tving `destinationType='hall'` som default i `createWithdrawRequest` når klienten ikke sender feltet, eller (b) frontend: send alltid `destinationType` i player-app + admin-web. Anbefal (a) for å bevare bakoverkompatibilitet.
- **Filer:** `apps/backend/src/routes/paymentRequests.ts:776` (POST-handler), `apps/backend/src/wallet/PaymentRequestService.ts` (createWithdrawRequest).

### ❌ BUG-2: AGENT/HALL_OPERATOR kan ikke administrere e-post-allowlist
- **Trigger:** AGENT navigerer til `/withdraw/list/emails` i admin-web → `GET /api/admin/security/withdraw-emails` returnerer 403.
- **Rot:** `SECURITY_READ`/`SECURITY_WRITE` har kun `["ADMIN","SUPPORT"]` (`apps/backend/src/platform/AdminAccessPolicy.ts:64-65`). Wireframe 16 og PM_HANDOFF dokumenterer at hall-operatør+agent skal kunne administrere regnskaps-e-postlisten lokalt (XML-mottakere per hall).
- **Effekt:** AGENT ser meny-itemet "Legg til e-postkonto" men flyten er blokkert. Ikke regulatorisk-blokker, men UX-paritet med wireframe brutt.
- **Fix:** opprett ny `WITHDRAW_EMAIL_READ`/`WRITE` permission med `["ADMIN","HALL_OPERATOR","AGENT","SUPPORT"]`, ELLER utvid eksisterende `SECURITY_READ/WRITE`. NB: hvis utvidet — vurder hall-scope (AGENT skal kun se egen hall sine mottakere) — krever DB-migrering hvis `app_security_withdraw_emails` ikke har `hall_id`.

## Verdict

**AGENT kan utføre kjernen av withdrawal-flyten i sin hall:** liste pending requests (steg 2), godkjenne (3), avvise (bonus), se historikk (4 modulo BUG-1), liste/eksportere XML-batches (5,6). Cross-hall-scope håndheves korrekt (8).

**Blokkerende for full pilot-paritet:** ingen — BUG-1 er en ren listing-rendering-bug, ikke regulatorisk. BUG-2 stenger e-post-CRUD som er en hall-operativ funksjon, men XML-mottakere er pre-konfigurert via env/admin-bootstrap så det blokker ikke pilot-dag-1.

**Anbefaling:** lag Linear-issue for BUG-1 (P1, frontend kan også fikses ved å alltid sende destinationType) og BUG-2 (P1-P2, RBAC-utvidelse).

## Test-data

- Spiller-token: `e1addeaea754a08bb71ab706118e72368a804fbdd2a7f6780da15be6a4e0ce5f` (utløp 2026-05-02)
- Agent-token: `3c80548a791ad552c1da358afba7d178e7fecb89e8e5e7cfa508465d88ae5f14`
- Accepted hall withdraw (null destination): `f68a3268-9ec8-48ff-bf61-8ab408f26014` (txid `c0129c30-74e9-4823-b11b-fc2f5a8913d4`)
- Accepted hall withdraw (explicit hall): `8df7498e-7724-4a32-8df3-fed274d15c47` (txid `93283c8a-f7b8-4e46-a2d7-589d46fffdf7`)
- Accepted bank withdraw: `294c157c-9c48-4fe8-9358-5e3ba7fcd85f` (txid `5983a614-e634-44a6-b6a2-26b79494da71`)
- Rejected hall withdraw: `289b9577-b5ee-4457-92e6-0d43ff85a181`
