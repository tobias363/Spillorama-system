# HTTP Rate-Limiting — industry research og anbefalinger for Spillorama

**Status:** Research-rapport (READ-ONLY, ingen kode-endringer)
**Dato:** 2026-05-11
**Forfatter:** Research-agent (Claude Opus 4.7)
**Bestiller:** Tobias — etter at PR #1220 (økte limits) + PR #1226 (localhost-bypass) ikke fjernet 429-problemet
**Kontekst:** Pilot Q3 2026 — 4 haller × ~250 spillere. Mål: casino-grade-kvalitet (Evolution-nivå).

---

## 1. Sammendrag (TL;DR)

**Vårt fundamentale problem er ikke "limits er for lave" — det er at vi rate-limiter på feil dimensjon (per-IP) for autenticerte endpoints, og at klienten poller endpoints som industry-best-practice ville pushet over Socket.IO.** Stripe, GitHub og Cloudflare bruker alle **per-user (eller per-API-key) limits for autenticerte routes**, og **per-IP kun for anonymous/auth-WRITE-routes**. Anbefaling: P0 — bytt til per-user-keying for alle `/api/`-routes under auth-guard og legg server-side cache (Redis, 30s TTL) på "stille" endpoints; P1 — push wallet/compliance/lobby-state via Socket.IO istedenfor polling; P2 — token-bucket med burst-capacity istedenfor sliding-window.

---

## 2. Industry-praksis — hva de store gjør

### 2.1 Stripe (autoritativ kilde for "millioner av API-kall mot regulert system")

Stripe kjører **4 separate rate-limit-mekanismer** i prod, ikke én:

| # | Mekanisme | Hva | Numerisk |
|---|---|---|---|
| 1 | **Request Rate Limiter** | Per-user N req/sek (token-bucket) | ~25 req/sek per API-key, burst-tolerant |
| 2 | **Concurrent Requests Limiter** | Per-user max samtidige in-flight | ~20 in-flight per API-key |
| 3 | **Fleet Usage Load Shedder** | Globalt — reserver 20% kapasitet for kritisk traffikk | Avviser non-kritisk når > 80% av flåten brukes |
| 4 | **Worker Utilization Load Shedder** | Per-worker prioritering | Kritisk > POST > GET > test-mode |

**Kjernen:** rate-limit nøkles på **API-key (autenticert bruker), ikke IP**. Token-bucket gir burst-tolerance (en flash-sale eller page-refresh fyrer ikke 429). Concurrency-limit og rate-limit er **separate dimensjoner** — du kan ha lav rps men høy concurrency og fortsatt bli avvist.

### 2.2 GitHub API (5 000 req/time autenticert)

| Klient-type | Limit | Nøkkel |
|---|---|---|
| Unauthenticated | **60 req/time** | per-IP |
| Authenticated (PAT) | **5 000 req/time** | per-user-token |
| GitHub Enterprise org | **15 000 req/time** | per-installation |
| Git LFS authenticated | **3 000 req/min** | per-user-token |

Sekundære limits:
- **Concurrent requests:** max 100 samtidig per token
- **Per-minute throttle:** 900 "points"/min (REST)
- **CPU time:** 90 sek CPU per 60 sek wall-clock
- **Content-creation:** 80 req/min, 500/time

**Headers** (industri-standarden — vi mangler disse i dag):
```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4982
X-RateLimit-Reset: 1717182000
X-RateLimit-Resource: core
Retry-After: 47
```

### 2.3 Cloudflare API

- Global: **1 200 req per 5-min-vindu per user** (kumulativt på tvers av dashboard + API key + API token)
- Edge-enforcement: limits sjekkes FØR de når app-server
- Algoritme: leaky-bucket / sliding-window kombinasjon

### 2.4 Discord (1500 samtidige connections per shard, høy real-time read)

- **Per-route limits**, ikke globalt — `/channels/:id/messages` har eget limit, separat fra `/users/@me`
- **Per-user + per-route nøkkel** for autenticerte endpoints
- Bruker WebSocket-gateway for live-state — REST-polling frarådes aktivt

### 2.5 Evolution Gaming / iGaming-mønster

Evolution publiserer ikke API-tall offentlig, men 2026-rapporter om iGaming-arkitektur peker på samme mønster: **WebSocket for live-state (live blackjack/bingo-trekk), REST kun for transaksjons-init og historikk**. Skalering-prinsipp: "observability over throughput" — backend-team detekterer saturation via queue-depth, ikke via 429-statistikk.

---

## 3. Diagnose av Spillorama-problemet

