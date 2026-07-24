# Supporting artifacts: build-progress.json + lane-boundary.json

Folded into one page (rather than two more top-level pages) because governance-check's
L4 `merge_floor` leg **transitively** reads both — via the holdout gate's freshness
check (`build-progress.json`) and the evaluator cage promise (`lane-boundary.json`) — so
the "every artifact governance-check reads has a spec page" acceptance criterion covers
them without inflating the top-level page count for two artifacts that are inputs to an
existing leg, not artifacts of their own conformance rows.

## build-progress.json

**Purpose.** The per-issue resume checkpoint recorded once a build is complete and its
branch is durably pushed. It exists so a re-dispatched autonomous build resumes at
review (FAFF-402) instead of rebuilding, and so the L4 holdout gate can assert build
freshness before trusting a holdout verdict.

**Location & lifecycle.** `<run-dir>/<issue>/build-progress.json`, written once at
`faff-graft` Step 8b (build-complete, after the branch is pushed to `origin`). Not
mutated afterward within the same run.

**Producer(s).** `faff-graft` Step 8b, via `faff build-progress write`.

**Consumer(s).** `faff-graft`'s own Step 3 resume-at-review check (reads back its own
prior write on a re-dispatch), the L4 holdout gate's freshness assertion.

**Schema.** [`schema/build-progress.schema.json`](schema/build-progress.schema.json).

**Integrity.** Push precedes the write — a checkpoint always implies a pushed, gated
branch, never a dangling promise. `diff_hash` is the remote three-dot diff
(`origin/main...origin/<branch>`), reproducible from remote refs alone at resume time
(no worktree needed) — a mismatch on resume means the branch moved since the checkpoint
and the checkpoint is discarded (a hint, never authoritative over live git state).

**Fail direction.** No checkpoint (or a diff-hash mismatch) → treated as "no resume
data", never as a build failure — the caller falls through to a fresh build.

**Example.** [`schema/examples/build-progress.example.json`](schema/examples/build-progress.example.json),
hand-carried from a real issue (`.faff/runs/run-20260724-125424-beepboop-full/FAFF-634/build-progress.json`).

## lane-boundary.json

**Purpose.** The versioned **declaration of intent** the orchestrator authors, stating
what physical isolation boundary an L4 lane (typically the evaluator) needs — never a
trust source in itself. The assert-in half (does the physical environment actually
satisfy the declaration?) is `faff evaluator-preflight`, a separate mechanical check.

**Location & lifecycle.** `<run-dir>/lane-boundary.json` — run-scoped, not per-issue
(one declaration governs the run's evaluator lane). Present only on runs that provision
an L4 evaluator cage; absent on L1–L3 runs and on L4 runs that haven't reached the
evaluator phase.

**Producer(s).** The orchestrator, at the point it provisions the evaluator lane.

**Consumer(s).** `faff evaluator-preflight` (the physical fsq probe that decides
`code_blind`'s basis), governance-check's L4 `merge_floor` leg (reads the cage promise to
decide whether to arm `--require-spawner-attested` on its holdout re-read — FAFF-384).

**Schema.** Existing `plugin/skills/faff/contracts/lane-boundary.schema.json` —
referenced here, not copied.

**Integrity.** A declaration, not a proof — `evaluator-preflight`'s refuse decision rests
on a physical probe of the actual environment, never on this artifact's own claim. The
`version`, `lane`, `container`, and `accesses.*` enums are enforced as compute-fn
violations (not schema-level), matching the `env-handle`/`holdout-verdict` precedent: an
echoed out-of-enum value is `exit 1`, not a spurious fail-loud.

**Fail direction.** Absent `lane-boundary.json` → governance-check's L4 leg treats the
run as carrying **no** cage promise (today's byte-identical floor, no
`--require-spawner-attested` armed) — never inferred as a broken declaration.

**Example.** No `lane-boundary.json` exists in this repo's own run history yet (no L4
run provisioning an evaluator cage has completed here) — see the runtime contract's own
shape for the canonical example; this page will link a real one once one exists.
