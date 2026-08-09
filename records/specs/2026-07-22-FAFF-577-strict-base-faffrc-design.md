# FAFF-577 — Strict base `.faffrc.yaml`: a malformed config fails loud, never silently defaults

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-577.

This spec settles the re-decision FAFF-577 asks for: what faff does when the base `.faffrc.yaml` has real content but parses to nothing. It is written for the build agent implementing the change and for human reviewers checking the policy call. The decision taken: **strict base parsing with an operator escape hatch**, plus two named carve-outs so the diagnosis and watchdog surfaces keep working.

## 1. WHY — problem and principles

**The load-bearing model.** faff's two-file config resolution deliberately treats its halves differently today: the machine-local overlay fails loud on malformed content (FAFF-387), but the committed base silently coerces to `{}`. Because `parseYamlSubset` is a forgiving line-based parser that never throws, a base file that is a top-level sequence or is wholly mis-indented reads as an empty document — and every configured value, including budget spend ceilings and sentry kill-switch thresholds, then resolves from built-in defaults with no signal anywhere. This spec closes that asymmetry: the base adopts the same malformed-content detection the overlay already uses, and the response policy is decided per surface so loudness never disables the machinery it protects.

**Problem statement.** A mangled base `.faffrc.yaml` parses to `{}` and both config chokepoints (`loadConfig` in `config.js`, `readGovernanceConfig` in `budget.js`) silently coerce it to defaults. FAFF-50 was minted to kill exactly this silent-default failure, and FAFF-387 killed it for the overlay — but deliberately kept the base lenient, and the stakes have since risen from dropped slots to degraded spend and kill-switch ceilings. This change makes a malformed base a loud, named failure at the moment of every read, with a documented escape hatch for operators who need to limp.

**Design principles.**

**Loudness must be unswallowable.** Several call sites wrap `loadConfig` in try/catch and degrade (`state.js` swallows to `specDir = null`; `validate-adapters.js` catches). If the only signal were the thrown error, a catching caller would re-silence the failure. So the warning is written to stderr at the chokepoint itself, *before* the throw — no caller can convert a malformed base back into a silent default.

**The watchdog must never die of a config fault.** The sentry poller consumes `faff sentry check` as a subprocess and treats any non-zero exit as a fault; repeated faults hit its fault cap and the poller exits. A strict exit inside `sentry check` would therefore kill the very kill-switch machinery whose ceilings this change protects. `sentry check` degrades loud instead: built-in default thresholds, a warning, and a visible flag in its payload.

**The diagnosis surface must be able to describe the fault.** `faff config check` exists to report config posture; today it silently coerces a malformed base to `{}` and reports "clean". It must report the malformed base as a finding — and must never strict-abort on it, or the one command that names the problem would refuse to run.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node (dep-free) | `parseYamlSubset` (never throws), `hasMeaningfulYamlContent`, `parseOverlayStrict` — the overlay's strict machinery this change generalises |
| `plugin/skills/faff/bin/lib/config.js` | Node | `loadConfig` (factory chokepoint, ~23 call sites), the CLI error handler with the `overlay-parse-error` branch, `computeConfigCheck` / `cmdConfigCheck` |
| `plugin/skills/faff/bin/lib/budget.js` | Node | `readGovernanceConfig` (governance chokepoint — budget/sentry/economics/corrective), with the existing loud legacy-filename exit 2 |
| `plugin/skills/faff/bin/lib/sentry.js`, `sentry-poller.js` | Node | `sentry check` reads governance config every cycle; the poller spawns it and fault-caps on non-zero exits |
| `plugin/skills/faff/bin/lib/lights-out.js` | Node | L4 preflight refusals table (the `budget-ceiling` refusal precedent) |
| `test/config-two-file.test.mjs`, `test/config-defaults.test.mjs` | Node test | Where the overlay strictness and default application are covered today |
| `plugin/skills/faff/SKILL.md` → Configuration | Markdown | The gateway's config documentation, which states the current base-lenient model |

**Scope statement.** This change lives entirely inside the bundled dependency-free `faff` CLI's config-read layer plus its documentation — no skill-prose control flow, tracker behaviour, or slot mechanics change.