**Vår nåværende state** (`apps/backend/src/middleware/httpRateLimit.ts`):
- Sliding-window per-IP
- Catch-all `/api/` på 1000 req/min per IP
- Auth-guarded `/api/admin` og `/api/agent` på 600/min per IP
- `/api/auth/me`, `/api/auth/sessions`, `/api/auth/pin/status`, `/api/auth/2fa/status` på 200/min per IP

**Hvorfor patches ikke biter:**

1. **Multi-tab/multi-window straffes urettferdig.** En spiller med to tabs deler IP → fyller bucket dobbelt. NAT-haller (alle 250 spillere bak én IP i et bingolokale) deler bucket × 250. Når vi går prod med 4 haller × 250 spillere = mange spillere bak samme hall-IP, kollapser per-IP-modellen.

2. **Polling-mønsteret er for aggressivt.** 11 endpoints polles på page-load × 4 refreshes innen 1 min = 44+ hits. `wallet/me/compliance`, `halls`, `games`, `games/status`, `spillevett/report`, `payments/pending-deposit` er alle data som **endrer seg på server-event, ikke på klokke-tick**. Polling er feil verktøy.

3. **Sliding-window har ingen burst-kapasitet.** Token-bucket ville tillatt en page-refresh-burst (10-15 raske kall) og deretter throttle. Vår sliding-window straffer burst som en DoS-attack.

4. **Vi har ingen fail-soft mode.** Når bucket er full → 429. Industry-mønster: serve cached/stale data (Stripe gjør dette på read-endpoints under load).

5. **Vi mangler observability.** Ingen `X-RateLimit-*`-headers → klient kan ikke backoff intelligent.

---

## 4. Anbefalinger for Spillorama (prioritert P0-P2)

### P0 — Akutt (gjør FØR pilot, denne uka)

#### P0.1 — Bytt fra per-IP til per-user-keying for auth-guarded routes
**Hva:** For alle routes under `requireAuth` middleware, nøkkel rate-limit på `userId` istedenfor IP. Behold per-IP KUN for `/api/auth/login`, `/api/auth/register`, `/api/auth/forgot-password` og andre anonymous-paths.

**Hvorfor:** Spillere i samme hall deler IP. NAT-CGNAT i mobilnett deler IP på tvers av tusenvis av brukere. Per-IP er regelrett feil for autenticert traffikk.

**Filer:** `apps/backend/src/middleware/httpRateLimit.ts` — utvid `middleware()` til å lese `req.userId` (satt av auth-guard) og bruke `user:${userId}` som key for auth-paths, `ip:${ip}` for resten.

**Arbeid:** ~4 timer (inkl. tester). En del av eksisterende kommentar i §3 nederst i fila peker allerede på dette som design-intent.

#### P0.2 — Server-side Redis-cache på "stille" read-endpoints
**Hva:** Cache responsene for `/api/halls`, `/api/games`, `/api/games/status`, `/api/wallet/me/compliance`, `/api/spillevett/report` i Redis med 15-30s TTL, keyed på `(userId, path, query)`. Cache-invalidator triggers på server-event (eks. compliance-mutering → invalider `compliance:${userId}`).

**Hvorfor:** Disse endpoints serveres til hundrevis av polling-klienter. Hvis 250 spillere refresher `/api/halls` samtidig på pilot-start, treffer alle DB. Med cache: 1 DB-hit, 250 Redis-hits.

**Filer:** Ny `apps/backend/src/middleware/responseCache.ts` (eller utvid eksisterende Redis-modul). Wire opp på spesifikke routes via opt-in middleware.

**Arbeid:** ~1-2 dager. Mest engineering på cache-invalidator-events (compliance-mutering må fan-out invalidate).

#### P0.3 — Standardiserte rate-limit-headers
**Hva:** Returnerer `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` på alle responser (ikke bare 429).

**Hvorfor:** Klient kan da pre-emptive throttle seg selv ("80% av bucket brukt → backoff polling-interval"). Industry-standard fra GitHub.

**Filer:** `httpRateLimit.ts` middleware — sett headers via `res.set()` før `next()`.

**Arbeid:** ~2 timer.

#### P0.4 — Klient-side cache med 30s TTL på poll-endpoints
**Hva:** I `packages/game-client` og `apps/admin-web` — wrap fetch i en thin cache-lag som cacher GET-responses 30s med ETag-validation. Refresh KUN ved 304-respons eller eksplisitt invalidate.

**Hvorfor:** Reduserer klient-traffikk 80%+ uten arkitektur-endring.

**Arbeid:** ~1 dag.

---

### P1 — Mellomsiktig (Q3 etter pilot-start, før utvidelse til flere haller)

