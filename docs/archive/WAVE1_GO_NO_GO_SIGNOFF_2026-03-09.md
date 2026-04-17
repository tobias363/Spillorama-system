# Wave 1 Go/No-Go Sign-Off (Pilot Hall)

Document ID: `W1-SIGNOFF-2026-03-09`
Date created: `2026-03-04`
Timezone: `Europe/Oslo (CET)`

Assumed pilot window:

- `T0 start`: 2026-03-09 18:00 CET
- `T+24h checkpoint`: 2026-03-10 18:00 CET
- `Wave 1 final review`: 2026-03-16 10:00 CET

Pilot scope:

- Wave: `Wave 1 (1 hall)`
- Pilot hall ID: `<fill: hall_id>`
- Pilot hall name: `<fill: hall_name>`
- Release tag: `<fill: release_tag>`
- Release commit: `<fill: commit_sha>`

## 1. Contact Chain (Required Before T-24h)

| Role | Primary | Secondary | Phone | Confirmed |
| --- | --- | --- | --- | --- |
| Hall Leader | `<fill>` | `<fill>` | `<fill>` | `[ ]` |
| Incident Commander | `<fill>` | `<fill>` | `<fill>` | `[ ]` |
| Compliance Owner | `<fill>` | `<fill>` | `<fill>` | `[ ]` |
| Backend On-Call | `<fill>` | `<fill>` | `<fill>` | `[ ]` |
| Payment On-Call | `<fill>` | `<fill>` | `<fill>` | `[ ]` |
| Hall Operator (L1) | `<fill>` | `<fill>` | `<fill>` | `[ ]` |

## 2. Preflight Gate (T-24h To T-10m)

Technical/compliance gates:

- `[x]` `npm --prefix backend run test:compliance` green (`6/6`)
- `[x]` `npm --prefix backend run test` green (`30/30`)
- `[x]` `npm --prefix backend run check` green
- `[x]` `npm --prefix backend run build` green
- `[x]` `P0_SIGNOFF.md` approved for pilot scope
- `[x]` `HALL_PILOT_RUNBOOK.md` available and distributed
- `[x]` `ROLLOUT_PLAN_1_3_20.md` available and distributed
- `[ ]` Branch protection enforces `Compliance Gate` as required check
- `[ ]` Pilot hall + terminals verified active in admin config
- `[ ]` House accounts funded for pilot hall payouts/distribution
- `[ ]` Swedbank callback URL and payment flow verified in pilot environment

## 3. T-10m Go/No-Go Decision

Decision timestamp: `<fill: YYYY-MM-DD HH:MM CET>`

Go criteria (all must be true):

- `[ ]` 0 known compliance-blocking defects
- `[ ]` 0 unresolved `SEV-1`
- `[ ]` Contact chain fully staffed and confirmed
- `[ ]` Rollback owner and communication channel confirmed

Decision:

- `[ ]` `GO` -> open pilot hall at `T0`
- `[ ]` `NO-GO` -> hold release, execute no-go handling in runbook

Reason/comment:

`<fill>`

## 4. Live Checkpoints

### T+1h checkpoint

Timestamp: `<fill>`

- `[ ]` Health endpoint stable
- `[ ]` No payout anomalies
- `[ ]` No compliance bypass observed
- `[ ]` Error rate acceptable
- `[ ]` No-go trigger absent

Notes:

`<fill>`

### T+24h checkpoint

Timestamp: `<fill>`

- `[ ]` Daily report JSON generated
- `[ ]` Daily report CSV generated
- `[ ]` Ledger separation (`hall/game/channel`) verified
- `[ ]` Payout audit chain reviewed
- `[ ]` No unresolved `SEV-1`

Decision:

- `[ ]` Continue Wave 1
- `[ ]` Trigger rollback / freeze

Notes:

`<fill>`

## 5. Wave 1 Final Decision (End Of Stability Window)

Review timestamp: `<fill>`

Wave 1 success criteria:

- `[ ]` 0 compliance breaches during wave
- `[ ]` 0 incorrect payouts
- `[ ]` Fewer than 3 `SEV-2`, all closed
- `[ ]` Daily reports reconcile with ledger all pilot days
- `[ ]` Evidence package archived

Final decision:

- `[ ]` `GO` to Wave 2 (expand to 3 halls)
- `[ ]` `NO-GO` (stabilize and re-run Wave 1)

Decision summary:

`<fill>`

## 6. Evidence Package Checklist

- `[ ]` CI run links (`check`, `build`, `test:compliance`)
- `[ ]` Payout audit export
- `[ ]` Ledger export (`hall/game/channel`)
- `[ ]` Daily report JSON
- `[ ]` Daily report CSV
- `[ ]` Incident timeline log
- `[ ]` This signed go/no-go document

Archive location:

`<fill: path or ticket reference>`

## 7. Signatures

Halleder:

- Name: `<fill>`
- Date/time: `<fill>`
- Signature: `<fill>`

Incident Commander:

- Name: `<fill>`
- Date/time: `<fill>`
- Signature: `<fill>`

Compliance Owner:

- Name: `<fill>`
- Date/time: `<fill>`
- Signature: `<fill>`

