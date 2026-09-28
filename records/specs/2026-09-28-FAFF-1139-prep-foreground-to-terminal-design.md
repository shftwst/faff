# Spec: FAFF-1139 — Prep-queue drain must reach attach in-turn (foreground-to-terminal + inflight bracketing)

> Spec: faffter-dark-nlspec · 2026-09-28 · interactive · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-1139.

This is a buildable nlspec for **FAFF-1139**, "Beep-boop re-preps unfinished issues every drain; backgrounded prep subagents die on cage exit." Audience: the build agent that will implement the faff-repo fix, and the human reviewers who gate the PR. It scopes only the faff-side delta; the runner-side halves are named as out of scope with their extension point.

## Already shipped against this surface

This surface is heavily covered by Done work. **Do not rebuild any of it.** The fix here is the residual delta only.

| Issue | State | What it already delivered |
|---|---|---|
| FAFF-1096 | Done (2026-09-26) | Producer-dispatch inflight marker fixed for Claude Code's always-background Agent tool; the `CLAUDE_CODE_SESSION_ID` owner-scope tier in `inflightcheck.js`. |
| FAFF-884 | Done | The turn-survival invariant + the `inflightcheck` Stop hook (refuse turn-end on a still-open own marker). |
| FAFF-854 / FAFF-782 / FAFF-530 / FAFF-439 | Done | Headless `claude -p` / background-dispatch stall handling (L4 spec-review, the 600s ceiling, build-subagent foreground-to-terminal). |
| FAFF-178 / FAFF-258 | Done | faff-prep same-turn attach: attach is the durability boundary per issue. |
| FAFF-950 | Done | Spec-review fan-out inside the prep subagent's single turn (turn-budget hold). |

The premise still holds empirically: the re-prep loop was observed on 2026-09-27, the day **after** FAFF-1096 merged. So this ticket is **not** superseded by the cluster. What remains unbuilt is the "deferred prep-producer isolation" that the isolation floor explicitly names as not-yet-landed (`faff-beep-boop/SKILL.md:565`): the prep-queue drain neither states a foreground-to-terminal posture nor brackets its faff-prep dispatch with an inflight marker.

## 1. WHY — Problem and Principles

**The core model:** attach is the durability boundary. A prep run only becomes durable when it saves the spec comment to the tracker (FAFF-178 same-turn-attach). A spec drafted in the run dir but not yet attached leaves **nothing** resumable, so the cheapest correct fix is to guarantee prep always *reaches attach within its dispatching turn*, rather than adding a second durable store for half-produced specs.

**Problem statement.** A beep-boop drain on the fly-ci-l3-runner fanned ~10 prep candidates out as background subagents and ended its top-level `claude -p` turn on a progress report ("the prep agents are running now"); the `docker --rm` cage tore down and the next 5-minute drain re-fetched all 11 issues and re-prepped from scratch, burning ~$50 per drain with no convergence. Only issues whose prep fully completed and attached a spec survived (FAFF-1132 kept its spec; FAFF-1110, drafted only in the run dir, was lost). The fix makes the prep-queue drain foreground-await each dispatch and never end a turn on a "prep running" progress report, and brackets each dispatch with an inflight marker so a stranded prep is visible to the mechanical backstop.

**Design principles.**

**Mirror the existing precedent, do not invent one.** faff-graft already carries the exact posture this needs (`faff-graft/SKILL.md:349`, "Foreground posture … foreground-to-terminal"), enforced by `validate-adapters` anchor phrases and the `background-fence`/`inflightcheck` hooks. The beep-boop prep-queue drain must adopt the *same* wording and the *same* bracketing faff-prep already uses for its spec-review fan-out (`faff-prep/SKILL.md:167`). No new mechanism is designed here.

**Attach is the durability boundary; do not add a second store.** With a foreground-to-terminal prep dispatch, prep completes-and-attaches in-turn, so there is no drafted-but-unattached residue to resume. A per-issue prep-production resume store would duplicate state that FAFF-178 already makes redundant. See the Design Decision Rationale.