#### P1.1 — Bytt sliding-window til token-bucket med burst-kapasitet
**Hva:** Vår sliding-window har capacity=N over windowMs. Token-bucket har capacity=N + refill-rate. Den tillater en burst (refresh, navigate) og throttler deretter.

**Hvorfor:** Casino-grade clients (Stripe, Evolution) bruker token-bucket eksplisitt fordi den matcher menneskelig burst-mønster.

**Filer:** `httpRateLimit.ts` — rewrite `check()` til token-bucket. ~1 dag inkl. tester.

#### P1.2 — Push wallet/compliance/lobby-state via Socket.IO istedenfor polling
**Hva:** Endpoints som i dag polles (`/api/wallet/me/compliance`, `/api/wallet/me`, `/api/games/status`, `/api/halls`, `/api/payments/pending-deposit`) konverteres til Socket.IO push-events:
- `wallet:balance:updated` på balance-endring
- `compliance:state:updated` på compliance-mutering
- `lobby:status:updated` per-hall ved game-state-endring
- `payment:status:updated` på payment-request-state-overgang

Klient subscriber på connect, mottar push, slipper å polle. REST kun for initial load.

**Hvorfor:** Det er sånn Evolution gjør det. Polling skalerer ikke til 36 000 samtidige (4 haller × 1500 × poll-interval).

**Arbeid:** ~5-7 dager total. Per-endpoint ~1 dag.

#### P1.3 — Concurrency-limiter separat fra rate-limiter
**Hva:** Max N samtidige in-flight requests per user på dyre endpoints (eks. `/api/spillevett/report/export` PDF-generering, `/api/admin/reports/*`).

**Hvorfor:** En user med 5 tabs som alle trigger PDF-gen kan kvele DB-poolen. Concurrency-limit beskytter mot dette uten å straffe normal page-refresh.

**Arbeid:** ~2 dager.

#### P1.4 — Fail-soft mode: server stale cache når 429 ville fyre
**Hva:** Når bucket er tom for en GET-endpoint som har cached respons i Redis (selv om TTL er utløpt), server cached data + sett `X-Stale: true` header. Bruker får ikke 429 — får gammel data.

**Hvorfor:** Casino-grade UX. Spiller skal aldri se "for many requests"-feilmelding.

**Arbeid:** ~1 dag (bygger på P0.2).

---

### P2 — Langsiktig (post-utvidelse, > 4 haller)

#### P2.1 — Edge-enforcement via Cloudflare/Render-edge
Flytt rate-limit til edge-laget før requests treffer Node-prosessen. Cloudflare WAF eller Render Edge-rules kan kjøre token-bucket på CDN-nivå.

#### P2.2 — Per-route + per-user multi-dimensional bucketing
GitHub-mønsteret: separate buckets per route-kategori (auth, wallet, lobby, reports). En spiller som spammer `/api/wallet/me` skal ikke kvele sin egen `/api/games/status`-poll.

#### P2.3 — Load-shedder med critical-path priority
Stripe-mønsteret: under høy last, drop non-kritisk read-traffikk (lobby-poll, report-eksport) for å beskytte critical-path (wallet-debit, claim-submit, payout). Krever Express route-tagging.

---

## 5. Implementasjons-plan (oppsummering)

| Prioritet | Tiltak | Filer | Arbeid | Pilot-blokker? |
|---|---|---|---|---|
| **P0.1** | Per-user keying for auth-paths | `httpRateLimit.ts` | 4t | Ja — kveler hall-NAT |
| **P0.2** | Server-side Redis-cache 15-30s | Ny `responseCache.ts` + Redis-modul | 1-2d | Ja — DB-load på 4×250 polling |
| **P0.3** | Rate-limit-headers (Industry-std) | `httpRateLimit.ts` | 2t | Anbefalt før pilot |
| **P0.4** | Klient-side ETag-cache | `packages/game-client`, `apps/admin-web` | 1d | Anbefalt før pilot |
| **P1.1** | Token-bucket m/burst | `httpRateLimit.ts` | 1d | Nei (post-pilot) |
| **P1.2** | Socket.IO push for live-state | `apps/backend/src/sockets/*`, klient-subscribers | 5-7d | Nei (post-pilot) |
| **P1.3** | Concurrency-limiter (per-user in-flight) | Ny middleware | 2d | Nei |
| **P1.4** | Fail-soft stale-cache | Bygger på P0.2 | 1d | Nei |
| **P2.x** | Edge-enforcement, multi-dim, load-shedder | Cloudflare/Render + Express | 5-10d | Etter utvidelse |

