# FAFF-624 — Lights-out convergence-forcing guardrail: force the within-run convergence loop at L4 in code

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-624.

An nlspec design spec for **FAFF-624** — the code enforcement that makes "within-run convergence is non-optional at L4" a machine guarantee rather than an agent-conformance one. Audience: the build agent implementing the `lights-out.js` / `config.js` change, and the human reviewer checking the enforcement shape against the FAFF-534 decision it discharges.

## 1. WHY — Problem and Principles

**The load-bearing model.** The guardrail **forces, it never consults**. There are exactly two places code can make L4 convergence non-optional: (1) the **mint** — stamp the forced posture into the L4 run-ledger's dial profile, the same way the mint already forces `appetite: full` (FAFF-308); and (2) the **read chokepoint** — the one CLI channel the prose layer is allowed to read config through (`faff config get`), which under a live L4 run answers `true` for `convergence.enabled` regardless of what the file says. Together they close the conformance gap: a conforming occupant sees the forced stamp; a *non*-conforming occupant that consults the knob anyway gets the forced answer from the only read channel that exists (CLI-only config access is already the gateway rule). At no point does any L4 decision *branch* on the configured value — the value is inert at L4 by design (FAFF-534's named anti-pattern).

**Problem statement.** FAFF-534 shipped convergence as always-on at L4, but delivered the L4 guarantee by beep-boop skill prose alone — a non-conforming occupant could still file-and-defer discovered scope. This ticket adds the code guarantee behind the prose, sequenced immediately behind the flip to keep the unenforced window short.

**Design principle — force at the seams that already exist, add none.** The mint's `dial_profile` and `resolveAppetite`'s level-scoped resolution channel are shipped, tested seams built for exactly this shape of guarantee. The enforcement must reuse both rather than invent a new mechanism (a ninth guardrail entry, a new env var, a new preflight refusal). Anything that adds a new refusal path or a new consult path is out of shape.

**Design principle — safety was never the gap; conformance is.** The terminator (`faff run-done`), the `max_waves` backstop, and the mandatory L4 spend/time ceiling are all code-enforced independently. This change may therefore never *refuse* a mint over convergence config — there is nothing unsafe to refuse. It only forces.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/lights-out.js` — `assembleLightsOutPreflight` | Code | Forces `const appetite = "full"` (FAFF-308) and assembles `dial_profile {appetite, slots, gates}`; shared verbatim by mint and `--resume` (FAFF-527), so one edit covers both. The template this ticket follows. |
| `plugin/skills/faff/bin/lib/lights-out.js` — `mintLightsOut` / `renderLightsOutBanner` | Code | Persists `dial_profile` into the L4 run-ledger; renders the trust banner. The stamp and its visible surface. |
| `plugin/skills/faff/bin/lib/config.js` — `resolveAppetite` + `cmdConfig get` appetite special-case | Code | The level-scoped resolution brace: live-L4-ledger detection via `readLedger` + `overlayHeartbeat` + `runIsHeld`, fail-safe fall-through to config. The pattern `resolveConvergence` mirrors. |
| `plugin/skills/faff/bin/lib/config.js` — `DEFAULTS` registry + `config defaults --selftest` | Code | Registry currently has no `convergence.*` key; the selftest carries an expected-keys list that must be extended in step with the registry. |
| `plugin/skills/faff-beep-boop/SKILL.md` L112, L225–230 | Skill prose | The loop itself (prose, post-FAFF-534): forced at L4, `convergence.enabled` / `--no-converge` honoured only at L3. Unchanged by this ticket. |
| `docs/specs/2026-07-23-faff-534-within-run-convergence-default-posture-design.md` | Committed spec | The substrate decision: posture shipped as prose/config; the code guarantee explicitly deferred here; the "never consult" anti-pattern. |
| `test/lights-out.test.mjs`, in-file `lightsOutSelftest`, config selftests | Tests | The existing test surfaces the new assertions extend. |

**Scope statement.** This sits entirely in the faff CLI (`lights-out.js` + `config.js`): it changes what the L4 mint records and what the config read channel answers under a live L4 run — nothing about the loop's own mechanics.

## Already shipped against this surface

- **FAFF-534** (Done, PR #466) — the posture/prose flip (`enabled: true` default, `--no-converge` door, L4-non-optional prose). Explicitly defers the code guarantee to this ticket; substrate, not overlap.
- **FAFF-540** (Done) — the non-convergence backstop's reset trigger (build-queue admission). Orthogonal to enforcement.
- **FAFF-308** (Done) — appetite level-scoping. The template mechanism; it does not touch convergence.

Premise holds — no Done work delivers the code forcing.

## 2. OUT OF SCOPE

- **The beep-boop prose loop and its L3 opt-out semantics** — shipped by FAFF-534; unchanged. **Extension point:** `plugin/skills/faff-beep-boop/SKILL.md` steps 8.0/8.5.
- **`--converge` / `--no-converge` flag parsing in JS** — the flags are skill-prose-only (no JS argv parses them); teaching the CLI to parse beep-boop's flags is a different, larger change with no consumer today. The code guarantee binds the config channel and the ledger instead. **Extension point:** a future beep-boop CLI entrypoint would validate mutual exclusion mechanically.
- **`convergence.max_waves` value, semantics, or registry default** — the backstop is untouched; its config read keeps today's behaviour. **Extension point:** the `DEFAULTS` registry, if a later ticket wants the count code-defaulted.
- **A ninth entry in `LIGHTS_OUT_GUARDRAILS`** — rejected as mechanism (see §6 Decision A); noted here so the build agent doesn't add one "for completeness."
- **Retro-stamping existing/in-flight L4 ledgers** — the stamp applies at mint going forward; no migration.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| The stamp | `dial_profile.convergence: "forced"` — the mint-time record that this run's convergence is level-forced |
| The brace | `resolveConvergence` — the read-chokepoint resolver behind `faff config get convergence.enabled` |
| Live L4 run | A ledger with `level: "L4"` whose owner is running with a fresh heartbeat, per the canonical `runIsHeld` predicate (heartbeat-file overlay applied first) |

**The stamp (ledger surface).**

```
RECORD dial_profile:                 # existing record, one field added
  appetite: "full"                   # existing — FAFF-308 forcing
  convergence: "forced"              # NEW — constant at L4; no other value is ever written
  slots: { review, spec_review }     # existing
  gates: <occupant>                  # existing