## 2. OUT OF SCOPE

- **Overlay behaviour** — already strict (FAFF-387); untouched. Extension point: the shared strict-parse helper both halves now call.
- **`parseYamlSubset` upgrades** — the parser stays forgiving and never throws (FAFF-262 lineage). Strictness is a *policy at the read chokepoints*, not a parser change. Extension point: the chokepoint helper in `shared-infra.js`.
- **Automated repair** — no `config init` repair mode. Recovery for a malformed base is `git diff` / `git checkout .faffrc.yaml` (the FAFF-387 committed-base posture is the backup story) or a hand fix.
- **Per-key validation** (wrong types, unknown keys) — this change detects a *structurally* malformed document only. Key-level validation remains `faff config check`'s advisory territory. Extension point: `computeConfigCheck`.

## 3. WHAT — vocabulary, shapes, and surfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Malformed base | The base file exists, is unreadable OR parses to a non-map OR parses to an empty map while having meaningful content |
| Meaningful content | ≥1 line that is not blank, not a `#` comment, not a `---` document marker (`hasMeaningfulYamlContent`, unchanged) |
| Chokepoint | One of the two functions every base read flows through: `loadConfig` (factory) and `readGovernanceConfig` (governance) |
| Escape hatch | The env var `FAFF_CONFIG_BASE_LENIENT=1`: downgrade the throw to warn-and-proceed-on-`{}` |

**The shared strict parse.** Generalise the overlay's existing strict read into one helper both halves call:

```
FUNCTION parseConfigMapStrict(filePath, errorName):
  text = read file                       # unreadable → error(errorName, detail "unreadable (…)")
  parsed = parseYamlSubset(text)
  emptyMap = parsed is a plain map AND has zero keys
  IF parsed is not a plain map, OR (emptyMap AND hasMeaningfulYamlContent(text)):
    error(errorName, detail "does not parse to a mapping (malformed YAML — …)")
  RETURN parsed                          # {} from an empty/comment-only file is VALID
```

`parseOverlayStrict(path)` becomes a thin wrapper: `parseConfigMapStrict(path, "overlay-parse-error")` — byte-identical overlay behaviour. The base read uses error name `base-parse-error`, carrying the same `{file, detail}` fields.

**Per-surface behaviour on a malformed base.**

| Surface | Behaviour |
|---|---|
| `loadConfig` (factory chokepoint) | Write the warning to stderr, then throw `base-parse-error`. The `faff config` CLI handler gains a `base-parse-error` branch → exit 2, mirroring its `overlay-parse-error` branch. |
| `readGovernanceConfig` (governance chokepoint) | Same warn-then-throw — it must **throw**, never `process.exit`, so `sentry check` can catch it. The budget/economics/corrective CLI entries catch it and exit 2 with the governance-flavoured message ("a governance ceiling must not disappear on a malformed file" — the same stance its legacy-filename error already takes). |
| `faff config check` | Never throws for this: reports the malformed base as an `error` finding (exit 1), naming the file and the parse detail. |
| `faff sentry check` | Catches `base-parse-error`: proceeds on built-in default thresholds, sets a `config_malformed: true` field in its JSON payload, and exits as it otherwise would — the poller stays alive and the degradation is visible in the payload and poller log. |
| Escape hatch set (`FAFF_CONFIG_BASE_LENIENT=1`) | Both chokepoints warn on every read and proceed with `{}` — current behaviour plus unmissable noise. |
| L4 lights-out preflight | Refuses to mint when the escape hatch env var is set (a new refusal entry alongside `budget-ceiling`): a lights-out run must never start with governance-read leniency armed. |

