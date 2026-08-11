# Spec: Make the prompt-lint prose tier's gates real (FAFF-584)

> Spec: faffter-dark-nlspec · 2026-08-05 · autonomous · confidence: medium. Full spec on Linear FAFF-584.

This is a buildable spec for FAFF-584. Audience: the build agent that will implement it, and the human reviewers gating the spec. It turns three self-neutralized lint gates in `faff validate-adapters` into gates that actually bound the prose they were written to bound. It is scoped to make the *existing* lint real; the structural gateway split it enables belongs to FAFF-607.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff's correctness model is *prose ↔ mechanism agreement*: the shipped skill prompts are the product, and `faff validate-adapters` is the CI lint that keeps those prompts honest (line budgets, no walls of prose, no ambiguous cross-references). A lint that *defers to the prose it is meant to bound* provides false assurance — the gate shows green while the thing it guards drifts. Three gates in `validate-adapters.js` are in exactly that state.

**Problem statement.** The prose-tier lints exist but are toothless: the line caps only ever ratcheted *up* (hand-edited larger each time a file grew past them), the paragraph word-cap excludes the house's own bold-lead mega-bullet style (so a 463-word single bullet passes green), and the ~300-occurrence anchor web (`gateway → **Section**`) has zero mechanical validation (broken and ambiguous anchors ship). This change makes each gate bound its target: caps become tight downward ratchets with a single source of truth, the paragraph cap sees bold-lead bullets, and a heading-existence lint resolves anchor targets.

**Design principles.**

- **A gate must not break CI the moment it gains teeth.** The two capped files are AT their caps (`faff` 1129/1130, `faff-beep-boop` 701/705) and 15 bold-lead bullets already exceed 200 words. Every new/tightened rule must land green against the current tree — via a baseline that equals current reality, or by landing the new bullet/anchor rules as advisories — never by requiring a prose-rewrite of the tree inside this ticket.
- **Single-source the volatile number, not the stable one.** The doc-vs-code cap disagreement (doc says 1000, code says 1130) exists *because* a per-file number was restated in prose. Per-file baselines change every time a file is leaned; anything that restates them will drift again. The mechanism is stable; the numbers are not. State the mechanism in prose, keep the numbers in one place (code).
- **Advisory teeth beat absent teeth, and beat CI-breaking teeth.** Where a hard FAIL would red-CI the current tree (bold-bullet lengths, the unlinted anchor web), a `WARN`/advisory that makes the violation *visible* is a real improvement over today's *invisible*, and is landing-safe. The existing reporter already has non-failing verbs (`WARN`/`UNDECLARED`/`NEEDS-CASES`) for exactly this.
- **Surgical predicates over shared-predicate edits.** `isProseLine` feeds both the paragraph cap and the cross-file dedup detector. Widening it globally to catch bold bullets would silently change dedup windows. Prefer a dedicated predicate for the new use.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/validate-adapters.js` | Node.js (CommonJS) | The lint being changed. Constants block (lines 41–64), `isProseLine` (60–64), FAFF-120 charter block (721–776), module exports (860). Byte-identical dev SSOT; run in CI at `.github/workflows/validate.yml:23`. |
| `docs/skill-authoring.md` | Markdown | The charter this lint enforces. Line 22 (ceiling philosophy), line 26 table row (the stale `1000`). |
| `test/validate-adapters.test.mjs` (+ 4 sibling `validate-adapters*.test.mjs`) | Node test (`node:test`) | Fixture harness (`mkdtempSync` → write SKILL.md bodies → `spawnSync` → assert on stdout `(category)` + exit). Stale `1000` comment at lines 44–45. |
| `plugin/skills/faff/SKILL.md` | Markdown | The gateway. Duplicate `## Routing` at lines 55 and 1125. |
| `plugin/skills/faff/bin/lib/lint-refs.js` | Node.js | Sibling ref-lint that *deliberately exempts* within-prose anchors (selftest line 89) — it is NOT the anchor lint; this ticket adds anchor resolution to `validate-adapters`, not here. |

