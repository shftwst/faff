# faff config `--absolute`: refuse it on the sub-verbs that do not honour it

> Spec: faffter-dark-nlspec · 2026-10-27 · autonomous · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-1317.

This is the build spec for FAFF-1317. Audience: the build agent that will implement the fix, and the human reviewers who gate the PR. It describes a small, self-contained correctness fix to the `faff config` CLI argument surface in `plugin/skills/faff/bin/lib/config.js`.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff config` parses its flags with a single union spec (`CONFIG_SPEC`) shared across all 16 sub-verbs, then each verb's body reads only the flags it cares about. A flag in that union is therefore *accepted* on every verb at parse time, whether or not any verb body reads it — so a flag only one verb honours is silently tolerated everywhere else. The fix adds one guard that converts "tolerated everywhere" into "refused where it means nothing" for the `--absolute` flag specifically.

**Problem statement.** FAFF-1300 added `--absolute` to `CONFIG_SPEC`, but only the `templates-path` verb reads it; `faff config get appetite --absolute` exits 0 and silently ignores the flag. A flag that parses but does nothing teaches an operator it works — the exact failure mode the codebase refuses elsewhere. This change scopes `--absolute` to `templates-path` so an unsupported use is refused with a usage error instead of ignored.

**Design principles.**

**A flag is never accepted-but-ignored.** This is the established house rule the fix enforces, not a new one: `native-map set` refuses the get-only `--type`, and `bundle publish` refuses the verify-only `--bundle-store`, both with a fail-closed exit 2 rather than silent tolerance. The fix copies that posture for `--absolute`; it does not invent a new validation philosophy.

**Minimal blast radius — refuse the one flag, do not re-architect the surface.** The flag lives on the shared spec, so a fully general fix would introduce declarative per-verb flag scoping across the whole `faff config` surface. That is explicitly larger than this ticket (the same reason FAFF-1300 did not do it). This spec refuses `--absolute` only, via a single imperative guard, and leaves the general mechanism as a documented extension point.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` | JavaScript (no `.ts` sibling) | Hosts `CONFIG_SPEC`, `CONFIG_SURFACE`, and `cmdConfig` — the file the fix edits |
| `plugin/skills/faff/bin/lib/native-map.js` (`cmdNativeMapSet`, ~line 209) | JavaScript | The refusal pattern to copy: stderr message + `return 2`, before any side effect |
| `plugin/skills/faff/bin/lib/argv.js` (`parseArgs`, `usageError`) | JavaScript | The pure flag parser; `cmdConfig` already calls both |
| `test/templates-path.test.mjs`, `test/native-map.test.mjs` | JavaScript (node:test) | Test style (spawn the real CLI, assert exit/stdout/stderr); where the new negative test lands |

**Scope statement.** This is a leaf correctness fix inside one CLI command's argument handling; it changes no config semantics, no file formats, and no other command.

## 2. OUT OF SCOPE

- **Declarative per-subcommand flag scoping** — a `CONFIG_SURFACE.subcommands[verb]` field (e.g. `scoped_flags`) enforced generically for every verb-specific flag. **Why excluded:** it is the whole-surface refactor this ticket was split out to avoid; `--absolute` is the only reported drift. **Extension point:** add the field to `CONFIG_SURFACE` in `config.js` and enforce it in `cmdConfig` (and keep `buildCliSurface` / `cli-surface --selftest` consistent).
- **The sibling accepted-but-ignored flags** `--local`, `--create`, `--force`, `--set`, `--json`, `--selftest`, `--default`. **Why excluded:** they are the same class of gap but out of this ticket's stated scope (`--absolute` only); some (`--json`, `--root`) are deliberate universal CLI conventions, not verb-specific. **Extension point:** the same declarative mechanism above would cover the genuinely verb-specific ones.
- **The six docs-path verbs gaining `--absolute`** (`spec-docs-path` et al. returning an absolute path). **Why excluded:** the issue asks to refuse the ignored flag, not to widen who honours it; FAFF-1300 deliberately gave `--absolute` to `templates-path` only. **Extension point:** a future issue could add the read to those verbs' arms if an absolute docs-path is ever wanted.
- **Changing `templates-path`'s own `--absolute` behaviour.** **Why excluded:** it works and callers depend on it (`references/create.md` runs `faff config templates-path --absolute`). It must keep working unchanged.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| honouring verb | A `config` sub-verb whose body reads `--absolute`. Today exactly one: `templates-path`. |
| non-honouring verb | Any other *known* `config` sub-verb (the remaining 15 keys of `CONFIG_SURFACE.subcommands`). |
| the gate | The `parseArgs(args, CONFIG_SPEC)` call at the top of `cmdConfig` that validates flags before dispatch. |

