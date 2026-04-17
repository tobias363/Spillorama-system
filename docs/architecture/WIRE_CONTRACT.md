# Wire Contract (BIN-527)

**Authoritative source:** [`packages/shared-types/src/schemas.ts`](../../packages/shared-types/src/schemas.ts)
**Linear:** [BIN-527](https://linear.app/bingosystem/issue/BIN-527) (builds on [BIN-545](https://linear.app/bingosystem/issue/BIN-545))
**Last updated:** 2026-04-17

Every payload that crosses the Socket.IO boundary between `apps/backend/` and `packages/game-client/` (and the legacy Unity client via the JSON-Schema export) is modeled as a Zod schema. Tests on all three sides of the contract (schema unit tests, backend-generated payloads, client-consumed payloads) run against a shared fixture bank so drift between any two sides fails CI.

## Covered events

| Event | Schema | Direction |
| --- | --- | --- |
| `room:update` | `RoomUpdatePayloadSchema` | server → client (broadcast) |
| `draw:new` | `DrawNewPayloadSchema` | server → client (broadcast) |
| `claim:submit` | `ClaimSubmitPayloadSchema` | client → server (ack) |
| `ticket:replace` | `TicketReplacePayloadSchema` | client → server (ack) |
| `bet:arm` | `BetArmPayloadSchema` | client → server (ack) |
| `ticket:mark` | `TicketMarkPayloadSchema` | client → server (ack) |
| `pattern:won` | `PatternWonPayloadSchema` | server → client (broadcast) |
| `chat:message` | `ChatMessageSchema` | server → client (broadcast) |
| `minigame:activated` | `MiniGameActivatedPayloadSchema` | server → client (to winner) |
| `minigame:play` ack | `MiniGamePlayResultSchema` | server → client (ack) |

Payloads not listed above are still compile-time typed but not runtime-validated. Growing the covered surface is tracked in follow-up issues as the team finds the next most painful drift.

## Fixture bank

Fixtures live in [`packages/shared-types/fixtures/`](../../packages/shared-types/fixtures/). Naming: `<event>.<variant>.json`, where `variant` ∈ `{baseline, edge, stress}`.

- **baseline** — minimal valid instance. Only required fields.
- **edge** — realistic sparse instance. A running game with no claims yet; optional fields deliberately mixed in/out of the default.
- **stress** — fully populated. Multiple players, patterns, claims, gameHistory. Catches "did we make a union too narrow?" regressions.

## Tests that enforce the contract

Three independent test suites run the same fixture bank. If the Zod schema changes, each suite fails fast on any fixture that no longer parses:

1. **Schema self-test** — [`packages/shared-types/__tests__/wireContract.test.ts`](../../packages/shared-types/__tests__/wireContract.test.ts)
   Loads every fixture, runs `schema.parse()`, asserts success. Also negative tests to guard against over-permissive schemas.
2. **Backend generation test** — [`apps/backend/src/sockets/__tests__/wireContract.test.ts`](../../apps/backend/src/sockets/__tests__/wireContract.test.ts)
   Re-runs the fixture parse inside the backend's TypeScript resolution, *plus* drives a real `createTestServer` through `room:create → bet:arm → game:start → draw:next → claim:submit → chat:send` and validates every emitted broadcast against its schema. Catches drift between the backend's payload builder and the declared contract.
3. **Client consumption test** — [`packages/game-client/src/bridge/__tests__/wireContract.test.ts`](../../packages/game-client/src/bridge/__tests__/wireContract.test.ts)
   Feeds every fixture to `GameBridge` via a mock socket. Asserts the bridge doesn't throw, and (for `pattern:won`, `chat:message`) that the high-level event re-emitted to game controllers matches the input.

All three run in CI as part of the normal `npm run test` on their respective packages. No contract test is a separate CI job — failure in any one of them blocks the PR.

## Legacy Unity bridge — JSON-Schema export

`packages/shared-types/scripts/export-json-schemas.ts` converts each Zod schema to JSON-Schema via `zod-to-json-schema` and writes them to [`packages/shared-types/generated/json-schemas/`](../../packages/shared-types/generated/json-schemas/). The legacy C# bridge can validate incoming payloads against these files without pulling in the TypeScript toolchain.

Regenerate on every schema change:

```bash
npm -w @spillorama/shared-types run schema:export
```

The generated files are committed so downstream consumers (Unity client, C# validators, documentation tooling) don't need Node to consume the contract. Do **not** hand-edit the output — the Zod schema is always the source of truth.

## PR gate: how to change the wire contract

When a change to a covered payload is needed:

1. Edit the Zod schema in `packages/shared-types/src/schemas.ts`.
2. Update every affected fixture in `packages/shared-types/fixtures/` in the **same PR**. The three test suites above will block merge until the fixtures match the new schema.
3. Regenerate `packages/shared-types/generated/json-schemas/*` via `npm -w @spillorama/shared-types run schema:export`. Commit the output.
4. Mention "wire-contract change" in the PR title so reviewers know to inspect the schema diff before approving.

A schema loosening (e.g. making a required field optional) is usually safe on one side (consumer) but can break the other (producer). Add a stress fixture that exercises the new allowed state to catch that class of regression.

A schema tightening (adding a new required field, narrowing an enum) is **always** breaking for clients already in production. Back-fill the field on the producer side first, deploy, wait a full release cycle, then tighten.

## Follow-ups

- **Lobby + auth endpoints** are currently REST, not Socket.IO. Once they share types with the wire contract (e.g. `PublicAppUser`), extend this doc and the fixture bank to cover them.
- **Wire-kontrakt CI between Unity and backend** is not automated — the generated JSON-Schema is exported but the C# side still hand-rolls its validation. Closing that loop is tracked separately once the Unity-client cutover timeline is locked in.
