# Game 4 — Temabingo — DEPRECATED ⚫

**Status:** Utgår. Ingen videre utvikling, ingen port til ny stack.
**Beslutning:** [BIN-496](https://linear.app/bingosystem/issue/BIN-496) (2026-04-17).
**DB-seed:** `apps/backend/migrations/20260413000001_initial_schema.sql:227` har nå `is_enabled = false`. Migration `20260417120000_deactivate_game4_temabingo.sql` deaktiverer for eksisterende DB.

## Hvorfor utgår

- Ingen klient-implementasjon i `packages/game-client/src/games/` (Game 4 er utelatt fra `registry.ts`)
- Ingen plan om å bygge web-native port (se `docs/architecture/migration-plan-unity-to-web.md` §2.1)
- Legacy-kode her har ikke vært aktivt brukt av spillere på en stund

## Hva som ikke migreres

- `Sockets/game4.js` — `Game4Data`, `Game4Play`, `Game4ChangeTickets`, `Game4ThemesData`, `ApplyVoucherCode`, `MysteryGameFinished`, `WheelOfFortuneData`, `SelectTreasureChest`
- `Controllers/` — tema-håndtering og voucher-logikk
- `Services/` — støttefunksjoner spesifikt for Game 4

**Voucher-system** var kun aktivt i Game 4. Når Game 4 fjernes faller hele voucher-infrastrukturen bort (se [BIN-497](https://linear.app/bingosystem/issue/BIN-497) som Duplicate-lukket inn i BIN-496).

## Cleanup-plan

Denne mappa fjernes fullt når `legacy/` flyttes til arkiv-repo per [`docs/operations/LEGACY_DELETION_PLAN.md`](../../../../docs/operations/LEGACY_DELETION_PLAN.md). Inntil da beholdes koden for revisjonsspor og eventuell emergency-rollback av pengespill-data.

## Relaterte lukkede issues

- [BIN-513](https://linear.app/bingosystem/issue/BIN-513) `Game4ThemesData` — lukket som Duplicate → BIN-496
- [BIN-518](https://linear.app/bingosystem/issue/BIN-518) `MysteryGameFinished` (Game 4) — lukket som Duplicate → BIN-496
- [BIN-497](https://linear.app/bingosystem/issue/BIN-497) voucher/promo-kode — lukket som Duplicate → BIN-496