**Interfaces touched.**

- `CONFIG_SPEC` (`config.js` ~line 20) — **unchanged.** `--absolute` stays declared here so the gate still parses it and `configVerbList` / the `cli-surface` flag union are unaffected (no selftest drift).
- `cmdConfig(args)` (`config.js` ~line 60) — **one guard added**, after the gate and after `cmd` is resolved (`cmd = rest[0]`), before the verb dispatch if-chain.

**Behaviour contract of the new guard.**

```
GUARD refuse_absolute_on_non_honouring_verb:
  fires when ALL of:
    - gate.values["--absolute"] is truthy (the flag was supplied and well-formed)
    - cmd is an OWN key of CONFIG_SURFACE.subcommands
        -> use Object.hasOwn(CONFIG_SURFACE.subcommands, cmd) (or hasOwnProperty.call),
           NEVER a plain `CONFIG_SURFACE.subcommands[cmd]` truthiness test — a plain index
           matches inherited names (constructor, toString, __proto__, hasOwnProperty, …)
    - cmd !== "templates-path"
  effect: write one line to stderr, return 2 (before any verb body runs)
  otherwise: no effect; dispatch proceeds exactly as today
```

The stderr line mirrors the `native-map` shape:

```
faff config <cmd>: --absolute is a `templates-path`-only flag and is not accepted by `<cmd>`
```

## 4. HOW — Behavior

**Approach.** Add a single conditional in `cmdConfig`, positioned after `const cmd = rest[0];` and before the `if (cmd === "path")` chain begins. Read the flag from the parsed gate result (`gate.values["--absolute"]`), not from `rest.includes("--absolute")`, so a malformed `--absolute=x` is still caught as a parse error by the gate rather than slipping past. Gate the guard on `cmd` being a known verb — tested with an **own-property** check (`Object.hasOwn`), never a plain object-index truthiness test — so that an unknown verb (and any inherited-property name) keeps falling through to the existing `expected one of …` message.

```
PROCEDURE cmdConfig(args):   # only the added guard is shown; surrounding code unchanged
  1. gate = parseArgs(args, CONFIG_SPEC)
  2. IF gate.errors: return usageError(...)            # unchanged
  3. resolve root; build rest (strip --root); cmd = rest[0]   # unchanged
  4. # NEW GUARD — insert here, before the dispatch if-chain:
     IF gate.values["--absolute"]
        AND Object.hasOwn(CONFIG_SURFACE.subcommands, cmd)   # own-key check ONLY — never a plain index
                                                             # (that matches constructor/toString/__proto__);
                                                             # also false for undefined cmd
        AND cmd !== "templates-path":
        write to stderr:
          `faff config ${cmd}: --absolute is a \`templates-path\`-only flag and is not accepted by \`${cmd}\``
        return 2
  5. dispatch if-chain (path|get|…|templates-path|…)    # unchanged
  6. fallthrough: `faff config: expected one of …`; return 2   # unchanged