**Scope statement.** This sits in the prose-governance tier of `validate-adapters` (the FAFF-120 charter block); it hardens that tier's existing gates and does not touch the structural gateway split those gates will later police (FAFF-607).

## 2. OUT OF SCOPE

- **The gateway kernel/reference split and ≤200-line kernel** — the structural decomposition of `faff/SKILL.md` into a loaded kernel + referenced appendix. **Why excluded:** FAFF-607 (Todo) owns it; this ticket makes the lint that the split will be measured against real, first. **Extension point:** FAFF-607 executes the split on top of these hardened caps + the loading-preamble lint it adds.
- **The economics-driven prompt trim** — reducing prompt size for cost. **Why excluded:** FAFF-487 owns the broad lean; this ticket changes gates, not prose volume. **Extension point:** FAFF-487 leans files under the ratchet baselines this ticket sets.
- **Rewriting the ~200 anchor references / splitting the 15 over-cap bullets** — the prose fixes the new advisories will surface. **Why excluded:** the ticket makes the gates *visible*; fixing the flagged prose is downstream leaning work (FAFF-487 / FAFF-607). **Extension point:** the WARN output names each file:line for a later prose pass. (The one prose fix IN scope is the single duplicate-`## Routing` rename — it is the ambiguous anchor the lint would otherwise flag in the gateway itself.)
- **Extracting the skill-lint to a standalone tool** — FAFF-602. **Why excluded:** FAFF-602 is blocked *by* this ticket; the checks must be real before they move. **Extension point:** FAFF-602 lifts the hardened checks out of `validate-adapters.js`.
- **Validating the *nesting* claim of `A → B` anchors** (that B is nested under A). **Why excluded:** the tree's `## Shared Rules` sub-sections are flat `###` siblings, so the nesting is genuinely false in ~4 refs; asserting real nesting requires the FAFF-607 heading-hierarchy restructure. **Extension point:** FAFF-607, once the hierarchy is intentional. This lint resolves *B exists as a heading*, not *B nests under A*.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Downward ratchet | A per-file line ceiling set to the file's exact committed size (zero headroom). Any growth fails CI; the ceiling moves only *down*, when the file is leaned. |
| Baseline | The committed line count a capped file may not exceed. Replaces the loosely-set "override cap". |
| Bold-lead bullet | A list item whose content opens with bold: `- **Foo.** …` / `* **Foo.** …`. The house mega-bullet style. |
| Anchor / within-prose anchor | A cross-reference of the form `→ **Section name**` (optionally nested `→ **A → B**`) pointing at a heading elsewhere in the corpus. |
| Anchor leaf | The last ` → `-delimited segment of an anchor target — the heading it must resolve to. |
| Ambiguous anchor | A heading text that appears more than once as a `##`/`###` heading within one file, so an anchor to it has two targets. |

**Constants (replacing the current block, `validate-adapters.js:41–51`).**

```
CONST SKILL_LINE_CAP = 600                     # shared default ceiling (unchanged; a generous ceiling)
CONST SKILL_LINE_BASELINE = {                  # downward ratchets: EXACT committed size, zero headroom.
  faff: <committed line count of faff/SKILL.md AFTER the ## Routing dedupe>,   # scoped to the two hub files only (human decision 2026-08-10)
  "faff-beep-boop": <committed line count of faff-beep-boop/SKILL.md>,
}
  # INVARIANT: each value == the current `wc -l` of that SKILL.md. Lower only when the file is leaned;
  # NEVER raise to fit growth. Growth fails CI (lines > baseline). (renamed from SKILL_LINE_CAP_OVERRIDE)
  # SCOPE (human decision 2026-08-10): the ratchet is scoped to these two hub files only — the ~28 other
  # skills stay on the generic SKILL_LINE_CAP default. Extending to all files + a git-history
  # monotonic-nonincreasing check is deferred to a follow-up (deliberately out of scope this ticket).
CONST PARA_WORD_CAP = 200                       # unchanged
```

