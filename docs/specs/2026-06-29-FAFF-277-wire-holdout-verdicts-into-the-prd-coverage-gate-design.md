# FAFF-277 — Wire holdout verdicts into the PRD-coverage gate (`faff holdout verdicts` → `faff prdr coverage --dod-verdicts`)

> Spec: faffter-dark-nlspec · 2026-06-29 · interactive · confidence: high. Full spec on Linear FAFF-277.

This is the buildable spec for FAFF-277, the consumer follow-up to FAFF-34's evaluator-lane holdout harness (v1a). Audience: the build agent implementing it, and the human reviewers gating the PR. It adds one deterministic CLI subcommand — `faff holdout verdicts` — that turns the evaluator's persisted, per-build `holdout-verdict` blocks into the `{ "<prdr-id>": "met" }` map the **already-shipped** `faff prdr coverage --dod-verdicts` flag consumes, so the `prd-satisfied` roll-up finally reads the evaluator's judgements instead of conservatively defaulting every DoD to unverified.

## 1. WHY — Problem and Principles

**The load-bearing model.** FAFF-34's evaluator *already* emits a code-blind `holdout-verdict` and persists it to `.faff/holdout/<issue|run>.json`. FAFF-257's `faff prdr coverage` *already* accepts a `--dod-verdicts` map and rolls `prd-satisfied` up from it. The two are not joined: nothing reads the persisted verdicts and produces the map, so `coverage` runs with no DoD signal and — by its conservative default — reports every live PRDR's DoD *unverified*, i.e. `prd-satisfied: false`, forever. This change is the missing pipe: a small, pure, trust-gated reader that bridges the persisted store to the coverage flag.

**Problem statement.** Today the evaluator's verdicts are written but never consumed, so `prd-satisfied` is structurally pinned false while the evaluator exists but is unwired. This change reads the persisted verdicts, gate-validates each one, translates a passing `meets-spec` into the literal `met` coverage expects, keys it by the PRDR it satisfies, and feeds the resulting map into the existing `--dod-verdicts` flag — so product-done can actually be earned.

**Design principles.**

**The mechanical bridge is a tool, never agent prose.** Globbing the store, re-validating each verdict through its own contract, translating `meets-spec → met`, and keying by PRDR id are all deterministic — same input, same output. By the *deterministic-tools-over-prose* tenet that work belongs in a tested CLI subcommand, not in an orchestrator hand-assembling the map from file reads. The only judgement left to the caller is the genuinely non-mechanical part: which delivering increment satisfies which PRDR.

**A persisted verdict is untrusted until it re-passes its own gate.** The reader never trusts a `.faff/holdout/*.json` file at face value — a stale, hand-edited, or truncated file must not be able to forge product-done. Every verdict is re-piped through the `holdout-verdict` contract; only a block that is conformant **and** `code_blind: true` **and** `aggregate: meets-spec` yields a `met`. Everything else fails safe to *not-met*. This is the same fail-safe-toward-not-done posture FAFF-34 built into the verdict itself, re-asserted at the consumer boundary.

