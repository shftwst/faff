# FAFF-396 — Headless disposition sink: `faff disposition` run-end verdict (durable needs-human/park surfacing + non-zero runner exit)

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-396.

This spec defines the write/exit side of unattended-run visibility: a deterministic run-end disposition verdict a headless (CI/cron/container) wrapper can gate on. Audience: the build agent implementing it and human reviewers. The read/forensics side (`faff audit`, FAFF-289; `faff events`, FAFF-35) is shipped and untouched.

## 1. WHY — Problem and Principles

**Load-bearing model.** Every needs-attention signal an unattended run produces already lands durably *somewhere* — per-issue parks carry a `faff-parked` label + reason comment on the tracker (the shared park protocol), and the run writes `run-ledger.json`, `events.jsonl`, and `summary.md` under `.faff/runs/<run-id>/`. What no component provides is a **process-exit contract over those substrates**: one command a headless host runs as its final step that reads the run's end state and exits non-zero when anything needs a human. Without it, a CI lights-out run whose issues all parked still reports green, and run-level escalations (`budget-escalated`, `product-incomplete`, `non-convergence`, sentry abort) exist only as prose in `summary.md` — nothing machine-checkable names them after the container dies.

**Problem statement.** park / needs-human surfacing assumes an interactive next session (`/faff-wtf` reads the ledger). In headless runs there is no next session on that host and the ledger may be ephemeral, so runs end "green by silence". This change adds a pure CLI verb — `faff disposition` — that classifies the run's final state into all-clean vs needs-attention, prints a machine-readable summary naming affected issues and causes, and exits non-zero on needs-attention.

**Design principles:**

- **Deterministic tools over prose.** The verdict is a pure CLI classification over on-disk run substrates — no LLM, no tracker call, no network (parity with `runcheck` / `economics` / `audit`).
- **Fail toward attention.** Anything unreadable, incomplete, or unclassifiable that indicates the run did not end cleanly reads as needs-attention, never as clean. A missing ledger is a hard error (exit 3), not a clean exit.
- **Reuse the shipped signal, add only the exit contract.** The issue's own open question ("confirm the real gap is the headless exit/label contract, not the signal itself") is confirmed by explore: per-issue tracker surfacing (label + comment) already ships in the park protocol; the run summary already ships as a hard-floor artifact. This change adds no second copy of either.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/faff` — `TERMINAL_STATES` (`shipped`, `pr-open`, `parked`, `errored`, `routed-out`, `unreached-budget`) + `auditLedger` | The outcome vocabulary and completeness core the classifier folds over. |
| `plugin/skills/faff/bin/faff` — `extractParksBlock` (park-history) | The existing parser for `summary.md`'s fenced `faff-parks` JSON block (`{issue_id, root_cause_class, timestamp}`) — reused for per-issue park causes. |
| `plugin/skills/faff/bin/faff` — `faff events read` | Per-issue `issue-outcome` events; best-effort cause enrichment. |
| `plugin/skills/faff/bin/faff` — sentry `abort` ledger mark (`abort.status: "aborted-resumable"`, owner flipped to `aborted-resumable`) | An abort marker the classifier must treat as needs-attention. |
| `plugin/skills/faff-beep-boop/SKILL.md` — Run ledger, Stopping condition, Reporting | Where the new `stop_reason` field is written and where the wrapper guidance hooks in. |
| Gateway `faff/SKILL.md` — Park protocol (shared) | The already-durable per-issue surfacing (comment + `faff-parked` label) this spec deliberately reuses. |
| `docs/guide/cli.md`, `docs/guide/unattended.md` | Docs gated by `faff lint-cli-doc` (bidirectional subcommand coverage) and the docs-never-stale rule. |

**Scope statement.** This is one factory-region CLI verb plus one additive informational ledger field and the doc/prose wiring that makes a headless wrapper's final step meaningful; it sits at run end, after `runcheck`, beside `economics` and `audit`.

## 2. OUT OF SCOPE

