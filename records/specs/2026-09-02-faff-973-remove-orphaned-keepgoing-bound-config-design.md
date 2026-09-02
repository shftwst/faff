# Spec: remove orphaned `adversarial.spec_judge.keepgoing_bound` config

> Spec: faffter-dark-nlspec · 2026-09-02 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-973.

This is a buildable spec for Linear ticket FAFF-973 ("Remove orphaned adversarial.spec_judge.keepgoing_bound config, relic of the pre-terminal FAFF-922 judge"). Audience: the build agent that will make the edit, and the human reviewer who signs it off. It is a mechanical config-hygiene deletion, no runtime behaviour changes.

## 1. WHY — problem and principles

The load-bearing model: `adversarial.spec_judge.keepgoing_bound` is dead config. The FAFF-922 spec-review judge had a "keep-going" outcome, and this key capped how many extra rounds that judge could grant before force-parking. FAFF-930 (commit 407be00b) replaced that judge with a blinded, two-sided **terminal** adjudicator that has no keep-going outcome. With no keep-going outcome to bound, the key resolves against nothing and no code path reads it.

**Problem statement.** The key `keepgoing_bound: 2` still sits in `.faffrc.yaml` and a stale clause in `faff-prep/SKILL.md` still cites it as a live park cause. This is a deletion of that dead key plus the one prose clause that references it, so the config and the park-cause prose stop describing a mechanism the terminal judge cannot produce.

**Design principles:**

**Delete only the orphaned key and its one prose citation.** The sibling keys under `adversarial.spec_judge` (`refs`, and the separately-tracked `max_tokens`) stay. `max_tokens` under `spec_judge` is tracked as inert by sibling ticket FAFF-972, so it is out of scope here and must be left exactly as it is.

**Leave superseded records as written.** The FAFF-922 design spec (`records/specs/2026-08-29-FAFF-922-spec-review-judge-design.md`) is a historical record. The repo standard keeps superseded records unedited, so its references to the key are intentionally retained.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `.faffrc.yaml` | YAML | Holds the orphaned key under `adversarial.spec_judge` |
| `plugin/skills/faff-prep/SKILL.md` | Markdown (skill prompt) | Line 283 cites the key in a spec-review judge park-cause clause; lines 194 and 210 already state the judge is terminal |
| `records/specs/2026-08-29-FAFF-922-spec-review-judge-design.md` | Markdown (record) | Superseded design spec, only surviving references after this change, left untouched |

**Scope statement.** This is config and prose hygiene inside the spec-review judge lane of faff-prep, no code or contract change.

## 2. out of scope

- **`adversarial.spec_judge.max_tokens`** — Why excluded: its inertness is tracked separately by FAFF-972. Extension point: FAFF-972 handles it in `.faffrc.yaml` under the same `adversarial.spec_judge` block.
- **FAFF-922 design spec references** — Why excluded: it is a superseded historical record the repo standard keeps as written. Extension point: none, the record is intentionally frozen.
- **The terminal judge behaviour and its contract** — Why excluded: FAFF-930 already made the judge terminal, this ticket only removes leftovers. Extension point: `plugin/skills/faff-prep/SKILL.md` "Spec-review judge" section and `faff contract spec-judge-verdict`.
- **Any config schema / known-keys registration** — Why excluded: no schema entry for `keepgoing_bound` exists, so there is nothing to deregister. Extension point: none.

## 3. WHAT — the exact edits

Two edits, in two files.

**Edit A — `.faffrc.yaml`.** Delete the `keepgoing_bound: 2` line under `adversarial.spec_judge`. The block currently reads:

```
  spec_judge:
    keepgoing_bound: 2
    refs:
      - openrouter-gemma
      - openrouter-glm-5-3-flash
      - openrouter-glm-5-2
```

After the edit:

```
  spec_judge:
    refs:
      - openrouter-gemma
      - openrouter-glm-5-3-flash
      - openrouter-glm-5-2
```

