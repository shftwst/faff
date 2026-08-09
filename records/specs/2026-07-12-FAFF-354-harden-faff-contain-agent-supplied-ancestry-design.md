# FAFF-354 — Harden `faff contain` against agent-supplied ancestry: record the invocation, re-verify in audit, document the trust boundary

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-354.

This spec addresses FAFF-354 for the build agent and human reviewers. It hardens the containment gate (`faff contain`) against its one untrusted input — the `--ancestry` chain fetched by the very agent the gate is meant to contain — without breaking the CLI's no-tracker purity invariant.

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff contain` is a pure oracle over agent-supplied input, and nothing in this change tries to make it fetch truth itself (it can't — the CLI never talks to the tracker). Instead, the hardening **binds each verdict to the exact input it was computed from, durably, in the run's timeline** — so the truthfulness of that input moves from *unverifiable* to *post-hoc mechanically checkable*. This is detective control, not preventive: the same trust class as the rest of faff's run-reconstruction forensics (`faff audit`: "coherence is reported, never gated"), and honestly documented as such.

**Problem statement.** `faff contain`'s `--ancestry <json>` is fetched and supplied by the agent whose scope it constrains, so a confabulated or stale chain makes an outward parent read as contained — the fail-closed walk protects against *malformed* input, not *plausible wrong* input. Today nothing records what chain was walked, so a wrong verdict leaves no evidence and can never be re-checked. This change records every chokepoint invocation CLI-side, teaches `faff audit` to recompute and compare, and states the trust boundary explicitly where the containment story is told.

**Design principles:**

- **The CLI never fetches the tracker.** Verification stays payload-side (recording + recompute); any truthfulness check against the live tracker remains agent- or human-side. A run-dir file write is not a tracker call — `faff events append` already writes the same file.
- **Detective, not preventive — say so.** No prose may claim the record *prevents* fabrication. It makes fabrication durable evidence that a post-hoc re-fetch can catch. Claiming more would repeat the exact honesty gap the 2026-07-04 critical review flagged.
- **Never a silently-unrecorded verdict.** When recording is requested and impossible, fail loud *before* emitting a verdict — an unrecordable check must not degrade into today's unrecorded one.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` lines 2136–2407 | Node | `faff contain` — `containerParent` / `subtreeContains` / `parseAncestry` / `cmdContain` + 21-case selftest; the surface being hardened |
| `plugin/skills/faff/bin/faff` lines 9312–9422 | Node | events substrate (FAFF-35) — append-only `events.jsonl`, CLI-owned envelope `{schema:1, run_id, seq, ts}`, closed `EVENT_TYPES` set; the recording surface |
| `plugin/skills/faff/bin/faff` lines 10417–10650 | Node | `faff audit` (FAFF-289) — pure run reconstruction + coherence findings; the re-verification consumer |
| `plugin/skills/faff-beep-boop/SKILL.md` lines 211–246 | prose | chokepoint #1 (step-10 filing) + the single-sourced `autonomous_file_check` procedure |
| `plugin/skills/faff-tidy/SKILL.md` lines 141, 279 | prose | chokepoint #2 (chain-gap auto-fill) — references beep-boop's single source, restates nothing |
| `plugin/skills/faff/SKILL.md` line 687 | prose | gateway Appetite hard-floor bullet (FAFF-221 outward-new-root) — home for the trust-boundary sentence |
| `docs/guide/cli.md` lines 7, 35 | prose | CLI reference rows for `contain` — must not go stale |
| `records/adr/0012` | prose | parentId-dominant membership — the walk semantics this change must not alter |

**Scope statement.** This is a hardening slice inside the shipped scope-containment family (FAFF-217/219/221/222) and the run-forensics family (FAFF-35/289); it changes one CLI command's flag surface, one reader, and three prose homes.

## 2. OUT OF SCOPE