**Predicates.**

```
FUNCTION isProseLine(line)          # UNCHANGED — still feeds the dedup detector
  ... existing body ...

FUNCTION isParagraphLine(line)      # NEW — the paragraph cap's line selector
  s = line.trim()
  IF s == "" RETURN false
  IF /^[-*]\s+\*\*/.test(s) RETURN true    # bold-lead bullet (the house mega-bullet)
  RETURN isProseLine(line)                 # else the existing prose-line rule
```

**Anchor regex.**

```
CONST ANCHOR_REF = /→\s*\*\*([^*]+)\*\*/g    # captures the bold target text of one anchor
CONST HEADING_LINE = /^(#{2,6})\s+(.+?)\s*$/  # ## / ### … heading, capturing depth + text
```

**Design decision — ratchet mechanism.** Options: (A) committed baseline held in a code constant, enforced `lines <= baseline`; (B) a config-driven cap read once from a data file (`.faffrc` or a JSON). **Chosen:** A — baseline in the code constant (the retasked `SKILL_LINE_BASELINE` map). Rationale: `.faffrc` is *user* config, and `validate-adapters` deliberately never couples dev thresholds to it (today's caps are code constants); a separate JSON adds a file + read path with no gain over the constant already present; the constant keeps the linter byte-identical across the dev source and its install copies and unit-testable via the existing `module.exports`.

**Design decision — single-sourcing the number.** A markdown doc cannot read a JS constant, so "single-source" cannot be a literal shared read. Options: (A) code is SSOT and the charter doc states only the *mechanism* + the stable base `600`, quoting no per-file number; (B) doc keeps quoting numbers and a test asserts doc==code. **Chosen:** A. Rationale: the disagreement exists precisely *because* a volatile per-file number was restated in prose; removing the number from the doc removes the drift vector permanently, where option B only guards a restatement that shouldn't exist.

**Design decision — bold-bullet paragraph cap severity.** The current tree has 15 bold-lead bullets over 200 words (up to 463). Options: (A) hard FAIL — red-CIs 15 bullets on landing, forcing prose splits this ticket doesn't own; (B) count-based ratchet (FAIL only when a file gains a *new* over-cap bullet) — needs a per-file baseline count, heavier, and a "count of over-cap bullets" is an odd construct; (C) WARN — advisory, does not set `failed`. **Chosen:** C. Rationale: today these bullets are *entirely exempt* (invisible); a WARN makes every one visible at `file:line` (the ticket's core complaint) while landing green; the plain-prose cap stays a hard FAIL (no plain-prose line exceeds 200 today, so it stays green with teeth). A follow-up (or incremental leaning under FAFF-487) can ratchet WARN→FAIL once the tree is under cap. Rejected A (breaks CI) and B (over-engineered for this ticket; the line-cap ratchet already establishes the pattern if wanted later).

**Design decision — paragraph predicate.** Options: (A) widen `isProseLine` per the ticket's literal wording; (B) add a dedicated `isParagraphLine`, leave `isProseLine` untouched. **Chosen:** B. Rationale: `isProseLine` also gates the dedup `sigLines` collection (line 748/755); widening it would pull bold-lead bullets — which are frequently shared/referenced prose — into dedup windows and could raise new `duplicated block` FAILs unrelated to this ticket. A dedicated predicate is surgical.

**Design decision — anchor lint severity.** Options: (A) hard FAIL; (B) WARN. **Chosen:** B. Rationale: ~303 `→ **Bold**` occurrences (96 distinct targets) have never been linted; a hard gate on first pass would red-CI the tree, and the resolution heuristic has genuine false-positive surface (slot-suffix refs). WARN surfaces breakage using the existing advisory-verb pattern (`WARN` does not set `failed`) and is landing-safe. The ticket itself specifies "warn on non-heading targets."

