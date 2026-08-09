# nlspec — FAFF-558: budget `tokens_at_start` baseline survives mid-run compaction

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: high. Full spec on Linear FAFF-558.

**Artifact.** A buildable spec for FAFF-558 (child of FAFF-552). Audience: the build agent implementing the fix, and the human/spec reviewers gating it. Scope is confined to `plugin/skills/faff/bin/lib/budget.js`, `plugin/skills/faff/bin/lib/lights-out.js`, `plugin/skills/faff-beep-boop/SKILL.md`, and `test/budget.test.mjs` in repo `faff`.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff budget check` never counts a session's whole transcript as this-run spend — it subtracts a *run-start baseline* (`tokens_at_start`) from the whole-session token sum and reports only the delta (`budget.js` L692: `tokens = Math.max(0, wholeSessionTotal - tokensAtStart)`). The entire bug is that this scalar baseline defaults to `0` for an L4 lights-out run, because the L4 mint writes only the *per-model* baseline (`tokens_at_start_by_model_class`) and never the scalar. The fix is to derive the scalar from that already-persisted per-model baseline **unconditionally**, so the scalar `budget.tokens` ceiling subtracts the same baseline the `budget.cost` dimension already uses.

**Problem statement.** After a multi-hour L4 run underwent Claude Code transcript compaction, `budget check` summed the entire ~397M-token compacted session against a baseline of `0`, crossed a `budget.tokens` ceiling with `at_ceiling: escalate`, and produced a false terminating floor (`breached:["tokens"]`) that would halt a healthy unattended run one epic short. This spec persists and unconditionally subtracts the run-start baseline so the token dimension reports *this run's* spend, and replaces the fragile prose hand-write of that baseline with a deterministic write-once `faff budget baseline` subcommand.

**Design principle — a governor must never over-count into a false terminating floor.** Budget breach is a fixed terminating floor at every level (no policy weakens it), so a baseline that silently defaults to `0` is not a cosmetic bug — it halts real work. Reject any implementation where the scalar `budget.tokens` dimension can diverge from the per-model baseline the cost dimension already subtracts.

**Design principle — write-once is compaction-safety, not an optimisation.** The baseline MUST be snapshotted exactly once, at true run start. A re-snapshot taken *after* compaction would measure against the now-large post-compaction transcript, zero out real accumulated spend, and let the run go unbounded. The write-once guard is the load-bearing safety property of the new subcommand, not a convenience.

**Design principle — backward-compatibility is byte-for-byte.** A ledger with a scalar `tokens_at_start` present, and a ledger with neither field present, MUST behave exactly as today. The derivation only fires in the gap: per-model present, scalar absent.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `bin/lib/budget.js` `cmdBudget` (L607+) | JS (Node) | Read-side baseline resolution + new `baseline` subcommand dispatch |
| `bin/lib/budget.js` `byModelClassTotal` (L557–562, exported) | JS | Scalar total over a `{model:{class}}` map; returns 0 for null/non-object |
| `bin/lib/budget.js` `measureTokensByModelClass` | JS | The one transcript walk; used by check, mint, and the new subcommand |
| `bin/lib/lights-out.js` L862–866 | JS | L4 mint; writes per-model baseline when `source==="transcript"` |
| `bin/lib/heartbeat.js` `atomicWriteLedger` / `atomicWriteLedgerFenced` (L163, L203, exported) | JS | Atomic tmp+rename ledger writer + owner-epoch write fence |
| `faff-beep-boop/SKILL.md` L378 ("Owner stamp & heartbeat") | prose | Today's prose baseline hand-write that the subcommand replaces |
| `test/budget.test.mjs` (`fixture` L30, `withTranscripts` L45, `baseLedger` L62) | JS test | Existing harness the new tests extend |

**Scope statement.** This is the read-side + write-once half of FAFF-552's false-trip fix; it sits on the `faff budget` accounting path that Sentry and `run-done --budget` consume as a fixed terminating floor.

## 2. OUT OF SCOPE

- **Compaction-boundary-aware summation (`econIsCompactBoundary`)** — *the under-count case* where truncation shrinks the whole-session sum below the baseline (currently clamped to 0 by `Math.max` at L692). *Why excluded:* a separate deferred slice; this issue fixes the over-count (baseline=0) direction only. *Extension point:* the `wholeSessionTotal - tokensAtStart` subtraction at `budget.js` L692, where a boundary-aware reset would replace the clamp.
- **Owning-session attribution rework (sibling FAFF-560, same file)** — build-serialised *after* this issue. *Why excluded:* per-session attribution touches the same baseline/measurement path; landing both at once risks a merge conflict on the write-once subcommand and the read-side derivation. *Extension point:* the same `tokens_at_start_by_model_class` field and `measureTokensByModelClass` window; FAFF-560 must layer on top of the write-once no-op predicate defined here, not around it.
- **FAFF-527 resume-branch semantics** — the `budget.sessions[]` open-span override (L668–677) is unchanged. *Why excluded:* resume already derives the scalar correctly from `open.baseline_by_model_class`; this issue only fills the *non-resume* default. *Extension point:* L671–677, which stays as the resume override after the new unconditional derivation.
- **Event token-tagging telemetry (`tokens_at_start_by_class`, FAFF-408)** — the four-class per-event checkpoint seed is untouched. *Why excluded:* orthogonal additive telemetry; `budget check` still gates on the scalar total. *Extension point:* the beep-boop L378 seed of `tokens_at_start_by_class`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| scalar baseline | `budget.tokens_at_start` — a single integer subtracted from the whole-session token sum for the `budget.tokens` dimension |
| per-model baseline | `budget.tokens_at_start_by_model_class` — a `{model:{input,output,cache_write,cache_read}}` map, persisted at L4 mint, used by `budget.cost` |
| whole-session total | sum over all in-window transcript files of the metered session (`measureTokensByModelClass(...).totals`) |
| write-once | the baseline is snapshotted exactly once per run; a re-invocation with a baseline already present is a no-op |

**Ledger `budget` block (relevant fields).**

```
RECORD LedgerBudget:
  envelope: BudgetEnvelope                         # ceilings + at_ceiling + pricing (unchanged)
  tokens_at_start: Integer?                        # scalar baseline; today absent on L4 mints (the bug)
  tokens_at_start_by_model_class: ByModelMap?      # per-model baseline; written at L4 mint when source=="transcript"
  sessions: Session[]?                             # FAFF-527 resume spans (unchanged)

  # ByModelMap = { <model>: { input, output, cache_write, cache_read } }
