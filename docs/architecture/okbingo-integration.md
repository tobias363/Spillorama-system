# OK Bingo Integration — Architecture

**BIN-583 B3.5** — Port av legacy `machineApiController.createOkBingoAPI` til ny TypeScript-backend.

---

## 1. Overordnet flyt

```
┌──────────────┐     1. POST /api/agent/okbingo/...     ┌─────────────────────┐
│ Agent (POS)  │ ──────────────────────────────────────▶│  Bingo Backend      │
└──────────────┘                                        │  (Render)           │
                                                        └────────┬────────────┘
                                                                 │
                                              2. INSERT request   │
                                                 row i COM3       │
                                                                 ▼
                                                        ┌─────────────────────┐
                                                        │  SQL Server         │
                                                        │  (hall-lokal eller  │
                                                        │   sentralisert)     │
                                                        │                     │
                                                        │  COM3-tabell:       │
                                                        │   ComID  PK         │
                                                        │   BingoID           │
                                                        │   ComandID          │
                                                        │   Parameter         │
                                                        └────────┬────────────┘
                                                                 │
                                              3. OK Bingo-     │
                                                 maskinen poller │
                                                                 ▼
                                                        ┌─────────────────────┐
                                                        │  OK Bingo-maskin    │
                                                        │  (hall-lokal HW)    │
                                                        │                     │
                                                        │  Leser request,     │
                                                        │  utfører,           │
                                                        │  INSERT response    │
                                                        │  i COM3             │
                                                        └────────┬────────────┘
                                                                 │
                                              4. Backend poller │
                                                 (1s × 10) for  │
                                                 response       │
                                                                 ▼
                                                        ┌─────────────────────┐
                                                        │  Backend mottar     │
                                                        │  response, parser   │
                                                        │  semicolon-felt,    │
                                                        │  oppdaterer DB +    │
                                                        │  player wallet      │
                                                        └─────────────────────┘
```

---

## 2. Kommando-ID-mapping

OK Bingo identifiserer operasjoner via heltall `ComandID`. Response-meldinger
har `ComandID = request + 100` (deterministic offset).

| ComandID | Operasjon | Parameter-format (semicolon-separert) |
|---|---|---|
| 1 | `create-ticket` | `transaction;;amount;print` |
| 2 | `topup` (upgrade) | `transaction;ticket;amount;print` |
| 3 | `close-ticket` | `transaction;ticket` |
| 5 | `status-ticket` | `transaction;ticket` |
| 11 | `open-day` | `NULL` (ingen parametre) |

`print = 0` betyr at maskinen ikke skal printe fysisk kvittering (vi
genererer evt. kvittering i web-shellet).

---

## 3. Response-format

OK Bingo svarer ved å INSERT-e en ny COM3-rad med `ComandID + 100`.
`Parameter`-feltet er semicolon-separert:

```
comId;ticketNumber;balance;newBalance;expiryDate;errorNumber;errorDescription
```

| Felt | Type | Beskrivelse |
|---|---|---|
| `comId` | int | Tilbakereferanse til request-ComID — brukes for correlation |
| `ticketNumber` | string | Tildelt ticket-nummer (ved create) |
| `balance` | numeric (NOK) | Final balance ved close (multipliseres med 100 for cents) |
| `newBalance` | numeric (NOK) | Ny balance etter topup (multipliseres med 100) |
| `expiryDate` | string | Utløps-timestamp (ikke brukt av oss per nå) |
| `errorNumber` | int | 0 = OK, > 0 = feil |
| `errorDescription` | string | Tekstforklaring ved feil |

`SqlServerOkBingoApiClient.parseParameter()` håndterer parsing.
`parseBalance()` konverterer NOK → cents (× 100).

---

## 4. Polling

`pollForResponse()`:

- Interval: `OKBINGO_POLL_INTERVAL_MS` (default 1000 ms)
- Max attempts: `OKBINGO_POLL_MAX_ATTEMPTS` (default 10)
- Total max wait: ~10 s før timeout-feil

Query brukt:

```sql
SELECT TOP 1 Parameter FROM COM3
WHERE ComID > @ComID
  AND BingoID = @BingoID
  AND FromSystemID = 1   -- response (1 = maskin → backend)
  AND ToSystemID = 0
  AND ComandID = @ComandID    -- request-ComandID + 100
  AND Parameter LIKE '%@ComID%'
```

`Parameter LIKE '%@ComID%'` sikrer at vi får response som korrelerer med
*denne* request-en (ikke en eldre ubehandlet rad).

---

## 5. Domene-flyt: createTicket

```
1. Validate amount (1-1000 NOK, heltall)
2. requireActiveShift + requirePlayerInHall
3. Wallet.debit(player, amount, idempotencyKey=okbingo:create:{ticketId}:{clientReq})
4. Try:
     SqlServerOkBingoApiClient.createTicket({amountCents, roomId, uniqueTransaction})
       → INSERT COM3 + poll for response
       → returns {ticketNumber, ticketId, roomId}
   Catch:
     Wallet.credit(player, amount, idempotencyKey=...:refund)
     throw
5. MachineTicketStore.insert(machine_name='OK_BINGO', ...)
6. AgentTransactionStore.insert(action_type='MACHINE_CREATE', ...)
```