**Design decision — anchor resolution rule.** **Chosen:** pool every `##`/`###` heading across *all* SKILL.md files into one normalized set; an anchor resolves if its normalized *leaf* (last ` → ` segment) equals a pooled heading OR is a whole-word prefix of one; else WARN. Rationale: refs routinely use a short form of a longer heading (`Next-step transition` → `Next-step transition — consult \`faff next\``), so prefix-at-word-boundary is required to avoid mass false positives; pooling all skills' headings matches the ticket's own model ("A → B where B is a real heading elsewhere resolves") and covers cross-skill refs. **Punt:** anchor targets whose leaf is a slot/identifier suffix (`→ **Rendering → \`rendering_adaptor\`**`) will WARN even though the section exists — accepted as advisory noise this ticket does not silence *(decides: any — recommended default: accept the noise, no special-casing this ticket)*; a follow-up may special-case backticked slot tokens.

## 4. HOW — Behavior

**Architecture.** All three changes live in one place: the FAFF-120 charter block, `cmdValidateAdapters` lines 721–776, which already runs a single per-file loop over `allSkills` (line cap + paragraph + stray markers) and a collect-then-report pass for dedup. The anchor lint uses the same collect-then-report shape: collect headings per file *in the same pass*, resolve anchor refs *after* the loop — structurally identical to `dupWindows`.

**Behaviour summary — line cap becomes a downward ratchet.** For each file, the ceiling is its baseline (`SKILL_LINE_BASELINE[name]`) if present, else `SKILL_LINE_CAP`. Growth over the ceiling FAILs. Additionally, when a baselined file has *shrunk below* its baseline, emit a non-failing advisory nudging the author to lower the baseline — this is what makes the ratchet actually move down as prose is leaned, without needing git history.

```
PROCEDURE line_cap_check(name, lines):
  cap = SKILL_LINE_BASELINE[name] ?? SKILL_LINE_CAP
  IF lines.length > cap:
     FAIL "(line cap)" — "SKILL.md is <n> lines (cap <cap>) — split or lean it"   # sets failed
  ELSE IF name IN SKILL_LINE_BASELINE AND lines.length < cap:
     print "RATCHET  <name> — now <n> lines, below baseline <cap>; lower the baseline to lock the reduction (FAFF-120)"   # advisory, does NOT set failed
```

**Behaviour summary — paragraph cap sees bold-lead bullets.** In the per-line loop, select lines with `isParagraphLine` (not `isProseLine`). A line over `PARA_WORD_CAP` FAILs if it is plain prose, or WARNs if it is a bold-lead bullet.

```
PROCEDURE paragraph_check(name, i, line):
  IF NOT isParagraphLine(line): RETURN
  words = line.trim().split(/\s+/).length
  IF words <= PARA_WORD_CAP: RETURN
  IF isBoldLeadBullet(line):
     print "WARN  <name> (paragraph) — line <i+1>: <words>-word bold-lead bullet (cap 200) — break it into sub-bullets"   # advisory
  ELSE:
     FAIL "(paragraph)" — "line <i+1>: <words>-word paragraph (cap 200) — break it into bullets"   # sets failed (unchanged behaviour for plain prose)
```

**Anti-pattern:** counting words on the *joined* multi-line paragraph. Why: the current check is per-physical-line and this ticket keeps it that way; a bold bullet spanning wrapped lines is a separate evasion (see Failure modes / Punt). Do not attempt paragraph-joining here.

**Behaviour summary — anchor heading-existence lint.** During the FAFF-120 per-file loop, collect this file's headings into a global `headings` set (normalized) and detect within-file duplicate headings (ambiguous anchors). After the loop, walk every file's lines for `ANCHOR_REF` matches and resolve each leaf against the pooled set.

