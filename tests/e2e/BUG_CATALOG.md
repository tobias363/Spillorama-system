# Pilot-flow bug-katalog

Lokalisering av strukturelle vs implementasjons-bugs avdekket av
`tests/e2e/spill1-pilot-flow.spec.ts` (Tobias-direktiv 2026-05-13).

## Kategorisering

- **Strukturell** — fundamentet/arkitekturen er feil. Krever større rewrite
  før test går grønn. Trigger plan C (`docs/architecture/PLAN_C_*`).
- **Implementasjons** — én linje / én fil-fix. Test grønner etter PR.

**Cut-off for plan C:** Hvis ≥ 3 strukturelle bugs avdekkes, eskalér til
Tobias for arkitektur-rewrite av buy-flow.

## Aktive funn (oppdateres mens testen kjøres mot dagens kode)

> Status per 2026-05-13 09:51: testen er under utvikling. Første kjøringer
> har avdekket Lobby-side-state-bug og dev-user-redirect-race. Disse er
> testharness-issues (test-side), ikke kode-bugs.

### Test-harness-issues (fix i test-koden)

| # | Funn | Kategori | Status |
|---|---|---|---|
| H1 | Player-shell defaulter til `hall-default` (første hall i listen), ikke pilot-hall | Test-harness | ✅ Fixet via `sessionStorage.setItem("lobby.activeHallId", "demo-hall-001")` pre-navigate |
| H2 | `?dev-user=…` trigger `window.location.replace()` redirect — Playwright må vente på redirect før klikk | Test-harness | 🟡 Under iterasjon |
| H3 | Bingo-tile click triggers game-bundle download (delay før popup mounter) | Test-harness | 🟡 Forventet — `toBeVisible({timeout:30_000})` skal dekke |

### Implementasjons-bugs (fix i prod-kode)

| # | Funn | Kategori | Fix-PR | Status |
|---|---|---|---|---|
| I1 | LARGE_TICKET_PRICE_MULTIPLIER var 2 i stedet for 3 — Stor-bonger viste feil pris | Implementasjons | #1301 | ✅ Merget |
| I2 | TicketGrid leste `state.entryFee=20` (room.gameVariant default) i stedet for `lobbyTicketConfig.entryFee=5` — alle brett viste 20 kr | Implementasjons | #1303 | ✅ Merget |
| I3 | Armed-to-purchase SQL refererte ikke-eksisterende `hall_id`-kolonne | Implementasjons | #1293 | ✅ Merget |
| I4 | BuyPopup auto-showet kun én gang per session | Implementasjons | #1273 | ✅ Merget |
| I5 | `waitingForMaster` state låste Buy-knappen | Implementasjons | #1279 | ✅ Merget |
| I6 | Game-end resetter rom helt (ROOM_NOT_FOUND ved neste runde) | Implementasjons | #1291 | ✅ Merget |
| I7 | Watchdog auto-cancellet paused rounds | Implementasjons | #1286 | ✅ Merget |
| I8 | `SocketActions.buildScheduledTicketSpec` hardkodet Large = small × 2 i stedet for å bruke `priceMultiplier` direkte fra ticketTypes-tabellen (3/6/9 for Large white/yellow/purple). Buy-API avviste med `INVALID_TICKET_SPEC: "Pris for white/large matcher ikke spillets konfig (forventet 1500 øre)"`. Fix: bruk `ticketType.priceMultiplier` direkte siden lobbyTicketConfig allerede har korrekt verdi (3/6/9). | Implementasjons | feat/autonomous-pilot-test-loop-2026-05-13 | 🟡 PR pending |
| I9 | `TicketGridHtml.computePrice` brukte `state.ticketTypes` (8 legacy small_yellow-style types) for å mappe ticket.type → priceMultiplier, men server-rendrede tickets bruker `(size, color)`-modell (`type: "small"/"large"`, `color: "white"/"yellow"/"purple"`). Find returnerte feil entry → multiplier=1 → alle brett viste samme pris (5 kr). Fix: pass `lobbyTicketConfig.ticketTypes` til TicketGridHtml.setTickets og match på (name contains color) + (type matches size). | Implementasjons | feat/autonomous-pilot-test-loop-2026-05-13 | 🟡 PR pending |
| I10 | `Game1BuyPopup.showWithTypes` nullstilte `uiState`, `typeRows`, `buyBtn` ved re-open, men IKKE `cancelBtn` (opacity 0.5, disabled, cursor:default fra `handleBuy()` → `showResult()`-pathen). Re-åpnet popup hadde stale cancelBtn-state → Avbryt-knapp ikke klikkbar. Fix: eksplisitt reset av `cancelBtn.disabled = false`, opacity = 1, cursor = pointer ved hver showWithTypes-init. | Implementasjons | feat/autonomous-pilot-test-loop-2026-05-13 | 🟡 PR pending |

### Strukturelle bugs (krever større endring)

> Per 2026-05-13 09:51: **ingen strukturelle bugs identifisert via test enda.**
> Plan C-trigger er IKKE aktivert.

| # | Funn | Hvorfor strukturell | Foreslått fix | Status |
|---|---|---|---|---|
| _(ingen)_ | — | — | — | — |

## Når katalogen brukes

1. **Test feiler → første-undersøkelse:** Er det test-side eller kode-side?
   - Logg under "Test-harness-issues" hvis test-koden.
   - Logg under "Implementasjons-bugs" eller "Strukturelle bugs" hvis prod-kode.

2. **Implementasjons-bug:** Standard PR-flow. Sett `Fix-PR` etter merge.

3. **Strukturell bug:** Beskriv WHY structural i kolonnen
   "Hvorfor strukturell". Eks:
   - "Krever endring i hvordan ticket-typer rendres på server vs klient"
   - "Krever ny outbox-tabell for å unngå race"
   - "Krever bytte av lobby-flow fra hall-spesifikk til GoH-spesifikk"

4. **≥ 3 strukturelle bugs:** Eskalér til Tobias og lag
   `docs/architecture/PLAN_C_BUY_FLOW_REWRITE_<dato>.md`.

## Format-mal for nye funn

```markdown
| <N> | <Kort beskrivelse> | <Strukturell/Implementasjons> | <PR-nr eller TODO> | <Status> |
```

Status-verdier:
- 🔴 **Bekreftet** — sett av test-failure, ikke fikset
- 🟡 **Under iterasjon** — PR åpen, ikke merget
- ✅ **Merget** — fikset i main
- ⚠️ **Avhenger av** — blokkert av annen PR

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — etablert template + listet 7 allerede-fiksede implementasjons-bugs | PM-AI (Claude Opus 4.7) |
| 2026-05-13 | E2E-test grønn etter fixes for I8/I9/I10 (SocketActions multiplier, TicketGrid mapping, BuyPopup cancelBtn-reset). Test kjører i 12.3s deterministic. | Autonomous-pilot-test-loop agent |