`refs` and everything below it are unchanged. Do not touch `code_review` or `spec_review` above. Note: the working `.faffrc.yaml` may also carry a `max_tokens` line under `spec_judge` (FAFF-972's inert-key ticket); if present, leave it exactly as found and delete only `keepgoing_bound`.

**Edit B — `plugin/skills/faff-prep/SKILL.md` line 283.** Remove only the clause `, or a grant-more-rounds bound exhausted at \`adversarial.spec_judge.keepgoing_bound\`` from inside the `spec-review judge park-needs-human` park cause. The current parenthetical reads:

```
(the L3–L4 judge park ruling — including a weighed accept the blocker / major-infosec accept-bar coerced, or a grant-more-rounds bound exhausted at `adversarial.spec_judge.keepgoing_bound`)
```

After the edit:

```
(the L3–L4 judge park ruling — including a weighed accept the blocker / major-infosec accept-bar coerced)
```

The rest of that park cause (the weighed-accept-blocker / major-infosec accept-bar coercion) is retained verbatim, as is the whole park-causes line around it. Only the grant-more-rounds clause and its leading comma are removed. No other line in the file changes.

**Design decisions.** There is one shape choice: whether to delete the key or comment it out.

**Chosen:** delete the key outright. Rationale: it is dead config with no reader and no schema entry, and a commented-out key would leave the same orphaned reference the ticket exists to remove.

## 4. HOW — carrying out the edits

```
PROCEDURE remove_orphaned_keepgoing_bound:
  1. In .faffrc.yaml, under adversarial.spec_judge, delete the line "keepgoing_bound: 2".
     Leave refs and its list items, and any sibling keys, unchanged.
  2. In plugin/skills/faff-prep/SKILL.md line 283, remove the clause
     ", or a grant-more-rounds bound exhausted at `adversarial.spec_judge.keepgoing_bound`"
     from the spec-review-judge park-needs-human parenthetical, keeping the
     weighed-accept-blocker / major-infosec accept-bar text and closing paren.
  3. Verify: grep -rn keepgoing_bound .faffrc.yaml plugin/  returns nothing.
  4. Verify: faff config check runs clean.
  5. Verify: faff validate-adapters passes.
```

**Anti-pattern:** editing the FAFF-922 design spec to match. Why: it is a superseded historical record the repo standard keeps as written, and its references are the intended surviving mentions of the key.

**Anti-pattern:** touching `max_tokens` under `adversarial.spec_judge` while in the file. Why: its inertness is FAFF-972's scope, and changing it here would blur the two tickets.

**Anti-pattern:** rewording or re-wrapping the SKILL.md park-causes line beyond the single clause removal. Why: the line is a dense, lint-checked park-cause enumeration, and any extra edit risks a `faff validate-adapters` failure for no benefit.

**Edge cases.** The removal leaves `adversarial.spec_judge` with `refs` as its sole remaining key (plus the FAFF-972-tracked `max_tokens` if present at build time), which is a valid non-empty mapping, so the block still parses. No fallback chain or error handling applies, this is a static file edit.

## 5. Scenarios

This is a mechanical deletion with no non-trivial behavioural objective above the complexity bar, so there are no born-verifiable runtime scenarios. The observable outcomes are covered by the acceptance greps and the two config/lint checks in DONE below.

## 6. design decision rationale

**Delete the key, or comment it out / deprecate it in place?**

- Delete: removes the orphaned reference entirely, which is the ticket's goal. No reader loses anything because nothing reads it.
- Comment out: leaves a `# keepgoing_bound: 2` line that still names the dead key, so the acceptance grep would still need special handling and the orphan is not really gone.

**Chosen:** delete the key. Rationale: the key has no code reader and no schema entry, the terminal judge cannot produce the park cause it bounded, and a commented line would defeat the acceptance criterion that `grep -rn keepgoing_bound .faffrc.yaml plugin/` returns nothing.

At the time of writing, FAFF-930 has already made the spec-review judge terminal (SKILL.md lines 194 and 210), so no future keep-going outcome is expected to reintroduce a need for this bound. If a keep-going outcome were ever re-added, the bound would be re-specified fresh against that new design rather than revived from this relic.

## 7. open questions and assumptions

**Open questions:** none. The scope is fully specified.

**Assumptions:**

**Assumes:** at build time, `.faffrc.yaml` still carries `keepgoing_bound: 2` under `adversarial.spec_judge`, and `plugin/skills/faff-prep/SKILL.md` line 283 still carries the grant-more-rounds clause. Validation: run `grep -rn keepgoing_bound .faffrc.yaml plugin/` before editing and confirm exactly these two hits (the config key and the SKILL.md clause); if the lines have moved, locate the same two references by content and edit those.

## 8. DONE — definition of done

### From WHY
- [ ] The dead `keepgoing_bound` key no longer appears in runtime config or skill prose: `grep -rn keepgoing_bound .faffrc.yaml plugin/` returns nothing.

### From WHAT (edit A, config)
- [ ] `.faffrc.yaml` no longer contains `keepgoing_bound` under `adversarial.spec_judge`.
- [ ] `adversarial.spec_judge.refs` and its three list items are unchanged, and `max_tokens` (if present) is untouched.
- [ ] The `adversarial.spec_judge` block still parses as valid YAML with `refs` as a remaining key.

### From WHAT (edit B, prose)
- [ ] `plugin/skills/faff-prep/SKILL.md` line 283 no longer contains the clause "or a grant-more-rounds bound exhausted at `adversarial.spec_judge.keepgoing_bound`".
- [ ] The rest of the `spec-review judge park-needs-human` park cause (weighed-accept-blocker / major-infosec accept-bar coercion) is retained.

### From scope guards
- [ ] `records/specs/2026-08-29-FAFF-922-spec-review-judge-design.md` is unchanged, and its references are the only surviving `keepgoing_bound` mentions in the repo: `grep -rn keepgoing_bound .faffrc.yaml plugin/ records/` returns only lines under `records/specs/`.

### From verification
- [ ] `faff config check` runs clean, with no new error or warning attributable to the change.
- [ ] `faff validate-adapters` passes, confirming the SKILL.md park-causes line stays lint-clean.
- [ ] No runtime path changed: the terminal judge never read the key, so removal alters no behaviour.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Run: grep -rn keepgoing_bound .faffrc.yaml plugin/   -> expect no output.
  2. Run: grep -rn keepgoing_bound records/               -> expect only FAFF-922 design-spec lines.
  3. Run: faff config check                               -> expect clean exit, no new warning.
  4. Run: faff validate-adapters                          -> expect pass.
```

confidence: high
build-tier: standard
