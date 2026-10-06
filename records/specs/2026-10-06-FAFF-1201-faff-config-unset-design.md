# FAFF-1201: `faff config unset` removes a config key or subtree through the CLI

> Spec: faffter-dark-nlspec · 2026-10-06 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1201.

This spec is for the build agent implementing FAFF-1201 and for the humans reviewing it. It adds `faff config unset <dotted.key> [--local] [--dry-run]`, the removal counterpart to `faff config set`, so retiring a config tree (FAFF-1198's `models:` / `effort:` removal, or a block move like PR #1006's eval block) never needs a hand-edit. FAFF-1198 is blocked on this ticket.

## 1. WHY

**The idea the rest turns on.** `unset` finds the key's span in the raw file text (the key line plus every following line indented deeper than it), deletes that span, deletes any parent map the removal left empty, and then proves the edit by parsing the file before and after: the new parse must equal the old parse with exactly that key (and the emptied parents) gone. If the proof fails, nothing is written. The reader drops comments and blank lines, so the proof covers only damage the parser can see; keeping comments and every other byte outside the removed span in place is guarded by exact-text fixtures in the selftest and tests.

**Problem.** `faff config set` writes scalar leaves only, and the CLI-only config rule (`plugin/skills/faff/references/kernel.md:62`) forbids any skill or agent hand-editing `.faffrc.yaml` or `.faffrc.local.yaml`. So nothing can remove a key: the eval-block move in PR #1006 needed a manual edit, and FAFF-1198 would too. Removal belongs in the CLI so an unattended build and an adopter can both do it (human decision, 2026-10-06: split out of FAFF-1198 as its own blocking ticket; the CLI-only rule stands, with no new hand-edit carve-out).

### Design principles

**Surgical, never wholesale.** The edit removes lines; it never re-emits the file from a parse. The YAML reader drops comments, so any rewrite from the parse would lose them.

**Prove before writing.** The whole-file round-trip check is the safety net for every span-finding bug the parser can see (a lost or altered key or value). A mismatch exits 2 with no write, exactly as `config set` does for its single-key check. Comment and blank-line damage is invisible to the parser, so exact-text fixtures guard it instead.

**Works on retired trees.** `unset` runs no removed-key or moved-key check and no namespace allowlist, so `faff config unset models` keeps working after FAFF-1198 makes `models.*` fail loud on `get` and `set`, and after it removes `models` and `effort` from `WRITABLE_NAMESPACES` if it does.