```

**Read-side derivation (the core change), `cmdBudget`, budget.js L657–660.** Resolve `tokensAtStartByModel` *first*, then derive the scalar unconditionally when the scalar field is absent:

```
tokensAtStartByModel := ledger.budget.tokens_at_start_by_model_class  (if a plain object, else null)
tokensAtStart := (typeof ledger.budget.tokens_at_start === "number")
                   ? ledger.budget.tokens_at_start
                   : byModelClassTotal(tokensAtStartByModel)
```

`byModelClassTotal(null) === 0` (verified L557–562) preserves today's default when neither field is present. The FAFF-527 resume branch (L668–677) is unchanged and still overrides both `tokensAtStartByModel` and `tokensAtStart` from the open span's baseline.

**Chosen: derive the scalar from the persisted per-model baseline, unconditionally.** The scalar `budget.tokens` ceiling now subtracts the exact same run-start baseline the `budget.cost` dimension already subtracts (L701–707) — one baseline, two dimensions, no divergence. Backward-compatible by construction: scalar-present is honoured verbatim; both-absent stays 0.

**New subcommand — `faff budget baseline`.** Routing: `bin/faff` L205 maps `"budget"→cmdBudget`; `cmdBudget` L609 resolves `sub = args.find(a => !a.startsWith("-"))`. Add a `baseline` branch alongside `check`; every other `sub` value still hits the usage/exit-2 path.

```
INTERFACE `faff budget baseline`:
  flags: --run-dir DIR   (resolves the ledger; same resolution as check)
         --root DIR       (measurement cwd; same as check, defaults to findRoot())
         --session-id ID  (selects the metered session; same effectiveEnv override as check L620-621)
         [--json]         (always emits JSON; flag accepted for parity)
  effect: WRITE-ONCE snapshot of the run-start per-model baseline into <run-dir>/run-ledger.json
  stdout: { baseline_written: bool, reason: string, tokens_at_start?: int }
  exit:   0 on fresh-write, 0 on already-set no-op, 0 on estimate-degraded (no transcript),
          2 on usage error (missing/unresolvable run-dir, unknown flag shape)
