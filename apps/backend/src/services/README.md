# Module: `apps/backend/src/services`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~6 762

## Ansvar

Cross-cutting services som ikke passer i én domene-modul:
- E-post-service (transactional emails via SMTP eller AWS SES)
- SMS-service (Sveve via REST)
- Push-notification-service (Firebase FCM)
- PDF-generation (rapporter, kvitteringer)
- File-storage (S3-kompatibelt for attachments)

## Public API

| Service | Funksjon |
|---|---|
| `EmailService` | Transactional emails (template-based) |
| `SmsService` | SMS via Sveve |
| `PushNotificationService` | FCM push (BIN-FCM) |
| `PdfGenerationService` | Spillevett-rapport, settlement-PDF |
| `FileStorageService` | Upload/download til S3 |

## Invariants

1. **Idempotency for emails:** ikke send dobbel-mail ved retry (template-id + recipient + reference)
2. **PII i emails er OK** (mottaker har lov til å se egen data) — men ikke logg full body
3. **PDF-genereringen er fail-fast:** hvis service nede, retur 503

## Referanser

- BIN-FCM (push notifications)
- `docs/operations/FCM_PUSH_NOTIFICATIONS.md`