```

**Edge cases.**

- **Unknown verb + `--absolute`** (`faff config bogus --absolute`) — guard does not fire (`Object.hasOwn(CONFIG_SURFACE.subcommands, "bogus")` is false), control reaches the existing fallthrough and prints `expected one of …`, exit 2. The dominant error (unknown verb) wins, as today.
- **Inherited-property name + `--absolute`** (`faff config constructor --absolute`, `toString`, `__proto__`, `hasOwnProperty`) — guard does not fire, because the own-property check excludes inherited `Object.prototype` names that a plain `subcommands[cmd]` truthiness test would wrongly match. Falls through to `expected one of …`, exit 2 — never the targeted refusal message.
- **No verb + `--absolute`** (`faff config --absolute`) — `cmd` is `undefined`, `Object.hasOwn(CONFIG_SURFACE.subcommands, undefined)` is false, guard does not fire; existing no-verb behaviour is unchanged.
- **`templates-path --absolute`** — guard does not fire (`cmd === "templates-path"`), the arm runs and prints the absolute path exactly as today.
- **`--absolute=value`** — the arity-0 gate rejects it as a parse error (step 2) before the guard is reached, unchanged.
- **Flag *after* the verb** (`faff config get appetite --absolute`) — this is the bug case: `rest = ["get","appetite","--absolute"]`, `cmd = "get"`, the own-key check passes, `cmd !== "templates-path"`, so the guard fires (exit 2, targeted message). This is the ordering the fix targets.
- **Flag *before* the verb** (`faff config --absolute get appetite`) — `cmd` is **not** derived from `parseArgs` positionals; `rest` strips only `--root`, so `rest[0]` is the literal `"--absolute"`. The own-key check is false, the guard does not fire, and control falls through to `expected one of …` (exit 2). This ordering is **already** a non-silent error today (it never reached a verb body), so it is not the silent-ignore bug; the fix leaves it unchanged. Both orderings exit non-zero — only the message differs (targeted refusal vs generic unknown-verb). Do **not** expand `rest` handling to strip `--absolute` so the guard can fire here: that is an unrequested change to argument parsing and out of scope.

**Anti-pattern:** reading the flag with `rest.includes("--absolute")` in the guard. Why: it would treat the malformed `--absolute=x` as "present" and bypass the gate's arity error; the parsed `gate.values` is the validated source.

**Anti-pattern:** testing the known-verb set with a plain `CONFIG_SURFACE.subcommands[cmd]` truthiness check. Why: `subcommands` is a plain object, so `cmd` values like `constructor` / `toString` / `__proto__` resolve to inherited `Object.prototype` members and read truthy, firing the refusal with a misleading message where the `expected one of …` fallthrough belongs. Use `Object.hasOwn` (own-key only).

**Anti-pattern:** removing `--absolute` from `CONFIG_SPEC` to "fix" it. Why: that makes `templates-path --absolute` an unknown-flag error too, breaking the one verb that honours it and its callers. The flag must stay in the shared spec; only the per-verb use is refused.

**Anti-pattern:** refusing `--absolute` on an unknown verb. Why: it masks the more useful "unknown verb" message; scope the guard to known verbs.

## 5. SCENARIOS

```
Given the faff CLI is built
When a user runs `faff config get appetite --absolute`
Then it exits non-zero (2) and stderr names `--absolute` as a `templates-path`-only flag, and no config value is printed
```

```
Given the faff CLI is built
When a user runs `faff config templates-path --absolute` in a repo
Then it exits 0 and prints the absolute templates path (behaviour unchanged)
```

```
Given the faff CLI is built
When a user runs `faff config bogus-verb --absolute`
Then it exits 2 with the `expected one of …` unknown-verb message (the --absolute guard does not pre-empt it)
```

## 6. DESIGN DECISION RATIONALE

**How should `--absolute` be scoped to `templates-path`?**

- *Imperative guard in `cmdConfig`* — one conditional that refuses the flag on known non-honouring verbs. Pro: tiny, local, mirrors the established `native-map` / `bundle` precedent, no surface-registry changes, no selftest drift. Con: does not generalise to the sibling ignored flags.
- *Declarative per-subcommand scoped-flags field on `CONFIG_SURFACE`* — a general mechanism enforced for every verb-specific flag. Pro: also fixes `--local` / `--create` / `--force`. Con: the whole-surface refactor this ticket was explicitly carved out to avoid; touches `cli-surface` and its selftest.

**Chosen:** the imperative guard in `cmdConfig` — the issue names the `native-map set --type` refusal as the pattern to copy, the severity is Low/consistency, and the declarative mechanism is recorded in OUT OF SCOPE as the extension point if the sibling flags ever warrant it.

**Where should the flag be read in the guard?**

- *`gate.values["--absolute"]`* vs *`rest.includes("--absolute")`*.

**Chosen:** `gate.values["--absolute"]` — it is the validated parse result, so a malformed `--absolute=x` stays a gate arity error rather than being read as "present". (`templates-path`'s own arm keeps its existing `rest.includes` read; this spec does not churn working code.)

**Should the guard fire on unknown verbs?**

**Chosen:** no — gate it on membership of `CONFIG_SURFACE.subcommands` so an unknown verb falls through to the existing `expected one of …` message, preserving the more useful diagnostic.

**How to test known-verb membership — own-key vs plain index?**

- *`Object.hasOwn(CONFIG_SURFACE.subcommands, cmd)`* vs *`CONFIG_SURFACE.subcommands[cmd]` truthiness*.

**Chosen:** `Object.hasOwn` (own-key only). `subcommands` is a plain object, so a bare index test matches inherited `Object.prototype` names (`constructor`, `toString`, `__proto__`, `hasOwnProperty`) and would fire the refusal with a misleading message where the unknown-verb fallthrough belongs. `Object.hasOwn` is available on the Node 20 adopter floor (`hasOwnProperty.call` is the equivalent if preferred). This is the one subtlety the guard introduces that the existing `cmd === "literal"` if-chain never had.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None.

**Assumptions.**

- **Assumes:** `config.js` has no `.ts` sibling, so the fix edits the committed `.js` directly and needs no `npm run build` emit step. *Validation:* `ls plugin/skills/faff/bin/lib/config*.ts` returns nothing (confirmed during explore); if a `.ts` sibling exists at build time, edit it and rebuild per AGENTS.md instead.

## Already shipped against this surface

Related prior work exists but none of it delivers this fix — the premise (the flag is accepted-but-ignored on non-honouring verbs) still holds:

- **FAFF-1300** (Done) is the origin: it *added* `--absolute` to the shared `CONFIG_SPEC` for `templates-path`; it did not scope the flag per verb. This ticket fixes that drift.
- **FAFF-576** (Done) made `faff` flag parsing fail-closed on *unknown* flags — but `--absolute` is a *known* flag on the shared `config` spec, so FAFF-576's gate accepts it on every verb. That is precisely why a verb-scoped refusal is still needed.
- **FAFF-1083** (Done) established the `native-map set --type` refusal this spec copies, and **FAFF-1016** the `bundle publish --bundle-store` one. They are the pattern, not a delivery of this fix for `config`.

## 8. DONE — Definition of Done

### From WHY / WHAT
- [ ] `--absolute` remains declared in `CONFIG_SPEC`; `configVerbList` output and the `cli-surface` flag union are unchanged (no new selftest failures in `faff cli-surface --selftest`).

### From HOW (behaviour)
- [ ] `faff config get appetite --absolute` exits 2, prints no config value, and its stderr contains the exact line below (one line, including the two code-span backtick pairs around `templates-path` and `get`):

  ```
  faff config get: --absolute is a `templates-path`-only flag and is not accepted by `get`
  ```
- [ ] At least one other non-honouring verb (e.g. `path` or `spec-docs-path`) with `--absolute` likewise exits 2 with the analogous message (the verb name substituted in both positions).
- [ ] `faff config templates-path --absolute` still exits 0 and prints the absolute templates path.
- [ ] `faff config templates-path` (no flag) still prints the repo-relative templates path.

### From HOW (edge cases)
- [ ] `faff config bogus-verb --absolute` exits 2 with the existing `expected one of …` unknown-verb message, not the `--absolute` refusal.
- [ ] `faff config constructor --absolute` (an inherited-property name) exits 2 with the `expected one of …` message, not the `--absolute` refusal — proving the own-key (`Object.hasOwn`) membership test, not a plain index.
- [ ] `faff config --absolute get appetite` (flag before the verb) exits 2 (via the `expected one of …` fallthrough, since `cmd` is the literal `--absolute`), unchanged by this fix.
- [ ] `faff config get appetite --absolute=x` exits 2 as a gate parse/arity error (unchanged).

### From test floor
- [ ] A node:test case (in `test/templates-path.test.mjs` or a new `test/config-flags.test.mjs`) spawns the real CLI and asserts: the refusal on a non-honouring verb (exit 2, stderr matches `/--absolute/` and names `templates-path`), the preserved `templates-path --absolute` success, the preserved unknown-verb fall-through, and the inherited-property case (`faff config constructor --absolute` → `expected one of …`, not the refusal).

### From docs
- [ ] If `docs/guide/cli.md`'s `config` row implies `--absolute` is general, it is clarified to note the flag is `templates-path`-only (a one-line doc touch; skip if the row already scopes it to `templates-path`).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. run `faff config templates-path --absolute --root <repo>` -> exit 0, prints an absolute path
  2. run `faff config get appetite --absolute --root <repo>`   -> exit 2, stderr mentions --absolute and templates-path
  3. run the node:test suite for config/templates-path         -> all green
```

spec-review: approve
confidence: high
