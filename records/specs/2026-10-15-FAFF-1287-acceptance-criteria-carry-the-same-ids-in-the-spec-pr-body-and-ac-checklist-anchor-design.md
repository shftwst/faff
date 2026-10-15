# FAFF-1287: Acceptance criteria carry the same ids in the spec, PR body and ac-checklist anchor

> Spec: faffter-dark-nlspec · 2026-10-15 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1287.

This spec gives each acceptance criterion (AC) one stable id that names its ticket. The same bytes appear in the spec's DONE section, the PR body's `## Acceptance Criteria` list, `ac-checklist.json` and, once FAFF-1288 lands, the test that verifies it. It is for the build agent that implements the change and the reviewers who approve it.

This ticket covers the evidence-shape half of the product owner's request. It has two siblings:

- FAFF-1288 owns the test-side tag, its parser and the cross-check, and uses the id grammar and locator format this spec fixes.
- FAFF-1289 owns the spec-authoring rule (producers write `[ac-N]` and keep ids stable) and the spec-review checks. It was split out at spec review. Until it lands, specs without authored ids fall back to positional ids, which this ticket already handles.

## 1. WHY

**The load-bearing model.** An AC id is minted once, in the spec, as a short lowercase token such as `[ac-3]` on a DONE line. Code, never prose, adds the lowercased ticket to make `faff-1287#ac-3`. It writes that id into the anchor, then renders the PR-body list from the written anchor. The PR-body sanitizer leaves lowercase ids alone, so the same bytes appear everywhere.

**Problem.** Today an auditor can't follow an anchor back to the spec criterion or to the test that verified it:

- `faff dod classify` gives DONE items positional ids such as `done:3`, which shift when the spec is edited.
- graft Step 8 numbers ACs "AC 1, AC 2" in PR-body order, with no tie back to the spec.
- The v0.3 ac-checklist allows only free-text `verified`.

This change gives every AC an authored id qualified by its ticket and a structured record of how it was verified. It renders the PR body and the anchor from one source.

**Design principles.**

