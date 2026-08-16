# Spec — FAFF-720: Tamper-evident audit at the PR boundary — commit a run-level anchor for no-PR runs? (reopens FAFF-596)

> Spec: faffter-dark-nlspec · 2026-08-10 · autonomous · confidence: medium. Full spec on Linear FAFF-720.

This is a **design-settle spec**. Its deliverable is a *decision*, recorded as an ADR (authored later by faff-graft's `adr` slot from the settled decision plus this spec's rationale), and — only if the decision is "yes, commit a run-level anchor" — a follow-on issue to build the mechanism. It does **not** ship code itself.

## 1. WHY — Problem and Principles

**Load-bearing model.** faff's committed tamper-evidence is minted *at the PR boundary*: `faff events anchor` runs at faff-graft Step 9b only after review passes and a PR opens (or a local merge lands), byte-copying `events.jsonl` + `run-ledger.json` + per-issue floor files + a CLI-computed `chain-head.json` witness into the committed `.faff/anchors/<run>/<issue>/` tree, re-verified by `governance-check` from a PR's changed paths. Every mechanism in that chain is keyed to an issue *reaching merge*. A run whose issues park / error / route-out / supersede **opens no PR**, so it mints **no anchor** — its only record is the tracker (durable, human-legible, but not tamper-evident, not in git history) and the gitignored, ephemeral run-dir. This spec settles whether that PR-boundary stop is a **deliberate scope decision** or a **gap to close**, and if the latter, the shape of the fix.

**Design principles.**

- **Bind evidence to a claim, not to activity.** faff's existing anchor binds review evidence to *merged code*. Any run-level anchor must state *what claim it protects* for a run that shipped nothing; an anchor with no claim to bind is ceremony. This is the fault line the core decision turns on.
- **Reuse the evidence-class roster, add no new write-authority class.** A run-close anchor's natural contents (ledger + events + summary + verdicts) are *already* evidence-class under ADR 0077 / FAFF-519.
- **The commit moment must exist on every exit path.** An anchor that fires on only *some* exits is worse than none — it makes absence ambiguous.
- **git-only mode is the strong case, reasoned about explicitly.** Under git-only mode (ADR 0075 / FAFF-556/557/559) a park/error leaves *zero* durable record anywhere; the decision cannot be made for the tracker-backed case and silently inherited by git-only.

**Reference context.**

| System | Relevance |
|---|---|
| `bin/lib/events.js` (anchor branch) | The per-PR anchor: byte-copies chain + ledger + floor files + `chain-head.json` witness into `.faff/anchors/<run>/<issue>/`. The shape a run-level anchor would mirror. |
| `bin/lib/governance-check.js` (`evaluateAnchorDir`, `deriveAnchorDirs`) | `pass = integrity && merge_floor`; completeness/budget/liveness n/a ("an ANCHOR is a per-PR snapshot, not a live run dir"). Discovery is from a PR's changed paths only — a no-PR run is invisible. |
| `bin/lib/gitignore-ensure.js` | `.faff/*` ignores contents; `!.faff/anchors/` is the *only* carve-out. A new committed path needs its own `!` line + selftest. |
| `bin/lib/disposition.js` | `faff disposition` (FAFF-396): pure, classifies a run `clean` vs `needs-attention`, exits non-zero for parked/errored/no-PR runs. The existing non-tamper-evident run-level signal. |
| `skills/faff-beep-boop/SKILL.md` (§ "At orchestrator exit") | The exit edit setting `owner.status:"done"` + `stop_reason` on *every* path. The only universal run-close attach point. |
| `records/adr/` (0075, 0077, 0081/0084, 0056) | No ADR for the anchor mechanism itself and none proposing a run-level anchor — the gap is genuinely undecided. Latest record `0100`; new ADR ~`0101`. |

## 2. OUT OF SCOPE

- **Building the anchor mechanism** — the decision may be "no"; a follow-on issue is filed only on "yes".
- **Changing the per-PR anchor (FAFF-568/623)** — this spec adds a *sibling* record, additive.
- **Retrospective anchoring of historical runs** — gitignored, already-deleted run-dirs cannot be back-filled.
- **A new write-authority class** — the contents are already evidence-class (ADR 0077).
- **Tracker-comment tamper-evidence** — a different, larger problem, out of this project.

## 3. WHAT — The decision space