**Lane isolation is preserved — the evaluator never learns about PRDRs.** The evaluator (Evaluator lane: no tracker, no codebase) keeps persisting keyed by `issue|run`, exactly as v1a does. The PRDR association is an *orchestrator*-lane fact (it knows which increment delivers which PRDR) and is supplied to the reader as data. The reader and `coverage` stay pure (filesystem + args only, no tracker/network), matching `prdr yagni` / `admit` / `coverage`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` — `faff prdr coverage` handler (`--dod-verdicts` parse + merge), `computePrdCoverageVerdict` | Node (deps-free) | The consumer that **already** accepts `{prdr-id: verdict}` and rolls `prd-satisfied` up; **unchanged** by this slice |
| `plugin/skills/faff/bin/faff` — `computeHoldoutVerdict` / `contractHoldoutVerdict` (the `holdout-verdict` compute fn) | Node | The trust gate the reader re-runs per file; reused verbatim, not forked |
| `plugin/skills/faff/bin/faff` — `faff dod classify` subcommand + selftest (FAFF-34) | Node | The shape precedent: a small pure subcommand + a selftest table; `holdout verdicts` is its sibling |
| `.faff/holdout/<issue\|run>.json` (written by `faffter-noon-evaluate`) | JSON | The persisted store this reads; filename key is the `issue\|run` id |
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | prose producer | Documents the persist; gets a one-line note that the persisted shape is now consumed (the "proven by use" close-out) |
| `test/golden/contracts/cases.json`, `docs/guide/cli.md`, `.github/workflows/validate.yml` | JSON / md / CI | Selftest wiring + CLI doc the new subcommand must land in |

**Scope statement.** This closes the third of FAFF-34's three settled deferrals (PRD-coverage-gate *consumption*) — it sits downstream of the evaluator producing verdicts and upstream of FAFF-257's `prd-satisfied` roll-up, joining two shipped halves with one pure pipe.

## 2. OUT OF SCOPE

- **Auto-invoking the evaluator in the build pipeline.** Whether `faff-graft` / `faff-beep-boop` runs the evaluator after a merge and *writes* `.faff/holdout/` is FAFF-34's separately-deferred "orchestrator auto-invocation". This slice only *consumes* whatever verdicts already exist. *Extension point:* a graft Step-10-adjacent or beep-boop post-merge wave. *Why excluded:* the consumer is useful and testable against fixture verdicts before the pipeline writes real ones.
- **Resolving the issue→PRDR association from the tracker.** The reader is handed the association as data; building it (which Done issue delivered which PRDR) is an orchestrator/tracker concern that would make the tool impure. *Extension point:* the orchestrator that calls `holdout verdicts` (a future graft/beep-boop wave) assembles it from issue↔PRDR links. *Why excluded:* keeps the tool pure (parity with `coverage`), and the association is trivial to pass while no pipeline yet produces it.
- **One increment delivering *several* PRDRs.** v1a maps each holdout-file key to at most one PRDR id (see Assumptions). A single build that satisfies multiple PRDRs' DoD is not modelled. *Extension point:* let an association value be a list of PRDR ids in `holdout verdicts`. *Why excluded:* no current producer creates that shape; YAGNI until one does.
- **Changing FAFF-34's persisted block shape.** The reader keys off the *filename* + the supplied association, so the persisted block stays the bare `holdout-verdict` contract block. *Extension point:* an envelope `{prdr, verdict}` if a future evaluator gains PRDR visibility (it should not, per lane isolation). *Why excluded:* no persist change is needed and adding a `prdr` field to the contract block would violate its `additionalProperties: false`.
- **Changing `faff prdr coverage` / `computePrdCoverageVerdict`.** The `--dod-verdicts` flag and the conservative `dod_verdict !== "met" ⇒ unverified` roll-up already exist and are correct. This slice produces the map; it does not touch the consumer. *Extension point:* none needed. *Why excluded:* the gap is the producer of the map, not the roll-up.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Holdout file | A persisted `.faff/holdout/<key>.json` whose body is one `holdout-verdict` contract block `{aggregate, code_blind, criteria, violations}`. `<key>` is the `issue\|run` id the evaluator used. |
| Association | An orchestrator-supplied map `{ "<holdout-key>": "<prdr-id>" }` saying which PRDR each holdout file's increment delivers. |
| DoD-verdict map | The output: `{ "<prdr-id>": "met" \| "<aggregate>" }`, fed verbatim to `faff prdr coverage --dod-verdicts`. Only `"met"` counts as done downstream. |
| Trust gate | Re-piping a holdout file's block through `holdout-verdict` compute; only a conformant, `code_blind:true` block is trusted at all. |

**The new subcommand — `faff holdout verdicts`.**

```
faff holdout verdicts --association <json|@file|-> [--dir .faff/holdout] [--json]
```

- `--association` — required. A JSON object `{ "<holdout-key>": "<prdr-id>" }` mapping each holdout-file key (its basename minus `.json`) to the PRDR id it delivers. Accept inline JSON, `@path`, or `-` for stdin (mirror how other subcommands take JSON args; inline is the baseline).
- `--dir` — the holdout store to read (default `.faff/holdout/`). Filesystem read only — no tracker/network/LLM (parity with `dod classify` / `coverage`).
- `--json` — emit the DoD-verdict map as JSON on stdout (the default and only output form; the flag is accepted for symmetry with `dod classify` and is a no-op when the map is the whole payload).

```
RECORD HoldoutVerdictsOutput:           # printed as JSON on stdout
  verdicts: Map<PrdrId, String>         # { "<prdr-id>": "met" | "gaps" | "fails" | "needs-human" }
  skipped:  List<SkipRecord>            # files that yielded no trusted entry, with why (diagnostic, not an error)

RECORD SkipRecord:
  key: String                           # the holdout-file key (basename minus .json)
  reason: Enum{ no-association, contract-rejected, unreadable, duplicate-prdr }
