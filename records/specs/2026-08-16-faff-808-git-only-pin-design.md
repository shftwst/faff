# Spec: git-only pin for `tracking.tracker`

> Spec: faffter-dark-nlspec · 2026-08-15 · interactive · confidence: high

This is the buildable spec for FAFF-808, "Add a git-only pin — force git-only regardless of a discovered tracker MCP." The change touches three surfaces in the faff plugin: the tracker classifier (`plugin/skills/faff/bin/lib/tracker.js`), the shared resolution ladder prose (`plugin/skills/faff/SKILL.md`), and one config-check linter (`plugin/skills/faff/bin/lib/config.js`).

## 1. WHY — Problem and Principles

**The model to hold in your head:** `tracking.tracker` today has two meanings — a non-empty string is a *pin* asserting "a connector named this exists, so never downgrade to git-only," and blank/absent is *unpinned* meaning "discover before you conclude anything." This change adds a third meaning on the same key: a reserved value that asserts the symmetric opposite of a connector pin — "this repo is git-only, so never *upgrade* to tracker-mode even if a tracker MCP is visible." One key, three resolutions: `pinned`, `unpinned`, and the new `git-only`.

**Problem statement.** faff has no way to say "this repo is git-only": an unpinned repo falls to git-only only if harness discovery finds no tracker MCP, so any repo with no tracker relationship still resolves tracker-bound whenever a tracker MCP is globally connected (for example Linear configured in `~/.claude.json`, which is bind-mounted into the claude-box cage). This surfaced on the P1 link-shortener exercise (FAFF-310): a git-only system-under-test could not be run git-only, and the only workaround was launching claude with `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` to hide every MCP server. This change gives the repo a positive assertion so the operator states "git-only" once in config instead of reaching for a blunt run-level lever.

**Design principle — symmetric inverse of the connector pin, honoured before discovery.** A connector pin (`tracking.tracker: linear`) means "MUST NOT downgrade to git-only." The git-only pin means "MUST NOT upgrade to tracker-mode." Both are operator assertions resolved deterministically, before any harness discovery attempt. Reject any implementation that resolves the git-only pin by first attempting discovery, or that lets a visible tracker MCP override the pin.

**Design principle — one resolution knob, no new boolean key.** The surface is a reserved sentinel value on the existing `tracking.tracker` key, not a new `tracking.git_only: true` key. This keeps a single resolution knob and keeps the git-only assertion visually adjacent to the connector pin it inverts.

**Reference context.**

| System | Relevance |
|---|---|
| `tracker.js` | `classifyTracker` and its `TRACKER_CASES` selftest; `cmdTracker` implements `faff tracker probe`. The change centres here. |
| `SKILL.md` (Tracker availability resolution, ~lines 178–185) | The single canonical resolution ladder seven skills reference. A git-only pin is a new step-1 branch here. |
| `config.js` (check 7, ~lines 1481–1494) | The `automation_default: opt-out` warning keys off the pin; a git-only pin must be treated like git-only there (no warn). |
| `eligible.js` | Already correct: selftest row `[[[], "opt-out", false], true]` makes opt-out the on-switch in git-only mode. No change; named so the build agent does not touch it. |

## 2. OUT OF SCOPE

- **A new `tracking.git_only` boolean key** — the settled design puts the assertion on `tracking.tracker` as a reserved value.
- **A `config set` value allowlist for `tracking.tracker`** — it has no value validator today (only `git_host` does), so the reserved value writes and round-trips unchanged.
- **Harness discovery mechanics** — the git-only pin is resolved before discovery, so it does not touch how Codex/Claude Code enumerate tracker tools.
- **Per-skill edits to the seven consumers** — they reference the shared resolution rule, so this is a change to the shared ladder plus the classifier, not seven edits.
- **`faff eligible`'s git-only handling** — already treats git-only as the opt-out on-switch and takes tracker-presence as an explicit `--tracker` argument from the caller.

## 3. WHAT — Vocabulary, Types, Interfaces