```
PROCEDURE collect_headings(name, lines, headings, seenPerFile):
  FOR each line:
     m = HEADING_LINE.match(line)
     IF m:
        norm = normalizeHeading(m.text)
        headings.add(norm)
        IF norm IN seenPerFile[name]:
           print "WARN  <name> (ambiguous anchor) — heading \"<text>\" appears more than once; an anchor to it is ambiguous — rename one (FAFF-120)"   # advisory
        seenPerFile[name].add(norm)

FUNCTION normalizeHeading(s):
  s = strip surrounding whitespace
  s = remove backticks and markdown emphasis markers (*, _)
  s = lowercase, collapse internal whitespace to single spaces
  RETURN s

PROCEDURE resolve_anchors(name, lines, headings):   # after the per-file loop
  FOR each line (skip lines containing ".example"):
     FOR each match of ANCHOR_REF in line → target:
        segments = target.split(" → ")
        leaf = normalizeHeading(last(segments))
        IF resolves(leaf, headings): CONTINUE
        print "WARN  <name> (anchor) — line <i+1>: \"<target>\" resolves to no heading (leaf \"<leaf>\") — fix the ref or the heading (FAFF-120)"   # advisory

FUNCTION resolves(leaf, headings):
  IF headings.has(leaf): RETURN true
  FOR each h in headings:
     IF h == leaf OR h startsWith (leaf + " "): RETURN true   # whole-word prefix
  RETURN false
```

**Behaviour summary — dedupe the duplicate `## Routing`.** `faff/SKILL.md` has two `## Routing` headings: line 55 (the trigger table) and line ~1125-1149 (fallback/dispatch prose near the file end, exact line drifts as the gateway grows). No ref points at `→ **Routing**`, so the rename is data-safe. Rename the *second* to a distinct heading. **Chosen:** `## Routing fallbacks` — the section is the "no context → run wtf / intent → sub-skill" fallback dispatch, distinct from the top trigger table. This removes the ambiguous-anchor WARN the new lint would raise against the gateway itself.

**Edge cases.**
- A fixture skills dir with no `faff/SKILL.md` (the sibling suites spawn against gateway-less tmpdirs): heading pool is simply whatever the fixtures define; anchor resolution runs against that pool. No special-casing needed (unlike the voice-pointer lint, this lint has no gateway dependency).
- `.example` lines are skipped for anchor resolution (mirrors every other per-line lint in this block).
- An anchor whose target has no ` → ` (the common `gateway → **Section**` case): `segments` has one element, leaf is the whole target — resolves normally.
- Baseline entry for a file not present on disk: the loop only iterates files that exist, so a stale baseline key is inert (optionally: emit nothing). No crash.

**Failure modes.**