- **A new `faff-needs-human` tracker label** — excluded; per-issue durable surfacing already ships as `faff-parked` + reason comment on every park path, and a second label would fork every park site, `/faff-wtf`, `/faff-tidy`'s stale-label pass, and the unpark protocol for no added signal. Extension point: a `faff labels` manifest entry + park-protocol branch, if a park/needs-human label split is ever justified by a consumer that must distinguish them board-side.
- **Webhook / push notification sink** — excluded (the issue marks it optional). Extension point: a push-sink producer that consumes `faff disposition --json` output; the JSON shape here is designed to be its input.
- **A `.faffrc` sink-selection config key** — excluded in v1 (see Design decisions — the seam is realised at the call site, and a knob with no second behaviour to select is dead config). Extension point: a `disposition:` config block when a push sink exists to route to.
- **Blocking run-end ground-truth reconcile** (ledger-vs-tracker/git divergence) — that is FAFF-397's scope; this verb trusts the ledger as written.
- **Retry-later / awaiting-review disposition refinement** — FAFF-403's scope (a new disposition class); this verb classifies today's terminal vocabulary and gains new classes only when the ledger vocabulary does.
- **PR-blocking comments** — the merge-gate / review path already owns PR-side surfacing; nothing here writes to PRs.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| disposition | The run-end verdict over a single run dir: `clean` or `needs-attention`, plus the itemised reasons. |
| attention item | One reason the run needs a human: a per-issue terminal outcome in the attention set, a run-level escalation, an abort marker, or an incomplete ledger. |
| escalate-class stop reason | A recorded `stop_reason` in `{budget-escalated, non-convergence, product-incomplete, sentry-abort}` (the reasons beep-boop already emits with "the structured needs-human signal"). |

**The verb:**

```
faff disposition [--run-dir DIR] [--json] [--root DIR] [--selftest]
```

- Run-dir resolution: `--run-dir` arg → `$FAFF_RUN_DIR` → latest under `.faff/runs` (same chain as `budget check` / `runcheck`; the explicit arg is preferred in wrappers — the latest-dir lexical-sort hazard is documented, not re-solved, here).
- Exit codes: `0` clean · `1` needs-attention · `2` usage/malformed ledger · `3` no run dir / no ledger. (Same shape as `admissible` 0/1/2 plus the established exit-3 no-run-dir convention from `events`/`sentry`/`audit`.)
- Pure: filesystem reads under the run dir only. No tracker, no network, no LLM, no writes.

**Output — the DispositionReport (stdout; `--json` for the raw object, human-skimmable lines otherwise):**

```
RECORD DispositionReport:
  run_id: string
  disposition: "clean" | "needs-attention"
  attention: List<AttentionItem>          # empty iff clean
  counts: { <terminal-bucket>: n, ... }   # ledger outcome histogram (informational)

RECORD AttentionItem:
  kind: "issue-outcome" | "run-escalation" | "aborted" | "incomplete-ledger"
  issue: string | null                    # null for run-level kinds
  outcome: string | null                  # the terminal bucket, for issue-outcome
  cause: string | null                    # best-effort, see joining rule below
```

**Classification (the attention sets):**

- Issue outcomes `parked`, `errored`, `unreached-budget`, `pr-open` → one `issue-outcome` attention item each. `shipped` and `routed-out` are clean (rationale in Design decisions).
- A recorded escalate-class `stop_reason` → one `run-escalation` item (even when every issue shipped).
- A ledger `abort` entry or `owner.status == "aborted-resumable"` → one `aborted` item.
- `auditLedger(...).clean == false` (undispatched admitted issues, or invalid outcome tokens) → one `incomplete-ledger` item naming them — an abandoned or killed run must read as needs-attention, and this must not wait for `stop_reason` adoption.

