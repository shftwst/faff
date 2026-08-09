# FAFF-191 — Dispatch-site default-name removal + validate-adapters prose-supplied-default lint

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-191.

This spec covers the deferred half of FAFF-182: sweep the copyable default skill names out of every slot-dispatch site in the skill prose, and add a `faff validate-adapters` lint that keeps them out. Audience: the build agent and human reviewers.

## 1. WHY — Problem and Principles

**Load-bearing model.** Since FAFF-182, the CLI `DEFAULTS` registry (`plugin/skills/faff/bin/lib/config.js:15`) is the single source of slot defaults: `faff config get slots.<x>` always resolves, exit 0, even with no `.faffrc`. Any default skill name still written in dispatch prose is therefore (a) redundant and (b) a shortcut vector — a model can copy the literal instead of resolving the config, silently bypassing a configured override (the exact bug FAFF-182 exists to kill). Removing the copyable name makes the dispatch mechanically un-shortcuttable; the lint makes the removal stick.

**Problem statement.** Dispatch sites across faff-graft/jot/plot/prep still name their slot's bundled default inline, and one redundant `config get <registry-key> -d` has already drifted back in (faff-graft:107, landed three days after FAFF-182 shipped). This change sweeps them and adds two construction-keyed lint rules so CI fails any reintroduction.

**Design principles:**

- **Key on the construction, never the name.** A documentation mention of a default skill name (the gateway Slots table, config examples, narrative) is legitimate and must never flag. The lint anchors on the dispatch construction. This is the ticket's named false-positive risk; an implementation that flags doc mentions is rejected.
- **Precision-biased, documented residual.** Like the existing HANDREAD and DELEGATION_ANCHOR lints, prefer a conservative line-scoped rule with a stated residual over a clever recall-maximising one.
- **Derive, never duplicate.** The lint's registry-key set and bundled-default-name set come from `require("./config").DEFAULTS` at runtime — never a hardcoded copy that can drift from the registry.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` | JS (CommonJS) | `DEFAULTS` registry (exports it); `config defaults --selftest` expected list (~line 601) |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JS | `cmdValidateAdapters` sequential lint passes; already `require`s `./config` (no new import cycle) |
| `test/validate-adapters-delegation.test.mjs` | JS (node:test) | Template: mkdtemp fixture SKILL.md + spawnSync + real-tree regression guard |
| `test/config-defaults.test.mjs` | JS (node:test) | FAFF-182 default-aware `config get` tests; extend for `slots.prd` |
| `plugin/skills/*/SKILL.md` | prose | The sweep surface |
| `.github/workflows/validate.yml:22-23` | YAML | Runs `validate-adapters` unconditionally — couples lint + sweep into one PR |

**Scope statement.** This completes FAFF-182's dispatch-hardening arc: registry (shipped) → prose sweep + lint (this ticket).

## 2. OUT OF SCOPE

- **Migrating remaining `-d` keys into the registry** (`graft.push_at_build_complete`, `autonomous.require_container`, `autonomous.require_branch_protection`, `faffter_dark.adversarial.deadline`) — deliberate non-registry keys today; their `-d` uses are correct. Extension point: add the key to `DEFAULTS` + selftest, then rule (a) covers it automatically.
- **Multiline dispatch constructions** — a default name on the line *adjacent* to an anchor line escapes rule (b). Accepted residual (line-scoped, matching HANDREAD/DELEGATION precedent). Extension point: a window-scoped anchor in the same lint pass.
- **Narrative "defaults to X" prose** (e.g. faff-beep-boop:12, :430; the gateway Slots table and config examples) — documentation, not dispatch; stays. Extension point: none intended.
- **The FAFF-238 external-refs guard** — orthogonal prose lint; this sweep just avoids adding new `FAFF-NN` refs to SKILL.md prose (and incidentally removes one at faff-prep:65).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Registry key | A dotted config path with an entry in `DEFAULTS` (config.js) |
| Bundled slot default | A value of a `slots.*` entry in `DEFAULTS` (e.g. `faffter-noon-review`) — 13 names today, 14 after the `slots.prd` fix |
| Dispatch site | A SKILL.md instruction to invoke a slot occupant (Skill-tool delegation or producer-subagent dispatch) |
| Doc mention | Any other occurrence of a default name: tables, config examples, narrative, a skill's self-description |

