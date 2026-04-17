# Agent 2 — Bolk 5 brief

**Dato:** 2026-04-17
**Eier:** slot-2 (agent 2)
**Forrige bolk:** BIN-527 (wire-kontrakt) + BIN-540 (feature-flag) + BIN-526 (pengeflyt-E2E) — merged ✅

## Oppstart

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-2
git fetch origin
git checkout main
git pull origin main
npm install
```

Bolk 5 består av 2 pilot-blokkere + 1 fast win. Kjør i denne rekkefølgen:

---

## Task 1 — BIN-516 Chat-persistens DB (P3, dag 1)

**Fast win — start her for å varme opp.**

### Scope
- Chat-meldinger skal persisteres i DB og replay-es til nye deltakere på join.
- Gjelder G1 og G3 (de to spillene med chat).

### Implementasjon

**Migrasjon:** `apps/backend/migrations/20260417000001_chat_messages.sql`
```sql
CREATE TABLE chat_messages (
  id BIGSERIAL PRIMARY KEY,
  hall_id UUID NOT NULL REFERENCES halls(id),
  room_id UUID NOT NULL REFERENCES rooms(id),
  player_id UUID NOT NULL REFERENCES players(id),
  player_name TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_room_created ON chat_messages(room_id, created_at DESC);
```

**Backend:** `apps/backend/src/sockets/chatEvents.ts`
- `chat:send` → INSERT + broadcast (behold eksisterende broadcast-oppførsel)
- `chat:history` → SELECT siste 50 per room_id ORDER BY created_at DESC (reverse før send)
- Hall-scoping: valider at `player.hall_id === room.hall_id` før INSERT

**Shared-types:** `packages/shared-types/src/socket-events.ts`
- Legg til `ChatHistoryRequest` + `ChatHistoryResponse` med Zod-schema (kontrakttestes automatisk via BIN-527)

**Klient:** `packages/game-client/src/components/ChatPanel.ts`
- På `bridge.start()`: emit `chat:history` med roomCode, render siste 50 før live-meldinger

### Verifisering
- Enhetstest: `apps/backend/src/sockets/__tests__/chatEvents.test.ts` — persistens + history-limit + hall-scoping
- Manuell: åpne 2 klienter, send 3 meldinger, refresh klient 2 → ser alle 3 på reload

### Docs
- Oppdater `docs/engineering/game1-canonical-spec.md` §chat (history-replay)
- Oppdater `docs/engineering/game3-canonical-spec.md` §chat
- Legg rad i `docs/engineering/PARITY_MATRIX.md` (kategori: Chat) — marker ✅ ved merge

---

## Task 2 — BIN-541 Spillvett cross-game-test (P1, pilot-blocker, dag 2-3)

**Release-gate krav per `docs/compliance/RELEASE_GATE.md` §3.**

### Scope
Verifiser at Spillvett-reglene virker identisk på G1/G2/G3/G5 etter legacy-avkobling.

### Implementasjon

**Fil:** `apps/backend/src/spillvett/__tests__/cross-game.test.ts`

Test-matrise (16 testcases = 4 spill × 4 regler):

| Regel | Forventet oppførsel |
|-------|---------------------|
| Hall-basert innsatsgrense | Siste buy som overstiger hall-limit → `socket.error: "hall_limit_exceeded"`, ticket ikke utstedt, entry_fee ikke debitert |
| Voluntary pause (aktiv) | `armBet` returnerer `error: "voluntary_pause_active"`, ingen arming, pause-tid vises tilbake til klient |
| Self-exclusion 1år | Join-forsøk returnerer `error: "self_excluded"`, pause-til dato i payload, ingen room-join |
| Hall-switch | Grenser følger ny hall umiddelbart (ikke gammel hall) — valider ved buy i ny hall med ny-hall-limit |

**Fail-closed:** Ekstra test per spill — mock `spillvettRepo.getLimits()` til å throwe → buy skal blokkeres, ikke tillates.

### Verifisering
- `npm test apps/backend/src/spillvett/__tests__/cross-game.test.ts` grønn
- CI-job må kjøre denne testen som required check (oppdater `.github/workflows/ci.yml` → spillvett-compliance job)

### Docs
- Oppdater `docs/compliance/RELEASE_GATE.md` — marker Spillvett-gate som ✅ når alle 16 + 4 fail-closed tester grønne
- Matrix-rad: Kategori "Compliance" → "Spillvett cross-game" → ✅

### Linear
Kommentar på BIN-541 med test-fil-path + merged SHA per Done-policy (BIN-534).

---

## Task 3 — BIN-498 Hall-display / TV-skjerm broadcast (P1, dag 4-6)

**Siste legacy-gap før pilot.** Dekker også duplikat BIN-504 (TvscreenUrlForPlayers).

### Scope
TV-skjerm i hallen viser live trukne tall, vinnere, kø-status, og reklame. Read-only — ingen spiller-interaksjon.

### Implementasjon

**Backend:** `apps/backend/src/sockets/adminDisplayEvents.ts`
- `admin-display:login` → autentiser admin/display-token, bind socket til hall
- `admin-display:subscribe` → join hall-display room (`hall:${hallId}:display`)
- `admin-display:state` → server sender full state-snapshot ved subscribe (drawnNumbers, activeRoom, nextDrawIn, lastWinners[])
- `hall:tv-url` → on-demand event når admin setter reklame-URL for hall

**Broadcasting:** Eksisterende `draw:new`, `pattern:won`, `gameState:changed` mirrores til `hall:${hallId}:display` room (ikke ny event-navn — reuse).

**Admin-web route:** `apps/admin-web/src/routes/tv/[hallCode].tsx`
- Full-screen read-only visning
- Auto-rekonnekt med eksponentiell backoff
- Viser siste trukne tall (stort), drawn-numbers-panel, nåværende vinnere, embed av `hall.tv_url` hvis satt

**DB:** Tilleggskolonne `halls.tv_url TEXT` (migrasjon `20260417000002_halls_tv_url.sql`)

**Shared-types:** `AdminDisplayState`, `HallTvUrlPayload` med Zod (kontrakttest via BIN-527).

### Verifisering
- Enhetstest: `apps/backend/src/sockets/__tests__/adminDisplayEvents.test.ts`
  - Login med feil token → 401
  - Subscribe → mottar state-snapshot
  - Draw skjer i hall → display mottar event
  - Cross-hall isolering: display i hall A får ikke events fra hall B
- Manuell: admin-web `/tv/HALL001` i én fane, spill-klient i annen, verifiser live draws speilet

### Docs
- Oppdater `docs/architecture/LEGACY_DECOUPLING_STATUS.md` — marker TV-skjerm som ✅
- Matrix-rad: Kategori "Legacy-gaps" → "Hall-display/TV" → ✅

### Linear
- Lukk BIN-498 per Done-policy
- Lukk BIN-504 med kommentar "consolidated-into BIN-498, levert via `apps/backend/src/sockets/adminDisplayEvents.ts` (SHA: xxx)"

---

## Husk — per PR

Per BIN-534 (Done-policy) vedtatt 2026-04-17:

1. **Merged commit-SHA til main** (ikke bare feature-branch)
2. **file:line-bevis** i PR-body for hver claim
3. **Grønn CI** — ikke merge med rødt
4. **PARITY_MATRIX.md oppdatert** i samme PR hvis raden endrer status
5. **Lockfile-rutine for apps/backend:** når du kjører `npm install` i `apps/backend/`, flytt root `package.json` midlertidig vekk og generer dedikert `apps/backend/package-lock.json` (dokumentert i tidligere PR-er).

## PR-template checklist

```markdown
- [ ] Commit merged til main (SHA: xxx)
- [ ] file:line-bevis i denne PR-body
- [ ] CI grønn (alle required checks)
- [ ] PARITY_MATRIX.md oppdatert
- [ ] Linear-issue oppdatert med SHA + path
- [ ] Lockfile-rutine fulgt (hvis apps/backend-endring)
```

---

## Koordinering med slot-1 (Claude)

- Slot-1 jobber parallelt med per-game parity gaps (BIN-529/530/531 kontinuerlig).
- **Ikke rør** `packages/game-client/src/games/game{1,2,3,5}/` unntatt `ChatPanel.ts` (task 1) — for å unngå merge-konflikter.
- PARITY_MATRIX.md: slot-1 eier hoveddelen; gi beskjed (Linear-kommentar på BIN-525) når du legger nye rader så slot-1 kan reconcile.

Lykke til. Ping i Linear ved blockers.