| Term | Definition |
|---|---|
| Connector pin | A non-empty `tracking.tracker` naming a tracker (e.g. `linear`). Asserts the connector exists; resolution `pinned`. |
| git-only pin | The reserved `tracking.tracker` value asserting the repo is git-only. Resolution `git-only`, `pin: null`. |
| Unpinned | Blank/absent. Resolution `unpinned`; discover before concluding git-only. |
| Reserved value | Canonical `none`; alias `git-only` (both resolve identically, matched case-insensitively after trimming). |

**Chosen:** canonical reserved value is `none`, with `git-only` as an accepted alias. Rationale: `none` reads naturally as "no tracker" on the key and is short; `git-only` is accepted because it is the word faff already uses for this mode. Both normalise to the same `git-only` resolution.

The classifier's return shape gains a third `resolution` value:
```
pin: String | null      # connector name when resolution == "pinned"; null otherwise
resolution: "pinned" | "unpinned" | "git-only"
# resolution == "git-only" => pin == null (the reserved value names no connector)
```

`faff tracker probe`: plain mode prints the bare resolution (now also `git-only`); `--json` prints `{ "pin": null, "resolution": "git-only" }`.

## 4. HOW — Behavior

**classifyTracker** — check the reserved sentinel after the blank/unpinned check, before the connector-pin fall-through:
```
1. raw <- dig(data, "tracking.tracker")
2. IF raw null/undefined OR trim == "": RETURN { pin: null, resolution: "unpinned" }
3. trimmed <- trim(String(raw))
4. IF lowercase(trimmed) IN { "none", "git-only" }: RETURN { pin: null, resolution: "git-only" }
5. RETURN { pin: trimmed, resolution: "pinned" }
```
**Anti-pattern:** returning `pin: "none"` for git-only — `pin` is the connector name; the reserved value names none, so `pin` MUST be `null`.
**Anti-pattern:** case-sensitive or un-trimmed matching — `None` / `  git-only  ` must classify identically (parity with the connector-pin trim).

**TRACKER_CASES additions:** `none`, `git-only`, `NONE`, `"  none  "`, `Git-Only` → `{pin:null, resolution:"git-only"}`; plus a `linear` regression row → `{pin:"linear", resolution:"pinned"}`. Existing blank/whitespace/absent rows stay `unpinned`.

**faff tracker probe:** no change to `cmdTracker` — it already prints `out.resolution` / `JSON.stringify(out)` and exits 0; the new resolution flows through. Do not add a git-only special-case; do not make it exit non-zero.

**Gateway resolution ladder (SKILL.md):** amend step 1 to recognise three `faff tracker probe` outcomes:
- `git-only` → resolve git-only immediately: NO discovery, and MUST NOT upgrade to tracker-mode even if a tracker MCP is visible. Short-circuits steps 2 (discovery) and 4 (unreachable fault).
- `pinned` → connector assertion; MUST NOT downgrade to git-only (unchanged).
- `unpinned` → discover before concluding absence (unchanged).

State the symmetric-inverse invariant and that the seven consuming skills inherit the git-only outcome by reference (no per-skill edit).
**Anti-pattern:** adding a git-only check to any individual skill's prose — the rule is single-sourced.

**Config validation (config.js check 7):** narrow the `pinned` test so the reserved value is excluded, keeping trim/lowercase parity with `classifyTracker` (replicated inline, not `require("./tracker")` — the existing cycle-avoidance comment):
```
trimmed <- (pinRaw null/undef) ? "" : trim(String(pinRaw))
pinned  <- trimmed != "" AND NOT (lowercase(trimmed) IN {"none","git-only"})
IF pinned AND automation_default == "opt-out": warn(...)   # message unchanged
```
So a connector pin + opt-out still warns; a git-only pin + opt-out does not. Add `configCheckSelftest` rows for the git-only-no-warn cases (canonical/alias/mixed-case) and retain the connector-pin-warns row.

**Failure mode — a caller keys off `pin` truthiness instead of `resolution`.** For a git-only pin `pin` is `null`, so such a caller reads it as unpinned, discovers a visible tracker MCP, and wrongly upgrades — the exact bug, one layer up. The grep confirms no bin/lib module branches on `classifyTracker`'s return beyond `cmdTracker`; consumers must branch on `resolution`, which is why the ladder is written in terms of the three resolution values.

## 5. Scenarios

