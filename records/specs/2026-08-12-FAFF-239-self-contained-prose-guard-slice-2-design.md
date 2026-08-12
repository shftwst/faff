# Spec: FAFF-239 — Self-contained prose guard (slice 2): sweep external refs from SKILL.md + enforce the ban

> Spec: faffter-dark-nlspec · 2026-08-10 · interactive · confidence: high. Full spec on Linear FAFF-239.

> **Revised 2026-08-10 (reprep — topology + occurrences refresh; approach unchanged).** The sweep target has grown from the original ~120 to **~620 external refs (575 `FAFF-NN` + 45 `ADR`) across 20 `SKILL.md` files** — ~5× the first estimate, and up ~130 in the three weeks since the 2026-07-21 comment. The distribution shifted (the gateway, beep-boop, and graft are now the three heaviest). The growth is structural: the methodology cites `FAFF-NN` in SKILL.md by design (every decision names its ticket), so the count regrows continuously. The design consequence — the sweep and the enforcement flip **must land in the same PR** (any gap regrows) — was already the build order and is now mandatory, not merely recommended. Folded in the 2026-07-21 comment's token-tax / consumability framing. No approach change: still `skillManifestFiles` + sweep-to-zero + enforce.

> **Risk model re-worked 2026-08-10 (confidence medium → high).** A `FAFF-NN` ref points into a private tracker, so its behavioural effect depends entirely on whether the *runtime* reader has tracker access. For an **adopter** the ref is inert — their model cannot dereference it, so removal is behaviourally null. But **in this self-hosting repo** (faff building faff) the model running a skill *does* have the Linear MCP, so the ref is live here: a dev-env model can follow it and absorb context an adopter never could. That split is itself the defect the guard targets — dev-env tracker access can **mask a self-containment gap**, letting a sentence that only works because the dev model backfilled the rule from the ticket pass every faff-on-faff run and then break for the adopter. The sweep is therefore **fidelity-restoring**: it puts dev on the same footing as prod. Consequence for the reword: the **state-forward** step keeps real purpose — where deleting a gesturing ref would change dev behaviour, that reveals prose only functioning via backfill, and the rule must be stated forward so it stands alone for both environments; a ref whose rule genuinely can't be recovered from the prose is a surfaced self-containment bug, not a silent delete. Net: null for adopters, an intended fidelity correction in dev; the residual is edit hygiene over a large diff plus honest state-forward of any masked gap. Confidence is raised to **high** — the approach is fully determined and this insight strengthens, not weakens, the WHY.

This is the build spec for FAFF-239, the second slice of the self-contained-prose guard. Audience: the build agent that will execute the sweep and extend the lint check, plus the human reviewer who gates the reword. Slice 1 (the `faff lint-refs` check + its `docs/guide/` enforcement) is already merged; this slice cleans and then enforces the skills surface.

## 1. WHY — Problem and Principles

**Load-bearing model.** Runtime instruction prose — the `SKILL.md` files an agent loads and *acts on* — must be self-contained: a reader can execute every instruction with only the prose in front of them, no tracker or ADR lookup. An external-artifact reference (a ticket tag, an `ADR 0013` citation, a numbered `docs/adr/0010-foo.md` pointer) in that prose is one of two things: **decorative** (the surrounding prose already states the rule — delete the ref) or **gesturing** (the sentence points at a ticket/ADR *instead of* stating the rule — state the rule forward, then delete). After this slice, `faff lint-refs` enforces zero such refs across `plugin/skills/*/SKILL.md`, so a reintroduced ref fails CI by construction.