```

The map the caller pipes onward is `output.verdicts`; `skipped` is an audit trail printed to stderr (or carried in the JSON under `--json`) so a missing PRDR is visible, never silent.

**Translation + trust rule (mechanical).** For each `<key>.json` under `--dir`:

```
1. key  <- basename(file) without ".json"
2. IF key not in association            -> skip{key, "no-association"}            (never guess a PRDR)
3. prdr <- association[key]
4. block <- JSON.parse(file)            ; on parse failure -> skip{key,"unreadable"}
5. gate <- computeHoldoutVerdict(block) ; the SAME compute fn `faff contract holdout-verdict` runs
   IF gate is fail-loud OR gate.violations is non-empty OR block.code_blind !== true
        -> skip{key, "contract-rejected"}                                          (untrusted ⇒ never "met")
6. value <- (block.aggregate === "meets-spec") ? "met" : block.aggregate
        # meets-spec -> the literal "met" coverage compares on; gaps/fails/needs-human pass through (all ≠ "met")
7. IF prdr already has a value from another key -> skip{key,"duplicate-prdr"}, keep the FIRST,
   UNLESS the rule below resolves it
8. verdicts[prdr] <- value
```

**Duplicate-PRDR resolution.** Two holdout files mapping to the same PRDR is a real possibility (a re-run, or two increments tagged to one PRDR). The conservative rule: a PRDR is `met` only if **every** holdout file associated with it is `met`; any non-`met` (or contract-rejected) sibling makes the PRDR not-met. Concretely, fold per PRDR: `met` only when all contributing trusted values are `"met"` and at least one trusted value exists; otherwise the first non-`met` aggregate (or `"needs-human"` if all contributors were contract-rejected). This keeps a single failing re-run from being masked by a passing one.

**Exit codes.** `0` — ran (the map is the payload; an *empty* map is exit 0, not an error — "nothing trusted yet" is a valid, conservative answer that `coverage` already handles). `2` — usage error: missing/`--association` not an object, unreadable `--dir`, malformed `--association` JSON. No `1` (report-only, parity with `coverage` / `yagni`).

**The wiring (how a caller composes it).** Two pure subcommands piped:

```
assoc='{"FAFF-34":"0007","FAFF-41":"0008"}'
dod=$(faff holdout verdicts --association "$assoc" --json | jq -c .verdicts)
faff prdr coverage --prd-goals "$goals" --dod-verdicts "$dod" | faff contract prd-coverage
```

`coverage` is unchanged; it merges `dod` onto its live-PRDR set by id exactly as it does today. The conservative default is preserved end-to-end: a PRDR with no trusted `met` entry stays unverified ⇒ `prd-satisfied` stays false.

**Design decision — a new subcommand vs teaching `coverage` to read `.faff/holdout/`.** Options: (a) a dedicated `faff holdout verdicts` emitter piped into the existing `--dod-verdicts`; (b) a `--holdout-dir` flag on `coverage` that internalises the read. **Chosen:** (a). Rationale: `coverage` stays a single-responsibility pure roll-up (its only filesystem touch is `docs/prdr/`, which it already owns); the trust-gate + translation is independently testable; and the composition mirrors faff's existing `yagni → admit --upper` pipe. (b) would couple two concerns and bury the trust gate inside the roll-up.

**Design decision — where does the PRDR key come from?** Options: (a) extend the persisted file with a `prdr` field (changes FAFF-34's shape, and a `prdr` in the contract block breaks `additionalProperties:false`); (b) key the holdout *filename* by PRDR id (the evaluator would need PRDR visibility — breaks lane isolation); (c) supply an `issue→PRDR` association to the reader. **Chosen:** (c). Rationale: it keeps the evaluator code-blind *and* PRDR-blind (it only ever knows its `issue|run`), needs zero change to the persisted shape, and keeps the tool pure — the impure tracker lookup that builds the association lives in the orchestrator, exactly where `coverage`'s "agent maps tracker reality onto closed-vocabulary flags" contract already puts it.

**Design decision — command namespace: `holdout verdicts` vs `dod verdicts`.** Options: (a) `faff holdout verdicts` (a new namespace over the `.faff/holdout/` store); (b) `faff dod verdicts` (sibling of `faff dod classify`). **Chosen:** (a). Rationale: `dod classify` is a *pure spec parse* (no I/O); `holdout verdicts` does filesystem I/O over a runtime store — a different purity class, so grouping it under the store it reads is more honest than overloading `dod`. The name also reads as what it does: collect the holdout store's verdicts.

## 4. HOW — Behavior

**Architecture and approach.** One new pure subcommand reusing two existing primitives: `computeHoldoutVerdict` for the trust gate (not re-implemented) and the established small-subcommand+selftest shape of `dod classify`. It performs a directory glob, a per-file gate+translate, a per-PRDR conservative fold, and prints a JSON map. No tracker, no network, no LLM.

```
PROCEDURE holdout_verdicts(association, dir):
  IF association is not an object            -> usage error (exit 2)
  IF dir is unreadable                       -> usage error (exit 2)
  contributions <- empty Map<PrdrId, List<String>>   # trusted per-PRDR values
  skipped <- []
  FOR each "<key>.json" in dir (sorted, deterministic order):
     IF key not in association: skipped += {key, "no-association"}; CONTINUE
     prdr <- association[key]
     block <- parse file; on failure: skipped += {key, "unreadable"}; CONTINUE
     gate  <- computeHoldoutVerdict(block)
     IF gate.failLoud OR gate.contractData.violations.length > 0 OR block.code_blind !== true:
        skipped += {key, "contract-rejected"}; CONTINUE
     value <- (block.aggregate == "meets-spec") ? "met" : block.aggregate
     contributions[prdr].push(value)
  verdicts <- {}
  FOR each prdr, values in contributions:
     verdicts[prdr] <- (values all == "met") ? "met" : (first non-"met" value)
  EMIT { verdicts, skipped }   (JSON on stdout; skipped also summarised to stderr)
  RETURN 0
