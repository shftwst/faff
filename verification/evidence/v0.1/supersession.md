# supersession.json

**Purpose.** The per-issue artifact recording that an issue's deliverables were found
already merged to `main` by other tickets, at build time — the `superseded` terminal
outcome's producing evidence (FAFF-571 defines the outcome; FAFF-573 is this artifact's
producer).

**Location & lifecycle.** `<run-dir>/<issue>/supersession.json`, written once by
`faff-graft`'s **build-time premise-superseded gate** (pre-worktree, both interactive and
autonomous modes) when it confirms, on `main`, that the issue's declared surface is
already delivered by a non-empty set of terminal sibling tickets. The issue is moved
`Done` and **no PR is opened** — this artifact is the entire evidence trail for that
close.

**Producer(s).** `faff-graft`'s build-time premise-superseded gate.

**Consumer(s).** `faff runcheck` (the `superseded` outcome in `run-ledger.json`
`outcomes`), the run summary's `superseded` bucket, `faff-beep-boop`'s ledger
reconciliation.

**Schema.** [`schema/supersession.schema.json`](schema/supersession.schema.json).

**Integrity.** `superseded_by` is the only reconcile-load-bearing field, and it is
**fail-closed by construction**: the gate only writes this artifact after independently
confirming each cited ticket's deliverable is present on `main` (never from tracker state
alone) — an unverified or empty candidate set never reaches a write; the gate falls
through to a normal build instead (see the gate's own fail-closed default in
`faff-graft/SKILL.md`).

**Fail direction.** A consumer re-observing `superseded_by`'s cited tickets and finding
them NOT live/verified fails closed to `superseded-unproven` — never trusts the artifact's
claim blindly.

**Example.** [`schema/examples/supersession.example.json`](schema/examples/supersession.example.json) —
**hand-constructed**, not hand-carried: no `supersession.json` exists in this repo's own
run history yet (the build-time premise-superseded gate has not fired on a real issue
here at the time this page was written). The shape matches FAFF-571 §3's schema and the
gate's own write procedure exactly; this page will link a real example once one exists.