```

`"forced"` (not `true`) is deliberate: the field records *why* the loop runs (level-forced), not a boolean an occupant might mistake for a consultable knob.

**The brace (resolver surface).**

```
FUNCTION resolveConvergence(cfg, env = process.env) -> "true" | "false"
  # Precedence: LIVE-L4 ledger (FAFF_RUN_DIR, level L4, runIsHeld) -> "true" unconditionally
  #             else config `convergence.enabled` verbatim
  #             else registry default "true"
  # NO env-var channel — see §6 Decision B.
```

Registry addition: `DEFAULTS["convergence.enabled"] = "true"` — the code default now matches the shipped `.faffrc.example.yaml` default FAFF-534 flipped, so a config-less repo's `faff config get convergence.enabled` answers `true` (exit 0) instead of exit 3.

**Design decisions:** collected in §6; every mechanism choice below carries a marker there.

## 4. HOW — Behavior

**Behaviour summary.** One field stamped at preflight assembly, one banner token, one resolver + one `cmdConfig get` special-case, one registry default. No new refusal, no new flag, no new file.

```
PROCEDURE force_convergence_at_L4:
  1. assembleLightsOutPreflight (lights-out.js):
     a. Alongside `const appetite = "full"`, set `const convergence = "forced"`.
     b. Add `convergence` to the assembled `dial_profile`.
     c. NEVER read cfg `convergence.enabled` anywhere in this file — the value is
        inert at L4; no probe, no refusal, no branch derives from it.
  2. mintLightsOut: no change needed — `dial_profile` (now carrying the stamp) is
     already persisted into the ledger and echoed in the --json output.
  3. renderLightsOutBanner: the `level:` line additionally reads
        `convergence: forced`
     (a constant of the L4 surface, like the level token itself — rendered
     unconditionally, derived from no probe).
  4. --resume: no change needed, for a different reason than the mint — the resume
     re-fires assembleLightsOutPreflight (so the re-assembled dial_profile carries the
     stamp), but applyResumeToLedger deliberately never rewrites the ledger's
     dial_profile (it is a mint-time record). Any ledger minted after this change
     already carries the stamp; a pre-change legacy ledger resumed post-change keeps
     its stamp-less dial_profile — tolerated (no retro-stamping, per OUT OF SCOPE),
     and harmless because the brace (step 5) keys on level + liveness, never on the
     stamp.
  5. config.js — resolveConvergence(cfg, env):
     a. IF env.FAFF_RUN_DIR set:
        - readLedger(runDir); overlayHeartbeat(ledger, readHeartbeatFile(runDir))
        - IF ledger.level === "L4" AND runIsHeld(ledger, now, env)  -> return "true"
        - any throw / absent / malformed / non-L4 / stale ledger    -> fall through
     b. v := dig(cfg, "convergence.enabled"); IF set -> return fmt(v)
     c. return DEFAULTS["convergence.enabled"]   # "true"
  6. cmdConfig get: special-case `key === "convergence.enabled"` through
     resolveConvergence, exactly as `appetite` routes through resolveAppetite
     (guarded to this one key; every other key byte-for-byte unchanged).
  7. DEFAULTS registry: add "convergence.enabled": "true"; extend the
     `config defaults --selftest` expected-keys list in step.