```

**Chosen: the write-once predicate is "`budget.tokens_at_start_by_model_class` already present (a plain object)".** That is the field the L4 mint and this subcommand both write, so its presence is the authoritative "baseline already snapshotted" signal. If present → no-op, `{baseline_written:false, reason:"already-set"}`, exit 0. This is the compaction-safety guard: a post-compaction re-invocation finds the field set and refuses to re-snapshot against the enlarged transcript.

**Chosen: on fresh write, persist BOTH the per-model map AND the derived scalar.** Write `budget.tokens_at_start_by_model_class = Object.fromEntries(byModel)` and `budget.tokens_at_start = byModelClassTotal(...)`. The read-side derivation makes the scalar redundant for `budget check`, but audit.js/economics.js and the beep-boop ledger docs (L359) already reference the scalar as a first-class field; writing it keeps those consumers exact rather than relying on every reader re-deriving.

**Chosen: estimate-degraded writes nothing, reports it, exits 0.** When `measureTokensByModelClass(...).source !== "transcript"` (no resolvable transcript), write no baseline fields and emit `{baseline_written:false, reason:"estimate-degraded"}`, exit 0 — mirroring `check`'s estimate fallback (never crash). At L4, `budget check` still degrades safely (pro-rata + warn) with no baseline; the next `baseline` call once a transcript exists snapshots it.

## 4. HOW — Behavior

**Architecture.** Two independent read-side edits plus one new write-side subcommand, all in `budget.js`, plus a beep-boop prose swap. The mint side (`lights-out.js`) needs no behavioural change (see Design Decision Rationale).

**Read-side derivation** replaces the two-statement `tokensAtStart` / `tokensAtStartByModel` resolution at L657–660 with the derivation in §3 (resolve `tokensAtStartByModel` first, derive scalar unconditionally). The FAFF-527 branch, the `measuredFull` walk, and everything downstream are untouched.

**New subcommand procedure.**

```
PROCEDURE cmdBudget_baseline(args):
  1. get, root, effectiveEnv, run-dir resolution — identical to `check`
     (--root, --session-id override into effectiveEnv, resolveLedgerOrFault).
  2. IF the ledger cannot be resolved (usage: no run-dir / not found):
       write usage to stderr, exit 2.
  3. Read the ledger's owner.started_at → runStartMs (Date.parse; == check's L655-656).
     IF not finite: fall back to null runStartMs (same as check) — measurement still runs.
  4. WRITE-ONCE guard: re-read the on-disk ledger; IF budget.tokens_at_start_by_model_class
     is already a plain object:
       print { baseline_written: false, reason: "already-set" }; exit 0.   # compaction safety
  5. measured := measureTokensByModelClass({ cwd: root, env: effectiveEnv, runStartMs })
  6. IF measured.source != "transcript":
       print { baseline_written: false, reason: "estimate-degraded" }; exit 0.  # never crash
  7. byModel := Object.fromEntries(measured.by_model)
     scalar  := byModelClassTotal(byModel)
  8. ATOMIC re-read-then-merge write (see below):
       ledger.budget = { ...(ledger.budget || {}),
                         tokens_at_start_by_model_class: byModel,
                         tokens_at_start: scalar }
       persist to <run-dir>/run-ledger.json
  9. print { baseline_written: true, reason: "fresh", tokens_at_start: scalar }; exit 0.
```

**Behavior summary — the atomic merge write.** The subcommand runs at run start concurrently with the owner stamp / heartbeat writes, so it MUST re-read the ledger immediately before writing and merge only the `budget.tokens_at_start*` fields, never serialise a stale whole-ledger snapshot.

```
PROCEDURE atomic_merge_baseline(runDir, byModel, scalar):
  1. fresh := readLedger(runDir)                      # re-read, don't reuse step-1's copy
  2. fresh.budget := { ...(fresh.budget||{}), tokens_at_start_by_model_class: byModel,
                       tokens_at_start: scalar }
  3. atomicWriteLedgerFenced(runDir, fresh,
       { epoch: fresh.owner?.epoch, session_id: fresh.owner?.session_id })
     # fenced write yields (no-op) if a newer resume took the run over — never clobbers