**The two lint rules** (one new pass in `cmdValidateAdapters`, after the FAFF-172 delegation pass, over the existing `allSkills` loop; both skip lines containing `.example`, per the HANDREAD convention):

```
RULE A (redundant prose default):
  a line matching   config get <key> … -d …
  where <key> is a Registry key
  → FAIL  <skill> (prose default): redundant `-d` on registry key "<key>" —
    the registry owns the default; drop the -d (drift vector)

RULE B (default named at a dispatch site):
  a line matching the dispatch anchor  /via the Skill tool|producer subagent|producer dispatch/i
  containing a backticked token that exact-matches a Bundled slot default
  → FAIL  <skill> (prose default): dispatch site names bundled default "<name>" —
    route through `faff config get slots.<x>` and name no default
```

**Decision — rule (b)'s construction anchor.** **Chosen:** line-scoped regex `/via the Skill tool|producer subagent|producer dispatch/i` plus exact-match backticked bundled-default literal. Verified mechanically today: on the live tree this flags exactly 6 lines — faff-graft:330, faff-graft:414, faff-jot:52, faff-plot:37, faff-prep:107, faff-prep:231 — and zero doc mentions (gateway table/examples/narrative all lack the anchor; `faffter-noon-spec-review/SKILL.md` path tokens and `faffter-dark-authoring-adaptors` don't exact-match the name set).

**Decision — the `slots.prd` registry gap.** **Chosen:** fix in-scope, first. `slots.prd` is missing from `DEFAULTS` although the gateway Slots table documents `faffter-noon-prd` as its default and faff-beep-boop:108 relies on the prose parenthetical — `faff config get slots.prd` exits 3 empty today. One line in `DEFAULTS` + one entry in the `config defaults --selftest` expected list + test. Stripping beep-boop's parenthetical **before** this fix would break L4 PRD resolution, so the registry fix is ordered ahead of the sweep. (`slots.gates` and `slots.profile` stay absent — built-ins, not skills.)

**Decision — the adversarial-review direct-reuse carve-out.** **Chosen:** sweep-scope exclusion, no lint code exemption. `faffter-dark-adversarial-review/SKILL.md:10,27,29,47` name `faffter-noon-review` because Phase 1 *runs that skill's five-pass logic as its own* — routing through `config get slots.review` would be circular (it may itself be the occupant). Verified: none of those lines carries the rule (b) anchor, so no code exemption is needed; a negative test fixture ("delegated to `faffter-noon-review`" prose) pins the carve-out so a future anchor widening can't silently break it.

**Decision — parenthetical default names at otherwise-compliant sites.** **Chosen:** strip them at every dispatch site, compliant construction or not. Rationale: the shortcut mechanism is the copyable literal itself — a `(default \`faffter-noon-spec-review\`)` sitting next to a correct `config get slots.spec_review` is still copyable; and two of these sites (faff-prep:107, :231) sit on anchored lines, so the lint forces the strip anyway. Uniform rule, no adjacency heuristics. Doc mentions and self-descriptions are tolerated as before.

**Decision — key/name set derivation.** **Chosen:** `const { DEFAULTS } = require("./config")` inside validate-adapters (it already requires `./config`); registry keys = `Object.keys(DEFAULTS)`, bundled defaults = values of `slots.*` entries. The `slots.prd` fix then strengthens the lint automatically.

## 4. HOW — Behavior

### 4.1 Registry fix (first)

In `config.js` `DEFAULTS`, after the `slots.rendering_adaptor` entry: add `"slots.prd": "faffter-noon-prd",`. In the `config defaults --selftest` `expected` array (~line 601): add `"slots.prd"`. Extend `test/config-defaults.test.mjs` with an unset-`slots.prd`-resolves case.

### 4.2 Prose sweep

Line numbers are as of 2026-07-11 — locate by the quoted phrase, not the number. Every edit removes the backticked default name and, where the site lacks an explicit route, adds the `faff config get slots.<x>` route; the already-compliant exemplars to imitate are faff-prep:160 (architecture, zero literal) and beep-boop's `Invoke \`slots.env\` (\`faff config get slots.env\`)`.