```

**Edge cases.**
- **`convergence.enabled: false` in config, live L4 run:** `faff config get convergence.enabled` → `true` (the brace overrides); the ledger stamp reads `forced`. The mint neither warns nor refuses — inert means inert.
- **`convergence.enabled: false`, no live L4 run (plain L3):** → `false` verbatim — the L3 opt-out door FAFF-534 preserved is untouched.
- **Dead / abandoned / stale-heartbeat L4 ledger under `FAFF_RUN_DIR`:** falls through to config — mirrors `resolveAppetite`'s FAFF-378 rule (a dead run's ledger never pins). Note the fail-safe direction *differs benignly* from appetite's: falling through here yields the config value or default `true`, and staleness can only stop forcing a loop on a run that is no longer live — never disable convergence on a live L4 run.
- **Malformed/unreadable ledger:** caught, fall through — never fabricate a live-L4 answer, never crash a config read.
- **Config-less repo:** registry default → `true`, exit 0 (was exit 3 / caller-default before; see §6 Decision C for why this is the intended behaviour change).
- **Quoted config scalars (`enabled: "false"`):** returned via the existing `fmt` path exactly as any other config scalar today — this resolver adds no new coercion.

**Failure modes.**

- **The failure:** the brace only binds occupants that actually read config through `faff config get`; a rogue occupant hand-reading the YAML bypasses it. **How you'd know:** `faff validate-adapters` already fails any skill that shell-reads the rc file (the CI gate), and an L4 ledger whose events show file-and-defer with no step-8.0 fold. **What it means:** proceed — CLI-only config access is a separately-enforced gateway invariant; this ticket's guarantee composes with it rather than re-delivering it.
- **The failure:** the live-run detection (`runIsHeld`) could misjudge liveness mid-run (e.g. a heartbeat gap during a long build), momentarily answering config instead of forced-true. **How you'd know:** a config-get trace under an active run returning `false` while the ledger owner is `running`. **What it means:** proceed — the same liveness window already governs `resolveAppetite` with no observed incident, and the prose layer's primary keying is the ledger `level` itself, not this read; the brace is the belt for non-conforming reads, not the primary channel.

**Anti-pattern:** making `lightsOutPreflight` refuse (or even warn) when config carries `enabled: false`. Why: FAFF-534 defines the value as *inert* at L4 — a refusal would turn an explicitly-harmless stale config line into a mint outage, and reading the knob to decide anything at L4 is the exact consult the guardrail exists to prevent.

**Anti-pattern:** adding an env-var override channel (a `FAFF_CONVERGE` sibling of `FAFF_APPETITE`). Why: appetite's env belt exists to *export* the forced value; a convergence env channel's only additional power would be to *disable* forcing — precisely the door this ticket closes. See §6 Decision B.

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose config sets convergence.enabled: false
When `faff lights-out` mints an L4 run (preflight otherwise green)
Then the mint proceeds (no refusal, no warning naming convergence), the ledger's
     dial_profile carries convergence: "forced", and the banner names it
```

```
Given a live L4 run (FAFF_RUN_DIR set, ledger level L4, owner running, fresh heartbeat)
     and config convergence.enabled: false
When `faff config get convergence.enabled` runs
Then it prints `true` (exit 0) — the brace overrides the file
```

```
Given FAFF_RUN_DIR pointing at a DONE (or stale-heartbeat) L4 ledger
     and config convergence.enabled: false
When `faff config get convergence.enabled` runs
Then it prints `false` — a dead run's ledger never forces
```

```
Given an L4 run minted after this change and later resumed via `faff lights-out --resume <id>`
When the resumed ledger is read
Then its dial_profile still carries convergence: "forced" (the mint-time record survives
     the resume untouched), and `faff config get convergence.enabled` under the live
     resumed run answers `true`
```

- `lights-out.js` MUST contain no read of `convergence.enabled` (grep-clean) — the forcing writes a constant; it consults nothing.

## 6. DESIGN DECISION RATIONALE

**Decision A — enforcement mechanism: guardrail-set entry vs mint-stamp + read-chokepoint brace?**

| Option | Pro | Con |
|---|---|---|
| (a) Ninth `LIGHTS_OUT_GUARDRAILS` entry | Shows up in the 8→9 banner count | Every entry pairs with a CLI contract answering `--selftest`; the loop is prose with no contract to probe — the entry would need a fake or trivial probe, diluting what "guardrail: live" means |
| (b) Mint stamp only (the literal `appetite: full` line) | Minimal | Binds only conforming occupants — the exact gap the ticket exists to close |
| (c) **Mint stamp + `resolveConvergence` brace at `faff config get`** | The full FAFF-308 belt-and-brace shipped for the same problem shape; the brace binds even an occupant that consults the knob | Touches two files instead of one |

