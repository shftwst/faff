# Widen the hand-read config guard to cover `.faff/` config variants and extensionless reads

> Spec: faffter-dark-nlspec · 2026-10-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1322.

This spec addresses FAFF-1322. Its audience is the build agent that will widen the `validate-adapters` hand-read guard, and the human reviewers of the resulting PR. It describes a single, mechanical regex change plus the test that pins it.

## 1. WHY — Problem and Principles

**The load-bearing model.** The FAFF-50 hand-read guard is a CI lint: it scans every `SKILL.md` for a shell command (`cat`/`head`/`tail`/`less`/`grep`/`sed`/`awk`) that reads a faff config file directly, and fails the run so skills are forced to go through `faff config` instead. The guard is only as good as the set of config-file spellings its pattern recognises.

**Problem statement.** Today the guard's `.faff/` branch matches only the two canonical names (`.faff/config.yaml`, `.faff/config.local.yaml`). After FAFF-1302 moved config under `.faff/`, the pattern `\.faff\/config(?:\.local)?\.ya?ml\b` stopped matching the wider class of config spellings a skill could hand-read undetected: YAML overlay variants (`.faff/config.dev.yaml`, `.faff/config-dev.yaml`), the extensionless read (`cat .faff/config`), and extensionless variant spellings (`.faff/config.local`, `.faff/config-dev`). This change widens the `.faff/` branch to the whole `.faff/config…`-spelling class. (Note: the deprecated root-tier `.faffrc` alternative in the same regex only ever matched its canonical name and extensionless form; the scope decision below addresses the `.faff/` branch only.)

**Design principles.**