```

**Behaviour summary.** Read every persisted verdict, throw away any the contract won't vouch for, translate the survivors' `meets-spec` to the literal `met`, fold conservatively per PRDR, and hand back a map the existing coverage flag already knows how to merge.

**Edge cases and error handling.**

- **Empty / absent `--dir`** → empty `verdicts` map, exit 0. `coverage` then reports every PRDR unverified (the pre-wiring behaviour, now reached through the real pipe rather than by the flag being absent).
- **A holdout key with no association entry** → `skip{no-association}`, contributes nothing. Never guess a PRDR — a wrong guess could forge product-done for the wrong goal.
- **A contract-rejected block** (non-object, `code_blind:false`, derivation mismatch, prose-judged, evidence-absent, out-of-enum aggregate) → `skip{contract-rejected}`, never `met`. The trust gate is the whole point.
- **An association entry pointing at a key that has no file** → simply never iterated; not an error (the association may legitimately name increments whose evaluator hasn't run yet — they stay unverified at `coverage`).
- **Malformed `--association` JSON / non-object** → exit 2 (usage error, fail-loud — a broken association is operator error, not a silent empty map).
- **Two files for one PRDR disagree** → conservative fold makes the PRDR not-met (a single failing re-run is never masked).

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the association is the new trust-bearing input — a wrong `key→prdr` entry attributes one increment's `met` to the wrong PRDR, forging coverage for a goal that was never evaluated. **How you'd know:** the `skipped` audit trail surfaces unexpected keys, but a *wrong* (not missing) mapping is silent. **What it means:** v1a accepts this — the association is operator/orchestrator-supplied data, and the same trust is already placed in `--dod-verdicts` today; the trust gate guards verdict *integrity*, not association *correctness*. The future pipeline that auto-builds the association from issue↔PRDR links (OUT OF SCOPE) is where this closes. Named residual, not hidden.
- **The failure:** the `code_blind: true` attestation the gate relies on is self-reported (FAFF-34's named residual — blindness is by construction, not yet sandbox-enforced). A lying `true` would pass the gate and yield a spurious `met`. **How you'd know:** unchanged from FAFF-34 — only the deferred sandbox closes it. **What it means:** this slice inherits, and does not widen, FAFF-34's residual; it adds no new trust in `code_blind` beyond requiring it `true`.

**Anti-pattern:** hand-assembling the `--dod-verdicts` map in orchestrator prose by reading `.faff/holdout/` directly. Why: it skips the contract trust gate and the conservative fold, so a malformed or stale file could forge product-done — the exact failure the subcommand exists to prevent.

**Anti-pattern:** translating any aggregate other than `meets-spec` to `met`. Why: `gaps`/`fails`/`needs-human` are *not* done; only `meets-spec` is, and coverage's roll-up is correct only if `met` means exactly that.

**Anti-pattern:** making the subcommand read the tracker to resolve the association itself. Why: it would break the tool's purity (parity with `coverage`) and put a tracker call on a path that must stay reproducible; the association is passed as data.

## 5. Scenarios — born-verifiable main objectives

```
Given a .faff/holdout/FAFF-34.json holding a conformant code_blind verdict with aggregate "meets-spec"
  and an association {"FAFF-34":"0007"}
