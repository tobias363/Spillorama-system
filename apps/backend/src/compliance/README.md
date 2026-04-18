# Compliance

Gaming-regulator-facing services: audit trail, compliance suite, responsible-gaming storage hooks.

## AuditLogService (BIN-588)

Centralised, append-only audit log for admin actions, auth events, deposits,
withdraws, role changes, and other compliance-relevant state transitions.

Replaces the legacy pattern where individual controllers logged to
`console.log` and wrote ad-hoc rows to their own tables.

### Shape

```ts
await audit.record({
  actorId: "admin-1",            // app_users.id, or null for SYSTEM
  actorType: "ADMIN",            // USER | ADMIN | HALL_OPERATOR | SUPPORT | PLAYER | SYSTEM | EXTERNAL
  action: "deposit.approve",     // stable dotted verb
  resource: "deposit",           // entity kind
  resourceId: "dep-99",
  details: { amount: 500 },      // JSON payload; PII-redacted at write time
  ipAddress: req.ip,
  userAgent: req.headers["user-agent"],
});
```

### Storage

- `app_audit_log` table (migration `20260418160000_app_audit_log.sql`)
- `PostgresAuditLogStore` — production-backed; fire-and-forget writes (DB
  outage logs a warning but never throws, matching `ChatMessageStore`
  from BIN-516)
- `InMemoryAuditLogStore` — tests + dev fallback when
  `APP_PG_CONNECTION_STRING` is unset

### PII redaction

`redactDetails()` walks the payload before insert and replaces sensitive
values with `[REDACTED]`. Blocklist mirrors the pino redaction list in
`util/logger.ts`:

```
password, token, accessToken, refreshToken, sessionToken, secret,
nationalId, ssn, personnummer, fodselsnummer,
cardNumber, cvv, cvc, pan,
authorization
```

Case-insensitive on keys; recurses into nested objects and arrays with a
depth cap so a cyclic structure can't hang the writer.

### Wire-up

Planned follow-ups (separate PRs — overlaps with Agent 1/Agent 2 touch
points):

- [ ] Auth middleware: emit `auth.login` / `auth.logout` / `auth.failed` on
      every session event (overlaps `apps/backend/src/middleware/` — coordinate).
- [ ] Admin actions: emit `user.role.change`, `hall.update`,
      `game.settings.change` from admin routes (Agent 1 owns
      `src/routes/admin.ts`).
- [ ] Deposit/withdraw: emit `deposit.complete` / `withdraw.complete` after
      BIN-586 lands (Agent 1 owns `src/payments/`).

See `AuditLogService.test.ts` for examples of each action type.