**Akutt-pakke (P0.1 + P0.2 + P0.3 + P0.4) er ~3-4 dev-dager og fjerner pilot-blokkeren.**

---

## 6. Kjente fallgruver (lærdom fra industry)

1. **Per-IP er regelrett feil for autenticerte routes** når klienter deler IP (NAT, mobilnett, hall-LAN). Stripe lærte dette tidlig — alle deres limits er per-API-key. Vår nåværende per-IP-modell vil kollapse på pilot-dag 1 i et bingolokale med 250 spillere bak én NAT-IP.

2. **Sliding-window uten burst-kapasitet straffer normal UX.** Page-refresh fyrer 10-15 kall i én burst — det er ikke en attack. Token-bucket med capacity=2× refill-rate gir 1-2 burstene gratis.

3. **Polling for live-state er anti-pattern.** GitHub fraråder eksplisitt polling og tilbyr WebHooks. Discord forbyr polling > 2 ganger/sek. Vi har Socket.IO allerede — bruk den.

4. **Mangel på headers gjør at klienten ikke kan backoff intelligent.** Klient som ikke vet "du har 50 req igjen, reset om 23 sek" vil hamre videre til 429.

5. **429 må alltid inneholde `Retry-After`.** Klient-side libs (axios, fetch wrappers) respekterer headeren automatisk. Uten den må klient gjette.

6. **Cache-invalidator må fan-out på server-event.** Vi har en compliance-state, en wallet-state. Når master-agent muterer state → invalider Redis-cache + push Socket.IO-event. Hvis ikke får spillere stale data.

7. **Concurrency-limit ≠ rate-limit.** Du kan ha en bruker som gjør 5 req/min (ingen rate-issue) hvor hver tar 30 sek å fullføre (PDF-gen, rapport). Det er en concurrency-issue — separate dimensjon, separat limit. Stripe-mønsteret.

8. **Dev/staging må ha bypass eller meget høye limits.** Vår eksisterende `HTTP_RATE_LIMIT_DISABLED=true` + localhost-bypass er riktig mønster. Behold dette.

9. **Måleparameter er ikke 429-count — det er klient-frustrasjon.** Du kan ha 0% 429-rate fordi klient pre-emptive throttler. Du må måle: gjennomsnittlig spiller-latens, polling-frekvens, "tab-tab-refresh"-tail latency.

10. **Casino-grade betyr at en spiller ALDRI skal se "for many requests"-feilmelding under normal bruk.** Det er regulatorisk reputational risk (spiller klager til Lotteritilsynet om "system utilgjengelig"). Fail-soft / stale-cache er ikke nice-to-have — det er P1 før utvidelse.

---

## 7. Kilder

- [Stripe — Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters) — 4-laget rate-limit-modell
- [Stripe — Rate limits docs](https://docs.stripe.com/rate-limits) — 25 req/sek default + token-bucket
- [GitHub — REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — 5000/time per-user + sekundære limits + headers
- [Cloudflare — Rate limiting best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/) — edge-enforcement, leaky-bucket vs sliding-window
- [Cloudflare — API rate limits](https://developers.cloudflare.com/fundamentals/api/reference/limits/) — 1200/5min per-user
- [Tyk — JWT-claim-based rate limiting](https://tyk.io/docs/5.5/basic-config-and-security/security/authentication-authorization/json-web-tokens/) — per-user-keying via "sub"-claim
- [Solo.io — JWT rate-limit tutorial](https://www.solo.io/blog/tutorial-securing-rate-limit-actions-with-json-web-tokens/) — pattern for autenticert per-user-rate-limit
- [WebSocket.org — WebSocket vs REST](https://websocket.org/comparisons/rest/) — polling overhead (80× WebSocket)
- [FlowVerify — SSE vs WebSockets vs Polling 2026](https://www.flowverify.co/blog/sse-websockets-polling-guide-2026) — moderne decision-guide
- [ilink.dev — Building a Scalable Online Casino Platform 2026](https://ilink.dev/blog/building-a-scalable-online-casino-platform-payments-risk-controls-and-automation) — iGaming-skalerings-mønstre
- [NEXT.io — Scaling iGaming platforms 2025/2026](https://next.io/news/technology/what-2025-revealed-scaling-igaming-platforms/) — observability over throughput
- [Quastor — Stripe rate limiting deep-dive](https://blog.quastor.org/p/rate-limiting-stripe) — analyse av Stripe-arkitektur
- [BytebyteGo — Design A Rate Limiter](https://bytebytego.com/courses/system-design-interview/design-a-rate-limiter) — algoritme-comparison