**Cause joining (best-effort, degrade-don't-crash — the `faff audit` posture):** for each attention issue, `cause` is filled from the first available of: the `summary.md` `faff-parks` block's `root_cause_class` for that issue (via the existing `extractParksBlock`) → the latest `issue-outcome` event's `data` for that issue in `events.jsonl` → `null`. A missing or malformed substrate never fails the verb; it only degrades `cause` to `null`. The classification itself (exit code) depends **only** on `run-ledger.json`.

**The additive ledger field:** at orchestrator exit (the same moment beep-boop sets `owner.status: "done"`), beep-boop records its `Stop reason` token machine-readably:

```
run-ledger.json += { "stop_reason": "<the summary's Stop reason token>" }
```

Informational — outside the `runcheck` completeness invariant, absent on legacy ledgers (tolerated: run-level escalation detection then degrades to the abort marker + outcome classification only). Written by prose (beep-boop SKILL.md edit), not by the CLI — matching how the rest of the ledger is written.

**Design decisions:**

- **Locus: a `faff` verb, not a `ship`-adjacent producer, not a runner script.** The signal is run-scoped (a `ship` producer sees one PR); faff owns no daemon/runner process — the "runner" in headless mode is the host's wrapper (CI step, cron line) invoking the agent, so the exit contract must be a command that wrapper can call as its final step. Extending `runcheck` (completeness audit), `run-done` (deliberately report-only termination predicate) or `audit` (deliberately non-gating forensics) would overload contracts that other consumers rely on staying report-only. **Chosen:** new pure subcommand `faff disposition`, factory region, `--selftest` table, registered in `COMMANDS`/`REGION_MAP`.
- **Label: reuse `faff-parked`; no `faff-needs-human`.** Every needs-human that touches an issue already ends in the shared park protocol (comment naming the cause + `faff-parked` via `faff label add`), which is durable, board-visible, and container-survivable; run-level escalations have no issue to label and land in the tracker status post + this verb's exit. A second label doubles the surface every park/unpark/wtf/tidy path must read, for a distinction the cause comment already carries. This settles the issue's first open question. **Chosen:** reuse `faff-parked`; the issue's "carries `faff-needs-human`" AC is satisfied by the existing `faff-parked` + reason comment invariant, asserted (not rebuilt) here.
- **park vs needs-human: one sink, one exit code; the JSON carries the grain.** Distinct exit codes per class would push classification into every wrapper's shell logic; CI needs red/green, humans read the itemised report. **Chosen:** exit 1 for any attention item; `kind`/`outcome`/`cause` in the report distinguish park vs errored vs escalation.
- **`pr-open` counts as attention; `routed-out` does not.** A PR left open for human review is precisely a "human must act" outcome of *this run*. `routed-out` issues were never attempted — they are steady-state backlog triage (`needs-decision-first` etc.) surfaced by `/faff-wtf`; counting them would make near-every run red and train wrappers to ignore the signal. **Chosen:** attention = `{parked, errored, unreached-budget, pr-open}`; clean = `{shipped, routed-out}`.
- **Report-only verb; no `disposition.json` file write.** The durable artifacts already exist (`summary.md` hard floor, the ledger, the tracker writes); a wrapper that wants the JSON as a CI artifact redirects stdout. Keeping the verb read-only preserves the pure-reader parity with `economics`/`audit` and avoids a second writer to the run dir. **Chosen:** stdout only.
- **Config seam: none in v1.** The issue models the sink as `(default, override)` config. Explore shows the interactive default costs nothing to keep (nobody calls the verb; ledger→`/faff-wtf` unchanged) and the headless override is *which command the wrapper runs last* — a call-site fact the host owns, not a faff-config value; a key selecting between one behaviour and itself is dead config (config is for values, not for routing to a single implementation). **Chosen:** no new `.faffrc` key; `docs/guide/unattended.md` documents the wrapper pattern. The `disposition:` block is named in OUT OF SCOPE as the extension point when a push sink exists.
- **`stop_reason` written by prose at exit, tolerated-absent.** The alternative (CLI derives run-level escalation by re-running `run-done`) would need the full `RunSignals` reconstruction at disposition time — heavyweight and wrong-layer. **Chosen:** additive informational field, same write moment as `owner.status: "done"`, degrade when absent.

## 4. HOW — Behaviour

**Approach.** One new factory-region section in `bin/faff`: a pure classifier core (selftest-driven) + a thin `cmdDisposition` shell that resolves the run dir, reads the substrates, and prints/exits. Reuse `readLedger`, `auditLedger`, `extractParksBlock`, and the events-file line reader; fork none of them.

```
PROCEDURE computeDisposition(ledger, parksBlock?, issueOutcomeEvents?):
  1. audit = auditLedger(ledger)                       # throws on malformed → exit 2 in shell
  2. items = []
  3. FOR (issue, outcome) IN ledger.outcomes:
       IF outcome IN {parked, errored, unreached-budget, pr-open}:
         items += { kind: issue-outcome, issue, outcome,
                    cause: parksBlock[issue].root_cause_class
                           ?? latest issueOutcomeEvents[issue].data-derived cause
                           ?? null }
  4. IF ledger.stop_reason matches escalate-class      # prefix-match budget-escalated(<dims>)
       items += { kind: run-escalation, cause: ledger.stop_reason }
  5. IF ledger.abort present OR owner.status == "aborted-resumable":
       items += { kind: aborted, cause: abort.signal ?? "sentry-abort" }
  6. IF NOT audit.clean:
       items += { kind: incomplete-ledger,
                  cause: names audit.undispatched + audit.invalid_outcomes }
  7. RETURN { run_id, disposition: items.empty ? clean : needs-attention,
              attention: items, counts: histogram(ledger.outcomes) }
```

Shell behaviour: no run dir / no `run-ledger.json` → exit 3 with a one-line reason; malformed ledger JSON / `auditLedger` throw → exit 2 (loud, names the file); otherwise print the report (skimmable lines by default: one line per attention item, `disposition: clean|needs-attention` last; `--json` prints the object) and exit 0/1 by `disposition`. `--selftest` drives `computeDisposition` as a pure function over a fixture table (each classification rule above, the degrade paths, and the clean case).

**Edge cases:**

- Duplicate issue in both parks block and events → parks block wins (deterministic precedence, first source in the chain).
- `stop_reason` present but not in the escalate class (`queue-drained`, `budget-hit(...)`, `converged/both-dry`, `all-remaining-parked`) → no run-escalation item; a plain budget `stop` is a configured quiet stop, and its undispatched issues already surface as `unreached-budget` issue items.
- Ledger with empty `outcomes` and empty `admitted` (a run that admitted nothing) → clean, exit 0 — an empty run is a valid all-clean.
- Unknown/future outcome token → `auditLedger` flags it `invalid_outcomes` → `incomplete-ledger` attention (fail toward attention, never silently clean).
- Live run (owner running, fresh heartbeat) → the verb classifies whatever is on disk; it is a run-END gate by *usage* (documented: wrappers call it after the agent exits), not by liveness check. No liveness gating — a wrapper that calls it early sees in-flight incompleteness as attention, which is the safe direction.

**Failure modes:**

- **The wrapper never calls the verb.** The signal exists but the host stays green-by-silence. Observable: `docs/guide/unattended.md` wrapper snippet is the guard; run summaries still carry the prose. Means: docs-level mitigation only in this slice; a faff-owned runner entry point that bakes the call in is FAFF-297/298-adjacent follow-on territory.
- **`stop_reason` prose write is skipped by a non-compliant run.** Run-level escalation detection degrades to the abort marker + issue outcomes; a budget-escalated all-shipped run could then read clean. Observable: `summary.md` Stop reason line disagrees with the ledger field's absence. Accepted for v1 (same trust level as every other prose-written ledger field, and `runcheck`'s Stop hook already backstops non-compliant exits).

