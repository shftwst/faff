# FAFF-667 — A sanctioned write path for the whole config schema, and a `config` usage string that tells the truth

> Spec: faffter-dark-nlspec · 2026-08-04 · autonomous · confidence: high. Full spec on Linear FAFF-667.
> Revised 2026-08-04 — spec-review (revise) applied: carve-out now enforced by key identity (see Revision 1).

This is the build spec for FAFF-667. Audience: the coding agent that will implement it, and the human reviewers gating that work. It fixes two defects in one command surface — `faff config` — and makes one delegated engineering decision the ticket authorises: how faff sanctions writing the config keys that actually change its behaviour.

## 1. WHY — Problem and Principles

**The load-bearing idea:** faff forbids hand-editing its config file and enforces that ban on the *read* side, but the only sanctioned *writer* covers 7 tracking keys out of the whole schema. So every behaviour key — `backends:`, `models:`, `effort:`, `slots:`, `appetite`, and the rest — has no legitimate way to be written at all. The rule ("`faff config init` is the only writer") forbids the one method that would otherwise work, for keys that method refuses. This spec adds a general writer so the rule can be obeyed, and fixes a usage string that advertises a verb the dispatcher never implemented.

**Problem statement.** The gateway states categorically that no skill or agent may hand-write the rc file and that `faff config init` is the only writer (`plugin/skills/faff/SKILL.md:129`), yet `config init` accepts only the 7 flat `tracking.*` leaves (`plugin/skills/faff/bin/lib/config.js:454`) and refuses everything else — so no behaviour key can be written by any sanctioned means. Separately, `faff config`'s usage strings advertise a `set` verb that does not exist and omit `dump`/`resolved`/`defaults`/`prd-docs-path` that do (`config.js:1206` and `config.js:1459`), so a reader who tries `faff config set backends.cx.provider codex` gets an error naming a different verb list. This spec gives every documented key a sanctioned write path (a new `set` verb, plus one explicitly-named hand-edit carve-out) and makes the usage strings agree with the dispatcher and stay agreeing.

**Design principles.**

**Writes stay surgical raw-text edits, never parse-then-reserialise.** The config reader (`parseYamlSubset`, `shared-infra.js:315`) is lossy — it has no matching emitter, and reserialising a parsed document would flatten nested maps and destroy the user's comments, ordering, and layout. The existing `mergeTrackingBlock` (`config.js:500`) avoids this by editing the raw file text in place and touching only the targeted lines. The new writer inherits that discipline exactly. This principle would cause rejection of any implementation that builds a general YAML serializer.

**A write must round-trip through the real reader before it is committed.** `config init` re-parses its own output and asserts each written key reads back to the intended value *before* the single `fs.writeFileSync` (`config.js:653-671`), aborting on any mismatch. The new writer does the same: a wrong-indent bug in the new nested-path logic must fail loud (exit 2, no write), never persist a corrupt file. This is the primary containment for the new code's main risk.

**Write-time validation reuses the read-time validators — it does not invent new ones.** The closed-vocabulary validators (`validateModelLane`, `validateEffortLane`, `config.js:167`/`321`) are already pure and exported and run at `config get`. The new writer runs the *same* validator a `config get` of that key would run, so a value that fails loud at read is refused at write rather than persisted. No new vocabulary is introduced.