- **The failure:** the downward ratchet has no mechanical guard against a contributor *raising* a baseline to fit growth (the stateless linter can't see git history). **How you'd know:** a diff bumps `SKILL_LINE_BASELINE.faff` upward with no corresponding lean. **What it means:** proceed — the achievable teeth are (a) zero headroom, so *any* growth fails and forces the author to either lean or make a conspicuous, reviewable baseline-raise, and (b) the RATCHET advisory that nudges baselines *down* when files shrink. A git-history assertion (baseline monotonic-nonincreasing across commits) is a Punt (below); the honest limit is documented in-code and in the charter.
- **The failure:** the anchor prefix-matcher is too lenient (a leaf that is a prefix of an unrelated heading resolves spuriously) or too strict (slot-suffix refs WARN despite a real section). **How you'd know:** landing produces either near-zero WARNs (too lenient) or a flood dominated by `→ **X → \`slot\`**` (too strict). **What it means:** narrow — the WARN severity means neither breaks CI; tune `resolves()` in a follow-up. A null result (no genuine broken anchors surfaced) is a valid outcome to name, not a gap.
- **The failure:** widening the paragraph selector perturbs something other than the paragraph cap. **How you'd know:** the dedup (`duplicated block`) or stray-marker output changes on the real tree. **What it means:** it shouldn't — `isProseLine` and the `sigLines` collection are untouched; if it does, the new predicate leaked into the wrong loop. The real-tree run is the check.

## 5. Scenarios — born-verifiable main objectives

```
Given faff/SKILL.md's committed size equals its SKILL_LINE_BASELINE entry
When one line is added to it and validate-adapters runs
Then it FAILs with "(line cap)" and a non-zero exit
```

```
Given a baselined fixture file committed at N lines with baseline N
When it is shrunk to N-5 and validate-adapters runs
Then a non-failing "RATCHET" advisory names it and the exit stays 0 (if nothing else fails)
```

```
Given a SKILL.md containing a single bold-lead bullet ("- **Foo.** " + 260 words)
When validate-adapters runs
Then it prints "WARN  <name> (paragraph)" for that line AND does not set a non-zero exit on that basis alone
```

```
Given a SKILL.md containing a single non-bullet prose line of 260 words
When validate-adapters runs
Then it FAILs with "(paragraph)" and a non-zero exit   # plain-prose cap keeps its teeth
```

```
Given a fixture corpus with a heading "## Automation eligibility" and a line "see gateway → **Automation eligibility**"
When validate-adapters runs
Then no "(anchor)" warning is emitted for that line
```

```
Given a fixture with heading "## Next-step transition — consult faff next" and a ref "gateway → **Next-step transition**"
When validate-adapters runs
Then no "(anchor)" warning is emitted   # whole-word prefix resolves
```

```
Given a fixture with heading "## Parking lot" and a ref "gateway → **Park**", and no heading equals "Park" nor begins with "Park " (word boundary)
When validate-adapters runs
Then a "WARN  <name> (anchor)" is emitted   # NEGATIVE lenience boundary: "Park" is a mid-word (non-word-boundary) prefix of "Parking lot" and must NOT resolve — a broken anchor must not ship green
```

```
Given a fixture with a ref "gateway → **Nonexistent Section**" and no such heading anywhere in the corpus
When validate-adapters runs
Then a "WARN  <name> (anchor)" names that line, and the exit is not forced non-zero by it
```

```
Given a single fixture SKILL.md containing two "## Routing" headings
When validate-adapters runs
Then a "WARN  <name> (ambiguous anchor)" is emitted for the duplicate
```

```
Given the real repository tree after all edits (including the ## Routing rename and baselines set to current sizes)
When validate-adapters runs in CI
Then it exits 0 (PASS) — no new FAIL is introduced by this change
```

## 6. Design Decision Rationale

**Where do the cap numbers live so doc and code cannot disagree?** Options: code SSOT with the doc stating mechanism only; or doc quoting numbers guarded by a test. **Chosen:** code SSOT; the charter doc drops per-file numbers and states the ratchet mechanism + base 600 — rationale in §3 (the restated volatile number *is* the drift vector).

**What mechanism realises the ratchet?** Baseline-in-code vs config-file vs JSON sidecar. **Chosen:** baseline-in-code (`SKILL_LINE_BASELINE`) — rationale in §3 (no user-config coupling, byte-identical, unit-testable, reuses the existing constant slot).

**How hard does the bold-bullet cap bite on landing?** Hard FAIL vs count-ratchet vs WARN. **Chosen:** WARN (plain prose stays FAIL) — rationale in §3 (15 pre-existing violations up to 463 words make FAIL a CI-breaker; WARN converts invisible→visible and is landing-safe). At the time of writing the tree has 15 such bullets; when that reaches zero the WARN can be ratcheted to FAIL.

**How are anchor targets resolved?** Pool-all-headings + leaf + whole-word-prefix, WARN on miss. **Chosen** — rationale in §3/§4. Nesting validation and slot-suffix precision are explicitly deferred (§2, §7).

**Which `## Routing` is renamed, and to what?** The second (fallback dispatch prose near end of file) → `## Routing fallbacks`. **Chosen** — the top table (line 55) is the canonical entry the whole gateway is built around; the bottom section is the smaller, later fallback prose and is the cheaper, safer move. No ref targets `→ **Routing**`, so no anchor breaks.

**Ratchet scope — two hub files vs all SKILL.md files.** *(Was decides: architecture — RESOLVED by human, interactive, 2026-08-10.)* **Chosen:** scope the downward ratchet to the two hub files (`faff`, `faff-beep-boop`) only — the files that actually flirt with their caps. The ~28 other skills stay on the generic `SKILL_LINE_CAP` default. Extending to all files, and adding a git-history monotonic-nonincreasing assertion, is deferred to a follow-up ticket — the stateless linter can't read past commits, so that check needs genuinely separate, heavier machinery. This is a settled decision, not an open Punt.

## 7. Open Questions and Assumptions

**Resolved (was Punt, now Decision — human, interactive, 2026-08-10):** the baseline ratchet is scoped to the two hub files (`faff`, `faff-beep-boop`) only; NOT extended to every SKILL.md; NO git-history monotonic check this slice. See §6.

**Remaining Open Questions (both non-blocking, `decides: any` — apply the recommended default, do not re-litigate):**

- **Punt (non-blocking, decides: any):** Should the bold-bullet paragraph cap be a hard FAIL rather than WARN once (or as part of) the 15 over-cap bullets are split? **Recommended default (per spec-reconciliation 2026-08-11): WARN confirmed correct** — 15 pre-existing over-cap bullets (up to 463 words) mean a hard FAIL would red-CI on landing. Apply WARN; do not upgrade to FAIL this ticket.
- **Punt (non-blocking, decides: any):** Should `resolves()` special-case backticked slot/identifier leaves so `→ **Section → \`slot\`**` refs don't WARN? **Recommended default: no special-casing this ticket** — deferred as advisory-noise tuning; WARN severity means no CI break either way.

**Assumptions.**

- **Assumes:** `faff/SKILL.md` and `faff-beep-boop/SKILL.md` line counts are whatever they are at build time (validate: `wc -l` both before setting baselines; the `faff` baseline is the *post-rename* count). Set baselines to the actual post-edit `wc -l`, not a hardcoded historical figure (the tree has grown since the spec was first written — 1129→1153+ for the gateway alone across prep refreshes).
- **Assumes:** no anchor reference targets `→ **Routing**` (validate: `grep -rn "→ \*\*Routing" plugin/skills/*/SKILL.md` returns nothing — confirmed at spec time). If one appears, repoint it to the renamed section.
- **Assumes:** the `validate-adapters` reporter's non-failing verbs (`WARN`/advisory prints that do not set `failed`) are the correct vehicle for the three advisories (RATCHET, bold-bullet paragraph, anchor, ambiguous anchor) — validate against the existing `WARN`/`UNDECLARED` sites in the same file.

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] `node plugin/skills/faff/bin/faff validate-adapters` exits 0 on the full real tree after all edits (no new FAIL introduced).

