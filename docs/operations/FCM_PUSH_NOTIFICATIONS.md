# FCM push-notifikasjoner — drifts-runbook

Firebase Cloud Messaging-integrasjon for mobil-app. Porterer legacy-
backendens `fcm-node`/`fcm-notification`-subsystem til ny stack.

Relevante komponenter:

- `apps/backend/src/notifications/FcmPushService.ts` — kjerne-service
- `apps/backend/src/jobs/gameStartNotifications.ts` — cron (legacy 1min)
- `apps/backend/src/routes/notifications.ts` — player-facing endpoints
- `apps/backend/src/routes/adminNotifications.ts` — admin broadcast
- `apps/backend/migrations/20260706000000_app_notifications_and_devices.sql`

## Environment-variabler

Settes i Render (eller annen hosting). Begge må være satt for at push skal fungere — service kjører i no-op-modus hvis en mangler.

| Variabel                    | Påkrevd | Beskrivelse                                                                                            |
|-----------------------------|---------|--------------------------------------------------------------------------------------------------------|
| `FIREBASE_CREDENTIALS_JSON` | Ja¹     | Service-account JSON fra Firebase-console. Kan være rå JSON eller base64-encodet (foretrukket).        |
| `FIREBASE_PROJECT_ID`       | Nei²    | Project-ID. Hvis ikke satt brukes `project_id`-feltet fra credentials-JSON.                            |
| `JOB_GAME_START_NOTIFICATIONS_ENABLED` | Nei     | Default `true`. Kan settes til `false` for å disable cron-jobben uten å fjerne credentials. |
| `JOB_GAME_START_NOTIFICATIONS_INTERVAL_MS` | Nei | Default `60000` (1min). Minimum `30000`.                                              |

¹ Uten `FIREBASE_CREDENTIALS_JSON` kjører FcmPushService i no-op-modus:
   notification-rader lagres i `app_notifications` med status=`failed` og
   error_message=`skipped: fcm disabled`, men ingen push sendes. Dev-
   miljøer kan dermed starte uten Firebase-credentials. Produksjon MÅ
   sette variabelen.

² Hvis ikke satt leses den fra credentials-JSONens `project_id`-felt.

### Base64-encoding av credentials

Service-account JSON fra Firebase har `private_key`-felt med `\n`-escapes.
Render og andre secret-managers håndterer disse dårlig. Anbefalt flyt:

```bash
cat firebase-service-account.json | base64 > firebase.b64
# Kopier innholdet i firebase.b64 inn i FIREBASE_CREDENTIALS_JSON i Render.
```

FcmPushService detekterer automatisk base64 vs rå JSON ved å se om
strengen starter med `{`.

## Endepunkter

### Player-facing (krever Bearer-token)

- `GET /api/notifications` — liste over varsler for innlogget bruker.
  Query: `limit` (default 50, max 100), `offset`, `unreadOnly` (bool).
- `GET /api/notifications/unread/count` — `{ count: N }` for badge.
- `POST /api/notifications/:id/read` — mark én som lest.
- `POST /api/notifications/read-all` — mark alle som lest.
- `POST /api/notifications/read` — legacy-kompatibilitet: `{ id? }`. Hvis
  `id` er satt, mark én; ellers mark alle.
- `POST /api/notifications/device` — registrer FCM-token.
  Body: `{ firebaseToken, deviceType: "ios"|"android"|"web", deviceLabel? }`.
- `DELETE /api/notifications/device` — avregistrer via token.
  Body: `{ firebaseToken }`.
- `DELETE /api/notifications/device/:id` — avregistrer spesifikk device
  (scoped til innlogget bruker).
- `GET /api/notifications/devices` — liste over brukerens devices.
  Query: `includeInactive` (bool).

### Admin (krever ADMIN_PANEL_ACCESS)

- `POST /api/admin/notifications/broadcast` — send push til gruppe.
  Body: `{ type, title, body, data?, userIds?, hallId?, all?, confirm? }`.
  - `userIds`: array med spesifikke spiller-IDer.
  - `hallId`: alle aktive spillere i én hall (filtrert for soft-deletes +
    `app_player_hall_status.is_active=false`).
  - `all: true` + `confirm: true`: alle aktive spillere. Krever eksplisitt
    `confirm` for å unngå utilsiktede "send til alle".

## Database-skjema

### `app_user_devices`

Én rad per (bruker, FCM-token). UNIQUE på `firebase_token` for dedup —
samme enhet kan ikke dupliseres selv om to brukere logger inn på samme
telefon.