**The no-hand-*reading* rule is untouched.** It is enforced (`validate-adapters` fails any skill that shell-reads the rc file), it works, and it exists for a recorded reason. Nothing here changes it.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` | Node.js (no deps) | The whole `config` surface: dispatcher (`cmdConfig`, line 1202), the tracking writer (`cmdConfigInit`/`mergeTrackingBlock`, 588/500), `emitScalar` (469), `CONFIG_SURFACE` (24) |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node.js | `parseYamlSubset` reader + `dig`/`scalar`/`stripInlineComment` helpers the writer round-trips against |
| `plugin/skills/faff/bin/lib/backends.js` | Node.js | `mergeBackendsNamespace`/`validateEngineRef` — reads the `backends:` map the FAFF-665 end-to-end case must reach |
| `plugin/skills/faff/bin/lib/cli-surface.js` | Node.js | Consumes `CONFIG_SURFACE.subcommands` (line 41) — the surface registry a new verb must join |
| `plugin/skills/faff/SKILL.md` | Markdown (gateway) | Holds the "No hand-writing" rule (line 129) this spec amends; does not document `backends:` at all |
| `.faffrc.example.yaml` | YAML | The documented schema (single source with the gateway); the drift test parses its top-level keys |

**Scope.** This sits entirely inside the `config` CLI surface and its gateway documentation — it adds a writer verb and reconciles usage strings; it does not touch config resolution, the reader, or any consumer of resolved config.

## 2. OUT OF SCOPE

- **FAFF-689** — a related near-duplicate subset, surfaced separately by the orchestrator. **Why excluded:** the orchestrator is tracking it independently; folding it in here would double-scope. Note the general writer this spec chooses subsumes most of FAFF-689 (all its scalar leaves — `models.*`/`effort.*`/`slots.*`/`appetite` — become writable once `set` ships); its residue is the array-valued carve-out. **Extension point:** its own ticket, boundary restated to the carve-out.
- **Changing the no-hand-*reading* rule.** **Why excluded:** it is enforced, works, and exists for a recorded reason (the ticket forbids touching it). **Extension point:** none — deliberately fixed.
- **Widening `config init`'s allowlist.** **Why excluded:** `init` is the tracking-bootstrap verb (create-from-scratch, the onboarding and decline-stub paths at `SKILL.md:79`); the general writer is a distinct concern and belongs in its own verb. **Extension point:** `cmdConfigInit`/`TRACKING_KEYS` stay as-is; new keys go through `set`.
- **Writing sequence-valued (list) keys** — `faffter_dark.adversarial.refs`, `.fallbacks`, `.backends`, and any array-valued key. **Why excluded:** a `key value` grammar writes one scalar leaf; a block sequence of maps cannot be expressed that way, and a surgical line-editor for arrays-of-maps is disproportionate here. These are the explicit hand-edit carve-out (§3, §6). **Extension point:** a future `faff config set-list KEY --json '[…]'` verb, or the committed-base hand-edit the gateway will point to.
- **Multiple key=value pairs in one `set` invocation.** **Why excluded:** one pair per call keeps the surgical writer's failure semantics simple; a caller loops. **Extension point:** `cmdConfigSet` could accept repeated positional pairs later without changing the writer.
- **Unsetting / deleting a key (`config unset`).** **Why excluded:** not requested; removal has its own conflict semantics. **Extension point:** a sibling verb on the same writer.
- **New closed-vocabulary validators for keys that lack one today** (e.g. an `appetite`/`logging`/`gates.fallback` enum check on write). **Why excluded:** the principle is *reuse* read-time validators; today those keys write unvalidated (as `tracking.*` does), so `set` matches read behaviour exactly. **Extension point:** add a validator wired into both `config get` and the shared write-validation helper.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Scalar leaf | A config key whose value is a single scalar (string / number / bool), at any nesting depth — e.g. `appetite`, `adr.mode`, `backends.cx.provider`. The full surface `set` writes. |
| Sequence-valued key | A key whose value is a list-or-map-shaped config value, e.g. `faffter_dark.adversarial.refs` / `.fallbacks` / `.backends`. Not writable by `set` — the named carve-out. **Enforced by key identity** (a denylist of these dotted keys, §3 carve-out enforcement), because the JSON-string form (`fallbacks: '[{…}]'`) and inline-flow form (`refs: [a, b]`) read back as a plain scalar and no value-shape check can tell them from a legitimate string. |
| Writable namespace | A recognised top-level config key. `set` refuses a dotted key whose first segment is not one of these (cheap typo guard at the root). |
| Surgical merge | A raw-text edit that changes only the targeted line(s), preserving every other byte. Existing precedent: `mergeTrackingBlock`. |

**The new verb.**

```
faff config set <dotted.key> <value> [--force] [--dry-run] [--root DIR]
```

- `<dotted.key>` — a dotted path of one or more segments (`appetite`, `models.build`, `backends.cx.provider`). Its first segment must be a writable namespace.
- `<value>` — the scalar value, written verbatim (quoted as needed by `emitScalar` so it round-trips). Empty value is allowed (parity with `init`).
- `--force` — overwrite a differing existing value (drops that line's inline comment, mirroring `mergeTrackingBlock`). Without it, a conflict refuses (exit 2).
- `--dry-run` — print the would-be file text to stdout, write nothing (parity with `init`).
- `--root DIR` — resolve/create the config file under DIR (already in `CONFIG_SPEC`).

The gate grammar already admits this: `CONFIG_SPEC.positionals` is `min:0, max:null` and `--force`/`--dry-run`/`--root` already exist (`config.js:17-20`) — no flag-spec change is needed. The verb is added to `CONFIG_SURFACE.subcommands` (`config.js:27`) so the surface registry (`cli-surface.js:41`) and the derived usage strings stay complete.

**Writable-namespace guard.**

```
RECORD WritableNamespaces:
  # The recognised top-level config keys. A `set` key whose first segment
  # is absent here refuses (exit 2, "unknown config namespace").
  # Low-churn: new *leaves* under an existing namespace need no edit here;
  # only a brand-new top-level namespace does (a deliberate schema addition).
  members: Set<String> =
    { tracking, slots, models, effort, backends, engines, appetite,
      concurrency_max, worktree_root, logging, automation_default,
      intake_gate, gates, convergence, budget, sentry, adr, prdr,
      faffter_dark, autonomous, containment, post_merge, graft }
  CONSTRAINT: every top-level key documented in .faffrc.example.yaml is a member
              (asserted by a drift test — §5)