**The faff prose cannot keep a cage alive.** The incident's terminal cause (the `docker --rm` cage reaping the parent before the Stop hook fired) is a runner-side lifecycle gap. A faff-repo rule can only ensure the drain *never voluntarily* ends a turn mid-prep; it cannot survive an externally-killed parent. That half is out of scope (below).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md:183-194` | Markdown (skill prose) | The prep-queue drain, section 3. The prose to change. |
| `plugin/skills/faff-graft/SKILL.md:349` | Markdown | The foreground-to-terminal posture to mirror. |
| `plugin/skills/faff-prep/SKILL.md:167` | Markdown | The `inflightcheck --open/--close` bracketing pattern to mirror. |
| `plugin/skills/faff/bin/lib/validate-adapters.js:74` | JavaScript | `ANCHOR_PHRASES` map; add a `faff-beep-boop` entry. |
| `plugin/skills/faff/bin/lib/validate-adapters.js:65` | JavaScript | `SKILL_LINE_BASELINE`; bump `faff-beep-boop`. |
| `plugin/skills/faff/bin/lib/inflightcheck.js` | JavaScript | The Stop hook + `--open/--close` CLI (unchanged; consumed as-is). |
| `plugin/skills/faff/bin/lib/turncheck.js:202-204` | JavaScript | State-based backstop; already blocks the mid-prep death (no change). |

**Scope statement.** This sits in the beep-boop prep-queue drain (step 3) and its `validate-adapters` enforcement, one realization of the isolation floor's deferred prep-producer arm.

## 2. OUT OF SCOPE

- **Cage-teardown-before-hook timing** — the `docker --rm` cage reaping the parent before the `Stop` hook fires. *Why excluded:* a faff prose rule cannot keep a cage alive; this is drain.sh / cage lifecycle. *Extension point:* the **fly-ci-l3-runner repo** (a sibling ticket), not this repo.
- **`faff disposition` invoked without `--run-dir` / `FAFF_RUN_DIR`** — `disposition.js` resolves explicit `--run-dir` → `$FAFF_RUN_DIR` → none, with no autodiscovery (FAFF-858 deliberately removed the newest-ledger guess) and exits 3 by design. *Why excluded:* a faff fix cannot re-add autodiscovery without reverting FAFF-858; the runner must pass the flag. *Extension point:* **fly-ci-l3-runner** drain.sh must export `FAFF_RUN_DIR` or pass `--run-dir`.
- **Transcript-stream persistence** — faff persists `events.jsonl` (append-only, hash-chained), not a conversation transcript. *Why excluded:* the diagnosability gap is the runner's. *Extension point:* **fly-ci-l3-runner** drain.sh persists the `claude -p` stream; tracked as the diagnosability comment on FAFF-1139 and depended on by **FAFF-1140** (the runner-side diagnosability half).
- **A per-issue prep-PRODUCTION resume store** — a durable store for a spec drafted-but-not-attached. *Why excluded:* with the foreground-to-terminal fix landed, prep attaches in-turn, so there is no unattached residue to resume; the store duplicates state FAFF-178 already covers. *Extension point:* if a future change ever makes prep production span turns, a store analogous to `.faff/resume/<issue>/spec-review-hold.json` (which resumes only the spec-review gate, never production) would live under `.faff/resume/<issue>/`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Foreground-to-terminal | A dispatch posture: the dispatcher awaits each Agent-tool call to its terminal result and never ends its turn on a "still running" progress report, only bearing terminal outcomes or a sanctioned hold. |
| Inflight marker | A per-dispatch on-disk file (`.faff/inflight/<owner-scope>/<key>.json`) written by `faff inflightcheck --open` before an Agent dispatch and cleared by `--close` after its result is consumed; a still-open own marker blocks turn-end. |
| Attach boundary | The point at which a prep run saves the spec comment to the tracker; the durability boundary for a produced spec (FAFF-178). |

**The `inflightcheck` bracket (consumed as-is, not modified).** The CLI already exists:

```
faff inflightcheck --open --key <ISSUE-XX> --describe prep    # before the faff-prep dispatch
faff inflightcheck --close --key <ISSUE-XX>                   # after the prep return is consumed
```

