# FAFF-194 — Adversarial review: deterministic guards for machine-checkable findings + output-format enforcement

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-194.

This spec addresses FAFF-194: harden `review-call.mjs` (the adversarial-review backend helper) so that (a) a reviewer finding asserting a defect a tool can settle is mechanically refuted before it surfaces, and (b) reviewer output that is not findings-shaped can never pass as a silent exit 0. Audience: the build agent implementing it and human reviewers.

## 1. WHY — Problem and Principles

**The load-bearing model:** the adversarial reviewer is a deliberately fallible LLM whose *findings are hypotheses*; today the harness trusts two things it should settle itself — whether a "this is a syntax error" claim is true (a `node --check` answers that), and whether the model's raw output is findings-shaped at all (`main()` prints whatever content the winning backend streamed, even empty, as exit 0). Both checks move into the deterministic helper, so the LLM is spent only on judgement, never on claims or formats a tool can verify.

**Problem statement:** a live run returned a confidently-wrong `critical` claiming valid JavaScript was a syntax error, and the same run's output skipped the required `## Adversarial findings — <provider>/<model>` header yet passed as exit 0 — the malformed-output rule exists only as skill prose. The soft-signal design absorbed it, but it cost an implementor disproof cycle for a claim `node --check` settles in milliseconds, and under the autonomous `critical` escalation (shipped since — FAFF-297/353) a refutable false `critical` now parks a whole run.

**Design principles:**

**Precision over recall for refutation.** A finding is downgraded only when the mechanical check *positively passes* on every file the claim can be tied to. Any inability to tie the claim to a checkable file, or any check failure, leaves the finding untouched. A wrongly-downgraded true finding is the expensive error; a surviving false finding merely costs the implementor a disproof (the status quo).

**Never drop, always downgrade with evidence.** A refuted finding stays in the output, severity rewritten to `observation`, with the check result appended — the audit trail is the point. Silent removal would hide what the reviewer got wrong (and mask model-quality signal the ticket exists to observe).

**Provenance is harness data, not model prose.** The helper knows the winning backend's `provider/model` authoritatively; the header that names it is authored by the helper, never demanded from the fallible model (see Design decision rationale — this refines provisional AC-2).