```
Given a repo whose .faffrc sets tracking.tracker: none
  And a tracker MCP is connected this session (e.g. Linear in ~/.claude.json)
When a faff sub-skill resolves tracker-vs-git-only on entry
Then it resolves git-only, makes no discovery attempt, and does not upgrade to tracker-mode
```
```
Given tracking.tracker: none
When `faff tracker probe --json` runs
Then it prints { "pin": null, "resolution": "git-only" } and exits 0
```
```
Given tracking.tracker: git-only (alias form)
When `faff tracker probe` runs in plain mode
Then it prints `git-only` and exits 0
```
```
Given `faff tracker probe --selftest` runs
Then the git-only rows (none, git-only, NONE, "  none  ", Git-Only) all pass, and existing rows still pass
```
```
Given tracking.tracker: none and automation_default: opt-out
When `faff config check` runs
Then no warning is emitted on surface automation_default
```
```
Given tracking.tracker: linear and automation_default: opt-out
When `faff config check` runs
Then a warning IS emitted on surface automation_default and it exits 1
```
- No faff sub-skill creates, claims, or updates a tracker issue for a repo pinned `tracking.tracker: none`, even with a reachable tracker MCP.

## 6. Design decision rationale

**Surface (settled):** reserved value on `tracking.tracker` (canonical `none`, alias `git-only`), the symmetric inverse of the connector pin — one knob, no contradiction case a second boolean would introduce.
**Canonical value:** `none` canonical, `git-only` an identical alias — accepting both means neither choice surprises; naming one canonical gives docs/normalisation a single target.
**Where resolved:** before discovery, short-circuiting — resolving after discovery would let a visible tracker MCP influence the outcome (the bug).
**Linter recognition:** replicate the trim/lowercase/membership check inline in `config.js` (avoids the known `require("./tracker")` cycle); selftests on both surfaces keep them from diverging.

## 7. Open questions and assumptions

**Open questions:** None. Surface, canonical value, and resolution ordering are settled.

**Assumes:** `tracking.tracker` has no `config set` value allowlist today (only `git_host` is guarded) — so `none`/`git-only` write and round-trip without a validator change. Validate: `grep -n "validateTrackerValue\|tracking.tracker" config.js`.
**Assumes:** no faff-supported tracker (Linear, GitHub Issues, Jira) is named `none` or `git-only`, so the reserved value shadows no real connector.
**Assumes:** no bin/lib module branches on `classifyTracker`'s return beyond `cmdTracker`. Validate: `grep -rn "classifyTracker" plugin/skills/faff/bin/lib/`. If a consumer exists, verify it branches on `resolution`, not `pin` truthiness.

## 8. DONE — Definition of Done

- [ ] A repo with `tracking.tracker: none` resolves git-only even with a tracker MCP connected (no upgrade to tracker-mode).
- [ ] `classifyTracker` returns `{ pin: null, resolution: "git-only" }` for the reserved value; `pin` is never the literal `none`/`git-only`.
- [ ] The reserved value is matched case-insensitively and trimmed, for `none` and `git-only`.
- [ ] A whitespace-only value still returns `unpinned`; a real connector name still returns `pinned`.
- [ ] `faff tracker probe` prints `git-only` (plain) / `{ "pin": null, "resolution": "git-only" }` (`--json`, exit 0); `cmdTracker` otherwise unchanged.
- [ ] `TRACKER_CASES` covers the git-only rows + a `linear` regression row; `--selftest` passes.
- [ ] SKILL.md ladder step 1 recognises `git-only` as a third outcome, resolved before discovery, short-circuiting steps 2/4, with the symmetric-inverse invariant and the seven-skill inheritance note.
- [ ] `config check` does not warn on `opt-out` under a git-only pin, still warns under a connector pin (exit 1); recognition replicated inline; `configCheckSelftest` rows added.
- [ ] No faff sub-skill creates/claims/updates a tracker issue for a git-only-pinned repo.

**Smoke test:** scratch repo with `tracking.tracker: none` + `automation_default: opt-out` → `probe --json` gives `{pin:null,resolution:"git-only"}` exit 0; `config check` no warn; flip to `linear` → `config check` warns, exit 1; `tracker probe --selftest` + `config check --selftest` both pass.

confidence: high