**Unchanged valid states.** Absent base (all defaults), empty base, comment-only base — all still resolve `{}` silently. Only *meaningful content that fails to parse as a mapping* changes behaviour. The worktree fallback (a linked checkout resolving the main checkout's config) is untouched: strictness applies to whichever file `findConfig` resolves.

**Known detection limit (same as the overlay's).** A bare scalar line without a colon (`just some text`) parses as a key with a null value — a non-empty map the signal does not flag. This matches the overlay's existing tolerance exactly (one shared implementation, one shared limit); tightening it is per-key validation territory, out of scope. Cover it as a deliberate negative test so the limit is documented, not accidental.

**The warning line (both chokepoints, stderr only).** One line, naming file, detail, consequence, remedy:

```
faff: .faffrc.yaml is malformed (<detail>) — configured values (including budget/sentry
ceilings) would silently fall back to built-in defaults. Fix the file (git diff / git
checkout .faffrc.yaml), or set FAFF_CONFIG_BASE_LENIENT=1 to proceed on defaults loudly.
```

Stdout stays pure for `--json` consumers — the warning never contaminates machine-read output.

## 4. HOW — behaviour

**Approach.** All changes sit at the two chokepoints plus three consumers; no call site outside them needs editing. `loadConfig`'s base half swaps its lenient coerce (`isPlainConfigMap(baseRaw) ? baseRaw : {}`) for the strict helper; `readGovernanceConfig` swaps its lenient tail the same way. The `faff config` command's existing error ladder gains one branch. `cmdConfigCheck` replaces its own silent coerce with detection-as-finding. `cmdSentry`'s check path wraps its governance read. The lights-out preflight adds one refusal probe.

```
PROCEDURE base read at a chokepoint:
  1. Resolve the base path (findConfig — legacy-name errors unchanged)
  2. IF no file: return {}                              # all-defaults, silent, unchanged
  3. Attempt parseConfigMapStrict(path, "base-parse-error")
  4. ON malformed:
     a. Write the one-line warning to stderr            # ALWAYS — before any throw
     b. IF FAFF_CONFIG_BASE_LENIENT=1: return {}        # loud-lenient
     c. ELSE: throw base-parse-error {file, detail}     # strict
```

**Edge cases.**

- **Catching call sites** (`state.js` swallows to null; `validate-adapters.js`, `engine.js`, `fixtures.js`, `profile.js` catch): behaviour at those sites may stay degraded-but-defined — the chokepoint warning has already fired, so no swallow re-silences the failure. No per-site edits required; do not add any.
- **Ledger-pinned budget envelopes**: a run whose ledger recorded its envelope at mint keeps budget enforcement even if the base goes malformed mid-run (`envelopeFromLedger`); sentry thresholds re-resolve each cycle and take the `sentry check` degradation path. Both now surface the fault instead of hiding it.
- **`faff doctor` / hooks**: `prepcheck` and `runcheck` read no config (verified) — no hook-blocking hazard.
- **Error precedence**: legacy-filename errors (`legacy-config-name`) still fire first (they are `findConfig`'s, upstream of the parse); `base-parse-error` fires only for a canonically-named, resolvable file.

**Failure modes.**

- **The hatch left permanently set.** An operator sets `FAFF_CONFIG_BASE_LENIENT=1` to limp past an incident and forgets it. How you'd notice: the warning fires on *every* read (it is not once-per-day), and an L4 mint refuses outright. What it means: intended — the hatch is for limping, not living.
- **Strictness breaks a repo whose base has been silently malformed all along.** Such a repo has been running on pure defaults; after this change its faff commands exit non-zero until the file is fixed. How you'd notice: the exit is loud, names the file and the remedy, and the CHANGELOG entry flags the behaviour change. What it means: proceed — this is precisely the re-decision the ticket asks for, and the hatch is the mitigation.

**Anti-pattern:** making `parseYamlSubset` itself throw. Why: the parser is shared by surfaces that legitimately read partial/foreign documents (`config init` round-trip checks, selftests); strictness is the chokepoints' policy, not the parser's.

**Anti-pattern:** homing the escape hatch in config. Why: the config file is the broken artifact — a knob inside it can't be read. Env var, per the `FAFF_APPETITE` / `FAFF_WORKTREE_ROOT` precedent.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a base .faffrc.yaml whose content is a top-level YAML sequence
When any `faff config get <key>` runs
Then it exits 2, stderr carries the one-line malformed-base warning naming the file, and stdout is empty
```

```
Given the same malformed base
When `faff budget check` (or any governance CLI entry) runs
Then it exits 2 with the governance-flavoured message, and no ceiling silently resolves from defaults
```

```
Given the same malformed base and FAFF_CONFIG_BASE_LENIENT=1 in the environment
When `faff config get <key>` runs
Then it proceeds exactly as today (defaults), exits 0, and stderr still carries the warning
```

```
Given the same malformed base
When `faff sentry check --json` runs
Then it exits as it otherwise would, thresholds resolve from built-in defaults, and the JSON payload carries config_malformed: true
```

```
Given an empty (or comment-only) base .faffrc.yaml
When any faff command runs
Then behaviour is byte-for-byte today's: {} resolved silently, no warning, exit codes unchanged
```

- The L4 preflight MUST refuse to mint a lights-out ledger while `FAFF_CONFIG_BASE_LENIENT` is set, with a refusal entry naming the hatch.

## 6. DESIGN DECISION RATIONALE

**Warn-only or strict?** Warn-only (the ticket's minimum) keeps every repo running but repeats FAFF-387's half-measure — a warning during an unattended run scrolls past nobody; the run still executes with degraded ceilings. Strict matches the repo's every precedent: the overlay throws, the legacy *filename* already exits 2 in `readGovernanceConfig` itself with the rationale "a governance ceiling must not disappear on a filename mistake" — malformed *content* is the same stakes in the same function. **Chosen:** strict at both chokepoints, with the escape hatch and the two carve-outs below. The warn-only floor still exists inside it (the warning always fires, hatch or no hatch).

**Where does detection live?** The signal (non-map, or empty-map-with-meaningful-content) already exists for the overlay. **Chosen:** generalise `parseOverlayStrict` into `parseConfigMapStrict(filePath, errorName)` in `shared-infra.js`; overlay and base become two callers of one implementation — no second detection copy to drift.

**How is loudness guaranteed against catching callers?** **Chosen:** the stderr warning writes at the chokepoint *before* the throw, so a caller's try/catch can degrade behaviour but never re-silence the failure. No call-site audit or edits needed — loud by construction.

**Escape hatch form?** A config key can't work (the config is the broken artifact); a CLI flag can't reach the ~23 indirect call sites. **Chosen:** env var `FAFF_CONFIG_BASE_LENIENT=1`, per the existing `FAFF_APPETITE` / `FAFF_WORKTREE_ROOT` env-override precedent; documented in the gateway Configuration section.

**What does `faff config check` do?** It must be able to *describe* the fault it exists to catch. **Chosen:** malformed base is an `error`-severity finding (exit 1), never an exit-2 abort; its current silent coerce (`config.js` check-1 read) is replaced by detection-as-finding.

**What does the sentry path do?** A strict exit in `sentry check` would fault-cap the poller and kill the watchdog — loudness would disable the machinery it protects. **Chosen:** `sentry check` catches `base-parse-error`, proceeds on built-in default thresholds, and flags `config_malformed: true` in its payload; the poller stays alive, the degradation is visible. The built-in defaults are the conservative floor, so the kill-switch still functions.

**Does L4 tolerate the hatch?** A lights-out run with leniency armed could silently lose mid-run sentry-threshold config. **Chosen:** the lights-out preflight refuses to mint while the hatch env var is set — one new refusal entry, following the `budget-ceiling` refusal's shape. (Mid-run hatch-setting is out of reach by design: the preflight gate is where refusal is enforceable, per the existing preflight model.)

**Stale comments.** The now-false "base lenient is load-bearing back-compat" notes (`shared-infra.js` overlay-strict comment block, `config.js` `loadConfig` header) must be rewritten to state the new rule forward, or they will mislead the next reader into re-introducing the asymmetry. **Chosen:** update both comment blocks + the gateway Configuration prose + a CHANGELOG entry naming the behaviour change and the hatch.

## 7. Open questions and assumptions

**Open questions.** None — every decision above is closed.

**Assumptions.**

- **Assumes:** `parseOverlayStrict` and `hasMeaningfulYamlContent` exist in `shared-infra.js` with the malformed signal described (validate: read `shared-infra.js:473-512` before starting).
- **Assumes:** the sentry poller consumes `faff sentry check` only as a spawned subprocess whose non-zero exit is a counted fault (validate: `sentry-poller.js` `gatherFacts` — the spawn + `checkFault` handling).

## 8. DONE — definition of done

### From WHY
- [ ] A base file with meaningful content parsing to empty/non-map no longer silently resolves defaults on any CLI surface — every such read either fails loud (non-zero exit; exit 2 with the documented message on the `faff config` and governance entries) or proceeds with the stderr warning fired.

### From WHAT (shapes and surfaces)
- [ ] `parseConfigMapStrict(filePath, errorName)` exists in `shared-infra.js`; `parseOverlayStrict` delegates to it; overlay behaviour is byte-identical (existing overlay tests pass unmodified).
- [ ] `loadConfig` throws `base-parse-error {file, detail}` on a malformed base; the `faff config` CLI handler exits 2 with the documented message shape.
- [ ] `readGovernanceConfig` does the same with the governance-flavoured message; `faff budget check` on a malformed base exits 2.
- [ ] `FAFF_CONFIG_BASE_LENIENT=1` downgrades both chokepoints to warn-and-proceed-on-`{}`; the warning fires on every read; stdout stays clean.
- [ ] Absent, empty, and comment-only base files behave byte-for-byte as today (no warning, `{}`/defaults, exit codes unchanged).

### From HOW (behaviour and carve-outs)
- [ ] The stderr warning is written at the chokepoint before the throw (verified by a test that catches the throw and still observes the warning on stderr).
- [ ] `faff config check` reports a malformed base as an `error` finding (exit 1) naming file + detail; it never exit-2 aborts on this fault.
- [ ] `faff sentry check` on a malformed base exits as it otherwise would, resolves built-in default thresholds, and carries `config_malformed: true` in its JSON payload.
- [ ] The lights-out preflight refuses to mint while `FAFF_CONFIG_BASE_LENIENT` is set, with a named refusal entry.

### From docs
- [ ] The stale base-lenient comment blocks in `shared-infra.js` and `config.js` are rewritten to the new rule; the gateway Configuration section documents strict-base + hatch; CHANGELOG names the behaviour change.

### Tests
- [ ] Selftest/`test/*.test.mjs` rows cover: top-level-sequence base, wholly mis-indented base, unreadable base, empty base, comment-only base, the bare-scalar-line negative case (documented limit — not flagged), hatch on/off, governance path, config check finding, sentry check degradation, preflight refusal.

**Integration smoke test:**

```
1. Write .faffrc.yaml containing "- just\n- a\n- list\n"
2. Run `faff config get appetite`        → expect exit 2 + stderr warning
3. Run `FAFF_CONFIG_BASE_LENIENT=1 faff config get appetite` → expect exit 0, "high" (default), stderr warning
4. Run `faff config check`               → expect exit 1, malformed-base error finding
5. Restore a valid .faffrc.yaml          → expect all three clean again
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** — No issues. One 1–3 day unit: a shared helper, two chokepoint edits, three consumer carve-outs, one preflight probe, tests and docs. The detection and the response policy ship together by necessity (strictness without the carve-outs would kill the watchdog; carve-outs without strictness change nothing), so there is no independent-concern split; nothing here is an always-ships-together sibling of another open ticket.
- **Workstream fit? (principles 1 + 5)** — No issues. Outcome-named work: it closes the FAFF-50 silent-default failure class on the base file, completing what FAFF-387 did for the overlay. It sits squarely in the external-critique hardening batch this run is draining (with FAFF-553 and FAFF-574) and is cohesive with the config/governance substrate — no cross-stream sprawl.
- **Deps surfaced? (principle 6)** — One heads-up, no blocker link needed: FAFF-553 (sentry wall-clock false-trip, in this same run) also edits `sentry.js`. That is a same-surface build collision, not a dependency — the build queue's conflict analysis should serialise the two rather than a human adding a blocker edge. Both specs stand alone; neither load-bears on the other's output.
- **Risk profile? (principle 7)** — No de-risking spike needed. No novel integration, no external dependency; the one deliberate behaviour break (a previously-limping malformed base now fails loud) is mitigated in-spec by the escape hatch, the named remedy in the error line, and the CHANGELOG entry.

confidence: high
spec-review: approve
