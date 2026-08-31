# FAFF-954 — Wire live decision-capture into the orchestrator's core-loop decision points

> Spec: faffter-dark-nlspec · 2026-08-31 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-954.

## Why this ticket exists

FAFF-821 built the recorder: `faff decision-capture record` appends one authority-inert
`decision-capture` event per orchestrator decision, and `faff decision-capture export`
bundles those events into a corpus. FAFF-826 built the reader: `faff shadow-fidelity`
replays that corpus through the same versioned pure kernels and grades where the
orchestrator's *actual* action diverged from the kernel's *prescribed* verdict.

Between them sits an empty pipe. Nothing in the running suite calls `record`, so the
corpus the study replays is never filled. This ticket adds the live instrumentation — a
handful of best-effort `record` calls at the orchestrator's highest-drift decision sites —
so a real corpus accumulates on ordinary runs and the FAFF-826 study finally has something
to measure. It is the first source of a genuine Gate-1 coordination-fidelity signal.

This is a pilot, deliberately narrow. It wires *some* of the core-loop decisions, proves the
end-to-end pipe carries a faithful, divergence-bearing signal, and leaves the rest to a named
follow-up. It changes no authoritative behaviour: with the capture flag off (the default) the
suite runs byte-for-byte as it does today.

## What "done" buys us

A single overnight `faff-beep-boop` run, or a handful of dispatched `faff-graft` builds, with
`capture.decision_kernel: on`, leaves behind a corpus. Exported and run through
`faff shadow-fidelity`, that corpus produces a non-null result with the pilot kernels'
matrix rows populated — the first time the study reports on real orchestrator behaviour
rather than an empty window. If the orchestrator ever admits an ineligible ticket or builds
one with no spec, that divergence shows up in the study's `divergences` list, graded by
consequence. That is the whole point: a measurable gap between what the kernel said and what
the orchestrator did.

---

## Decisions

**Chosen:** Scope is the core-loop subset — `next`, `eligible`, `run-done`, `queue-state` —
not all nine in-scope kernels. These are the queue, eligibility, and termination decisions
where an LLM orchestrator most plausibly drifts from the deterministic verdict. The other five
in-scope kernels (`claim-verdict`, `park-verdict`, `project-next`, `run-start`, `run-outward`)
are explicitly out of scope here. A subset is enough to unblock the first real Gate-1 signal
and, if divergence shows up in the measured core-loop decisions, to fully justify building a
coordinator. What a subset *cannot* do is support a confident global negative ("no coordinator
needed anywhere") — and the FAFF-826 study is built to flag that as a visible coverage gap
rather than paper over it, so the narrow scope costs us nothing we were entitled to claim.

**Chosen:** The approach is prose-level `faff decision-capture record` calls placed at the
chosen `SKILL.md` sites. The kernels are already invoked at these sites as prose-driven CLI
calls (`faff next`, `faff eligible`), not from a central JS loop, so the capture call lives
next to the consult it mirrors. Every call is flag-guarded — the recorder itself reads
`capture.decision_kernel` and no-ops unless it reads exactly `"on"` (default off) — and
best-effort by construction: FAFF-821's recorder swallows a disabled gate, malformed stdin,
a missing run dir, or an append fault, logs a degraded-capture note, and exits 0. Capture can
never block or alter an authoritative decision, and flag-off behaviour is byte-identical to
today. The site's only job is to hand the recorder the inputs it already computed plus the
action it actually took.

**Chosen:** `selected_action` is the action the orchestrator *actually took* at that site —
never an echo of the kernel's verdict. This is the load-bearing correctness requirement. For a
faithfully-followed kernel the two are equal, and the study records agreement. But recording
the *real downstream action* is the entire reason the instrumentation exists: it is what makes
a divergence (prescribed ≠ actual) measurable. A site that lazily records the verdict as the
action manufactures 100% agreement and renders the study meaningless. So `selected_action` is
sourced from what the site did *after* acting on the verdict — routed to build, refused, bailed
to prep — projected into the same vocabulary the kernel returns (see the site table).

**Chosen:** The pilot instruments only the two *per-issue* kernels — `next` and `eligible` —
now, and folds the two *run-level* kernels — `queue-state` and `run-done` — into the widening
follow-up rather than this ticket. The recorder requires `--issue`, and `next`/`eligible` fire
per candidate issue, so `--issue` is the natural, faithful candidate id. `queue-state` and
`run-done` fire once per wave with no single issue; wiring them would mean minting a run-level
sentinel `--issue` value (design surface) for two *lower-drift* decisions that the orchestrator
consults and branches on directly — `faff run-done --json` → branch on verdict — where the
action is the verdict almost by construction and the manufactured-agreement risk is highest.
The per-issue pair at the graft and beep-boop gates is the smallest faithful, divergence-bearing
pilot. The sentinel-issue mechanics and the run-level pair are the widening's problem. (This
lands the realised scope at two of the four in-scope core-loop kernels; the four remain the
scope *ceiling* — the other five kernels stay untouched.)