```

**Chosen: use `atomicWriteLedgerFenced` with the ledger's own owner block as the fence.** The fence (heartbeat.js L203) already re-reads the on-disk owner and yields if the epoch/session moved on — exactly the concurrent-owner protection the ticket asks for. Passing the just-read `owner.{epoch,session_id}` as `expected` means a normal run writes cleanly (epoch matches itself) and a raced-out stale writer yields rather than clobbering a resumed ledger. Combined with the re-read at step 1, no concurrent owner/outcome write is lost.

**Anti-pattern:** reusing the ledger object read for the envelope/breach evaluation as the object you write back. Why: it predates any owner/heartbeat write that landed between read and write, so serialising it would silently revert concurrent fields. Always re-read immediately before the merge.

**Anti-pattern:** deriving the write-once predicate from the scalar `tokens_at_start`. Why: a legacy or partially-written ledger can carry the scalar without the per-model map (or vice versa); the per-model map is the field both writers produce, so it is the single authoritative "already snapshotted" signal.

**Edge cases & error handling.**
- Unknown subcommand (`budget wat`) → unchanged exit-2 usage path (existing test at L74–77 must still pass; the new branch only intercepts `baseline`).
- `--session-id` absent → `effectiveEnv` is `process.env`, byte-for-byte today (mirrors `check` L619–621).
- Ledger present but no `owner.started_at` → `runStartMs = null`; measurement still runs (mtime pre-filter skipped, same as `check`).
- Estimate-degraded and already-set are both **non-fault exit 0** — the subcommand never emits a non-zero exit that a caller could misread as a breach.
- Usage error (unresolvable run-dir) is the only exit 2.

**Failure modes.**
- **The failure:** the derived scalar diverges from what the cost dimension subtracts (e.g. a future refactor changes `byModelClassTotal`'s class set). **How you'd know:** the read-side backward-compat test (scalar-present honoured; both-absent → 0) still passes but the L4/compaction test reports a non-zero delta mismatch between `spent.tokens` and the per-model-summed cost baseline. **What it means:** narrow — re-anchor both dimensions on the single `byModelClassTotal` helper (they already share it here); do not fork the total.
- **The failure:** the write-once guard reads a ledger mid-write and sees a partial `budget` block without the per-model field, then re-snapshots after compaction. **How you'd know:** the write-once test (second invocation after transcript growth) reports `baseline_written:true` and the baseline changes. **What it means:** abandon the scalar-based predicate (already chosen against) and keep the per-model-object predicate + atomic tmp+rename reads, which never expose a torn file.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 ledger carrying tokens_at_start_by_model_class but NO scalar tokens_at_start,
  and a transcript whose whole-session sum exceeds the budget.tokens ceiling
  but whose this-run delta (whole-session minus the per-model baseline) does not
When `faff budget check --run-dir … --root … --session-id …` runs
Then breached is [] (no false breached:["tokens"]) — the derived scalar baseline was subtracted
```

```
Given a ledger with an explicit scalar tokens_at_start present
When `faff budget check` runs
Then the explicit scalar is honoured verbatim (byte-for-byte today's behaviour)
```

```
Given a run-ledger with no budget baseline fields and a readable transcript
When `faff budget baseline --run-dir … --root … --session-id …` runs
Then the ledger gains tokens_at_start_by_model_class (+ scalar tokens_at_start),
  and stdout is { baseline_written: true, reason: "fresh", … } with exit 0
```

- The baseline measurement MUST be deterministic: same transcript state + same run-start `owner.started_at` → identical `tokens_at_start_by_model_class` and scalar across repeated fresh writes (on a fixture where the write-once guard is bypassed by clearing the field between runs).
- `faff budget baseline` with an unresolvable run-dir MUST exit 2 (usage error).
- `faff budget baseline` against a run with no readable transcript MUST write nothing and exit 0 with `reason: "estimate-degraded"` (never crash).

## 6. Design Decision Rationale

**Does `lights-out.js` need a change?** The ticket lists it under Files.
- *Option A — no behavioural change.* The L4 mint (L862–866) already writes `tokens_at_start_by_model_class` when `source==="transcript"`. With the read-side unconditional derivation, the scalar `budget.tokens` ceiling now derives its baseline from that existing per-model write. No mint change is required for the L4 false-trip to be fixed.
- *Option B — also write the scalar at mint.* Defensive; keeps audit.js/economics.js exact without relying on the reader deriving.

**Chosen: Option A for the mint's load-bearing behaviour — no mint change is required for correctness; the existing per-model write is sufficient.** The read-side derivation consumes it. *Optional, non-blocking:* if the builder wants belt-and-braces for scalar-reading consumers, the mint may additionally set `budgetBlock.tokens_at_start = byModelClassTotal(Object.fromEntries(modelBaseline.by_model))` inside the same `source==="transcript"` guard at L864–866 — purely additive, no behavioural change to `budget check`. Rationale: the new `faff budget baseline` subcommand is the authoritative baseline writer for beep-boop (L3) runs; the L4 mint already snapshots at true run start; making the mint also write the scalar is harmless alignment, not a correctness dependency. This is stated as Chosen (not a Punt) — the fix does not depend on it either way.