**Problem statement.** Slice 1 installed `faff lint-refs` and enforced it on `docs/guide/` (clean by construction), but the skills surface still carries **~620 external refs (575 `FAFF-NN` + 45 `ADR`) across 20 of the `SKILL.md` files** and is unenforced (`lint-refs.js`'s `LINT_REFS_SURFACES` is still `["docs/guide"]`, with a `// slice 2 (FAFF-239) adds plugin/skills/*/SKILL.md` TODO). Until those refs are swept out, the prose carries pointers into a tracker most readers cannot open, and a contributor can freely add more. This slice sweeps the surface to zero and extends the slice-1 check to hold it there.

**The dev-vs-adopter fidelity gap (why removal is safe *and* valuable).** A `FAFF-NN` ref resolves only in a private tracker, so its runtime effect is split by who is reading:

- **Adopter runtime (no tracker access).** The ref is inert — the model cannot dereference it. Removal is behaviourally null: if the sentence's rule is in the prose the ref was decorative; if the rule lived only behind the ref, the adopter never had it, so deleting the dead pointer changes nothing.
- **This self-hosting repo (dev has the Linear MCP).** The ref is *live*: a dev-env model can follow it and pull in context an adopter cannot. This is the hazard the guard exists for — dev-env tracker access can **mask a self-containment gap**. A sentence that only works because the dev model backfilled its rule from the ticket passes every faff-on-faff run, then breaks for the adopter whose model had nothing to fetch. The dev environment silently papers over exactly the defect users would hit.

So the sweep is **fidelity-restoring**, not merely tidying: it forces the dev-env model onto the adopter's footing, so what passes in dev is what an adopter actually gets. Removal changes no adopter behaviour; in this repo it may change dev behaviour, and that change is the intended correction — it exposes any prose that was only functioning via tracker-backfill.

**Two consumability harms the sweep also fixes** (folded from the 2026-07-21 external critique) — both about the *static* prompt:

- **Token tax.** The refs ride the ~365k-real-token skill corpus loaded into every adopter session — dead weight in the static context, and part of the FAFF-487 static-context diet.
- **Unresolvable pointers.** Every `FAFF-NN` points into a private tracker no adopter can open — a broken promise to that reader, and the source of the fidelity gap above.

**Current topology (measured on `origin/main`, 2026-08-10).** ~620 refs across 20 files; the surface is dominated by the three orchestration hubs:

| Skill | FAFF-NN | ADR |
|---|---|---|
| `faff` (gateway) | 128 | 20 |
| `faff-beep-boop` | 127 | 5 |
| `faff-graft` | 123 | 4 |
| `faffter-dark-adversarial-review` | 53 | 0 |
| `faffter-dark-concurrency-parallel` | 27 | 1 |
| `faff-tidy` | 23 | 1 |
| `faffter-noon-concurrency-sequential` | 20 | 1 |
| `faff-prep` | 15 | 0 |
| `faff-plot` | 14 | 8 |
| the remaining ~10 skills | ≤6 each | ≤2 each |

The exact per-file counts are a moving target (they grow with each merged SKILL.md change); the build must **re-measure at sweep time** and drive to zero, not trust this snapshot.

**Design principles.**

- **Restore dev/adopter fidelity — the reword closes gaps, it doesn't preserve runtime meaning.** For an adopter there is no runtime-reachable meaning to lose. The reword's job is to ensure the prose stands alone for *both* environments: where a sentence gestures at a ticket instead of stating its rule, state the rule forward by its own string (name the contract `faff-contract:spec-readiness` and describe its behaviour; do not cite the ticket that introduced it); where the sentence already stands alone, just delete the pointer. A gesturing ref whose rule **cannot** be recovered from the prose is not a delete-and-move-on — it is a self-containment bug the dev-env tracker access was masking, and it must be surfaced for a human to state forward, never silently dropped.
- **Sweep and enforce land together — non-negotiable at this scale.** Because the count regrows continuously (the methodology adds `FAFF-NN` refs to SKILL.md by design), a sweep that lands without enforcement regrows before the flip can follow. The sweep to zero **and** the `lint-refs` skills-surface enforcement flip must land in the **same PR**, so the count can never regrow. (This was the original build order; the ~5× growth makes it mandatory.)
- **Stay lean while rewording.** The sweep must keep each `SKILL.md` conformant to the authoring standard in `docs/skill-authoring.md` (lean, deduplicated, skimmable; state the rule forward; no changelog or transcript breadcrumbs in the prompt). Stating a gestured-at rule inline must not bloat the line past the `faff validate-adapters` line-cap / paragraph-length lint — reword tight, don't append a sentence.
- **The two surfaces are not symmetric in scan strategy.** `docs/guide/` is a directory walked recursively. The skills surface is the literal `*/SKILL.md` file under each immediate skill directory — *not* a recursive walk of `plugin/skills/`, which also contains ref-permitted non-instruction markdown. The enumeration must target the filename, not the tree.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/lint-refs.js` (`cmdLintRefs`, `REF_PATTERNS`, `markdownFilesUnder`, `LINT_REFS_SURFACES`, `lintRefsSelftest`) | Node CLI | The slice-1 check this slice extends with a second surface |
| `plugin/skills/*/SKILL.md` (20 carry refs) | Markdown prose | The surface being swept and then enforced |
| `test/lint-refs.test.mjs` | Node test | Slice-1 tests; gains a skills-surface enforcement case + over-scan negative |
| `.github/workflows/validate.yml` (step "Validate self-contained prose") | CI YAML | Already runs `lint-refs --selftest` then `lint-refs`; auto-enforces the new surface once green |
| `docs/skill-authoring.md` | Markdown | The lean/deduplicated/skimmable standard every reword must honour; already states the ban as "swept ref-free, then enabled" — this ticket is the missing execution |

**Scope statement.** This sits at the boundary between faff's authoring standard (prose must be self-contained) and its CI gate (the standard is mechanically enforced); it makes the skills half of that gate real.

## 2. OUT OF SCOPE

- **The lint mechanism itself** — *Why:* the matcher, `REF_PATTERNS`, `markdownFilesUnder`, `--selftest` harness, and the CI step all shipped in slice 1. *Extension point:* this slice only adds a surface enumeration + tests; it changes no pattern.
- **`docs/guide/` relocation and the authoring-standard rewrite** — *Why:* owned by slice 1 and its follow-ups. *Extension point:* `LINT_REFS_SURFACES` / `docs/skill-authoring.md`.
- **`docs/` outside `docs/guide/`** — *Why:* ADRs, specs, and contributor guidance legitimately cite provenance; `docs/adr/**` in particular *requires* its supersession back-refs for `faff adr validate`. *Extension point:* if a future issue wants to enforce another doc surface, add it to `LINT_REFS_SURFACES`.
- **Refs inside the `bin/` CLI source and non-`SKILL.md` markdown under `plugin/skills/`** — *Why:* the CLI is not a `.md` file and is never scanned; `plugin/skills/faff/contracts/README.md` and `plugin/skills/faff/contracts/examples/spec-with-artifact.example.md` are contract/example docs, not runtime instruction prose, and legitimately cite refs. *Extension point:* none wanted — the enumeration is deliberately narrowed to `*/SKILL.md` to keep these exempt.
- **A grandfather-allowlist / ratchet approach** — considered at reprep (flip enforcement now with the ~620 refs baselined, sweep the allowlist down incrementally). *Rejected 2026-08-10:* the decision is to keep the original sweep-to-zero-and-enforce-together approach. *Extension point:* if the single-PR sweep proves unmanageably large mid-build, the fault line is per-skill-cluster commits behind the not-yet-enabled surface (see HOW), not a persistent allowlist.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| External-artifact ref | A token matching one of the three `REF_PATTERNS`: ticket (`\bFAFF-\d+\b`), adr-cite (`\bADR[-\s]?\d{3,4}\b`, case-insensitive, 3–4 digits), adr-ptr (`\bdocs/adr/\d{1,4}[-\w]*`). |
| Decorative ref | A ref whose surrounding sentence already states the rule; the ref adds only provenance. Removal: delete the ref (usually a trailing parenthetical). |
| Gesturing ref | A ref where the sentence points at a ticket/ADR *instead of* stating its rule. Removal: state the rule forward from the prose, then delete. If the rule can't be recovered from the prose, it is a masked self-containment gap — surface it, don't silently delete. |
| Masked gap | A gesturing ref whose rule only resolves via tracker access — invisible in the dev (MCP-enabled) environment, breaking for an adopter. The sweep's reason to exist. |
| Within-prose anchor | A pointer that resolves inside the prose itself and never matches the patterns: `gateway → Section`, sibling skill names (`faff/SKILL.md`), slot skill names (`faffter-dark-nlspec`). Must stay unflagged. |
| Skills surface | The set `{ plugin/skills/<dir>/SKILL.md : <dir> is an immediate child of plugin/skills and that file exists }` — the literal manifest file per skill, non-recursive. |

**The new enumeration (pseudocode).**

```
FUNCTION skillManifestFiles(root) -> List<path>:
  base = root + "/plugin/skills"
  IF base does not exist: RETURN []
  out = []
  FOR each entry in sorted(readdir(base)):           # sorted → deterministic
    candidate = base + "/" + entry + "/SKILL.md"
    IF lstat(candidate) is a regular file:           # immediate child only; no recursion
      out.append(candidate)
  RETURN out
```

This is a *separate* enumeration from the recursive `markdownFilesUnder(dir)` used for `LINT_REFS_SURFACES`. It targets the `*/SKILL.md` filename directly so it never descends into `contracts/` or `examples/`.

**Design decision — how to add the skills surface.**

| Option | Effect |
|---|---|
| Append `"plugin/skills"` to `LINT_REFS_SURFACES` | `markdownFilesUnder` walks it recursively → over-scans `contracts/README.md` + `spec-with-artifact.example.md`, which legitimately cite refs → false failures |
| Separate `skillManifestFiles(root)` enumeration, scanned alongside the recursive surfaces | Targets the literal `*/SKILL.md` glob; non-`SKILL.md` markdown stays exempt by construction |

**Chosen:** a separate `skillManifestFiles(root)` enumeration, accumulated into the same `violations` list as `LINT_REFS_SURFACES`. The naive append is rejected as an anti-pattern (it over-scans ref-permitted docs).

**Design decision — user-facing strings.** The slice-1 `PASS`/`FAIL` stdout line, the stderr summary, and the CI step label all hardcode the parenthetical `(docs/guide/)`. Once skills are enforced, a contributor whose `SKILL.md` failed would see a message naming only `docs/guide/`.

**Chosen:** generalise the three user-facing strings to name both surfaces, e.g. `enforced prose (docs/guide/ + plugin/skills/*/SKILL.md)`. The matcher, exit codes, and per-violation `FAIL file:line ✗ match` lines are unchanged — only the human-readable summary/label wording.

## 4. HOW — Behavior

**Two separable halves.** (a) the **mechanism extension** — small, mechanical, high-confidence: add `skillManifestFiles`, scan it in `cmdLintRefs`, generalise the strings, add tests. (b) the **sweep** — the bulk: ~620 per-ref delete-or-state-forward edits across 20 files. The mechanism can be written first, but it must **not be enabled** until the surface is clean — enabling the lint on a dirty tree breaks CI. Build order: sweep to zero (interleaving per-skill-cluster commits behind the not-yet-enabled surface), then flip enforcement on **in the same PR** once the tree is green. Never enable enforcement on a dirty tree mid-sweep (that is why this was split from slice 1), and never land the sweep without the flip (the count regrows).

**Mechanism extension (pseudocode).**

```
PROCEDURE cmdLintRefs(args):                          # extends the slice-1 body
  ... parse --root / --selftest as today ...
  violations = []
  FOR surface IN LINT_REFS_SURFACES:                  # unchanged: recursive dir walk
    FOR file IN markdownFilesUnder(root/surface):
      collect refsInLine across file → violations
  FOR file IN skillManifestFiles(root):               # NEW: skills surface
    collect refsInLine across file → violations
  IF violations: print each "FAIL file:line ✗ match"; stderr summary (both surfaces named); RETURN 1
  print "PASS no external-artifact refs in enforced prose (docs/guide/ + plugin/skills/*/SKILL.md)"; RETURN 0
```

**Per-ref sweep procedure.** Run once per ref; the dominant shape is a trailing decorative parenthetical (e.g. `… advisory (<ticket>)`, `… (<ticket>/<ticket>)`, `… hand-off contract … (<ADR>)`).

```
PROCEDURE sweep_ref(ref, sentence):
  # For an adopter the ref is inert (no tracker access). In THIS repo the dev
  # model CAN follow it, so a gesturing ref may be masking a self-containment gap.
  # The reword's job is to make the sentence stand alone for BOTH readers.
  1. Read the sentence WITHOUT the ref.
  2. IF the sentence already states its rule (decorative):
       a. Delete the ref (and its now-empty parentheses / dangling punctuation).
       b. Re-read: the sentence must still be grammatical and lean.
  3. ELSE (the sentence gestures at the ticket/ADR instead of stating the rule):
       a. IF the rule is recoverable from the prose/context: state it forward, by
          its own string — name the contract / behaviour / label directly, not the
          ticket that introduced it. Then delete the ref.
       b. ELSE (rule not recoverable from prose): this is a MASKED GAP the dev-env
          tracker access was hiding — do NOT silently delete. Flag it for a human
          to state the rule forward (it would break for an adopter as-is).
       c. Check the result against docs/skill-authoring.md line-cap / paragraph
          lint — reword tight; do NOT append an extra sentence.
  4. Leave within-prose anchors untouched (they never matched).
```

**Scale note.** At ~620 refs the sweep is the bulk of the work. Commit **per-skill-cluster** (e.g. the three orchestration hubs — gateway / beep-boop / graft — separately from the slot skills) on the feature branch, each commit driving its files' count down, all behind the still-disabled surface; flip enforcement in the final commit of the same PR once the whole tree is green. This keeps each commit reviewable, the **edit-hygiene** risk (a mangled surrounding sentence in a large diff) auditable, and any **masked gap** visible to the reviewer in a small batch rather than buried in a 620-edit diff.

**Behaviour summary — anti-example edge case.** Some refs appear *inside a quoted bad-example* of writing to avoid (e.g. `faffidavit-rendering/SKILL.md` teaches "don't lean on numbered references" and quotes a zero-padded ADR id as the bad form). The matcher flags the literal token regardless of its rhetorical role, so the teaching point must survive without the matching string. Reword the example to a non-matching placeholder form — `"ADR-N"` (letter, not 3–4 digits) does not match `\bADR[-\s]?\d{3,4}\b` — keeping the lesson while clearing the lint.

**Edge cases.**

- **Compound parentheticals** (`(<ticket>/<ticket>)`): one parenthetical, two refs — delete the whole parenthetical, not just one number.
- **Ref mid-clause, not trailing** (`the <ticket> hand-off contract`): the contract is already specified inline by its signature, so the ticket is decorative — drop the ticket tag, keep "the hand-off contract".
- **A sentence that only gestures** (`per <ticket>` with no rule stated): state the rule forward if recoverable from prose; if not, it is a masked gap — surface it for a human, do not invent or silently delete.
- **Non-`SKILL.md` markdown under `plugin/skills/`:** must remain unscanned — the enumeration targets `*/SKILL.md` only.

**Failure modes.**

- **The failure:** a gesturing ref whose rule the dev-env model was silently backfilling from the tracker is *deleted* rather than stated forward — the matcher goes green, the dev-env run still passes (the model re-fetches context another way or the gap is latent), and the adopter hits an underspecified instruction. *How you'd know:* during the sweep a sentence reduces to "do X per <nothing>" with no recoverable rule; or a reviewer spot-check finds a reworded sentence thinner than an adopter needs. *What it means:* this is the masked-gap case — the sweep's whole point is to expose it, so surface it for a human to state forward; never delete-to-green. The per-cluster commits keep these visible.
- **The failure:** an edit damages the *surrounding* sentence — a deleted parenthetical takes a needed clause with it. *How you'd know:* diff review of the cluster commit shows a sentence that no longer parses or lost an inline rule. *What it means:* ordinary edit hygiene over a large diff; the per-skill-cluster commits keep each batch diff-reviewable.
- **The failure:** the enumeration over- or under-scans — recursing into `contracts/` (false failures on ref-permitted docs) or missing a `SKILL.md`. *How you'd know:* the over-scan negative test flags a `contracts/README.md` ref; the real-repo-tree test stays red after the sweep, or goes green while a known ref survives. *What it means:* fix the glob to immediate-child `*/SKILL.md`; this half is mechanical and the tests pin it.

**Anti-pattern:** appending `"plugin/skills"` to `LINT_REFS_SURFACES`. Why: `markdownFilesUnder` recurses and catches `contracts/README.md` + the `.example.md`, which legitimately cite refs.

**Anti-pattern:** "fixing" a ref by replacing a ticket tag with prose like "the ticket that added the lint check." Why: that is still a changelog breadcrumb, just delexicalised — state the *rule* forward (what the check does), not its origin story.

**Anti-pattern:** deleting a gesturing ref to clear the lint when its rule isn't in the prose. Why: that hides the masked gap the sweep exists to expose — the adopter still can't act on the sentence. Surface it instead.

**Anti-pattern:** landing the sweep in one PR and the enforcement flip in a follow-up. Why: the surface regrows between the two, so the follow-up would re-fail on refs added meanwhile. Same PR, always.

## 5. SCENARIOS

```
Given a plugin/skills/<skill>/SKILL.md containing "see <ticket> for rationale"
When `faff lint-refs` runs
Then it exits 1 and prints `FAIL  plugin/skills/<skill>/SKILL.md:<line> ✗ <ticket>`
```

```
Given plugin/skills/<skill>/contracts/README.md (non-SKILL.md) containing a ticket ref
When `faff lint-refs` runs over a clean skills surface
Then that ref is NOT flagged (the enumeration globs */SKILL.md, it does not recurse)
```

```
Given the swept repo tree (all SKILL.md refs removed)
When `faff lint-refs` runs with no --root (real repo)
Then it exits 0 with the PASS line — this is the end-to-end guard for the whole sweep
```

```
Given the --selftest matcher line "the faffter-dark-nlspec slot still cites <ticket>"
When `faff lint-refs --selftest` runs
Then exactly 1 ref is counted (the ticket), the slot-skill anchor is not — proving skills-style prose distinguishes anchor from ref
```

Non-functional assertions:

- After the sweep, zero refs across all `plugin/skills/*/SKILL.md` (matcher-confirmed).
- No reworded line exceeds the `faff validate-adapters` line-cap / paragraph-length lint.
- `faff validate-adapters` and `faff adr validate` still pass (the sweep touches no ADR file and no slot contract structure).

## 6. DESIGN DECISION RATIONALE

**How to add the skills surface to the check?**
- *Append `"plugin/skills"` to `LINT_REFS_SURFACES`* — one-line change, but recurses via `markdownFilesUnder` and over-scans `contracts/README.md` + `spec-with-artifact.example.md` (ref-permitted) → false CI failures.
- *Separate `skillManifestFiles(root)` enumeration* — a few lines, targets the literal `*/SKILL.md` per immediate skill dir, non-recursive, accumulated into the same `violations` list.

**Chosen:** the separate enumeration — it matches the issue's explicit constraint that the skills surface is its own `*/SKILL.md` glob, not a tree walk, keeping non-instruction markdown exempt by construction.

**Sweep-to-zero-and-enforce-together vs a grandfather ratchet?** (raised at reprep, given the ~5× growth)
- *Ratchet* — flip enforcement now with the ~620 refs baselined, block new refs immediately, sweep the allowlist down incrementally. Stops regrowth today, but leaves a persistent allowlist and a partially-dirty surface for an unbounded window.
- *Sweep-to-zero + enforce in the same PR* — the whole surface is clean the moment enforcement lands; no allowlist to maintain.

**Chosen:** sweep-to-zero and enforce together in one PR (the original approach, retained). The single-PR sweep is large but bounded, kept reviewable by per-skill-cluster commits; behaviourally null for adopters, a fidelity correction in dev.

**Delete vs state-forward per ref?**
- *Blanket delete* — fast, and null for adopters, but silently hides any masked gap in dev (a sentence that only worked via tracker-backfill), which then breaks for adopters.
- *Blanket state-forward* — bloats prose with restated provenance that was genuinely decorative.

**Chosen:** per-ref triage (the `sweep_ref` procedure) — delete decorative refs; state a gesturing ref's rule forward where recoverable; surface it as a masked gap where not. This is what makes the sweep restore dev/adopter fidelity rather than just clear the matcher.

**Generalise the user-facing strings, or leave `(docs/guide/)`?**
- *Leave* — zero churn, but misnames the surface to a contributor whose `SKILL.md` failed.
- *Generalise* — name both surfaces in the PASS/FAIL summary and CI step label.

**Chosen:** generalise — the matcher and per-violation output are unchanged; only the human-readable summary needs to reflect that two surfaces are now enforced.

**Anti-example refs (quoted bad-form ADR ids) — how to keep the lesson?**

**Chosen:** reword to a non-matching placeholder (`"ADR-N"`, letter not 3–4 digits) — preserves the teaching point that numbered references are bad writing, without leaving a token the matcher flags.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. The approach is fully determined; the sweep is null for adopters and a fidelity correction in dev, and any ref whose rule isn't prose-recoverable is a surfaced self-containment gap (an expected, valuable output), not an unresolved decision.

**Assumptions.**

- **Assumes:** a `FAFF-NN` ref is inert for an adopter (their runtime has no tracker access) and live in this self-hosting repo (the dev model has the Linear MCP). *Validation:* this is the runtime reality of the two environments; it is what makes removal null for adopters and fidelity-restoring in dev, and what makes a non-recoverable gesturing ref a masked gap to surface rather than delete.
- **Assumes:** most gesturing refs' rules are recoverable from the surrounding prose; the residue that isn't is small and worth surfacing. *Validation:* during the sweep, when a ref's rule can't be stated forward from the prose alone, flag it for human input — do not delete-to-green. A cluster with many such refs is itself a signal that skill's prose leans on the tracker more than the standard allows.
- **Assumes:** the live ref count and file distribution have grown since this snapshot (they grow with each merged SKILL.md change). *Validation:* re-measure with the matcher (or `faff lint-refs` after wiring the surface) at sweep start and again after — start should report the full live set, after should report zero, and the same-PR enforcement flip is what holds it at zero against concurrent growth.

## 8. DONE — Definition of Done

### From WHY
- [ ] Zero ticket-tag / `ADR NNNN` / numbered `docs/adr/*` refs remain in any `plugin/skills/*/SKILL.md` (matcher-confirmed against the live count at sweep time, not this snapshot).
- [ ] Every removed ref was either deleted (decorative) or had its rule stated forward (gesturing, recoverable). No surrounding sentence was damaged.
- [ ] Any gesturing ref whose rule was **not** recoverable from the prose is surfaced as a masked self-containment gap (flagged for a human to state forward), never silently deleted.
- [ ] The sweep **and** the enforcement flip land in the **same PR** (the count cannot regrow between them).

### From WHAT (enumeration)
- [ ] A `skillManifestFiles(root)` enumeration returns `plugin/skills/<dir>/SKILL.md` for each immediate child dir that has one, sorted, non-recursive.
- [ ] `cmdLintRefs` scans that enumeration alongside `LINT_REFS_SURFACES`, accumulating into one `violations` list.
- [ ] `plugin/skills/faff/contracts/README.md` and `…/examples/spec-with-artifact.example.md` are NOT scanned (their refs do not fail CI).

### From WHAT (user-facing strings)
- [ ] The `PASS`/`FAIL` summary, stderr line, and CI step label name both enforced surfaces (`docs/guide/` + `plugin/skills/*/SKILL.md`); per-violation `FAIL file:line ✗ match` format is unchanged.

### From HOW (behaviour)
- [ ] A reintroduced ref in any `SKILL.md` fails `faff lint-refs` (exit 1) naming the file and line.
- [ ] Within-prose anchors (`gateway → Section`, `faff/SKILL.md`, `faffter-dark-nlspec`) still pass unflagged.
- [ ] Anti-example refs are reworded to a non-matching placeholder, keeping the teaching point.

### From HOW (lint conformance)
- [ ] No reworded line exceeds the `faff validate-adapters` line-cap / paragraph lint; `faff validate-adapters` passes.
- [ ] `faff adr validate` still passes (no ADR file touched).

### From SCENARIOS (tests)
- [ ] `test/lint-refs.test.mjs` gains a skills-surface enforcement case (a `*/SKILL.md` ref → FAIL naming file:line).
- [ ] It gains an over-scan negative (a ref in a non-`SKILL.md` file under `plugin/skills/` is NOT flagged).
- [ ] `lint-refs --selftest` gains a skills-surface matcher case (slot-skill anchor unflagged + embedded ticket flagged on one line).
- [ ] The existing "real repo tree passes" test stays green on the swept tree.

### Integration smoke test
```
1. Run `node plugin/skills/faff/bin/faff lint-refs --selftest`  → exit 0, "ok"
2. Run `node plugin/skills/faff/bin/faff lint-refs`             → exit 0, PASS naming both surfaces
3. Reintroduce one ticket tag into any plugin/skills/*/SKILL.md
4. Run `faff lint-refs`                                         → exit 1, FAIL file:line ✗ <ticket>
5. Revert; run `faff validate-adapters` and `faff adr validate` → both pass
```

## Methodology critique
*(agile-delivery lens — issue-critique, refreshed 2026-08-10)*

- **Right-sized?** **Over the line on volume, and knowingly held there.** The mechanism extension is a clean sub-1-day unit. The sweep is ~620 refs across 20 files (~5× the original estimate) — large, but per-ref the work is delete-or-state-forward, so the size is a review-throughput concern, not a complexity one. It is kept as one ticket because the sweep and the enforcement flip **always ship together** (enabling the lint on a dirty tree, or sweeping without enabling, both fail). The mitigation is *intra-ticket*: per-skill-cluster commits (orchestration hubs vs slot skills) behind the not-yet-enabled surface, not a split of enforcement from sweep.
- **Workstream fit?** Clean — outcome-named project ("Skill prompts are lean, deduplicated and skimmable"); directly completes the self-contained-prose guard begun in slice 1, and advances the FAFF-487 static-context diet.
- **Deps surfaced?** Yes — `blockedBy` slice 1, now Done; the dependency is real (reuses its matcher + `--selftest` shape) and discharged. No hidden deps.
- **Risk profile?** Low. The mechanism half is mechanical and test-pinned. The sweep half is **null for adopters** (their refs are inert) and a **fidelity correction in dev** (it stops tracker access masking self-containment gaps). The residuals are edit hygiene over a large diff and honest surfacing of masked gaps — both handled by per-cluster diff review. No novel integration, no external dependency.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```