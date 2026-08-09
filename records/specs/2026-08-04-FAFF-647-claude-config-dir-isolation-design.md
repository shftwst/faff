# Spec — FAFF-647: a `claude -p` engine-call spawn gets its own `CLAUDE_CONFIG_DIR`, not the orchestrator's

> Spec: faffter-dark-nlspec · 2026-08-04 · autonomous · confidence: high. Full spec on Linear FAFF-647.

This is the build spec for FAFF-647, written for the coding agent who will implement it and the humans who review it before it lands. It carries ADR-0003's config-isolation lesson into the `faff engine call` seam so that the day someone builds the tool-needing `claude -p` transport (ADR-0054's reserved third branch), that transport cannot race the parent Claude Code session over shared global state. It is de-risking done before the branch exists, not firefighting done during it.

## 1. WHY — problem and principles

**The load-bearing idea.** A nested `claude -p` and the Claude Code session that spawned it both reach for the same global config file (`~/.claude.json`, and the wider `~/.claude` directory) unless you tell the child to look somewhere else. The one lever that tells it to look elsewhere is the `CLAUDE_CONFIG_DIR` environment variable: point the child at a fresh directory and it stops sharing mutable state with its parent. Everything in this spec is about pulling that one lever, correctly, at the one seam where a `claude -p` child will one day be spawned — and pulling it in a place a future author cannot route around.

**Problem statement.** ADR-0003 recorded a real crash: a nested `claude -p` raced its parent session over the shared `~/.claude.json` and died instantly on a corrupted read. The eval driver already fixed this for its own reps by giving each one its own `CLAUDE_CONFIG_DIR` (FAFF-138) and cleaning the dirs up afterwards (FAFF-139), but that isolation has never reached the `faff engine call` seam — because that seam has only ever spawned codex, which is hands-off (`--sandbox read-only`, `--ephemeral`, throwaway cwd) and so never touched the shared file. The moment ADR-0054's third transport branch — a tool-needing `claude -p` spawn — is built, the ADR-0003 race returns on a path with no isolation, and inside claude-box it is worse, because there the ambient config is a host bind mount and a nested harness writing it corrupts the host file through the mount.

What this change does: it lands the isolation mechanism now, as a small, tested, reusable helper the future `claude -p` branch adopts by construction, so the race can never come back on this path.

**Design principle — isolation is a property of the spawn path, not a courtesy the caller remembers.** The failure mode ADR-0003 caught is exactly the kind a caller forgets under deadline. An implementation where a future `claude -p` branch *could* spawn without an isolated `CLAUDE_CONFIG_DIR` — even if today's code happens to set it — does not satisfy this ticket. The isolation must sit where the spawn is built, so forgetting it is not an option a future author has. This principle is why the primary API in section 3 is a single orchestration function that owns the whole lifecycle, not three loose steps the caller re-assembles: an invariant that lives in the caller's assembly order is an invariant the caller can get wrong. The concrete artifact that makes this enforceable rather than aspirational is the spawn-family runner registry in section 3: every spawn runner is reached through one map that both production dispatch and the conformance selftest read, so the selftest can drive whatever runner ships and check that its spawn path is isolated — the isolation is bound to the runner by a test, not asserted in prose the next author has to honour.

**Design principle — adopt the proven pattern, do not reinvent it.** The eval driver's `cli-driver.mjs` already isolates `CLAUDE_CONFIG_DIR`, forwards exactly the credential file the isolated child needs, locks that copy to owner-only, and removes the dir in a `finally`. This spec copies that shape into the engine-call library. Any divergence from it (copying more than the credential file, skipping the `chmod`, cleaning up outside a `finally`) is a regression against a pattern that was debugged in production, and needs a stated reason.

**Design principle — full ambient env, one surgical override.** Isolation here means overriding one variable, not scrubbing the environment. The child inherits the parent's environment wholesale (it needs `HOME`, `PATH`, and the rest to function) with `CLAUDE_CONFIG_DIR` redirected to the fresh dir. This mirrors the eval driver, which spreads `process.env` and then overrides the one key — not codex, which inherits everything untouched because it has no config-dir concept to isolate.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/engine.js` | CommonJS | The `faff engine call` dispatcher (`cmdEngine`), which today forks to the codex spawn transport with a hardcoded `if (res.family === "codex")` branch; this ticket replaces that branch with a family→runner registry lookup (section 3), and the engine selftest (`engineSelftest`) reads the same registry |
| `plugin/skills/faff/bin/lib/engine-codex.js` | CommonJS | The existing spawn family and the registry's first occupant; its temp-cwd + `finally` cleanup + injectable-seam selftest are the structural template for a spawn transport, and its failure paths already log stderr excerpts (never `env`), so it passes the redaction assertion today |
| `plugin/skills/faff/bin/lib/config.js` | CommonJS | `ENGINE_PROVIDER_FAMILY` — a provider→family-**name** map (`codex: "codex"`) that holds no runner functions, which is why the runner registry is a *separate* map from family name to runner function (section 3) — plus the resolution-time guards |
| `eval/cli-driver.mjs` | ESM | The proven isolation pattern to adopt: `forwardCredentials`, `buildInvocation`'s `CLAUDE_CONFIG_DIR` override, per-rep `mkdtemp` + `finally` cleanup |
| `records/adr/0003-live-driver-spike.md` | — | Records the original race and commits to per-run config isolation as a must-have |
| `records/adr/0054-…transport-selection.md` | — | Line 17 reserves the tool-needing `claude -p` branch, "not built here" |

**Scope statement.** This work sits one layer below the not-yet-built third transport branch: it is the isolation primitive that branch will stand on, landed ahead of it.

## 2. OUT OF SCOPE