`--key` must match `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` (an issue id like `FAFF-1132` satisfies this). This is the identical pattern faff-prep applies to its spec-review fan-out at `faff-prep/SKILL.md:167`.

**`ANCHOR_PHRASES` entry (validate-adapters).** Add a `faff-beep-boop` key to the module-scope map. The phrase(s) must be literal strings the new prose genuinely carries:

```
ANCHOR_PHRASES = {
  "faff-graft":     ["run_in_background: true", "never end a turn", "foreground-to-terminal"],
  "faff-beep-boop": ["foreground-to-terminal"]    # NEW — the prep-queue-drain posture anchor
}
```

The lint at `validate-adapters.js:988` already iterates `ANCHOR_PHRASES[name]` and FAILs on any missing phrase (case-insensitive), so adding the entry makes the prose clause born-verifiable with no new lint code.

**Design decisions (markers; full rationale in section 6).**

- Durability strategy: **Chosen:** make prep reach attach in-turn via (a) foreground-to-terminal prose + (b) `inflightcheck` bracketing; a prep-production resume store is out of scope. `(decides: architecture)`
- Enforcement layer: **Chosen:** add a `faff-beep-boop` `ANCHOR_PHRASES` entry so the prose clause is validate-adapters-gated, reusing the existing per-skill lint; do not write a new lint. `(decides: architecture)`
- Marker key convention: **Chosen:** `--key <ISSUE-XX> --describe prep`, mirroring faff-prep's spec-review bracket, so the two prep-side arms share one marker grammar. `(decides: architecture)`

## 4. HOW — Behaviour

**Overview.** Two prose edits to `faff-beep-boop/SKILL.md` section 3 (the prep-queue drain), one data edit and one baseline bump to `validate-adapters.js`. No change to `inflightcheck.js`, `turncheck.js`, `background-fence.js`, `prepcheck.js`, or `disposition.js` behaviour; the hooks are consumed as-is.

**(a) Foreground-to-terminal prose in the prep-queue drain.** The current prose (`SKILL.md:185`, "For each candidate, invoke the `faff-prep` skill via the Skill tool in autonomous mode"; `:194`, "After every prep return, run the between-units checkpoint before dispatching the next candidate") is already sequential and foreground in intent, but it never *states* the posture, so the observed 10-parallel-background fan-out was a deviation the prose did not forbid. Add a posture clause mirroring `faff-graft/SKILL.md:349`:

```
PROCEDURE prep_queue_drain(candidates):
  FOR each candidate IN candidates:
    1. faff inflightcheck --open --key <candidate> --describe prep      # (b)
    2. dispatch faff-prep via the Skill tool, run_in_background: false  # foreground-await
    3. consume the prep return (reconcile against attach ground truth, per :194)
    4. faff inflightcheck --close --key <candidate>
    5. between-units checkpoint
  # Foreground-to-terminal: the drain NEVER ends its turn on a "prep agents running"
  # progress report. It ends a turn only with the prep queue drained OR a sanctioned hold.
```

The clause must contain the literal phrase `foreground-to-terminal` (the anchor) and state: prep dispatch is foreground-awaited, never `run_in_background: true`; the drain never ends a turn on a "prep agents running" progress report; a turn ends only with the queue drained or a sanctioned hold.

