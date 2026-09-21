# FAFF-1055 — Stop the auto-refute syntax detector from downgrading non-syntax review prose

> Spec: faffter-dark-nlspec · 2026-09-20 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1055.

This is the buildable spec for FAFF-1055, addressed to the build agent that will edit the adversarial-review transport and to the human reviewers gating this change. It shapes the ticket's unsettled "Proposed direction" into a landed decision: fix the FAFF-194 auto-refutation pass so a documentation-drift objection can no longer be mechanically "disproved" by a `node --check` run that has nothing to do with it.

## 1. WHY — Problem and Principles

**The load-bearing model.** The FAFF-194 refutation pass is a *precision-first, downgrade-only* filter with two independent guards standing in series: (1) a **claim detector** — `findSyntaxClaims` — that decides whether a review finding even asserts a syntax/parse fault, and (2) a **target resolver** inside `refuteFindings` that decides which files `node --check` must positively pass before the finding is demoted. A finding is downgraded to a non-gating `observation` only when the detector fires *and* every resolved target parses clean. The whole design rests on the detector matching a **narrow closed grammar** — "won't parse", "SyntaxError", "invalid JavaScript" — and on the resolver refusing to act when it cannot tie the claim to a specific checkable file. This spec repairs both guards where they have quietly widened.

**Problem statement.** The detector's final regex alternative `not (valid|parseable|parsable)` has no word boundary, so `not valid` matches inside `not validate` — an ordinary phrase in architectural and infosec review prose ("the spec does **not valid**ate containment", "the loader is **not valid**ated anywhere"). When such a prose objection names no context file, the resolver's generic-claim fallback sweeps *every* JS-family context path, and on a healthy repo that sweep passes — so a legitimate, gating objection is rewritten to `### observation: [auto-refuted] … mechanically disproved` and, downstream, `parseRefutation` computes the lens's outcome as `clear`, flipping its vote.

**Design principle — precision over recall is the invariant, not a tuning knob.** FAFF-194's contract is that a wrongly-downgraded *true* finding is the expensive error and a surviving *false* finding merely costs a disproof cycle. Any change here must move strictly toward precision: it may retire refutations that were false positives, and it must never newly demote a finding the current code leaves standing. An implementation that widens what gets auto-refuted is wrong even if it looks tidier.

**Design principle — the two guards are independent and both must hold.** Tightening the regex alone still leaves a genuine "not parseable" prose objection (used in a non-syntax sense) exposed to the all-JS sweep; gating the sweep alone still lets a mis-detected claim that *does* name a JS file get demoted. Neither fix subsumes the other at the edges, so both are in scope. Do not treat one as making the other optional.

**Design principle — do not silently retire the pass FAFF-194 built.** The narrowing must be pinned by fixtures that keep the true positives (`SyntaxError`, `will not parse`, `is not valid JavaScript`, `fails to parse`) matching and keep a genuine syntax claim naming a passing file downgraded exactly as before. A tightening with no true-positive fixtures is indistinguishable from breaking the feature.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM (`.mjs`) | Home of `SYNTAX_CLAIM_RE` (~L823), `findSyntaxClaims` (~L825), `claimTargets` (~L853), `refuteFindings` (~L888) — the only file this change edits |
| `test/adversarial-call.test.mjs` | Node test runner | The FAFF-194 fixture suite (~L2178–2311) this DoD extends; contains the generic-fallback test that must be inverted |
| `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs` | Node ESM | Downstream consumer; `parseRefutation` derives `outcome = objections.some(gating) ? "refuted" : "clear"` from the transport's *post-refutation* bytes. Read-only here — fixing the detector fixes the flip; this file is not edited |

**Scope statement.** This sits at the very end of the adversarial-review transport, between a refuter lens emitting markdown findings and `parse-refutation.mjs` rolling them into the spec-review verdict; it is the last stage that can rewrite a finding's severity before the vote is counted.

## 2. OUT OF SCOPE