- **The `claude -p` transport itself.** ADR-0054 reserves it explicitly as "not built here." This ticket builds the isolation the branch will use, not the branch. **Extension point:** a future `claude` entry in `ENGINE_PROVIDER_FAMILY` (`config.js`) plus a `runClaudeCall` sibling to `runCodexCall` in a new `engine-claude.js`, **registered into the spawn-family runner registry** (section 3) under the `claude` family, whose spawn path calls `withIsolatedClaudeConfig` (section 3) rather than assembling the isolation steps itself. Registering it is what makes the conformance selftest enumerate and drive it — the isolation and redaction assertions bind against `runClaudeCall` the moment it is registered, without anyone editing the selftest. **Forward-link — chain gap:** that transport branch is not a tracked ticket today. Building it is downstream work this spec de-risks, and it is where the end-to-end holdout in section 5 must land. The orchestrator running this prep should file a `faff-chain-gap-fill` ticket for the `claude -p` transport and relate it to FAFF-647, so the sequencing is a linked ticket, not a sentence in a spec.

- **Per-harness permission and sandbox flags (FAFF-605).** That ticket maps appetite to what the child is *allowed to do* (`--permission-mode`, sandbox posture). FAFF-647 is a different axis entirely: what state the child *shares*. Related, not merged. **Extension point:** whatever argv-building function the future `claude` branch owns is where FAFF-605's flags land, alongside — not inside — this ticket's env isolation.

- **Extracting a shared transport module across the three direct-API consumers.** ADR-0054 defers that until the tool-needing branch makes the semantics converge; it hasn't yet. This spec adds a helper to the engine-call library and does not refactor the eval driver to use it. **Extension point:** a future consolidation ticket, once both the eval driver and a live `claude -p` branch call the same isolation code.

- **Cross-importing `eval/cli-driver.mjs` into shipped plugin code.** The eval tree is test infrastructure (ESM, under `eval/`); the plugin library is shipped runtime (CommonJS, under `plugin/`). This spec mirrors the eval driver's *pattern* in a plugin-side helper rather than importing across that boundary. **Extension point:** none intended — the boundary is deliberate.

- **Proving a real `claude` binary honours `CLAUDE_CONFIG_DIR` for every config write.** This precursor proves the *helper's* contract (the env it hands a child, the files it writes, the dir it cleans up). Whether a real `claude` process, handed that env, actually routes *all* its config writes through `CLAUDE_CONFIG_DIR` — rather than resolving some via `HOME` — is a property of the binary, not of this helper, and cannot be tested before a live spawn exists. **Extension point:** the end-to-end "a real `claude` spawn touches no ambient file" proof is a holdout carried by the future `claude -p` transport branch (the chain-gap ticket above), linked from here — not a checkbox this ticket can tick.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Ambient config dir | The `CLAUDE_CONFIG_DIR` the orchestrator's own session uses, or `~/.claude` when that variable is unset. The thing that must never be written by a spawned child. |
| Isolated config dir | A fresh, empty directory minted per spawn under a base dir (default `os.tmpdir()`), handed to the child as its `CLAUDE_CONFIG_DIR`, locked to `0700`. |
| Credential file | `.credentials.json` — the single OAuth-credential file a subscription-seat `claude` needs to authenticate. The only file forwarded from the ambient dir into the isolated one. |
| Mutable config | `~/.claude.json` and the rest of the ambient dir's writable state. Deliberately never copied, so the child's writes land only in its own isolated dir. |
| Helper-vs-child boundary | The line between what this helper controls (the env, the forwarded file, the dir lifecycle) and what only the spawned binary controls (whether it honours that env). This spec proves the first; the second is the future branch's holdout. |
| Spawn-family runner registry | A map from engine **family name** to the **runner function** that owns that family's spawn transport (`codex` → `runCodexCall` today; a future `claude` → `runClaudeCall`). Distinct from `ENGINE_PROVIDER_FAMILY`, which maps provider name to a family *string* and holds no functions. Both `cmdEngine`'s production dispatch and the engine selftest read this one map, so a runner is dispatched in production and enumerated by the conformance selftest from the same source of truth. |

**The helper's shape — one orchestrator, three injectable sub-steps.** The deliverable is a small helper in the engine-call library. Its *primary API* is a single orchestration function that owns the entire mint → try/forward-build-spawn-capture → finally/cleanup lifecycle; the three moves the eval driver makes stay as injectable sub-functions, but they are seams for the selftest, not the shape a future caller assembles. The future `claude -p` branch calls the one orchestrator and physically cannot get the sequence wrong, because the sequence does not live in the caller.

