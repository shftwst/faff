# PRD — stall: Community Marketplace

- **Container:** stall
- **Status:** Draft
- **Date:** 2026-07-20
- **Mode:** authored

## Problem / objective

Deliver a peer-to-peer marketplace for a local community: members list items with photos, browse and search, message each other about listings, make offers, and settle in platform credits held in escrow until both sides confirm — then review each other. No real money moves; the credits ledger still has to behave like money. This is an application, not a feature: its value arrives in stages — a listings board is useful before search exists, search before messaging, messaging before offers — and the brief requires it to ship that way: as a sequence of releases, each deployed and usable, not as one final delivery.

## Goals & success metrics

- Each release is a product someone could use that week, not scaffolding for a later one.
- The credits ledger is trusted absolutely: zero-sum including escrow, no negative balances, no double-spend — under concurrency.
- A member can never read another member's messages or act on another member's listings, even against the API directly.

## Non-goals

- Real payments, payouts, or currency conversion — credits are the only unit.
- Shipping, logistics, or geographic search radius.
- Recommendations, promotion, or ranking beyond search relevance and recency.
- Admin/moderation console — a per-listing report flag that hides at a stated threshold suffices.
- Native apps.

## Users

Community members listing, buying, messaging, and reviewing; evaluators exercising the API and harness.

## Requirements

- Sign-in is GitHub OAuth (GitHub is available); no passwords collected or stored; each member has a public profile showing display name, active listings, and received reviews.
- Listings: title, description, up to a stated number of photos (stored in object storage — R2 is available), asking price in credits, and a lifecycle of active → reserved → completed, or withdrawn; only the owner can edit or withdraw, enforced server-side.
- Browse and search: full-text search over titles and descriptions, filters by category and price range, newest first by default.
- Messaging: per-listing private threads between an interested member and the listing owner; participants only — membership checks enforced server-side on every read and write.
- Offers: a member offers at or below asking price; the owner accepts or declines; acceptance reserves the listing and opens the escrow.
- Credits ledger: every account is seeded with a stated starting balance; all amounts are integer credits; on offer acceptance the buyer's credits move to escrow; on mutual completion confirmation escrow releases to the seller; on cancellation before completion escrow refunds the buyer. The ledger — all member balances plus escrow — sums to exactly the total seeded at all times; no balance goes negative; of concurrent acceptances that would overdraw a buyer's balance, only those the balance covers succeed.
- Reviews: each party may leave one review per completed transaction, only after completion, immutable once posted.
- Incremental delivery, as a requirement of the brief: the product ships as at least three releases, each deployed to the public instance when made, each independently usable for a coherent slice of the product, and each recorded in a committed release log stating its scope, its tagged commit, its deployment, and which acceptance criteria it brought to passing. Criteria, once passing in a release, stay passing in every later one.
- A verification harness: an authorization probe (a second authenticated member attempts direct API reads of others' message threads and mutations of others' listings and offers), and a ledger property runner applying seeded randomized sequences of offers, acceptances, cancellations, completions, and concurrent double-spend attempts — asserting the zero-sum invariant, non-negativity, and escrow lifecycle correctness after every operation.
- Publicly deployed with automated deploys. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given a visitor, When they sign in, Then authentication MUST be GitHub OAuth and no password may be collected or stored.
- Given an authenticated member, When they attempt to read a message thread they are not party to, or edit, withdraw, or accept offers on a listing they do not own, via the API directly, Then the request MUST be refused.
- Given a search query, When results are returned, Then every result MUST match the query and active filters, ordered newest first by default.
- Given an offer at or below asking price, When the owner accepts it, Then the listing MUST become reserved and the offered credits MUST move from the buyer's balance to escrow atomically.
- Given concurrent acceptances that together exceed a buyer's balance, When they resolve, Then only acceptances the balance covers may succeed and the balance MUST NOT go negative.
- Given a reserved listing, When both parties confirm completion, Then escrow MUST release to the seller and the listing MUST become completed.
- Given a reservation cancelled before completion, Then escrow MUST refund the buyer in full and the listing MUST return to active.
- At every harness checkpoint, the sum of all balances plus escrow MUST equal the total seeded credits exactly.
- Given a transaction not yet completed, When a party attempts to review, Then it MUST be refused; Given a completed transaction, Then each party may post exactly one review and posted reviews MUST be immutable.
- Given a listing reported by distinct members at the stated threshold, Then it MUST be hidden from browse and search.
- The committed release log MUST record at least three releases, each with its scope, tagged commit, deployment, and the acceptance criteria it brought to passing.
- Given successive releases in the log, Then each release's passing-criteria set MUST contain the previous release's, and the final release's MUST be the full set.
- Given any recorded release, Then its tagged commit and its deployment MUST date from when the release was made, evidenced by the repository and deploy automation history — not retroactively assembled.
- The repository MUST include the harness (authorization probe and ledger property runner), and running it MUST report per-check results.
- The service MUST be publicly deployed with automated deploys and no manual deploy step.

## Evaluator note

Two instruments matter here. The ledger property runner and authorization probe carry the correctness criteria, exactly as in briefs where inspection flatters the code — residual duties: the runner's sequences are seeded-random and its concurrent double-spends genuinely overlap; the probe authenticates as a real second member. The release log is the second instrument, and it is verified from history, not narrative: tags, CI runs, and deploy records must show each release existed and deployed when the log says it did, and that each release's claimed criteria actually passed at that tag — spot-check by building one. A log written in one sitting at the end fails the brief regardless of how the final product scores. What makes a release slice "coherent" is a human judgement; the monotone criteria ladder is the gate.

## Open questions

- Category taxonomy, photo count and size caps, the seeded balance, and the report-hide threshold are left to implementation — stated in the UI or README.
- Whether declined or superseded offers notify anyone is left to implementation (no email — any notification is in-app).
- Search implementation (database full-text or otherwise) is left to implementation.
- Escrow representation (separate account, held state on the ledger row, or otherwise) is left to implementation — the zero-sum invariant must hold either way.
- The release slicing itself is left to implementation; the log and the criteria ladder are the contract.
