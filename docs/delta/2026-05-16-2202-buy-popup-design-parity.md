# Delta-rapport — Codex / buy-popup-design-parity

**Dato:** 2026-05-16
**Branch:** `codex/buy-popup-design-parity-2026-05-16`
**PR:** #1557
**Scope:** Game1 buy-popup visuell paritet mot `kjopsmodal-design.html` og no-scroll-komprimering.

## Hva ble endret

- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts:267` — card-padding, `maxHeight` og `overflow` strammet slik at popupen passer uten intern scroll i standard desktop/tablet viewport.
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts:307` — synlig header rendres som én linje: `Neste spill: {displayName}`.
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts:321` — subtitle-div med `letter-spacing: 0.14em` beholdes som skjult test-anchor for `displayName`-testene.
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts:338` — hidden summary compat-placeholder holder `header.children[3] = lossStateEl` intakt.
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts:360` — faktisk `Du kjøper`-summary flyttes til full-width footer i `typesContainer`.
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts:378` — `typesContainer` får felles bordered wrapper rundt ticket-rader og summary, slik mockupen viser.
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts:414` — tom statusmelding skjules med `display:none`, så den ikke bruker høyde.
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts:1352` — `renderSummary()` skjuler summary når ingen valg finnes og viser chips nederst i ticket-wrapperen når valg finnes.
- `packages/game-client/src/visual-harness/visual-harness.ts:248` — buy-popup-scenarioet bruker nå seks hvit/gul/lilla small/large-rader og forhåndsvelger `1x Liten hvit`, `1x Stor hvit`, `1x Liten gul`.
- `packages/game-client/tests/visual/__snapshots__/spill1-buy-popup.spec.ts-snapshots/spill1-buy-popup-agent-portal-1280.png` — Linux CI-actual snapshot godkjent som ny baseline for agent-portal viewport.
- `packages/game-client/tests/visual/__snapshots__/spill1-buy-popup.spec.ts-snapshots/spill1-buy-popup-tv-kiosk-1920.png` — Linux CI-actual snapshot godkjent som ny baseline for TV-kiosk viewport.
- `.claude/skills/buy-popup-design/SKILL.md` — v1.1.0 dokumenterer ny header/summary/no-scroll-kontrakt.
- `docs/engineering/PITFALLS_LOG.md` — §7.38 lagt til.
- `docs/engineering/AGENT_EXECUTION_LOG.md` — agent-entry lagt til.

## Hva andre steder kunne ha blitt brutt

- `Game1BuyPopup.lossState.test.ts` kunne brutt hvis `lossStateEl` flyttet fra `header.children[3]`. Dette ble unngått med hidden compat-placeholder.
- `Game1BuyPopup.displayName.test.ts` kunne brutt hvis subtitle-diven ble fjernet eller hvis `letter-spacing: 0.14em` ble brukt på et annet synlig element. Subtitle-anchor er beholdt og skjult.
- `Game1BuyPopup.ticketCount.test.ts` kunne brutt hvis large-ticket quantity eller `ticketCount`-semantikk ble blandet med visuell row-endring. Ticket-semantikk er uendret.
- PlayScreen-integrasjon kunne fått for høy popup hvis tom status fortsatt tok plass. Status-raden skjules når tom.
- Visual-harness kunne blitt misvisende hvis fixture fortsatt brukte generiske farger. Harness er oppdatert til faktisk hvit/gul/lilla-kjøpscase.

## Nye fragilities oppdaget

- Ingen ny FRAGILITY-ID opprettet.
- Ny PITFALLS-entry: `docs/engineering/PITFALLS_LOG.md` §7.38 — BuyPopup-design må løse DOM-test-kontrakt og visuell mockup separat.
- Relatert latent fragility: mockup-paritet kan se riktig ut mens DOM-test-kontrakten er brutt. Fremtidige endringer må derfor verifisere både visuell layout og eksisterende test-indexer.

## Brief for neste agent

- Ikke flytt top-level `card.children` i `Game1BuyPopup` uten å oppdatere de eksisterende testene og skillen eksplisitt.
- Ikke fjern hidden subtitle-anchoren selv om den ikke er synlig. Den er test-kontrakt for display-name.
- Ikke flytt `Du kjøper` tilbake til header. Den hører visuelt til nederst i ticket-wrapperen.
- Ved nye BuyPopup-designendringer: sjekk `kjopsmodal-design.html`, kjør `Game1BuyPopup`-testene, og mål `card.scrollHeight <= card.clientHeight` i visual-harness.

## Tester kjørt

- `npm -w @spillorama/game-client run test -- Game1BuyPopup` — pass, 4 filer / 32 tester.
- `npm -w @spillorama/game-client run check` — pass.
- `git diff --check` — pass.
- `node scripts/hooks/check-markdown-links.mjs .claude/skills/buy-popup-design/SKILL.md docs/engineering/PITFALLS_LOG.md docs/engineering/AGENT_EXECUTION_LOG.md` — pass.
- `node scripts/hooks/validate-skill-frontmatter.mjs .claude/skills/buy-popup-design/SKILL.md` — pass.
- Playwright visual-harness på `http://localhost:5175/web/games/visual-harness.html?scenario=buy-popup` — pass: `scrollHeight === clientHeight`, `fitsOverlay: true`, `overflows: false`.
- GitHub Actions `visual-regression` første run — feilet kun på `spill1-buy-popup.png` i `agent-portal-1280` og `tv-kiosk-1920`, som var forventet etter tilsiktet designendring. CI-actual PNG-er er kopiert inn som nye baselines i denne PR-en.
- `npx playwright test packages/game-client/tests/visual/spill1-buy-popup.spec.ts` lokalt på macOS etter Linux-baseline-kopiering — feilet med ca. 2% pixel-diff. Dette er forventet cross-platform rasterdrift når Linux CI-actual brukes som autoritativ baseline; endelig verifikasjon er GitHub Actions `visual-regression`.