Inaktive devices (`is_active=false`) beholdes for audit/trace; sende-
flyten ekskluderer dem. FCM-feilkoder
(`registration-token-not-registered`, `invalid-registration-token`) auto-
disabler tokenet.

### `app_notifications`

Historisk logg over alle sendte varsler. Én rad per (bruker, notification)
— ikke per device. `fcm_message_id` er responsen fra den siste suksess-
fulle device-sendingen (nok for trace mot Firebase-console; hvis per-
device trace trengs senere kan vi legge til en `app_notification_sends`
child-tabell).

State-maskin:

- `pending` — opprettet men ikke sendt til FCM.
- `sent` — FCM aksepterte. `sent_at` + `fcm_message_id` satt.
- `delivered` — klient ACK mottatt (fremtidig; ikke wired i pilot).
- `failed` — FCM avviste eller skipped (se `error_message`).

`error_message` starter med `skipped:` når rad ble opprettet men ingen
push forsøkt (no-op-modus eller ingen aktive devices). Bruk dette for å
filtrere bort false-positive failures i rapporter.

## Cron-jobben (`sendGameStartNotifications`)

Legacy-backend sendte pre-game-varsler hvert 1. minutt. Ny cron gjør det
samme:

1. Query `app_game1_scheduled_games` for rader med status i
   `('purchase_open', 'ready_to_start')` der
   `scheduled_start_time - notification_start_seconds <= now()`.
2. Dedupe mot `app_notifications` (type=`game-start`,
   `data->>'scheduledGameId'` de siste 24t).
3. Hent spillere i `participating_halls_json` — filtrert for soft-delete
   og `app_player_hall_status.is_active=false`.
4. `fcmPushService.sendBulk(recipients, payload)` — en rad per spiller.

Hvis FCM er disabled (no-op-modus), sendBulk lagrer rader men sender
ikke — cron-output viser `sent=0 skipped=N` og ingen push går ut.

### Disable cron uten å ta ned FCM

Sett `JOB_GAME_START_NOTIFICATIONS_ENABLED=false` i Render. Player-
facing endpoints + admin broadcast fortsetter å fungere; bare pre-game-
varsler stoppes.

### Full FCM down-time

Hvis vi MÅ ta ned alt (f.eks. Firebase-kontoen suspended):

1. Fjern `FIREBASE_CREDENTIALS_JSON` fra Render.
2. Deploy. Service detekterer manglende config og kjører i no-op.
3. Varsler lagres fortsatt i `app_notifications` — de kan re-sendes
   senere ved re-enable.

## Rate-limit

FCM-limit: ~1000 msg/s per Firebase-projekt. Service sender sekvensielt
innen en bulk (ikke Promise.all) for å holde seg godt under. For større
broadcasts (> 1000 spillere) vurder:

- Splitte opp i flere `sendBulk`-kall med pause mellom.
- Bruke FCM multicast (1 kall, 500 tokens) — ikke implementert i pilot,
  følge-opp hvis admin-broadcast blir hovedkanal.

## Sikkerhet

- **Credentials**: lagres KUN som env-var, aldri committed.
- **Token-rotasjon**: FCM-tokens roteres av klient. Klienten POSTer ny
  token til `/api/notifications/device` ved rotasjon; ON CONFLICT-clausen
  oppdaterer raden.
- **Scope**: `DELETE /api/notifications/device/:id` er scoped til
  innlogget bruker — man kan ikke disable en annen brukers device.
- **Admin broadcast** `all: true` krever eksplisitt `confirm: true` og
  ADMIN-rolle. Audit-logges med `action=notification.broadcast`.

## Feilsøking

### Push kommer ikke frem på klient

1. Sjekk `app_notifications.status` for raden. Hvis `failed`, se
   `error_message`.
2. Hvis `fcm_message_id` er satt men klient ikke mottar, problemet er
   hos Firebase/klient — verifiser med Firebase-console.
3. `registration-token-not-registered` = klient må re-registrere token.
   Service auto-disabler device; klient vil POSTe ny token ved neste
   app-åpning.

### Cron logger `0 items`

Mulige årsaker:

- Ingen spill innen notification-vinduet (OK, normal drift).
- Alle innen-vinduet-spill har allerede en `game-start`-rad siste 24t
  (dedup fungerer som tenkt).
- `app_game1_scheduled_games` mangler (migrasjon ikke kjørt). Sjekk
  output-note; cronen logger dette eksplisitt.
- FCM disabled; rader lagres men count er `sent=0 skipped=N`.

### "no active devices"-skipped

Spilleren har ingen aktive FCM-tokens. Enten har de ikke åpnet mobil-
app, eller alle tokens er disabled. Ikke en feil — bare at det ikke er
noe å sende til.