**Touch one file.** Without `--local` only the base changes; with `--local` only the overlay changes.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` `cmdConfigSet` (:1753-1826) | JavaScript | The guard order, target selection, round-trip check, `--dry-run` and write that `unset` mirrors |
| `config.js` `mergeConfigPath` (:1652-1751) | JavaScript | The segment-by-segment descent and body rule (deeper indent or blank) the new span finder reuses in shape |
| `config.js` `isSequenceValuedKey` and `SEQUENCE_VALUED_KEYS` (:1550-1578) | JavaScript | The by-name list refusal `unset` applies unchanged |
| `config.js` `CONFIG_SURFACE.subcommands` (:33-48), dispatch chain (:3065) | JavaScript | Where the `unset` verb registers and dispatches |
| `config.js` `configSetSelftest` (:1830-1968) | JavaScript | The selftest shape (`check`, `ok`/`FAIL`, `RESULT:` line) the new selftest copies |
| `plugin/skills/faff/bin/lib/shared-infra.js` `parseYamlSubset` (:358), `scalar` (:340), `dig` (:476) | JavaScript | The real reader used for the round-trip and for shape checks |
| `test/config-set.test.mjs` | JavaScript (`node:test`) | Test helpers and fixture style the new test file copies |
| `docs/guide/cli.md:31`, `kernel.md:62` | Markdown | The doc row and the CLI-only config rule that must name the new verb |

**Scope.** One new sub-verb of `faff config` in `config.js`, its tests, and two doc touches.

## 2. OUT OF SCOPE

- **A `docs/guide/cli.md` row for `config set`.** Why: a pre-existing gap, not this verb; `lint-cli-doc` already passes because it keys on the first token (`config`). Extension point: the `## Config & install health` table in `docs/guide/cli.md`, beside the `config init` row.
- **Refactoring `mergeConfigPath` to share the new span finder.** Why: an opportunistic refactor of a working writer; the two can converge later. Extension point: `mergeConfigPath`'s descent loop (:1665-1707).
- **Removing items from inside a list, or removing a list-valued key on its own.** Why: the existing carve-out keeps list-valued keys a committed-base hand-edit; this ticket keeps that rule. Extension point: `isSequenceValuedKey`.
- **Deleting a config file that `unset` empties.** Why: file lifecycle and the git posture of the base belong to `config init` and `config check`. Extension point: `cmdConfigCheck`.
- **Atomic temp-file-and-rename writes.** Why: `config set` and `config init` use a plain write; changing one writer alone would be inconsistent. Extension point: a shared write helper in `config.js` used by all three verbs.
- **The removed-key check and the `models:` / `effort:` retirement.** Why: FAFF-1198 owns both. Extension point: `movedKeyError` and its callers in `get` and `set`.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Target file | `.faffrc.yaml` (the base), or `.faffrc.local.yaml` (the overlay) with `--local` |
| Span | The key's own line plus the run of following lines that are blank or indented deeper than the key, with trailing blank lines trimmed back out |
| Prune | Removing an ancestor map whose body has no key lines left after the removal (only blank or comment lines, or nothing) |

### CLI surface

```
faff config unset <dotted.key> [--local] [--dry-run] [--root DIR]
faff config unset --selftest
```