| Shape | What it commits | Where | Cost |
|---|---|---|---|
| **1. Evidence branch** | Run-level records accreting at run-close | An orphan/side branch, never merged to `main` (the FAFF-596 shape) | Keeps `main` clean; needs a new branch object, its own `governance-check` discovery path, a new gitignore carve-out, and a retention/pruning policy (runs accrete forever). |
| **2. Run-summary commit to main** | A run-level anchor commit at run-close | Directly onto `main` | Simplest discovery (rides `main` like the per-PR anchor); noisier history (a commit per run regardless of code). |
| **3. Tracker-is-sufficient** | Nothing new | — | Records the tracker record + `faff disposition` non-zero exit as the deliberate governance position ("PR-only, by design"). Zero machinery; but leaves git-only mode with no durable record at all. |

**Anchor record shape (per-run granularity, so a "yes" build is unambiguous):**

```
RECORD RunLevelAnchor:                 # committed at run-close for a non-PR run
  run_id: String                       # the run-dir basename; the anchor path key
  layout: "<anchor-root>/<run_id>/"    # per-run dir; per-issue subdirs inside
  contents:                            # evidence-class only (ADR 0077) — never the raw run-dir
    - run-ledger.json / events.jsonl / summary.md          # byte-copies
    - <issue>/review-verdict.json / <issue>/ac-checklist.json   # per non-PR issue, where present
    - chain-head.json                  # CLI-COMPUTED witness (never hand-supplied)
  CONSTRAINT contents ⊆ evidence-class roster (correctiveIntegrityDirs)
```

**Design decisions.**

- **Core question — commit a run-level anchor, and if so which shape?** **Punt:** run-level anchor (evidence branch / run-summary commit) **or** "PR-only, by design" — needs human (decides: architecture). Rests on a value the evidence does not decide (see §6).
- **Commit moment.** **Chosen:** the run-close orchestrator-exit edit (`owner.status:"done"` + `stop_reason`), the only moment on *every* exit path. Settled regardless of which shape wins.
- **Granularity.** **Chosen:** per-run, keyed by `run_id`, per-issue subdirs inside — the run-close hook fires once per run; `faff disposition` already classifies at run granularity.
- **Evidence subset + write-authority.** **Chosen:** ledger + events + summary + per-issue verdicts + CLI witness, never the raw run-dir (FAFF-519); already evidence-class (ADR 0077), so **no new write-authority class**.

## 4. HOW — Behavior

**If "yes" (shape 1 or 2) — emitter** (once, at the orchestrator-exit edit): determine non-PR issues (ledger outcomes ∉ {shipped, pr-open}); if the run is fully PR-covered, return; else byte-copy the evidence subset into `<anchor-root>/<run_id>/`, compute `chain-head.json` via the same CLI witness path the per-PR anchor uses, commit (shape 1: onto the evidence branch; shape 2: onto `main` as one run-summary commit), and append a ledger-write event so the mutation joins the chain. **Anti-pattern:** minting from a sub-path only some exit branches reach — reintroduces the exact PR-boundary ambiguity this ticket closes.

**If "yes" — the `governance-check` leg. Chosen (conditional on "yes"):** verify via the same two legs as the per-PR anchor — `integrity` (re-hash via `verifyChain`) + `merge_floor` (re-validate per-issue floor files), completeness/budget/liveness n/a, exactly as `evaluateAnchorDir`. The one *new* mechanism: extend `deriveAnchorDirs` discovery beyond a PR's changed paths to enumerate run-level anchors from the committed anchor tree (shape 2) or evidence branch (shape 1). Reuses one verifier core (no forked hash-walk), per FAFF-621's composition rule.

**If "yes" — gitignore carve-out. Chosen (conditional on a new committed path):** add a dedicated `!` negation line + selftest to `gitignore-ensure.js`, mirroring `!.faff/anchors/`. (If shape 2 reuses `.faff/anchors/<run>/`, no new carve-out — a mechanism sub-choice for the build.)

**If "yes" — git-only interaction. Chosen:** the ADR **must** address git-only explicitly; the case for a committed record is **strictly stronger** there (no tracker fallback). It must state whether git-only gets the committed record unconditionally, conditionally, or as a named deliberate hole.

**If "no" (shape 3) — the explicit governance position.** The ADR records: *for a tracker-backed run, the tracker record (park label + reason comment + hard-floor `summary.md`) plus `faff disposition`'s non-zero exit IS the audit record; the committed tamper-evident anchor is deliberately PR-only, because its claim binds review evidence to merged code and a non-shipping run has none to bind.* Written as the position, not left implicit — and still stating the git-only carve-out decision.

## 5. Scenarios — born-verifiable objectives (assertion-form, decision ticket)

