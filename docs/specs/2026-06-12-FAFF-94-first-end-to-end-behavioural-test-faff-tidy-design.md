# FAFF-94 — First end-to-end behavioural test (one skill: faff-tidy)

> Spec: faffter-dark-nlspec · 2026-06-12 · interactive · confidence: high.

**Depends on:** FAFF-93 (skill-run harness — DONE, commit 9e51e32) · **Blocks:** FAFF-115 · **Sibling:** FAFF-95 (decision-assertion matchers — not yet built; FAFF-94 is *not* blocked by it).

This spec is the artifact. It is buildable by a coding agent given only this document plus the harness code under `test/helpers/` and the `faff` binary at `plugin/skills/faff/bin/faff`.

---

## 1 · WHY

FAFF-93 shipped a skill-run harness (`test/helpers/skill-harness.mjs`) and proved its *plumbing* with `test/skill-harness.test.mjs` (14 tests over hand-authored inline fixtures + scripts). That self-test proves the harness faithfully records seams. It does **not** drive a real skill against a realistic fixture.

FAFF-94 is the first test that targets an actual skill — **faff-tidy** — end-to-end: load a tracker fixture, seed a repo, drive tidy's decision seams, and assert the captured DecisionRecord. faff-tidy is the right first candidate because it has rich, deterministic decision rules and high regression risk. This is the proof the harness can express a real skill's behaviour; after it, coverage grows leaf-by-leaf (more skills, more buckets) per the ticket.

The single hardest design question — and the substance of this spec — is **what can honestly be tested here without the LLM**. Resolved in §6.

---

## 2 · OUT OF SCOPE

faff-tidy is **LLM prose**, not executable code. The CI-gating driver (`scriptedDriver`, see `test/helpers/skill-harness.mjs`) is a no-LLM deterministic replay of a hand-authored seam script. So an entire class of faff-tidy behaviour cannot be honestly tested here, because the scripted driver cannot *generate* it — a hand-authored version would be the test asserting its own input (a tautology, see §6 decision 1).