**Chosen:** Three pilot sites, all cleanly observable, all fired **only when a resolvable run
dir with a genesis event chain is present** — which is the autonomous/dispatched path. This is
the right scope, not a limitation: the FAFF-826 study measures the *autonomous* orchestrator's
fidelity (the behaviour a future coordinator would govern), and it is exactly the autonomous
path that always has a run dir. The beep-boop site always runs under `$FAFF_RUN_DIR`; the two
graft sites fire under dispatched/autonomous graft, where the orchestrator pre-sets
`$FAFF_RUN_DIR` with a genesis `events.jsonl` chain already present. Standalone-interactive
graft is out of scope for capture (see the run-dir-lifecycle note below).

| Site | Kernel(s) | Fires when | `--issue` | What `selected_action` records |
|---|---|---|---|---|
| `faff-beep-boop` §4 build-queue eligibility gate ("Gate eligibility via `faff next` first") | `next`, `eligible` | always (beep-boop runs under `$FAFF_RUN_DIR`) | the candidate issue | the routing the gate applied: `graft` (admitted to build) / `prep` (routed to prep) / `skip-ineligible` (On-hold) / `needs-human` (routed out) / `blocked`/`done`/`none` (excluded); for `eligible`, `eligible`/`ineligible` per whether the candidate was admitted |
| `faff-graft` Step 2 prep gate (spec-exists consult) | `next` | dispatched/autonomous graft only (run dir + chain present) | the issue being built | `graft` when graft proceeded to build, `prep` when it bailed to prep for a missing spec |
| `faff-graft` Step 2 autonomous eligibility gate (pre-worktree) | `eligible` | autonomous graft only (already autonomous-gated) | the issue being built | `eligible` when graft proceeded to Step 3, `ineligible` when it refused and returned the ineligible skip |

The `--run` value is the run id (the run-dir basename), the same value these skills already pass
to `faff events append --run`.

**Chosen:** The graft-side captures are scoped to the run-dir-present (dispatched/autonomous)
condition, because standalone/top-level interactive graft mints its run substrate — the genesis
`events.jsonl` chain the recorder anchors a causation pointer to — only *after* the Step-2 gates
(graft's run-substrate mint runs once the Step-2 gates pass, before worktree work; the Step-2
prep/eligibility gates fire earlier). At Step 2 in interactive graft there is no `$FAFF_RUN_DIR`
and no chain head yet, so a capture there would best-effort-drop (the recorder needs a resolvable
run dir and a prior chain head, else it logs a degraded-capture note and exits 0). On the
`next: prep` bail path (no spec) interactive graft never reaches the mint at all, so that case is
structurally uncapturable. Rather than fire a call that silently drops, the graft-site captures
fire only under the dispatched/autonomous condition, where the orchestrator has already minted
the run dir + genesis chain — matching how the Step-2 eligibility gate is already autonomous-only.
This is safe under best-effort either way (it never blocks a decision), but scoping it explicitly
keeps the corpus honest: no phantom "capture attempted but dropped" at a site that can't record.