## 5. SCENARIOS

```
Given a run-ledger.json whose outcomes include FAFF-X: "parked"
  and a summary.md faff-parks block naming FAFF-X with root_cause_class "punt-not-closed"
When faff disposition --run-dir <dir> --json runs
Then it exits 1 and the report contains { kind: "issue-outcome", issue: "FAFF-X",
     outcome: "parked", cause: "punt-not-closed" }
```

```
Given a run-ledger.json whose every outcome is "shipped" or "routed-out",
  no abort entry, and stop_reason "queue-drained"
When faff disposition runs
Then it exits 0 and attention is empty
```

```
Given a run-ledger.json with all outcomes "shipped" and stop_reason "budget-escalated(tokens)"
When faff disposition runs
Then it exits 1 with a run-escalation item carrying cause "budget-escalated(tokens)"
```

```
Given a run-ledger.json with an admitted issue absent from outcomes (a killed run)
When faff disposition runs
Then it exits 1 with an incomplete-ledger item naming that issue
```

```
Given a run dir with no run-ledger.json
When faff disposition --run-dir <dir> runs
Then it exits 3, printing why
```

Non-functional assertions: the verb performs no tracker/network/LLM call and writes no files; interactive behaviour is unchanged (no interactive skill invokes it; the default sink remains ledger → `/faff-wtf`).