**Zero new config.** No new `.faffrc` keys (explicit ticket constraint); every input already exists (`--context` paths, the chain's backend descriptors).

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (zero-dep) | The helper being hardened; hosts all new pure functions + the post-pass |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | prose | Exit-code table + output format + lens prompt; gains the new exit row and the explicit no-findings marker rule |
| `test/adversarial-call.test.mjs` | Node test | Existing 81-test suite; pure-function + injectable-transport pattern the new tests extend |

**Scope:** this hardens the Phase-2 helper of the `review` slot's adversarial occupant only; the review-verdict contract, faff-graft's gate, and the escalation rules are unchanged consumers.

## 2. OUT OF SCOPE

- **Crash / test-failure claim refutation** — why: a green suite does not refute "this crashes on input X" (the claim is about an *uncovered* path), and running the project's test command inside a zero-dependency helper imports repo test config into a tool that deliberately has none; the implementor disposition step (which already demands cited evidence per finding) keeps covering these. Extension point: a `--test-cmd` flag + a second claim class in the same classifier/refuter pair in `review-call.mjs`.
- **Off-lens guard (ticket item 3, "optional")** — why: mapping free-prose findings onto the five semantic lens categories is judgement, not a deterministic check — a wrong demotion silently buries a real cross-cutting finding, the expensive error direction. Extension point: a lens-tag requirement in the system prompt plus a tag validator next to `validateFindingsShape`.
- **Model/quant choice** — per the ticket, a config decision; the harness hardens around any backend.
- **Phase-1 review, verdict contract, escalation thresholds** — untouched consumers; a refuted `critical` simply never reaches them as a `critical`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| finding section | one `### <severity>: <title>` block (heading + body until the next `###`/end) in the reviewer output |
| findings-shaped | output containing ≥1 finding section whose severity is in the closed set `critical\|major\|minor\|observation` |
| machine-checkable claim | a finding whose text asserts something a deterministic tool settles; v1 class: syntax/parse claims |
| refuted | every file the claim ties to passes the mechanical check, so the claim is mechanically false |

**New pure functions (all exported from `review-call.mjs`, all I/O-free except where an injectable fn is passed):**

```
splitFindings(content) -> { preamble, sections: [{ heading, severity|null, title, body, raw }] }
  # tolerant split on /^###\s/m; severity parsed from /^###\s*\[?(critical|major|minor|observation)\]?\s*[:—-]/i

validateFindingsShape(content) -> { ok: bool, reason?: string }
  # ok iff trimmed content non-empty AND splitFindings yields >=1 section with a recognised severity

canonicalHeader(provider, model) -> "## Adversarial findings — <provider>/<model>"

ensureHeader(content, provider, model) -> content'
  # if a /^##\s*Adversarial findings/mi line exists, REPLACE it with canonicalHeader (authoritative
  # provenance beats a model-echoed, possibly-wrong tag); else PREPEND canonicalHeader + blank line

findSyntaxClaims(sectionText) -> bool
  # recall-tuned within the class: /syntax error|SyntaxError|won'?t parse|will not parse|
  #   fails? to parse|invalid (javascript|js|syntax)|not (valid|parseable|parsable)/i

claimTargets(sectionText, contextPaths) -> [path]
  # context paths whose string appears in the section text, filtered to JS-family
  # extensions (.js .mjs .cjs); empty when the claim names none

refuteFindings(content, contextPaths, { checkFn }) -> { content', refutations: [{ title, files, from }] }
  # for each section where findSyntaxClaims: targets := claimTargets(...) or, when empty, ALL
  # JS-family contextPaths; if targets is empty -> untouched (cannot settle); run checkFn(path)
  # per target; iff EVERY target returns ok -> rewrite severity to `observation`, prefix title
  # with `[auto-refuted]`, append evidence line
  #   `> auto-refuted: node --check passed on <files> — syntax claim mechanically disproved (was <severity>)`
  # any check failure or non-syntax section -> untouched
```

**The injectable check runner (the only new I/O):**

```
realCheck(path) -> { ok: bool, output: string }   # spawnSync("node", ["--check", path]); ok iff exit 0
```

`checkFn` defaults to `realCheck` and is injectable exactly as `getFn`/`streamFn` are, so CI spawns nothing.

**Exit-code surface (extends the existing closed set):**

```
EXIT.MALFORMED = 10   # winning-candidate output not findings-shaped (empty, header-only, or no
                      # recognised finding section) — a model-quality fault, per-backend
```

- `EXIT.MALFORMED` joins `CHAIN_NEEDS_HUMAN` (it is a model/config-quality class like 2/4/6/7: a chain exhausted with a malformed fault anywhere → needs-human, never pass+skip).
- `mandatoryRemap` passes 10 through unchanged (only no-opinion classes 5/8 remap; a cause is never masked).
- 3 is skipped deliberately — `faff config` uses exit 3 for absent keys and the skill prose tables read exits across both binaries; 10 is unambiguous.

**Design decisions** (rationale collected in section 6): **Chosen:** all guards live in `review-call.mjs` as exported pure functions + injectable check runner. **Chosen:** header is harness-authored (normalise/prepend), not a park trigger. **Chosen:** shape validation is per-backend inside `runReviewChain` (a malformed primary advances to a fallback). **Chosen:** refutation covers the syntax/parse claim class only in v1 and downgrades to `observation`, never drops. **Chosen:** new exit `MALFORMED = 10` in `CHAIN_NEEDS_HUMAN`.

## 4. HOW — Behavior

**Where each guard sits in the existing flow:**

```
PROCEDURE runReviewChain (per backend, existing loop):
  1. result := runReviewFn(backend)
  2. exit := mapResultExit(result, hostSource)
  3. IF exit == OK:
     a. shape := validateFindingsShape(result.content)          # NEW
     b. IF NOT shape.ok:
        - failureClasses.push(EXIT.MALFORMED)
        - log "advancing|exhausted: <tag> produced non-findings output (<shape.reason>) (exit 10)"
        - CONTINUE to next backend                              # a fallback may do better
     c. ELSE return { exit: OK, content, winner, ... }          # unchanged
  4. non-OK handling unchanged; chainTerminalExit picks 10 over 5 via CHAIN_NEEDS_HUMAN

PROCEDURE main (on an OK chain result, before stdout):
  1. { content, refutations } := refuteFindings(res.content, contextJsPaths, { checkFn })   # NEW
     - contextJsPaths := a.context filtered to .js/.mjs/.cjs
     - each refutation logged to stderr: "refuted: \"<title>\" — node --check clean on <files>; <sev> → observation"
  2. content := ensureHeader(content, winner.provider ?? "ollama", winner.model)            # NEW
     - when a header line was absent, log "normalized: findings header missing — prepended canonical provenance"
  3. print content; return EXIT.OK                              # unchanged
```

**Behavior summary — refutation:** a finding claiming code won't parse is tied to the JS-family context files it names (or all of them when it names none); `node --check` is run on each; only a clean pass on every target downgrades the finding, with the evidence appended in place.

**Edge cases:**

- Empty/whitespace content from a reachable+served model → `validateFindingsShape` fails → exit-10 class (today: silent exit 0 with empty stdout — the worst current hole).
- Content with prose but no `###` sections (a refusal, rambling, or headerless essay) → malformed, same path.
- A syntax-claim finding naming only non-JS files (e.g. `SKILL.md`) → `claimTargets` empty and no JS-family fallback targets bound to the claim's named files → untouched (cannot settle; precision bias).
- No JS-family context files at all → refutation pass is a no-op.
- A target file path that no longer exists → `realCheck` returns not-ok (spawn failure) → untouched (never refute on a failed check).
- A finding whose named file genuinely fails `node --check` → untouched — the reviewer may be right.
- Multiple syntax-claim findings → each refuted independently.
- Legacy single-backend path → identical behaviour (1-element chain, same validation + post-pass).
- Truncated-but-OK content (`truncated: true`) → validation and refutation run on what arrived; the existing truncation note still prints.

**Failure modes:**

- **The classifier misses a syntax claim phrased novelly** — how you'd know: a refutable claim survives to the implementor disposition step (status-quo cost, visible in graft logs). Means: extend the regex; recall inside the class is tunable data.
- **The classifier over-matches a semantic finding that merely mentions "syntax"** — how you'd know: a downgraded finding whose body was not actually a parse claim shows up in the stderr refutation log with its evidence line. Means: the downgrade is visible and reversible by the implementor (the finding text survives); tighten the regex.
- **A model that legitimately found nothing is classed malformed** — how you'd know: exit-10 needs-human on a clean diff with a well-behaved model. Means: the lens prompt (SKILL.md) now mandates an explicit `### observation: no findings` section, making the empty case findings-shaped by construction; if this fires in practice the prompt line needs strengthening, not the validator loosening.

**Anti-pattern:** validating shape in `main()` instead of per-backend. Why: it would turn a malformed *primary* into a whole-chain failure while a healthy fallback sat unused — the FAFF-232 chain exists precisely to advance past a bad backend.

**Anti-pattern:** letting the refuter delete findings. Why: silent removal destroys the model-quality audit trail and could hide a mis-classified true finding; a downgraded `observation` with evidence is recoverable, a deletion is not.

**SKILL.md prose changes (same PR):**

- Exit table: add row `10` — "winning backend's output not findings-shaped (empty / no recognised finding sections) — model-quality fault" → `needs-human` in both modes.
- Output-format section: note the header is normalised by the helper (harness-authored provenance) and that severities on refuted findings arrive pre-downgraded with evidence attached.
- Review-lens system prompt requirements: when there are no findings, the reviewer MUST emit exactly one section `### observation: no findings` (keeps the no-findings case findings-shaped).
- "Malformed/empty content from a reachable+served model → needs-human" line: mark it mechanically enforced (exit 10), no longer prose-only.

## 5. SCENARIOS

```
Given a winning backend whose output contains "### critical: `[...names]` is invalid JavaScript syntax"
  and the named file is passed via --context and parses clean under node --check
When review-call.mjs post-processes the winning content
Then the finding's severity reads "observation", its title carries "[auto-refuted]",
  an evidence line naming the node --check result is appended,
  and a refutation line is written to stderr
```

```
Given a winning backend whose output is empty or contains no recognised finding section
When runReviewChain evaluates that backend
Then the backend is recorded as failure class 10 and the chain advances;
  and if every backend fails, the terminal exit is 10 (needs-human), never 5 (pass+skip)
```

```
Given a winning backend whose output lacks the "## Adversarial findings" header
  but is otherwise findings-shaped
When review-call.mjs post-processes the winning content
Then stdout carries the canonical header naming the winning backend's provider/model,
  and exit is 0
```

```
Given a syntax-claim finding naming a context file that FAILS node --check
When the refutation pass runs
Then the finding is untouched at its original severity
```

Assertion: no new `.faffrc` keys are read anywhere in the change (config schema byte-identical).

Assertion: with a findings-shaped, header-bearing, no-machine-claim output, stdout and exit code are byte-identical to today (back-compat).

## 6. DESIGN DECISION RATIONALE

**Where should the guards live — helper, skill prose, or a sibling script?**
Options: (a) `review-call.mjs` pure functions + post-pass; (b) skill prose instructing the agent to run checks; (c) a separate `verify-findings.mjs`. Prose (b) is the failure mode this ticket exists to remove (the header rule was already prose and didn't fire). A sibling script (c) adds a second entrypoint + invocation seam for ~150 lines that share the helper's parsing. **Chosen:** (a) — matches the FAFF-183 pattern (pure + injectable, unit-tested, zero-dep; `node:child_process` is stdlib).

**Missing header: park (literal provisional AC-2) or harness-author it?**
Options: (a) strict — missing header → malformed → needs-human; (b) normalise — helper prepends/replaces the header with the provider/model it already knows. The header's entire job is provenance, and the harness holds that data authoritatively; (a) demands a fallible model echo config strings and *still* passes a hallucinated wrong-model header, while (b) guarantees correct provenance in every exit-0 output. AC-2's intent — malformed output must not silently pass — is discharged by the shape validation (exit 10), which is the substantive half. The ACs are marked provisional on the ticket; this is the deterministic-tools-over-prose reading of the same intent. **Chosen:** (b) normalise, with the shape validator carrying the fail-closed duty.

**Shape validation locus — per-backend or on the final winner?**
Per-backend keeps the FAFF-232 chain value (a malformed primary advances to a healthy fallback) and composes with `chainTerminalExit` for free. **Chosen:** per-backend inside `runReviewChain`.

**Refutation scope — syntax only, or syntax + crash/test claims?**
The observed incident class is syntax; `node --check` is self-contained, instant, and unambiguous. Crash/test claims need the repo's test command (config the helper deliberately lacks) and a green suite doesn't refute an uncovered-path claim — a false sense of mechanical certainty. **Chosen:** syntax/parse class only in v1; crash/test stays with the evidence-demanding implementor disposition (extension point documented in OUT OF SCOPE).

**Refuted finding: drop or downgrade — and to what?**
Drop hides the audit trail. Downgrade to `minor` would still read as a code concern; `observation` is the existing non-gating class and is truthful ("the reviewer said this; the tool disproved it"). Downgrading also neutralises the autonomous `critical` escalation for exactly the refuted-false-`critical` case (FAFF-297/353 interplay) without touching the escalation rule itself. **Chosen:** downgrade to `observation` + `[auto-refuted]` title prefix + evidence line.

**New exit code value?**
0–9 are taken; 3 is skipped (used by `faff config` for absent keys — the skill prose tables quote exits from both binaries side by side). **Chosen:** `MALFORMED = 10`, member of `CHAIN_NEEDS_HUMAN`, untouched by `mandatoryRemap`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** the documented finding-section format (`### <severity>: <title>`, severities `critical|major|minor|observation`) is the one in `faffter-dark-adversarial-review/SKILL.md` — validate by reading the Output section before implementing the parser.
- **Assumes:** `node` (hence `node --check`) is available wherever `review-call.mjs` runs — trivially true; it is the script's own runtime.
- **Assumes:** `test/adversarial-call.test.mjs` remains the test home and its injectable-fn pattern (`getFn`/`streamFn`) extends cleanly to `checkFn` — validate by reading the existing `runReviewChain` tests first.

## 8. DONE — Definition of Done

### From WHY
- [ ] A confidently-wrong syntax `critical` on a clean file (the FAFF-120 incident shape) is downgraded to `observation` with `node --check` evidence attached before the skill reads severities.

### From WHAT (types and interfaces)
- [ ] `splitFindings`, `validateFindingsShape`, `canonicalHeader`, `ensureHeader`, `findSyntaxClaims`, `claimTargets`, `refuteFindings` exported from `review-call.mjs`, pure (checkFn injectable), each unit-tested.
- [ ] `EXIT.MALFORMED === 10`; `CHAIN_NEEDS_HUMAN.has(10)`; `mandatoryRemap(10, true) === 10`.
- [ ] No new `.faffrc` keys read (config schema unchanged).

### From HOW (behaviour)
- [ ] `runReviewChain`: a non-findings-shaped OK result records failure class 10 and advances; a fully-failed chain containing a 10 terminates with exit 10.
- [ ] Empty content from a reachable+served backend exits 10, never 0.
- [ ] `main()` on a winning result: refutation pass runs against JS-family `--context` paths; header normalised/prepended from the winner's provider/model; refutations and header-normalisation logged to stderr.
- [ ] A syntax-claim finding whose target file fails `node --check` is untouched; one naming only non-JS files is untouched; a diff with no JS-family context files is a no-op pass.
- [ ] Back-compat: a findings-shaped, header-bearing, claim-free output produces byte-identical stdout + exit 0 (existing 81 tests still green).

### From HOW (prose)
- [ ] `SKILL.md`: exit-10 row (needs-human, both modes); lens prompt mandates `### observation: no findings` on a clean review; header documented as harness-authored; the malformed-output rule marked mechanically enforced.

**Integration smoke test:**

```
stub streamFn returning "### critical: file X is invalid JavaScript syntax" for a real temp .mjs
  file that parses clean, passed via --context;
run main() with injected transports + real checkFn;
expect exit 0, stdout beginning "## Adversarial findings — ollama/<model>",
  the finding downgraded to observation with the evidence line present.
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** Yes — one 1–2 day unit. The two scope items (claim refutation + format enforcement) land in the same file behind the same tests and are only meaningful together; the spec descopes the ticket's optional third item (off-lens guard) rather than stretching the slice.
- **Workstream fit?** Minor: the issue is project-less while its nature (gate-integrity hardening of the L4 second-opinion gate) matches the "Trustworthy lights-out — harden & broaden (post-v1)" project, where its siblings (FAFF-329, FAFF-353, FAFF-376) live. Suggest rehoming there — a one-click tracker move, not a blocker.
- **Deps surfaced?** No issues — no open blockers; everything it builds on (FAFF-232 chain, FAFF-329 deadline, FAFF-398 mandatory remap) is merged on main.
- **Risk profile?** No issues — no novel integration; deterministic string/spawn surface with an established injectable-transport test pattern; no de-risking spike warranted.

---

**Spec-review (single-pass, all four lenses fired — L3, appetite high):** verdict **approve**, no objections. Lens notes: architectural — guard locus matches the established pure+injectable helper pattern and composes with the fallback chain; infosec — spawn targets are restricted to the caller-provided `--context` allowlist (array-arg spawn, no shell), and the transform is downgrade-only; methodology — right-sized, descope of the optional off-lens item justified; QA — minor note for the implementor: the back-compat "byte-identical" assertion holds when an existing header is already canonical (normalisation may rewrite a non-canonical one).
