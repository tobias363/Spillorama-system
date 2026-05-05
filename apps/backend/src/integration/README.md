# Module: `apps/backend/src/integration`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~4 114

## Ansvar

External-service adapters used by the backend. Inneholder integrasjoner mot:
- EmailService (transactional emails via nodemailer/SMTP)
- SmsService (Sveve REST)
- BankID (KYC-handshake)
- Cloudinary (image storage)
- Sentry (error reporting)

## Public API

Hver integrasjon eksporterer en service-klasse med dependency-injectable
config. Se per-fil dokumentasjon under for shape og environment-variabler.

## EmailService (BIN-588)

Transactional-mail sender used for password reset, e-mail verification and the
BankID re-verification reminder (BIN-582). Wraps `nodemailer` and owns the
template registry so the rest of the backend never assembles HTML bodies
inline.

### Environment

| Variable       | Required | Default | Notes                                              |
|----------------|----------|---------|----------------------------------------------------|
| `SMTP_HOST`    | yes\*    | —       | e.g. `smtp.sendgrid.net`                           |
| `SMTP_PORT`    | yes      | `587`   | `465` auto-enables TLS                             |
| `SMTP_SECURE`  | no       | `false` | `true`/`1` to force TLS                            |
| `SMTP_USER`    | no       | —       | auth username                                      |
| `SMTP_PASS`    | no       | —       | auth password                                      |
| `SMTP_FROM`    | yes      | —       | `Spillorama <no-reply@spillorama.no>`              |
| `SMTP_URL`     | no       | —       | full SMTP URL; takes precedence over `SMTP_HOST`   |

\* If `SMTP_HOST`/`SMTP_URL` is not set the service runs in no-op mode:
`sendEmail` / `sendTemplate` log a warning and return `{ skipped: true }` so
local dev works without SMTP credentials. Production must set the env vars.

### Usage

```ts
import { EmailService } from "./integration/EmailService.js";

const email = new EmailService();                 // reads SMTP_* env vars
await email.sendTemplate({
  to: "kari@example.no",
  template: "reset-password",
  context: {
    username: "Kari",
    resetLink: "https://spillorama.no/reset?token=abc",
    expiresInHours: 1,
  },
});
```

### Templates

Registered in `integration/templates/index.ts`:

| Key                         | Purpose                                |
|-----------------------------|----------------------------------------|
| `verify-email`              | New-account e-mail verification        |
| `reset-password`            | Password-reset link                    |
| `bankid-expiry-reminder`    | BankID/KYC re-verification reminder    |
| `role-changed`              | Admin changed user role                |
| `kyc-approved`              | KYC moderator approved player          |
| `kyc-rejected`              | KYC moderator rejected player (m/årsak)|

Adding a new template:

1. Create `integration/templates/<name>.ts` exporting
   `<NAME>_SUBJECT`, `<NAME>_HTML`, `<NAME>_TEXT` constants.
2. Register the key in the `EMAIL_TEMPLATES` map.
3. Add tests in `EmailService.test.ts`.

### Template engine

`templates/template.ts` implements a minimal Handlebars-compatible subset:
`{{var}}`, dotted `{{a.b}}`, and `{{#if var}}…{{/if}}`. Output is HTML-escaped
by default; use `{{&raw}}` to bypass escaping (tests cover both).

The engine is deliberately small — no partials, no helpers, no else — because
the legacy templates we're porting only used this subset. If we need more
features later, swap in the real `handlebars` npm module behind the same
`renderTemplate` signature.

## EmailQueue (BIN-702)

Fire-and-forget kø med automatisk retry for transaksjonelle e-poster. Brukt
av `adminPlayers`-routeren så moderator-handlinger (KYC-approve/reject) aldri
mister en e-post hvis SMTP-serveren er midlertidig nede.

### Oppførsel

- `enqueue()` returnerer umiddelbart — endepunktet blokkerer ikke.
- En bakgrunns-loop (`runLoop()`) plukker pending-oppføringer og sender via
  `EmailService.sendTemplate()`.
- Feiler transporten, reschedulerer oppføringen med exponential backoff
  (`backoffBaseMs * 2^(attempt-1)`, default 1s).
- Etter `maxAttempts` forsøk (default 5) markeres oppføringen som `dead` og
  logges tydelig slik at ops kan plukke den opp.

### Bruk

```ts
import { EmailQueue } from "./integration/EmailQueue.js";

const emailQueue = new EmailQueue({ emailService });
emailQueue.runLoop();  // start bakgrunns-worker (1s-intervall)

// Fra f.eks. adminPlayers-routeren:
await emailQueue.enqueue({
  to: user.email,
  template: "kyc-approved",
  context: { username: user.displayName, supportEmail },
});
```

### Persistering (framtidig)

Nåværende implementasjon er in-memory. DB-persistering planlagt som BIN-703
(samme interface, `PostgresEmailQueueStore` erstatter `InMemoryEmailQueueStore`).
Inntil da: kø-oppføringer tapes ved restart — akseptert fordi KYC-mail er
idempotent og admin kan re-trigge manuelt via "Resend email"-knapp (BIN-704).

## externalGameWallet.ts

Adapter for the external-game wallet integration. Unrelated to
`EmailService` — documented elsewhere.

## Referanser

- BIN-588 (EmailService)
- BIN-582 (BankID expiry reminder)
- `docs/operations/FCM_PUSH_NOTIFICATIONS.md`
- ADR-010 (observability)