Rule (a) fix:

| Site | Edit |
|---|---|
| faff-graft:107 | `config get automation_default -d opt-in` → `config get automation_default` (registry supplies `opt-in`) |

Anchored rule (b) sites (the lint will enforce these):

| Site | Slot | Edit |
|---|---|---|
| faff-graft:330 | review | Drop `; the default \`faffter-noon-review\` is a canonical name` → `(resolve \`faff config get slots.review\` per gateway → **Sibling-skill invocation**; a bundled default is a canonical name)` |
| faff-graft:414 | ship | `(configured occupant, or the default \`faffter-noon-ship\`; resolve per gateway → …)` → `(resolve \`faff config get slots.ship\` per gateway → **Sibling-skill invocation**)` |
| faff-jot:52 | intake | Drop `(default \`faffter-noon-intake\`; ` — keep the third-party override examples; `a bundled default like \`faffter-noon-intake\` is a canonical name` → `a bundled default is a canonical name` |
| faff-plot:37 | intake | Drop `(default \`faffter-noon-intake\`)` (site not in the ticket inventory — found at spec time; same intake dispatch as jot's) |
| faff-prep:107 | spec_review | Drop `(default \`faffter-noon-spec-review\`)` — the `config get slots.spec_review` route is already present |
| faff-prep:231 | spec | Drop `(default \`faffter-noon-spec\`)` |

Soft sites (below the lint's anchor — swept for the same reason, residual documented):

| Site | Slot | Edit |
|---|---|---|
| faff-graft:211 | adr | Drop `default \`faffter-noon-adr\`; ` — `config get slots.adr` route already present |
| faff-graft:521 | ship | `(configured occupant or the default \`faffter-noon-ship\`)` → `(resolve \`faff config get slots.ship\`)` |
| faff-jot:56 | intake | Obsolete fallback — rewrite: `A missing \`intake\` override is never a blocker: \`faff config get slots.intake\` always resolves (the registry supplies the default); run the resolved skill inline.` |
| faff-jot:60 | methodology | Drop `(default \`faffter-noon-methodology-thematic\`; see that skill)` → `(resolve \`faff config get slots.methodology\`)` |
| faff-jot:80 | methodology | Drop `(default \`faffter-noon-methodology-thematic\`)` |
| faff-beep-boop:108 | prd | Drop `(default \`faffter-noon-prd\`)` — **only after 4.1 lands** |
| faff-prep:65 | spec | `(the CLI applies the \`faffter-noon-spec\` default — FAFF-182)` → `(the CLI applies the registry default)` |

Not touched: the gateway Slots table (faff/SKILL.md:212-226), config examples, gateway narrative, faffter-dark-adversarial-review (carve-out above), every slot skill's own SKILL.md self-description/`.faffrc` example, beep-boop narrative (:12, :20, :430), faffter-dark-concurrency-parallel:10, faff-map/wtf/tidy mentions.

### 4.3 Lint implementation

```
PROCEDURE prose-default lint (inside cmdValidateAdapters, after the FAFF-172 pass):
  1. DEFAULTS := require("./config").DEFAULTS
     registryKeys := Set(keys of DEFAULTS)
     slotDefaults := Set(values of DEFAULTS entries whose key starts with "slots.")
     DISPATCH_ANCHOR := /via the Skill tool|producer subagent|producer dispatch/i
     GET_WITH_D := /config get\s+`?([A-Za-z0-9_.<>-]+)`?[^\n]*\s-d\s/
  2. FOR each name in allSkills, each line (with 1-based index):
     a. IF line contains ".example": skip line
     b. m := GET_WITH_D.exec(line)
        IF m AND registryKeys.has(m[1]):
          FAIL "<name> (prose default)" — line N: redundant `-d` on registry key "<key>"
     c. IF DISPATCH_ANCHOR.test(line):
          FOR each backticked token t on the line (/`([^`]+)`/g):
            IF slotDefaults.has(t):
              FAIL "<name> (prose default)" — line N: dispatch site names bundled default "<t>"
```

Output style mirrors the existing passes (`FAIL <name> (prose default)` + indented `✗` detail lines); any hit sets `failed = true` so the run exits 1.

**Edge cases:**

- Gateway CLI doc line (`faff config get <dotted.key> [-d DEFAULT]`, faff/SKILL.md:99): does not match `GET_WITH_D` (bracketed form) and its placeholder key is not a registry key — passes either way; pinned by the real-tree regression guard.
- Non-registry `-d` uses (graft:318, gateway:632-633, adversarial:144): key not in set → pass.
- `models.build_by_confidence.<leaf>` dynamic keys: not in `DEFAULTS` → rule (a) ignores them (correct — no registry entry).
- A backticked path token embedding a default name (`faffter-noon-spec-review/SKILL.md`): exact-match set lookup → pass.
- Anchored line naming a non-slot skill (`faffter-dark-authoring-adaptors`, gateway:904): not in the name set → pass.
- Table rows: no exemption needed — verified no Slots-table row carries the anchor phrase.

**Failure modes:**

- **The anchor under-covers a new soft-construction dispatch site.** How you'd know: a manual census (grep the 14 default names over `plugin/skills/*/SKILL.md`) turns up a non-doc hit CI passed. What it means: accepted residual — widen the anchor in a follow-up if it recurs; drift so far (graft:107) was rule (a)-shaped, which is fully mechanical.
- **The anchor over-fires on future legitimate prose.** How you'd know: CI fails on a doc edit. What it means: follow the DELEGATION_ANCHOR precedent — reword the guidance line or add a counter-example carve-out; do not weaken the anchor first.

**Anti-pattern:** hardcoding the 14 default names or registry keys in validate-adapters.js. Why: the registry is the single source (FAFF-182's whole point); a drifted copy re-creates the bug class the lint polices.

**Anti-pattern:** landing the lint in a separate PR from the sweep. Why: validate.yml runs validate-adapters unconditionally, so the lint fails CI on introduction unless the tree is already swept — coupled by construction.

### 4.4 Tests

New `test/validate-adapters-prose-defaults.test.mjs`, modeled on `test/validate-adapters-delegation.test.mjs` (mkdtemp fixture skills dir, spawnSync, assert on the `(prose default)` label):

- rule (a) positive: `default=$("$faff" config get automation_default -d opt-in)` → flagged, exit ≠ 0
- rule (a) negative: `faff config get graft.push_at_build_complete -d true` (non-registry) → clean
- rule (a) negative: same violation on a line containing `.example` → clean
- rule (b) positive (Skill-tool form): ``Invoke the `review` slot via the Skill tool (the default `faffter-noon-review` is a canonical name).`` → flagged
- rule (b) positive (producer form): ``Dispatch the `spec` slot (default `faffter-noon-spec`) as a producer subagent.`` → flagged
- rule (b) doc-mention negatives: a Slots-table-style row and plain narrative → clean
- rule (b) carve-out negative: ``standard structural review (delegated to `faffter-noon-review`)`` → clean
- rule (b) negative: anchored line naming a non-default skill → clean
- real-tree regression guard: run against `plugin/skills`, assert zero `(prose default)` failures

## 5. Scenarios

```
Given a SKILL.md line `config get automation_default -d opt-in` in a fixture skills dir
When faff validate-adapters runs over it
Then it prints a FAIL … (prose default) naming the key and exits non-zero
```

```
Given a fixture line naming `faffter-noon-review` on a "via the Skill tool" dispatch line
When faff validate-adapters runs
Then it fails; and given the same name in a table row or plain narrative, it passes clean
```

```
Given the fully swept plugin/skills tree with slots.prd registered
When faff validate-adapters and node --test run
Then both pass, and `faff config get slots.prd` prints faffter-noon-prd with exit 0 in a repo with no .faffrc
```

## 6. Design decision rationale

- **What construction does rule (b) key on?** Options: (i) dispatch-phrase anchor + exact-match literal — precise, verified 6 flags / 0 doc FPs on the live tree; misses 7 soft sites (hand-swept, residual accepted); (ii) "default"-word adjacency to a backticked literal — catches the parenthetical form everywhere but false-positives on the gateway Slots table and narrative; (iii) any occurrence of a default name — explicitly forbidden by the ticket. **Chosen:** (i) — the only option with zero doc false-positives, matching the ticket's requirement and the precision-biased house precedent.
- **slots.prd gap: in-scope fix or blocker?** Filing a blocker serialises a one-line change behind another prep/build round-trip, and shipping the sweep without it breaks L4 PRD resolution. **Chosen:** in-scope, ordered first.
- **Adversarial-review: lint exemption or sweep exclusion?** A code exemption is dead weight while no carve-out line carries the anchor. **Chosen:** sweep-scope exclusion + a fixture negative test; add a code exemption only if a future anchor widening needs it.
- **Parentheticals at compliant sites: strip or tolerate?** Tolerating needs an adjacency heuristic — more lint complexity to preserve a shortcut vector. **Chosen:** strip at all dispatch sites; tolerate doc mentions.
- **Where do the key/name sets come from?** **Chosen:** `require("./config").DEFAULTS` at lint time — no cycle, no drift.

## 7. Open questions and assumptions

**Open questions:** none.

**Assumptions:**

- **Assumes:** `node --test` runs in CI alongside validate.yml's validate-adapters step. Validate before build: check `.github/workflows/`; if absent, the new test file still runs locally/pre-merge via the graft gates.
- **Assumes:** no consumer parses `faff config defaults --selftest`'s expected list from outside config.js. Validate: `grep -rn "config defaults --selftest"`.

## 8. DONE — Definition of Done

### From WHAT (registry fix)
- [ ] `DEFAULTS` contains `"slots.prd": "faffter-noon-prd"`; selftest `expected` includes it; `faff config defaults --selftest` ok
- [ ] With no `.faffrc`, `faff config get slots.prd` prints `faffter-noon-prd`, exit 0 (test)

### From HOW (sweep)
- [ ] faff-graft:107 reads `config get automation_default` with no `-d`
- [ ] All 6 anchored sites (graft:330, graft:414, jot:52, plot:37, prep:107, prep:231) and all 7 soft sites (graft:211, graft:521, jot:56, jot:60, jot:80, beep-boop:108, prep:65) name no bundled default and route through `faff config get slots.<x>` (directly or via the gateway reference)
- [ ] Final census: every remaining default-name hit in `plugin/skills/*/SKILL.md` is a doc mention, a self-description, the adversarial-review carve-out, or narrative
- [ ] Adversarial-review lines 10/27/29/47 unchanged

### From HOW (lint)
- [ ] New `(prose default)` pass implements rules (a) + (b), deriving both sets from `require("./config").DEFAULTS`, with the `.example` carve-out
- [ ] `faff validate-adapters` on the migrated tree exits 0

### From HOW (tests)
- [ ] `test/validate-adapters-prose-defaults.test.mjs` covers every fixture in 4.4 including the doc-mention and carve-out negatives and the real-tree guard; suite green

### Integration smoke test
```
1. node plugin/skills/faff/bin/faff validate-adapters  → RESULT: PASS
2. Append "x=$(faff config get automation_default -d opt-in)" to any SKILL.md → rerun → FAIL … (prose default); revert
3. node --test test/validate-adapters-prose-defaults.test.mjs test/config-defaults.test.mjs → all pass
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **(P4 right-sized — pass)** Registry one-liner + 14-line prose sweep + one lint pass + one test file is a coherent 1–2 day unit. The `slots.prd` fix is too small to split and is load-bearing for the sweep's beep-boop edit; folding it in is the right merge call.
- **(P7 risk-aware — addressed)** The ticket's named risk (lint false positives) is de-risked *before* build: the anchor was executed mechanically against the live tree today (6 flags, 0 doc FPs) and is pinned by negative fixtures + a real-tree guard, so the risky judgement is settled at spec time, not discovered at build time.
- **(P6 surfaced deps — pass)** Upstream FAFF-182 is Done; no open blockers. The one hidden coupling (validate.yml runs the lint unconditionally → sweep and lint must land in one PR) is surfaced in the spec as an anti-pattern rather than left implicit.
- **(P2 value × risk — note)** The lint is the durable value (drift already recurred once at graft:107); the sweep alone would rot. Sequencing inside the ticket (registry → sweep → lint → tests) delivers the guard in the same increment that makes it satisfiable.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

spec-review: approve