**Out of scope for FAFF-94 — deferred to the live driver (FAFF-122):**
- faff-tidy's LLM-judgement classifications: vague-vs-clear, duplicate detection, stale / superseded / challenged spec health, "is this cascade-orphaned issue still wanted".
- The free-text tidy summary.
- `pick-ordering` (delegated to the methodology adapter, not tidy's own opinion).
- Any assertion on prose stdout from the `faff` CLI (the record captures the CLI **exit code** and stdout *string presence*, never asserts prose content — mirroring `test/skill-harness.test.mjs`).

**Also out of scope (other tickets):**
- A decision-assertion matcher/DSL (FAFF-95). FAFF-94 asserts inline against raw DecisionRecord fields with `node:assert/strict`.
- Mutating the tracker or asserting read-after-write. The FAFF-89 model is frozen; mutations are recorded as **attempts only**.
- Exhaustive tidy-bucket coverage. FAFF-94 covers a small, forced set (§6 decision 4).

---

## 3 · WHAT (vocabulary, types, the fields asserted)

### 3a · The three substrate pieces (all merged, cited)

- **Tracker fixture** — `loadFixture(obj|path)` from `test/helpers/mock-tracker.mjs`. Shape: `{ version:1, labels?, initiatives?, projects?, issues?, comments? }`. Issue: `{ id, title, state, stateCategory: backlog|unstarted|started|completed|cancelled, labels:[name], priority?, projectId?, parentId?, relations:{blocks,blockedBy,relatedTo} }`. Every label name used by an issue must be declared in top-level `labels` (else `FixtureError`). Comment: `{ id, issueId, body, createdAt }`. Reads return deep copies; `getIssue` resolves `labels` to `[{name,color}]`.
- **Seeded repo** — `seedRepo(spec)` from `test/helpers/seed-repo.mjs` → `{ root, worktreePath, teardown }`. Committed specs land where the CLI's spec-discovery finds them. The test **must** `t.after(() => repo.teardown())`.
- **CLI runner** — `runCli(argv,{cwd})` from `test/helpers/run-cli.mjs` invokes the **real** `faff` binary (resolved by absolute path, so cwd is irrelevant for the pure `next`/`eligible` subcommands). The harness's `ctx.cli` wraps it, recording `{argv, stdout, exit}`.

### 3b · The harness entry points (cited: `test/helpers/skill-harness.mjs`)

- `runSkill({ skill, tracker, repo, driver?, flags? }) -> DecisionRecord` (frozen; sync for the scripted driver).
- `scriptedDriver(script) -> SkillDriver` — deterministic replay; sole CI-gating path.
- `HarnessError` — on driver/harness misuse.

### 3c · Seam-script action shapes

`{ read:{method,args} }` · `{ cli:[argv...] }` (real binary) · `{ mutate:{op,issue?,args?} }` (attempt) · `{ verdict:{issue,token,source} }` · `{ bucket:{name,issues} }` · `{ render:{surface} }`. Any other key throws `HarnessError`.

### 3d · DecisionRecord fields asserted

```
{ skill, driver,
  trackerReads:[{seq,method,args,resultCount}],
  mutations:[{seq,op,issue,args}],
  cliCalls:[{seq,argv,stdout,exit}],
  verdicts:[{seq,issue,token,source}],
  buckets:{name->[issueId,...]},
  renderings:[{seq,surface}],
  seamLog:[{seq,kind,payload}] }
```
`seq` is the sole monotonic ordering authority; typed lists + `buckets` are views over `seamLog`. Mutations are attempts. The record is frozen and asserts nothing itself.

### 3e · The deterministic CLI kernel FAFF-94 exercises FOR REAL (verified against `plugin/skills/faff/bin/faff`)

`faff next --status <S> --spec <none|low|medium|high> [--not-eligible] [--parked] [--blocked]` → JSON `{next,reason}`, exit 0:
- `--status backlog --spec high` → `{"next":"graft"}` · `--status backlog --spec high --not-eligible` → `{"next":"skip-ineligible"}` · `--status backlog --spec none` → `{"next":"prep"}` · `--status backlog --spec high --parked` → `{"next":"needs-human"}` · `--status backlog --spec high --blocked` → `{"next":"blocked"}` · `--status done --spec high` → `{"next":"done"}`.

`faff eligible --label <name> [--label <name>...] [--default opt-in|opt-out]` → prints `true`/`false`, exit 0:
- `--label faff-automate` → `true` · (none, default opt-in) → `false` · `--label faff-automation-hold --label faff-automate` → `false`.

**Two vocabulary cautions (verified):**
1. The eligible flag is **`--label`** (singular, repeatable) and **`--default opt-in|opt-out`** — NOT `--labels`/`--default on|off`. Wrong flags silently yield `false`.
2. `faff next --status` uses the **orchestration** vocabulary `backlog|todo|in-progress|done|cancelled|duplicate` — it does **not** accept the tracker `stateCategory` values `unstarted`/`started`/`completed` (those return `{next:"error"}`, exit 2). Map `stateCategory → next` before building the `cli` action.

---

## 4 · HOW (the test procedure)

One file, `test/faff-tidy.test.mjs`, auto-discovered by `node --test`. Each case: build fixture → seed repo (`t.after` teardown) → author a seam script that **reads** tracker state, issues **real** `cli` actions against the kernel, and records the `verdict`/`bucket`/`mutate` tidy *would* emit → `runSkill` → assert inline:
- **Real CLI computations** (non-tautological): recorded `cliCalls` carry the expected `argv`, `exit===0`, and the parsed `stdout` matches the kernel verdict (`JSON.parse(...).next === "graft"`, or `eligible` stdout `=== "true"/"false"`).
- **Proof-of-mechanism**: `buckets`/`mutations`/`verdicts` carry the emitted entries with the right ids.
- **Cross-seam ordering**: the CLI computation precedes the verdict/bucket it informs (`seq`).
- **Mutation-as-attempt**: the frozen model is unchanged after the run.

**Anti-pattern (named):** do not assert *only* that buckets/verdicts equal the script input — that is tautological. Every case must also assert ≥1 real `cliCall` computation.

---

## 5 · SCENARIOS

**A — Ready-promotion is a real `graft` verdict, captured end-to-end.** Given a Backlog issue with `faff-automate` + a high-confidence spec + no blockers, when tidy is driven (read → real `eligible` → real `next --status backlog --spec high` → `ready` bucket + `setStatus→Todo` attempt), then `eligible`=`true`, `next`=`graft` at exit 0, the issue is in `ready`, a `setStatus` attempt is recorded, the CLI precedes the bucket by `seq`, and the frozen model still says Backlog.

**B — Stale-park clear forced by a now-Done blocker.** Given a parked issue (`faff-parked`) whose `blockedBy` blocker is now `completed`, when tidy is driven (read the parked issue + the now-Done blocker → `removeLabel(faff-parked)` attempt + cleared bucket), then both reads show `resultCount`≥1, a `removeLabel` attempt with the `faff-parked` arg is recorded (attempt only), the id is in the cleared bucket, and the model still carries `faff-parked`. (Only the mechanical "blocker now Done" rule is tested; prose park-validity judgement is FAFF-122.)

**C — Ineligible issue skipped by a real `skip-ineligible` verdict.** Given a Backlog issue with a high-confidence spec but no `faff-automate` (default opt-in), when tidy is driven (real `eligible` → `false` → real `next … --not-eligible`), then `eligible`=`false` and `next`=`skip-ineligible` at exit 0, and the issue is bucketed skip/needs-human, not ready.

---

## 6 · DESIGN DECISION RATIONALE

**Decision 1 — What FAFF-94 tests vs defers. Chosen:** test faff-tidy's **deterministic kernel for real via CLI seams** (`faff next`/`eligible` through `ctx.cli` → real binary) + capture buckets/mutations/verdicts as **proof-of-mechanism**. Every case asserts ≥1 real CLI-computed verdict; captured buckets/mutations are the plumbing ids flow through, never sold as behavioural truth. Real value over FAFF-93's self-test: the CLI seams are real computations (a regression net for the faff-CLI integration tidy depends on) over tidy's *specific* decision paths. LLM-judgement, the summary, and `pick-ordering` → **FAFF-122** (the scripted driver can't generate them; hand-authored versions would be tautological).