- The ADR states whether a non-PR run gets a committed tamper-evident record, and if yes, **which shape**.
- The ADR names the **commit moment** (run-close orchestrator-exit) and the **evidence subset** (never the raw run-dir).
- The ADR names what `governance-check` would verify (integrity + merge_floor, mirroring `evaluateAnchorDir`) **or** why verification stays PR-only.
- The ADR addresses git-only mode explicitly (unconditional / conditional / named deliberate hole), not inherited silently.
- If "tracker is enough," the ADR writes that as the explicit governance position with rationale, not an unaddressed gap.

## 6. Design Decision Rationale

**Is the core shape choice settled by the evidence, or a genuine human-governance value call? — Punt (decides: architecture).** The evidence *sharpens* the tradeoffs and even eliminates shape 3 as a *universal* answer (git-only has no tracker fallback), but it does not settle the crux: *what is tamper-evidence for?* If it binds review evidence to **merged code** (what FAFF-568 does), a non-shipping run has no code to bind and PR-only is coherent *by design* (shape 3 for tracker-backed runs). If it makes the **run's decisions** non-repudiable, every run needs an anchor (shape 1 or 2). Both readings are internally consistent with faff's principles; the codebase does not adjudicate. Shape 1 vs 2 is additionally a maintainer aesthetic/policy call. Forcing a `Chosen:` would fabricate a governance position the evidence does not support.

**Recommendation (advisory, does not close the Punt):** a **mode-conditional** position — "PR-only, by design" for **tracker-backed** runs (the tracker + `faff disposition` already give a durable record, and there is no merged code to bind), **and** a committed record (shape 1 or 2) for **git-only mode**, where the tracker fallback does not exist. If a unified answer is required, shape 2 is the lower-machinery committed option; shape 1 buys clean `main` at the cost of a retention policy.

Downstream decisions (all **Chosen**, all conditional on "yes"): commit moment (orchestrator-exit, rejected runcheck/reconcile — not on all abort paths); per-run granularity (rejected per-issue top-level — a second fan-out, no discovery benefit); evidence subset (rejected sensor/resume-class artifacts); governance-check leg (rejected a bespoke verifier — forks the hash-walk); gitignore carve-out. **Second Punt (decides: architecture):** evidence-branch retention/pruning policy — only bites if shape 1 wins; runs accrete forever.

## 7. Open Questions and Assumptions

**Open Questions.**
- **Punt:** core — run-level anchor (shape 1 / shape 2) or tracker-is-sufficient (shape 3) — needs human (decides: architecture). Everything downstream is settled and awaits only this yes/no + shape.
- **Punt:** evidence-branch retention/pruning (unbounded / time-windowed / count-capped) — needs human (decides: architecture). Only bites under shape 1.

**Assumptions.**
- **Assumes:** the orchestrator-exit edit remains the single universal run-close point on every exit path. *Validation:* confirm `owner.status:"done"` + `stop_reason` on clean-drain/all-parked/budget-hit before a "yes" build wires the emitter — verified present at spec time.
- **Assumes:** the per-PR anchor's evidence subset stays evidence-class under the ADR 0077 roster (`correctiveIntegrityDirs()`) — verified present at spec time.

## 8. DONE — Definition of Done

DONE is that the **ADR records the enumerated decisions**, plus (only on "yes") a filed follow-on build issue.

- [ ] The ADR states whether the PR-boundary stop is a deliberate scope decision or a gap, with the "what is tamper-evidence for" rationale explicit.
- [ ] The ADR records the core decision (shape 1 / 2, or shape 3 "PR-only by design"), not left implicit; if shape 3, the "no merged code to bind" rationale is affirmative.
- [ ] The ADR names the commit moment (run-close orchestrator-exit, every path), the evidence subset (never the raw run-dir), and per-run granularity.
- [ ] The ADR states what `governance-check` would verify (integrity + merge_floor + the `deriveAnchorDirs` discovery extension) **or** why it stays PR-only.
- [ ] The ADR addresses git-only mode explicitly (unconditional / conditional / named deliberate hole).
- [ ] If shape 1, the ADR names a retention/pruning decision (or records it as a further Punt).
- [ ] The ADR is authored as the next-sequential record (~`records/adr/0101-...`) by faff-graft's `adr` slot.
- [ ] **Only on "yes":** a follow-on build issue is filed for the emitter + `governance-check` leg + gitignore carve-out.

confidence: medium

## Methodology critique (agile-delivery)

