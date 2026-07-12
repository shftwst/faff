# ADR 0057 — Scoped status-monotonicity carve-out for graft's retry-later hold

- **Status:** Proposed
- **Date:** 2026-07-12
- **Issue:** FAFF-403

## Context

The gateway's status-monotonicity guard (FAFF-82) ranks tracker status `Backlog < Todo < In Progress < In Review < Done` and forbids every faff status writer from moving an issue backward — the fix for a real incident (a `Done → In Progress` revert clobber between two independent orchestrators sharing one tracker). That guard assumes every status write is either a forward claim or a terminal advance; it has no vocabulary for a write that is neither.

FAFF-403 introduces exactly such a write. When a mandatory review provider is down (`unavailable`, FAFF-405) mid-review, the built work is already durable (branch pushed + `build-progress.json`, FAFF-402) and the review tail is resumable (`review-progress.json`, FAFF-329). Autonomous graft can hold this work and let the next drain resume the review — but the issue is currently `In Progress` (graft's own claim from Step 5), and `In Progress` is not re-queueable: `faff next` and beep-boop's build-queue assembly only pick up `Todo`/`Backlog` work. Without a status change, a held issue is invisible to every future drain — a silent-forever failure mode the spec explicitly rules out.

The candidate fixes were: (a) leave the issue `In Progress` and invent a parallel "held" queue-source outside the normal `faff next` path, or (b) release the claim back to `Todo`. Option (a) means a second, bespoke admission path duplicating `faff next`'s eligibility/spec/label logic for exactly one case — real ongoing surface area for what should be a two-line status transition. Option (b) reuses the entire existing queue-assembly machinery for free, but requires exactly one backward status move — which the monotonicity guard, as written, forbids outright.

## Decision

**Chosen:** carve out one narrowly-scoped exception to the status-monotonicity guard, rather than build a parallel admission path.

The guard's actual purpose is preventing *corruption from a writer that isn't authoritative* — a stale process, a racing peer, or a bug reverting an issue a different actor already advanced past it. That threat model is untouched by a claim-holder releasing the exact claim it itself holds. So the carve-out is scoped to precisely that case, and no wider:

- **Direction:** `In Progress → Todo` only. No other backward move is sanctioned by this ADR.
- **Actor:** only the graft run that itself holds the claim (i.e. it is releasing a status it wrote, not touching one written by another run). Never a peer, never a housekeeping pass, never a human-facing skill.
- **Site:** only inside the `unavailable` review-verdict retry-later arm (graft Step 9), which is structurally pre-PR — the issue can never be at `In Review` or `Done` when this fires, so the carve-out never comes near the guard's real concern (a further-along issue getting reverted).
- **Pairing (never a bare status write):** the release is always co-written with (1) applying the `faff-awaiting-review` label and (2) stashing both checkpoints to the run-agnostic resume store (`.faff/resume/<ISSUE-ID>/`, ADR 0058). A `Todo` status with no `faff-awaiting-review` label is an ordinary re-queueable issue, not a hold — the label is what tells a *human* reading the board, and `/faff-wtf`, that this isn't a fresh Todo.

Every other faff status writer (the ship producer, tidy, beep-boop's post-merge bump, and graft's own Step-5 claim) is unaffected: they remain forward-only, exactly as FAFF-82 specified.

## Consequences

- The build-queue admission path needs no new code: `faff next` already treats a `Todo` + eligible + spec-attached + non-`faff-parked` issue as re-queueable, so a held issue simply re-enters the existing pipeline on the next drain. This is the option's whole payoff — zero new admission logic, zero new failure surface for "did the held-queue scanner miss this."
- The monotonicity guard's prose (gateway → *Issue claim & status monotonicity*) now documents one named exception instead of an unconditional rule, so a future reader must check the exception's three conditions (actor, site, pairing) before assuming *any* backward move is safe. This is a deliberate readability cost, accepted because the alternative (a parallel queue) hides the exception in a second code path instead of naming it once in the shared invariant.
- If the carve-out's conditions are ever read loosely (e.g. "any graft backward move is fine"), the original 2026-06-09 corruption failure mode reopens. The spec's own anti-pattern list and this ADR's scoped wording are the guardrail; review of any future change touching this section should treat scope-widening as a hard stop.
- The carve-out has no interaction with the L4 holdout gate or the merge floor — it fires strictly pre-PR, before any of those gates are reached.