**Chosen:** `normalised_inputs` mirrors the *exact* argument set the site fed to the kernel CLI
at that consult — the same values, keyed by the kernel's input names. For `eligible` that is
`{labels, automationDefault, trackerPresent}`, matching `automationEligible`'s three positional
parameters. For `next` it is `{status, spec, eligible, parked, blocked, ifEligible,
awaitingSpecReview}` — **all seven** keys the `nextStep` function destructures, including
`awaitingSpecReview` (value `false` when the site did not set the awaiting-spec-review signal).
The recorder's `required_inputs` for `next` lists only the first six, so a record omitting
`awaitingSpecReview` still classifies `replayable` — but the FAFF-826 study reads `nextStep`'s
declared parameters structurally and *excludes* any `next` record missing an optional declared
input as `input-uncaptured`, which drops it from the matrix. Recording all seven keeps `next`
records in the study's denominator. This is a verified, load-bearing detail: the acceptance
criteria assert it directly.

**Assumes:** FAFF-821's recorder is on `main` and unchanged — `faff decision-capture record`
requires `--run`/`--issue`/`--kernel`, reads `{normalised_inputs, selected_action}` as JSON on
stdin, stamps `kernel_version`/`coverage`/`missing_inputs` itself via `classifyCoverage`, and is
best-effort exit-0. Verified against `plugin/skills/faff/bin/lib/decision-capture.js`.

**Assumes:** The FAFF-826 study (`faff shadow-fidelity` + `shadow-fidelity.js`) is the corpus
consumer, and it is **on `main`** — FAFF-826 merged in PR #795 (commit `b3d3225e`), so
`faff shadow-fidelity` is wired in the `main` dispatch table. The end-to-end replay criterion
therefore runs against the study on `main` with no branch sequencing needed. (The
corpus-accumulation criteria depend only on FAFF-821 and stand on their own regardless.)

**Assumes:** `selected_action` at a prose site is only as trustworthy as the skill's honesty in
recording what it did. The recorder cannot observe the orchestrator's action independently — it
writes down whatever the skill hands it. A skill that hands over the verdict instead of its real
action manufactures agreement invisibly. This is inherent to prose-level instrumentation and is
the primary reason the pilot is kept small: few sites, each simple enough that "what did I just
do here" has one honest answer. The `SKILL.md` prose at each site states the mapping explicitly
so the honest answer is the easy one.

**Punt:** The widening — the run-level kernels (`queue-state`, `run-done`) with their sentinel-
issue mechanics, the remaining five in-scope kernels, and the broader split-capture ("option B")
approach — is a separate follow-up ticket, not this one. This pilot deliberately stops at the
two per-issue core-loop kernels at three sites.

---

## Design

### The shape of one capture

At each pilot site the skill already computes the kernel's inputs and shells the kernel CLI
(`faff next …` / `faff eligible …`). Immediately after acting on the verdict, the skill makes one
additional best-effort call:

```
echo '{"normalised_inputs": <the exact inputs fed to the kernel>,
       "selected_action": <the action the skill actually took>}' \
  | faff decision-capture record --run <run-id> --issue <issue> --kernel <next|eligible>
```

The recorder does the rest — coverage classification, version stamping, causation-chain
anchoring, redaction, append. The skill supplies inputs and action only, and ignores the exit
code (it is always 0). No control flow branches on this call; it is a side observation of a
decision that has already been made and acted on.

### Where the values come from

- **`normalised_inputs`** — the same values the site passed to the kernel CLI at that consult,
  re-expressed as the kernel's input object. For `next`, all seven `nextStep` keys
  (`awaitingSpecReview: false` when unset). For `eligible`, `{labels, automationDefault,
  trackerPresent}` exactly as fed to `faff eligible`. Because the site is recording inputs it
  *already resolved* for the real consult, there is no second resolution to drift from.

- **`selected_action`** — the action token from the site table above, chosen from the kernel's
  own return vocabulary so the study can compare it like-for-like. The study projects a `next`
  action through `nextStep`'s verdict vocabulary (`graft`/`prep`/`blocked`/`skip-ineligible`/
  `needs-human`/`done`/`none`) and an `eligible` action through the boolean/`eligible`-
  `ineligible` projection. Recording a token outside that vocabulary simply won't match and reads
  as a divergence — which is acceptable and honest, never a crash.

### How a divergence surfaces

The study replays `normalised_inputs` through the real versioned kernel to get the *prescribed*
action, projects the recorded `selected_action` to the *actual* action, and compares. When they
differ it appends a `divergences` entry graded by consequence:

