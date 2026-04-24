# TV-kiosk Voice-packs

Dette er monteringspunktet for voice-packs som TV-skjermen i hallen
bruker for ball-utrop. Direktoriet serveres som statisk asset av backend
(`app.use(express.static(publicDir))` i `apps/backend/src/index.ts`).

## Forventet struktur

```
apps/backend/public/tv-voices/
  voice1/
    1.mp3
    2.mp3
    ...
    75.mp3
  voice2/
    1.mp3
    ...
    75.mp3
  voice3/
    1.mp3
    ...
    75.mp3
```

TV-klienten (`apps/admin-web/src/pages/tv/TVScreenPage.ts`) bygger URL-en
dynamisk basert på hallens valgte voice-pack:

```
/tv-voices/<voice>/<ball>.mp3
```

## Manglende assets (per 2026-04-24)

**Voice-pakker er ikke sjekket inn i repo.** Infrastrukturen er ferdig —
backend-API, admin-dropdown og TV-klient-logikk — men selve lydfilene
mangler. TV-rendering er fail-safe: feil under `audio.play()` svelges
stille, slik at manglende filer ikke blokkerer kiosken.

### Relatert tilgjengelig materiale

`packages/game-client/public/assets/game1/audio/` inneholder norske
voice-packs for Spill 1 (`no-male/`, `no-female/`, `en/`) i `.ogg`-format
(75 filer per pack). Disse kan vurderes som kilde når TV-voice-assets
skal genereres — men krever format-konvertering (.ogg → .mp3) og evt.
ulik pacing for TV-utrop vs. in-game-utrop.

## Follow-up (ikke en del av dette PR-et)

- Generer/produsér 3 voice-packs (voice1/voice2/voice3) i `.mp3`-format
- Sjekk inn filene under denne katalogen
- Validér playback mot ekte hall-TV (Chrome autoplay-policy kan kreve
  brukerinteraksjon første gang)
- Eventuell komprimering / CDN-strategi hvis samlet størrelse overstiger
  ~10 MB per hall