```

**Design decision — how faff sanctions writing the behaviour keys.** Three coherent options (full rationale in §6):

- (a) Widen `config init` to the full schema.
- (b) Implement the advertised `set` verb as the general writer.
- (c) Amend the rule to permit hand-editing keys the CLI cannot write.

**Chosen:** (b) implement `set` as a general scalar-leaf writer, **with** a stated carve-out (c) for the narrow set of sequence-valued keys `set` cannot express. This makes the advertised interface true, gives every behaviour key a sanctioned CLI write path, keeps `init` as the focused bootstrap verb, and honestly names the one class of keys still hand-edited — in the committed base, where git is the drift alarm.

**Design decision — the writable surface.** **Chosen:** `set` writes **scalar leaves at any depth** (covers every documented behaviour key, including the two-level `backends.<name>.<field>` the FAFF-665 case needs). Sequence-valued keys are the carve-out. Rationale: the boundary is principled (a `key value` grammar expresses exactly a scalar) and it is the same line the explore findings drew between the flat/nested-scalar keys and the pathological deep-array blocks.

**Design decision — how the carve-out is enforced (revised after spec-review).** **Chosen:** enforce the carve-out by **key identity** — a denylist `SEQUENCE_VALUED_KEYS = { faffter_dark.adversarial.refs, faffter_dark.adversarial.fallbacks, faffter_dark.adversarial.backends }` (the array-valued keys the documented schema carries) refused **by name** — layered with two value-shape belts: refuse a target whose existing line has block-sequence/`-` or indented-map children, **and** refuse when `scalar(existing)` returns an array or object (the inline-flow `[a, b]` / `{…}` form). **Rationale (the load-bearing correction):** the array-valued keys have three on-disk representations, and value-shape inspection alone cannot enforce the carve-out for all of them. `faffter_dark.adversarial.fallbacks` is documented in its **default** form as a quoted JSON string — `fallbacks: '[{"provider":…}]'` (`.faffrc.example.yaml:309`) — which `scalar()` returns as a plain string leaf (`shared-infra.js:300`, no JSON parse on quoted values). A shape-only guard reads that as a scalar and a round-trip of `fallbacks: foo` also passes, so `set … fallbacks foo --force` would silently destroy the whole fallback chain — the exact corruption the guard exists to prevent, slipping **both** the type guard and the round-trip. The JSON-string form is type-indistinguishable from a legitimate scalar, so only a **name**-based refusal closes it. The denylist is small, tied to the schema's array keys, and — like the writable-namespace guard — bound to the documented schema by a drift assertion so a future array key added to the schema is caught.

**Design decision — write-time validation.** **Chosen:** before writing, run `validateModelLane(key, value) || validateEffortLane(key, value)` — the same shape validators `config get` runs for that key (`config.js:1273`). A `models.*`/`effort.*` value that would fail loud at read is refused at write (exit 2, the validator's message). Engine *existence* (`validateEngineRef`) is deliberately **not** run at write: it needs a complete engine (provider+model+host) that a first `set` hasn't written yet, and read already checks it at resolution (`config.js:1278`). This matches the code's own stated split — "the shape is what the vocabulary admits; name existence is checked at resolution" (`config.js:172-173`). Keys with no read-time validator write verbatim, exactly as `tracking.*` does today.

**Design decision — absent file.** **Chosen:** `set` creates `.faffrc.yaml` (with `INIT_HEADER`) when none exists, writing the nested path from scratch — mirroring `init`. Rationale: the FAFF-665 flow set up a throwaway backend under `--root /tmp/…` with no pre-existing config; requiring `init` first would be a needless ordering trap.

**Usage strings — single source.** Both the flag-gate usage (`config.js:1206`) and the unknown/missing-subcommand message (`config.js:1459`) render their verb list from `Object.keys(CONFIG_SURFACE.subcommands)`, so they cannot diverge from the dispatcher or from each other.

## 4. HOW — Behavior

**Architecture.** Add one dispatch branch (`cmdConfigSet`) alongside the existing `init` branch, a general nested-path surgical writer (`mergeConfigPath`) that extends `mergeTrackingBlock`'s proven discipline to an arbitrary dotted key, a small write-validation helper, and the usage-string derivation. `mergeTrackingBlock`, `cmdConfigInit`, `TRACKING_KEYS`, and the reader are untouched.

**The general nested-path writer.** Behaviour summary: given the raw file text, a dotted key's segments, and a scalar value, produce new text in which only the lines needed to set that leaf change; create any missing intermediate maps at the correct sibling-matching indent; leave every other byte alone.

```
PROCEDURE merge_config_path(rawText, segments, rawValue, force) -> { text, conflict, changed, typeError }:
  # segments e.g. ["backends","cx","provider"]; leaf = last segment.
  1. Split rawText into lines. Track a "search window" [start,end) and an
     "expected indent" for the current level; begin at the whole file, indent 0.
  2. FOR each segment except the last:
     a. Within the window, find a line at exactly expected-indent whose key == segment.
     b. IF found:
        - IF its value is inline-scalar (not a map header): return { typeError }
          ("<prefix> is a scalar; can't descend into it").
        - Descend: new window = that key's body (the run of following lines at
          indent > this line's indent, up to the next line at <= it or EOF).
          New expected-indent = the body's first indented child's indent
          (sampled, per FAFF-531); fall back to expected-indent + 2 for an
          empty body.
     c. IF not found: mark "create from here" at segment i, break.
  3. Locate the leaf:
     a. IF all intermediate segments existed, find the leaf line at expected-indent
        within the final window.
     b. IF the leaf line exists:
        - IF its value is a block sequence or a map header (has `-` children or
          indented children), OR scalar(after-colon) is an array/object (inline
          flow `[a,b]` / `{…}`): return { typeError } ("<key> holds a list/map;
          scalar set can't target it — hand-edit the committed base").
          (The JSON-STRING form of a carve-out key reads back as a plain scalar
          and is NOT caught here — it is caught earlier by the key-identity
          denylist in cmd_config_set step 2b.)
        - existing = scalar(stripInlineComment(after-colon)); desired = rawValue.
        - IF existing == desired: return { changed:false } (idempotent no-op).
        - IF NOT force: return { conflict: {key, existing, desired} }.
        - ELSE replace in place: indent + leaf + ": " + emitScalar(rawValue)
          (drops inline comment). changed = true.
     c. IF the leaf (or an ancestor) is missing: emit the remaining segment chain
        as nested lines at escalating indent —
          seg_i:\n  seg_{i+1}:\n    … leaf: emitScalar(value)
        each level indented one step deeper than its parent — and splice it at the
        end of the deepest existing ancestor's body (trimming trailing blank lines
        first, as mergeTrackingBlock does). If even the root segment is absent,
        append it as a new top-level block (one blank-line separator; preserve the
        file's trailing-newline state).
  4. Return { text: lines.join("\n"), conflict:null, changed, typeError:null }.
```

```
PROCEDURE cmd_config_set(args, root):
  1. Parse: key = first positional, value = second positional.
     IF key or value missing: stderr "config set requires <dotted.key> <value>", return 2.
  2. a. segments = key.split("."). IF segments[0] not in WritableNamespaces:
        stderr "config set: unknown config namespace '<segments[0]>' — writable
        namespaces: <sorted list>", return 2.
     b. IF key in SEQUENCE_VALUED_KEYS (the array-valued carve-out denylist):
        stderr "config set: <key> is a list-valued key — hand-edit the committed
        base (config set writes scalar leaves only)", return 2.
        # By NAME, before touching the file: the JSON-string form of these keys
        # reads back as a plain scalar, so a value-shape guard cannot catch it.
  3. writeErr = validateModelLane(key, value) || validateEffortLane(key, value)
     IF writeErr: stderr writeErr, return 2.   # same fail-loud as `config get`
  4. path = findConfig(root)   # may throw legacy-config-name → cmdConfig's catch
     IF path == null:
        newText = INIT_HEADER + emit_nested_chain(segments, value)   # create-from-scratch
        changed = true
     ELSE:
        raw = readFileSync(path)
        { text: newText, conflict, changed, typeError } = merge_config_path(raw, segments, value, force)
        IF typeError: stderr typeError, return 2
        IF conflict and not force:
           stderr "config set: refusing to overwrite <key> ('<existing>' → '<desired>')
                   without --force", return 2
        IF not changed: stdout "config set: no change (<key> already '<value>')", return 0
  5. # Round-trip self-verify against the real reader BEFORE writing.
     parsed = parseYamlSubset(newText)
     IF dig(parsed, key) != rawValue:
        stderr "config set: internal error — written text does not round-trip
                (<key>: got <got>, want <want>); aborting to avoid a corrupt config",
        return 2
     # Guard against silent sequence-destruction the round-trip can't catch:
     # step 2b (key identity) + step 3b (value shape) already refused sequence/map
     # targets, so a passing round-trip here means a genuine scalar leaf.
  6. IF dryRun: stdout newText, return 0
     writeFileSync(canonicalPath, newText)
     stdout "config set: wrote <key>=<value> to .faffrc.yaml", return 0
```

**Usage-string derivation.**

```
PROCEDURE config_verb_list():
  RETURN Object.keys(CONFIG_SURFACE.subcommands).join("|")   # single source

# Gate-failure (config.js:1206):
"usage: faff config <" + config_verb_list() + "> [KEY [VALUE]] [-d DEFAULT] [--json] [--force] [--dry-run] [--root DIR]"
# Unknown/missing subcommand (config.js:1459):
"faff config: expected one of " + config_verb_list()
```

After adding `set` to `CONFIG_SURFACE.subcommands`, both strings render `check|defaults|dump|get|init|path|prd-docs-path|resolved|set|spec-docs-path` (registry order) — `set` present, everything real present, nothing phantom.

**Edge cases and error handling.**

- **Sequence/map target** — refused in two layers. **(1) By key identity** at step 2b: the array-valued carve-out keys (`faffter_dark.adversarial.refs` / `.fallbacks` / `.backends`) are refused **by name, before the file is read** (exit 2). This is the only layer that catches the JSON-string form `fallbacks: '[{…}]'` — the documented default (`.faffrc.example.yaml:309`) — which `scalar()` returns as a plain string, slipping *both* a value-shape guard *and* the round-trip (writing `fallbacks: foo` reads back as scalar `foo`, "passes", and the whole chain is destroyed). **(2) By value shape** at step 3b: any *other* key that happens to currently hold a block sequence, an inline-flow `[a,b]`/`{…}`, or a sub-map is refused too. Both point at the committed-base hand-edit.
- **Scalar-where-map-expected** — `set backends.cx.provider x` when `backends` exists as a scalar: refused at step 2b `typeError`.
- **Wrong-indent creation bug** — if the new nested-chain lines land at an indent `parseYamlSubset` reads as outside the intended map, `dig` returns null and the round-trip guard aborts (exit 2, no write). The new code fails loud, never persists corruption.
- **Legacy / multiple / parse-fault config files** — `findConfig` throws `legacy-config-name` etc.; do **not** catch in `cmdConfigSet` — let `cmdConfig`'s existing catch (`config.js:1428-1457`) render them, exactly as `cmdConfigInit` relies on.
- **Conflict without `--force`** — refuse (exit 2), name existing→desired; `--force` overwrites in place (drops that line's inline comment, mirroring `mergeTrackingBlock`).
- **Idempotent set** — identical value: exit 0, no write, `changed:false`.

**Failure modes.**

- **The nested writer mis-nests on a file shape the tests didn't cover** (unusual indentation, tabs, a map key whose body starts with a comment). *How you'd know:* the round-trip guard trips (exit 2, "does not round-trip") on that shape, or a selftest case fails. *What it means:* narrow — add the shape to `configSetSelftest` and fix the indent sampling; the guard means the failure is a refused write, never a corrupt file.
- **The writable-namespace guard drifts from the schema** — a future top-level key is added to `.faffrc.example.yaml` but not to `WritableNamespaces`, so `set` refuses a legitimate key. *How you'd know:* the drift test (§5) fails in CI. *What it means:* proceed — add the namespace; the test is the alarm.

**Anti-pattern:** Building a general YAML emitter and doing `writeFileSync(serialize(parse(raw)))`. Why: `parseYamlSubset` is lossy — reserialising flattens nested maps and deletes the user's comments, ordering, and any construct the subset parser doesn't model. Every writer here is a surgical raw-text edit.

**Anti-pattern:** Running `validateEngineRef` at write time to "validate the backend." Why: it requires a complete engine that a single `set backends.cx.provider` hasn't produced yet, creating an ordering trap (you couldn't write provider before model+host exist). Existence is a resolution-time check, already done at read.

**Anti-pattern:** Enforcing the array carve-out only by the target's current value shape. Why: the carve-out keys' documented default is the JSON-string form (`fallbacks: '[{…}]'`), which reads back as a plain scalar — a shape check passes it and the round-trip passes it, so the list is silently destroyed. Refuse the carve-out keys by **name** (`SEQUENCE_VALUED_KEYS`); the shape checks are only a belt for other keys that happen to hold a list.

**Anti-pattern:** Hardcoding the child indent to 2 when creating a key inside an existing map. Why: this is exactly the FAFF-531 bug — a repo's own `.faffrc.yaml` uses a 4-space `tracking` body; a hardcoded 2 reads back outside the block → null → round-trip abort. Sample the existing sibling indent.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo with no .faffrc.yaml
When I run `faff config set backends.cx.provider codex` then `faff config set backends.cx.model o4-mini`
Then .faffrc.yaml exists with a nested backends: → cx: → { provider: codex, model: o4-mini } map
And `faff config get backends.cx.provider` prints "codex" (exit 0)
And `faff config dump` shows backends.cx as a two-level map, not a flattened key
```

```
Given a .faffrc.yaml with a populated slots: block carrying inline comments and an appetite: line
When I run `faff config set models.build sonnet`
Then a models: → build: sonnet entry exists
And the slots: block and every inline comment are byte-for-byte unchanged
And `faff config get models.build` prints "sonnet"
```

```
Given any state
When I run `faff config` with no subcommand, and `faff config bogus`
Then both print a verb list equal to Object.keys(CONFIG_SURFACE.subcommands)
And that list contains "set" and every dispatched verb, and no verb the dispatcher rejects
```

```
holdout
Given a .faffrc.yaml whose faffter_dark.adversarial.refs holds a block-sequence list
When I run `faff config set faffter_dark.adversarial.refs foo`
Then it exits 2 with a message that the key holds a list and must be hand-edited in the committed base
And the file is unchanged (the sequence is not overwritten with a scalar)
```

```
holdout
Given a .faffrc.yaml whose faffter_dark.adversarial.fallbacks holds the DOCUMENTED DEFAULT
  JSON-string form: `fallbacks: '[{"provider":"…","model":"…"}]'`
When I run `faff config set faffter_dark.adversarial.fallbacks foo --force`
Then it exits 2 (refused by the key-identity denylist, before the file is read)
And the file is byte-for-byte unchanged (the fallback chain is NOT flattened to a scalar)
```

```
holdout
Given a .faffrc.yaml whose faffter_dark.adversarial.refs holds the inline-flow form
  `refs: [nvidia-glm, studio-ollama]`
When I run `faff config set faffter_dark.adversarial.refs foo --force`
Then it exits 2 (refused by key-identity, and also by the scalar-is-array shape belt)
And the file is byte-for-byte unchanged
```

```
Given a .faffrc.yaml with models.build already set to "opus"
When I run `faff config set models.build gpt-5`
Then it exits 2 naming the invalid token and the legal set (validateModelLane), and does not write
When I instead run `faff config set models.build sonnet --dry-run`
Then it prints the would-be file text and writes nothing
```

- The written file always round-trips: for every successful `set`, `dig(parseYamlSubset(fileText), key)` equals the value written.

## 6. Design Decision Rationale

**How does faff sanction writing the behaviour keys?**

- **(a) Widen `config init` to the full schema.** Pro: one writer, preserves the "only writer" phrasing literally. Con: overloads `init` (a create-from-scratch bootstrap verb, also the onboarding and decline-stub path) with arbitrary in-place editing; the `--set tracking.X=` decline-stub semantics get muddier; largest surface. The hard part (a general nested-path writer) is required either way.
- **(b) Implement the advertised `set` verb.** Pro: makes the usage string's promise true — the exact thing a reader tries (`config set backends.cx.provider codex`) now works; keeps `init` focused; a clean `key value` mental model. Con: a second write site (acceptable — both go through the sanctioned CLI; the architectural constraint is CLI-only writes, not one function).
- **(c) Amend the rule to permit hand-editing keys the CLI can't write.** Pro: cheapest, honest. Con: weakens a guardrail that exists because hand-reading silently dropped configured slots twice; on its own it leaves most keys with no *tool* to write them.

**Chosen:** (b) as the general writer **plus** a narrow, explicitly-named (c)-style carve-out for sequence-valued keys `set` cannot express. Rationale: (b) fixes both defects at their root — the advertised verb becomes real, and every scalar behaviour key (including `backends.<name>.<field>`) gets a sanctioned CLI write path — while (a)'s heavy nested-writer work is unavoidable in any option and is the same code here. The carve-out is bounded to exactly the keys a `key value` grammar cannot represent, is stated plainly in the gateway, and lands in the *committed* base where git is the drift alarm — the same posture reasoning FAFF-387 already relies on — so it does not reintroduce the silent-corruption risk the rule guards against.

**What surface does `set` write?** **Chosen:** scalar leaves at any depth; sequence-valued keys carved out. A `key value` grammar expresses exactly a scalar; this is the same boundary the explore findings drew between the flat/nested-scalar behaviour keys and the pathological deep-array blocks.

**How is the carve-out enforced?** **Chosen:** by **key identity** (a `SEQUENCE_VALUED_KEYS` denylist refused by name), layered with value-shape belts. Rationale in §3 (revised after spec-review): the array keys' documented default is the JSON-string form, which is type-indistinguishable from a scalar, so a name-based refusal is the only mechanism that closes it; a shape-only guard would silently destroy the fallback chain.

**Typo safety at the root — full-leaf allowlist, no guard, or namespace guard?** Options: a full-schema leaf allowlist (safest, but re-encodes the whole schema and must be updated by every future key-adding ticket — a maintenance tax and a drift surface); no guard (a typo like `apetite` silently writes a dead key); a top-level namespace guard. **Chosen:** the namespace guard — it catches gross root-level typos cheaply, is low-churn (new leaves under existing namespaces need no edit), and a drift test ties the namespace set mechanically to `.faffrc.example.yaml` so it can't silently fall behind.

**Write-time validation scope.** **Chosen:** reuse `validateModelLane`/`validateEffortLane` (shape/vocab), not `validateEngineRef` (existence). Matches read behaviour and the code's own shape-vs-existence split; avoids an ordering trap on `backends.*`.

**Where do the usage strings get their verb list?** **Chosen:** derive both from `Object.keys(CONFIG_SURFACE.subcommands)` — the one complete list `cli-surface.js` already consumes — so dispatcher, gate-usage, and unknown-subcommand message share a single source and a test asserts they agree.

## 7. Open Questions and Assumptions

**Open Questions.** None — the ticket delegated the writer decision to the spec (appetite high) and it is made above.

**Assumptions.**

- **Assumes:** `.faffrc.example.yaml` remains the enumerable single source of the documented top-level schema (it declares itself as mirroring the gateway, `.faffrc.example.yaml:24`). *Validation:* before building the drift test, confirm the example file's top-level keys are still the schema of record; if the gateway ever becomes the only enumerable source, point the drift test there instead.
- **Assumes:** `validateModelLane` and `validateEffortLane` remain exported and pure (`config.js:1560` per the explore findings). *Validation:* `grep` the module's exports for both names before wiring the write-validation helper.

## 8. DONE — Definition of Done

### From WHY / the decision
- [ ] `faff config set <dotted.key> <value>` exists and writes a scalar leaf at any depth via a surgical raw-text edit (no reserialise).
- [ ] The gateway "No hand-writing" rule (`SKILL.md:129`) is amended: `config init` bootstraps tracking; `config set` writes any scalar leaf incl. `backends.*`; the sequence-valued carve-out is named with "hand-edit the committed base" as the stated alternative. The no-hand-*reading* rule is unchanged.
- [ ] Every top-level key documented in `.faffrc.example.yaml` is either writable by `config set` or named in the sequence carve-out — asserted by a test (below).
- [ ] The gateway documents `backends:` at least minimally (closes the FAFF-665 gateway gap; grep for `backends` in `SKILL.md` returns a hit).

### From WHAT (interface)
- [ ] `set` is present in `CONFIG_SURFACE.subcommands` and dispatches in `cmdConfig`.
- [ ] `set` refuses a dotted key whose first segment is not a writable namespace (exit 2, names the writable set).
- [ ] `set` on a `models.*`/`effort.*` key runs the same validator `config get` runs and refuses an off-vocabulary value (exit 2) before writing.
- [ ] `set` creates `.faffrc.yaml` (with header) when absent; honours `--force`, `--dry-run`, `--root`.

### From HOW (behaviour)
- [ ] `config set backends.cx.provider codex` then `… backends.cx.model o4-mini` produces a nested two-level `backends: → cx:` map that `config get` reads back and `config dump` shows unflattened (the FAFF-665 end-to-end case).
- [ ] A `set` into an existing file leaves all other blocks, comments, ordering, and trailing-newline state byte-for-byte unchanged.
- [ ] A new key created inside an existing map lands at that map's own child indent (FAFF-531 generalised) and round-trips.
- [ ] Every successful write round-trips through `parseYamlSubset` before `writeFileSync`; a non-round-tripping write aborts (exit 2, no write).

### From HOW (edge cases)
- [ ] `set` on an array-valued carve-out key (`faffter_dark.adversarial.refs`/`.fallbacks`/`.backends`) refuses **by key identity** (exit 2, before the file is read), including when the key is stored in its documented **JSON-string** form (`fallbacks: '[{…}]'`) — the file is byte-unchanged. A holdout test covers the JSON-string form and the inline-flow form.
- [ ] `SEQUENCE_VALUED_KEYS` is bound to the schema's array-valued keys by a drift assertion (mirroring the writable-namespace drift test), so a future array key added to `.faffrc.example.yaml` is caught.
- [ ] `set` on any *other* key currently holding a list or sub-map (block sequence, inline-flow `[a,b]`/`{…}`, or a sub-map header) refuses (exit 2) and does not overwrite it.
- [ ] Conflict without `--force` refuses (exit 2, names existing→desired); `--force` overwrites in place.
- [ ] Idempotent `set` (identical value) exits 0 and writes nothing.
- [ ] `legacy-config-name` / `multiple-config` / parse-fault surface through `cmdConfig`'s existing catch, not a new handler.

### Drift guards (the requested tests, wired into `node --test`)
- [ ] A test asserts the gate-failure usage (`config.js:1206`) and the unknown-subcommand message (`config.js:1459`) each list a verb set equal to `Object.keys(CONFIG_SURFACE.subcommands)`, and that every listed verb dispatches (none falls through to "expected one of"). This is the "usage and dispatcher agree" guard the ticket asks for.
- [ ] A test parses the top-level keys of `.faffrc.example.yaml` and asserts each is a writable namespace or in the carve-out list — mechanically enforcing "every documented key is writable or stated-not."
- [ ] A `configSetSelftest` (mirroring `configInitSelftest`) covering the writer's pure helpers is added and reachable from `node --test` (via the CLI, as the other config tests are) — not only via a `--selftest` flag. It includes the three carve-out representations (block sequence, inline flow, JSON-string) each asserting a refused, byte-unchanged file.

### Integration smoke test
```
PROCEDURE smoke():
  dir = mkdtemp()
  runCli(["config","set","backends.cx.provider","codex","--root",dir])   # creates file
  runCli(["config","set","backends.cx.model","o4-mini","--root",dir])     # nests under same map
  assert runCli(["config","get","backends.cx.provider","--root",dir]).stdout == "codex"
  dump = JSON.parse(runCli(["config","get","backends","--json","--root",dir]).stdout)
  assert dump.cx.provider == "codex" and dump.cx.model == "o4-mini"       # nested, not flattened
  # usage/dispatcher agreement
  u1 = runCli(["config"]).stderr; u2 = runCli(["config","bogus"]).stderr
  assert verbList(u1) == verbList(u2) == sortedKeys(CONFIG_SURFACE.subcommands)
```

---

## Self-review findings and resolutions

- **[major] The round-trip guard does not catch scalar-over-sequence destruction.** Writing `refs: foo` over a block sequence reads back as scalar `foo`, so the round-trip passes while the list is silently destroyed. **Resolution:** added an explicit pre-write type guard (step 3b `typeError`) refusing a sequence/map target, called out in failure-modes, edge-cases, and a holdout scenario. (Spec-review later showed this needed a key-identity layer too — see Revision 1.)
- **[major] Running `validateEngineRef` on write would create an ordering trap** (it needs provider+model+host, none present after a first `set`). **Resolution:** scoped write-validation to the shape validators only, matching the code's shape-vs-existence split; documented as an anti-pattern.
- **[minor] Which usage string fires for a bare `faff config`?** Verified: bare `config` falls through to `config.js:1459`; both strings derive from `CONFIG_SURFACE.subcommands`, and the smoke test covers `config` (bare) + `config bogus`.
- **[minor] Namespace guard could drift from the schema.** **Resolution:** added the drift test binding `WritableNamespaces` to `.faffrc.example.yaml`'s top-level keys, plus an `Assumes:` on that file.
- **Verified against ground truth:** `TRACKING_KEYS`/`mergeTrackingBlock` flat-depth-1 only; `CONFIG_SURFACE.subcommands` is the complete correct list consumed by `cli-surface.js:41`; the two divergent usage strings at 1206/1459; no `set` branch exists; `backends:` has zero gateway hits.

## Revision 1 — spec-review (revise) applied 2026-08-04

The synchronous spec-review gate returned **revise** (architectural + QA major, methodology minor), one shared root cause: the sequence carve-out was enforced only by the target's raw-line *shape*, which does **not** catch the array-valued keys stored in their JSON-string form (`fallbacks: '[{…}]'` — the *documented default*, `.faffrc.example.yaml:309`) or inline-flow form (`refs: [a, b]`). Those read back as plain scalars, so both the type guard and the round-trip guard pass, and a `--force` write silently destroys the whole list. Fixes applied in place:
- **Enforce the carve-out by key identity** — a `SEQUENCE_VALUED_KEYS` denylist (`faffter_dark.adversarial.refs`/`.fallbacks`/`.backends`) refused **by name before the file is read** (cmd_config_set step 2b), the only layer that closes the JSON-string form. Kept the value-shape checks as belts (block-sequence/indented-map, plus `scalar(existing)` array/object for inline flow).
- **Bound the denylist to the schema** by a drift assertion, mirroring the writable-namespace guard.
- **Added two holdout scenarios** (JSON-string `fallbacks`, inline-flow `refs`) and a DoD item requiring all three carve-out representations in `configSetSelftest`.
- **Methodology minor (deps hygiene):** the FAFF-665 blocker edge and the FAFF-689 boundary-restatement are surfaced for the human (both live outside the spec body; the orchestrator does not auto-mutate topology in prep).

The chosen approach is unchanged (spec-review found it sound and right-sized — revise, not reject); these are enforcement-predicate refinements within it. No new open questions; confidence unchanged.

confidence: high

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
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