**How is the baseline written at run start — prose or subcommand?**
- *Option A — keep the prose hand-write* (today, beep-boop L378: run `budget check`, read `spent.tokens`, hand-write `tokens_at_start`). Fragile: the exact field the ticket blames for FAFF-552.
- *Option B — deterministic write-once subcommand.* One `faff budget baseline` call; no prose arithmetic; write-once guard is code, not agent discipline.

**Chosen: Option B.** Replace the L378 prose baseline hand-write with a single `faff budget baseline --run-dir "$FAFF_RUN_DIR" --root "$measure_root" --session-id "$session_id"` call at run start. Determinism and the write-once compaction guard move out of prose into a testable CLI.

**Which writer + concurrency discipline?** Chosen: `atomicWriteLedgerFenced` (heartbeat.js L203) with re-read-then-merge, fenced on the ledger's own `owner.{epoch,session_id}` — reuses the existing owner-epoch takeover fence so a concurrent owner/heartbeat/outcome write is never clobbered. Rejected: raw `atomicWriteLedger` of the step-1 ledger copy (would revert concurrent fields).

## 7. Open Questions and Assumptions

**Open Questions.** None. Every decision above carries a `**Chosen:**` marker.

**Assumptions.**

**Assumes: Claude Code's on-disk compaction rewrites only the transcript store, never the faff-owned ledger — the persisted ledger baseline survives a transcript rewrite/truncation.** *Confirmed on two independent grounds — treat as settled, not open:*
1. *Architectural:* the ledger is `<repo>/.faff/runs/<id>/run-ledger.json` (faff-owned, in the repo working tree). Compaction operates on the Claude Code transcript store at `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` (budget.js `transcriptBaseDir`). Different owner, different path — compaction never writes into the repo's `.faff/`. The baseline survives by construction: it is not the transcript.
2. *Empirical (from FAFF-552 itself):* post-compaction, `budget check` summed the entire ~397M multi-hour session against the same session id — proving the session id and its accumulated usage persisted across compaction and stayed summable, so a run-start baseline captured against that session remains subtractable. The observed failure was an over-count driven by baseline=0, which "persist + unconditional subtract" fixes.

*Validation instruction for the build agent:* confirm `transcriptBaseDir` in budget.js still resolves under `~/.claude` (or `$CLAUDE_CONFIG_DIR`) and not under `.faff/`; confirm the ledger path is `.faff/runs/<id>/run-ledger.json`. Both hold at time of writing.

## 8. DONE — Definition of Done

### From WHY
- [ ] After a mid-run compaction, `budget check` on an L4-shaped ledger subtracts the persisted baseline and reports this-run spend, not whole-session history — no false `breached:["tokens"]` (AC-a).

### From WHAT (read-side derivation)
- [ ] `cmdBudget` resolves `tokensAtStartByModel` before the scalar, and derives `tokensAtStart = byModelClassTotal(tokensAtStartByModel)` when `budget.tokens_at_start` is absent.
- [ ] Scalar present → honoured verbatim; both fields absent → baseline 0 (byte-for-byte today).
- [ ] The FAFF-527 resume branch (open-span override) is unchanged.

### From WHAT (subcommand interface)
- [ ] `cmdBudget` dispatches a `baseline` sub; every other non-`check` sub still exits 2 (existing `budget wat` test still passes).
- [ ] `faff budget baseline` honours `--run-dir` / `--root` / `--session-id` exactly like `check`.
- [ ] Output shape is `{ baseline_written, reason, tokens_at_start? }`; exit 0 on fresh-write, already-set, and estimate-degraded; exit 2 on usage error.