- **The downstream vote arithmetic in `parseRefutation` / `aggregate.mjs`** — *Why excluded:* the flip is a faithful consequence of a mis-demoted section; once the detector stops mis-firing, the arithmetic is correct as written. *Extension point:* `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs` (`parseRefutation`) if a future issue wants a severity-floor independent of refutation.
- **Broadening the checkable grammar beyond JS-family `node --check`** (e.g. JSON/YAML/TS validation) — *Why excluded:* FAFF-194 deliberately scoped the mechanical check to `node --check` on `.js/.cjs/.mjs`; widening the checker is a separate design. *Extension point:* `realCheck` and `isJsFamily` / `JS_FAMILY_RE` in `review-call.mjs`.
- **The sibling grammar-tolerance defects FAFF-1053 and FAFF-990, and the severity-less-heading fault FAFF-1056** — *Why excluded:* different failure modes in the same transport; FAFF-990 already merged and touches `parse-refutation.mjs`, not this detector. *Extension point:* their own tickets; keep this change surgical so it composes with theirs.
- **Making auto-refutation opt-in / configurable per run** — *Why excluded:* this is a correctness fix to an always-on pass, not a policy change. *Extension point:* the `checkFn` injection seam already present on `refuteFindings`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Syntax claim | A finding asserting code will not parse / is invalid syntax — the only class this pass is licensed to mechanically disprove |
| Detector | `findSyntaxClaims(sectionText)` → boolean, backed by `SYNTAX_CLAIM_RE` |
| Target resolver | The block in `refuteFindings` that computes `targets` (the files that must pass `node --check`) for a matched section |
| Generic-claim fallback | The current `if (!namedAnyContextPath) targets = jsPaths` arm (~L904) that sweeps every JS-family context path when a syntax claim names no file |
| Named-path gate | The Chosen replacement: a matched claim is refuted only if it names ≥1 JS-family context path |

**The detector regex (the WHAT that changes).** `SYNTAX_CLAIM_RE` is a single alternation. The change adds word boundaries to the two alternatives that leak into ordinary prose and leaves the audited-safe alternatives untouched:

```
SYNTAX_CLAIM_RE (target shape):
  /syntax error
   | SyntaxError
   | won'?t parse
   | will not parse
   | fails? to parse
   | \binvalid (javascript|js|syntax)\b      # anchored: was unanchored
   | \bnot (valid|parseable|parsable)\b/i    # anchored both sides: was unanchored
```

- The trailing `\b` on `not (valid|…)` rejects `not validate` / `not validated`; the leading `\b` additionally rejects `cannot validate` (where `not valid` currently matches inside `can·not valid·ate`).
- The `\b` on `invalid (…)` rejects `invalid json` / `invalid jsx` — see the Design Decision Rationale; this is a real leak the ticket's audit understated, not a defensive flourish.
- `not valid syntax` (an existing true positive) still matches: `\bnot valid\b` fires because a space follows `valid`.

**The target resolver (the second WHAT that changes).** The generic-claim fallback is removed. `refuteFindings` resolves `targets` as: the JS-family context paths the section *names* (`claimTargets`); if that set is empty, the finding is left untouched — no all-files sweep.

```
RESOLVER (target shape, replacing ~L901–906):
  targets = claimTargets(section.raw, contextPaths)   # JS-family paths NAMED in the finding
  IF targets is empty:
    leave the finding untouched   # a syntax claim that names no checkable file is not ours to disprove
```

- `checkFn` (default `realCheck` = `spawnSync("node", ["--check", path])`) stays the injectable FAFF-194 test seam; fixtures exercise it, they do not shell out.
- No change to `claimTargets`, `pathMentionedIn`, splicing/reconstruction, evidence-line format, or the downgrade-never-drop behaviour.

**Design decisions** are collected in §6; each carries its canonical marker there.

## 4. HOW — Behaviour

**Approach.** Two localized edits to `review-call.mjs`, plus the comment/docstring corrections that keep the code honest, plus fixtures. No new functions, no new I/O, no signature changes.

**Behaviour summary — detector.** After the change, `findSyntaxClaims` returns `true` only for text that asserts an actual parse/syntax fault, and `false` for the `not validate` / `is not validated` / `invalid json` prose that currently trips it.

```
findSyntaxClaims(t):
  return SYNTAX_CLAIM_RE.test(t)   # unchanged body; the regex is what tightens
```

**Behaviour summary — resolver.** After the change, `refuteFindings` demotes a matched section only when the section names at least one JS-family context path and every such path passes `node --check`. A section naming no checkable path is skipped before any check runs.

```
PROCEDURE refuteFindings(content, contextPaths, {checkFn}):
  FOR each finding section (last-to-first, severity != null):
    1. IF NOT findSyntaxClaims(section.raw): skip
    2. targets = claimTargets(section.raw, contextPaths)
    3. IF targets is empty: skip            # named-path gate — no generic all-JS sweep
    4. results = targets.map(checkFn)
    5. IF any result not ok: skip           # reviewer may be right — untouched (precision bias)
    6. rewrite heading -> "### observation: [auto-refuted] <title>"
       insert evidence line "> auto-refuted: node --check passed on <files> — syntax claim mechanically disproved (was <severity>)"
```

**Edge cases.**
- **Non-JS-only context** (e.g. only `SKILL.md` named): `claimTargets` already returns empty → skipped. Unchanged.
- **Named JS file that FAILS the check**: any non-ok result → untouched. Unchanged (precision bias preserved).
- **A true syntax claim naming a passing `.mjs`**: still detected, still resolved to that file, still downgraded with its evidence line. Unchanged — pinned by fixture.
- **Multiple sections, mixed**: each resolved independently; last-to-first splicing preserves untouched sections' bytes and blank-line separators. Unchanged.