**(b) Inflight bracketing.** Wrap each faff-prep dispatch in the drain with `--open`/`--close` as shown. This closes the enumeration gap: today the drain opens **no** marker for prep, so a stranded prep producer is invisible to `inflightcheck` (it only sees markers it `--open`'d) and catchable only by the state-based `turncheck`. Bracketing lands the "deferred prep-producer isolation" that `SKILL.md:565` names as not-yet-built.

**Behaviour summary.** With (a)+(b), a prep dispatch that the drain would otherwise strand at turn-end is refused by `inflightcheck` (open own marker) *and* by `turncheck` (running owner + clean queue), so the turn cannot end mid-prep; the prep therefore completes-and-attaches in-turn, and the next drain finds a durable spec on the tracker rather than re-prepping.

**Edge cases and error handling.**

- **Prep return already handled by the existing reconcile.** The `--close` fires after the reconcile at `SKILL.md:194` consumes the return, so an errored/parked prep still closes its marker (the outcome is terminal for that candidate). Do not close before the reconcile.
- **Marker charset.** An issue id (`FAFF-1132`) matches `INFLIGHT_KEY_RE`; no sanitisation needed. Do not prefix the key with a dot.
- **`--close` is idempotent** (`inflightcheck.js:277`, "absent = success"), so a double-close or a close on a never-opened key is safe.
- **Harness with no foreground option** (interactive Claude Code) is already safe: it tracks the child across turn-end and re-invokes the parent; `inflightcheck` emits a non-blocking note there rather than blocking. The posture binds where the stranding premise holds (headless `claude -p` / a live run dir), exactly as faff-prep:167 scopes it.

**Failure modes.**

- **The failure:** even with (a)+(b), the cage may reap the parent before the `Stop` hook fires, so re-prep is reduced but not eliminated. *How you'd know:* a drain still ends mid-prep (an open marker + `owner.status:"running"` in the reconstructed run dir) despite the prose forbidding a voluntary turn-end. *What it means:* the residue is the runner-side cage-lifecycle gap (out of scope, FAFF-1140-adjacent); narrow the faff claim to "the drain never *voluntarily* ends mid-prep," and hand the involuntary-reap half to the fly-ci-l3-runner ticket. The faff-side hole is closed.
- **The failure:** the anchor phrase is added to `ANCHOR_PHRASES` but the prose does not actually carry `foreground-to-terminal`, so the lint passes vacuously or FAILs. *How you'd know:* `faff validate-adapters` FAILs `faff-beep-boop` on the missing phrase. *What it means:* proceed only when both the map entry and the literal prose phrase are present; the lint is the born-verifiable check that they agree.

**Anti-pattern:** adding a per-issue prep-production resume store "for safety." Why: it duplicates the attach boundary FAFF-178 already provides, and with (a)+(b) there is no unattached residue to resume, so the store is dead state that drifts.

**Anti-pattern:** re-deriving the foreground posture in new words. Why: the phrase `foreground-to-terminal` is a lint anchor; paraphrasing it defeats the validate-adapters gate.

## 5. Scenarios — born-verifiable main objectives

```
Given a beep-boop prep-queue drain running headless with a live run dir
When it dispatches faff-prep for a candidate and that dispatch is left in flight at turn-end
Then faff inflightcheck refuses the turn-end on the open own marker for that candidate
  (not only turncheck's state-based refusal)
```

```
Given the faff-beep-boop SKILL prose
When faff validate-adapters lints it
Then it passes only if the prep-queue-drain prose carries the literal phrase "foreground-to-terminal"
  AND the faff-beep-boop line count is within the bumped SKILL_LINE_BASELINE
```

```
Given a prep dispatch bracketed with faff inflightcheck --open --key FAFF-XXXX --describe prep
When the drain consumes the prep return and calls faff inflightcheck --close --key FAFF-XXXX
Then the open marker for FAFF-XXXX is cleared and a subsequent turn-end is not refused on that key
```

- The prep-queue drain prose MUST NOT instruct `run_in_background: true` for a faff-prep dispatch (assertion; born-verifiable by grep + the anchor lint).

## 6. Design Decision Rationale

**Should the fix add a prep-production resume store, or make prep reach attach in-turn?**
- *Prep-production resume store:* durable `.faff/resume/<issue>/` record of a drafted-but-unattached spec so the next drain resumes rather than re-produces. Pro: survives an involuntary parent death mid-production. Con: heavier; duplicates the attach boundary; adds a new resumable state (production) alongside the existing review-gate resume, doubling the resume surface; and with the in-turn fix it is dead code because there is no unattached residue.
- *Make prep reach attach in-turn (a+b):* foreground-to-terminal prose + inflight bracketing so the turn never voluntarily ends mid-prep. Pro: cheap, mirrors two existing precedents (graft posture, prep-review bracket), lands the already-named deferred isolation arm. Con: does not survive an involuntary cage-reap (but that is runner-side, out of scope).
- **Chosen:** (a)+(b) only. Rationale: attach is already the durability boundary (FAFF-178); the cheapest correct fix is to guarantee prep crosses it in-turn. The resume store is recorded as an out-of-scope extension, not built here.

**Where should the foreground-to-terminal clause be enforced?**
- *Options:* rely on `turncheck` state-based backstop alone; add a new bespoke lint; or add a `faff-beep-boop` entry to the existing data-driven `ANCHOR_PHRASES` map.
- **Chosen:** add the `ANCHOR_PHRASES` entry. Rationale: the per-skill anchor lint already exists (`validate-adapters.js:988`, generalised from the hard-coded graft branch by FAFF-884), so this is a one-line data edit that makes the prose clause born-verifiable with zero new lint code. `turncheck`/`inflightcheck` remain the runtime backstops; the lint guards against prose drift.

**What marker key/describe should the bracket use?**
- **Chosen:** `--key <ISSUE-XX> --describe prep`, mirroring faff-prep's `--describe spec-review` bracket. Rationale: one marker grammar across both prep-side arms; the issue id is a valid key charset with no sanitisation.

At the time of writing (2026-09-28), `background-fence.js:109-111` explicitly does not fence Agent/prep dispatches (only Bash gate/test-family + Monitor), so the anchor lint + `inflightcheck`/`turncheck` hooks are the only faff-side guards for the prep arm; revisit if a future fence covers Agent dispatches.

## 7. Open Questions and Assumptions

**Open Questions.** None. All decisions are closed above.

**Assumptions.**

- **Assumes:** the `faff inflightcheck` CLI accepts `--open --key K --describe T` and `--close --key K` with idempotent close. *Validate:* confirmed at `inflightcheck.js:242,257,277`; the build agent may re-confirm with `faff inflightcheck --open --key TEST-1 --describe prep` then `--close --key TEST-1` in a scratch run dir.

## 8. DONE — Definition of Done

### From WHY
- [ ] The prep-queue drain (`faff-beep-boop/SKILL.md` section 3) states that a prep dispatch is foreground-awaited and the drain never ends a turn on a "prep agents running" progress report (grep for the posture clause).

### From WHAT (interfaces / enforcement)
- [ ] `ANCHOR_PHRASES` in `validate-adapters.js` gains a `"faff-beep-boop"` entry containing `"foreground-to-terminal"`.
- [ ] `SKILL_LINE_BASELINE["faff-beep-boop"]` is bumped to the new committed line count of the edited SKILL.
- [ ] `faff validate-adapters` passes for `faff-beep-boop` (anchor phrase present AND within line baseline).

### From HOW (behaviour)
- [ ] Each faff-prep dispatch in the prep-queue drain is bracketed by `faff inflightcheck --open --key <issue> --describe prep` before dispatch and `faff inflightcheck --close --key <issue>` after the prep return is consumed (after the existing reconcile at `:194`).
- [ ] The drain prose carries the literal phrase `foreground-to-terminal` (the lint anchor).
- [ ] The prose does not instruct `run_in_background: true` for a faff-prep dispatch.

### From HOW (born-verifiable backstop)
- [ ] A test asserts that a prep dispatch left open (an `inflightcheck --open --key <issue> --describe prep` marker present at turn-end, under the stranding premise) is refused at turn-end by `inflightcheck` specifically — not only by `turncheck`. Extend `test/inflightcheck.test.mjs`.
- [ ] A validate-adapters test (`test/validate-adapters.test.mjs`) asserts the `faff-beep-boop` anchor phrase is enforced (FAIL when the phrase is absent, PASS when present).

### Integration smoke test
```
PROCEDURE smoke:
  1. In a scratch run dir, faff inflightcheck --open --key FAFF-SMOKE --describe prep
  2. Run the inflightcheck Stop-hook decision (--hook) with the stranding premise → expect BLOCK
  3. faff inflightcheck --close --key FAFF-SMOKE
  4. Re-run the Stop-hook decision → expect no refusal on that key
  5. faff validate-adapters → expect faff-beep-boop PASS (anchor + baseline)
```

confidence: high