- **Byte-identical, not "equivalent".** The qualified id must be the same byte string in the list derived from the spec, the PR body after sanitizing, the anchor JSON and comments in test source. Reject any design that needs a normalisation step to compare ids.
- **Code renders, prose does not.** A faff command prints the PR-body list from the written anchor. Graft never writes the list by hand.
- **Additive under v0.3.** Every schema change must pass `classifySchemaChange` as additive. The FAFF-1278 base-commit validator then accepts the head schema, and older anchors stay valid.
- **The sanitizer is not touched.** The citation-hygiene rule in `pr-body.js` stays as it is. The id grammar is chosen so the sanitizer never matches it.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/pr-body.js` | JS | Sanitizer. Rewrites the hyphen in every `[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*` token to U+2011, including inside code spans. Only the closing `Closes <TARGET>` line is exempt. Exports `TARGET_RE`. |
| `plugin/skills/faff/bin/lib/admissibility.js` | JS | `dodClassify` and `parseDoneChecklist`. Mints positional `id` values (`done:N`, `scenarios:N`, FAFF-1259). |
| `plugin/skills/faff/bin/lib/evidence.js` | JS | `anchoredAcChecklist`, `acChecklistWriterViolations` and `writeAcChecklist`. Also `classifySchemaChange` and `resolveSchemaSet` (FAFF-1258, FAFF-1278). |
| `plugin/skills/faff/contracts/evidence-v0.3/schema/ac-checklist.schema.json` | JSON Schema | Closed at both levels. `schema_version` enum is `[1]`. A byte-identical copy lives under `verification/evidence/v0.3/schema/`. |
| `plugin/skills/faff/bin/lib/contract-engine.js` | JS | Schema validator. Supports only `type`, `enum`, `required`, `properties`, `additionalProperties`, `items`, `minItems`, `pattern` and `discriminator`. |
| `plugin/skills/faff/bin/lib/merge-gate.js` `readAcComplete` | JS | Reads only `all_verified` and `criteria[].passed`, and ignores extra keys. |
| `plugin/skills/faff/bin/lib/finding-id.js` | JS | Precedent: a pure, dependency-free id helper in the governance region, where ids are minted by code. |
| `plugin/skills/faff-graft/SKILL.md` Step 8 | Prose | Hand-written `## Acceptance Criteria` template, and a JSON build "from the same per-AC source". |

**Scope.** This is a slice of FAFF-1255 (Anchored evidence). It must land before FAFF-1261 freezes v0.3 by enforcing the closed schema.

## 2. OUT OF SCOPE

- **The test-side `// verifies:` tag, its parser and the warn-only cross-check.**
  - Why excluded: FAFF-1288 owns them.
  - Extension point: FAFF-1288 imports `parseAcId` from the new `ac-id.js` and reads `verifications[].locator` from the anchor.
- **Refusing to mint or merge anchors that fail their schema.**
  - Why excluded: FAFF-1261 owns it.
  - Extension point: the existing `writeAcChecklist` validation and the governance-check evidence-schema leg.
- **Ids on `## Scenarios` criteria and holdouts.**
  - Why excluded: Scenarios keep FAFF-1259's positional `scenarios:N` ids, and holdout records don't change.
  - Extension point: the place in `dodClassify` that adds Scenarios criteria.
- **The `[ac-N]` authoring rule, the labelling-scheme exception and the spec-review id checks.**
  - Why excluded: split to FAFF-1289 at spec review, so the code change that FAFF-1261 waits on is not held up by prompt edits.
  - Extension point: the kernel spec dialect, the spec producers and both QA review lenses.
- **A mechanical check for id drift across revisions** (comparing two spec versions and flagging a renumbered or reused id).
  - Why excluded: stability comes from FAFF-1289's producer rule plus its spec-review check.
  - Extension point: a new action in the `faff dod` namespace beside `classify` and `split`.
- **Changing the PR-body sanitizer.**
  - Why excluded: the sanitizer can't match the chosen grammar.
  - Extension point: `neutralizeTokens` in `pr-body.js`, if a future id ever needs uppercase.
- **Trackers whose issue ids don't match `[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*`.**
  - Why excluded: `validateTarget` in `pr-body.js` already refuses them, so graft can't open a PR for them today.
  - Extension point: `qualifyAcId` in `ac-id.js`.
- **Adding ids to specs that are already attached.**
  - Why excluded: specs without authored ids fall back to positional ids.
  - Extension point: re-prep the issue.
- **Changing what `readAcComplete` or the governance-check `merge_floor` leg decide.**
  - Why excluded: they keep reading `all_verified` and `criteria[].passed` only.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Local AC id | The id written in the spec on a DONE line, for example `ac-3`: lowercase `ac-`, then a number with no leading zero. |
| Positional AC id | FAFF-1259's `done:N`. Used when a DONE item has no usable local id. |
| Qualified AC id | The lowercased ticket, then `#`, then the local or positional id: `faff-1287#ac-3` or `faff-1287#done:3`. This is the id used in the anchor, the PR body and test sources. |
| Verification method | One structured record of how an AC was verified: a kind (`test`, `command` or `human`) and, for `test` and `command`, a locator. |
| Locator | The string that points at the method: a test file plus test title, or the exact command. |

### Id grammar

```
LOCAL_AC_ID      := "ac-" NUMBER
POSITIONAL_AC_ID := "done:" NUMBER
TICKET           := lowercase(issue identifier)      # issue id must match ^[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*$
QUALIFIED_AC_ID  := TICKET "#" ( LOCAL_AC_ID | POSITIONAL_AC_ID )
NUMBER           := [1-9][0-9]*

Schema pattern for QUALIFIED_AC_ID:
  ^[a-z][a-z0-9]{1,15}-[1-9][0-9]*#(ac-[1-9][0-9]*|done:[1-9][0-9]*)$
```

No information is lost in the ticket part: uppercasing it gives back the tracker identifier. The token needs no escaping in Markdown, JSON or a test title. GitHub-flavoured Markdown doesn't autolink it, because a `#` reference needs `owner/repo#N` or a bare `#N`.

**Chosen:** lowercase qualified ids, such as `faff-1287#ac-3`. Rationale:

- It is the only option that comes through the sanitizer byte-identical and still reads as the familiar ticket key. It matches graft's lowercase branch names, and `grep -i FAFF-1287` finds it.
- The uppercase form sketched in the ticket, `FAFF-1287#AC-3`, becomes `FAFF‑1287#AC‑3` after `neutralizeTokens`. A bare `AC-3` is rewritten the same way.
- Underscore forms such as `FAFF_1287#AC_3` survive too, but a plain search for the ticket key won't find them.
- If Linear links a lowercase mention in a PR body, the linked ticket is that PR's own target, which the closing line already links. No sibling issue is touched.

### Authored syntax in a spec

A DONE item carries its local id in square brackets right after the checkbox:

```
- [ ] [ac-3] `faff evidence render ac-checklist` prints the anchor's ids byte for byte
```

**Chosen:** a leading lowercase `[ac-N]` on the DONE line. Rationale:

- The existing checkbox regex still matches the line.
- It reads cleanly in rendered Markdown: a bracketed token with no link definition renders as plain text.
- Its bytes are exactly the local part of the qualified id.
- An uppercase `[AC-3]` is not recognised. The parser prints an advisory and the item takes its positional id, so a near miss never quietly becomes a different id.

### `dod classify` output additions

```
RECORD DoneCriterion (additive fields only; existing fields unchanged):
  local_ac_id: String          # "ac-N" when authored and unique, else the positional id "done:N"
  ac_id: String                # only when --issue is passed: QUALIFIED_AC_ID
  text: String                 # the DONE line with any leading "[ac-N] " removed
```

`id`, `class`, `holdout`, `oracle_less`, `verification_tier` and the counts keep their current values. `class` is computed on the text after the id is removed, so authoring an id never changes a criterion's class.

### ac-checklist schema additions (v0.3, in place)

```
RECORD Criterion (closed; existing required keys unchanged: ac, verified, passed):
  ac: String
  verified: String                       # free text, still required
  passed: Boolean
  ac_id: String | null                   # optional key; pattern QUALIFIED_AC_ID when a string
  verifications: List<Method> | null     # optional key; minItems 1 when a list

RECORD Method (closed):
  kind: Enum { test, command, human }    # required
  locator: String                        # optional in the schema; kind rules enforced by the writer
```

Neither new key is added to any `required` list, and `schema_version` stays `1`. `anchor-manifest.json` is not edited, because `resolveSchemaSet` rejects the whole candidate set when the manifest differs from the base.

**Chosen:** extend v0.3 in place with two optional keys, with no `schema_version` bump. Rationale:

- v0.3's README marks it a draft that slices extend in place until FAFF-1261 freezes it.
- `classifySchemaChange` accepts a new optional property with a closed sub-schema as additive.
- Changing the `schema_version` enum or `required` is non-additive. The FAFF-1278 base-commit leg would then fall back to the base schema and fail every new anchor.

**Chosen:** the writer always emits both new keys on every criterion, as `null` when the input doesn't carry them. Rationale: v0.3's evidence-documents note says anchored documents carry a fixed key set, with `null` for no value. Anchors written before this change lack the keys and still validate, because neither key is required.

### Verification methods per AC

**Chosen:** `verifications` is a list from the start, with one entry per method. Each AC stays one `criteria` entry. Rationale:

- An AC verified by both a unit test and a live command is common.
- A single object now would need a second sibling key later.
- Repeating the criterion once per method would break "one `criteria` entry per AC", duplicate the PR-body line and make FAFF-1288's coverage count ambiguous.

The key is named `verifications` (plural) rather than the ticket's `verification`, because its value is a list.

### Locator format per kind

| Kind | Locator | Rules the writer enforces |
|---|---|---|
| `test` | `<file>::<test title>`, for example `test/ac-id.test.mjs::qualifies a local id` | Required. Split on the first `::`. The file is repo-relative, uses forward slashes and is non-empty, with no leading `/` and no `..` segment. The title is the test's own title as written in source (the innermost one, not joined with its suites), non-empty and on one line. |
| `command` | The exact command as run, for example `faff evidence render ac-checklist --run-dir .faff/runs/r1 --issue FAFF-1287` | Required, non-empty and on one line. Known-secret redaction already applies to the whole input. |
| `human` | none | Must be absent. The reason stays in `verified` as `Needs human verification: <reason>`. |

**Chosen:** file plus test title, not file plus line. Rationale:

- Line numbers drift whenever code above the test changes.
- The existing graft template already uses `file::test`.
- FAFF-1288's cross-check searches the file for a `verifies:` tag rather than going to a line.

**Chosen:** a `command` locator never contains a literal credential. A command that needs a secret names it through an environment variable (`$TOKEN`), never its value. Rationale: known-secret redaction only catches values faff can resolve from configuration, and the locator is committed in the anchor and published in the PR body. The writer cannot detect an arbitrary credential, so this is a rule graft Step 8 states and reviewers check, with redaction as the backstop.

**Chosen:** the kind and locator rules live in `acChecklistWriterViolations`, not the schema. Rationale:

- The faff validator has no `if`, `then` or `oneOf`, and `closedSubschema` refuses a `discriminator` on a new property. A per-kind schema therefore can't be expressed additively.
- The schema stays a closed shape check. The writer enforces the rules that span fields, as it already does for `all_verified`.

### Writer rules for the new keys

```
PROCEDURE ac_checklist_writer_violations(doc, issue):
  1. Existing rules unchanged (criteria non-empty when present; all_verified equals every passed).
  2. IF some criteria carry a string ac_id and others carry null:
       refuse "ac_id: every criterion carries one, or none does"
  3. FOR each string ac_id:
       a. its ticket part must equal lowercase(issue), else refuse "ac_id: ticket part must match --issue"
       b. it must be unique within criteria, else refuse "ac_id: duplicate"
  4. FOR each criterion: `ac` and `verified` must each be a single line (no CR or LF), else refuse
       "criteria[i]: ac and verified must be one line". A multi-line value could otherwise add
       checklist or Method lines to the rendered PR-body block that are not in the anchor.
  5. FOR each method in each non-null verifications list:
       apply the per-kind locator rules in the table above; refuse naming the criterion index and rule,
       never echoing the locator value
```

### Shared id helper

**Chosen:** a new module, `plugin/skills/faff/bin/lib/ac-id.js`, written in plain JavaScript with no dependencies and placed in the governance region. It exports `parseLocalAcId(line)`, `qualifyAcId(issue, localOrPositional)`, `parseAcId(qualified)` and the grammar constant that the schema pattern mirrors. Rationale:

- `finding-id.js` is the precedent for a pure id helper where ids are minted by code.
- Both `admissibility.js` (factory region) and `evidence.js` (governance region) need it. The region lint allows a factory file to require a governance file.
- Plain `.js` avoids the ADR-0132 TypeScript build step.

The module keeps its own copy of the issue grammar, because a governance file may not require `pr-body.js`, which is in the factory region. A test pins the two copies together. FAFF-1288 imports `parseAcId` from this module.

### Renderer command

`faff evidence render ac-checklist --run-dir <dir> --issue <id>` reads `<run-dir>/<ISSUE>/ac-checklist.json`, validates it against the schema the writer uses and runs the same `acChecklistWriterViolations` rules, then prints the PR-body block to stdout. Running the writer rules means the write path and the render path agree on what a well-formed anchor is, so an anchor written by an older or foreign writer with an illegal locator or a multi-line `verified` is never rendered. Appendix A shows the block format.

**Chosen:** render the PR-body list from the written anchor file, not from a second copy of the input. Rationale: the anchor is the document after validation, redaction and stamping. Deriving the Markdown from it makes byte identity a property of the code path rather than of graft's discipline.

Exit codes follow the writer's:

| Exit | Meaning |
|---|---|
| 0 | Block printed |
| 1 | Anchor missing, fails its schema or breaks a writer rule; nothing printed |
| 2 | Usage or path-guard fault |

### Authoring rule and id stability

FAFF-1289 owns the rule that spec producers author `[ac-N]` on every DONE item and keep ids stable across revisions, the matching exception to the kernel's labelling-scheme rule, and the spec-review checks. This ticket only reads the ids and falls back when they are missing.

## 4. HOW

### Build order

Build the schema change first and prove it is additive (ac-6, ac-7) before the writer, renderer or graft work. If `classifySchemaChange` does not class it as additive, everything downstream would be built on a schema that cannot ship.

### Flow

```
spec DONE line            dod classify --issue          graft Step 8                faff evidence
- [ ] [ac-3] text   --->  { ac_id: faff-1287#ac-3,  --> builds {all_verified,  --> write ac-checklist  --> ac-checklist.json
                            text, local_ac_id }          criteria[ac, verified,                                  |
                                                         passed, ac_id,                                          v
                                                         verifications]}           render ac-checklist  --> "## Acceptance Criteria" block
                                                                                                                 |
                                                                                   graft Step 9b sanitize  --> PR body (ids unchanged)
```

### Parsing authored ids

The parser reads the bracket token at the start of each DONE line. It keeps the token when it is a well-formed, unique local id. Otherwise the item falls back to its positional id.

```
PROCEDURE assign_local_ac_ids(done_items):
  1. FOR each item at 1-based DONE position n:
       a. IF text starts with "[ac-<NUMBER>] ": candidate = "ac-<NUMBER>"; text = remainder
       b. ELSE IF text matches /^\[ac-[^\]]*\]/i but not the exact form above (for example "[AC-2]",
          "[ac-03]", "[ac-2x]"):
            advisory "DONE item id not recognised (use lowercase [ac-N])"; candidate = none
       c. ELSE candidate = none
  2. FOR each candidate that appears on more than one item:
       advisory "duplicate AC id ac-N"; every item carrying it gets candidate = none
  3. IF some items have candidates and some do not:
       advisory "mixed authored and positional AC ids"
  4. local_ac_id = candidate, or "done:<n>" when none
  5. IF --issue given: ac_id = qualifyAcId(issue, local_ac_id)
```

Advisories go to stderr and never change the exit code, the same way the existing `holdout:` DONE advisory works. The literal `holdout:` rule is unchanged and runs on the text after the id is removed.

**Chosen:** mixed and duplicate cases fall back to positional ids with an advisory instead of being refused. Rationale:

- `dod classify` is also the evaluator's input, and a style defect must never block it.
- Ids stay unique by construction, and the writer's duplicate refusal remains as a backstop.
- The spec-review QA check catches the defect during prep.

**Chosen:** AC ids apply to DONE items only. Rationale: graft's per-AC loop and the merge floor's `criteria` both work on DONE items. `## Scenarios` units keep FAFF-1259's ids for the holdout path.

### graft Step 8 changes (prose)

- Take the AC list from `faff dod classify --spec <spec> --issue <ISSUE> --json`, using the DONE criteria in order.
- Build each criterion as `{ ac: text, verified, passed, ac_id, verifications }`, with one `verifications` entry per method actually used.
- Pipe it to `faff evidence write ac-checklist` as today. Then run `faff evidence render ac-checklist` and place its output in the PR body unchanged.
- Remove the hand-written `AC 1` template and show the rendered form instead.
- State that a `command` locator names secrets by environment variable, never by value.

**Chosen:** when the writer refuses, the PR body's `## Acceptance Criteria` section carries a one-line note that the checklist was refused and why, with no hand-written list. Rationale: this extends the existing "never hand-write a fallback" rule to the PR body. The merge gate already fails closed when the anchor is missing, so no new park path is needed.

### Edge cases

- **Zero-AC issue.** `criteria` stays omitted. The renderer prints the heading and `No acceptance criteria.`
- **An older anchor without `ac_id` or `verifications`, or with them set to `null`.** It validates. The renderer prints each line with no id and no method lines.
- **AC text or a locator that contains an uppercase tracker id**, for example "matches FAFF-1259" or a command with `--issue FAFF-1287`. The sanitizer rewrites the token in the PR body but not in the JSON. This already happens for AC text today. Byte identity is promised for qualified AC ids only, not for AC text, `verified` text or locators.
- **Positional fallback ids** such as `faff-1287#done:3`. They are valid, and their form shows they are unstable. FAFF-1288 may warn on them.
- **A spec revised after graft starts.** Ids already in tests stay valid as long as producers followed the stability rule. FAFF-1288's cross-check is where drift would show up.

### Failure modes

- **Another pass rewrites the id.**
  - The failure: the sanitizer later becomes case-insensitive, or another hygiene pass lowercases or rewrites the token.
  - How you'd know: the round-trip test in DONE fails (render, sanitize, compare with the JSON).
  - What it means: proceed. The test pins the invariant.
- **A PR's base predates this change.**
  - The failure: a PR branched before this lands carries the new keys, but its base schema is the old closed one.
  - How you'd know: the FAFF-1278 base-commit leg reports an additional-property violation on `ac_id`.
  - What it means: rebase onto a base that has the new schema. No design change.
- **Producers don't author ids reliably.**
  - The failure: most new anchors end up with positional ids.
  - How you'd know: across new anchors, `#done:` ids stay common compared with `#ac-` ids after release.
  - What it means: narrow the approach. Promote the spec-review check to a blocking objection, or add the mechanical drift check.

**Anti-pattern:** comparing ids after normalising case or hyphen characters. Why: it hides exactly the drift this ticket exists to prevent.

**Anti-pattern:** graft composing the `## Acceptance Criteria` list itself, even "from the same data". Why: two renderers drift apart. The renderer command is the single source.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec whose DONE section has "- [ ] [ac-2] The command exits 0" and "- [ ] [ac-5] Output is JSON"
When graft writes the ac-checklist for FAFF-1287 and renders it, and Step 9b sanitizes the PR body with target FAFF-1287
Then the PR body contains "faff-1287#ac-2" and "faff-1287#ac-5" byte for byte, and ac-checklist.json criteria[].ac_id are exactly those two strings in that order
```

```
Given an ac-checklist.json written before this change, with only ac, verified and passed per criterion
When it is validated against the updated v0.3 schema and read by readAcComplete
Then validation reports no violations and readAcComplete returns the same result as before
```

- `classifySchemaChange` MUST class the updated `ac-checklist.schema.json` as additive against the base-commit schema.
- The shipped `.js` MUST run on Node 20 with no runtime dependency.

## 5. DESIGN DECISION RATIONALE

- **Which grammar should the qualified id use?**
  - Options: uppercase with hyphens (rewritten by the sanitizer); uppercase with underscores or dots (survives, but hides the ticket key from search); lowercase with hyphens (survives and stays searchable); or exempt the pattern in the sanitizer (weakens a hygiene rule).
  - **Chosen:** lowercase `faff-1287#ac-3`, for byte identity without touching the sanitizer. At the time of writing, `TOKEN_RE_G` in `pr-body.js` has no case-insensitive flag.
- **How is a local id written in a spec?**
  - Options: a leading `[ac-N]`, a trailing tag, or a separate table.
  - **Chosen:** a leading lowercase `[ac-N]` after the checkbox, so the bytes in the spec equal the id's local part.
- **How does a `command` locator handle secrets?**
  - **Chosen:** secrets are named by environment variable, never by value; redaction is the backstop.
- **What happens with ids that are missing, mixed, malformed or duplicated?**
  - Options: refuse, or fall back.
  - **Chosen:** each affected item falls back to FAFF-1259's positional `done:N`, with an advisory, so `dod classify` never blocks.
- **Which criteria get AC ids?**
  - Options: DONE only, or DONE and Scenarios.
  - **Chosen:** DONE only, which is what graft and the merge floor treat as ACs.
- **Bump `schema_version` or extend v0.3?**
  - **Chosen:** extend in place with optional keys. A bump is non-additive under FAFF-1278.
- **Absent key or `null` for an unknown value?**
  - **Chosen:** the writer emits `null`, following v0.3's fixed-key-set note.
- **One method per AC or many?**
  - Options: a single object, repeated criteria, or a list.
  - **Chosen:** a `verifications` list on each criterion.
- **What locator format?**
  - Options: file plus line, or file plus test title.
  - **Chosen:** `file::test title`. Commands use the exact command string, and `human` has no locator.
- **Where do the per-kind rules live?**
  - Options: schema conditionals, or the writer.
  - **Chosen:** the writer, because the validator's keyword subset can't express them additively.
- **Where does the id code live?**
  - Options: inline in two files, or a shared module.
  - **Chosen:** the new `ac-id.js`, in the governance region, in plain JS.
- **How is the PR-body list produced?**
  - Options: graft prose, a renderer fed the input JSON, or a renderer that reads the written anchor.
  - **Chosen:** a renderer that reads the written anchor.
- **What does the PR body show when the writer refuses?**
  - **Chosen:** a one-line refusal note, never a hand-written list.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. The grammar choice departs from the ticket's uppercase sketch (`FAFF-1234#AC-3`, `[AC-3]`) for the sanitizer reason given above. The owner can override it at the review gate.

**Assumptions:** none. These were checked in the code: the base-commit additivity rule, the sanitizer regex, the validator's keyword subset and how the writer handles keys.

## 7. DONE

### From WHY

- [ ] [ac-1] For one rendered and sanitized PR body and its `ac-checklist.json`, every `criteria[].ac_id` string appears byte for byte, in the same order, in the PR body's `## Acceptance Criteria` block. A test runs the renderer, then `sanitizePrBody` with the issue as target, then compares.

### From WHAT (id grammar and helper)

- [ ] [ac-2] `ac-id.js` exists, requires no local module or package, and carries a governance region banner. `faff regions check` passes.
- [ ] [ac-3] `qualifyAcId("FAFF-1287", "ac-3")` returns `faff-1287#ac-3`, and `qualifyAcId("FAFF-1287", "done:2")` returns `faff-1287#done:2`. An issue that doesn't match `[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*` throws. A test asserts that the helper's issue grammar has the same source as `TARGET_RE` in `pr-body.js`.
- [ ] [ac-4] `parseAcId` returns `{ ticket: "FAFF-1287", local: "ac-3" }` for `faff-1287#ac-3`. It rejects `FAFF-1287#AC-3`, `faff-1287#ac-03` and `faff-1287#ac-3 ` (with a trailing space).
- [ ] [ac-5] `sanitizePrBody` leaves `faff-1287#ac-3` and `faff-1287#done:3` unchanged, both inside and outside code spans. A test pins this.

### From WHAT (schema)

- [ ] [ac-6] Both copies of `ac-checklist.schema.json` gain two keys under `criteria.items.properties`: `ac_id` (string or null, with the qualified-id pattern) and `verifications` (list or null, `minItems` 1; each item is closed, requires `kind` with enum `test|command|human`, and allows a string `locator`). Neither key is in `required`, the `schema_version` enum stays `[1]`, and the two copies stay byte-identical.
- [ ] [ac-7] `classifySchemaChange(old ac-checklist schema, new schema)` returns `additive: true`, and `anchor-manifest.json` is unchanged.
- [ ] [ac-8] The existing `ac-checklist.example.json`, which has no new keys, still validates. A new example carrying `ac_id` plus one `test`, one `command` and one `human` method validates. The invalid example still fails.

### From WHAT (writer)

- [ ] [ac-9] `faff evidence write ac-checklist` keeps `ac_id` and `verifications` and emits both on every criterion, as `null` when the input omits them.
- [ ] [ac-10] The writer refuses each of these with exit 1 and writes nothing: some `ac_id` values strings and others null; a duplicate `ac_id`; an `ac_id` whose ticket differs from `--issue`; a `test` method with no `::`, an absolute path, a `..` segment or an empty title; a `command` method with an empty or multi-line locator; a `human` method with a locator; an `ac` or `verified` value containing CR or LF. No refusal message contains the locator value.

### From WHAT (renderer)

- [ ] [ac-11] `faff evidence render ac-checklist --run-dir <dir> --issue <id>` prints the Appendix A block for a valid anchor and exits 0. For a missing anchor, one that fails its schema, or one that breaks a writer rule (for example a `human` method with a locator, or a multi-line `verified`), it prints nothing and exits 1. On a usage or path-guard fault, it exits 2.
- [ ] [ac-12] For an anchor with zero ACs, the renderer prints the heading plus `No acceptance criteria.` For an older anchor without the new keys, it prints lines with no id and no method lines.

### From HOW (dod classify)

- [ ] [ac-13] `faff dod classify` adds `local_ac_id` to every DONE criterion, and adds `ac_id` when `--issue` is passed. `text` has the leading `[ac-N] ` removed. Against the current selftest fixtures, `id`, `class`, `holdout`, the counts and every Scenarios criterion are unchanged.
- [ ] [ac-14] An uppercase `[AC-2]`, a leading-zero `[ac-03]`, a malformed `[ac-2x]`, a duplicated `[ac-2]`, and a mix of items with and without authored ids each print the stated stderr advisory, fall back to `done:N` for the affected items and exit 0.

### From HOW (skills and docs)

- [ ] [ac-15] Step 8 of `faff-graft/SKILL.md` takes ACs from `faff dod classify --issue`, builds `ac_id` and `verifications`, writes the anchor, then renders the PR-body block with `faff evidence render ac-checklist`. The hand-written `AC 1` template is gone. When the writer refuses, the PR body gets the one-line note and no hand-written list. Step 8 states that a `command` locator names secrets by environment variable.
- [ ] [ac-18] `faff validate-adapters` passes for every edited `SKILL.md`.
- [ ] [ac-19] `docs/guide/cli.md` describes the new writer keys, the `render` action and the `--issue` flag on `dod classify`. Both copies of `evidence-documents.md` describe `ac_id` and `verifications`. The v0.3 README notes that this slice extended v0.3 in place.

Ids `ac-16` and `ac-17` moved to FAFF-1289 at spec review and are not reused.

### From HOW (compatibility)

- [ ] [ac-20] `readAcComplete` and the governance-check `merge_floor` leg return the same results for anchors with and without the new keys. The existing tests cover the old shape, plus one new fixture in the new shape.
- [ ] [ac-21] `faff evidence --selftest`, `faff admissible --selftest` and the full test suite pass on Node 20.

### Integration smoke test

```
1. Write a spec with DONE items "[ac-1] A" and "[ac-2] B".
2. faff dod classify --spec spec.md --issue FAFF-9 --json   -> ac_id faff-9#ac-1, faff-9#ac-2
3. Pipe { all_verified: true, criteria: [
     { ac: "A", verified: "passing", passed: true, ac_id: "faff-9#ac-1",
       verifications: [{ kind: "test", locator: "t/a.test.js::does A" }] },
     { ac: "B", verified: "exit 0", passed: true, ac_id: "faff-9#ac-2",
       verifications: [{ kind: "command", locator: "node bin/b --check" }] } ] }
   to faff evidence write ac-checklist --run-dir R --issue FAFF-9   -> exit 0
4. faff evidence render ac-checklist --run-dir R --issue FAFF-9 > block.md
5. sanitizePrBody(block.md, "FAFF-9") contains "faff-9#ac-1" and "faff-9#ac-2" byte for byte
6. readAcComplete(R, "FAFF-9") returns true
```

## Appendix A: rendered PR-body block

```
## Acceptance Criteria
- [x] `faff-1287#ac-3` The renderer prints the anchor's ids byte for byte
  Verified: passing
  Method: test `test/evidence-ac-render.test.mjs::renders ids byte for byte`
- [x] `faff-1287#ac-4` The writer refuses a duplicate id
  Verified: exit 1, nothing written
  Method: test `test/evidence-payload-writers.test.mjs::refuses duplicate ac_id`
  Method: command `faff evidence write ac-checklist --run-dir /tmp/r --issue "$ISSUE"`
- [ ] `faff-1287#ac-9` The layout reads well on a phone
  Verified: Needs human verification: visual inspection
  Method: human
```

- The checkbox is ticked exactly when `passed` is true.
- The id sits in a code span. For an anchor without ids, the span is omitted.
- There is one `Method:` line per `verifications` entry, in order, and none when the key is `null` or absent.
- `Verified:` prints the `verified` string unchanged.

## Already shipped against this surface

All of these are related and none is superseded. This spec extends each one in place.

| Ticket | What it shipped | Relation |
|---|---|---|
| FAFF-1147 | ac-checklist records each criterion's `ac` and `verified` alongside `all_verified` | Related: this spec adds `ac_id` and `verifications` to the same entries |
| FAFF-1256 | v0.3 evidence schemas, manifest and validator extensions | Related: the schema extended here, under v0.3's in-place draft policy |
| FAFF-1259 | Positional `done:N` and `scenarios:N` ids in `dod classify`, used by the holdout | Related: those ids become the fallback; holdout records are unchanged |
| FAFF-1277 | Graft's ac-checklist and review-verdict written in the v0.3 shape by `faff evidence write` | Related: the writer gains two keys and a sibling `render` action |
| FAFF-1268 | (Todo, not shipped) Round recording and review-verdict collation in `evidence.js` and graft Step 9 | Related, in flight: it edits the writer module and the graft step next to Step 8. Sequence the two builds; do not run them in parallel. |
| FAFF-1278 | Base-commit governance-check leg that accepts only additive schema changes on the head side | Related: the schema change is shaped to pass it |

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** The first draft was too big (21 ACs). It was split at spec review: this ticket keeps the code and evidence change, and FAFF-1289 takes the authoring rule and the spec-review checks.
- **Workstream fit?** It fits FAFF-1255's audit outcome. FAFF-1255's description does not yet mention AC traceability, so it should be amended to say so.
- **Deps surfaced?** FAFF-1263 is Done. FAFF-1268 (Todo) edits `evidence.js` and graft Step 9, and is now linked as related. Run those two builds one after the other.
- **Risk profile?** The riskiest assumption is schema additivity. ac-6 and ac-7 are built first.

## Revision notes

Revised on 2026-10-15 after spec review round 1 (architectural, infosec, methodology and QA lenses). The verdict was reject-approach, routed to re-slice. The product owner chose to split and fix in place, with no second round.

- **methodology major:** split. The authoring rule, the labelling-scheme exception and the spec-review checks (formerly ac-16 and ac-17) moved to FAFF-1289. Those ids are retired, not reused.
- **infosec major:** the writer now refuses CR or LF in `ac` and `verified`, so the rendered block cannot gain forged checklist or `Method:` lines (ac-10).
- **architectural minor:** the renderer runs the writer rules as well as the schema (ac-11).
- **infosec minor:** `command` locators name secrets by environment variable, never by value.
- **methodology minors:**
  - The build order puts ac-6 and ac-7 first.
  - FAFF-1268 is linked and sequenced.
- **QA minors:**
  - The byte-identity promise covers qualified ids only, not locators.
  - The near-miss trigger is defined as `^\[ac-[^\]]*\]` case-insensitive, and ac-14 adds `[ac-03]` and `[ac-2x]`.
- **Gaps noted by the reviewer:** the L4 QA refuter and the noon-spec producer instruction are in FAFF-1289's scope.

confidence: high
build-tier: complex
spec-review: human-accept (interactive, round 1, split)