```
INTERFACE ClaudeSpawnIsolation:

  # ---- PRIMARY API: the whole lifecycle, owned in one place ----
  withIsolatedClaudeConfig(spawnFn, opts) -> result
    # opts: { authMode, ambientDir, ambientEnv, apiKeyEnv?, baseDir?, seams? }
    # owns:  mint -> TRY { forward(late) -> build-env -> spawnFn(env,cwd)
    #                      -> capture } -> FINALLY { cleanup }
    # the future `claude -p` branch calls ONLY this; it never re-implements
    #   the try/finally, so "isolation is a property of the spawn path" holds
    #   by construction, not by the caller remembering the order
    # returns whatever spawnFn returns, AFTER cleanup has run
    # forwards the credential as LATE as possible — immediately before spawnFn —
    #   to keep the plaintext-credential-in-tmp window as short as possible

  # ---- injectable sub-steps: seams the selftest drives, not the caller's API ----

  mintIsolatedConfigDir({ mkdtempFn, baseDir }) -> path
    # a fresh empty dir under baseDir (DEFAULT os.tmpdir()); forced to mode 0700
    #   — do NOT rely on the platform mkdtemp default for the dir's mode
    # baseDir is a SEAM: if os.tmpdir() ever shares the host mount inside
    #   claude-box (see Assumptions), the fix is passing a container-local
    #   baseDir here — a parameter, not a redesign
    # this dir becomes the child's CLAUDE_CONFIG_DIR; nothing pre-populated

  forwardClaudeCredential(isolatedDir, { ambientDir, copyFn, chmodFn }) -> path | null
    # copies ONLY .credentials.json from ambientDir into isolatedDir
    # chmod 0600 on the copy (copy does not preserve mode)
    # best-effort: a missing credential file returns null, never throws
    #   (api-key auth needs no credential file)
    # copies NOTHING else — mutable ~/.claude.json stays isolated
    # reads from ambientDir but writes NOTHING into ambientDir

  buildIsolatedChildEnv(ambientEnv, isolatedDir, injectedApiKeyEnv?) -> { env, redactedEnv }
    # env:         { ...ambientEnv, CLAUDE_CONFIG_DIR: isolatedDir, ...apiKeyOverride }
    # redactedEnv: the SAME map with the auth-token / api-key VALUE masked
    # exactly one isolation override; full ambient inheritance otherwise
    # the api-key VALUE lives in env — see the never-log-verbatim constraint below

  CONSTRAINT isolatedDir is created under baseDir (default os.tmpdir()),
             never inside ambientDir
  CONSTRAINT the helper reads .credentials.json from ambientDir but writes
             nothing into ambientDir
  CONSTRAINT the returned `env` map is NEVER logged verbatim by any caller.
             A runner logging a child env on spawn failure would leak the
             Anthropic token / api-key value. Callers log `redactedEnv` only;
             `env` is passed to spawn and to nothing else that emits output.
             This constraint is TEST-ENFORCED via the registry below, not left
             as caller discipline — see the conformance selftest in section 4.
```

**The spawn-family runner registry — the seam that makes both guarantees enforceable.** Today `cmdEngine` dispatches the codex spawn transport through a hardcoded `if (res.family === "codex") { … runCodexCall(…) }` fork (`engine.js`), and the engine selftest hand-wires `codexSelftest()`. There is no map of runners to enumerate, so any guarantee about "every spawn runner is isolated / never leaks its env" is prose over a fork — it cannot bind when a second spawn family lands. This ticket introduces a small **family → runner** registry that both the production dispatch and the selftest read from one place, and moves codex into it as the first live occupant. This is a modest, reversible refactor of the existing two-family dispatch — it removes one hardcoded `if` and replaces it with a lookup over the same two families — and it is squarely the seam this ticket exists to harden: it is what turns "isolation is a property of the spawn path" and "the child env is never logged verbatim" from aspirations into properties a test drives against whatever runner is registered.

```
INTERFACE SpawnFamilyRunners:

  SPAWN_FAMILY_RUNNERS: Map<familyName, runnerFn>
    # the ONE source of truth for spawn-transport dispatch
    # today:  { "codex": runCodexCall }              # codex, first occupant
    # future: { "codex": runCodexCall, "claude": runClaudeCall }
    # each runnerFn(opts) -> ENGINE_EXIT int (int-or-Promise, as today)

  # cmdEngine dispatch (production) reads it:
  #   runner = SPAWN_FAMILY_RUNNERS[res.family]
  #   IF runner: RETURN runner({ engine: res, system, user, spendSink })
  #   ELSE: fall through to the HTTP transport path (unchanged)
  #   — this REPLACES the hardcoded `if (res.family === "codex")` fork

  # engineSelftest reads the SAME map (see section 4 conformance selftest):
  #   FOR EACH (family, runnerFn) IN SPAWN_FAMILY_RUNNERS:
  #     drive runnerFn through injected mock spawnFn + logger seam
  #     assert redaction (all runners) and, for config-dir-bearing
  #       families (claude), CLAUDE_CONFIG_DIR isolation

  ANNOTATION which families are "config-dir-bearing" (isolation applies)
    is a declared property of the family, not a name guess — codex declares
    itself config-dir-free (nothing to isolate), a future claude declares
    itself config-dir-bearing (isolation asserted).
```

**Cleanup contract — best-effort, but never silent.** The orchestrator removes the isolated dir per spawn, in a `finally`, the same lifecycle codex's temp cwd already has and FAFF-139 established for the eval driver's per-rep dirs. Two hardening rules, because the isolated dir may hold a real forwarded credential:

- Cleanup failure is **logged loudly**, not swallowed. A silently-swallowed `rmSync` fault leaves a live credential copy in `tmp` indefinitely with no signal — exactly the kind of exposure that goes unnoticed until it is found by someone else. The failure is reported (warn-level, with the dir path) so an operator can see it.
- Before abandoning a dir it could not remove, the orchestrator **best-effort truncates/overwrites the forwarded credential file** so an abandoned dir does not hold readable plaintext. Truncation is itself best-effort; if it also faults, the loud log is the backstop.

Cleanup failure still never masks the dispatch's real result — the `finally` reports and continues, it does not throw over the spawn's outcome.

**Auth-mode split.** The engine-call token model already distinguishes two auth modes (`config.js` / `backends.js`): api-key backends carry an `api_key_env` handle, subscription-seat backends carry a `seat_token_env` handle. The orchestrator honours both without inventing a third path:

```
RECORD ClaudeAuthResolution:
  mode: "api-key" | "subscription-seat"

  IF mode == "api-key":
    forward no credential file
    inject the named env var's VALUE as the child's Anthropic auth token
      (env override, mirrors codex's OPENAI_API_KEY injection)
      — value carried in `env`, masked in `redactedEnv`, never logged verbatim

  IF mode == "subscription-seat":
    forward .credentials.json into the isolated dir (chmod 0600), as late as
      possible (immediately before spawn)
    no token env override
```

## 4. HOW — behaviour