**Chosen:** (c). The issue's own template (`appetite: full`) is in fact both halves — FAFF-308 shipped the mint forcing *and* the `resolveAppetite` chokepoint — so following the template faithfully means shipping both. (a) is rejected: a probe-less guardrail entry weakens the guardrail vocabulary FAFF-305 made honest.

**Decision B — should an env-var channel (`FAFF_CONVERGE`) exist, mirroring `FAFF_APPETITE`?**

**Chosen:** no env channel. `FAFF_APPETITE` is a fast-path *export* of the forced value for subagent shells; convergence's consumers all hold `FAFF_RUN_DIR` (the ledger brace's key) already, and an env channel here could only add a way to *override toward off* — the door this ticket closes. Precedence is therefore ledger → config → default, with nothing above the ledger.

**Decision C — add `convergence.enabled` to the `DEFAULTS` registry?**

- Today the key resolves only from the file; a config-less repo gets exit 3 and the caller's `-d` default. FAFF-534 made the shipped example default `true` but left no code registry entry, so the CLI channel and the shipped example can disagree for a config-less repo.
- The brace makes `faff config get convergence.enabled` the enforcement chokepoint — a chokepoint that answers "unset" is not a chokepoint.

**Chosen:** add `"convergence.enabled": "true"` to `DEFAULTS` (and the defaults-selftest expected list). This is a deliberate, narrow behaviour change (exit 3 → `true`/exit 0 on the unset key) aligned with the FAFF-534 posture; `max_waves` is deliberately *not* registered (out of scope — its prose default stands).

**Decision D — where does the forced posture surface to a human?**

**Chosen:** the banner's `level:` line gains `convergence: forced`, and the ledger/`--json` carry it via `dial_profile`. Rendered unconditionally as a constant of the L4 surface (like the level token), never derived from a probe — the banner stays 1:1 derivable from mint state. No new banner section; one token on an existing line.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None.

**Assumptions.**
- **Assumes:** the beep-boop prose layer reads `convergence.enabled` only via `faff config get` (the gateway CLI-only config rule, mechanically linted by `faff validate-adapters`). **Validate:** grep beep-boop SKILL.md for any non-CLI read of the rc file before build; the lint gate must be green.
- **Assumes:** `runIsHeld`, `overlayHeartbeat`, `readHeartbeatFile`, and `readLedger` remain importable in `config.js` exactly as `resolveAppetite` imports them today (no new cycle). **Validate:** `resolveAppetite`'s existing imports at the top of `config.js` — reuse the same requires.

## 8. DONE — Definition of Done

### From WHAT (stamp)
- [ ] `assembleLightsOutPreflight` sets `convergence: "forced"` in `dial_profile`; the minted ledger and the `--json` output carry it.
- [ ] A post-change-minted ledger's stamp survives `--resume` untouched (resume never rewrites `dial_profile`); a legacy stamp-less ledger resumes without error and the brace still forces (test-asserted).

### From WHAT (brace)
- [ ] `resolveConvergence(cfg, env)` exists in `config.js` with precedence live-L4-ledger → config → registry default, no env channel; exported alongside `resolveAppetite`.
- [ ] `cmdConfig get convergence.enabled` routes through it; every other key's resolution is byte-for-byte unchanged.
- [ ] `DEFAULTS["convergence.enabled"] === "true"`; `config defaults --selftest` expected-keys list extended and green.

### From HOW (behaviour)
- [ ] Live-L4 + config `false` → `get` prints `true`; dead/stale/non-L4/malformed ledger → config value verbatim; config-less → `true` exit 0.
- [ ] A mint under config `enabled: false` proceeds with no convergence-named refusal or warning; grep of `lights-out.js` finds no read of `convergence.enabled`.
- [ ] Banner `level:` line carries `convergence: forced` on every L4 banner (proceed and refuse renders alike, since it is a constant of the surface).

### From tests
- [ ] `lightsOutSelftest` gains stamp + banner assertions; `test/lights-out.test.mjs` gains the mint-under-`enabled:false` inertness case and the resume-parity case.
- [ ] config selftest/test gains the resolveConvergence precedence cases (live-L4 override, stale-ledger fall-through, registry default).

**Integration smoke test.**
```
1. In a scratch repo: write convergence.enabled: false; faff lights-out --check --json (contained env)
   -> proceed path shows dial_profile.convergence "forced" on a real mint; no convergence refusal.
2. With FAFF_RUN_DIR at the minted run: faff config get convergence.enabled -> true.
3. Mark the ledger owner done: same get -> false (config verbatim).
4. rm config: same get -> true, exit 0.
   If all hold -> the stamp and the brace are connected end-to-end.
```

confidence: high
spec-review: approve