## 6. DESIGN DECISION RATIONALE

Collected above in WHAT → Design decisions (locus; label reuse; single exit code; attention-set membership; report-only; no config key; prose-written `stop_reason`) — each concluded with its `**Chosen:**` marker there; not restated here.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the issue's four open questions are settled in Design decisions (label name → reuse `faff-parked`; park vs needs-human → one exit code, grain in JSON; locus → `faff` verb; overlap check → confirmed, only the exit/artifact contract is new).

**Assumptions:**

- **Assumes:** the run-ledger terminal vocabulary is exactly `TERMINAL_STATES` in `bin/faff` (`shipped`, `pr-open`, `parked`, `errored`, `routed-out`, `unreached-budget`) — validated: read at `bin/faff:1078` during explore; the classifier imports/reuses it, never redeclares it.
- **Assumes:** `summary.md` park causes are machine-readable via the fenced `faff-parks` block and `extractParksBlock` exists to parse it — validated: `bin/faff` park-history region (FAFF-152).
- **Assumes:** sentry abort marks the ledger with an `abort` entry (`status: "aborted-resumable"`) and flips a running owner to `aborted-resumable` — validated: `bin/faff` sentry region (FAFF-49).
- **Assumes:** the per-issue durable tracker surfacing (reason comment + `faff-parked` label) fires on every autonomous park path — validated: gateway → Park protocol (shared), steps 3–4; `/faff-graft`, `/faff-prep`, `/faff-beep-boop` all route through it.
- **Assumes:** `docs/guide/cli.md` must gain the new subcommand entry or CI fails — validated: `faff lint-cli-doc` enforces bidirectional coverage (FAFF-237).

## 8. DONE — Definition of Done

### From WHY
- [ ] A headless wrapper's final `faff disposition --run-dir <dir>` call exits non-zero for a run that parked/errored/escalated and zero for an all-clean run (the green-by-silence hole is closed at the call site).

### From WHAT (interface)
- [ ] `faff disposition [--run-dir DIR] [--json] [--root DIR] [--selftest]` exists in `bin/faff`, registered in `COMMANDS` and `REGION_MAP` (factory), and `faff regions check` stays green.
- [ ] Exit codes: 0 clean · 1 needs-attention · 2 usage/malformed ledger · 3 no run dir / no ledger.
- [ ] `--json` emits a DispositionReport `{run_id, disposition, attention[], counts}` with AttentionItem `{kind, issue, outcome, cause}` exactly as specified; default output is skimmable one-line-per-item text ending with the disposition.
- [ ] The verb performs no tracker/network/LLM I/O and writes no files (code inspection + selftest run leaves the run dir byte-identical).

### From WHAT (classification)
- [ ] Outcomes `parked` / `errored` / `unreached-budget` / `pr-open` each produce an issue-outcome attention item; `shipped` / `routed-out` produce none.
- [ ] An escalate-class `stop_reason` (`budget-escalated(...)` prefix, `non-convergence`, `product-incomplete`, `sentry-abort`) produces a run-escalation item even when all outcomes shipped; non-escalate stop reasons produce none.
- [ ] A ledger `abort` entry or `owner.status == "aborted-resumable"` produces an aborted item.
- [ ] `auditLedger.clean == false` produces an incomplete-ledger item naming undispatched/invalid entries.
- [ ] Cause joining: parks-block class wins over events-derived cause; both absent → `cause: null`; a missing/malformed `summary.md` or `events.jsonl` never changes the exit code.