Tilsvarende for topup, close, void.

---

## 6. Env-vars (production deploy)

```
OKBINGO_SQL_CONNECTION=Server=tcp:hall-sql.example.com,1433;Database=BingoCom;User Id=svc;Password=...
OKBINGO_BINGO_ID=247                  # default room ID
OKBINGO_POLL_INTERVAL_MS=1000
OKBINGO_POLL_MAX_ATTEMPTS=10
OKBINGO_TIMEOUT_MS=30000              # ikke aktivt brukt — pollMaxAttempts × interval styrer
```

Hvis `OKBINGO_SQL_CONNECTION` mangler → `StubOkBingoApiClient` brukes.
Dette er default i CI og lokal-dev.

---

## 7. Deployment-avhengigheter

**KRITISK for prod-deploy:**

1. **SQL Server-tilgang fra Render:** Backend (Render-host) må ha
   nettverkstilgang til SQL Server-instansen. Hvis SQL Server er hall-
   lokal, må VPN/IP-allowlist være konfigurert.

2. **OK Bingo-maskin ↔ SQL Server:** Hardware-maskinen må ha
   nettverkstilgang til SAMME SQL Server-instans (skriver/leser COM3-rader
   uavhengig av oss).

3. **COM3-tabell-eierskap:** OK Bingo-leverandøren eier tabell-skjemaet.
   Vi forutsetter eksisterende `COM3`-tabell med kolonnene `ComID` (PK),
   `BingoID` (int), `FromSystemID` (int), `ToSystemID` (int), `ComandID`
   (int), `Parameter` (varchar). Endringer i deres skjema krever migrasjon.

4. **Tilkoblings-pool:** `mssql`-default pool-size er 10. For multi-hall
   prod-deploy med høy POS-traffikk: vurder økning via `poolMax`-option
   (krever mindre kode-endring).

5. **Self-signed cert:** Hvis SQL Server bruker self-signed TLS, må
   connection-string inkludere `TrustServerCertificate=true` ELLER
   sertifikat distribueres til Render.

**Out-of-scope for dette PR-et — krever separat ops-arbeid.**

---

## 8. Test-strategi

| Test-nivå | Hva dekkes | Bruker |
|---|---|---|
| `StubOkBingoApiClient.test.ts` | State-machine på stub | InMemory |
| `OkBingoTicketService.test.ts` | Service-logikk (wallet+DB+tx) | StubClient |
| `agentOkBingo.test.ts` | HTTP-router + RBAC + audit | StubClient |
| `SqlServerOkBingoApiClient.test.ts` | (Ingen — krever real SQL Server) | — |

`SqlServerOkBingoApiClient` testes manuelt mot test-instans før prod-cutover. CI har ingen tilgang til SQL Server, så all CI-testing går via `StubClient`. Wirefil i `index.ts` faller tilbake til Stub når env mangler.

---

## 9. Feilhåndtering

| Domain-error-kode | Når kastes | Behandling |
|---|---|---|
| `OKBINGO_DB_DOWN` | mssql pool ikke tilkoblet | 400 til klient — agent prøver igjen om litt |
| `OKBINGO_INSERT_FAILED` | INSERT i COM3 returnerte tomt | 400 — undersøk SQL-server-status |
| `OKBINGO_TIMEOUT` | Polling > 10 forsøk uten response | 400 — sjekk maskinens status |
| `OKBINGO_BAD_RESPONSE` | comId i response matcher ikke request | 400 — protocol-bug, log + alert |
| `OKBINGO_API_ERROR` | OK Bingo returnerte errorNumber > 0 | 400 med error_str-melding |
| `OKBINGO_TICKET_NOT_FOUND` | Stub: ukjent ticket | 400 (kun via Stub) |
| `OKBINGO_TICKET_CLOSED` | Stub: ticket allerede lukket | 400 (kun via Stub) |
| `OKBINGO_DUPLICATE_TX` | Stub: idempotency-violation | 400 (kun via Stub) |

`SqlServerOkBingoApiClient` mapper rå mssql-feil til `OKBINGO_DB_DOWN`
eller `OKBINGO_INSERT_FAILED` for å unngå at intern DB-detalj lekker
ut til API-respons.

---

## 10. Follow-ups

- **BIN-XXX:** Migrer mot real HTTP-API hvis OK Bingo-leverandøren
  eksponerer dette i fremtid. Da kan vi droppe `mssql`-dep + SQL Server-
  tilgang fra Render.
- **BIN-XXX:** Cron-job `autoCloseTicket` for tickets > 24t (port av
  legacy `machineApiController.autoCloseTicket`).
- **BIN-XXX:** Per-hall override av `defaultBingoId` via
  `app_halls.other_data.okbingoRoomId`.