**Failure modes.**
- **The failure:** the named-path gate over-narrows — a *genuine* generic syntax claim ("this build won't parse", naming no file) is now never auto-refuted, so a false finding of that exact shape survives to cost the implementor a disproof cycle. *How you'd know:* a refuter emits a gating syntax claim with no file reference and it reaches the verdict un-demoted. *What it means:* accept and proceed — this is the deliberate precision/recall trade the ticket endorses (a claim that cannot name a file is the one least likely to be a real, checkable syntax fault); the cost is bounded and one-sided (never a wrongly-killed true finding).
- **The failure:** the regex tightening silently retires a true-positive phrasing FAFF-194 relied on. *How you'd know:* the true-positive fixtures (`SyntaxError`, `will not parse`, `is not valid JavaScript`, `fails to parse`, `not valid syntax`) go red. *What it means:* the anchors were placed wrong — narrow them; do not ship with those fixtures failing.

**Anti-pattern:** Replacing the removed fallback with "sweep all JS files but only if the regex matched a stronger phrase." Why: it reintroduces the all-files sweep this spec removes and re-couples the two guards the design keeps independent.

**Anti-pattern:** Anchoring the whole alternation with a single outer `\b…\b` wrapper. Why: `won'?t parse` and `SyntaxError` have their own boundary characteristics; a blanket wrapper risks dropping a real true positive. Anchor per-alternative, only where a prefix/suffix leak is demonstrated.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a refuter finding whose only objection is prose "the spec does not validate containment (the ticket's own constraint)"
When refuteFindings runs against a repo whose JS context files all parse
Then findSyntaxClaims returns false for that body, no node --check runs, and the finding is returned byte-identical at its original gating severity
```

```
Given a gating `minor` syntax-shaped objection that names NO context path (e.g. "this code has a syntax error somewhere")
When refuteFindings runs with several clean JS-family context paths available
Then the named-path gate skips it before any check and the objection survives unchanged (no all-JS sweep, no demotion)
```

```
Given a genuine `critical` finding "`<file>.mjs` is invalid JavaScript syntax" naming a context file that passes node --check
When refuteFindings runs
Then the heading is rewritten to "### observation: [auto-refuted] …" with the unchanged evidence line "node --check passed on <file> — syntax claim mechanically disproved (was critical)"
```

- The detector MUST still return `true` for each of: `throws a SyntaxError`, `will not parse`, `is not valid JavaScript`, `fails to parse`, `not valid syntax`.
- The detector MUST return `false` for each of: `does not validate X`, `is not validated`, `does not validate the path`.

## 6. Design Decision Rationale

**Do we tighten the regex, gate the sweep, or both?**
- *Regex only (direction 1):* fixes this exact instance; leaves a genuine "not parseable" prose objection exposed to the all-JS sweep.
- *Sweep-gate only (direction 2):* stops every no-file sweep; leaves a mis-detected claim that coincidentally names a JS file demotable.
- *Both (direction 3):* the two guards are independent (WHY principle); neither closes the other's edge.
- **Chosen:** Do both — anchor the leaking regex alternatives *and* remove the generic-claim fallback so a syntax claim must name ≥1 JS-family context path before any `node --check` runs. Rationale: the ticket's own RCA shows the guards are independent, the fix is small and strictly precision-increasing, and defense-in-depth here is nearly free.

**Which regex alternatives get anchored?**
- **Chosen:** Anchor `\bnot (valid|parseable|parsable)\b` (both sides — closes `not validate`, `not validated`, and `cannot validate`) and `\binvalid (javascript|js|syntax)\b` (closes `invalid json`, `invalid jsx`). Leave `syntax error`, `SyntaxError`, `won'?t parse`, `will not parse`, `fails? to parse` unanchored. Rationale: an audit of the alternation found only these two leak into common review prose. The ticket asserted `invalid (javascript|js|syntax)` "looks safe"; it is not — `invalid js` is a prefix of `invalid json`/`invalid jsx`, and because such a JSON-validity claim can name a `.js` file that parses clean, this leak is *independently* exploitable even after the sweep-gate lands. Anchoring it is part of the correct fix, not gold-plating. The parse-family alternatives were reviewed and left unanchored: `won't parse` / `fails to parse` do not prefix common English words in a way that produces false positives, and the house lean-diff bar favours not touching what does not leak.

**Should the generic-claim fallback be removed entirely, or kept but gated?**
- **Chosen:** Remove it entirely — a matched claim naming no JS-family context path is left untouched. Rationale (ticket's direction 2): a claim that cannot name a file is the one least likely to be a real, mechanically-checkable syntax fault, so the sweep's recall benefit does not justify its near-certain false-positive rate on a healthy repo.

**What happens to the existing generic-fallback fixture?**
- **Chosen:** Invert `test("FAFF-194 refuteFindings: a generic claim naming no file falls back to checking ALL JS-family context files", …)` (~L2251) to assert the new contract: a generic claim naming no file yields `refutations.length === 0` and byte-identical output, with `checkFn` asserted *never called*. Rationale: this is a deliberate, documented behaviour change; pinning the new contract in the same test slot is how "do not silently retire the pass" is honoured rather than violated.

*Temporal anchor:* at the time of writing, `node --check` is the sole mechanical checker in this pass and JS-family the sole checkable family; revisit the sweep-removal trade-off if a broader checker is ever added.

## 7. Open Questions and Assumptions

**Open Questions.** None. The ticket's analysis and the codebase together settle every sub-decision; all are Chosen in §6.

**Assumptions.**
- **Assumes:** the FAFF-194 fixture suite in `test/adversarial-call.test.mjs` (~L2178–2311) is the sole test coverage of this pass. *Validation:* before editing, `grep -rn "findSyntaxClaims\|refuteFindings\|claimTargets\|SYNTAX_CLAIM" test/` and confirm no other file asserts the generic-fallback behaviour; if another does, extend the same inversion there.
- **Assumes:** `refuteFindings` is the only caller path that can demote a spec-review refuter section before `parseRefutation` reads it. *Validation:* confirm `parse-refutation.mjs`'s header note ("downgraded any mechanically-disproved gating section … via `refuteFindings`") still describes the pipeline; no code change needed if so.

## 8. DONE — Definition of Done

### From WHY (precision invariant)
- [ ] No finding that the pre-change code leaves standing is newly demoted by the post-change code (the change is strictly precision-increasing) — evidenced by the true-positive and genuine-syntax-claim fixtures staying green.

### From WHAT (detector regex)
- [ ] `SYNTAX_CLAIM_RE` anchors `\bnot (valid|parseable|parsable)\b` and `\binvalid (javascript|js|syntax)\b`; the other alternatives are unchanged.
- [ ] `findSyntaxClaims` returns `false` for `"does not validate X"`, `"is not validated"`, `"does not validate the path"`, `"cannot validate the input"`, and `"the payload is invalid json"`.
- [ ] `findSyntaxClaims` returns `true` for `"throws a SyntaxError"`, `"will not parse"`, `"is not valid JavaScript"`, `"fails to parse"`, and `"not valid syntax"`.

### From WHAT (target resolver)
- [ ] The generic-claim fallback (`if (!namedAnyContextPath) targets = jsPaths`) is removed; `refuteFindings` resolves `targets` solely via `claimTargets`, and an empty `targets` set skips the finding before any `checkFn` call.
- [ ] The `refuteFindings` docstring (~L867–887) and the inline comment at the removed fallback, plus the `SYNTAX_CLAIM_RE` comment (~L820–823), are updated so no comment describes the retired all-JS sweep or the old grammar breadth.

### From HOW (behaviour preserved)
- [ ] A genuine syntax claim naming a JS-family context file that passes `node --check` is still downgraded to `### observation: [auto-refuted] …` with the unchanged evidence line and `refutations[0].from` equal to the original severity (existing fixture ~L2221 stays green, unmodified).
- [ ] A named target that fails the check still leaves the finding byte-identical (existing fixture ~L2234 stays green).