| Outcome | Exit | Stream and text |
|---|---|---|
| Removed | 0 | stdout `config unset: removed <key> from <target>.`, plus ` Pruned empty <a.b>, <a>.` when parents were pruned |
| `--dry-run` | 0 | stdout: the would-be file text (newline-terminated); no write |
| Missing or extra positional, or an empty segment (`a..b`, trailing dot) | 2 | stderr `faff config unset: requires exactly one <dotted.key>` |
| List-valued by name or by shape | 2 | stderr `faff config unset: '<key>' is a list-valued key; hand-edit the committed base (config unset removes maps and scalars only)` |
| An ancestor holds an inline flow map (`a: {"b": 1}`) containing the path | 2 | stderr `faff config unset: '<ancestor>' is an inline map; unset '<ancestor>' instead` |
| Round-trip mismatch | 2 | stderr `faff config unset: internal error, edited text does not round-trip (<detail>); aborting to avoid a corrupt config.` `<detail>` names key paths only, never values. |
| Legacy filename | 2 | Same as `config set` (the `findConfig` / `findOverlay` throw reaches `cmdConfig`'s catch) |
| Target file missing | 3 | stderr `faff config unset: no <target> in <root>; nothing to unset`; no file created |
| Key absent | 3 | stderr `faff config unset: '<key>' is not set in <target>`; means "already gone", so a caller such as FAFF-1198's migration may treat it as success |

`--force` is accepted by the shared `CONFIG_SPEC` gate and ignored by `unset`. `CONFIG_SPEC` needs no change; `CONFIG_SURFACE.subcommands` gains `unset: { required_flags: [] }`, which updates both usage strings through `configVerbList()`.

### Pure helper

```
FUNCTION removeConfigPath(rawText, segments) -> RESULT
RECORD RESULT:
  status: "removed" | "absent" | "list" | "inline-ancestor"
  text: String          # edited text when removed, else rawText unchanged
  pruned: List<String>  # dotted paths of pruned ancestors, deepest first
  ancestor: String?     # set for "inline-ancestor"
```

`removeConfigPath` is pure (no I/O) so the selftest can drive it in memory, like `mergeConfigPath`. **Chosen:** a new helper beside `mergeConfigPath`, leaving `mergeConfigPath` untouched.

### What counts as present

- A key line with no value (`key:`) or an explicit `key: null` / `key: ~` is present and is removed. **Chosen:** presence is textual, so a null leaf is removable (otherwise a stray `models:` header could never be cleared).
- An ancestor that holds a non-empty inline value which is not a map (`tracking: foo` when unsetting `tracking.provider`) makes the key absent: exit 3. **Chosen:** exit 3, not `config set`'s exit 2 "can't descend", because nothing at that path exists to remove.
- A missing target file exits 3 and creates nothing. **Chosen:** exit 3, matching `config get` and `config path` for "not there".

### List-valued keys

- **By name:** `isSequenceValuedKey(key)` refuses before the file is read, exactly as `config set` does. **Chosen:** reuse the predicate unchanged.
- **By shape:** judged on the raw text, never on what `scalar()` returns. A target whose trimmed inline value (inline comment stripped) starts with `[` and ends with `]` is refused, in both the bare-word form (`key: [a, b]`, which `scalar()` reads as a plain string) and the JSON form (`key: ["a","b"]`). So is a target whose first non-blank, non-comment child line is a sequence item (`- …`). **Chosen:** refuse, so the carve-out covers lists at any path, not only the named ones.
- **A map subtree that contains a list** (`unset adversarial` when `adversarial.refs` exists) is removed whole. **Chosen:** allow. The `config set` refusal exists because a scalar write would flatten a list; removing the enclosing map flattens nothing, and refusing it would block retiring any namespace that holds a list.
- **An inline flow map leaf** (`infra: {"a": 1}`) is removed like a scalar line. **Chosen:** allow; it is a map, not a list.

### Namespace and removed-key checks

- **Chosen:** no `WRITABLE_NAMESPACES` or `RECOGNISED_NAMESPACES` check. FAFF-1198 drops `models` and `effort` from the writable set, so a namespace guard would block the exact removal this ticket exists for. A typo exits 3 with the target named, which is enough.
- **Chosen:** no `movedKeyError` or removed-key call (ticket requirement).

## 4. HOW

### Command flow

`cmdConfigUnset` mirrors `cmdConfigSet`'s order: argument checks, by-name refusal, target lookup, pure edit, round-trip proof, then dry-run or write.

```
PROCEDURE cmdConfigUnset(args, root):
  1. local = "--local" in args; dryRun = "--dry-run" in args
  2. positionals = args not starting with "--"   # `--root DIR` is already stripped by cmdConfig, as for config set
     IF count != 1 OR any segment of positionals[0].split(".") is "": stderr usage, return 2
  3. key = positionals[0]; segments = key.split(".")
  4. IF isSequenceValuedKey(key): stderr list refusal, return 2
  5. targetName = local ? CANONICAL_OVERLAY_CONFIG : CANONICAL_CONFIG
     existingPath = local ? findOverlay(root) : findConfig(root)    # a throw propagates, as in set
     IF existingPath is null: stderr "no <targetName>", return 3
  6. rawText = read existingPath
     r = removeConfigPath(rawText, segments)
     "absent" -> return 3; "list" -> return 2; "inline-ancestor" -> return 2 (messages per the table)
  7. Round-trip proof (below); on failure stderr internal error, return 2
  8. IF dryRun: print r.text (add "\n" if missing), return 0
  9. write r.text to path.join(root, targetName)
  10. print the removed line (with pruned paths)
  11. Other-file note (below)
  12. return 0
```

Step 9 writes the canonical path, matching `config set` (:1823).

### Finding and removing the span

The descent uses `mergeConfigPath`'s rules: skip blank and comment lines, match a key only at the window's expected indent, and narrow the window to the matched key's body (lines that are blank or deeper than the key). `keyOf` strips inline comments first.

```
PROCEDURE removeConfigPath(rawText, segments):
  1. lines = rawText.split("\n"); ancestors = []
  2. FOR each segment except the last:
     a. find the segment's line in the window (first match)
     b. not found -> return absent
     c. IF the line has a non-empty inline value:
          IF scalar(value) is a map containing the rest of the path -> return inline-ancestor
          ELSE -> return absent   # includes a map holding only part of the path: a: {"b": 1}, unset a.b.c
     d. push {lineIndex, indent}; narrow the window to its body; expected indent = first deeper child's indent
  3. find the leaf's line in the window; not found -> return absent
  4. IF the leaf's trimmed raw inline value starts with "[" and ends with "]",
     OR the leaf's inline value is empty and the first non-blank, non-comment
     deeper line is a sequence item -> return list      # raw text, not scalar()
  5. spanOf(leaf) = [leafIndex, end) where end extends over lines that are blank
     or indented deeper than the leaf; then pull end back over trailing blank lines
  6. removeSpan(span)
  7. FOR each ancestor, deepest first:
       IF its body has no non-blank, non-comment lines: removeSpan(spanOf(ancestor)); record pruned
       ELSE stop
  8. return removed, joined text, pruned
```

`removeConfigPath` splits the text with the final newline set aside (record whether `rawText` ends in `\n`, strip it, split, and restore it on join), so the empty string after a trailing newline is never mistaken for a blank line. `removeSpan` deletes the span's lines, then tidies the separators around it:

- **Middle of the file:** when the line just before the span is blank (or the span starts the file) and the line just after it is blank, it also deletes that following blank line.
- **End of the file:** when nothing follows the span, it also deletes the blank lines immediately before it, so the file does not end in blank lines.
- If the result is empty, the text is empty with no newline.

**Chosen:** span edges as follows.

| Case | Treatment |
|---|---|
| The key's own inline comment (`models: # lanes`) | Removed with the key line |
| Comment lines indented deeper than the key, anywhere in the span | Removed (they belong to the subtree) |
| Comment lines at or above the key's indent directly above it | Kept (they may head a section or a sibling) |
| A comment at the key's indent just after the span | Kept; it ends the span |
| Trailing blank lines inside the body | Trimmed out of the span, so the separator to the next key survives |
| Blank line on both sides after removal | One is removed, so no double blank appears |
| A parent left holding only comments | Pruned, comments included |
| Block scalar values (`key: \|`) | Their deeper lines are in the span |
| Duplicate keys in one window | First match is removed; the reader keeps the last, so the round-trip fails and nothing is written. The file is already misread by every consumer; the remedy is to repair the duplicate (or regenerate with `faff config init`), named in the error |
| The removal empties the file | The emptied text is written; the file is not deleted |

**Anti-pattern:** treating detached comments above the key as part of it. Why: they often describe a section or the next key, and the ticket requires the rest of the file to stay byte-identical.

### Round-trip proof

```
PROCEDURE verifyUnset(rawText, newText, segments):
  1. before = parseYamlSubset(rawText); after = parseYamlSubset(newText)
  2. expected = deep copy of before
     delete expected at segments
     FOR each ancestor of segments, deepest first: IF the ancestor object is now empty, delete it; ELSE stop
  3. require isDeepStrictEqual(after, expected)   # node:util
```

**Chosen:** whole-parse equality, stronger than `config set`'s single-key check, because a subtree removal can damage siblings and only a whole comparison catches that. It cannot see comment or blank-line damage, which the exact-text fixtures cover. The pruning rule here must match the text pruning in `removeConfigPath`; a disagreement fails loud.

### Other-file note

After a successful write, if the other file (the overlay when the base was edited, the base when `--local` was used) still defines the key, print to stderr: `note: <key> is still set in <other file>; faff config get reads the merged value.` Exit stays 0.

- **Chosen:** emit the note. After `faff config unset models`, a stale overlay `models:` keeps winning at read time; FAFF-1198's migration needs to see that.
- Lookup is best-effort: if finding or parsing the other file throws, the note is skipped. It never changes the exit code or the target file.
- **Anti-pattern:** also unsetting the key in the other file. Why: "touch one file" is a design principle and the acceptance criteria require it.

### Write

**Chosen:** plain `fs.writeFileSync`, matching `config set` and `config init`. The round-trip proof runs before the write, so the risk left is a torn write, which atomic replacement would fix for all three writers together (see OUT OF SCOPE).

### Selftest

`configUnsetSelftest()` drives `removeConfigPath` and `verifyUnset` in memory with the same `check(label, cond)` / `RESULT: PASS (config unset, N failed)` shape as `configSetSelftest`. Every case that edits compares the edited text against an exact expected string, not only the parses, because the round-trip proof cannot see comment or blank-line damage. Cases: leaf removal, whole-block removal, pruning through two levels, comment-only parent pruning, detached comment above the key kept, deeper comment in the span removed, blank-separator collapse, trailing newline kept and absent, by-name list refusal, by-shape list refusal for a block sequence, a bare-word inline list (`[a, b]`) and a JSON inline list (`["a","b"]`), inline-ancestor refusal, partial-path inline map (exit 3), absent leaf, absent ancestor, scalar ancestor, null leaf removed, 4-space indented body, duplicate-key round-trip failure.

**Chosen:** reach it via `faff config unset --selftest`, asserted from the new test file, the same reach `config set --selftest` has today. `regions.js` keeps running only `config init --selftest`.

### Docs and the CLI-only rule

**Chosen:**

- Add a `docs/guide/cli.md` row after the `config init` row: `` `config unset <dotted.key> [--local] [--dry-run] [--root DIR]` ``, describing removal of a leaf or map subtree from one file, parent pruning, exit 3 for absent, the list refusal, and that it skips the removed-key check.
- Change the `config init` row's "the **only** sanctioned config *writer*" to name `config init`, `config set` and `config unset` as the sanctioned writers, since the current wording is already inaccurate and would become more so.
- Add one clause to `kernel.md:62`'s **No hand-writing** rule: `faff config unset <dotted.key> [--local]` removes a leaf or map subtree, refusing list-valued keys like `config set`.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given .faffrc.yaml:
    tracking:
      provider: linear

    # model lanes
    models:
      build: sonnet
      # legacy
      spec: opus

    appetite: small
When `faff config unset models` runs
Then it exits 0 and .faffrc.yaml is exactly:
    tracking:
      provider: linear

    # model lanes

    appetite: small
```

```
Given .faffrc.yaml with `effort:\n  build: high\n` and .faffrc.local.yaml with `effort:\n  build: low\nslots:\n  spec: x\n`
When `faff config unset effort --local` runs
Then it exits 0, .faffrc.local.yaml is `slots:\n  spec: x\n`, .faffrc.yaml is byte-identical,
And stderr notes that effort is still set in .faffrc.yaml
```

```
Given .faffrc.yaml:
    dispatch:
      spec:
        effort: low
When `faff config unset dispatch.spec.effort` runs
Then it exits 0, the file no longer contains `dispatch:` or `spec:`,
And stdout names the pruned parents dispatch.spec and dispatch
```

```
Given a repo with no .faffrc.local.yaml
When `faff config unset models --local` runs
Then it exits 3 and no .faffrc.local.yaml exists afterwards
```

```
Given .faffrc.yaml with `tracking:\n  teams:\n    - A\n    - B\n`
When `faff config unset tracking.teams` or `faff config unset slots.list` (where slots.list is `[1, 2]`) runs
Then each exits 2 with "list-valued key" and .faffrc.yaml is byte-identical
```

- `unset` never writes when the round-trip proof fails.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Edit helper | Refactor `mergeConfigPath` to share a span finder; new pure helper | **Chosen:** new `removeConfigPath`; refactor deferred |
| Null leaf (`key:`) | Treat as absent; treat as present | **Chosen:** present, removable |
| Scalar ancestor in the path | Exit 2 like `set`; exit 3 | **Chosen:** exit 3, nothing to remove |
| Missing target file | Create empty; exit 3 | **Chosen:** exit 3, nothing created |
| Named list keys | Allow removal; refuse | **Chosen:** refuse, per the ticket and the existing carve-out |
| Lists by shape at other paths | Allow; refuse | **Chosen:** refuse, for one consistent rule |
| Map subtree containing a list | Refuse; allow | **Chosen:** allow; nothing is flattened |
| Inline flow map leaf | Refuse like `set`; allow | **Chosen:** allow |
| Namespace allowlist | Apply `WRITABLE_NAMESPACES`; none | **Chosen:** none, so retired namespaces stay removable |
| Detached comments above the key | Remove; keep | **Chosen:** keep |
| Comment-only parent after removal | Keep; prune | **Chosen:** prune, comments included |
| Emptied file | Delete; keep | **Chosen:** keep |
| Round-trip strength | Key gone only; whole-parse equality | **Chosen:** whole-parse equality |
| Write mechanism | Temp file and rename; plain write | **Chosen:** plain write, matching `set` |
| Key still set in the other file | Silent; stderr note; edit both | **Chosen:** stderr note only |
| Selftest reach | Chain into `config init --selftest`; own flag tested from the test file | **Chosen:** own flag, as `config set` does |
| `config set` doc row | Add now; leave | **Chosen:** leave (OUT OF SCOPE), fix only the "only writer" wording |

**Map subtree containing a list.** Refusing it would mean `unset tracking` or `unset adversarial` always needs a hand-edit, which the human decision rules out. The `config set` refusal guards against value-shape loss on write; a whole-subtree removal has no such loss.

**Namespace allowlist.** At the time of writing `WRITABLE_NAMESPACES` (:1584) contains `models` and `effort`, and FAFF-1197's spec lists `WRITABLE_NAMESPACES` as an extension point for FAFF-1198's removal of those trees. A guard would therefore make `unset models` fail at the moment it is needed.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. The human closed the split from FAFF-1198 and the no-new-carve-out rule (2026-10-06); the codebase answers the rest.

**Assumptions:** none beyond the cited code.

## 8. DONE

### From WHY
- [ ] `faff config unset models` on a base holding a `models:` block exits 0 and removes it, producing the exact text in the first scenario.
- [ ] `faff config unset legacy_tree` removes a top-level `legacy_tree:` block (a namespace outside `WRITABLE_NAMESPACES`) with exit 0, showing no namespace guard applies; `cmdConfigUnset` does not call `movedKeyError`.

### From WHAT (surface)
- [ ] `CONFIG_SURFACE.subcommands` has `unset`; `faff config` and `faff config bogus` list `unset` in their verb lists.
- [ ] Bare `faff config unset`, two positionals, and `a..b` each exit 2 with the usage message.
- [ ] Missing target file exits 3 and creates no file (base and `--local`).
- [ ] Absent key, absent ancestor and scalar ancestor each exit 3 with the target file named; file byte-identical.
- [ ] `key:` and `key: null` leaves are removed with exit 0.
- [ ] `tracking.teams`, `adversarial.refs`, `adversarial.spec_review.refs`, `tracking.team_routing.x`, a bare-word inline list leaf (`k: [a, b]`), a JSON inline list leaf (`k: ["a","b"]`) and a block-sequence leaf at an unnamed path each exit 2 with "list-valued key"; file byte-identical.
- [ ] An inline flow map ancestor containing the path exits 2 naming the ancestor; an inline flow map leaf is removed.

### From HOW (editing)
- [ ] `unset dispatch.spec.effort` prunes `dispatch.spec` and `dispatch` and names both on stdout.
- [ ] A parent left with only comment lines is pruned with its comments.
- [ ] Detached comments directly above the removed key survive; deeper comments in the span are removed.
- [ ] No double blank line appears where a blank-separated block was removed; removing the last block leaves no trailing blank lines; trailing-newline state is preserved in both directions.
- [ ] A 4-space-indented body (FAFF-531 shape) unsets correctly.
- [ ] A duplicate-key fixture exits 2 with the internal-error message, naming key paths but no values, and no write.
- [ ] Every editing selftest case and test asserts the exact expected file text, not only the parsed result.
- [ ] An inline map ancestor holding only part of the path (`a: {"b": 1}`, unset `a.b.c`) exits 3.
- [ ] `--dry-run` prints the edited text, exits 0, and leaves the file byte-identical.
- [ ] `--local` edits only `.faffrc.local.yaml`; without it only `.faffrc.yaml` changes.
- [ ] The other-file note appears on stderr when the other file still defines the key, and not otherwise; exit code unaffected.

### From HOW (selftest and docs)
- [ ] `faff config unset --selftest` prints `RESULT: PASS` and exits 0, covering the case list in HOW, and `test/config-unset.test.mjs` asserts it.
- [ ] `docs/guide/cli.md` has the `config unset` row; the `config init` row no longer calls it the only writer; `faff lint-cli-doc` passes.
- [ ] `kernel.md:62` names `faff config unset` in the **No hand-writing** rule.
- [ ] `test/config-set.test.mjs` passes unchanged.

### Integration smoke test

```
1. In a temp repo write .faffrc.yaml:
     tracking:
       provider: linear

     models:
       build: sonnet

     dispatch:
       spec:
         effort: low
   and .faffrc.local.yaml:
     models:
       build: opus
2. faff config unset models --dry-run        -> exit 0, prints text without models:, file unchanged
3. faff config unset models                  -> exit 0, stderr note that models is still set in .faffrc.local.yaml
4. faff config unset models --local          -> exit 0, .faffrc.local.yaml now empty text, file still exists
5. faff config unset dispatch.spec.effort    -> exit 0, "Pruned empty dispatch.spec, dispatch."
6. faff config unset models                  -> exit 3
7. .faffrc.yaml is exactly "tracking:\n  provider: linear\n"
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** It fits the 1-3 day norm: one sub-verb, one pure helper, a selftest, a test file and two doc touches. The `complex` tier is justified by the edge-case table (comments, blank-line separators, pruning, block scalars, duplicate keys) more than by the volume of work. The spec turns away the work that would have made it bigger: no `mergeConfigPath` refactor, no atomic-write change, and no `config set` doc row. No issues.

**Workstream fit?** It fits. The ticket is the gating prerequisite for FAFF-1198, re-homed into the stream it gates ("Cost-aware model & transport routing"), so the dispatch consolidation can finish unattended. It also ships value on its own: any future block move like PR #1006's no longer needs a hand-edit, and adopters get a way to clear the legacy trees that FAFF-1198's error message points them to. No issues.

**Deps surfaced?** It blocks FAFF-1198, the link is in place, and nothing blocks this ticket. The two specs agree on the contract between them: no removed-key check, no namespace guard, `--local` support, and `faff config unset models` named in FAFF-1198's `legacy_tree_error`. The other-file note (step 3 of the smoke test) gives FAFF-1198's migration the stale-overlay signal it needs. Both tickets edit `kernel.md:62` and the `config` rows of `docs/guide/cli.md`, but they merge in sequence, so there is no conflict. This ticket's clause grows line 62 from 139 words to about 160, under `PARA_WORD_CAP` (200), and adds no lines, so FAFF-1198's kernel line count of 467 still holds. What to do: queue FAFF-1201 ahead of FAFF-1198 as the next pickup in the project.

**Risk profile?** Low to moderate, and well contained. The real risk is span-finding bugs in raw-text YAML editing. The whole-parse round-trip proof makes each of those a refused write, not a corrupted config, so the failure mode is loud and safe. Two things to watch:
- **Pruning must match in two places.** The text-side and parse-side pruning rules have to agree. The spec names this, and a disagreement fails loud.
- **The proof depends on the reader.** It is only as good as `parseYamlSubset`. A construct the reader drops (comments) is handled by design. A construct it misreads in the same way before and after would pass the proof unnoticed, but nothing in the current config shapes suggests one.

What to do: build `removeConfigPath` and its selftest cases first, including the duplicate-key and 4-space-indent fixtures, before wiring the command. No spike is needed.

confidence: high
build-tier: complex
spec-review: accept (human, after round 2)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```

