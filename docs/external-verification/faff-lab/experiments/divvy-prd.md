# PRD — divvy: Group Expense Splitting

- **Container:** divvy
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver a group expense splitter: sign in, make a group, invite friends, log who paid what for whom, and always know who owes whom — with a settlement plan that clears the slate in the fewest payments. The hard parts are the ones that don't demo well: real OAuth, server-side authorization boundaries between groups, schema migrations, and money arithmetic that never loses a penny.

## Goals & success metrics

- Balances are trusted absolutely — every split is exact, every group sums to zero, always.
- A member can never see or touch another group's data, even by talking to the API directly.
- Settling up is obvious: a short list of payments that zeroes everyone out.

## Non-goals

- Multi-currency groups — one currency per group, chosen at creation.
- Receipts, attachments, or expense photos.
- Recurring expenses.
- Notifications or email of any kind.
- Cross-group debt simplification.

## Users

Friends, households, and trips splitting shared costs.

## Requirements

- Sign-in is GitHub OAuth (GitHub is available); the service never collects or stores passwords.
- Groups with invite links that expire and can be revoked; membership checks are enforced server-side on every read and write.
- Expenses: payer, amount, description, date, and a split across chosen members — equally or by explicit shares; shares always sum exactly to the amount under a documented deterministic remainder rule.
- All money is stored and computed as integer minor units end-to-end; floating-point never touches an amount.
- Expenses can be edited and deleted; balances recompute immediately.
- Settlements: a member records a payment to another member; balances update.
- A balances view: each member's net position, plus a settlement plan of at most members−1 payments whose application zeroes every balance exactly.
- Group data persists in a database with schema migrations that run automatically on deploy.
- A verification harness with two parts: a property runner applying seeded randomized sequences of expenses, edits, deletions, and settlements while asserting the zero-sum invariant, split exactness, and settlement-plan correctness after every operation; and an authorization probe in which a second authenticated user attempts direct API reads and writes against a group they don't belong to.
- Publicly deployed with automated deploys. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given a visitor, When they sign in, Then authentication MUST be GitHub OAuth and no password may be collected or stored.
- Given an authenticated non-member, When they request or mutate a group's data via the API directly, Then the request MUST be refused.
- Given a revoked or expired invite link, When redeemed, Then joining MUST be refused.
- Given an expense of amount T split equally among k members, Then the shares MUST be integer minor units summing exactly to T under the documented remainder rule.
- Given any sequence of expenses, edits, deletions, and settlements, Then the sum of all members' net balances in the group MUST remain exactly zero.
- Given a group's balances, When the settlement plan is shown, Then it MUST contain at most members−1 payments and applying them MUST zero every balance exactly.
- Amounts MUST be stored and computed as integer minor units; floating-point representations of money MUST NOT appear in storage or arithmetic.
- Given an expense is edited or deleted, Then every affected balance MUST reflect the recomputation.
- Schema migrations MUST exist and run automatically on deploy, with no manual migration step.
- The repository MUST include the harness (property runner and authorization probe), and running it MUST report per-check results.
- Given the authorization probe runs, Then every cross-group read and write attempt MUST be refused.
- Given a service restart or redeploy, Then groups, expenses, and balances MUST be intact.
- The service MUST be publicly deployed with automated deploys and no manual deploy step.

## Evaluator note

The criteria are objective, and the two hardest — the zero-sum invariant and the authorization boundary — are exactly the ones inspection is worst at: both look correct in code far more often than they are correct. The property runner and the probe make them mechanical; the evaluator's residual duties are confirming the runner's sequences are genuinely randomized (seeded, so failures reproduce) and that the probe authenticates as a real second user rather than forging its own credentials. The no-floating-point criterion is checkable by inspecting the storage schema and arithmetic sites. Whether balances are *legible* is a human judgement, not a gate.

## Open questions

- Whether invite links are single- or multi-use within their lifetime is left to implementation.
- The offered currency list and the remainder-distribution rule (largest-remainder or otherwise) are left to implementation — documented, and pinned by harness cases.
- Settlement-plan tie-breaking between equally short plans is left to implementation.
- Group archival/deletion semantics are left to implementation.