When `faff holdout verdicts --association '{"FAFF-34":"0007"}' --dir <store> --json` runs
Then the output verdicts map is {"0007":"met"}
```

```
Given a holdout file whose verdict has code_blind:false (or any contract violation)
  and an association mapping its key to a PRDR
When `faff holdout verdicts` runs
Then that PRDR is absent from verdicts and the file appears in skipped with reason "contract-rejected"
```

```
Given a holdout file with aggregate "fails" that is otherwise contract-conformant
  and an association mapping its key to PRDR "0008"
When `faff holdout verdicts` runs
Then verdicts["0008"] is "fails" (a value ≠ "met"), so coverage leaves 0008 unverified
```

```
Given the resulting DoD-verdict map {"0007":"met"} and a PRD whose only goal is covered by live PRDR 0007
When `faff prdr coverage --prd-goals <goals> --dod-verdicts '{"0007":"met"}'` runs
Then prd-satisfied is true (covered ∧ all DoDs met) — the previously-pinned-false roll-up can now pass
```

```
Given two holdout files both associated to PRDR "0007", one "meets-spec" and one "fails"
When `faff holdout verdicts` runs
Then verdicts["0007"] is not "met" (the conservative fold — a failing sibling is never masked)
```

Non-functional assertions:

- `faff holdout verdicts` MUST be pure — no tracker, no network, no LLM; filesystem read of `--dir` only.
- A persisted verdict MUST re-pass the `holdout-verdict` contract gate (conformant ∧ `code_blind:true`) before it can yield `met`.
- Only `aggregate: meets-spec` MUST translate to the literal `met`; every other aggregate MUST map to a value ≠ `met`.
- The subcommand MUST NOT mutate `faff prdr coverage` or `computePrdCoverageVerdict`.

## 6. DESIGN DECISION RATIONALE

**A new subcommand vs a `--holdout-dir` flag on `coverage`?** Options: emitter-piped-in (composition) vs internalised read (one call). **Chosen:** a dedicated `faff holdout verdicts` emitter — keeps `coverage` a single-responsibility pure roll-up, makes the trust gate independently testable, mirrors faff's existing `yagni → admit` pipe. (Detailed in WHAT.)

**Where does the PRDR key come from — persist-shape change, filename-by-PRDR, or a supplied association?** **Chosen:** a supplied `issue→PRDR` association — preserves the evaluator's lane isolation (PRDR-blind), needs no persist-shape change, keeps the tool pure. (Detailed in WHAT.)

**Namespace `holdout verdicts` vs `dod verdicts`?** **Chosen:** `holdout verdicts` — `dod classify` is a pure spec parse, this does runtime-store I/O; group it under the store it reads. (Detailed in WHAT.)

**Omit non-`met` PRDRs, or pass their aggregate through?** Options: only emit `met` entries vs emit the real aggregate for every trusted file. **Chosen:** pass the aggregate through for trusted non-`meets-spec` files (`gaps`/`fails`/`needs-human`), omit only *untrusted* (contract-rejected) ones. Rationale: both omission and an explicit non-`met` value yield "unverified" at `coverage` (it compares `=== "met"`), but passing the aggregate through makes the map *diagnostic* — a reader sees *why* a PRDR isn't done — while still never forging done. Untrusted files are omitted because their aggregate cannot be believed at all.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the design is closed; every decision above carries a `**Chosen:**`.

**Assumptions.**

- **Assumes:** the evaluator persists exactly one `holdout-verdict` contract block per `.faff/holdout/<key>.json`, with the filename key being the `issue|run` id (FAFF-34's shipped convention). *Validation:* `faffter-noon-evaluate/SKILL.md` "Roll up + emit" states this; the integration test writes fixtures in that exact shape and round-trips them.
- **Assumes:** each delivering increment (holdout key) maps to **at most one** PRDR for v1a. *Validation:* the association is a `key → single-prdr-id` object; a multi-PRDR increment is OUT OF SCOPE and would be caught as a shape the association cannot express (the operator cannot encode it), not silently mishandled.
- **Assumes:** `computeHoldoutVerdict` is exposed at module scope in `bin/faff` for the reader to call directly (same-process reuse, not a shelled `faff contract` round-trip). *Validation:* it backs `contractHoldoutVerdict` / `faff contract holdout-verdict` today (verified present); if it is not already module-scoped, the build lifts it to module scope without changing its logic (no forked rule), exactly as `dod classify` reuses `classifyCriterion`.

## 8. DONE — Definition of Done

### From WHY
- [ ] With at least one persisted `meets-spec` holdout file and a matching association, `faff prdr coverage --dod-verdicts <map>` can report `prd-satisfied: true` for a fully-covered PRD — the roll-up is no longer pinned false by the missing pipe.

### From WHAT (subcommand + interface)
- [ ] `faff holdout verdicts --association <json|@file|-> [--dir DIR] [--json]` exists, is registered in `COMMANDS`, and is documented in `docs/guide/cli.md`.
- [ ] It reads `.faff/holdout/*.json` from `--dir` (default `.faff/holdout/`) and emits `{ verdicts: {<prdr>:<value>}, skipped: [{key,reason}] }` as JSON on stdout.
- [ ] It is pure: no tracker, no network, no LLM (asserted the way `dod classify`'s purity is).
- [ ] Missing/non-object `--association`, malformed `--association` JSON, or an unreadable `--dir` → exit 2; a successful run (including an empty map) → exit 0; there is no exit 1 (report-only).

### From WHAT (trust gate + translation)
- [ ] Each file's block is re-validated via the shared `holdout-verdict` compute (`computeHoldoutVerdict`, not a forked rule); a fail-loud, a non-empty `violations`, or `code_blind !== true` → the file is skipped `contract-rejected` and yields no `met`.
- [ ] `aggregate: "meets-spec"` translates to the literal `"met"`; `gaps`/`fails`/`needs-human` pass through as their own string (all ≠ `"met"`).
- [ ] A holdout key absent from the association is skipped `no-association` (a PRDR is never guessed).

### From HOW (conservative fold)
- [ ] Two trusted files mapping to one PRDR yield `met` only when **both** are `met`; any non-`met` sibling makes the PRDR not-met (`duplicate`/disagreement never masks a failure).

### From HOW (behaviour — verified by `faff holdout verdicts --selftest`)
- [ ] A conformant `meets-spec` file + association `{key:prdr}` → `verdicts == {prdr:"met"}`.
- [ ] A `code_blind:false` file → that PRDR absent from `verdicts`, present in `skipped` as `contract-rejected`.
- [ ] A conformant `fails` file → `verdicts[prdr] == "fails"` (≠ `met`).
- [ ] An empty `--dir` → `verdicts == {}`, exit 0.
- [ ] `faff holdout verdicts --selftest` passes and is wired into `.github/workflows/validate.yml`.

### From WHAT (consumer unchanged — regression guard)
- [ ] `faff prdr coverage` / `computePrdCoverageVerdict` are **not** modified; the existing `prdr --selftest` (58 cases) still passes.
- [ ] Piping `holdout verdicts`' map into `faff prdr coverage --dod-verdicts` produces the expected `prd-satisfied` roll-up (the end-to-end wiring, exercised in the integration smoke test).

### From WHY (producer note)
- [ ] `faffter-noon-evaluate/SKILL.md` gains a one-line note that the persisted `.faff/holdout/<issue|run>.json` block is now consumed by `faff holdout verdicts` (the FAFF-34 "proven by use" close-out); the skill still passes `faff validate-adapters`.

### Integration smoke test (plumbing-connected path)

```
PROCEDURE smoke():
  dir   <- a temp .faff/holdout with two fixture files:
             "FAFF-A.json" = conformant code_blind verdict, aggregate "meets-spec"
             "FAFF-B.json" = conformant code_blind verdict, aggregate "fails"
  assoc <- {"FAFF-A":"0007","FAFF-B":"0008"}
  out   <- run `faff holdout verdicts --association <assoc> --dir <dir> --json`
  assert out.verdicts == {"0007":"met","0008":"fails"}
  cov   <- run `faff prdr coverage --prd-goals '["g7","g8"]'
                 --live-prdrs '[{"id":"0007","prd_goal":"g7"},{"id":"0008","prd_goal":"g8"}]'
                 --dod-verdicts <out.verdicts>`
  assert `printf '%s' cov | faff contract prd-coverage` exits 0
  assert cov.satisfied == false AND cov.completion.unmet_or_unverified includes "0008"
  # flip B to meets-spec, re-run: cov.satisfied becomes true (covered ∧ all DoDs met)
```