### From HOW (behaviour changed)
- [ ] The inverted generic-fallback fixture (~L2251) asserts `refutations.length === 0`, byte-identical output, and that `checkFn` is never called for a syntax claim naming no context path.

### From Scenarios (regression)
- [ ] A regression fixture reproduces the FAFF-1048 methodology objection body (a gating `minor` whose text contains "does not validate containment" and names no context path) and asserts `refuteFindings` returns it unchanged at severity `minor` with zero refutations — exercising both guards (the regex no longer matches and the named-path gate would skip it anyway).
- [ ] A fixture asserts a `node --check`-clean-but-JSON-invalid framing that names a `.js` file (e.g. "`config.js` emits invalid json") is NOT auto-refuted (the anchored `invalid (…)` alternative), demonstrating the regex fix is load-bearing independent of the sweep-gate.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (this is a deterministic regex + control-flow change); no grader registration is required.

**Integration smoke test.**
```
GIVEN content = "### minor: the ticket's key name and Containment constraint are stale\n- claim: the spec does not validate containment (the ticket's own constraint)…"
      contextPaths = ["plugin/skills/ctx48/adr.js", "plugin/skills/ctx48/config.js"]   # both parse clean
WHEN  refuteFindings(content, contextPaths, { checkFn: () => ({ ok: true, output: "" }) })
THEN  refutations === []  AND  out === content  (the `minor` survives, no `[auto-refuted]` heading, checkFn never consulted)
```

confidence: high
build-tier: complex
spec-review: approve