- **`next`**: prescribed `prep` (no spec), actual `graft` (graft built anyway) → a `wasteful`
  divergence. Prescribed a safety verdict (`needs-human`/`blocked`/`skip-ineligible`) that the
  actual action bypassed → `wrong`.
- **`eligible`**: prescribed `ineligible`, actual `eligible` (an ineligible ticket got built) →
  `wrong` — the exact backstop-failure the study exists to catch.

Both land in the study's `divergences` list and increment the kernel's matrix row, which is what
makes decision 3's requirement testable rather than aspirational.

### Interfaces touched

- `plugin/skills/faff-beep-boop/SKILL.md` — one capture call woven into the §4 build-queue
  eligibility gate, per candidate, recording the `next` routing and the `eligible` admit/refuse.
- `plugin/skills/faff-graft/SKILL.md` — one capture call at the Step 2 prep gate (`next`) and one
  at the Step 2 autonomous eligibility gate (`eligible`).
- No changes to `decision-capture.js`, `shadow-fidelity.js`, the kernels, or any contract. The
  recorder and study are consumed as-is; this ticket is prose wiring plus tests.

The prose additions follow the repo's skill-authoring standard (lean, deduplicated, skimmable)
and must pass `faff validate-adapters`.

---

## Acceptance criteria

1. **Records accumulate with real inputs and real actions (flag on).** With
   `capture.decision_kernel: on`, a run exercising the pilot sites appends `decision-capture`
   events for `next` and `eligible`. Each record's `normalised_inputs` carries that kernel's
   required input keys (`next`: the seven `nextStep` keys including `awaitingSpecReview`;
   `eligible`: `labels`/`automationDefault`/`trackerPresent`), and its `selected_action` is the
   action the site actually took — the routing/admit/refuse token, not a copy of the kernel's
   verdict.

2. **`next` records land in the study matrix, not the input-uncaptured exclusion.** A captured
   `next` record from a pilot site, exported and run through `faff shadow-fidelity`, appears in
   `matrix.next` (contributes to its denominator) rather than `exclusions.input_uncaptured` —
   demonstrating the `awaitingSpecReview` key is present. (A record deliberately omitting it must,
   by contrast, be shown to fall into `input_uncaptured` — proving the criterion bites.)

3. **A real divergence is recordable and surfaces as a divergence.** Given a corpus containing a
   record whose `selected_action` is deliberately not what the kernel would prescribe for its
   `normalised_inputs` (e.g. `eligible` inputs that resolve `ineligible`, `selected_action:
   "eligible"`; or `next` inputs that resolve `prep`, `selected_action: "graft"`),
   `faff shadow-fidelity` reports a non-empty `divergences` list containing that entry with
   `prescribed ≠ actual` and a graded `consequence`, and the kernel's matrix row counts it as a
   non-agreement — **not** as agreement. This proves the site records the real action, not the
   verdict.

4. **Flag-off is byte-identical; capture never blocks an authoritative decision.** With
   `capture.decision_kernel` unset or any value other than `"on"`, no `decision-capture` event is
   written at any pilot site and the build-queue gate, prep gate, and eligibility gate behave
   exactly as they do today. With the flag on, a capture failure at a pilot site (missing run
   dir, malformed inputs, append fault) leaves the authoritative decision unchanged — the gate's
   admit/refuse/route outcome is identical to the no-capture path, and the failure is a
   degraded-capture note, never a non-zero exit the orchestrator trips on.

5. **End-to-end: a real run's corpus produces a non-null study result with the pilot kernels
   populated.** A corpus captured from a real pilot run (beep-boop drain or graft builds),
   exported via `faff decision-capture export` and analysed by `faff shadow-fidelity`, yields
   `null_result: false` with `matrix.next` and/or `matrix.eligible` carrying a non-zero
   denominator. (Runs against the FAFF-826 study on `main` per the assumption above.)

6. **Prose passes the authoring gate.** The edited `SKILL.md` files pass `faff validate-adapters`
   (line caps, no stray markers, no duplicated blocks), and each capture site states in prose the
   input→`normalised_inputs` and action→`selected_action` mapping so the honest action is the
   obvious one to record.