- **A conservative completeness tripwire, not a precise file matcher.** The guard's job is to catch *any* hand-read spelling of a `.faff/config…` file so no spelling becomes a silent bypass of the FAFF-50 floor — dot- or hyphen-separated variants, with or without a `.yaml`/`.yml` suffix, and the bare extensionless name. It errs toward flagging: a hand-read of any `.faff/config`-prefixed file (including `.faff/config.json`, `.faff/config.lock`) is itself suspicious — a skill has no business shell-reading one — so flagging it is a feature, not a false positive. (This completeness-over-precision resolution was settled by the spec-review judge adjudicating FAFF-1322: see §6.)
- **Still exclude genuine non-config shapes.** Two shapes are not config-file reads and must stay unflagged: a path *under* a `.faff/config/` directory (`.faff/config/extra.yaml` — a `/` after `config`), and a longer word (`.faff/configuration.yaml` — a letter directly after `config`, no separator).
- **Fire only on an actual read command.** Broadening the config-path alternative must not let it match ordinary prose that merely mentions `.faff/config`; the command-verb prefix stays required, and the sanctioned `faff config get …` (no `.faff/` path) is never matched.
- **Preserve the `.example` carve-out.** The guard already skips any line containing `.example` (line-level, before the regex). That carve-out is independent of this pattern and must remain the thing that exempts `.faff/config.example.yaml` — the widened pattern is not relied on to exempt it.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/validate-adapters.js` (the `HANDREAD` const, ~line 1031, and its scan loop ~line 1032) | JavaScript | The guard being widened |
| `test/config-under-faff-dir.test.mjs` | Node test | FAFF-1302 config-location tests; sibling context, not the guard's own test |
| `test/validate-adapters.test.mjs` | Node test | The validate-adapters test file the new guard case joins |

**Scope statement.** A one-line hardening of an existing CI lint; it changes no runtime behaviour and no config resolution.

## 2. OUT OF SCOPE

- **The `.faffrc` (deprecated-tier) branch** — Why excluded: the filed regression is the `.faff/config` branch; `.faffrc` is a deprecated spelling on its way out and already matches both its canonical name and extensionless form. Extension point: the same `HANDREAD` const.
- **Any change to config resolution or the `faff config` CLI** — Why excluded: the guard only reads `SKILL.md` text; it does not touch how config is parsed. Extension point: `plugin/skills/faff/bin/lib/` config resolver modules.
- **Extracting the guard into its own standalone function/command** — Why excluded: unnecessary for the fix; the regex can be made independently testable with a minimal export. Extension point: `validate-adapters.js` exports.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Hand-read guard | The `HANDREAD` regex + scan loop in `validate-adapters.js` that fails the lint when a `SKILL.md` shell-reads a faff config file |
| Canonical names | `.faff/config.yaml` and `.faff/config.local.yaml` |
| `.faff/config` spelling class | Any `.faff/config` token continued by a `.`/`-`-separated run (with or without a `.yaml`/`.yml` suffix), or the bare name — but not a path under a `.faff/config/` directory and not a longer word like `configuration` |

**The pattern.** The guard's config-path alternative for the `.faff/` branch changes from:

```
\.faff\/config(?:\.local)?\.ya?ml\b
```

to a completeness class:

```
\.faff\/config(?:[.-][\w.-]*)?(?![\w.\-/])
```

Read: `.faff/config`, then an optional separator-led run `(?:[.-][\w.-]*)?` (a leading `.` or `-` then any run of word/dot/hyphen characters — covering `.yaml`, `.local`, `.local.yaml`, `-dev`, `.dev.yaml`, and the extensionless variants `.local`/`-dev`), then a negative lookahead `(?![\w.\-/])` asserting the token ends — the next character is not a word character, dot, hyphen, or slash. The lookahead is what excludes the two non-config shapes: a `/` after `config` (a directory path) and a letter after `config` (a longer word; no `.`/`-` separator to open the optional run, and the lookahead then fails on the letter). The command-verb prefix (`\b(?:cat|head|tail|less|grep|sed|awk)\b[^\n]*`) and the `.faffrc` alternative are unchanged; only the `.faff/config…` alternative is replaced.

**Case table (authoritative — the unit test below asserts exactly this set).** Each line is a `SKILL.md` line body; "flag" = the guard raises a `config access` violation.

| Line | Expected |
|---|---|
| `cat .faff/config.yaml` | flag (canonical) |
| `cat .faff/config.local.yaml` | flag (canonical overlay) |
| `cat .faff/config.dev.yaml` | flag (dot YAML variant) |
| `cat .faff/config-dev.yaml` | flag (hyphen YAML variant) |
| `cat .faff/config.local.dev.yaml` | flag (multi-segment variant) |
| `cat .faff/config.yml` | flag (`.yml` spelling) |
| `cat .faff/config` | flag (extensionless) |
| `cat .faff/config.local` | flag (extensionless variant) |
| `cat .faff/config-dev` | flag (extensionless hyphen variant) |
| `grep foo .faff/config` | flag (other read verb) |
| `cat .faff/config.json` | flag (conservative tripwire — any `.faff/config*` read) |
| `cat .faff/config.lock` | flag (conservative tripwire) |
| `cat .faff/config-notes.md` | flag (conservative tripwire) |
| `cat .faffrc.yaml` | flag (deprecated tier, unchanged) |
| `cat .faffrc` | flag (deprecated extensionless, unchanged) |
| `cat .faff/config/extra.yaml` | no flag (path under a config dir) |
| `cat .faff/configuration.yaml` | no flag (longer word, no separator) |
| `faff config get appetite` | no flag (the sanctioned CLI, no `.faff/` path) |
| `see docs about .faff/config layout` | no flag (prose, no read verb) |

**Design decision — the widened pattern.** Options: (a) enumerate the extra spellings explicitly (`config(?:\.local|\.dev)?`); (b) a two-arm YAML-or-bare class that excludes every non-YAML suffix (`config(?:(?:[.-][\w.-]*)?\.ya?ml\b|(?![\w.\-/]))`); (c) a completeness class that flags any separator-led continuation of `.faff/config`, with or without a YAML suffix, `config(?:[.-][\w.-]*)?(?![\w.\-/])`. Option (a) re-narrows to a fixed list — the exact failure being fixed. Option (b) is precise but silently misses extensionless *variants* (`.faff/config.local`, `.faff/config-dev`): a fail-open bypass for exactly the machine-local overlay the guard most needs to protect. Option (c) catches the whole spelling class including extensionless variants, accepting that structurally-identical non-config spellings (`.faff/config.json`) are flagged too — a conservative tripwire, since hand-reading any `.faff/config*` file is itself illegitimate. **Chosen:** option (c) — `\.faff\/config(?:[.-][\w.-]*)?(?![\w.\-/])`.

**Design decision — scope of the widening.** **Chosen:** widen the `.faff/config` branch only, leaving the `.faffrc` alternative byte-identical (the `.faffrc` deprecated tier is out of scope for the filed regression).

**Design decision — how the regex becomes testable.** The `HANDREAD` const currently lives inside the scan function and is not exported, so no test can assert against it directly. **Chosen:** export the `HANDREAD` regex (as `validate-adapters.test.mjs` already imports `SKILL_LINE_BASELINE`/`ANCHOR_PHRASES` from the module) and unit-test the pattern against the §3 case table. (`test/config-under-faff-dir.test.mjs` already drives the full validator over one-line `SKILL.md` fixtures, so the fixture route is an acceptable fallback if the export proves awkward, but the case-table unit test is the primary approach.)

## 4. HOW — Behavior

**Approach.** One-line change to the `HANDREAD` const's `.faff/config` alternative, plus an export of the const, plus a unit test over the §3 case table. No change to the scan loop, the `.example` line-skip, or the failure message.

```
PROCEDURE widen_handread_guard:
  1. In validate-adapters.js, replace the .faff/config alternative
     `\.faff\/config(?:\.local)?\.ya?ml\b`
     with
     `\.faff\/config(?:[.-][\w.-]*)?(?![\w.\-/])`.
     Leave the command-verb prefix and the `.faffrc` alternative unchanged.
  2. Export the HANDREAD const from the module (alongside the existing exports).
  3. Add a unit test asserting the §3 case table, line by line.
