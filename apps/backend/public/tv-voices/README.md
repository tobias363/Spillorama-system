# TV-kiosk Voice-packs

Dette er monteringspunktet for voice-packs som TV-skjermen i hallen
bruker for ball-utrop. Direktoriet serveres som statisk asset av backend
(`app.use(express.static(publicDir))` i `apps/backend/src/index.ts`).

## Hvor lydfilene faktisk ligger

Voice-pack-ene er **ikke duplisert** under denne katalogen. De ligger som
`.ogg`-filer i `packages/game-client/public/assets/game1/audio/`, og
backend-routeren `apps/backend/src/routes/tvVoiceAssets.ts` mapper TV-
kiosken sine forespørsler til dem:

| TV-pack   | Disk-katalog                                                 |
| --------- | ------------------------------------------------------------ |
| `voice1`  | `packages/game-client/public/assets/game1/audio/no-male/`    |
| `voice2`  | `packages/game-client/public/assets/game1/audio/no-female/`  |
| `voice3`  | `packages/game-client/public/assets/game1/audio/en/`         |

Hver pack inneholder 75 filer (`1.ogg`–`75.ogg`). TV-klienten kaller
fortsatt `/tv-voices/<voice>/<ball>.mp3`; backend serverer `.ogg`-bytene
under riktig `Content-Type: audio/ogg`-header. HTMLAudioElement i Chrome
respekterer header (ikke endelse), så avspilling fungerer transparent.

## Override (sjelden)

Hvis du trenger å overstyre én eller flere lydfiler uten å røre game-
client-pakken, sjekker du inn en konkret fil under denne katalogen:

```
apps/backend/public/tv-voices/voice1/1.mp3
```

`express.static`-mounten plukker den opp før fallback-routeren rammes,
så den vinner. Begge endelser (`.mp3`/`.ogg`) støttes.

## Hvorfor ikke duplisere filene hit?

- ~7.7 MB lydfiler ville blitt sjekket inn to ganger
- Re-recording av tellertall (f.eks. tydeligere uttale) ville krevd
  manuell sync mellom Game 1 og TV-kiosk
- Render bygger hele monorepo-et, så `packages/`-stien er tilgjengelig
  ved runtime — det finnes ingen praktisk separasjon mellom backend og
  game-client i den deployen vi kjører

Hvis backend-deploy noen gang splittes fra game-client (f.eks. dedikert
docker-image som bare bygger `apps/backend/`), må disse filene legges
under `apps/backend/public/tv-voices/<voice>/` i stedet.

## Forventet URL-struktur (klient-perspektiv)

```
/tv-voices/voice1/1.mp3
/tv-voices/voice2/45.mp3
/tv-voices/voice3/75.mp3
```

TV-klienten (`apps/admin-web/src/pages/tv/TVScreenPage.ts`) bygger URL-en
dynamisk basert på hallens valgte voice-pack:

```ts
new Audio(`/tv-voices/${instance.voice}/${ball}.mp3`);
```

## Validering ved manuell test

```bash
# Start backend lokalt
npm --prefix apps/backend run dev

# Sjekk endpoint
curl -I http://localhost:4000/tv-voices/voice1/1.mp3
# → 200 OK, Content-Type: audio/ogg
```