- **`--verify` two-source agreement mode** — rejected, not deferred (see Design decision rationale). Extension point: `cmdContain`'s flag surface, if a genuinely independent second source ever exists (e.g. a spawner-fetched ancestry inside the L4 cage, fetched outside the judged agent's control).
- **Truthfulness re-verification against the live tracker** (diffing a recorded payload against a fresh tracker read) — agent/human-side by the purity invariant; this change *enables* it by preserving the payload. Natural FAFF-316 break-attempt material — coordinate, don't duplicate. Extension point: a FAFF-316 audit script reading `containment-check` events.
- **Enforcing that `contain` is invoked at all.** An oracle you can skip is not a gate; full enforcement is Stop-hook-class machinery, out of scope. The new `unrecorded creates` audit finding partially detects the skip (see HOW → limitations).
- **Hardening the inputs of the other pure oracles** (`eligible` labels, `next` state) — same trust class, separate ticket if wanted. Extension point: the same record-into-events pattern.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| containment-check event | A `RunEvent` recording one `faff contain` invocation: the exact inputs walked and the verdict computed |
| recorded invocation | A contain call made with `--record <run-id>`, whose payload/verdict binding is written by the CLI itself |
| unrecorded create | A run whose ledger shows filed discovered-scope tickets but whose timeline holds no containment-check events |

**New event type** (added to `EVENT_TYPES` + `EVENT_ISSUE_SCOPED`; `issue` carries the mandate id):

```
RECORD ContainmentCheckData:            # RunEvent.data for type "containment-check"
  mandate: string                       # the run's sanctioned subtree root
  parent: string | null                 # intended parent id; null when root=true
  root: boolean                         # the --root case (intended new top-level container)
  ancestry_raw: string | null           # the --ancestry argument VERBATIM; null when none was passed
  verdict: "contained" | "outward"
  exit: 0 | 3
```

**Flag surface** (backward-compatible; without `--record` behaviour is byte-identical):

```
faff contain <mandate> (--parent <id> | --root) --ancestry <json>
             [--record <run-id>] [--phase run|tidy|prep|build] [--json]
```