### From WHAT (constants and predicates)
- [ ] `SKILL_LINE_CAP_OVERRIDE` is renamed to `SKILL_LINE_BASELINE`; scoped to `faff` and `faff-beep-boop` only; its values equal the exact post-edit committed line counts; the export list and any importers are updated.
- [ ] `isParagraphLine` exists and returns true for bold-lead bullets (`- **…`, `* **…`) and for existing prose lines; `isProseLine` is unchanged.

### From HOW (line-cap ratchet)
- [ ] Adding one line to a baselined fixture file (committed at its baseline) produces `FAIL … (line cap)` and non-zero exit.
- [ ] A baselined fixture file committed below its baseline emits a non-failing `RATCHET` advisory and does not force a non-zero exit. *(fixture test)*

### From HOW (paragraph cap)
- [ ] A 260-word single bold-lead bullet produces `WARN … (paragraph)` and does not, by itself, force a non-zero exit. *(fixture test)*
- [ ] A 260-word non-bullet prose line produces `FAIL … (paragraph)` and non-zero exit (plain-prose cap keeps its teeth). *(fixture test)*

### From HOW (anchor lint)
- [ ] `gateway → **<exact heading>**` against a corpus containing that heading emits no `(anchor)` warning. *(fixture test)*
- [ ] `gateway → **<short form>**` where a heading begins with that form at a word boundary emits no `(anchor)` warning. *(fixture test)*
- [ ] **(prefix-lenience boundary — QA)** A ref whose leaf is a *mid-word* (non-word-boundary) prefix of a heading (e.g. `→ **Park**` vs a `## Parking lot` heading, with no exact/word-boundary match) STILL emits `WARN … (anchor)` — the `startsWith(leaf + " ")` rule must not over-resolve a spurious substring prefix, so a broken anchor cannot ship green. *(negative fixture test)*
- [ ] `gateway → **<no such heading>**` emits `WARN … (anchor)` naming the line, without forcing non-zero exit. *(fixture test)*
- [ ] Two identical `##`/`###` headings in one fixture file emit `WARN … (ambiguous anchor)`. *(fixture test)*

