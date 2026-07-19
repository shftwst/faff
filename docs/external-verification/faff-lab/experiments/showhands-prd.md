# PRD — showhands: Live Audience Polling

- **Container:** showhands
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver a live polling app: a presenter opens a room, the audience joins with a short code on their phones, votes on multiple-choice polls, and the presenter's screen updates as the votes land. The hard part is the realtime spine: pushed updates, reconnection, vote integrity under concurrency, and a server restart mid-poll that loses nothing.

## Goals & success metrics

- Results move on the presenter's screen as the audience votes — no refreshing, no perceptible lag.
- A tally is always exactly the audience's latest intent: no double counts, no lost votes.
- Flaky phone connections are a non-event.

## Non-goals

- Accounts — presenters and audience are anonymous.
- Free-text or quiz-scored questions — multiple choice only.
- Historical analytics or export.
- Moderation or kick controls.
- Native apps.

## Users

A presenter running polls from one screen; an audience voting from their phones.

## Requirements

- A presenter creates a room and receives a short human-typeable join code and audience link, plus a separate presenter URL; presenter controls are never reachable from the join code or audience link.
- A room runs polls sequentially: each has a question and 2–6 options; the presenter opens and closes voting per poll.
- Audience members join with the code — no sign-up; each holds a session token; one active vote per member per poll, changeable while the poll is open.
- Vote integrity is server-enforced: duplicate or replayed submissions cannot double-count.
- Poll state and tallies are pushed to clients with no user-initiated refresh; the transport (WebSockets, SSE, or otherwise) is implementation's choice.
- A dropped connection recovers to the current poll state with the member's standing vote intact.
- Rooms, polls, and votes persist in a database; a server restart mid-poll loses no recorded vote, and clients recover on reconnect.
- Presenter view: live counts and percentages per option; a closed poll's tally is frozen.
- A verification harness: N scripted concurrent audience members vote, some change votes, some disconnect and reconnect, and the run asserts final tallies exactly equal the script's final intent.
- Publicly deployed with automated deploys; Fly.io suits the persistent-connection server, Turso the database. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given a room is created, Then a join code, an audience link, and a separate presenter URL MUST be issued.
- Given only the join code or audience link, When used, Then presenter controls MUST NOT be reachable.
- Given an open poll, When an audience member votes, Then the presenter's tally MUST update without any user-initiated refresh.
- Given a member changes their vote while the poll is open, Then only their latest vote MUST count.
- Given a duplicate or replayed vote submission, When it arrives, Then the tally MUST NOT double-count.
- Given a closed poll, When a vote arrives, Then it MUST be rejected and the frozen tally MUST be unchanged.
- Given a member disconnects and reconnects, Then they MUST see the current poll state and their standing vote.
- Given a server restart mid-poll, When clients reconnect, Then no previously recorded vote may be missing and voting MUST be able to continue.
- Given the harness's N concurrent scripted voters, When the run completes, Then every final tally MUST exactly equal the script's final intent.
- Given an open poll, When displayed to the presenter, Then live counts and percentages per option MUST be shown.
- The repository MUST include the harness, and running it MUST report per-check results.
- The service MUST be publicly deployed with automated deploys and no manual deploy step.

## Evaluator note

The criteria are objective; the concurrency and restart criteria are harness territory — a manual two-phone test proves little. Residual duties: confirm the harness's voters genuinely overlap in time, and that the restart check kills the real server process rather than simulating a restart in-process. "No perceptible lag" is directional context for a human reviewer, not a gate.

## Open questions

- Push transport, join-code length/alphabet, and room capacity are left to implementation.
- Whether a closed poll can be reopened is left to implementation; if it can, the frozen-tally criterion applies only while it is closed.
- Room expiry/cleanup policy is left to implementation.
