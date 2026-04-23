# notifications

FCM (Firebase Cloud Messaging) push-notifikasjoner for mobil-app.

## FcmPushService (BIN-FCM)

Porterer legacy-backendens `fcm-node`/`fcm-notification`-subsystem. Er kjernen bak:

- `/api/notifications*` (player-facing, routes/notifications.ts)
- `/api/admin/notifications/broadcast` (admin, routes/adminNotifications.ts)
- `sendGameStartNotifications`-cron (jobs/gameStartNotifications.ts)

### Environment

| Variabel                    | Påkrevd | Beskrivelse                                              |
|-----------------------------|---------|----------------------------------------------------------|
| `FIREBASE_CREDENTIALS_JSON` | ja\*    | Service-account JSON (rå eller base64).                  |
| `FIREBASE_PROJECT_ID`       | nei     | Overstyrer `project_id` fra credentials hvis satt.       |

\* Uten credentials kjører service i no-op-modus: notification-rader lagres
men ingen push sendes. Dev-miljøer kan dermed starte uten Firebase-
credentials; prod MÅ sette variabelen.

Se `docs/operations/FCM_PUSH_NOTIFICATIONS.md` for full drifts-runbook.

### Usage

```ts
import { FcmPushService } from "./notifications/FcmPushService.js";

const fcm = new FcmPushService({ pool, schema: "public" }); // reads env
await fcm.registerDevice({
  userId: "user-1",
  firebaseToken: "fcm-token-from-client",
  deviceType: "ios",
});
await fcm.sendToUser("user-1", {
  type: "bonus",
  title: "Ny bonus",
  body: "Du har fått 50 kr",
  data: { bonusId: "b-42" },
});
```

### Notification-typer

Stabil konstant-liste i `types.ts`:

- `game-start` — pre-game-varsler (cron)
- `game-reminder` — manuell påminnelse
- `bonus` — bonus tilgjengelig
- `rg-warning` — Spillvett-melding
- `deposit-confirmed` / `withdraw-confirmed`
- `kyc-status-change`
- `admin-broadcast` — admin-initiert broadcast
- `generic` — fallback

Nye typer legges til i `NOTIFICATION_TYPES`-konstanten + DB-validering.

### Templates

Valgfri template-registry i `templates/index.ts` — brukes av cron-jobben
og kan brukes av admin-broadcast hvis man vil gjenbruke format-strenger.
Følger samme lille Handlebars-subset som EmailService.

### Testing

`FcmPushService.test.ts` bruker en in-memory `FakePool` som implementerer
pg.Pool-surface for SQL-ene servicen bruker. Ingen DB-container nødvendig.

FCM-transporter injiseres som `FcmTransporter`-fake — samme mønster som
EmailService's `EmailTransporter`.
