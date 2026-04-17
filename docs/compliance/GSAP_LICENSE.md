# GSAP-lisens for Spillorama — compliance-avklaring

**BIN-538** · **Dato:** 2026-04-17 · **Eier:** Teknisk leder

## Konklusjon

**GSAP er 100 % gratis for kommersiell bruk — inkludert regulert pengespill.** Ingen lisens-innkjøp nødvendig. Ingen årlig abonnement. Ingen begrensninger på ant all haller, spillere, eller plugins.

## Kilde

- [gsap.com/licensing/](https://gsap.com/licensing/) — Standard "No Charge" GSAP License
- [gsap.com/pricing/](https://gsap.com/pricing/) — "GSAP is now 100 % free for all users, thanks to Webflow's support"

**Bakgrunn:** GSAP ble i 2024 overtatt av Webflow, som finansierer utviklingen. Det tidligere kommersielle Business Green / Business Blue-tier ble fjernet. Alt — inkludert premium-plugins — er nå fritt tilgjengelig.

## Dekket av fri lisens

- Kjerne: `gsap` (alle core animasjoner som vi bruker — tweens, timeline, ease)
- Plugins: ScrollTrigger, DrawSVG, MorphSVG, Draggable, SplitText (ingen av disse er pr. nå avhengigheter i Spillorama, men dekket hvis vi tar dem i bruk senere)
- Kommersiell bruk på web-app, web-klient, SaaS — eksplisitt nevnt
- Flere haller/site-seats — ingen per-seat-gate
- Pengespill / regulert industri — ikke eksplisitt ekskludert

## Kun begrensning

GSAP-lisensen forbyr å lage et konkurrerende visuelt animasjons-verktøy (f.eks. å re-pakke GSAP til en drag-and-drop animasjon-editor). Spillorama gjør ikke dette — vi bruker GSAP som intern avhengighet i web-klienten.

## Anvendelse i Spillorama-kode

- `packages/game-client/src/games/game1/` — ticket-animasjoner, claim-pulse, checkpoint-recovery-fade
- `packages/game-client/src/games/game2/` — CountdownTimer, RocketStack-stacking-animasjon, TicketScroller prev/next tween
- `packages/game-client/src/games/game3/` — AnimatedBallQueue FIFO drop, PatternBanner yoyo-pulse
- `packages/game-client/src/games/game5/` — RouletteWheel spin, JackpotOverlay DrumRotation idle, JackpotOverlay result-tween
- `packages/game-client/src/components/LoadingOverlay.ts` — late-join-sync opacity-tween

## Compliance-vurdering

- ✅ Ingen juridisk avklaring nødvendig (standard webbibliotek, fri lisens)
- ✅ Ingen Lotteritilsynet-notifikasjon nødvendig (ingen server-side gambling-logikk i GSAP — kun client-rendering)
- ✅ Ingen årsrapport-oppføring nødvendig

## Historisk kontekst

Pre-Webflow-oppkjøp var GSAP Club-versjonene lisensiert slik:

| Tier | Historisk pris | Dekning |
|------|----------------|---------|
| Standard (No Charge) | Gratis | Core + de fleste plugins, begrenset kommersiell |
| Business Green | ~$199/år | Kommersiell web |
| Business Blue | ~$1699/år | SaaS / white-label |

Bingoplatform som Spillorama ville historisk krevd Business Blue (SaaS-modell med flere hall-operatør-kunder). **Med Webflow-modellen er denne distinksjonen borte.**

## Revisjon

| Dato | Endring |
|------|---------|
| 2026-04-17 | Første versjon etter WebFetch av gsap.com/licensing + gsap.com/pricing. Bekreftet 100 % gratis via Webflow-finansiering. BIN-538 lukket som ✅. |
