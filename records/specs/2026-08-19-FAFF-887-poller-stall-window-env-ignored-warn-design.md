# FAFF-887 — Make the poller's `FAFF_RUN_HEARTBEAT_STALE_SECS` no-op LOUD

> Spec: faffter-dark-nlspec · 2026-08-19 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-887.
>
> build-tier: complex
>
> spec-review: approve

**Artifact:** a buildable spec for FAFF-887 (Bug). **Audience:** the build agent that will implement it, and the human reviewers who gate it. This spec settles *how* to make an already-diagnosed silent no-op operator-visible; the root-cause diagnosis is given (and cross-checked against source below), so the build agent should implement the decisions here rather than re-deriving them.

---

## 1. WHY — Problem and Principles

**The load-bearing model: faff has two independent staleness lanes that share one default but not one lever.** The heartbeat-staleness window is resolved twice, by two different code paths, from two different override sources. The **runcheck lane** (the `runcheck` / `sentrycheck` Stop hooks) reads `FAFF_RUN_HEARTBEAT_STALE_SECS` from the environment. The **poller lane** (the detached `sentry-poller`, and the interactive `faff sentry check` it shells out to) reads `sentry.stall_window_secs` from `.faffrc`. Both *default* to the same constant (`900`), which is exactly why the split is invisible until someone tries to move one lane and watches the other refuse to follow. This is a settled, intentional design split (FAFF-362) — this ticket does **not** merge the lanes; it makes the moment an operator addresses the wrong lane *loud instead of silent*.