### From HOW (dedupe)
- [ ] The second `## Routing` in `plugin/skills/faff/SKILL.md` is renamed to a distinct heading (`## Routing fallbacks`); the top trigger table at line 55 is unchanged; running the anchor lint on the real gateway emits no ambiguous-anchor WARN for Routing.

### From HOW (stateless-ratchet limit — architectural)
- [ ] The zero-headroom ratchet's honest limit — a *stateless* linter cannot mechanically prevent a contributor hand-raising a `SKILL_LINE_BASELINE` value to fit growth — is documented at the constant (an in-code comment naming the limit) AND in `docs/skill-authoring.md`, stating that the reviewable baseline-raise diff is the real gate and the git-history monotonic-nonincreasing check is a deferred Punt.

### From doc / test hygiene
- [ ] `docs/skill-authoring.md` line 22 + line 26 table row no longer state `1000`; they state the downward-ratchet mechanism and the base `600`, quoting no per-file override number.
- [ ] The stale `1000` references in `test/validate-adapters.test.mjs` (comment + assertion message at ~lines 44–45) are updated to the ratchet/baseline value or reworded to the mechanism.

### Eval coverage
- [ ] No LLM-judgement seam is introduced or changed (all four additions are deterministic string lints), so no `judgement_seam:` / grader-KIND / eval-case registration is owed. *(Confirm: none of the changes add a graded seam.)*

### Integration smoke test
```
1. Set SKILL_LINE_BASELINE to the two hub files' post-edit committed sizes; rename the 2nd ## Routing.
2. Run: node plugin/skills/faff/bin/faff validate-adapters   → expect RESULT: PASS, exit 0.
3. Run: node --test test/validate-adapters*.test.mjs          → expect all green.
4. Append one line to faff/SKILL.md; re-run validate-adapters → expect FAIL (line cap), exit 1; revert.
```

confidence: high
spec-review: approve

## Decision (human, interactive, 2026-08-10) — ratchet scoped to the two hub files

**Human call:** keep the downward line-cap ratchet scoped to the two hub files (`faff`, `faff-beep-boop`) — the files that actually flirt with their caps. Do not extend it to every SKILL.md, and do not add the git-history monotonic-nonincreasing check this slice. The all-files ratchet + git-history check are deferred to a follow-up. Sequenced first via `FAFF-584 blocks FAFF-607`.

Remaining Punts stay non-blocking, both `decides: any`: bold-bullet cap FAIL-vs-WARN (WARN confirmed correct), and the `resolves()` backticked-slot-leaf special-case (advisory-noise tuning, no special-casing this ticket). Neither gates.

Result: confidence medium → high, build-eligible; spec-review approve retained.
