# Spec — FAFF-132: Add a local-model (ollama) eval driver

> Spec: faffter-dark-nlspec · 2026-06-14 · interactive · confidence: high

> Design spec for **FAFF-132** "Add a local-model (ollama) eval driver — compare frontier vs local judgement". Audience: the build agent implementing it, and human reviewers gating the merge. Builds on FAFF-130 (judgement-eval harness, #72, on `main`); feeds FAFF-131 (the supervised measured run).

---

## 1. WHY — Problem and Principles

**Problem statement.** FAFF-130 shipped the judgement-eval harness with a fully *injectable* driver, but only the `claude -p` **frontier** preset exists. With no local-model preset, the same eval cases + deterministic grader can't be run against a local (ollama-served) model, so we can't compare frontier-vs-local judgement quality or flakiness on identical fixtures.

**Design principles:**

- **One code path, not a second transport.** The local model is reached through the *same* `claude -p` invocation as frontier — ollama now speaks the Anthropic Messages API natively, so the only difference is environment + `--model`. Any design that introduces a parallel HTTP client is wrong: it doubles the surface the grader trusts and breaks the "same prompt, same envelope, same isolation" property that makes the comparison valid.
- **No host is ever hardcoded.** The ollama endpoint on this tailnet is a Tailscale address, **not** `localhost`. A `localhost` default anywhere in the local path is a defect — it silently targets the wrong machine. The base URL is supplied, never assumed.
- **CI never makes a real model call.** `eval/` stays excluded from `node --test`; the new preset wiring is verified through a *pure* seam, so importing the driver module in CI spawns nothing.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `eval/frontier-driver.mjs` | Node ESM | The driver being generalized — today only `bin` is parameterized |
| `eval/run-evals.mjs` | Node ESM | Orchestrator + CLI; gains the `--driver` selector. Driver-agnostic already |
| `test/eval-grader.test.mjs` | Node ESM | Mock-driver tests; will assert the new pure invocation-builder seam |
| `eval/README.md` | Markdown | Documents CI-exclusion + run instructions; gains the local-run + compare docs |

**Scope statement.** This sits entirely inside `eval/` (the offline judgement probe) — it adds a driver preset and a selector, nothing in the delivery loop or `faff-tidy` changes.

---

## 2. OUT OF SCOPE

- **Cross-driver measurement (the actual numbers).** — Excluded: running ~240 reps against frontier + a local model and tabulating the real accuracy/flakiness delta is a budgeted, supervised run. — Extension point: **FAFF-131** consumes this preset; it fills `docs/adr/0004-*.md`.
- **Choosing *which* local model to run.** — Excluded: the model id is a run-time parameter, not a build-time decision. — Extension point: the `--model` flag / `FAFF_EVAL_LOCAL_MODEL` env; FAFF-131 picks the value. *(Operator's current target: `qwen3.6:27b-mlx` on host `studio.longhair-escalator.ts.net` — see §7.)*
- **Reconciling `.faffrc` `faffter_dark.adversarial.host`.** — Excluded: that key (`http://localhost:11434`, `llama3.1:70b`) drives the *adversarial reviewer*, a different subsystem; its `localhost` value conflicts with the Tailscale reality but fixing it is not this ticket. — Extension point: a separate follow-up; this driver deliberately does **not** read `.faffrc`, so the two never couple. *(Flagged as discovered scope.)*
- **Changes to the grader, cases, envelope, or seam harness.** — Excluded: the comparison's validity depends on the grading path being identical across drivers. — Extension point: none needed; they stay byte-for-byte unchanged.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| **preset** | A named option-bundle for the one CLI driver: `frontier` (Anthropic API, default) or `local` (ollama via env redirect) |
| **invocation** | The resolved `{ bin, args, env }` the driver hands to `spawnSync` |
| **base URL** | The Anthropic-API-compatible endpoint; for `local`, the tailnet ollama host |

**Driver options + factory:**

```
RECORD CliDriverOpts:
  bin:     String   = "claude"      # the executable to spawn
  model:   String?  = null          # → adds ["--model", model] when set
  baseUrl: String?  = null          # local: required; frontier: must stay null
  env:     Map       = {}           # extra env merged over process.env

FUNCTION makeCliDriver(opts: CliDriverOpts) -> Driver
  # Driver(evalCase, repIndex) -> Promise<{ rawText, tokens, transcript }>
  # unchanged return contract from FAFF-130
```

**Presets (convenience factories over `makeCliDriver`):**

```
FUNCTION frontierDriver()                   -> makeCliDriver({})           # == today's makeFrontierDriver()
FUNCTION localDriver({ baseUrl, model })    -> makeCliDriver({
    baseUrl, model,
    env: { ANTHROPIC_BASE_URL: baseUrl,
           ANTHROPIC_AUTH_TOKEN: "ollama",
           ANTHROPIC_API_KEY: "" } })
```

**The testable seam (pure, no I/O):**

```
FUNCTION buildInvocation(opts: CliDriverOpts, prompt: String, cfgDir: Path)
  -> { bin: String, args: [String], env: Map }
  # PURE: no spawn, no fs, no clock. makeCliDriver calls it, then spawnSync(result).
  # args  = ["-p", prompt] ++ (opts.model ? ["--model", opts.model] : [])
  # env   = { ...process.env, ...opts.env, CLAUDE_CONFIG_DIR: cfgDir }
```

**CLI surface (`run-evals.mjs`):**

```
node eval/run-evals.mjs [--driver frontier|local] [--model M] [--bin B] [--base-url URL] [--only ID] [--reps N]
node eval/run-evals.mjs --compare [--model M] [--base-url URL] [--only ID] [--reps N]
```

- `--driver` defaults to `frontier` → **byte-identical behaviour to today** (no flag = no change).
- `--base-url` resolves: `--base-url` flag → `FAFF_EVAL_LOCAL_BASE_URL` env → **error** (no default).
- `--model` resolves: `--model` flag → `FAFF_EVAL_LOCAL_MODEL` env → **error for `local`** (frontier leaves it null).

**Design decisions** (rationale collected in §6):

- **Chosen:** Generalize the driver in place and **rename `frontier-driver.mjs` → `cli-driver.mjs`**; `frontier` becomes one preset among two. The sole importer is `run-evals.mjs` (dynamic import in `main`), so the rename is cheap and keeps the filename honest.
- **Chosen:** A **pure `buildInvocation` export** is the test seam (not an injectable spawn).
- **Chosen:** Base URL + model come from **CLI flag → env → hard error**, never a `localhost` default.
- **Chosen:** The comparison affordance is a **`--compare` mode** that runs both presets over the same cases and prints a side-by-side per-kind table.
- **Assumes:** ollama on the tailnet speaks the **Anthropic Messages API** and `claude` honours `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` to redirect off api.anthropic.com.

---

## 4. HOW — Behavior

**Architecture.** `cli-driver.mjs` exposes the pure `buildInvocation`, the generic `makeCliDriver`, and the two presets. `makeCliDriver` produces the same async `Driver(evalCase, repIndex)` closure as today: it `mkdtempSync`s a per-rep `CLAUDE_CONFIG_DIR`, renders the prompt (unchanged `renderFixturePrompt` + `EVAL_MODE_INSTRUCTION`), calls `buildInvocation`, `spawnSync`s the result, and returns `{ rawText, tokens, transcript }`. The orchestrator is already driver-agnostic, so `runEvals` is untouched; only `main()` learns to *select* a driver.

**Behaviour summary — driver build.** Given a preset's options, produce the exact `{bin,args,env}` to spawn, injecting `--model` only when a model is set and merging the preset env (which for `local` carries the Anthropic-redirect vars) over `process.env`.

```
PROCEDURE makeCliDriver(opts):
  return async (evalCase, repIndex):
    1. cfgDir = mkdtemp(...)                       # per-rep isolation (FAFF-130 invariant)
    2. prompt = renderFixturePrompt(evalCase) + EVAL_MODE_INSTRUCTION(evalCase.id)
    3. inv = buildInvocation(opts, prompt, cfgDir)
    4. res = spawnSync(inv.bin, inv.args, { env: inv.env, encoding:"utf8", maxBuffer:32MB })
    5. IF res.error: throw Error(`cli driver (${inv.bin}): ${res.error.message}`)
    6. return { rawText: res.stdout ?? "", tokens: estimateTokens(res.stdout), transcript: cfgDir }
```

**Behaviour summary — selector + guard.** Resolve the chosen driver from flags/env, failing loud before any rep runs if `local` is underspecified.

```
PROCEDURE resolveDriver(argv):
  driver = argFlag(argv,"--driver") ?? "frontier"
  IF driver == "frontier":
     return frontierDriver()                       # --model/--base-url ignored; warn if --base-url given
  IF driver == "local":
     baseUrl = argFlag(argv,"--base-url") ?? env.FAFF_EVAL_LOCAL_BASE_URL
     model   = argFlag(argv,"--model")    ?? env.FAFF_EVAL_LOCAL_MODEL
     IF not baseUrl: FAIL "--driver local requires --base-url (or FAFF_EVAL_LOCAL_BASE_URL); no localhost default"
     IF not model:   FAIL "--driver local requires --model (or FAFF_EVAL_LOCAL_MODEL)"
     IF baseUrl matches /localhost|127\.0\.0\.1/: WARN "ollama is served over Tailscale, not localhost — is this right?"
     return localDriver({ baseUrl, model })
  FAIL "unknown --driver: ${driver} (frontier|local)"
```

**Behaviour summary — compare.** Run both presets over the same case set, reuse the existing `summarize`, and print one table.

```
PROCEDURE compare(argv):
  cases = loadCases() filtered by --only
  fr = await runEvals({ cases, driver: frontierDriver(), ... })
  lo = await runEvals({ cases, driver: resolveLocal(argv), ... })
  writeFile report/compare.json { frontier: fr, local: lo }
  printCompareTable(fr.per_kind, lo.per_kind)      # per-kind accuracy + stability, side by side
```

**Edge cases / error handling:**

- `--driver local` with no base URL → **terminal** error, before any rep. (Caller sees the message; no partial run.)
- `--base-url` resolving to localhost/127.0.0.1 → **warn but proceed** (an operator may legitimately tunnel; the guard is against silent default, not deliberate choice).
- `--base-url` passed with `--driver frontier` → ignored with a warning (frontier must not redirect).
- A rep's `spawnSync` error or malformed envelope → **unchanged** from FAFF-130 (driver throws / orchestrator records `erroredRep`).

**Anti-pattern:** Defaulting `baseUrl` to `http://localhost:11434`. Why: it silently targets the wrong host on this tailnet and produces results that look valid but came from nowhere/elsewhere.

**Anti-pattern:** Adding an HTTP client for ollama's `/api/generate`. Why: it abandons the shared `claude -p` path, so the comparison no longer isolates the *model* variable.

**Anti-pattern:** Reading the ollama host from `.faffrc` `faffter_dark.adversarial`. Why: couples the eval driver to an unrelated subsystem whose host value is itself wrong.

---

## 5. SCENARIOS — born-verifiable objectives

```
Given  the local preset with baseUrl="http://studio.longhair-escalator.ts.net:11434" and model="qwen3.6:27b-mlx"
When   buildInvocation(opts, prompt, cfgDir) is called
Then   args == ["-p", prompt, "--model", "qwen3.6:27b-mlx"]
 and   env.ANTHROPIC_BASE_URL == "http://studio.longhair-escalator.ts.net:11434"
 and   env.ANTHROPIC_AUTH_TOKEN == "ollama" and env.ANTHROPIC_API_KEY == ""
 and   env.CLAUDE_CONFIG_DIR == cfgDir
```

```
Given  --driver local with no --base-url and no FAFF_EVAL_LOCAL_BASE_URL
When   the CLI resolves the driver
Then   it exits with a non-zero, explicit "requires --base-url / no localhost default" error
 and   zero reps run
```

```
Given  no --driver flag (the default path)
When   buildInvocation runs for the frontier preset
Then   args == ["-p", prompt] (no --model)
 and   no ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN is injected (frontier hits api.anthropic.com)
```

**Non-functional assertions:**

- Importing `eval/cli-driver.mjs` (or `buildInvocation`) in a `node --test` file spawns **zero** processes.
- `eval/` remains unmatched by the `node --test` globs; `npm test` / CI make zero real model calls.
- Default `node eval/run-evals.mjs` (no flags) is behaviourally identical to the FAFF-130 frontier run.

---

## 6. DESIGN DECISION RATIONALE

**Generalize in place, or new module + rename?**
- Options: (a) keep `frontier-driver.mjs`, add params; (b) rename to `cli-driver.mjs`, `frontier` becomes a preset.
- (a) leaves a filename that lies once it serves local too; (b) is one rename + one import update (sole importer is `run-evals.mjs`'s dynamic import).
- **Chosen:** (b) rename to `cli-driver.mjs` with `makeCliDriver` + `frontierDriver`/`localDriver` presets — honest, cheap, no back-compat alias needed (no external importers).

**Test seam: pure builder vs injectable spawn?**
- Options: (a) export pure `buildInvocation`; (b) inject a fake `spawn` into `makeCliDriver`.
- (a) lets the mock test assert the exact args/env with no spawn machinery and guarantees *import = no I/O*; (b) still constructs a closure and risks an accidental real spawn.
- **Chosen:** (a) pure `buildInvocation` — smallest, safest seam; directly testable.

**Where do base URL + model come from?**
- Options: (a) CLI flag → env → hard error; (b) a `localhost` default; (c) read `.faffrc`.
- (b) violates the no-hardcoded-host principle; (c) couples to the adversarial subsystem (wrong host, wrong concern).
- **Chosen:** (a) flag → env → fail loud, plus a localhost *warning*. No default host ever.

**Comparison affordance shape?**
- Options: (a) `--compare` runs both, one table; (b) leave it entirely to FAFF-131.
- (a) gives a one-command convenience while keeping the heavy measurement in FAFF-131; it's a thin wrapper over two `runEvals` calls + the existing `summarize`.
- **Chosen:** (a) light `--compare` mode writing `report/compare.json` + a per-kind table.

**ollama reachability (temporal anchor: Jan 2026).**
- **Assumes:** ollama (native Anthropic Messages API) on the tailnet + `claude` honouring `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`. Per docs.ollama.com/integrations/claude-code. Validated by the smoke run, not assumed correct at merge.

---

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none blocking. *(The two deferrals — which local model, and reconciling `.faffrc`'s adversarial `localhost` — are in OUT OF SCOPE, not open build decisions: the model is FAFF-131's run-time parameter, and the `.faffrc` fix is a separate ticket this driver is deliberately decoupled from.)*

**FAFF-131 run parameters (operator-supplied):**
- Base URL: `http://studio.longhair-escalator.ts.net:11434` (tailnet ollama host — the `studio` machine on the `longhair-escalator.ts.net` tailnet).
- Model: `qwen3.6:27b-mlx`.

**Assumptions:**

- **Assumes:** the tailnet ollama host serves the Anthropic Messages API and `claude` redirects to it via the three env vars. — Validate **before the full run**:
  `node eval/run-evals.mjs --driver local --base-url http://studio.longhair-escalator.ts.net:11434 --model qwen3.6:27b-mlx --only dupe-001 --reps 2`
  returns a parseable `faff-eval:judgement` envelope. If it errors, the assumption fails and FAFF-131 stops there.
- **Assumes:** `qwen3.6:27b-mlx` provides a ≥64k context window (Claude Code needs a large context). — Validate: the smoke above also exercises it; FAFF-131 confirms.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] The same eval cases + grader can run against a local ollama model via `--driver local`, reusing the `claude -p` path (no new transport added).
- [ ] No `localhost`/host is hardcoded in the local path; the base URL is always supplied.
- [ ] CI makes zero real model calls; `eval/` stays excluded from `node --test`.

### From WHAT (types and interfaces)
- [ ] `cli-driver.mjs` exports `makeCliDriver({bin,model,baseUrl,env})`, `frontierDriver()`, `localDriver({baseUrl,model})`, and pure `buildInvocation(opts,prompt,cfgDir)`.
- [ ] `frontierDriver()` is behaviourally identical to the old `makeFrontierDriver()`; `run-evals.mjs` import updated; old filename removed.
- [ ] `localDriver` sets `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN=ollama`/`ANTHROPIC_API_KEY=""` and passes `--model`.

### From HOW (behaviour)
- [ ] `--driver` defaults to `frontier`; flagless run == FAFF-130 behaviour.
- [ ] `--base-url` resolves flag → `FAFF_EVAL_LOCAL_BASE_URL` → error; `--model` resolves flag → `FAFF_EVAL_LOCAL_MODEL` → error (local).
- [ ] `buildInvocation` appends `--model` only when set and merges preset env + `CLAUDE_CONFIG_DIR` over `process.env`.
- [ ] `--compare` runs both presets over the same cases, writes `report/compare.json`, prints a per-kind accuracy+stability table.

### From HOW (edge cases)
- [ ] `--driver local` without a base URL exits non-zero before any rep, with an explicit message.
- [ ] A localhost/127.0.0.1 base URL warns but proceeds; `--base-url` under `--driver frontier` warns and is ignored.
- [ ] `--driver <unknown>` fails loud.

### From test seam
- [ ] `test/eval-grader.test.mjs` (or a sibling) asserts `buildInvocation` for local (env + `--model`) and frontier (no `--model`, no `ANTHROPIC_*`), and the no-base-url error — all without spawning.

### From docs
- [ ] `eval/README.md` documents `--driver local` (env-var path, Tailscale base URL, the `ollama launch claude` alternative), `--compare`, and a note for FAFF-131 with the operator run parameters.

**Integration smoke test (plumbing-connected check):**

```
inv = buildInvocation(
  { bin:"claude", model:"qwen3.6:27b-mlx", baseUrl:"http://studio.longhair-escalator.ts.net:11434",
    env:{ ANTHROPIC_BASE_URL:"http://studio.longhair-escalator.ts.net:11434", ANTHROPIC_AUTH_TOKEN:"ollama", ANTHROPIC_API_KEY:"" } },
  "PROMPT", "/tmp/cfg")
assert inv.args == ["-p","PROMPT","--model","qwen3.6:27b-mlx"]
assert inv.env.ANTHROPIC_BASE_URL == "http://studio.longhair-escalator.ts.net:11434"
assert inv.env.CLAUDE_CONFIG_DIR  == "/tmp/cfg"
# if this holds, the local preset is wired; the only untested remainder is the real model call (FAFF-131).
```

---

confidence: high