**Decision 2 — FAFF-94 ↔ FAFF-95. Chosen:** assert **inline** against raw DecisionRecord fields with `node:assert/strict` (as the self-test does), shipping without waiting on FAFF-95; FAFF-95 later refactors these into matchers and uses this file as a target.

**Decision 3 — Fixture strategy. Chosen:** inline fixtures via `loadFixture({...})` (one per scenario), matching the self-test convention; the committed-spec half via `seedRepo({specs:[{location:"committed"}]})`. `sample.json` is too thin (2 issues, the spec-bearing one already Todo).

**Decision 4 — Coverage. Chosen:** three forced decisions across three kernel paths (graft / mechanical park-clear / skip-ineligible) — proof-of-mechanism, not exhaustive; later buckets/skills grow leaf-by-leaf per the ticket.

**Decision 5 — Location + runner. Chosen:** `test/faff-tidy.test.mjs`, run by `node --test` (auto-discovered; no `validate.yml` edit). There is no `package.json` test script.

---

## 7 · OPEN QUESTIONS & ASSUMPTIONS

**Assumptions (verified):** `ctx.cli` invokes the real binary; `faff next`/`eligible` expose the §3e verdicts at exit 0 with `--label`/`--default opt-in|opt-out` + the orchestration status vocabulary; `seedRepo({specs:[{location:"committed"}]})` writes a CLI-discoverable spec; `node --test` is the validate-workflow test step.

**Open Questions (non-blocking):**
- **Punt:** whether faff-tidy's SKILL.md should later carry a "decision seams" contract the live driver (FAFF-122) reads, so live- and scripted-driven tidy assert the same record shape — **belongs to FAFF-122**, not FAFF-94.

---

## 8 · DONE (testable checklist)

- [ ] `test/faff-tidy.test.mjs` exists, importing `loadFixture`, `seedRepo`, `runSkill`+`scriptedDriver`.
- [ ] `node --test` passes (the new file + the whole suite stay green).
- [ ] CI `validate` workflow green with no `.github/workflows/validate.yml` edit.
- [ ] Each case asserts **≥1 real faff-CLI-computed verdict** parsed from a recorded `cliCall` at `exit===0`.
- [ ] Ready-promotion case asserts `ready` bucket + a `setStatus` mutation **attempt**, and the frozen model is unchanged.
- [ ] Stale-park-clear case asserts a `removeLabel(faff-parked)` mutation **attempt** forced by a now-`completed` blocker, with the label still present on the frozen model.
- [ ] ≥1 case asserts cross-seam ordering via `seq`.
- [ ] LLM-judgement is **explicitly excluded** in-file with a comment pointing at FAFF-122; no hand-authored judgement is asserted.
- [ ] Every test registers `t.after(() => repo.teardown())`.
- [ ] No new dependency; `node:test` + `node:assert/strict` + the three `test/helpers/*` only.

confidence: high
