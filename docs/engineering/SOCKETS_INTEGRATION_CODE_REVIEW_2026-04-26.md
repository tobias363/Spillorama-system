# Sockets + Integration — Pre-pilot kodegjennomgang (Bølge D)

Dato: 2026-04-26
Reviewer: code-reviewer-agent (rolle-spec: `.claude/agents/code-reviewer.md`)
Scope: `apps/backend/src/sockets/` (utenom Spill 1-spesifikk kode allerede reviewet i #499) + `apps/backend/src/integration/`
Out of scope: compliance/wallet (#513), payments/agent (#522), admin/spillevett (#525), Spill 1-spesifikke socket-events (#499)

## Sammendrag (TL;DR)

**Verdict: REQUEST_CHANGES** — pilot-blokkerende funn er moderate, men flere middelhøye sikkerhets- og compliance-konserns må ta stilling til før pilot-go.

| # | Område | Alvorlighet | Modul |
|---|--------|-------------|-------|
| 1 | Mini-game socket-events mangler rate-limiting | HØY | `sockets/miniGameSocketWire.ts` |
| 2 | Admin-namespacer mangler per-event rate-limiting | MEDIUM | `sockets/adminGame1Namespace.ts`, `adminHallEvents.ts`, `adminDisplayEvents.ts` |
| 3 | Klient-styrt hallId i `game1:join-scheduled` uten user↔hall-validering | MEDIUM | `sockets/game1ScheduledEvents.ts:297` |
| 4 | Hall-scoping i chat:send er silent-bypass-bart når `player.hallId` mangler | MEDIUM | `sockets/gameEvents/chatEvents.ts:48` |
| 5 | API-key + display-token bruker ikke `timingSafeEqual` | LAV-MEDIUM | `integration/externalGameWallet.ts:16`, `index.ts:2427` |
| 6 | EmailQueue mangler dedup på enqueue → potensiell dobbeltsending ved klikkbursting | LAV | `integration/EmailQueue.ts` |
| 7 | `console.warn`/`console.error` i hot paths bypasser pino-formatering + Sentry-context | LAV | `gameEvents/context.ts:202,259,279`, `roomEvents.ts:106,314` |
| 8 | TLS-bypass-flagg i HttpMetroniaApiClient — ingen guard mot prod-bruk | LAV | `integration/metronia/HttpMetroniaApiClient.ts:73` |
| 9 | `voucher:redeem` autentiserer kun via payload, ikke via socket-handshake | LAV (informasjons) | `gameEvents/voucherEvents.ts:57` |
| 10 | Chat-XSS — server lagrer rå melding uten sanitering | LAV (informasjons) | `gameEvents/chatEvents.ts:55` |

Generell vurdering: **kvaliteten på socket-laget er gjennomgående god**. Wire-up via `RegistryContext`/`SocketContext` gir ren auth+rate-limit-kjede; Zod-validering brukes konsekvent på de event-handlerne der wire-kontrakter er definert; per-event rate-limit-konfigurasjon i `SocketRateLimiter` har tydelig regulatorisk-orientert begrunnelse (BIN-509-kommentaren er forbilledlig); test-coverage på voucher-flyten + reservePreRoundDelta + admin-namespace handshake er solid. Funnene over er hovedsakelig "manglende i ytterkant"-typen (admin-events, mini-games), ikke fundamentale feil i kjernen.

---

## Modul-for-modul vurdering

### 1. `sockets/index.ts` (bin: registreringspunkt) — *facade-fil ikke til stede*

Det finnes ingen `sockets/index.ts`. Composition-root er `apps/backend/src/index.ts:2300+` der `socketRateLimiter`, `io.use(...)` (handshake-auth + IP-rate-limit), `createGameEventHandlers`, `createAdminGame1Namespace`, `createAdminHallHandlers`, `createAdminDisplayHandlers`, `createGame1ScheduledEventHandlers`, `createMiniGameSocketWire` alle wires inn.

Wire-flyt verifisert OK: `io.use` på linje 2309 setter handshake-token-auth + IP-rate-limit for alle namespaces på default-`/`. Admin-game1-namespacet (`/admin-game1`) registrerer egen `namespace.use(...)` for JWT-handshake (`adminGame1Namespace.ts:128-152`).

### 2. `sockets/gameEvents.ts` (fasade, R4-refactor)

Bare re-export fra cluster-filer i `gameEvents/`. Ingen logikk. **OK**.

### 3. `sockets/gameEvents/context.ts` (kjerne)

Sentral kjerne for auth, rate-limit og ack. Funn:

- Linje 202: `console.error("[socket] unhandled error in ${eventName}:", err)` — bruker `console.error` direkte i hot path. Bør være `logger.error({ err, eventName }, ...)` så Sentry-correlation og pino-formatering virker.
- Linje 259, 279: `console.warn("SECURITY: playerId mismatch — client sent ...")` — bra at det logges, men det er rå strenger med ikke-strukturert format. Audit-trailen bør være pino-strukturert så ops kan grep-e på `event=playerId_mismatch`.
- Linje 184–199: rate-limit-kjede er korrekt — sjekker først socket.id-bucket, så walletId-bucket. På success pushes timestamp i begge. Hvis socket.id passerer men walletId feiler, blir socket.id-bucketen "belastet" uten gevinst — lite reelt problem siden walletId-buckten dekker også samme spiller på tvers av reconnects (BIN-247).
- Linje 250–265: anti-spoof-sjekk for ikke-admin er solid. Klient kan ikke spoofe playerId — den utledes fra walletId i token.
- Linje 273–289: admin-self-play vs admin-on-behalf-of er korrekt skilt; admin-on-behalf-of krever `playerId` i payload + `assertUserCanActAsPlayer`.
- Linje 144: `assertUserCanAccessRoom` for ikke-admin krever at brukerens walletId finnes i room-snapshot. **OK**, men er per-rom; cross-room `room:state`-lekkasje er forhindret. **Bra**.

### 4. `sockets/gameEvents/deps.ts`

Pure type-fil. Wire-up-kontrakt er omfattende men greit kommentert. Inget å rapportere.

### 5. `sockets/gameEvents/types.ts`

Pure type-fil for socket-event-payloads. Inget å rapportere.

### 6. `sockets/gameEvents/roomEvents.ts`

`reservePreRoundDelta` er den nye fail-closed-pathen (BIN-CRITICAL fix 2026-04-25). 

- Linje 66–136: `reservePreRoundDelta` er nå korrekt fail-closed når wallet-prereqs mangler i prod (linje 82–87). Logikken for `entryFee=0`-free-play (linje 95–112) er korrekt — kaster bare hvis `deltaKr <= 0` med `entryFee !== 0` (floating-point bug).
- Linje 132: `idempotencyKey: 'arm-${roomCode}-${playerId}-${Date.now()}-${Math.random()...}'` — `Date.now()` + `Math.random()` betyr at to samtidige `bet:arm`-requests fra samme spiller får hver sin idempotency-key i stedet for å konvergere. **Spørsmål til PM**: skal denne være deterministisk på (room, player) for å være sann idempotent? — eller er race-håndtering bevisst kun via `existingResId`-sjekken på linje 125–128?
- Linje 139–157: `releasePreRoundReservation` — silent ignore på `releaseReservation`-feil er OK, men loggeline mangler — auditor som tracer "hvorfor er reservasjon hengende" får ikke en breadcrumb. Lite kritisk.
- Linje 184–252 (`room:create`): **OK**. Alle kall via `resolveIdentityFromPayload` som inkluderer `assertUserEligibleForGameplay` — fail-closed mot self-exclusion.
- Linje 314: `console.error("[room:join] FAILED:", toPublicError(error))` — samme issue som context.ts:202; bør være pino.
- Linje 381–492 (`bet:arm`): solid — Zod-validering mangler på `ticketSelections`, men manuell type-check + filter (`s.qty > 0`) på linje 395 er forsvarlig. Total 30-grensen håndheves. `existingTotal` på linje 455 er definert men **aldri brukt** — død kode (kommentar siet at det er "weighted-approx" men variabelen overskrives med `existingWeighted` på neste linje).
- Linje 499–500: `lucky:set` validerer 1..60 — OK.

### 7. `sockets/gameEvents/gameLifecycleEvents.ts`

`game:start` + `game:end`. Lite, ingen funn.

### 8. `sockets/gameEvents/drawEvents.ts`

`draw:next` + `draw:extra:purchase` (alltid REJECTED). 
- Linje 78-91: `engine instanceof Game2Engine` / `Game3Engine`-grening er greit dokumentert.
- Linje 100-117: `draw:extra:purchase` rejecter alle ekstra-trekk-forsøk — regulatorisk korrekt.

Inget å rapportere.

### 9. `sockets/gameEvents/ticketEvents.ts`

`ticket:mark`, `ticket:replace`, `ticket:swap`, `ticket:cancel`. 

- Linje 49-63 (`ticket:mark`): privat ack uten room-fanout — riktig optimaliseringsprinsipp (BIN-499).
- Linje 70-117 (`ticket:replace`): Zod-validert. Charger først (`engine.chargeTicketReplacement`), bytter cache etterpå (linje 104). Hvis `replaceDisplayTicket` returnerer null **etter** wallet-debit, kastes `TICKET_NOT_FOUND` — men da er pengene allerede tatt. Idempotency-key på (room, player, ticketId) gjør at retry vil treffe samme ledger-entry, så ikke dobbelt-debitering. **OK** men kommenter at idempotency redder oss her.
- Linje 126-155 (`ticket:swap`): gratis swap kun for `gameSlug === "spillorama"`. Gate er korrekt.
- Linje 163-248 (`ticket:cancel`): kompleks med BIN-693 reservasjons-prorata. Logikken ser korrekt ut. Linje 229–232: silent ignore på `releaseReservation`-feil — bør logge breadcrumb.

### 10. `sockets/gameEvents/claimEvents.ts`

`claim:submit`. Zod-validert. Mini-game/jackpot-aktivering basert på server-side `snapshot.gameSlug` (ikke klient-claim). **OK**.

### 11. `sockets/gameEvents/miniGameEvents.ts`

`jackpot:spin` + `minigame:play`. Solide, små handlere som delegerer til `engine.spinJackpot`/`playMiniGame`. Rate-limited via fallback (`{ windowMs: 10_000, maxEvents: 20 }`).

**Funn**: ingen eksplisitt rate-limit-config for `jackpot:spin` / `minigame:play` i `DEFAULT_RATE_LIMITS` (`socketRateLimit.ts:16-32`). Faller på fallback. For `jackpot:spin` er dette OK siden en spiller bare kan ha N spins per claim, men en strengere ramme (5 spins per 5s) vil være mer i tråd med pengespill-konteksten.

### 12. `sockets/gameEvents/chatEvents.ts`

`chat:send` + `chat:history`.

- Linje 48: `if (player?.hallId && snapshot.hallId && player.hallId !== snapshot.hallId)` — **funn 4**: hvis `player.hallId` er undefined (typen tillater `?: string`), bypasses hall-scope-sjekken silent. I praksis settes hallId alltid ved player-creation (`engine.joinRoom` → `requireActiveHallIdFromInput`), men kontrakten er ikke håndhevet. **Anbefaling**: kast hardt hvis `!player?.hallId` — det signaliserer en bug, ikke "OK å chat-e cross-hall".
- Linje 55: `message.slice(0, 500)` — trunkering, men ingen sanitering. Hvis frontend rendrer chat-melding via `dangerouslySetInnerHTML`, har vi XSS. **Funn 10**: bekreft at frontend bruker `<span>{msg.message}</span>` (auto-escape) før pilot. Backend bør ikke være avhengig av frontend-praksis — kan være verdt å DOMPurify-stripe HTML-tags på backend også, men det er stylepreferanse.

### 13. `sockets/gameEvents/voucherEvents.ts`

`voucher:redeem`.

- Linje 57: auth via `getAuthenticatedSocketUser(payload)` (payload-token, ikke handshake-token). Det betyr en klient kan sende et token i payload som er forskjellig fra handshake-token. **Funn 9**: blanding av token-kilder gjør auth-modell uoversiktlig. I praksis godkjent — alle event-payloads i kodebasen følger dette mønsteret (samme som chat/claim) og er konsistent. Worth å dokumentere som arkitekturvalg.
- Linje 60-65: PLAYER-only gate. **OK**.
- Linje 70-74: validation på `ticketPriceCents` (positiv heltall). **OK**.
- Test-coverage (voucherEvents.test.ts) er solid: happy-path, validateOnly, DomainError + voucher:rejected, ADMIN-FORBIDDEN, NOT_SUPPORTED, INVALID_INPUT.

### 14. `sockets/gameEvents/lifecycleEvents.ts`

`leaderboard:get` (read-only) + `disconnect`.

`disconnect` rydder rate-limiter cleanup og engine.detachSocket. **OK**.

### 15. `sockets/gameEvents/drawEmits.ts`

Pure helper-fil for G2/G3-emits. Inget å rapportere.

### 16. `sockets/adminGame1Namespace.ts`

`/admin-game1`-namespace. JWT-handshake-auth (`namespace.use`). Read-only fan-out til admin-konsoll.

- Linje 128-152 (handshake-auth): henter token fra `auth.token` eller `auth.accessToken`. **OK**, men ingen rate-limit på handshake. IP-rate-limit på default `/` dekker ikke namespace-spesifikke connections — admin kan flombe `/admin-game1`-tilkoblinger. **Funn 2 (delvis)**: vurder å tracke connection-rate per namespace eller globalt på io-nivå.
- Linje 158-180 (`game1:subscribe`): ingen rate-limit. En autentisert admin kan sende uendelig mange `game1:subscribe`-events for å spamme `socket.join` (room-state vokser). **Funn 2**: legg på `rateLimited("game1:subscribe", ...)`-wrapper.
- Linje 161: typing av callback (`raw: unknown`, `ack?:`-callable). Returnerer `{ ok: true }` — minimal, OK.
- Broadcaster-emits (linje 202+): try/catch rundt hver emit, log warn ved feil. Stilig isolasjon mellom broadcaster og service-laget. **OK**.

### 17. `sockets/adminHallEvents.ts`

Hall-operatør-events: `admin:login`, `admin:room-ready`, `admin:pause-game`, `admin:resume-game`, `admin:force-end`, `admin:hall-balance`.

- Linje 132: `requireAuthenticatedAdmin` sjekker `ROOM_CONTROL_WRITE`. **OK** for skadekontroll selv om socket er pålogget.
- Linje 297: `console.info("[BIN-515] Admin force-end via socket", ...)` — bra audit-trail, men igjen pino-strukturert ville vært bedre for log-search.
- Linje 326-389 (`admin:hall-balance`): leser house-account-balance per (gameType, channel). Fail-soft: ACCOUNT_NOT_FOUND → 0. **OK** kommentaren forklarer hvorfor.
- **Funn 2**: ingen rate-limit på `admin:room-ready` eller `admin:pause-game` osv. En kompromittert admin-konto kan flombe `admin:hall-event`-broadcasts. Per-event rate-limiting bør være på alle disse.

### 18. `sockets/adminDisplayEvents.ts`

`admin-display:login`, `:subscribe`, `:state`, `:screensaver`. Hall-isolerte TV-displays.

- Linje 115-129: `validateDisplayToken` kalles via dependency-injection. **OK**.
- Linje 183-204: hall-isolation-test bekrefter at sock for hall-A ikke får join hall-B's display-rom. **OK**.
- Linje 182-187 (`:screensaver`): NO auth required. Riktig dokumentert ("hall-display TV calls this before login"), men returnerer global config så ingen sensitive data.
- **Funn 2**: ingen rate-limit. En attacker som klarer å koble til kan spamme `admin-display:state`-requests.

### 19. `sockets/game1PlayerBroadcasterAdapter.ts`

Tynn adapter. Catch + log warn rundt hver emit. **OK**.

### 20. `sockets/miniGameSocketWire.ts` ⚠️

`mini_game:join`, `mini_game:choice`. Spiller-auth via accessToken i payload. Joiner user-private rom.

- Linje 173-247: **funn 1, KRITISK**: ingen rate-limiting på `mini_game:choice` eller `mini_game:join`. En autentisert spiller kan spamme `mini_game:choice`-events; orchestrator har kanskje sin egen idempotency, men det er ikke verifisert i denne reviewen. For et regulatorisk-tunge mini-game (utbetaling påvirkes), må rate-limit være eksplisitt.
- Linje 158-171 (`authAndJoin`): kalt på BÅDE `mini_game:join` og `mini_game:choice`. På `mini_game:choice` blir `socket.join(userRoomKey)` kalt hver gang — idempotent men unødvendig vellykket-logging. Lite kritisk.
- Linje 224: `orchestrator.handleChoice` har ifølge kommentaren `MINIGAME_NOT_OWNER`-sjekk. **Verifisert ikke i denne reviewen** — bør double-check at orchestrator faktisk gjør den.

### 21. `sockets/game1ScheduledEvents.ts` ⚠️

`game1:join-scheduled`. Eneste registrerte event her.

- Linje 264-274: rate-limit via `socketRateLimiter.check`. **OK**, men bruker socket.id-bucket — ikke walletId. Reconnects unngår å resette grensen kun når man kommer over `DEFAULT_FALLBACK` (10s/20). For join-events er dette OK.
- Linje 287-288: `assertUserEligibleForGameplay` + `assertWalletAllowedForGameplay` — fail-closed. **OK**.
- Linje 292: `assertHallAllowedForGame(payload.hallId, row)` — sjekker at hallen er i schedulens deltakerliste, men **funn 3**: brukerens egen `user.hallId` (eller annen user↔hall-binding) sjekkes IKKE. En spiller kan i prinsippet sende et vilkårlig hallId-fra deltakerlisten og bli registrert som "spiller i den hallen". Dette gir feil hall-attribution i ledger og audit-spor. PM-vurdering: er dette internett-bingo-modellen (fritt hallvalg) eller skal hallId valideres mot user.hallId?

### 22. `middleware/socketRateLimit.ts`

Per-event sliding-window rate limiter. Solid implementasjon:

- BIN-247: walletId-basert sjekk (linje 118-140). Reconnects bypasser ikke.
- HOEY-9: per-player-buckets (linje 84-87, 102-110). Survives reconnect.
- BIN-303: per-IP connection-rate (linje 148-167). Separat bucket-map så GC ikke sletter aktive vinduer.
- GC: linje 204-237. Bra pruning av stale player-buckets.
- Linje 134, 181: `if (timestamps.length >= config.maxEvents) return false;` — push (line 138, 185) først *etter* OK-sjekk. Korrekt: feilende sjekk lekker ikke timestamps.

Funn: `DEFAULT_RATE_LIMITS` (linje 16-32) mangler entries for:
- `jackpot:spin`, `minigame:play`
- `voucher:redeem`
- `chat:send`, `chat:history`, `leaderboard:get`
- `mini_game:join`, `mini_game:choice` (orchestrator-nivå)
- `game1:join-scheduled`
- Admin-events (hele admin-namespace + adminHallEvents + adminDisplayEvents)

Alle disse faller på `DEFAULT_FALLBACK` (10s/20). Adekvat for de fleste, men flere fortjener tightere grenser (særlig `voucher:redeem` som har wallet-impact).

---

## Integration

### 23. `integration/EmailService.ts`

Wraps nodemailer. Stub-mode når SMTP_HOST mangler. Template-rendering via `renderEmailTemplate`.

- Linje 162-165: `parseConfigFromEnv` returnerer null hvis SMTP_HOST/URL mangler. **OK**.
- Ingen secret-leak: `from`, `to`, `subject` logges; ikke body. **OK**.
- Linje 218: `previewTemplate` — eksponert for tester/dashboards. **OK**.

Test-coverage: 9 tester dekker no-op-mode, transport-forwarding, from-override, template-rendering for reset-password/verify-email/bankid-expiry, attachment-passthrough.

**Inget å rapportere**.

### 24. `integration/EmailQueue.ts`

In-memory fire-and-forget kø med exponential backoff og retry.

- Linje 129-154 (`enqueue`): **funn 6** — ingen dedupe-sjekk. Hvis admin trykker "Send KYC-mail" 3 ganger raskt, blir 3 entries lagt til og alle 3 sendes. Akseptabelt per BIN-704-design ("admin kan re-trigge"), men send-window-dedup (samme to+template+context innenfor 60s) ville være lavt-hengende frukt.
- Linje 187-198 (dead-handling): logger correctly med `pino`. **OK**.
- Linje 199: backoff-formel `backoffBaseMs * Math.pow(2, attempt - 1)` — første retry er 1s, andre 2s, tredje 4s. Maks-attempts default 5 → 1+2+4+8+16 = 31s før dead. Akseptabelt.
- Linje 240: `runLoop`-handler bruker `this.loopHandle.unref()` — Node-prosess kan exit før queue er tom. **OK** for dev/test, men i produksjon må `stop()` kalles på SIGTERM. Verifisert: index.ts skal håndtere shutdown — utenfor scope.
- Linje 169-216: `processNext` retry/dead/sent-flyt er solid testet (8 tester).

**Inget pilot-blokkerende**.

### 25. `integration/SveveSmsService.ts`

Sveve SMS-integrasjon med PII-masking + retry.

- Linje 140-150 (`maskPhone`): bevarer landskode + siste 4 sifre. **OK** for log-trail uten å lekke fullt nummer.
- Linje 230-244: stub-mode logger ikke selve meldingen (kan inneholde OTP). **Stilig**.
- Linje 343-420 (`callSveve`): bruker `URLSearchParams` for body. **OK** mht injection — `body.set(...)` URL-encoder verdier. Selv om en attacker forsøker å injisere `&from=evil` i `message`-feltet, vil `URLSearchParams` encode `&` til `%26`. Bra.
- Linje 400-403: 200-response med errors[] er korrekt klassifisert som permanent (ikke retry).
- Linje 156-163 (`assertSenderFormat`): 3-11 tegn alfanumerisk. **OK** mot Sveve-krav.
- Linje 358-363: `body.set("passwd", this.config.password)` — passwd sendes plaintext over HTTPS til Sveve. Akseptert (Sveve-API krever det), men blir aldri logget.

Test-coverage er fremragende: 17 tester dekker maskPhone-edge cases, stub-mode, live-mode, retry, permanent vs transient feil, lange meldinger, bulk.

**Inget å rapportere**.

### 26. `integration/externalGameWallet.ts` ⚠️

Express-router for ekstern spill-wallet (Candy/Metronia-bridge). Ikke-socket — ren HTTP-API.

- Linje 16: `if (!header || header !== \`Bearer ${apiKey}\`)` — **funn 5**: streng-equality på shared-secret-token er sårbart for timing-attack. Kodebasen bruker `timingSafeEqual` allerede i `swedbankSignature.ts` og `PlatformService.ts`. Bør harmoniseres.
- Linje 49-58 (`/debit`): `validateWalletRequest` sjekker playerId/transactionId/amount. Bruk via `walletAdapter.debit(... { idempotencyKey: transactionId })` — dedup på idempotencyKey. **OK**.
- Linje 96-112: validation av amount + transactionId. **OK**.

**Anbefaling**: bruk `timingSafeEqual` for API-key-sjekken.

### 27. `integration/templates/template.ts`

Mini-Handlebars-subset: `{{var}}`, `{{a.b}}`, `{{#if var}}…{{/if}}`. HTML-escape default; `{{&raw}}` for unescape.

- Linje 18-28: `ESCAPE_MAP` mapper de 5 kritiske tegnene (`&<>"'`). **OK** for HTML-context.
- Linje 65-111 (`renderTemplate`): rekursiv på `{{#if}}`-block. Trenger ikke escape `{{&}}` siden ingen prod-template bruker det (verifisert med grep).

**Inget å rapportere**. Fin liten engine. Test-coverage på engine er solid (12 tester).

### 28. `integration/templates/*.ts` (kyc-approved, kyc-rejected, kyc-imported-welcome, reset-password, role-changed, verify-email, bankid-expiry-reminder, index)

- Alle bruker `href="{{link}}"` — værdiet escapes default, så `"`-injection blokkeres.
- `{{reason}}` i kyc-rejected er admin-skrevet rejection-reason. Plaintext, escapes default. **OK**.
- Ingen `{{&...}}` raw-rendering. **OK**.
- `bankid-expiry-reminder` bruker `<time datetime="{{expiryDateISO}}">` — `expiryDateISO` får escapes; ikke noe attribute-injection mulighet.

**Inget å rapportere**.

### 29. `integration/metronia/HttpMetroniaApiClient.ts`

HTTP-klient mot Metronia.

- Linje 73-80: `tlsRejectUnauthorized=false`-bypass via undici-Agent. Logger warn. **Funn 8**: ingen guard mot prod-NODE_ENV. En feilkonfigurasjon (env-var satt i prod) gir silent TLS-bypass. Anbefaling: kast hvis `process.env.NODE_ENV === "production"` og `tlsRejectUnauthorized === false`.
- Linje 137-181 (`post`): AbortController + timeout, JSON-parse safe (returnerer null ved feil). DomainError-mapping på error-fields. **OK**.
- Linje 144-145: `Authorization: Bearer ${this.apiToken}` — token kommer fra config. Aldri logget.

### 30. `integration/metronia/StubMetroniaApiClient.ts`

In-memory stub for tester.

- Linje 50: `txSeen.has(input.uniqueTransaction)` — replicates idempotency-check. **OK**.

**Inget å rapportere**.

### 31. `integration/okbingo/OkBingoApiClient.ts` (interface) + `SqlServerOkBingoApiClient.ts` (impl) + `StubOkBingoApiClient.ts`

OK Bingo SQL Server-polling-RPC.

- `SqlServerOkBingoApiClient.ts` linje 184-191: parameterized query via `pool.request().input(...)` — alle 5 verdier (`BingoID`, `FromSystemID`, `ToSystemID`, `ComandID`, `Parameter`) parameterized. **OK** mot SQL-injection.
- Linje 234-249: poll-query også parameterized. **OK**.
- Linje 240: `Parameter LIKE @Parameter` med `%${requestComId}%` — `requestComId` kommer fra `OUTPUT INSERTED.*`-resultat (server-generert), ikke klient. **OK**.
- Linje 106: `({ connectionString: this.connectionString } as any)` — TypeScript-hack rundt mssql-typing. Akseptert.
- Linje 213-222: `parseParameter` parser respons-strenger fra Parameter-feltet. Ingen escape-issues siden vi bare leser tall + string-feltet, ikke renderer noe.
- Linje 119: `parameter = \`${input.uniqueTransaction};;${input.amountCents};${print}\`` — semi-colon-separator i Parameter-felt. Hvis `uniqueTransaction` inneholder `;`, kunne det forvride parsing. Men `uniqueTransaction` genereres server-side med UUID, så ingen reell risiko. **Lite kritisk** — kunne være verdt å assert at uniqueTransaction ikke inneholder `;`.

**Inget å rapportere**.

---

## Spesielt fokus (som spurt etter)

### Socket-event-rate-limiting + auth-validering på alle events

**Status: HALVT-DEKKET**.

| Event-namespace | Rate-limit | Auth-validering | Kommentar |
|---|---|---|---|
| `gameEvents` (default `/`) | ✅ Solid via `rateLimited` wrapper + `requireAuthenticatedPlayerAction` | ✅ Token + walletId-spoof-protection | Mønster-eksempel |
| `voucher:redeem` | ✅ rateLimited | ✅ Player-only, payload-token | OK |
| `mini_game:choice/join` | ❌ INGEN | ✅ Token i payload | **Funn 1** |
| `game1:join-scheduled` | ✅ via socketRateLimiter.check direkte | ✅ Token + eligibility | hallId-validering uklar (funn 3) |
| `/admin-game1` namespace | ❌ INGEN per-event | ✅ JWT-handshake (`namespace.use`) | **Funn 2** |
| `admin:login`/`admin:room-ready`/etc | ❌ INGEN | ✅ Token + ROOM_CONTROL_WRITE | **Funn 2** |
| `admin-display:login`/etc | ❌ INGEN | ✅ Display-token validation | **Funn 2** |

IP-basert connection-rate (BIN-303) gjelder alle namespacer, men er per-IP — admin med fast IP kan likevel flombe events innenfor en aktiv socket.

### Email/SMS-template-injeksjon-risiko (særlig hvis user-content rendrer)

**Status: GREEN**. Ingen prod-template bruker `{{&raw}}`-syntaks. Standard `{{var}}` HTML-escapes 5 kritiske tegn. Brukerinput (`reason` i kyc-rejected, `username`, etc.) går gjennom escape. Sveve SMS bruker `URLSearchParams` så `&`/`=`-injection blokkeres.

### Candy iframe-bridge (auth + post-message-origin-validation)

**Status: IKKE TIL STEDE**. Det finnes ingen `CandyAdapter.ts` i `integration/`. `externalGameWallet.ts` er en HTTP-router (Bearer-token) som kan være Candy-bridge-equivalenten. Selve iframe-postMessage-flyten lever på frontend-siden (utenfor backend-scope). **Avkrysset for kjent gap** per [System architecture](project_architecture.md).

### HMAC-signature-validering på Swedbank-callback

**Status: UTENFOR SCOPE** — `payments/SwedbankPayService.ts` + `swedbankSignature.ts` er #522. Verifisert at filene bruker `timingSafeEqual` (`swedbankSignature.ts:1,76`).

### Idempotency på email-sending

**Status: AMBER**. EmailQueue mangler dedupe på enqueue-side (funn 6). Backend-idempotency på SMTP-leveranse er ansvar for SMTP-leverandør (typisk via Message-ID). For pilot-go er dette OK, men admin må forstå at "Resend KYC"-knapp kan trigge dobbel mail.

---

## Spesifikke endringsforespørsler (file:line)

### Pilot-blokkerende

1. **`apps/backend/src/sockets/miniGameSocketWire.ts`** (lines 173-247) — wrap `mini_game:choice` og `mini_game:join` i `socketRateLimiter.check(socket.id, eventName)`-gate på linje med `game1ScheduledEvents.ts:264`. Forbered legge til entries i `DEFAULT_RATE_LIMITS`.
2. **`apps/backend/src/sockets/adminGame1Namespace.ts`** (lines 158-200), **`adminHallEvents.ts`** (alle handlere), **`adminDisplayEvents.ts`** (alle handlere) — innfør per-event rate-limiting via samme mønster som `gameEvents`-cluster.
3. **`apps/backend/src/sockets/game1ScheduledEvents.ts:297`** — avklar med PM om `payload.hallId` skal valideres mot user-binding eller om internett-bingo-modellen tillater fritt hallvalg fra deltakerliste. Hvis sistnevnte: legg til kommentar som dokumenterer arkitekturvalget.
4. **`apps/backend/src/sockets/gameEvents/chatEvents.ts:48`** — gjør hall-scope-sjekken hard-fail når `player.hallId` mangler i stedet for silent-bypass: `if (!player?.hallId || !snapshot.hallId) throw new DomainError("FORBIDDEN", "Hall-binding mangler.");` deretter mismatch-check.

### Bør fikses før pilot, kan COMMENT_ONLY

5. **`apps/backend/src/integration/externalGameWallet.ts:16`** — bytt til `timingSafeEqual` for API-key-sammenligning. Følg mønster fra `swedbankSignature.ts:76`.
6. **`apps/backend/src/index.ts:2427`** — `validateDisplayToken` env-var-fallback: bytt `expected !== secret` til `timingSafeEqual(Buffer.from(expected), Buffer.from(secret))` (etter length-check).
7. **`apps/backend/src/sockets/gameEvents/context.ts:202,259,279`** + **`roomEvents.ts:106,314`** — bytt `console.error/warn` til `logger.error/warn(structured)` for konsistent observability.
8. **`apps/backend/src/integration/metronia/HttpMetroniaApiClient.ts:73`** — guard `tlsRejectUnauthorized: false` mot `NODE_ENV === "production"`: kast hardt, ikke bare warn.
9. **`apps/backend/src/middleware/socketRateLimit.ts:16-32`** — legg til entries for `voucher:redeem`, `jackpot:spin`, `minigame:play`, `mini_game:choice`, `mini_game:join`, `game1:join-scheduled`, alle admin-events (eksplisitt fremfor fallback).
10. **`apps/backend/src/integration/EmailQueue.ts:129`** — vurder enqueue-time dedup-vindu (samme to+template+context innenfor 60s svarer "duplicate, ignored"). Ikke pilot-blokkerende.

### Kosmetiske / informasjons

11. **`apps/backend/src/sockets/gameEvents/roomEvents.ts:455`** — død variabel `existingTotal`. Slett.
12. **`apps/backend/src/sockets/gameEvents/roomEvents.ts:152,229`** — silent ignore på releaseReservation-feil bør logge breadcrumb.
13. **`apps/backend/src/sockets/miniGameSocketWire.ts:158-171`** — `authAndJoin` kalles to ganger per `mini_game:choice` (en for join, en for choice handler). Gjør det idempotent på user.id-cache.
14. **`apps/backend/src/integration/okbingo/SqlServerOkBingoApiClient.ts:119`** — assert `uniqueTransaction` ikke inneholder `;` for å være sikker mot Parameter-string-injection.

---

## Spørsmål for PM

1. **`game1:join-scheduled` hallId-binding (funn 3)**: skal en spiller kunne velge en hvilken som helst hall fra schedulens `participating_halls_json`, eller må hallId-en matche brukerens egen hall (hvis vi har det konseptet)?
2. **`reservePreRoundDelta` idempotency-key (roomEvents.ts:132)**: er `Date.now() + Math.random()` bevisst ikke-deterministisk? For sann idempotency på (room, player, deltaWeighted) ville en deterministisk key gjort retry-ene konvergerende.
3. **Mini-game rate-limits**: hva er forventet maks-rate for `mini_game:choice` per spiller? Skal vi koble en BIN-issue for å definere disse?
4. **EmailQueue-dedupe**: skal "Resend KYC"-knappen gjøre dedupe på backend-side eller la dobbel-mail passere?
5. **Chat-XSS-håndtering**: skal backend sanitize chat-meldinger (DOMPurify) eller stole på frontend-escape?

---

## Out of scope (eget følge-issue)

- **Spill 1-spesifikk socket-kode** — allerede #499.
- **Wallet/compliance** — #513.
- **Payments/agent (Swedbank-callback)** — #522.
- **Admin/spillevett** — #525.
- **Frontend-side iframe-postMessage-validering for Candy** — kjent gap i [arkitektur-memoir](project_architecture.md).
- **EmailQueue → PostgresEmailQueueStore** (BIN-703) — planlagt, ikke nødvendig for pilot.
