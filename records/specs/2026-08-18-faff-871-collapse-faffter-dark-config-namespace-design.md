# Collapse the `faffter_dark` config namespace — move `adversarial` to the config root

> Spec: faffter-dark-nlspec · 2026-08-18 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-871.

This spec addresses FAFF-871. Its audience is the build agent that will perform the rename and the human reviewers gating it. It describes a mechanical, repo-wide config-key rename: `faffter_dark.adversarial.*` → `adversarial.*`. There is no runtime behaviour change — the adversarial-review chain resolves identically before and after; only the dotted path an operator types (and the code reads) gets one segment shorter.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faffter_dark` is a config *namespace* with exactly one child — `adversarial`. Every reference in the tree is `faffter_dark.adversarial.<x>`; there is no other `faffter_dark.<y>`. A namespace that never holds more than one key is pure overhead: a longer dotted path in every `.faffrc`, every `faff config get`, every `dig(cfg, "faffter_dark.adversarial…")` call site, with no grouping value in return. Collapsing it means the reader digs `adversarial` directly and `adversarial` becomes a first-class top-level namespace alongside `slots`, `models`, `backends`, etc.

**Problem statement:** Today the adversarial-review backend config lives two levels deep under a single-child wrapper key. That wrapper carries no meaning and inflates every path that touches it. This change deletes the wrapper and promotes `adversarial` to the config root.

**Design principles:**

- **Behaviour-preserving rename, not a redesign.** The resolved adversarial chain, the residency gate, the secret-scan, and the sequence-key carve-out must all behave identically after the change. The only observable difference is the shorter path. Any diff that changes *what* the config resolves to is out of scope and wrong.
- **No orphaned old-path readers.** Every literal `"faffter_dark.adversarial…"` string, `{ faffter_dark: { adversarial: … } }` object literal, and prose mention that a rename would strand must move in the same change. A missed reader silently reads `undefined` post-rename — fail-loud only if it happens to hit a required-field guard, silent-wrong otherwise. The DONE grep-gate below is the backstop.
- **The skill *names* are not touched.** `faffter-dark-adversarial-review`, `faffter-dark-spec-review`, and the `faffter-dark-*` skill directory names are a separate naming axis and stay exactly as they are. This change is only the `faffter_dark` *config key*.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` | JS | `SEQUENCE_VALUED_KEYS`, `WRITABLE_NAMESPACES`, secret-scan self-tests, YAML-subset digs, comments |
| `plugin/skills/faff/bin/lib/adversarial-backends.js` | JS | `dig(cfg, "faffter_dark.adversarial")` reader + malformed-detail strings + fixtures |
| `plugin/skills/faff/bin/lib/backends.js` | JS | residency surfaces `…requires` / `…refs[name]` + fixtures |
| `plugin/skills/faff/SKILL.md` | prose | gateway prose (carve-out list, compose-not-subsume, effort judge block) |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md`, `…spec-review/SKILL.md` | prose | transport call-site references |
| `.faffrc.yaml`, `.faffrc.example.yaml` | YAML | operator config + documented example |
| `test/*.mjs` (6 files) | JS | fixtures asserting the config shape |
| `docs/guide/{skills,cli}.md`, `verification/external-verification/*` | prose/sh | doc + scaffolder mentions |

**Scope statement:** A leaf refactor of the config vocabulary that unblocks FAFF-870 (per-consumer adversarial backends) by giving it a clean `adversarial.<consumer>.*` root to author into.

## 2. OUT OF SCOPE

- **The `faffter-dark-*` skill names / directory names** — Why excluded: a separate naming axis; renaming them is not wanted and would be a much larger, user-visible change. Extension point: none planned; a hypothetical future skill-rename would be its own issue.
- **Per-consumer adversarial sub-keys (`adversarial.spec_review.*` etc.)** — Why excluded: that is FAFF-870's job; this change only relocates the existing single block. Extension point: FAFF-870 authors those sub-keys under the new `adversarial` root this change creates.
- **A deprecation-alias / dual-read compatibility period** — Why excluded: see the migration-policy decision (§6); this is a hard rename. Extension point: none — if a future need for config-key aliasing arises it is a general `config.js` feature, not this key's concern.
- **Any change to the resolved chain, residency semantics, or secret-scan matching logic** — Why excluded: behaviour-preserving principle. The secret-scan already walks paths generically (see §4) so it needs no logic change at all.

## 3. WHAT — the rename surface

**Vocabulary:**

| Term | Definition |
|---|---|
| old path | `faffter_dark.adversarial` (the two-level path being removed) |
| new path | `adversarial` (the promoted top-level namespace) |
| generic-prefix reader | code that enumerates or matches config paths without hardcoding `faffter_dark` (the secret-scan tree-walk) — needs no change |
| literal reader | code with the string `"faffter_dark.adversarial…"` or a `{ faffter_dark: { adversarial } }` literal — must be rewritten |

**The transform (uniform):** everywhere, `faffter_dark.adversarial` → `adversarial`, and the object shape `{ faffter_dark: { adversarial: X } }` → `{ adversarial: X }`. The `.adversarial` child keeps its name; only the `faffter_dark` wrapper is deleted.

**Named literal readers that must change (from explore, ground-truthed):**

```
config.js:
  - SEQUENCE_VALUED_KEYS entries (:861-863): "faffter_dark.adversarial.refs"
    / ".fallbacks" / ".backends"  →  "adversarial.refs" / ".fallbacks" / ".backends"
  - WRITABLE_NAMESPACES (:874): the member "faffter_dark"  →  "adversarial"
  - secret-scan self-test fixtures + expected surface strings (~:1700-1709)
  - mergeConfigPath / carve-out self-test fixtures (~:1154-1190) and YAML-subset
    dig self-test (:1362-1363)
  - explanatory comments (:153, :159)

adversarial-backends.js:
  - dig(cfg, "faffter_dark.adversarial") (:80)  →  dig(cfg, "adversarial")
  - malformed/unset detail strings naming the path (:119, :121, :144)
  - fixture object literals (many, ~:167-293)

backends.js:
  - dig(cfg, "faffter_dark.adversarial") (:406)  →  dig(cfg, "adversarial")
  - residency surface strings (:415-416, :424) and the leading comment (:376)
  - fixture object literals (:686-718)
```

**Named prose / config / test surfaces that must change:**

```
plugin/skills/faff/SKILL.md            :129, :265, :267 (carve-out list + two engine-block mentions)
faffter-dark-adversarial-review/SKILL.md  (9 mentions — transport call-sites)
faffter-dark-spec-review/SKILL.md         (4 mentions)
.faffrc.yaml                           the faffter_dark: / adversarial: block → root adversarial:
.faffrc.example.yaml                   :89-99, :116, :259 (comments + example block)
docs/guide/skills.md                   :54
docs/guide/cli.md                      :33 (adversarial-backends CLI description)
test/adversarial-backends.test.mjs     (21), test/config-set.test.mjs (6),
test/config-two-file.test.mjs (6), test/scaffolder-lights-out-dials.test.mjs (6),
test/config-defaults.test.mjs (2), test/redact.test.mjs (1)
verification/external-verification/scaffold-p3-landing-page.sh  :60, :90, :110
verification/external-verification/README.md                    :46
```

**No-change confirmations (verified, must be preserved):**

- The secret-scan (`scanDocForSecrets`) walks the parsed doc tree and builds dotted paths *generically* — it does not hardcode `faffter_dark`. Post-rename it flags `adversarial.api_key` automatically. Only its self-test *fixtures* mention the old literal.
- `WRITABLE_NAMESPACES` gates `faff config set <key>` at top level. Swapping the member makes `faff config set adversarial.deadline …` (a scalar) work; the sequence-valued keys (`adversarial.refs` / `.fallbacks` / `.backends`) stay refused by `config set` and remain a committed-base hand-edit exactly as before.

## 4. HOW — Behavior

**Approach.** This is a find-and-replace refactor with a verification gate, not a design task. The mechanic:

```
PROCEDURE collapse_namespace:
  1. Enumerate every reference:
       grep -rn "faffter_dark" plugin/ docs/ test/ verification/ .faffrc.yaml .faffrc.example.yaml
     (the skill-NAME hits `faffter-dark-*` use a hyphen, not underscore — the
      underscore form `faffter_dark` is the config key and the only target.)
  2. For each hit, apply the transform:
       - dotted-string literals: "faffter_dark.adversarial"  →  "adversarial"
       - object literals: { faffter_dark: { adversarial: X } }  →  { adversarial: X }
       - YAML blocks: delete the `faffter_dark:` header line and dedent its
         `adversarial:` child (and everything under it) by one level to the root
       - prose: rewrite the path inline; keep sentence meaning
       - the WRITABLE_NAMESPACES set: replace the string member, don't add a second
  3. Re-grep for "faffter_dark" (underscore). Expect ZERO hits except any that are
     unambiguously the skill NAME rendered with an underscore (there are none today —
     names use the hyphen). Any remaining underscore hit is an escaped reader → fix.
  4. Run the config self-tests and the affected .mjs test files; all pass.
```

**Anti-pattern:** blind `sed s/faffter_dark.adversarial/adversarial/g` across the repo. Why: it would also rewrite the skill-name axis if any underscore form existed, and it silently skips the object-literal `{ faffter_dark: { adversarial } }` shape (no dot) and the YAML block-dedent (structural, not textual). Enumerate, then transform per shape.

**Anti-pattern:** adding `adversarial` to `WRITABLE_NAMESPACES` while leaving `faffter_dark` in it. Why: `faffter_dark` would remain a writable top-level namespace with no reader — dead vocabulary, and the `.faffrc.example.yaml`-membership self-test (`configSetSelftest`) would drift. Replace, don't append.

**Edge cases and error handling:**

- **YAML block dedent.** The operator `.faffrc.yaml` and `.faffrc.example.yaml` store the block as nested YAML. Removing the wrapper requires dedenting the `adversarial:` subtree by one indent level to column 0. A textual replace of just the key name is wrong here — the indentation must move too, or the parser reads a malformed doc.
- **Secret-scan surface string.** The self-test at `config.js:1709` asserts the exact surface `".faffrc.yaml:faffter_dark.adversarial.api_key"`. After the rename the *runtime* surface becomes `.faffrc.yaml:adversarial.api_key` automatically (generic tree-walk); the *fixture and its expected string* must both be updated to the new path or the self-test fails.
- **Working-tree note.** `.faffrc.yaml` currently carries unrelated uncommitted edits (budget/andon/refs). The build must migrate the `faffter_dark:` block in place without reverting those edits — operate on the working tree as found, not on `git HEAD`.

**Failure modes:**

- **The failure:** a literal reader is missed (e.g. a fixture in a test file not enumerated), so post-rename it constructs `{ faffter_dark: { adversarial } }` that no reader consumes, or asserts an old surface string. **How you'd know:** the re-grep in step 3 returns a non-zero hit, or a `.mjs` test asserts the old path and fails. **What it means:** proceed — fix the straggler and re-grep; this is a caught-by-construction miss, not a design flaw.
- **The failure:** the residency or chain resolver reads `adversarial` but an operator's real `.faffrc` still says `faffter_dark:` (not migrated), so the adversarial block resolves as unset and the review chain silently degrades to the `needs-human` exit. **How you'd know:** `faff adversarial-backends` exits 3 ("adversarial block absent") on a config that visibly has the block. **What it means:** proceed — this is the intended hard-rename consequence; the migration note (§6) tells the operator to rename their block. The single in-repo operator `.faffrc.yaml` is migrated as part of this change, so the repo's own runs are unaffected.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a .faffrc with a root `adversarial:` block (host + refs set)
When `faff adversarial-backends --json` runs
Then it emits the same primary-first backend chain it emitted for the
     equivalent `faffter_dark.adversarial:` block before the rename (exit 0)
```

```
Given a .faffrc with `adversarial.api_key` set to a secret-shaped value
When the secret-scan runs over the config
Then it flags surface `.faffrc.yaml:adversarial.api_key` (no `faffter_dark.` prefix)
```

- The full config self-test suite (`faff … --selftest` paths in config.js) passes with the renamed fixtures and surface strings.
- `faff config set adversarial.deadline 1920` succeeds (scalar write to the promoted namespace); `faff config set adversarial.refs …` is still refused as a sequence-valued carve-out.

## 6. DESIGN DECISION RATIONALE

**Migration policy: hard rename vs deprecation-alias?**

- *Hard rename* — delete `faffter_dark`, update every `.faffrc`, old key stops being read. Pro: one clean change, no alias machinery, no dual-read ambiguity, no dead vocabulary. Con: an un-migrated operator `.faffrc` silently loses its adversarial config (degrades to the `needs-human` exit).
- *Deprecation alias* — read `faffter_dark.adversarial` as a fallback with a warning, let `adversarial` win. Pro: no operator breakage. Con: adds alias-resolution code to `config.js`, a warning surface, and a later cleanup issue; keeps the redundant vocabulary alive precisely while the goal is to remove it.

**Chosen:** Hard rename. Rationale: faff is early-stage, operators own their own `.faffrc`, `config.js` has no existing key-alias machinery to extend cheaply, and the sole in-repo operator config is migrated within this same change. The failure mode (un-migrated block → visible `adversarial-backends` exit 3, not a silent wrong-answer) is loud and self-explaining, and a one-line migration note in the change (`faffter_dark: adversarial:` → root `adversarial:`) covers it. The ticket itself framed hard-rename as the likely-acceptable path. The alias approach would add exactly the kind of redundant machinery this ticket exists to remove.

**Should `adversarial` be added to `WRITABLE_NAMESPACES` (vs left out)?**

**Chosen:** Yes — replace the `faffter_dark` member with `adversarial`. Rationale: `faffter_dark` was already a member (so `config set` on its scalar leaves worked); preserving that capability under the new name is behaviour-preserving. The `.faffrc.example.yaml`-membership self-test also requires every documented top-level key to be a member, and `adversarial` will be documented there.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. The migration-policy question the ticket raised is resolved to hard-rename in §6 (a settleable engineering call on faff's own early-stage, single-operator repo, sanctioned by the ticket), and the "generic-prefix reader" question is answered by inspection (the secret-scan is path-agnostic; no generic `faffter_dark`-prefix reader exists).

**Assumptions:**

- **Assumes:** the `faffter-dark-*` *skill* directory/name axis uses the hyphen form exclusively, so the underscore token `faffter_dark` uniquely identifies the config key. Validation: `grep -rn "faffter_dark" plugin/` before starting — every hit must be a config-key reference (confirmed at spec time: it is).
- **Assumes:** no consumer outside the repo (external tooling, unmerged branches) reads `faffter_dark.adversarial`. Validation: not repo-checkable; accepted under the hard-rename policy (operators own their config).

## 8. DONE — Definition of Done

### From WHY
- [ ] The `faffter_dark` wrapper key no longer exists anywhere in the repo; `adversarial` is a top-level config namespace.
- [ ] The resolved adversarial chain, residency gate, and secret-scan behave identically to pre-change (behaviour-preserving).
- [ ] No `faffter-dark-*` skill or directory name was renamed.

### From WHAT / HOW (readers)
- [ ] `adversarial-backends.js` reads `dig(cfg, "adversarial")`; all its detail/unset strings name the new path.
- [ ] `backends.js` reads `dig(cfg, "adversarial")`; residency surface strings read `adversarial.requires` / `adversarial.refs[name]`.
- [ ] `config.js` `SEQUENCE_VALUED_KEYS` holds `adversarial.refs` / `.fallbacks` / `.backends`; `WRITABLE_NAMESPACES` holds `adversarial` and NOT `faffter_dark`.
- [ ] All `config.js` self-test fixtures and expected surface strings (secret-scan, carve-out, YAML-subset dig) use the new path and pass.

### From WHAT / HOW (prose, config, tests)
- [ ] Gateway `faff/SKILL.md`, `faffter-dark-adversarial-review/SKILL.md`, and `faffter-dark-spec-review/SKILL.md` reference `adversarial.*` in their call-sites.
- [ ] `.faffrc.yaml` and `.faffrc.example.yaml` carry a root `adversarial:` block (correctly dedented YAML), unrelated working-tree edits preserved.
- [ ] `docs/guide/skills.md`, `docs/guide/cli.md`, and the `verification/external-verification/*` files reference the new path.
- [ ] All six affected `test/*.mjs` files pass with the renamed fixtures.

### From HOW (verification gate)
- [ ] `grep -rn "faffter_dark" plugin/ docs/ test/ verification/ .faffrc.yaml .faffrc.example.yaml` returns zero matches.
- [ ] `faff config set adversarial.deadline <n>` succeeds; `faff config set adversarial.refs …` is still refused.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. In a .faffrc fixture, place a root `adversarial:` block with host + a native backends: array.
  2. Run `faff adversarial-backends --json`.
  3. ASSERT exit 0 and a primary-first JSON array matching the block (plumbing connected).
  4. Run the config self-test entrypoint; ASSERT it passes (fixtures migrated).
```

## Methodology critique

Agile-delivery lens (`issue-critique`):

- **Right-sized?** Yes. One cohesive concern (collapse a single-child namespace), a single 1–3 day mechanical rename. Not splittable — the rename is atomic (a partial rename leaves a broken half-migrated config). No always-ships-together sibling to merge.
- **Workstream fit?** Yes. A config-vocabulary cleanup that directly unblocks FAFF-870's `adversarial.<consumer>.*` authoring. Outcome-named and self-contained.
- **Deps surfaced?** Yes. `relatedTo` FAFF-870 is recorded, and the spec carries the sequencing intent (land before FAFF-870 to avoid rework). The relation is soft ("either order works"), so a hard `blocks` link is not warranted — surfaced, not mis-modelled.
- **Risk profile?** Low. No novel integration, no external dependency, no runtime-behaviour change. The one real risk (a missed literal reader) is caught by the DONE grep-gate and the self-test suite — no de-risking spike needed.

No issues that should block or re-slice this ticket.

confidence: high
build-tier: complex

*Spec produced autonomously (faffter-dark-nlspec) under run run-20260818-183242-beepboop-list-00349d.*