**Problem statement.** An operator who wants the detached poller to tolerate a longer quiet period sets `FAFF_RUN_HEARTBEAT_STALE_SECS=7200` and forwards it into the cage, and the poller silently ignores it — it keeps reading `sentry.stall_window_secs` (unset → default `900`), trips the wall-clock/stale abort at 900s, and writes an abort record showing `stall_window_secs: 900`. The env var *does* reach the process (the poller inherits the orchestrator's env unscrubbed), so the operator has no signal that they picked the wrong knob. This change makes that wrong-lane condition emit an operator-visible warning that names the correct key, reachable *after* a real abort.

**Design principles.**

**The poller stays config-native — the fix is a warning, not a new input.** Do not teach the poller (or `sentryThresholds`) to read `FAFF_RUN_HEARTBEAT_STALE_SECS`. `sentry.stall_window_secs` remains the sole, documented lever for the poller lane. Any implementation that changes the poller's *effective window* in response to the env var is wrong by construction — the regression test in §5 pins exactly this.

**The warning must survive detachment.** The detached poller runs with `stdio: "ignore"`, so a stderr/stdout write from inside the poller process is thrown on the floor. A warning that only prints there is as silent as the bug. The primary warning channel therefore MUST be one that persists into the run's `events.jsonl` (which the operator reads after a false abort), not a console write in a detached process.

**Warn only on the true wrong-lane case.** The warning fires when the env var is set *and* the config lever is unset — the genuine silent-no-op. When the config lever is set, the operator is using the correct knob; do not nag them for also having the env var in scope (it legitimately drives the *other* lane).

**Reference context** (verified against source — the build agent should read these before touching them):

| System | Location | Relevance |
|---|---|---|
| `sentryThresholds(cfg, profile)` | `plugin/skills/faff/bin/lib/sentry.js:295-307` | Poller-lane resolver. 5 keys, each `cfg (via dig()) → profile default`. Never reads `process.env`. **Do not change its inputs.** |
| `cmdSentry` check branch | `sentry.js:1088-1239` | Has `cfg` (1116-1121), `process.env`, `th` (1127), and the `--json` payload (1221) all in one scope. The warn is sited here. |
| `config_malformed` field | `sentry.js:1221` (payload), `1232` (human-path warn) | **Exact precedent** for a boolean advisory that rides the payload into the poller log *and* prints on the human path. Model the new field on it. |
| `heartbeatStaleSecs(env)` | `runcheck.js:84-92` | The **only** reader of `FAFF_RUN_HEARTBEAT_STALE_SECS`. Runcheck lane. **Do not change.** |
| `RUN_HEARTBEAT_STALE_SECS_DEFAULT = 900` | `shared-infra.js:28` | Shared constant. Both lanes default to it (`governance-profile.js:114-126` sets `sentry.thresholds.stall_window_secs` from it). **Do not change the default.** |
| Poller `--json` → `events.jsonl` | `sentry-poller.js:248` (spawnSync `sentry check`), `288-296` (writes `decision.payload` into a `sentry-checkpoint` event **on the abort tick only**, D10 — never per-tick) | The path that carries the payload advisory field to where the operator sees it *after* an abort — precisely the false-abort investigation moment. |
| `cmdStart` | `sentry-poller.js:352-390`; dispatch `470-484` | Arm-time, pre-detach, operator-visible. Already imports `readGovernanceConfig` (line 52); `root` is available at the call site (line 477-482) to pass in. Secondary warn locus. |
| Design-split provenance | `records/specs/2026-07-13-FAFF-362-governance-profiles-design.md:109-113` | Documents that `stall_window_secs` intentionally references the shared constant while the env override stays "runcheck-only". This spec acknowledges, not supersedes, that split. |
| AC3 config-path test | `test/sentry.test.mjs:184-194` | Covers the config lever (`sentry.stall_window_secs: 5` trips a 10s heartbeat). New tests belong beside it. |
| Poller stall fixture | `test/sentry-poller.test.mjs:49-63` | Derives `STALL_WINDOW_SECS` from committed `.faffrc.yaml`. Regression test belongs beside it. |
| Config doc | `.faffrc.example.yaml:238-248` | Documents `sentry.stall_window_secs`, no mention of the env var. Doc target. |

**Scope statement.** This sits at the seam between the poller-lane threshold resolver (`sentry.js`) and the operator's env-forwarding into the cage; it is the companion knob-divergence defect to FAFF-877 (heartbeat-starvation), which it explicitly does not fix.

---

## 2. OUT OF SCOPE

- **Teaching the poller the env var** — Why excluded: the settled fix direction is config-native + warn; honouring the env var would merge the two lanes. Extension point: if the lanes are ever unified, it would be in `sentryThresholds` (`sentry.js:295`) layering an env override the way `heartbeatStaleSecs` does — but that is a separate, larger change.
- **Unifying the runcheck and poller lanes** — Why excluded: the split is intentional (FAFF-362) and load-bearing for other behaviour; unifying is a design change, not a bug fix. Extension point: a future spec reconciling `heartbeatStaleSecs` (`runcheck.js:84`) and `sentryThresholds` (`sentry.js:295`) onto one resolver. Noted as a Punt in §7, not built here.
- **Changing the 900s default** — Why excluded: the default is correct and shared across both lanes via `RUN_HEARTBEAT_STALE_SECS_DEFAULT` (`shared-infra.js:28`); changing it is out of this ticket's intent. Extension point: `governance-profile.js:114-126`.
- **Changing the runcheck lane's env behaviour** — Why excluded: the runcheck lane correctly honours the env var; this ticket only touches the poller lane's *silence*, not runcheck's *behaviour*. Extension point: `runcheck.js:84-143`.
- **Fixing heartbeat-starvation** — Why excluded: that is FAFF-877's scope. This ticket is the companion knob-divergence defect and cross-references it. Extension point: FAFF-877.
- **Scrubbing the env var out of the cage** — Why excluded: the env var reaching the process is harmless once the no-op is loud; scrubbing would be a transport-layer change and could mask, not fix, the divergence. Extension point: `sentry-poller.js:352-390` spawn options.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Poller lane | The detached `sentry-poller` + the `faff sentry check` it shells out to. Window comes from `sentry.stall_window_secs`. |
| Runcheck lane | The `runcheck` / `sentrycheck` Stop hooks. Window comes from `FAFF_RUN_HEARTBEAT_STALE_SECS` (via `heartbeatStaleSecs`). |
| Wrong-lane condition | `FAFF_RUN_HEARTBEAT_STALE_SECS` is set **and** `sentry.stall_window_secs` is unset — the operator moved the runcheck knob expecting the poller to follow. |
| Advisory field | A boolean that rides the `sentry check` `--json` payload verbatim into the `sentry-checkpoint` event, making a degradation machine-visible in `events.jsonl` (precedent: `config_malformed`). |

**The wrong-lane predicate.** A single shared helper is the source of truth for the condition, reused by every warn locus so they can never diverge on *when* to warn.

```
FUNCTION stallWindowEnvIgnored(env, cfg) -> Boolean:
  # env: the environment map (process.env). cfg: the loaded governance config.
  envSet    = env["FAFF_RUN_HEARTBEAT_STALE_SECS"] is present AND non-empty (after trim)
  configSet = dig(cfg, "sentry.stall_window_secs") is present (not null/undefined)
  RETURN envSet AND NOT configSet
```

- **Placement:** in `sentry.js`, exported alongside `sentryThresholds`, so `sentry-poller.js` imports the *same* predicate (it already imports from `sentry.js`, line 51).
- **`envSet`:** treat an empty / whitespace-only value as *not set* (an exported-but-empty env var is not a lever the operator meant to pull). Do **not** validate that it parses to a number here — a garbage value is still an operator forwarding *something* into the wrong lane, and warning on it is correct. (The runcheck lane's own numeric validation is unchanged and unrelated.)
- **`configSet`:** presence, not validity. A present-but-non-positive `sentry.stall_window_secs` (which `sentryThresholds` would reject and fall back on) still counts as "the operator is using the config lever" — the wrong-lane *silent no-op* is specifically the *unset* case. (See §4 failure modes for the narrow seam this leaves.)

**Advisory field on the `sentry check --json` payload.**

```
# Added to the payload object built at sentry.js:1221, mirroring config_malformed:
stall_window_env_ignored: Boolean   # always present; true only in the wrong-lane condition
```

Always present (false in the healthy case), exactly like `config_malformed` — so a machine reading `events.jsonl` never has to distinguish "absent" from "false".

**Design decision — warn locus + channel.**

Considered: (a) stderr from inside the poller only; (b) payload advisory field only; (c) payload field + human-path console warning + arm-time echo.

- (a) is invisible after a real abort — the poller's stderr is `stdio: "ignore"`. Rejected outright; it re-creates the bug.
- (b) alone covers the detached-abort case (the field lands in `events.jsonl`) but gives the operator running `faff sentry check` by hand nothing, and gives no signal at the moment they arm the poller.
- (c) covers all three moments an operator could notice, each reusing the one predicate.

**Chosen:** (c) — three loci, one predicate. (1) **Primary:** `stall_window_env_ignored` on the `--json` payload → rides into the `sentry-checkpoint` event in `events.jsonl` (survives detachment; this is the load-bearing channel). (2) **Human path:** a warning line on the non-`--json` branch of `cmdSentry`, on the same channel as the sibling `config_malformed` warning (`console.log`, `sentry.js:1232`), for the operator running `faff sentry check` interactively. (3) **Arm-time:** a warning from `cmdStart` (`sentry-poller.js`), printed pre-detach when the operator arms the poller with the wrong-lane condition already true — the earliest possible catch. Rationale: the primary channel guarantees post-abort visibility; the other two catch the operator earlier and cost only a predicate call each.

**Design decision — warn condition when both / conflicting.**

- **Both set** (env set, config set): **no warn.** The operator is using the correct lever; the env var legitimately drives the runcheck lane. Warning here would be noise on a correct configuration.
- **Env set to a value differing from an explicit config** (e.g. env `7200`, config `900`): folded into "both set" → **no warn.** Rationale: this is not a silent no-op — the config lever *is* being read and is authoritative for the poller; the env's inertness in this lane is by-design and (after this ticket) documented. Emitting a distinct "conflict" warning here would fire on the common, correct case of an operator who sets both knobs for their respective lanes.

**Chosen:** warn iff `stallWindowEnvIgnored(env, cfg)` — i.e. env set AND config unset. The differing-value conflict is deliberately *not* a separate warning (documented in §6 so it is not re-proposed).

---

## 4. HOW — Behavior

**Architecture and approach.** Add one exported predicate to `sentry.js`. Wire it into three existing sites, each of which already has (or can trivially obtain) `env` and `cfg` in scope. No new files, no new command, no change to any resolver's inputs or to the abort machinery.

**Primary — payload advisory field (the detachment-surviving channel).**

Summary: compute the flag once where the payload is built and attach it, so the poller writes it verbatim into `events.jsonl`.

```
# In cmdSentry, check branch (sentry.js ~1116-1221), after cfg is loaded (1116-1121):
1. envIgnored = stallWindowEnvIgnored(process.env, cfg)
2. Build payload as today, ADDING the field:
     payload = { ...existing fields (run_dir, verdicts, ..., config_malformed),
                 stall_window_env_ignored: envIgnored }
3. IF asJson: print payload as today (field now rides into the sentry-checkpoint event). RETURN.
4. IF NOT asJson (human path):
     a. IF envIgnored:
          console.log a warning naming the correct key (see message spec below)
     b. ...existing config_malformed / verdict prints unchanged...
```

The field placement is *additive* — every existing payload key and the exit contract are untouched.

**Message spec (human path + arm-time).** The warning MUST name `sentry.stall_window_secs` as the correct key and MUST state that `FAFF_RUN_HEARTBEAT_STALE_SECS` does not reach the poller. Suggested text (the build agent may refine wording, but these two facts are load-bearing):

```
sentry: WARNING — FAFF_RUN_HEARTBEAT_STALE_SECS is set but the detached poller /
`sentry check` staleness window is `sentry.stall_window_secs` (unset → default 900s).
The env var does not reach the poller; set `sentry.stall_window_secs` in .faffrc to
widen the poller window. (stall_window_env_ignored)
```

**Arm-time — `cmdStart` echo (pre-detach, operator-visible).**

Summary: at the moment the operator arms the poller, if the wrong-lane condition already holds, print the same warning before the child detaches.

```
# In cmdSentryPoller dispatch (sentry-poller.js:481-482): pass `root` into cmdStart.
# In cmdStart, before/around the spawn (line ~374):
1. cfg = readGovernanceConfig(root)   # already imported (line 52); tolerate a load fault (see below)
2. IF stallWindowEnvIgnored(process.env, cfg):
     process.stderr.write(the warning line)   # cmdStart is NOT detached; this is seen
3. ...spawn / handle-write unchanged...
```

- **Anti-pattern:** letting a config-load fault in `cmdStart` abort the arm. Why: the poller's whole point is to run even when config is degraded (see `config_malformed` handling in `cmdSentry`). Wrap the `readGovernanceConfig` for the *warn* in a try/catch that defaults to "no warn" on fault — the warning is advisory and must never block arming. (`cmdSentry`'s own path already flags `config_malformed` on the payload for the degraded case.)

**Edge cases and error handling.**

- **Env var present but empty/whitespace** → `envSet` false → no warn. (An exported-empty var is not a pulled lever.)
- **Env var garbage (non-numeric)** → `envSet` true → warn. The operator forwarded *something* into the wrong lane; naming the right key is still the correct response.
- **Config present but non-positive** (e.g. `0`, `-5`) → `configSet` true → no wrong-lane warn. `sentryThresholds` independently rejects it and falls back to the default; that is a *separate* (already-handled) config-validity concern, not the silent-no-op this ticket targets. Named in §4 failure modes.
- **Config load faults at arm time** → treat as no-warn (fault-tolerant); the payload path still surfaces `config_malformed` downstream.
- **`--json` vs human path** — the field is present in both; the console warning is human-path only (the poller uses `--json`, so it relies on the field, not the console line — correct, since the poller's console is ignored anyway).

**Failure modes.**

- **The failure:** the primary channel doesn't actually reach the operator — the field rides the `--json` payload but the poller doesn't write it into `events.jsonl` as assumed. **How you'd know:** the §5 scenario asserting `stall_window_env_ignored: true` in the `sentry-checkpoint` event fails. **What it means:** the payload → event write at `sentry-poller.js:288-296` doesn't pass the field through verbatim — narrow the fix to ensure it does (the field is inside the same payload object, so this should hold, but the test pins it).
- **The failure:** the warn condition is too narrow — a `configSet`-but-invalid value (`0`) silently no-ops *and* suppresses the warning, so an operator who typo'd the config value gets neither a working window nor a warning. **How you'd know:** manual reasoning; there is no scenario for it because it is out of this ticket's stated condition (the silent no-op targeted is the *unset* case). **What it means:** accept and document (§6) — folding invalid-config into the warn condition risks false positives on the fallback-to-default path `sentryThresholds` already handles loudly enough; a future ticket could tighten it.

---

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given FAFF_RUN_HEARTBEAT_STALE_SECS is set and sentry.stall_window_secs is unset
When an operator runs `faff sentry check` interactively (no --json)
Then a warning line is printed that names `sentry.stall_window_secs` as the correct key
And states that FAFF_RUN_HEARTBEAT_STALE_SECS does not reach the poller
```

```
Given sentry.stall_window_secs IS set in .faffrc (with or without FAFF_RUN_HEARTBEAT_STALE_SECS also set)
When `faff sentry check` runs
Then stall_window_env_ignored is false
And no wrong-lane warning is printed
```

```
Given FAFF_RUN_HEARTBEAT_STALE_SECS=7200 and sentry.stall_window_secs unset
When an operator runs `faff sentry-poller start`
Then a wrong-lane warning naming `sentry.stall_window_secs` is printed before the poller detaches
```

- The poller's effective staleness window MUST be unchanged by any value of `FAFF_RUN_HEARTBEAT_STALE_SECS` (regression pin: intentional non-honouring, so a future refactor can't start honouring it without failing this test and revisiting the decision).

---

## 6. Design Decision Rationale

**Where and on what channel does the wrong-lane warning fire?**
Options: poller-internal stderr (invisible under `stdio:"ignore"`); payload field only; payload field + human-path console + arm-time echo.
**Chosen:** payload field (`stall_window_env_ignored`) as the load-bearing post-abort channel, plus a human-path `console.log` warning in `cmdSentry` and a pre-detach `stderr` warning in `cmdStart` — all three gated by one shared predicate. Rationale: only the payload field survives detachment into `events.jsonl` where the operator looks after a false abort; the other two catch the operator earlier at near-zero cost and cannot drift from the primary because they share the predicate.

**When exactly does it warn — what about both-set / conflicting values?**
Options: warn on env-set-regardless; warn on env≠config conflict as a distinct case; warn only on env-set-AND-config-unset.
**Chosen:** warn iff env set AND config unset. Rationale: that is the *only* genuine silent no-op. When config is set, the operator is using the authoritative poller lever; the env var legitimately drives the runcheck lane, so warning would fire on correct configurations (including the deliberate both-lanes-tuned case). The differing-value case is folded in as "no warn" for the same reason — the config is read and authoritative, so it is not silent.

**Does this supersede the FAFF-362 lane split?**
**Chosen:** No — acknowledged, not superseded. `records/specs/2026-07-13-FAFF-362-governance-profiles-design.md:109-113` intentionally keeps `stall_window_secs` referencing the shared constant while leaving the env override runcheck-only. Config-native + warn keeps that split intact and merely makes the wrong-lane moment loud. Merging the lanes is a Punt (§7).

**Advisory field always-present vs present-only-when-true?**
**Chosen:** always present (false in the healthy case), mirroring `config_malformed` at `sentry.js:1221`. Rationale: consistency with the existing advisory-field convention; machine readers never distinguish absent from false.

At the time of writing, the poller inherits the orchestrator's env unscrubbed (`sentry-poller.js:352-390` spawns with no `env:` key) and `sentryThresholds` (`sentry.js:295-307`) reads no `process.env` — both verified against source. If either changes, the wrong-lane predicate and its placement should be revisited.

---

## 7. Open Questions and Assumptions

**Open Questions.**

- **Punt:** Unify the runcheck and poller staleness lanes onto a single resolver so one knob governs both — a larger design change, deliberately out of scope here (decides: architecture). Cross-reference FAFF-362's split and this ticket when it is picked up.

**Assumptions.**

- **Assumes:** the poller writes the `sentry check --json` payload verbatim (`decision.payload`) into the `sentry-checkpoint` event on the abort tick (`sentry-poller.js:288-296`, D10), so an additive payload field reaches `events.jsonl` on the abort the operator investigates, without further wiring. (Pre-abort visibility is covered separately by the arm-time and interactive loci, since the checkpoint event lands only on abort.) Validate: confirm `decision.payload` is serialized whole into the event `data`; the holdout scenario also pins it.
- **Assumes:** `readGovernanceConfig` and `dig` are importable into `sentry-poller.js` (already imports `readGovernanceConfig` from `./budget` at line 52; `dig` is exported from `./shared-infra`). Validate: confirm the imports; add `dig` to the existing `shared-infra` require if the predicate needs it there.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] Forwarding `FAFF_RUN_HEARTBEAT_STALE_SECS` with `sentry.stall_window_secs` unset produces an operator-visible warning naming `sentry.stall_window_secs` as the correct key, reachable after a real poller abort (present in the `events.jsonl` payload, not only on an ignored stderr).

### From WHAT (predicate + field)
- [ ] `stallWindowEnvIgnored(env, cfg)` is exported from `sentry.js` and returns true iff `FAFF_RUN_HEARTBEAT_STALE_SECS` is set-and-non-empty AND `sentry.stall_window_secs` is unset.
- [ ] Empty/whitespace `FAFF_RUN_HEARTBEAT_STALE_SECS` yields false (no warn).
- [ ] `stall_window_env_ignored` is present on the `sentry check --json` payload in every case (false in the healthy case, true in the wrong-lane case).

### From HOW (behaviour)
- [ ] The `sentry-checkpoint` event in `events.jsonl` carries `stall_window_env_ignored: true` in the wrong-lane condition.
- [ ] Interactive `faff sentry check` (no `--json`) prints a warning line naming `sentry.stall_window_secs` and stating the env var does not reach the poller, in the wrong-lane condition.
- [ ] `faff sentry-poller start` prints the same warning pre-detach in the wrong-lane condition, and a config-load fault at arm time does not block arming (defaults to no warn).
- [ ] With `sentry.stall_window_secs` set (env set or not), `stall_window_env_ignored` is false and no wrong-lane warning fires.

### From HOW (regression pin)
- [ ] A regression test asserts the poller's effective staleness window is unchanged by any `FAFF_RUN_HEARTBEAT_STALE_SECS` value (intentional non-honouring pinned).

### From WHAT/HOW (non-changes)
- [ ] `sentryThresholds` still reads no `process.env`; the 900s default is unchanged; `heartbeatStaleSecs` / the runcheck lane is unchanged.

### From docs
- [ ] `.faffrc.example.yaml` (near lines 238-248) states the poller / `sentry check` window is `sentry.stall_window_secs` and that `FAFF_RUN_HEARTBEAT_STALE_SECS` does not reach the poller.
- [ ] At least one guide (`docs/guide/unattended.md`) states the same and cross-references FAFF-877 for heartbeat-starvation.

**Integration smoke test.**

```
1. In a temp run dir with .faffrc having NO sentry.stall_window_secs:
2. Set env FAFF_RUN_HEARTBEAT_STALE_SECS=7200
3. Run `faff sentry check --json` → assert payload.stall_window_env_ignored === true
   AND payload.thresholds.stall_window_secs === 900 (env not honoured)
4. Add sentry.stall_window_secs: 1200 to .faffrc, rerun --json
   → assert payload.stall_window_env_ignored === false AND thresholds.stall_window_secs === 1200
```

If this connects, the predicate, the payload field, and the resolver-independence all work together.

---

confidence: high

---

## Methodology critique

_Lens: faffter-dark-methodology-agile-delivery (issue-critique). Advisory; does not gate._

**Right-sized? (principle 4) — No issues.** One coherent 1–2 day unit: a single exported predicate wired into three existing sites, an additive payload boolean, two doc edits, two tests. Do not split the three warn loci (they share one predicate precisely so they cannot diverge) and do not split code-from-docs (the doc edits are themselves operator-facing warning surfaces, part of the done-bar). The `build-tier: complex` label reads heavier than the actual code delta.

**Workstream fit? (principles 1+5) — No issues.** Correctly project-less in Backlog and correctly `related-to` FAFF-877 rather than merged into it: same incident and subsystem, different outcomes — FAFF-877 changes abort *behaviour*, FAFF-887 only makes a knob-divergence no-op *visible*. Merging would bundle a behaviour fix and an observability fix under one done.

**Deps surfaced? (principle 6) — No blockers; one coordination note.** FAFF-362 (lane-split provenance) is Done and cited as an acknowledged constraint; FAFF-877 is `related-to`, not `blockedBy` (neither's correctness depends on the other). Note: both live tickets edit `sentry-poller.js` and the `test/sentry-poller.test.mjs` fixture — file-level adjacency, not a build dependency; whichever ships second rebases. Flag the shared surface rather than adding a false `blockedBy`.

**Risk profile? (principle 7) — Low, self-de-risked; no spike.** Additive, in-process, no new integration or external dependency, models the existing `config_malformed` precedent. The one unknown (the poller serialises the `--json` payload verbatim into the checkpoint event) is already named as an explicit Assumes, called out as a failure mode, and pinned by the holdout scenario. Build-and-assert, no separate spike.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" } ] }
```