- `--record <run-id>` — append a containment-check event to `.faff/runs/<run-id>/events.jsonl` (repo root via the existing `findRoot()`), using the shared event envelope (schema/run_id/seq/ts CLI-owned). The run-id is validated before use: a value containing a path separator (`/` or `\`) or a `..` segment → usage exit 2 — the record can only land inside `.faff/runs/` (the flag is a new agent-supplied input on the command being hardened; don't hand it a traversal).
- `--phase` — the event's phase, default `run`; only meaningful with `--record` (beep-boop step-10 passes `run`, tidy chain-gap passes `tidy`).

**`faff audit` reconstruction extension** — two new coherence members, both reported-never-gated, both flipping `coherence.clean` to `false` when non-empty/true:

```
coherence.containment_mismatches: [ { seq, issue, recorded, recomputed } ]
  # recomputed ∈ "contained" | "outward" | "unreproducible" (recorded ancestry_raw fails parseAncestry)
coherence.unrecorded_creates: boolean
  # true ⇔ ledger.discovered_scope_filed > 0 AND zero containment-check events present
```

**Design decisions** — see the collected rationale (section 6); every one is closed with a `**Chosen:**` marker there.

## 4. HOW — Behavior

**Approach.** Three small moves, all inside existing machinery: (1) `cmdContain` learns to self-record via the events substrate; (2) `buildReconstruction` learns to recompute each recorded check with the same `parseAncestry` + `subtreeContains` functions that produced it (same binary — no drift possible); (3) the chokepoint procedure and the containment prose state the trust boundary and require `--record`.

**`cmdContain` changes:**

```
PROCEDURE cmdContain(args):
  1. Parse flags as today, plus --record <run-id> and --phase <p>
     (add "--record" and "--phase" to CONTAIN_VALUE_FLAGS; --phase must be in
      the existing EVENT_PHASES set, default "run"; --phase without --record → usage exit 2)
  2. Run all existing validation (mandate/parent/root/ancestry) unchanged
  3. IF --record given:
     a. root := findRoot(); runDir := <root>/.faff/runs/<run-id>
     b. IF runDir missing or not a directory → stderr "run dir missing — initialise the run first",
        return 2   # BEFORE any verdict is computed or printed: never a silently-unrecorded verdict
        # NOTE: events append uses exit 3 for this, but contain's exit 3 is taken (= outward) —
        # a record failure must be usage-class 2, never a value that reads as a verdict
  4. Compute verdict via subtreeContains (unchanged)
  5. IF --record given: append event via the shared append helper:
     { phase, type: "containment-check", issue: mandate,
       data: { mandate, parent, root, ancestry_raw, verdict, exit } }
  6. Print verdict / JSON and return exit 0|3 (unchanged)
```

**Share the append core.** Extract the envelope-building append logic from `cmdEvents`'s `append` branch (seq = line count, `{schema:1, run_id, seq, ts}`, `appendFileSync`) into one internal helper both `cmdEvents` and `cmdContain` call — one home for the envelope, no second seq implementation. `faff events validate` accepts the new type because both read the same `EVENT_TYPES` set.

**`faff audit` changes** (inside `buildReconstruction`, pure — the selftest drives it without disk):

```
PROCEDURE recomputeContainmentChecks(events):
  FOR each event with type "containment-check":
    d := event.data
    IF d.ancestry_raw is null → entries := empty map
    ELSE TRY entries := parseAncestry(d.ancestry_raw)
         CATCH → push { seq, issue, recorded: d.verdict, recomputed: "unreproducible" }; CONTINUE
    got := subtreeContains(d.mandate, d.root ? CONTAIN_ROOT : d.parent, entries)
    IF got ≠ d.verdict → push { seq, issue, recorded: d.verdict, recomputed: got }
```

plus `unrecorded_creates := (ledger.discovered_scope_filed > 0) AND (no containment-check events)`. Both feed `coherence.clean`; text rendering adds one line each under `coherence: findings` (`containment mismatches: seq N (recorded X vs recomputed Y)`, `unrecorded creates: ledger filed N discovered-scope tickets, no containment-check events`).

**Prose wiring (the dual-read discipline made durable):**

- `plugin/skills/faff-beep-boop/SKILL.md` → `autonomous_file_check` step 3 becomes `faff contain <mandate> (--parent <parent> | --root) --ancestry <json> --record <run-id> --phase <run|tidy>`; add one bullet: the CLI binds the recorded payload byte-identically to the walked payload, and a missing run dir exits 2 — which flows into the procedure's existing exit-2 branch (log + surface, **no create**), so an unrecordable check fails closed to no-create.
- Same section + the gateway hard-floor bullet (`plugin/skills/faff/SKILL.md` line 687) + the `contain` region header comment (bin/faff line ~2159): one trust-boundary sentence each, in place — *ancestry is agent-sourced; the check binds structure, not truthfulness; the recorded invocation + `faff audit` recompute is the detective control.*
- `docs/guide/cli.md`: update the `contain` row (line 35) with the new flags and note the audit coherence findings in the `audit` row. Same-PR doc update (docs never go stale).
- No tidy edit beyond confirming it still points at the single-sourced procedure (it does today — restate nothing).

**Edge cases:**

- `--record` + `--root` (no ancestry): record `ancestry_raw: null, root: true, verdict: "outward"` — the recompute reproduces it (root is outward by definition).
- `--record` + mandate==parent base case (no ancestry required): record `ancestry_raw: null`; recompute walks `parent === mandate` → contained. Reproducible.
- Usage failures (exit 2) are **not** recorded — no verdict was computed; there is nothing to bind.
- Ancestry size: chains are a handful of entries; record verbatim, no truncation (fidelity over bytes).
- Concurrent writers: events.jsonl is single-writer-per-run today (FAFF-35 slice 1); `contain --record` runs from the same orchestrator lane, preserving that. A parallel-executor race would at worst duplicate a `seq` — an audit-visible anomaly, not corruption (append-only).

**Failure modes — how this falls over, and how you'd notice:**

- **The agent omits `--record` / skips `contain` entirely.** The `unrecorded_creates` finding catches the beep-boop step-10 path (ledger `discovered_scope_filed` is the tell). Tidy chain-gap creates carry no ledger counter, so a record-less tidy create is invisible to this finding — you'd know only via FAFF-316-style break-attempts or manual review. Accepted v1 limitation, named in the audit docs; extending the ledger is a follow-on, not this slice.
- **The agent fabricates ancestry and records the fabrication.** The recompute agrees with itself — audit stays clean. The record's value here is durable evidence: a post-hoc tracker diff (out of scope, now enabled) catches it. This is the honest ceiling of detective control; the trust-boundary prose says exactly this.
- **The recompute drifts from the original walk.** Impossible by construction — audit calls the same `parseAncestry`/`subtreeContains` in the same binary. A mismatch therefore means the recorded line was tampered with or the record was written by something else: exactly what the finding is for.

## 5. SCENARIOS

```
Given an initialised run dir and a valid ancestry chain
When  faff contain M --parent P --ancestry '[…]' --record <run-id> --phase run
Then  the verdict and exit code are identical to the unrecorded call,
      and events.jsonl gains one containment-check event whose data recomputes to that verdict
```

```
Given --record naming a missing run dir
When  faff contain is invoked
Then  it exits 2 with "run dir missing", prints no verdict, appends nothing
```

```
Given a run whose events.jsonl holds a containment-check event whose recorded verdict
      does not match a recompute over its recorded ancestry_raw (a tampered/foreign line)
When  faff audit <run-id>
Then  coherence.containment_mismatches names the seq + both verdicts and coherence.clean is false
```

```
Given a run ledger with discovered_scope_filed: 2 and no containment-check events
When  faff audit <run-id>
Then  coherence.unrecorded_creates is true and coherence.clean is false
```

```
Given any existing invocation without --record
When  faff contain runs
Then  behaviour is byte-identical (all 21 existing selftest cases + contain tests pass unchanged)
```

## 6. DESIGN DECISION RATIONALE

**Which hardening direction — dual-read+record, `--verify` two-source agreement, or document-only?**
- *Record + audit + document:* keeps purity; binds verdict to input mechanically; matches the assert-don't-enforce, forensics-first posture the suite already has; cheap (one flag, one reader).
- *`--verify` two-source:* both payloads are fetched by agents under the same orchestrator — "independence" would be prose-enforced, which is precisely the trust class the ticket is trying to escape; adds a subagent fetch per filing for no change in threat model (a confabulator controls both sources).
- *Document-only:* honest but fails the ticket's bar — the guarantee stays only as honest as its input, with no way to check honesty even after the fact.
- **Chosen:** dual-read discipline made durable — CLI-side `--record` + `faff audit` recompute-and-compare + explicit trust-boundary documentation; `--verify` rejected (not deferred) with the independence argument recorded here so it isn't re-proposed.

**Recording surface — events.jsonl vs a new `containment-checks.jsonl`?**
- events.jsonl: one timeline substrate, CLI-owned envelope + seq ordering already exist, `faff audit` already reads it; a new file needs a new reader/writer and splits the timeline.
- **Chosen:** events.jsonl via a new `containment-check` event type (issue-scoped on the mandate id — a string key; project/initiative mandates under FAFF-222 ride the same field).

**Who writes the record — the CLI (`--record`) or the agent (`faff events append` after the call)?**
- Agent-side append leaves a transcription seam: walk payload X, log payload Y.
- **Chosen:** CLI-side `--record` — the record is bound byte-identically to the invocation that produced the verdict; the agent can still skip the flag (detected where possible), but can no longer record something other than what it walked.

**Record-failure semantics — degrade to unrecorded, or fail loud?**
- **Chosen:** fail loud, exit 2, *before* computing/printing any verdict. A silently-unrecorded verdict recreates today's gap; exit 2 composes with `autonomous_file_check`'s existing usage branch → log + surface, no create (fail-closed to no-create).

**Record raw or normalized ancestry?**
- **Chosen:** the `--ancestry` argument verbatim (`ancestry_raw`) — audit re-runs the full parse+walk pipeline, so the recompute covers `parseAncestry` too; normalized-only would hide a parse divergence.

**Event phase?**
- **Chosen:** caller-supplied `--phase` from the existing closed `EVENT_PHASES` set, default `run` — the two chokepoints legitimately run in different phases (`run` vs `tidy`); inventing a fifth phase would touch every phase consumer for no gain.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** tidy's chain-gap auto-fill runs with a resolvable run dir (it already writes `.faff/runs/<run-id>/automation-verdicts.md`, so a run id exists in both standalone and beep-boop-driven passes). *Validation:* before building, grep faff-tidy's SKILL.md for the run-dir/verdict-cache path; if a standalone tidy pass can genuinely lack a run dir, the `--record` exit-2 branch makes the create fail closed (skip + surface) — acceptable, but note it in the tidy prose edit.

## 8. DONE — Definition of Done

### From WHY / trust boundary
- [ ] Trust-boundary sentence present in all three homes: the gateway hard-floor bullet (FAFF-221), beep-boop → _Containment at the filing chokepoint_, and the `contain` region header comment — each stating ancestry is agent-sourced, the check binds structure not truthfulness, and the record+audit recompute is the detective control.
- [ ] No prose anywhere claims the record *prevents* fabrication.

### From WHAT (flag surface + event type)
- [ ] `faff contain … --record <run-id> [--phase p]` appends exactly one containment-check event with the CLI-owned envelope (schema 1, monotonic seq) and `data = {mandate, parent, root, ancestry_raw, verdict, exit}`; exits stay 0/3.
- [ ] `--record` with a missing/non-dir run dir → exit 2, no verdict printed, nothing appended.
- [ ] `--phase` outside `EVENT_PHASES`, or `--phase` without `--record` → usage exit 2.
- [ ] `--record` with a run-id containing a path separator or `..` segment → usage exit 2, nothing written (traversal guard).
- [ ] Without `--record`: byte-identical behaviour — existing `contain --selftest` (21 cases) and `test/contain.test.mjs` pass unchanged.
- [ ] `faff events validate` accepts a well-formed containment-check record and rejects one missing `issue`.

### From HOW (audit + shared core)
- [ ] `faff audit` reports `containment_mismatches` (including `recomputed: "unreproducible"` for an unparseable recorded chain) and `unrecorded_creates`; either flips `coherence.clean` to false; both render in text and `--json`.
- [ ] A clean recorded run (record present, recompute agrees) keeps `coherence: clean`.
- [ ] The event-append envelope logic has one home (helper shared by `cmdEvents` and `cmdContain`) — no second seq implementation.
- [ ] `autonomous_file_check` step 3 carries `--record <run-id> --phase <run|tidy>` + the fail-closed bullet; tidy still references the single source (no restated copy).
- [ ] `docs/guide/cli.md` `contain` and `audit` rows updated in the same PR.

### Verification
- [ ] New `node --test` cases in `test/contain.test.mjs` (record happy path, missing run dir, --phase validation, back-compat) and `test/audit.test.mjs` (mismatch, unreproducible, unrecorded creates, clean recorded run); `contain --selftest` / `audit --selftest` extended to cover the new pure paths.
- [ ] `faff validate-adapters` passes on the edited SKILL.md files.

**Integration smoke test:**

```
1. mkdir .faff/runs/smoke && faff contain FAFF-1 --parent FAFF-2 \
     --ancestry '[{"id":"FAFF-2","parentId":"FAFF-1"}]' --record smoke   → exit 0, "contained"
2. faff audit smoke                                                      → coherence: clean
3. Flip the recorded verdict to "outward" in events.jsonl; faff audit smoke
                                                                         → containment mismatch, clean:false
```

## Already shipped against this surface

- FAFF-217 (Done) — scope-containment principle; FAFF-219 (Done) — the `contain` primitive; FAFF-221 (Done) — chokepoint wiring; FAFF-222 (Done) — container-level mandates. All ship the *structural* guarantee; none records, verifies, or documents the trust of the ancestry input — this spec's premise is exactly that residual.
- FAFF-289 (Done, shipped in-code as the `audit` region) — the reconstruction/coherence machinery this spec extends rather than duplicates.
- FAFF-316 (Backlog, nothing produced) — the gate-break audit this spec *enables* (recorded payloads become its re-verification substrate); no overlap performed here.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
