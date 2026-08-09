# PRD — recall: Spaced-Repetition Learning

- **Container:** recall
- **Status:** Draft
- **Date:** 2026-07-20
- **Mode:** authored

## Problem / objective

Deliver a spaced-repetition study platform: members build decks of cards, review the ones due today, grade themselves, and a scheduler decides when each card returns — the algorithm is the product's engine, and it must be deterministic, documented, and pinned by a corpus. Around that engine the product grows in stages: solo decks and daily review are a complete product before sharing exists, sharing before import, import before statistics. The brief requires shipping in that spirit — a sequence of releases, each deployed and usable — with the engine held to corpus exactness from the first release that contains it.

## Goals & success metrics

- Each release is a study tool someone could adopt that week.
- The schedule is deterministic and explainable: the same review history always produces the same next-due dates, exactly.
- "Due today" is trustworthy across timezones and clock changes — no card silently early, late, or lost.

## Non-goals

- Rich media on cards — front and back are text (markdown allowed, stored as authored).
- Collaborative deck editing — sharing is read-only publication.
- An engine-recommended "optimal" algorithm — the scheduler must be documented and deterministic, not novel.
- Offline study or native apps.
- Gamification: streak rewards, leaderboards, badges.

## Users

Learners building and reviewing decks; deck authors publishing for others; evaluators exercising the corpus and API.

## Requirements

- Sign-in is GitHub OAuth (GitHub is available); no passwords collected or stored; decks are private to their owner unless published.
- Decks contain cards (text front and back); cards can be added, edited, and deleted; editing a card's text does not alter its schedule.
- Review flow: a session presents due cards one at a time — front, reveal, grade on a four-step scale (again / hard / good / easy); grading records an immutable review event and schedules the card's next due date.
- The scheduling algorithm is implementation's choice from the established spaced-repetition family, documented in the README precisely enough to compute next-due dates by hand — parameters included — and deterministic: identical review histories yield identical schedules, exactly.
- A committed scheduler corpus: review histories (sequences of grades with timestamps) with expected resulting intervals and due dates, covering each grade, lapses (again after long intervals), the new-card introduction steps, and boundary cases; a headless harness evaluates every case through the real scheduler and reports per-case pass/fail.
- New cards enter review at a stated per-day cap so a large freshly-imported deck doesn't flood day one.
- Due-ness is computed against the member's day boundary in their IANA timezone (stated per member, changeable): a card due "today" appears in today's queue, timezone changes and daylight-saving transitions never make a due card skip a day or appear twice — computed via the tz database, not fixed offsets.
- Review history is append-only; per-deck statistics (reviews per day, due forecast, success rate) are exactly consistent with replaying the history — the harness recomputes from raw events and compares.
- Publishing: an owner publishes a deck to an unguessable read-only link (identifiers carry at least 128 bits of randomness); visitors see cards but never the owner's review history; published decks can be unpublished.
- Import: a signed-in member imports a published deck as their own copy — content copied, schedules fresh; subsequent edits and reviews on either side never affect the other.
- Everything persists in a database; restarts and redeploys lose nothing.
- Incremental delivery, as a requirement of the brief: the product ships as at least three releases, each deployed to the public instance when made, each independently usable for a coherent slice of the product, and each recorded in a committed release log stating its scope, its tagged commit, its deployment, and which acceptance criteria it brought to passing. Criteria, once passing in a release, stay passing in every later one.
- A verification harness beyond the corpus: replay-determinism (an identical history replayed from scratch yields the identical schedule), statistics-vs-replay agreement, day-boundary cases across a timezone change and a DST transition, the new-card cap, import isolation (reviews on a copy never touch the source), and an authorization probe (a second member attempting direct API reads of private decks and review histories).
- Publicly deployed with automated deploys. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given a visitor, When they sign in, Then authentication MUST be GitHub OAuth and no password may be collected or stored.
- Given an authenticated member, When they request another member's private deck or review history via the API directly, Then the request MUST be refused.
- Given the committed corpus, When the harness evaluates every case through the real scheduler, Then every expected interval and due date MUST match exactly.
- Given two identical review histories, When schedules are computed, Then they MUST be identical.
- Given a card graded, Then an immutable review event MUST be recorded and the next due date MUST follow the documented algorithm.
- Given a card's text is edited, Then its schedule MUST be unchanged.
- Given more new cards than the stated per-day cap, Then at most the cap may be introduced per day.
- Given a member's timezone and a card due on a given local day, Then it MUST appear in that day's queue; and Given a DST transition or a member timezone change, Then no due card may skip a day or appear in two days' queues.
- Given per-deck statistics, When the harness recomputes them from raw review events, Then they MUST agree exactly.
- Given a published deck link, When opened, Then cards MUST be visible and the owner's review history MUST NOT be; published identifiers MUST contain at least 128 bits of randomness.
- Given an imported deck, When either copy is edited or reviewed thereafter, Then the other MUST be unaffected.
- Given an unpublished deck, When its former link is opened, Then it MUST be gone; existing imports MUST be unaffected.
- Given a restart or redeploy, Then decks, cards, schedules, and histories MUST be intact.
- The committed release log MUST record at least three releases, each with its scope, tagged commit, deployment, and the acceptance criteria it brought to passing.
- Given successive releases in the log, Then each release's passing-criteria set MUST contain the previous release's, and the final release's MUST be the full set.
- Given any recorded release, Then its tagged commit and deployment MUST date from when the release was made, evidenced by repository and deploy automation history.
- The repository MUST include the corpus and harness, and running them MUST report per-case and per-check results.
- The service MUST be publicly deployed with automated deploys and no manual deploy step.

## Evaluator note

The corpus makes the engine mechanical, with the standard residual duty: confirm it evaluates through the product's real scheduler, not a reimplementation inside the harness — and extend it with a history the authors never saw, since a correctly documented algorithm passes cases derived from its own README. The day-boundary criteria are the quiet trap: they live in time and timezone, so the harness cases — not inspection — carry them. The release log is verified from history (tags, CI, deploy records), with one release spot-checked by building it; a log assembled at the end fails the brief. Whether the review flow is pleasant to study with is a human judgement, not a gate.

## Open questions

- The specific algorithm, its parameters, and the new-card cap are left to implementation — documented and pinned by the corpus.
- Whether a session caps total reviews or runs the full due queue is left to implementation.
- Markdown rendering extent on cards is left to implementation.
- Statistics beyond the required three are left to implementation; whatever is shown must agree with replay.
- The release slicing itself is left to implementation; the log and the criteria ladder are the contract.
