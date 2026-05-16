# Delta-rapport — Codex / game1-bong-spacing

**Dato:** 2026-05-16
**Branch:** `codex/game1-bong-spacing-2026-05-16`
**Scope:** Spill 1 top-HUD til bong-grid spacing. Tobias ba om lik spacing mellom elementene og mindre tomrom over første bongrad.

## Hva ble endret

- `packages/game-client/src/games/game1/screens/PlayScreen.ts` — statisk `TICKET_TOP = 239` er erstattet med dynamisk top-posisjon basert på faktisk `top-group-wrapper`-bunn + `16px`.
- `packages/game-client/src/games/game1/screens/PlayScreen.ts` — ticket-grid høyde beregnes fra målt top-posisjon, slik at redusert top-gap gir mer synlig bong-område.
- `packages/game-client/src/games/game1/screens/PlayScreen.ts` — ticket-grid repositioneres etter top-HUD status/body-render og etter CenterTopPanel/LeftInfoPanel-oppdateringer.
- `.claude/skills/spill1-center-top-design/SKILL.md` — v1.3.1 dokumenterer ticket-grid spacing-invarianten.
- `docs/engineering/PITFALLS_LOG.md` — §7.39 lagt til.
- `docs/engineering/AGENT_EXECUTION_LOG.md` — agent-entry lagt til.

## Hva andre steder kunne ha blitt brutt

- Top-HUD kunne overlappe bongene hvis målingen ble gjort før status/action/center-top hadde final høyde.
- Bong-grid kunne beholdt gammel top-padding hvis `build:games` ikke ble kjørt etter TypeScript-endringen.
- Chat-toggle/resize kunne fått feil grid-høyde hvis `positionTicketGrid()` fortsatt brukte gammel konstant.
- Bong-design kunne blitt feil hvis spacing ble forsøkt løst med per-card margin/padding. Dette ble unngått; parent-layout eier top-posisjon.

## Nye fragilities oppdaget

- Ingen ny FRAGILITY-ID opprettet.
- Ny PITFALLS-entry: `docs/engineering/PITFALLS_LOG.md` §7.39 — ticket-grid top-gap må måles fra faktisk top-HUD, ikke hardkodes.
- Latent fragility: top-HUD er en levende HTML-wrapper. Når kolonnene endrer høyde, må ticket-grid måles mot ferdig renderet wrapper før layout vurderes som korrekt.

## Brief for neste agent

- Ikke gjeninnfør hardkodet `TICKET_TOP` for Spill 1.
- Hvis `top-group-wrapper` endres, mål faktisk gap i browser: `ticket-grid.top - top-group-wrapper.bottom`.
- Målt target-gap er `16px`, samme spacing-familie som bong-gridens `gap: 16px`.
- Kjør `npm run build:games` før lokal `/web/`-verifisering. Backend-serveren serverer bygget bundle fra `apps/backend/public/web/games`.

## Tester kjørt

- `npm -w @spillorama/game-client run check` — pass.
- `npm -w @spillorama/game-client run test -- TicketGridHtml CenterTopPanel no-backdrop-filter-regression` — pass, 7 filer / 93 tester.
- `node scripts/hooks/check-markdown-links.mjs .claude/skills/spill1-center-top-design/SKILL.md docs/engineering/PITFALLS_LOG.md docs/engineering/AGENT_EXECUTION_LOG.md` — pass.
- `node scripts/hooks/validate-skill-frontmatter.mjs .claude/skills/spill1-center-top-design/SKILL.md` — pass.
- `npm run build:games` — pass.
- Playwright mot `http://localhost:3000/web/` — pass: `top-group-wrapper.bottom = 277`, `ticket-grid.top = 293`, `gap = 16`, screenshot lagret til `/tmp/spillorama-game1-spacing-after-build.png`.