### From HOW (behaviour)
- [ ] Fresh write populates `budget.tokens_at_start_by_model_class` AND `budget.tokens_at_start` from `measureTokensByModelClass` at `runStartMs = owner.started_at` (AC-b: write-once + deterministic).
- [ ] Write-once: an invocation where `budget.tokens_at_start_by_model_class` is already a plain object is a no-op (`reason:"already-set"`), even if the transcript grew — the compaction-safety guard (AC-b).
- [ ] Estimate-degraded (no transcript) writes nothing, `reason:"estimate-degraded"`, exit 0, no crash.
- [ ] The write re-reads the ledger and merges via `atomicWriteLedgerFenced` (fenced on the ledger's own owner), never clobbering a concurrent owner/outcome write.
- [ ] Determinism: same transcript state + same `owner.started_at` → identical baseline.

### From HOW (mint side)
- [ ] Single-worktree / non-compacted L4 behaviour is unchanged; the existing per-model mint write remains authoritative (AC-c). (Optional additive scalar write at L864–866, if taken, is behaviour-neutral.)

### From beep-boop
- [ ] `faff-beep-boop/SKILL.md` L378 prose baseline hand-write is replaced by a single `faff budget baseline …` call at run start.

### From tests (`test/budget.test.mjs`)
- [ ] Read-side L4/compaction test: per-model set, scalar absent, whole-session sum > ceiling, this-run delta < ceiling → `breached:[]`.
- [ ] Read-side backward-compat tests: scalar-present honoured; neither-present → baseline 0.
- [ ] `faff budget baseline` tests: fresh write populates both fields; second invocation is a write-once no-op after transcript growth; estimate-degraded writes nothing / no crash; usage error exits 2; determinism assertion.

### Integration smoke test
```
1. fixture({ rc: "budget:\n  tokens: <ceiling>\n  at_ceiling: escalate\n",
             ledger: baseLedger({ level: "L4",
                                  budget: { tokens_at_start_by_model_class: <run-start snapshot> } }) })
2. withTranscripts(root, root, sid, { "<sid>.jsonl": <records summing ABOVE ceiling whole-session,
                                                      BELOW ceiling as this-run delta> })
3. run(["budget","check","--run-dir",runDir,"--root",root,"--session-id",sid],
       { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid })
4. assert JSON.parse(out).breached deepEquals []   # the plumbing is connected: no false trip
```

## Already shipped against this surface

Related Done work on the same budget/metering surface — reader context, none supersedes this slice (the persist-scalar + unconditional-subtract fix is undelivered):

- **FAFF-36** — the original budget envelope + transcript-sum accounting (the `tokens_at_start` baseline this fix persists).
- **FAFF-427** — wired the per-model×per-class price map into `budget.cost` and introduced `tokens_at_start_by_model_class` (the per-model baseline this fix derives the scalar from).
- **FAFF-527** — the resume-branch open-span baseline (`budget.sessions[]`); the ONLY existing site that derives the scalar from a per-model baseline. This fix generalises that derivation to the non-resume default.
- **FAFF-229** — child `agent-*.jsonl` over-count fix (owning-session attribution); its sibling FAFF-560 layers on top of this fix.
- **FAFF-488 / FAFF-502 / FAFF-428** — metering-degrades-to-estimate hardening; orthogonal (the estimate-fallback path, not the baseline subtraction).

## Methodology critique

*(agile-delivery lens — advisory; does not gate high-confidence promotion.)*

- **Right-sized?** No issues. The read-side derivation and the write-once subcommand are two halves of one shippable outcome (the persisted baseline surviving compaction) — neither ships value alone, so principle 4's always-ship-together case is correctly kept as one ~1-day unit. Deferring `econIsCompactBoundary` to a follow-up is correct thinnest-slice discipline.
- **Workstream fit?** No issues. FAFF-558 sits under FAFF-552 (a shippable-outcome parent, not an activity bucket); this slice + sibling FAFF-560 converge on that one outcome.
- **Deps surfaced?** The 558→560 serialisation (same file `budget.js`) is stated in prose but not encoded as a tracker `blockedBy` link — automation/concurrency sequence off the blocker graph, so both could be pulled as ready and collide. *Action taken by prep:* an explicit `FAFF-560 blockedBy FAFF-558` link is added. Also: the read-side derive depends on `lights-out.js` already writing the per-model baseline — verified present (L862–866); the spec names it as a Chosen (Option A), so the dependency is explicit, not assumed.
- **Risk profile?** The change widens the baseline subtraction from the resume path to *every* budget read (a run-halting guard), so the legacy-ledger corner (neither `tokens_at_start` nor `tokens_at_start_by_model_class` present) must yield a safe value. The spec's DONE already pins this (backward-compat test: neither-present → baseline 0, `byModelClassTotal(null)===0`); the DONE test list also covers scalar-present-honoured, the write-once no-op after transcript growth, and the L4/compaction happy path. De-risking is in-scope and testable.

confidence: high
