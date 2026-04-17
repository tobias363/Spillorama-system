# @spillorama/shared-types

TypeScript types and runtime schemas for the Spillorama bingo system wire protocol.

Both the backend (`apps/backend`) and the game client (`packages/game-client`) import from this package to stay in sync on the shape of Socket.IO and REST payloads.

## What's here

| File | Purpose |
| --- | --- |
| `src/game.ts` | Domain types (`Player`, `Ticket`, `ClaimRecord`, `GameSnapshot`, `RoomSnapshot`). Compile-time only. |
| `src/socket-events.ts` | Socket.IO event names (`SocketEvents`) and payload types. |
| `src/schemas.ts` | Zod runtime schemas (BIN-545). Paired with `z.infer<>`-derived types. |
| `src/api.ts` | REST response shapes. Compile-time only. |
| `fixtures/*.json` | Frozen payload instances — baseline, edge, stress — validated by `__tests__/wireContract.test.ts`. |

## Runtime vs. compile-time (BIN-545)

Most types in this package are compile-time only — they vanish after `tsc`. But three of the highest-risk payloads now have **runtime-validated Zod schemas**:

- `RoomUpdatePayloadSchema` (room:update broadcast)
- `DrawNewPayloadSchema` (draw:new broadcast)
- `ClaimSubmitPayloadSchema` (claim:submit inbound)

Each schema exports both the schema and the inferred type:

```ts
import { ClaimSubmitPayloadSchema, type ClaimSubmitPayload } from "@spillorama/shared-types/socket-events";

// At a trust boundary (incoming socket event), validate:
const parsed = ClaimSubmitPayloadSchema.safeParse(rawPayload);
if (!parsed.success) {
  // reject — don't act on an untrusted payload
  return;
}
// parsed.data is typed as ClaimSubmitPayload
```

The backend wires this in `apps/backend/src/sockets/gameEvents.ts` on the `claim:submit` handler (see BIN-545 for the rationale — claim payloads change wallet state, so they must not be trusted without validation).

## Fixtures

Each Zod schema has three JSON fixtures in `fixtures/`:

- **`<payload>.baseline.json`** — minimal valid instance (only required fields, empty optional collections). Catches "did we accidentally mark a required field optional?"
- **`<payload>.edge.json`** — realistic-but-sparse (a running game, no claims yet, optional fields set to unusual-but-valid values). Catches subtle optionality bugs.
- **`<payload>.stress.json`** — fully populated with multiple players, patterns, claims, game history. Catches over-narrow unions.

`__tests__/wireContract.test.ts` loads every fixture and asserts it parses against the paired schema. If you change a schema in a way that rejects a fixture, you have three choices:
1. The fixture is obsolete — update it (confirming the change is intentional).
2. The schema is wrong — revert the schema change.
3. The schema is right and the fixture was always invalid — fix it and note *why* in the PR description.

The negative tests assert the schemas REJECT known-bad payloads (wrong enum, missing required field, non-integer where integer is required). These guard against the schemas accidentally becoming too permissive.

## Scripts

```bash
npm run build    # compile src/ → dist/ (tsc)
npm run check    # type-check without emit
npm run test     # run wire-contract tests (node:test + tsx)
```

`npm run test` is runnable standalone from this package; CI invokes it via the root workspace-aware install.

## Adding a new schema

1. Build the Zod schema in `src/schemas.ts`. Prefer `z.object(...)` over `z.record(...)` when keys are known.
2. Re-export from `src/socket-events.ts` so consumers get it via `@spillorama/shared-types/socket-events`.
3. If the payload replaces an existing `interface`, change the interface to a `type X = z.infer<typeof XSchema>`. Consumers keep working unchanged.
4. Add three fixtures (`baseline`, `edge`, `stress`) to `fixtures/`.
5. Add the schema to the `cases` array in `__tests__/wireContract.test.ts`.
6. Wire `.safeParse(...)` at the trust boundary where the payload first enters trusted code (usually a socket or REST handler).

## Why only three schemas so far (BIN-545)

Full coverage of every interface is a larger effort — and most compile-time interfaces are fine as-is because the backend controls both ends of the wire. The three chosen payloads are the ones where **schema mismatch causes silent failures that are expensive to debug**:

- `room:update` has many consumers (lobby, play screen, admin) — a schema drift between backend and client silently corrupts UI state.
- `draw:new` is the per-draw broadcast — mismatches have the highest blast radius.
- `claim:submit` is the only client-originated payload that moves wallet money — validation failures on this handler are a direct exploit surface.

Broader rollout is tracked as follow-up issues.