**Architecture.** The deliverable is two things that fit together: the isolation helper (a standalone module in the plugin's engine-call library) and the spawn-family runner registry (section 3) that makes the helper's contract enforceable across whatever runners ship. The helper has no `claude` consumer in shipped code today — that is expected; the ticket is precursor hardening. Its consumers are (1) the selftest that proves the helper's own contract, (2) the conformance selftest that drives every *registered* spawn runner, and (3) the future `claude -p` branch that will call `withIsolatedClaudeConfig` the way `runCodexCall` calls its own temp-cwd logic. The registry is not speculative scaffolding: it has a real occupant the day this ticket lands — codex is moved into it and driven by the conformance selftest's redaction assertion today — and the CLAUDE_CONFIG_DIR isolation assertion binds against `runClaudeCall` the moment a `claude` runner is registered. That is what makes "the future branch calls it correctly" a property the selftest exercises rather than a hope.

**The spawn recipe, owned by the orchestrator.** When the third transport branch is built, its dispatch hands a `spawnFn` to `withIsolatedClaudeConfig` and the orchestrator runs exactly this — the branch never writes the try/finally itself:

```
PROCEDURE withIsolatedClaudeConfig(spawnFn, opts):
  1. Resolve auth mode from opts (api-key vs subscription-seat)
  2. isolatedDir = mintIsolatedConfigDir({ mkdtempFn, baseDir })   # fresh, empty, 0700
  3. TRY:
     a. childEnv = buildIsolatedChildEnv(ambientEnv, isolatedDir, apiKeyOverride?)
     b. IF subscription-seat: forwardClaudeCredential(isolatedDir, ...)   # LATE: right before spawn
     c. result = spawnFn({ env: childEnv.env, cwd: isolatedDir })
     d. capture result.stdout into a string        # BEFORE cleanup — see anti-pattern
     e. record spend on the success path (FAFF-604), warn-only on sink fault
     f. RETURN result
  4. FINALLY:
     a. TRY rmSync(isolatedDir, { recursive, force })
     b. CATCH cleanupErr:
        - best-effort truncate/overwrite isolatedDir/.credentials.json
        - LOG LOUD: warn with { isolatedDir, cleanupErr }   # never silent
        - do NOT rethrow over the dispatch result
```

Step 2 alone satisfies the core of the acceptance criteria the *helper* can own: a child pointed at a fresh empty dir is *asked* to write its config there, read its config there, and touch the ambient dir for exactly one thing — the credential file the helper copies *out* of it in step 3b, never *into* it. Steps 3a/3b make that isolation authenticated; step 4 makes it self-cleaning and its faults observable. What step 2 cannot do is force the `claude` binary to honour that env for every write — that is the helper-vs-child boundary, carried as the future branch's holdout.

**The conformance selftest — one registry-driven test that binds both isolation and redaction.** The earlier draft asserted a property of the `ENGINE_PROVIDER_FAMILY` *map* ("no family maps to a `claude` spawn unless…"). That is a vacuous tripwire: the map holds family-name strings, not runner functions, so a check that reads it cannot tell whether a runner isolates its env or leaks it. The invariant can only be violated where a runner builds its spawn — so the selftest must drive the runner, and the runner registry (section 3) is what lets it enumerate runners from the same map production dispatches through. The conformance selftest reads `SPAWN_FAMILY_RUNNERS` and, for each registered runner, drives it down two paths with injected seams:

```
FOR EACH (family, runnerFn) IN SPAWN_FAMILY_RUNNERS:

  # (A) REDACTION — asserted for EVERY registered spawn runner:
  1. drive runnerFn down its SPAWN-FAILURE path with an injected logger seam
     and an injected token value (a unique sentinel) in the child's auth env;
  2. capture the log payload the failure path emits;
  3. assert the sentinel token value NEVER appears in the captured payload
     (the runner logs the masked/redacted form, or no env at all — never the
      raw token). A runner that dumps `env` on failure fails this assertion.

  # (B) CLAUDE_CONFIG_DIR ISOLATION — asserted for CONFIG-DIR-BEARING runners
  #     (the `claude` family; codex declares itself config-dir-free and is
  #      skipped for this half — it has no config dir to isolate):
  4. invoke runnerFn through withIsolatedClaudeConfig with a mock spawnFn that
     CAPTURES the { env, cwd } it is handed, and mock copy/chmod/mkdtemp seams
     that RECORD every path they touch;
  5. assert childEnv.CLAUDE_CONFIG_DIR is set and resolves under the injected
     baseDir, distinct from the injected ambientDir;
  6. assert no recorded seam call (copy/chmod/write) targeted a path inside
     ambientDir — the `claude` family must write NOTHING into the ambient dir.
```

The registry has a real occupant today, so this is not a dormant test. Today `SPAWN_FAMILY_RUNNERS` holds `{ codex }`: the redaction assertion (A) drives `runCodexCall` down its spawn-failure path this ticket's day one and confirms codex's failure log never contains the injected token (it logs stderr excerpts, never `env`, so it passes) — a real, executing binding, not a placeholder. The isolation assertion (B) is skipped for codex because codex declares itself config-dir-free; it has nothing to drive until a config-dir-bearing runner exists. The moment a `claude` runner is registered, the enumeration includes it: (A) binds its failure-path redaction (a `claude` runner carries a real Anthropic token in its child env, so passing means it logs the masked form), and (B) binds its `CLAUDE_CONFIG_DIR` isolation. A `claude` runner whose spawn path skips `withIsolatedClaudeConfig`, or hand-rolls it wrong, is handed a mock `spawnFn` that captures a non-isolated env and fails (B); one that dumps `env` on failure fails (A). Both guarantees are enforced by the same registry-driven mechanism, against whatever runner is registered — neither is left to the next author to remember.

This is the honest limit and the honest reach of a test written before the branch: it cannot check `claude` code that does not exist yet, but it drives every runner that *does* exist (codex today) for redaction now, and it binds the isolation half automatically the day a `claude` runner is registered — no selftest edit required. Alongside it, the helper-contract selftest below runs today against the orchestrator directly, so this ticket ships executing coverage of the env contract, not only the registry-driven bindings.

**Behaviour summary — credential forwarding.** In one sentence: copy the single OAuth-credential file from the ambient dir into the isolated dir, lock it to owner-only, and do it as late as the lifecycle allows, so a subscription-seat child authenticates without inheriting any of the parent's mutable state and the plaintext copy exists for the shortest possible window.

```
PROCEDURE forwardClaudeCredential(isolatedDir, ambientDir):
  1. src = ambientDir + "/.credentials.json"
  2. dst = isolatedDir + "/.credentials.json"
  3. TRY:
     a. copy src -> dst
     b. chmod dst 0600            # copy does not preserve mode; lock owner-only
     c. RETURN dst
  4. CATCH:
     RETURN null                  # no credential file present is fine (api-key auth)
```

**Edge cases and error handling.**

- **`mkdtemp` fails** (tmpdir full or unwritable): `mintIsolatedConfigDir` surfaces the error; `withIsolatedClaudeConfig`'s caller in the future branch turns it into a named, non-zero engine exit (`ENGINE_EXIT.UNREACHABLE` with a message), never an escaped throw — exactly as `runCodexCall` already handles its temp-cwd `mkdtemp` failure.
- **Credential file absent**: not an error. `forwardClaudeCredential` returns `null` and the spawn proceeds; api-key auth needs no file, and a genuinely mis-configured seat surfaces as the child's own "Not logged in", classified downstream like any other auth failure.
- **Cleanup fault** (the `finally` `rmSync` throws): reported loud, not swallowed; the forwarded credential is best-effort overwritten before the dir is abandoned; the dispatch's real result is preserved. A failed cleanup must not mask the dispatch's outcome, but it must not vanish silently either.
- **Spend recording** (FAFF-604): the isolated-dir lifecycle must not interfere with spend attribution. Output is captured to a string before the dir is removed, and cleanup runs in `finally` regardless of whether the spend sink faulted — a sink fault warns and leaves the exit code alone, as codex already does.

**Failure modes — how this approach could be wrong, and how you'd notice.**

- **The helper's shape doesn't fit the real branch.** This is precursor code with no live consumer, so its interface is designed against the eval driver's needs, not the `claude -p` branch's actual ones. *How you'd know:* when the third branch is built, it needs a config-dir move the orchestrator doesn't offer, or has to reach around `withIsolatedClaudeConfig`. *What it means:* narrow — adjust the helper then, treating today's version as a proven-pattern starting point rather than a frozen contract. Bounded, because the pattern is lifted from a working consumer.
- **The CLAUDE_CONFIG_DIR isolation half of the conformance selftest stays dormant until a `claude` runner exists.** A test written today cannot force `claude` code that doesn't exist yet to call the orchestrator; the isolation assertion (B) drives whatever config-dir-bearing runner is registered, and today none is. It is only that *half* that waits — the redaction assertion (A) drives codex, the registry's real occupant, today. *How you'd know:* the enumeration drives codex for redaction now (a passing, executing assertion) and finds zero config-dir-bearing runners for the isolation half; a future PR registering `runClaudeCall` exercises both. *What it means:* proceed — the redaction assertion and the helper-contract selftest carry live coverage today, the isolation assertion carries the binding coverage when the `claude` runner lands, and all three are named in DONE so none reads as an accident.
- **The `claude` binary resolves some config via `HOME`, not `CLAUDE_CONFIG_DIR`.** The whole isolation rests on the binary honouring `CLAUDE_CONFIG_DIR` for *all* config writes. If it routes some write through `HOME` instead, an isolated env would not fully isolate. *How you'd know:* only a real spawn reveals it — the future branch's end-to-end holdout (a live `claude` spawn leaves every ambient file untouched) is what proves or breaks this. *What it means:* this ticket cannot close it; it is explicitly the future branch's holdout, linked from OUT OF SCOPE, not a gap this precursor hides.
- **claude-box puts the isolated dir's base on the same mount as the ambient dir.** The isolation assumes the fresh dir lands on writable space distinct from the host-bind-mounted `~/.claude`. If, inside claude-box, `os.tmpdir()` resolved onto the same host mount, a child writing its isolated config could still reach host state. *How you'd know:* the linked claude-box mount check (Assumptions) — run the helper inside claude-box and confirm the host's `~/.claude.json` is untouched across a spawn. *What it means:* the `baseDir` seam is the mitigation — if the check fails, pass a container-local base dir; a parameter, not a redesign.

**Anti-pattern:** capturing the child's output *after* the isolated dir is removed. Why: the output lives in the spawn result, but any deferred read of files under the isolated dir (transcripts, logs) reads a deleted path. Capture everything needed into strings before the `finally` runs. (Recorded as a real hazard in `records/specs/2026-07-13-FAFF-320-*.md`.)

**Anti-pattern:** copying `~/.claude.json` or the whole ambient dir into the isolated dir to "make the child feel at home." Why: that re-shares the exact mutable state ADR-0003's race is about. Forward the credential file and nothing else.

**Anti-pattern:** logging the child env verbatim on a spawn failure. Why: `env` holds the plaintext Anthropic token / api-key value. A future runner that dumps the child env into an error log leaks the credential. Log `redactedEnv`, never `env`. This is not left as advice: the conformance selftest's redaction assertion (A, above) drives every registered runner down its failure path and fails if the raw token value appears in the log — so a runner that violates this anti-pattern does not pass the selftest.

**Anti-pattern:** swallowing a cleanup fault silently to "keep the happy path clean." Why: a swallowed `rmSync` failure leaves a live credential copy in `tmp` with no signal that it is there. Report it loud and overwrite the credential before abandoning the dir.

## 5. Scenarios — born-verifiable objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a helper-built child env and an ambient config dir that a parent session is using
When withIsolatedClaudeConfig mints the child's config dir and builds its env
Then the child's CLAUDE_CONFIG_DIR points at a fresh dir under the base dir, distinct from the ambient dir
And that isolated dir is mode 0700
```

```
Given an ambient config dir containing .credentials.json and a mutable .claude.json
When the subscription-seat path forwards the credential through the orchestrator
Then only .credentials.json is copied into the isolated dir, it is chmod 0600, and .claude.json is not copied
And no injected write seam (copy/chmod/mkdtemp) is ever called with a path inside the ambient dir
```

- The returned `env` map MUST never be logged verbatim; callers log `redactedEnv`, in which the auth-token / api-key value is masked. This MUST be test-enforced, not caller discipline: the conformance selftest drives every registered spawn runner down its spawn-failure path with an injected sentinel token and asserts the captured log never contains the raw token value. Today this drives codex and passes; it binds a `claude` runner's failure path the day one is registered. (assertion)
- A cleanup fault MUST be reported at warn level with the isolated-dir path and MUST best-effort overwrite the forwarded credential before abandoning the dir — never a silent swallow. (assertion)

> The holdout above is the **end-to-end proof that a real child honours the isolated env**. It depends on a live `claude` spawn, which this ticket does not build — it is reserved for and carried by the future `claude -p` transport branch (the linked chain-gap ticket in OUT OF SCOPE), stated here so the requirement is visible at the point it is de-risked, not invented later.

- The isolated config dir MUST be created under the base dir (default `os.tmpdir()`), never inside the ambient config dir. (assertion)
- The spawn-family runner registry MUST be the single source of truth both `cmdEngine` dispatch and the engine selftest read; codex MUST be registered as its first occupant, replacing the hardcoded `if (res.family === "codex")` fork. (assertion)

## 6. Design decision rationale

**Question: land the full isolation mechanism now, or only a guard-plus-doc that a future branch can't skip it?**
- *Option A — reusable tested helper + runner-conformance assertion now.* Pro: the future branch adopts isolation by construction, mirroring how codex's isolation-equivalent (temp cwd) was built in from its first commit; the pattern is proven by the eval driver, so the shape is low-risk; matches the ticket's "before the branch, not during it" framing and the high appetite. Con: ships code with no live consumer.
- *Option B — guard/test/doc only.* Pro: minimal, nothing speculative. Con: leaves the actual isolation to be written under deadline inside the branch — exactly the "caller remembers" failure the first design principle rejects; contributes less de-risking for the same review cost.

**Chosen:** Option A — land the reusable, tested isolation helper plus the runner-conformance assertion now, without building the `claude -p` transport itself. The pattern is adopted wholesale from the eval driver, so "speculative" overstates the risk; the failure mode (shape doesn't fit) is named and bounded, and the alternative re-introduces the forgettable-caller hazard the ticket exists to remove.

**Question: expose isolation as three loose functions the caller assembles, or one orchestration function that owns the lifecycle?**
- *Option A — one orchestrator (`withIsolatedClaudeConfig`) owns mint/try/forward/build/spawn/capture/finally; the three sub-steps stay as injectable seams for the selftest.* Pro: the isolation invariant lives where the spawn is built, not in the caller's assembly order — the future branch cannot sequence it wrong because it does not sequence it at all; makes "isolation is a property of the spawn path" true by construction. Con: a slightly larger primary surface than three standalone functions.
- *Option B — three standalone functions (mint / forward / build-env), caller assembles the try/finally.* Pro: smaller pieces. Con: the invariant lives in the caller's `mint → try{forward→build→spawn→capture} → finally{cleanup}` assembly — precisely the "caller remembers" failure the first design principle rejects; a future author who forwards after spawn, or forgets the finally, still type-checks.

**Chosen:** Option A — one orchestration function is the primary API; the three moves remain as injectable seams for the selftest only. The sub-functions are testing seams, not a caller-facing kit. This is what makes the isolation an invariant of the spawn path rather than a discipline the next author has to keep.

**Question: how are "every spawn runner isolates its `CLAUDE_CONFIG_DIR`" and "no runner logs its child env verbatim" made enforceable — a check over the existing name-only map, or a family→runner registry the selftest drives?**
- *Option A — introduce a family→runner registry (`SPAWN_FAMILY_RUNNERS`), move codex into it as the first occupant, and have both `cmdEngine` dispatch and the conformance selftest read it; the selftest drives each registered runner for redaction (all runners) and for `CLAUDE_CONFIG_DIR` isolation (config-dir-bearing runners).* Pro: the assertions exercise the code that could actually violate each invariant — the runner's spawn path — so a `claude` runner that omits the override fails the isolation assertion and one that dumps `env` fails the redaction assertion; both bind against whatever runner is registered; codex is a real occupant, so the redaction half executes the day this ships and the seam is not speculative; it is a modest, reversible refactor of the existing two-family dispatch (one hardcoded `if` becomes a lookup) that improves the very seam this ticket exists to harden. Con: touches the dispatch fork (small, reversible), and the isolation half stays dormant until a `claude` runner lands.
- *Option B — keep the hardcoded `if (res.family === "codex")` dispatch fork and assert a property of the `ENGINE_PROVIDER_FAMILY` map ("no `claude` family without isolation").* Pro: no dispatch refactor. Con: vacuous — that map holds family-name strings, not runner functions, so a check over it cannot tell whether a runner isolates its env or leaks it; both guarantees stay prose-only caller discipline, which the spec's first design principle explicitly rejects. It checks the wrong artifact.

**Chosen:** Option A — introduce the family→runner registry with codex as first occupant. The two invariants can only be violated in a runner's spawn path, so the enforcement must exercise the runner, and a registry both production dispatch and the selftest read from one place is what lets the selftest drive whatever runner ships. This is one structural move, not two patches: the same registry-driven test binds the `CLAUDE_CONFIG_DIR` isolation and the env redaction. The refactor is in-scope — replacing a two-family `if` with a two-family lookup is small and reversible, and hardening this dispatch seam is exactly the ticket's remit. The name-only-map check in Option B is the inert tripwire the earlier draft was rejected for.

**Question: how much of the environment does the child inherit?**
- *Option A — full ambient env, override only `CLAUDE_CONFIG_DIR`* (the eval driver's posture).
- *Option B — full raw inheritance, no override* (codex's posture — valid there only because codex has no config-dir to isolate).

**Chosen:** Option A. Codex inherits everything untouched precisely because it has nothing to isolate; a `claude` child does, and the whole point of this ticket is the one override. Full inheritance otherwise keeps `HOME`/`PATH`/etc. intact so the child actually runs. The api-key value that rides in that env is masked in `redactedEnv` and the returned `env` is never logged verbatim, so full inheritance does not become a credential-in-logs exposure.

**Question: how does the isolated child authenticate — forwarded credential file, or env-var key?**
- *Option A — support both, matched to the backend's declared auth mode:* subscription-seat forwards `.credentials.json` (chmod 0600), api-key injects the named env var's value, no file copy.
- *Option B — require an env-var API key only,* sidestepping the credential-file copy entirely.

**Chosen:** Option A. The engine-call token model already declares both auth modes (`api_key_env` and `seat_token_env`), and the eval driver already proves credential-copy works for seat auth (FAFF-138); requiring api-key only would silently drop subscription-seat support that the rest of the seam has. This is why the credential hardening below matters — the isolated dir can hold a real credential.

**Question: how hard does the credential handling in `tmp` need to be?**
- *Option A — force the isolated dir to 0700, chmod the credential copy 0600, forward it as late as possible, and on cleanup failure log loud + best-effort overwrite the credential before abandoning the dir.* Pro: narrows the plaintext-in-tmp window (late forward), locks both the dir and the file (not just the file), and makes an un-cleanable credential visible and best-effort scrubbed rather than a silent live copy. Con: a little more code than a bare chmod-and-swallow.
- *Option B — chmod the credential file 0600 and rely on the platform mkdtemp default for the dir, cleaning up best-effort with a swallowed fault.* Pro: minimal, matches the barest reading of the eval driver. Con: the dir mode is never asserted (platform-dependent), and a swallowed cleanup fault leaves a live credential in `tmp` with no signal — two exposure gaps for a file that is a real OAuth credential.

**Chosen:** Option A. A forwarded credential is a real secret in a shared temp location; the dir gets `0700` explicitly (not by platform default), the file gets `0600`, the copy happens as late as the lifecycle allows, and a cleanup that cannot remove the dir logs loud and overwrites the credential first. Best-effort cleanup stays in the `finally`; what changes is that its failure is observable and its worst case is scrubbed, not silent.

**Question (the ticket's open question): is the isolated dir cleaned per-spawn or pooled per-run?**
- *Option A — per-spawn, best-effort, in a `finally`.* Pro: matches FAFF-139's established precedent and codex's temp-cwd lifecycle exactly; each dispatch is independent; forwarded credential copies never accumulate in `tmp`. Con: a dir minted and removed per spawn (negligible for a one-shot dispatch).
- *Option B — pooled per-run.* Pro: fewer `mkdtemp` calls under a hypothetical high-volume loop. Con: no precedent in this codebase; a pool holding forwarded credential copies for a whole run is a larger, longer-lived exposure; adds lifecycle complexity the one-shot dispatch model doesn't need.

**Chosen:** Option A — per-spawn, best-effort, in a `finally`. There is no reason to pool: the engine-call dispatch is one-shot, the precedent is unanimous, and pooling credential copies enlarges the exposure this ticket exists to shrink.

## 7. Open questions and assumptions

**Open questions.** None — the ticket's open question (cleanup lifecycle) is resolved above as per-spawn cleanup in a `finally`, following the FAFF-139 precedent. Every review objection is resolved as a Chosen design decision, not deferred.

**Assumptions.**

- **Assumes:** inside claude-box, the isolated-dir base (default `os.tmpdir()`) resolves onto container-local writable space that is *not* the same host bind mount as the ambient `~/.claude`. *Mitigation, built in:* `mintIsolatedConfigDir` takes a `baseDir` seam (section 3), so if this assumption fails the fix is passing a container-local base dir — a parameter, not a redesign. *Validation — linked follow-up, not a checkbox this build ticks:* the claude-box mount config lives in a separate repo (`shftwst/claude-box`) and cannot be asserted by any file in *this* repo, so the check is a linked follow-up spike — inspect the claude-box mount configuration to confirm `/tmp` is not bind-mounted from the host `~/.claude`, or run the helper inside claude-box and confirm the host's `~/.claude.json` is untouched across a spawn. The orchestrator running this prep should file that mount-check as a follow-up related to FAFF-647 (a `faff-chain-gap-fill` against `shftwst/claude-box`), rather than this build recording "pending" against an acceptance it structurally cannot satisfy. Treat the mount shape as unvalidated until that follow-up closes; the `baseDir` seam is what keeps the risk bounded in the meantime.

## 8. DONE — definition of done

### From WHY
- [ ] A helper exists at the `faff engine call` seam whose *primary API* is a single orchestration function (`withIsolatedClaudeConfig`) that gives a spawned child its own `CLAUDE_CONFIG_DIR` and owns the whole mint/try/finally lifecycle, so a future `claude -p` spawn cannot share mutable config with the orchestrator and cannot assemble the isolation sequence wrong (acceptance #1, #2).
- [ ] A family→runner registry (`SPAWN_FAMILY_RUNNERS`) exists and is the single source of truth that both `cmdEngine` dispatch and the engine selftest read; codex is registered as its first occupant and the hardcoded `if (res.family === "codex")` dispatch fork is replaced by a lookup over it (behaviour unchanged for codex).

### From WHAT (types and interfaces)
- [ ] `withIsolatedClaudeConfig(spawnFn, opts)` owns mint → try{ build-env → late credential forward → spawnFn → capture } → finally{ cleanup }, and returns the spawn result after cleanup has run.
- [ ] `mintIsolatedConfigDir` returns a fresh empty dir created under `baseDir` (default `os.tmpdir()`), forced to mode `0700` (not relying on the platform default), with `baseDir` accepted as a seam.
- [ ] `forwardClaudeCredential` copies only `.credentials.json`, applies `chmod 0600`, copies nothing else, writes nothing into the ambient dir, and returns `null` (never throws) when the file is absent.
- [ ] `buildIsolatedChildEnv` returns `{ env, redactedEnv }`: `env` is the full ambient env with `CLAUDE_CONFIG_DIR` overridden (plus the api-key override in api-key mode); `redactedEnv` is the same map with the auth-token / api-key value masked.
- [ ] The returned `env` is never logged verbatim by any caller; the only logged form is `redactedEnv`. This is test-enforced by the conformance selftest's redaction assertion (below), not left as caller discipline.
- [ ] The auth-mode split is honoured: subscription-seat forwards the credential file; api-key injects the env-var value and forwards no file.

### From HOW (behaviour)
- [ ] The `mkdtemp`/copy/chmod/env seams are injectable, and a helper-contract selftest exercises `withIsolatedClaudeConfig` end-to-end with a mock `spawnFn` and zero real filesystem writes outside a temp dir — this runs today.
- [ ] The conformance selftest reads `SPAWN_FAMILY_RUNNERS` and, for each registered runner, (A) drives it down its spawn-failure path with an injected sentinel token and asserts the captured log never contains the raw token value, and (B) for config-dir-bearing runners, drives it through a mock `spawnFn` and asserts the captured child env is isolated (`CLAUDE_CONFIG_DIR` under `baseDir`, distinct from ambient) with no seam writing into the ambient dir.
- [ ] Assertion (A) executes today: it drives the registered codex runner down its failure path and confirms the injected token never appears in the log (codex logs stderr excerpts, never `env`, so it passes). This is a live binding, not a placeholder.
- [ ] Assertion (B) is dormant only until a config-dir-bearing (`claude`) runner is registered — it is skipped for codex by codex's declared config-dir-free property, not by a registry-shape check — and binds against `runClaudeCall` the moment it is registered, with no selftest edit.
- [ ] Cleanup of the isolated dir is per-spawn, best-effort, in a `finally`; a cleanup fault is logged loud with the dir path, best-effort overwrites the forwarded credential before abandoning the dir, and does not mask the dispatch result.
- [ ] The credential is forwarded as late as the lifecycle allows (immediately before the spawn), not at mint time.

### From HOW (edge cases)
- [ ] A `mkdtemp` failure surfaces so the caller can name it as a non-zero engine exit rather than an escaped throw (matching `runCodexCall`).
- [ ] An absent credential file leaves the spawn to proceed (returns `null`), not an error.
- [ ] Output is captured to a string before the isolated dir is removed (the FAFF-320 anti-pattern is not reintroduced).

### From Scenarios (the isolation guarantee)
- [ ] A selftest asserts that, given a populated ambient dir, no injected write seam is ever called with an ambient-dir path and the child's `CLAUDE_CONFIG_DIR` is a distinct fresh dir under the base dir at mode `0700` — the structural form of "the parent's config is untouched" (acceptance #2). This proves the **helper's** contract; it does not and cannot prove a real `claude` binary honours the env (helper-vs-child boundary).
- [ ] The end-to-end "a real `claude` spawn touches no ambient file" proof is recorded as the future `claude -p` transport branch's holdout and linked from OUT OF SCOPE — not ticked here.

### Chain-gap follow-ups (filed, not built here)
- [ ] A `faff-chain-gap-fill` ticket for the downstream `claude -p` transport branch is filed and related to FAFF-647 (it carries the end-to-end holdout above).
- [ ] A follow-up for the claude-box mount check is filed against `shftwst/claude-box` and related to FAFF-647 (validates the section-7 assumption; the `baseDir` seam is the mitigation until it closes).

### Integration smoke test
```
1. Drive withIsolatedClaudeConfig against a temp "ambient" dir holding a dummy
   .credentials.json and a dummy .claude.json, with a mock spawnFn that records
   the { env, cwd } it receives, and spy copy/chmod/mkdtemp seams that record
   every path they touch.
2. Assert: recorded env.CLAUDE_CONFIG_DIR is a fresh dir under the base dir, != ambient dir.
3. Assert: the isolated dir is mode 0700 and contains .credentials.json (mode 0600) and NOT .claude.json.
4. Assert (structural, the primary oracle): no recorded seam call targeted a path
   inside the ambient dir — the helper opened no ambient path for write.
5. Backstop only: the ambient .claude.json is byte-identical after the run. If a
   filesystem coarsens mtime resolution or a mount caches it, prefer the step-4
   structural assertion; mtime is a secondary check, not the guarantee.
6. Run the finally; assert the isolated dir no longer exists, and that a forced
   cleanup fault is logged loud and overwrites the credential before abandoning the dir.
If these hold, the isolation plumbing is connected — for the helper. The real-child
guarantee is the future branch's holdout.
```

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
    { "marker": "assumes" }
  ] }
```