```

**Edge cases** (mechanism, restated; all enumerated in the §3 case table):

- `.faff/config.example.yaml` — exempted by the existing `.example` line-skip, which runs before the regex; the widened pattern is not responsible for exempting it. The carve-out's protection is checked by the §7 assumption (a named code-inspection observation), not by a case-table row.
- A path under a `.faff/config/` directory (`.faff/config/extra.yaml`) — NOT matched: the lookahead `(?![\w.\-/])` rejects the `/`.
- `.faff/configuration.yaml` — NOT matched: a letter follows `config`, so the optional separator-run takes nothing and the lookahead fails on the letter.
- Prose mentioning `.faff/config` with no read verb, and the sanctioned `faff config get …` — not matched: the command-verb prefix is required and the CLI form has no `.faff/` path.

**Failure modes.**

- **The failure:** the change newly flags a line in a shipped `SKILL.md` that was passing before, breaking the "real shipped tree passes clean" regression guard. **How you'd know:** `test/validate-adapters.test.mjs`'s shipped-tree regression test fails with a `config access` FAIL naming a specific skill + line. **What it means:** inspect that line — it is almost certainly a genuine hand-read to fix in that skill (the completeness pattern only widens coverage); if it is prose, tighten the pattern. Do not merge with the regression guard red.
- **The failure:** the pattern over- or under-matches a §3 case. **How you'd know:** a case-table row gives the wrong result in the new unit test. **What it means:** adjust the optional separator-run or the `(?![\w.\-/])` lookahead; proceed once the whole case table is green.

**Anti-pattern:** re-enumerating specific variant names (`config(?:\.local|\.dev)?`). Why: it silently re-narrows to a fixed list and reintroduces this exact bug the next time someone adds an overlay variant.

## 5. Scenarios

```
Given a SKILL.md line `cat .faff/config.local.yaml` (a canonical name)
When validate-adapters runs its hand-read guard
Then the guard flags the line as a config access violation (no regression)
```

```
Given a SKILL.md line `cat .faff/config.local` (an extensionless overlay-variant read)
When validate-adapters runs its hand-read guard
Then the guard flags the line as a config access violation
```

```
Given a SKILL.md line `cat .faff/config-dev.yaml` (hyphen-joined variant)
When validate-adapters runs its hand-read guard
Then the guard flags the line as a config access violation
```

```
Given a SKILL.md line `cat .faff/config/extra.yaml` (a path under a .faff/config directory)
When validate-adapters runs its hand-read guard
Then the line is NOT flagged
```

```
Given a SKILL.md line that mentions `.faff/config` in prose with no read command, and a separate line reading `.faff/config.example.yaml`
When validate-adapters runs its hand-read guard
Then neither line is flagged (no verb on the prose line; the `.example` line is skipped)
```

## 6. DESIGN DECISION RATIONALE

- **Which pattern?** Explicit enumeration vs precise two-arm YAML-or-bare class vs completeness class. **Chosen:** `\.faff\/config(?:[.-][\w.-]*)?(?![\w.\-/])`. A precise class that required a `.yaml` suffix for every variant missed extensionless variant spellings (`.faff/config.local`, `.faff/config-dev`) — a fail-open bypass for the machine-local overlay. The spec-review judge adjudicating this ticket ruled the guard's governing principle is spelling-completeness without silent bypass (the `.faffrc` precedent already guards extensionless forms), so the completeness class is chosen even though it also flags structurally-identical non-config spellings like `.faff/config.json` — a conservative tripwire, acceptable because hand-reading any `.faff/config*` file is illegitimate. Only genuine non-config shapes (a directory path, a longer word) stay excluded.
- **How wide?** `.faff/config` branch only — the `.faffrc` deprecated tier is out of scope for the filed regression.
- **How to test?** Export `HANDREAD` and unit-test it against the §3 case table — smaller, precise, consistent with the test file's existing module-export usage.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** the `.example` line-skip at the top of the guard's scan loop remains in place. Validation: confirm the `if (line.includes(".example")) continue;` line still precedes the `HANDREAD` match in `validate-adapters.js` before relying on it for the `.example` carve-out.

## 8. DONE — Definition of Done

### From WHY
- [ ] A hand-read of a dot-separated `.faff/` YAML overlay variant (`cat .faff/config.dev.yaml`) in a `SKILL.md` is flagged by the guard.
- [ ] A hand-read of a hyphen-joined variant (`cat .faff/config-dev.yaml`) is flagged by the guard.
- [ ] A hand-read of extensionless `.faff/config` (`cat .faff/config`) and of extensionless variants (`cat .faff/config.local`, `cat .faff/config-dev`) is flagged by the guard.

### From WHAT (pattern)
- [ ] The `.faff/config` alternative of `HANDREAD` is `\.faff\/config(?:[.-][\w.-]*)?(?![\w.\-/])`; the command-verb prefix and the `.faffrc` alternative are byte-identical to before.
- [ ] The canonical names (`cat .faff/config.yaml`, `cat .faff/config.local.yaml`) are still flagged (no regression) — both are positive rows in the §3 case table.

### From HOW (behaviour + edges)
- [ ] A path under a `.faff/config/` directory (`.faff/config/extra.yaml`) and a longer word (`.faff/configuration.yaml`) are NOT flagged.
- [ ] A verb-free prose mention of `.faff/config` and the sanctioned `faff config get …` are NOT flagged.
- [ ] A `.faff/config.example.yaml` line is NOT flagged (existing `.example` line-skip; checked by the §7 assumption's code-inspection observation).

### From HOW (test + export)
- [ ] `HANDREAD` (or an equivalent tested handle) is exported from `validate-adapters.js`.
- [ ] A unit test in `test/validate-adapters.test.mjs` asserts every row of the §3 case table (all positive and all negative lines) and is run by the suite.
- [ ] The full test suite passes, including the "real shipped tree passes every charter rule clean" regression guard.

**Integration smoke test:**

```
Build a one-line SKILL.md body `cat .faff/config.dev.yaml`, run the
validate-adapters config-access guard over it, and assert it returns a
`config access` failure. Build a second body `cat .faff/config/extra.yaml`
and assert it does NOT. If both hold (and a `faff config get` line also
passes), the completeness guard is wired in.
```

confidence: high
spec-review: accept (judge, L3-provisional)
build-tier: standard

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