- **right-sized?** No issues. A single decision unit — settle one architectural Punt, record it as an ADR — with a clean decide/build boundary (build issue filed only on "yes"). Decision and mechanism are genuinely independent units. The second Punt (retention/pruning) belongs inside this ADR as a recorded open question, not a split.
- **workstream fit?** No issues. This is the keystone question of "Graft evidence is tamper-evident end-to-end" — the literal load-bearing word ("end-to-end"). Converges tightly, no "while we're at it" drift.
- **deps surfaced?** The four Related links are correctly non-blocking for a decision. But the "yes" build's `evaluateAnchorDir`/`deriveAnchorDirs` extension builds directly on FAFF-623's anchor-dir machinery (only Done-*adjacent*) — recommend the follow-on build issue gets an explicit `blockedBy` → FAFF-623, and a one-line ADR note that it reopens/supersedes FAFF-596 (deduped into 623) so the reopen is traceable.
- **risk profile?** No spike — this issue *is* the de-risking. One risk to manage inside the ADR: it pre-settles a raft of downstream "Chosen" decisions before the core Punt resolves, and under shape 3 most are moot. Gate every downstream "Chosen" behind the Punt's outcome ("if a committed record is adopted, then…"), which the mode-conditional recommendation already sets up.

---

## Spec refresh — core decision settled (reprep, interactive)

> Spec: faffter-dark-nlspec · 2026-08-12 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-720.

**Revised 2026-08-12** — the human settled the core architecture Punt (and its dependent sub-Punt). This **supersedes** the retained `medium` verdict and the 2026-08-11 autonomous park below. Confidence re-rates **medium → high** (both open Punts now closed; spec-review **approve** stands — the resolution removes Punts, it does not change the approach the four lenses cleared). Freshness re-verified: `events.js` / `governance-check.js` / `disposition.js` / `gitignore-ensure.js` and `evaluateAnchorDir`/`deriveAnchorDirs` all present; no ADR yet answers this, so the decision was genuinely still open.

### Settled decisions (human-authored)

1. **Core — `Chosen:` mode-conditional.** Tamper-evident committed audit stays **PR-only, by design, for tracker-backed runs** — the tracker record (park label + reason comment + hard-floor `summary.md`) plus `faff disposition`'s non-zero exit *is* the audit record, and there is no merged code for the anchor's claim to bind. A **committed run-level anchor is minted for git-only mode**, where no tracker fallback exists and a park/error otherwise leaves zero durable record. (Rationale: *tamper-evidence binds review evidence to merged code* — so a non-shipping tracker-backed run has nothing to bind, while git-only is the case where the gap actually bites.)
2. **git-only anchor shape — `Chosen:` shape 2 (run-summary commit).** The git-only run-level anchor is a single run-summary anchor committed at run-close, reusing the `.faff/anchors/<run>/` discovery path — lower machinery, no new branch object. **This dissolves the second Punt:** the evidence-branch retention/pruning policy only bit under shape 1, which was not chosen.

Everything downstream was already `Chosen` in the spec and is unchanged: commit moment = run-close orchestrator-exit edit (every path); per-run granularity; evidence subset = ledger + events + summary + per-issue verdicts + CLI witness, never the raw run-dir (FAFF-519); the `governance-check` leg = integrity + merge_floor mirroring `evaluateAnchorDir`, plus the `deriveAnchorDirs` discovery extension; the gitignore carve-out.

### ADR promotion intent (updated)

On build, faff-graft's `adr` slot authors the **next-sequential** record — the log is now at `0108`, so **~`0109`** (the spec's earlier `~0101` estimate is stale). The ADR records:
- Core: **mode-conditional** — PR-only for tracker-backed (with the "no merged code to bind" rationale stated affirmatively), committed run-level anchor for git-only.
- git-only shape: **shape 2 (run-summary commit)**; the evidence-branch retention Punt is closed as moot (shape 1 not chosen).
- Commit moment (run-close orchestrator-exit, every path), evidence subset (never the raw run-dir), per-run granularity.
- What `governance-check` verifies for a run-level anchor (integrity + merge_floor + the `deriveAnchorDirs` discovery extension).
- git-only addressed explicitly — it is the case that **gets** the committed record (unconditional for git-only).

**Follow-on (decision is "yes" for git-only):** file a build issue for the emitter + `governance-check` leg + gitignore carve-out, `blockedBy` → FAFF-623, with an ADR note that it reopens/supersedes FAFF-596 (deduped into 623).

**Routing:** `graft` — prepped at high confidence, decision settled; ready to author the ADR.

confidence: high
