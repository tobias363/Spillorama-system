# Legacy admin-bkp — dropped pages (PR-B6, BIN-664)

This directory archives three legacy admin HTML templates that were
intentionally **not** ported to `apps/admin-web` as part of PR-B6.

Moved here 2026-04-19 as part of the PR-B6 scope-reduction (12 → 5 pages).
Originals were kept in `legacy/unity-backend/App/Views/` until the
post-pilot legacy-takedown sweep lands — this archive is the authoritative
"this was considered and dropped" record.

## Files

| Archive path | Legacy source | Reason for drop |
|---|---|---|
| `security.html` | `legacy/unity-backend/App/Views/security/security.html` | Poker "Stacks Table" (small/big-blind, min/max-players). Leftover from the original Unity-poker-fork. **Spillorama is databingo, not poker.** |
| `securityList.html` | `legacy/unity-backend/App/Views/security/securityList.html` | Same — poker cashgames-table with Min/Max-stack columns. References `/cashgames/getCashGamePoker/` + `/cashgames/addBlinds`, both poker-specific endpoints. |
| `riskCountry-add.html` | `legacy/unity-backend/App/Views/riskCountry/add.html` | **Misnamed file.** Contains an *agent-add form* (fields: name, email, phone, halls, password), NOT a risk-country-add form. The legacy risk-country add-flow actually uses an inline modal inside `riskCountry/riskCountry.html`. PR-B6 mirrors that modal pattern. |

## What IS ported in PR-B6

| Legacy path | Modern path |
|---|---|
| `security/blockedIP.html` | `apps/admin-web/src/pages/security/BlockedIpsPage.ts` |
| `security/addBlockedIP.html` | `apps/admin-web/src/pages/security/AddBlockedIpPage.ts` (modal) |
| `riskCountry/riskCountry.html` | `apps/admin-web/src/pages/riskCountry/RiskCountryPage.ts` |
| `LeaderboardManagement/leaderboard.html` | `apps/admin-web/src/pages/leaderboard/LeaderboardPage.ts` (placeholder) |
| `LeaderboardManagement/leaderboardAdd.html` | `apps/admin-web/src/pages/leaderboard/AddLeaderboardPage.ts` (placeholder) |

## What was dropped to a follow-up issue

- Legacy `payment/` (4 files): `deposit.html`, `deposit-swedbankpay.html`,
  `swedbank-payment-response.html`, `verifonePaymentRes.html`. All four
  are player-facing Unity webview deeplink-pages, not admin-views — they
  belong to `apps/web/` (player-UI), not `apps/admin-web/`. Admin
  monitoring of Swedbank intents is tracked as **BIN-669** (post-pilot).

## Not deleted

Originals in `legacy/unity-backend/App/Views/` remain untouched so the
Unity-backend server-rendering keeps working until the whole legacy
takedown ships. This `docs/archive/legacy-admin-bkp/` directory is the
admin-web-side record that these files were reviewed and deliberately
excluded from the port.

## References

- Linear: [BIN-664](https://linear.app/bingosystem/issue/BIN-664)
- Follow-up: [BIN-668](https://linear.app/bingosystem/issue/BIN-668) (Leaderboard tier CRUD backend)
- Follow-up: [BIN-669](https://linear.app/bingosystem/issue/BIN-669) (Swedbank admin-monitor post-pilot)
- PR plan: `PR-B6-PLAN.md` §1 + §2.5