---

## Done

- [ ] `faff-beep-boop` §4 build-queue gate records `next` (routing) and `eligible` (admit/refuse)
      per candidate, `--issue` = candidate id, `--run` = the run id, under the capture flag.
- [ ] `faff-graft` Step 2 prep gate records `next` and Step 2 autonomous eligibility gate records
      `eligible` — **both scoped to dispatched/autonomous graft only** (a resolvable `$FAFF_RUN_DIR`
      with a genesis chain present); `--issue` = the issue being built, `--run` = graft's run id.
      Standalone-interactive graft records nothing at either Step-2 site (its run substrate is
      minted only after the Step-2 gates), so no capture call fires there — never a call that
      silently drops.
- [ ] Every site records `selected_action` as the action actually taken, and `normalised_inputs`
      as the exact kernel inputs — `next` including `awaitingSpecReview`.
- [ ] Capture calls are best-effort and control-flow-inert: no gate branches on their result.
- [ ] Flag-off leaves all three sites byte-identical to today (no event written, no behaviour
      change).
- [ ] Test proving a captured `next` record lands in `matrix.next`, not `input_uncaptured`.
- [ ] Test proving a deliberately-divergent record surfaces in `divergences` with a graded
      consequence and is not counted as agreement.
- [ ] Test proving flag-off writes no `decision-capture` event at any pilot site.
- [ ] End-to-end check: a captured corpus exported and run through `faff shadow-fidelity` yields
      a non-null result with a pilot kernel's matrix denominator > 0.
- [ ] `faff validate-adapters` passes on the edited `SKILL.md` files.
- [ ] The widening (run-level kernels, remaining five kernels, split-capture) is left to its
      follow-up ticket, referenced from the prose.

---

## Scenarios

**Scenario — a faithfully-followed eligibility decision records agreement**
- **Given** `capture.decision_kernel: on` and an autonomous `faff-graft` build of an
  automation-eligible issue
- **When** graft's Step 2 eligibility gate consults `faff eligible`, gets `true`, and proceeds to
  Step 3
- **Then** one `decision-capture` event is appended with `kernel: eligible`,
  `normalised_inputs: {labels, automationDefault, trackerPresent}`, `selected_action: "eligible"`,
  and `coverage: replayable`
- **And** replaying it through `faff shadow-fidelity` counts it as agreement in `matrix.eligible`.

**Scenario — an ineligible ticket that got built surfaces as a `wrong` divergence**
- **Given** a corpus containing an `eligible` record whose `normalised_inputs` resolve to
  `ineligible` but whose `selected_action` is `"eligible"` (the orchestrator built it anyway)
- **When** `faff shadow-fidelity` replays the corpus
- **Then** the result's `divergences` includes that record with `prescribed: "ineligible"`,
  `actual: "eligible"`, `consequence: "wrong"`
- **And** `matrix.eligible` counts it as a non-agreement, not agreement.

**Scenario — a `next` record stays in the study matrix**
- **Given** `capture.decision_kernel: on` and a `faff-beep-boop` build-queue gate consulting
  `faff next` for a candidate
- **When** the gate records the `next` decision with all seven `nextStep` keys in
  `normalised_inputs` (including `awaitingSpecReview: false`)
- **Then** `faff shadow-fidelity` places the record in `matrix.next` (denominator +1), not in
  `exclusions.input_uncaptured`.

**Scenario — capture off changes nothing**
- **Given** `capture.decision_kernel` unset (the default)
- **When** any pilot site consults its kernel and acts on the verdict
- **Then** no `decision-capture` event is written, and the gate's admit/refuse/route outcome is
  identical to the pre-instrumentation behaviour.

**Scenario — a capture fault never blocks the build**
- **Given** `capture.decision_kernel: on` but a run dir that cannot be resolved (or malformed
  capture input)
- **When** a pilot site fires its best-effort `record` call
- **Then** the recorder logs a degraded-capture note and exits 0, the authoritative gate outcome
  is unchanged, and the run proceeds exactly as if capture were off.

---

confidence: high
spec-review: approve
build-tier: standard

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"},{"marker":"assumes"},{"marker":"punt"}]}
```