### From HOW
- [ ] `--selftest` drives the pure `computeDisposition` core over a fixture table covering every Scenario above plus the degrade paths (absent `stop_reason`, absent parks block, empty run → clean).
- [ ] Malformed `run-ledger.json` exits 2 naming the file; absent ledger exits 3.

### Wiring and docs (same PR)
- [ ] `plugin/skills/faff-beep-boop/SKILL.md`: the orchestrator-exit step (where `owner.status: "done"` is set) also records `stop_reason: "<Stop reason token>"` on the ledger; the Run-ledger field list documents it as informational/outside the completeness invariant.
- [ ] `docs/guide/cli.md` documents `disposition` (and `faff lint-cli-doc` passes).
- [ ] `docs/guide/unattended.md` shows the headless wrapper pattern: run the agent, then `faff disposition --run-dir <dir>` as the final, exit-propagating step (and states that interactive surfacing is unchanged).
- [ ] No new tracker label, no `.faffrc` key, no interactive-path caller is added (asserted by review; the diff contains none).

**Eval coverage:** none required — the verb is a pure deterministic classifier (no LLM-judgement seam introduced or changed); `--selftest` + the existing CLI test-runner pattern cover it.

**Integration smoke test:**

```
1. Fabricate .faff/runs/run-t/{run-ledger.json with FAFF-A shipped + FAFF-B parked,
   summary.md with a faff-parks block for FAFF-B}
2. faff disposition --run-dir .faff/runs/run-t --json
3. ASSERT exit 1; report.attention == [ {kind issue-outcome, issue FAFF-B, outcome parked, cause <class>} ]
4. Flip FAFF-B to shipped; re-run; ASSERT exit 0, attention []
```

## Already shipped against this surface

Related Done work (none supersedes the premise — all are the read/production side; the exit/artifact contract remains undelivered):

- FAFF-289 — `faff audit` run-reconstruction forensics: the **read** side this issue explicitly pairs against; deliberately non-gating (exit 0 even when incoherent).
- FAFF-35 — `faff events` run-event substrate: cause-enrichment input here, not a verdict.
- FAFF-38 — `faff run-done` terminating-condition predicate: decides *when a run ends*, report-only exit 0 by design; not a post-run exit contract.
- FAFF-398 — mid-run fail-closed on review-chain exhaustion: *produces* needs-human verdicts; surfacing stays park-protocol + summary.
- FAFF-187 — `faff label` mechanical op: the mechanism the (reused) `faff-parked` write already rides.
- FAFF-225 — `faff lights-out` launcher: exits non-zero only at *launch* refusal; no run-end verdict.

Verdict: premise holds — proceed unchanged.

## Methodology critique

*(agile-delivery lens, issue-critique named output)*

- **Right-sized?** No issues — one CLI verb + one additive ledger field + docs is a single 1–3 day unit; the webhook and config-seam halves are correctly cut to extension points rather than bundled.
- **Workstream fit?** No issues — sits squarely in the portable-runtime "quick wins for a stable L3" cluster (with shipped FAFF-398 and open FAFF-397/395), outcome-named toward headless-runtime hardening.
- **Deps surfaced?** No issues — consumes only shipped substrates (ledger, faff-parks block, events, park protocol). FAFF-403 (retry-later disposition class) is adjacent but not a blocker either way: this verb classifies today's terminal vocabulary and extends when the vocabulary does. FAFF-397 (blocking reconcile) is independent and composes cleanly after.
- **Risk profile?** No issues — pure classifier over existing on-disk state, no novel integration; no de-risking spike warranted. Residual risk (wrapper never calls the verb) is named in the spec's failure modes with its mitigation locus.

confidence: high

spec-review: approve
