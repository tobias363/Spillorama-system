# Integration

External-service adapters used by the backend.

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

## externalGameWallet.ts

Adapter for the external-game wallet integration. Unrelated to
`EmailService` — documented elsewhere.
