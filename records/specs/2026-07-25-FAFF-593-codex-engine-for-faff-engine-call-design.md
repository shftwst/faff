# FAFF-593 — `faff engine call` gains a codex engine: spawn `codex exec --json`, parse the event stream, `backends:` entry shape

> Spec: faffter-dark-nlspec · 2026-07-25 · interactive · confidence: high. Full spec on Linear FAFF-593.

This spec is for the build agent implementing FAFF-593 and the humans reviewing it. It adds a `codex` engine type to the `backends:` namespace and teaches `faff engine call` to dispatch a producer through a spawned `codex exec --json` child process, alongside the existing HTTP families. It unblocks FAFF-604 (spend-source read), FAFF-605 (permission mapping), and FAFF-613.

## 1. WHY — Problem and Principles

**The load-bearing model:** `faff engine call` already forks the producer-dispatch *vehicle* on the lane value's shape (ADR-0054) — Agent-token → in-harness subagent, `engine:<name>` → out-of-session one-shot. Today every `engine:<name>` resolution lands on an HTTP family (ollama or openai-compatible). This ticket adds a third family, `codex`, whose transport is a spawned child process rather than an HTTP POST: the request is a prompt on stdin, the response is a JSONL event stream on stdout, and the "final message" event is the producer block. Everything else — the fail-loud exit taxonomy, the lane allowlist, the no-retry/no-fallback posture — is inherited unchanged.

**Problem:** cross-harness L2/L3 needs one portable producer-dispatch transport, and today the only non-Anthropic transports are HTTP endpoints the operator must host. Codex ships a headless mode (`codex exec`: task in, structured JSONL out) that a ChatGPT Plus/Pro seat covers as sanctioned product usage. Without a codex engine, faff cannot dispatch a producer onto that seat at all.

**Design principles** (each would reject an otherwise-valid implementation):

- **Fail loud, never downgrade.** Every failure — missing binary, not logged in, unparseable stream, non-zero child exit — is a named non-zero exit with a remedy. The caller never re-dispatches on the session model. This is the FAFF-50/ADR-0054 posture and it is non-negotiable.
- **Seat auth is the primary mode; hosted-CI auth is nobody's assumption.** Local `codex exec` under a ChatGPT seat is the sanctioned path. The engine must work with nothing but a `codex login`-ed machine; it must never require, probe for, or assume hosted-CI account auth.
- **One auth vocabulary.** The `backends:` namespace already has `auth: subscription-seat | api-key | none`. The codex engine reuses it; it does not mint a `chatgpt-seat` literal (the ticket's phrasing is resolved below).
- **The child gets no hands.** Engine-call lanes are pure-data-in (methodology, intake). The spawned codex child runs in the most restrictive posture available — read-only sandbox, throwaway working directory, no session persistence.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/engine.js` | Node (CJS) | The transport this extends: `cmdEngine`, `ENGINE_EXIT`, injectable transports, selftest table |
| `plugin/skills/faff/bin/lib/config.js` (lines ~167–300) | Node (CJS) | `ENGINE_PROVIDER_FAMILY`, `validateEngineRef`, `resolveEngineForLane`, lane allowlist |
| `plugin/skills/faff/bin/lib/backends.js` | Node (CJS) | `BACKEND_RECORD_KEYS`, `AUTH_VALUES`, `deriveAuth`, `portableMatrixAdmits`, `checkRealizable`, `normalizeBackend` |
| `test/engine-call.test.mjs` | Node test | Existing test conventions (fixture `.faffrc.yaml` dirs, `runCli`, direct pure-fn imports) |
| `records/adr/0054-…transport-selection.md`, `records/adr/0076-…substrate.md` | prose | The decisions this extends |
| `docs/reference/architecture/harness-coupling.md` (subagent-dispatch row) | prose | Names FAFF-593 as the follow-on; currently describes engine call as "a CLI spawn" — this ticket makes that partially true |
| `codex-rs` source (`exec/src/cli.rs`, `exec/src/exec_events.rs`, `cli/src/login.rs`) | external | Verified at spec time via live docs; exact serializations re-pinned at build (see Assumptions) |

**Scope:** this is the third transport family inside the existing `faff engine call` one-shot, on the existing lane allowlist — not a new command, not a new dispatch path, not the tool-needing `claude -p` branch.

## 2. OUT OF SCOPE

- **Spend/window accounting for the codex seat** — turn.completed events carry token usage, but wiring it into the FAFF-594 window governor / budget telemetry is FAFF-604's job. Extension point: the parsed event list returned by the codex parser (keep usage fields available in the parse result, discard nothing).
- **Permission/appetite mapping onto codex sandbox modes** — FAFF-605. This ticket pins engine-call spawns to the one most-restrictive posture; the mapping table for build-capable dispatches is separate. Extension point: the argv-builder function (`buildCodexArgv`).
- **Widening the lane allowlist** — `methodology | intake` stays exactly as is, both enforcement points untouched.
- **Effort → codex reasoning-effort mapping** — codex supports `model_reasoning_effort` via `-c`, but the existing hard-refuse of non-inherit `effort.<lane>` on engine lanes stands (decision below). Extension point: a future per-backend tuning field in the Backend record, mirroring `reasoning_off`.
- **Auth-mode mismatch detection** (configured `api-key` but codex is seat-logged-in, or vice versa) — the probe gates "logged in at all"; distinguishing which mode via stderr text is version-brittle. Extension point: the probe-result classifier.
- **Streaming/incremental event consumption** — the one-shot parses the complete stream after child exit (decision below). Extension point: the parser takes the raw stdout string; a streaming caller would feed it incrementally.
- **A shared transport module across the three direct-API consumers** — explicitly deferred by ADR-0054 until the tool-needing branch lands.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| spawn family | An `ENGINE_PROVIDER_FAMILY` value whose transport is a child process, not HTTP. `codex` is the first. |
| seat probe | The pre-spawn auth check: `codex login status` (exit 0 = logged in, 1 = not). |
| final message | The text of the last agent-message item the JSONL stream completes — what engine call prints to stdout. |

**Backend record for a codex engine** (extends the existing shape; no new namespace):

```
RECORD Backend (codex-provider deltas only):
  provider: "codex"            # new entry in ENGINE_PROVIDER_FAMILY → family "codex"
  model: String                # codex-native model name, passed verbatim via -m (open vocabulary)
  bin_path: String?            # NEW optional field: path to the codex binary; default "codex" (PATH resolution)
  host: ABSENT                 # forbidden on provider codex — fail loud at engine-ref validation if present
  auth: subscription-seat | api-key   # "none" refused for codex at engine-ref validation
  api_key_env: String?         # api-key mode only, existing constraint applies
  timeout: Number?             # existing field, seconds; spawnSync timeout, default 120s
  reasoning_off: ABSENT        # refused on provider codex — fail loud (no codex mapping exists)

  CONSTRAINT provider codex + host present        -> config error at validateEngineRef
  CONSTRAINT provider codex + reasoning_off true  -> config error at validateEngineRef
  CONSTRAINT provider codex + auth none           -> config error at validateEngineRef
```

Example config:

```yaml
backends:
  codex-seat:
    provider: codex
    model: gpt-5-codex
    # no host, no api_key_env: auth derives to subscription-seat
models:
  methodology: engine:codex-seat
```

The non-trivial decisions, each marked:

**Transport fork point.** Where does the codex branch live? Options: grow `engine.js` in place; or a sibling module with `engine.js` forking on family. `engine.js` is already the largest transport file and its pure fns are HTTP-shaped (`buildEngineRequest`/`parseEngineResponse` both throw on unknown family — correctly, and they stay that way).
**Chosen:** a new `plugin/skills/faff/bin/lib/engine-codex.js` holding the codex pure fns + orchestration (`buildCodexArgv`, `parseCodexEvents`, `classifyCodexFailure`, `runCodexCall`, `codexSelftest`), with `cmdEngine` in `engine.js` forking on `res.family === "codex"` after config resolution. `ENGINE_EXIT` stays the single shared taxonomy, imported by the new module.

**Provider → family entry.** **Chosen:** add `codex: "codex"` to `ENGINE_PROVIDER_FAMILY` in `config.js`. The family value is what the dispatch forks on; the closed-map fail-loud behavior for unknown providers is untouched.

**Binary location.** No precedent exists — HTTP engines have `host`, a spawn has a binary. Options: always PATH-resolve `codex`; or a config field.
**Chosen:** a new optional `bin_path` Backend field (added to `BACKEND_RECORD_KEYS` and `normalizeBackend`), defaulting to `"codex"` resolved via PATH at spawn time. No existence pre-check at config read (a config file must stay valid on a machine that doesn't run the engine); a missing binary fails loud at dispatch (ENOENT classification, below).

**Host presence.** `validateEngineRef` currently requires `provider, model, host` for every engine. A codex backend has no host — and a *present* host on a codex backend is confused config.
**Chosen:** `validateEngineRef` makes the required-field list provider-conditional: codex requires `provider, model` and refuses a present `host` with a named error ("a codex engine has no host — it spawns the codex binary; set bin_path if the binary is not on PATH"). Consequence handled in HOW: `checkRealizable`'s host-presence test and the dispatch error-tag string both need codex arms, and `deriveEgress` on a hostless codex backend correctly lands `external` (codex egresses to OpenAI) — no change needed there, but the selftest asserts it so it is deliberate rather than accidental.

**Auth vocabulary.** Ticket says `chatgpt-seat | api-key`; the namespace already has `subscription-seat | api-key | none` (`AUTH_VALUES`, backends.js).
**Chosen:** reuse `subscription-seat` — one vocabulary, the provider names *which* seat. No new literal. `deriveAuth` gains one arm: a keyless `provider: codex` derives `subscription-seat` (mirroring keyless anthropic), so the minimal config above works with zero auth ceremony. `auth: none` is refused for codex at engine-ref validation (codex always authenticates somehow; "none" would be a lie the probe contradicts).

**Harness admission for the codex seat.** `portableMatrixAdmits` currently binds *all* `subscription-seat` backends to `CURRENT_HARNESS = "claude-code"` — correct for the Anthropic ambient session, wrong for codex, whose seat travels with the codex CLI's own login state (`$CODEX_HOME/auth.json`), independent of which harness faff runs on. Left unchanged, a codex backend would be inadmissible everywhere except the one harness it doesn't depend on — and cross-harness portability is this project's whole point.
**Chosen:** `portableMatrixAdmits` gains a provider-aware arm: `provider === "codex" && auth === "subscription-seat"` admits on any harness. The Anthropic-seat binding is untouched.

**api-key mode mechanics.** Codex's own API-key flow is `codex login --with-api-key` (stored in codex's auth storage) — there is no per-invocation key header like the HTTP families.
**Chosen:** `auth: api-key` on a codex backend keeps the existing constraint (`api_key_env` required, unset env var → exit 6 before any spawn, byte-consistent with today's HTTP behavior) and the named env var's *value* is exported into the child environment as `OPENAI_API_KEY`. The seat probe still runs and passing it (stored-key login) also satisfies auth. This rests on an assumption about codex honoring the env var (Assumptions, item C) with a named fallback rule there.

**Effort lanes.** `resolveEngineForLane` hard-refuses any non-inherit `effort.<lane>` on engine-valued lanes. The ticket offers "map faff effort lanes to nearest equivalent or ignore with a loud note".
**Chosen:** keep the hard refusal — it *is* the loud note, and ADR-0054's consequence ("per-engine tuning lives in the engine object") already settles where a future mapping belongs. One wording tweak: the refusal message currently says "does not map onto a local engine"; generalize to "does not map onto an engine backend" so it reads true for codex. No mapping is built.

## 4. HOW — Behavior

**Architecture.** `cmdEngine` resolves the lane exactly as today (allowlist → config → `resolveEngineForLane`). When the resolved family is `codex`, it branches to the codex path instead of the HTTP preflight/POST. The codex path is synchronous.

**Spawn mode.** Options: async spawn with incremental stream parsing, or `spawnSync` with parse-after-exit. `codex exec` is one-shot headless — it runs, prints, exits; nothing consumes events mid-flight in this ticket (spend telemetry is FAFF-604's).
**Chosen:** `spawnSync` (the house pattern — lights-out.js, ci-triage.js) with `{ encoding: "utf8", timeout: <backend timeout ms>, input: <prompt> }`, parsing the complete stdout JSONL after exit. `cmdEngine` already returns either an int (config faults) or a Promise (HTTP path); the codex branch returns an int synchronously, which the existing `bin/faff` handler accepts.

**Prompt delivery.** `codex exec` takes one PROMPT argument or stdin. Argv delivery risks ARG_MAX on large producer payloads.
**Chosen:** stdin (`spawnSync`'s `input` option), content = the system file, a blank line, then the user file — codex has no system/user channel split in exec mode, so the concatenation order (system first) is the contract.

**Spawn posture.** **Chosen:** argv is `[bin_path] exec --json --ephemeral --skip-git-repo-check --sandbox read-only -m <model> -` with `cwd` set to a fresh temp directory under `os.tmpdir()` (removed after). Rationale per flag: `--json` is the transport; `--ephemeral` — a producer dispatch must not accrete session files; `--skip-git-repo-check` + temp cwd — a pure-data-in producer gets no repo; `--sandbox read-only` — the child gets no hands. The trailing `-` requests prompt-from-stdin. Flag availability is Assumptions item E.

```
PROCEDURE dispatch_codex(resolved_engine, system_text, user_text):
  1. IF auth == api-key AND env[api_key_env] unset:
       stderr "auth-failed — backends.<name> declares api_key_env X but that env var is unset"
       RETURN exit 6                                  # before any spawn, matching HTTP behavior
  2. Seat probe: spawnSync(bin_path, ["login", "status"], timeout 5s)
     a. spawn error ENOENT -> stderr "engine-unreachable — codex binary not found at <bin_path>;
        install codex or set backends.<name>.bin_path" ; RETURN exit 5
     b. probe exit != 0    -> stderr "auth-failed — codex is not logged in (<stderr excerpt>);
        remedy: run `codex login` on this machine" ; RETURN exit 6
     c. probe exit == 0    -> continue (probe stderr text is informational only, never parsed for control flow)
  3. Spawn: spawnSync(bin_path, exec_argv, { input: system+"\n\n"+user, cwd: tmpdir, timeout, encoding utf8 })
     a. spawn error ENOENT       -> as 2a (exit 5)
     b. killed by timeout        -> stderr "engine-unreachable — codex exec timed out after <t>ms" ; RETURN exit 5
  4. Parse stdout as JSONL (parseCodexEvents — pure, fail-loud):
     a. FOR each non-empty line: JSON.parse; any parse failure ->
        "malformed-response — non-JSON line in codex event stream: <excerpt>" ; RETURN exit 7
     b. Collect events; final_message = text of the LAST item-completed event whose item is an agent message
  5. IF child exit != 0:
     a. classifyCodexFailure(stderr, events):
        auth-shaped signal (stderr matching /login|auth|401|403/i, or an auth-classed error event)
                                 -> "auth-failed — <excerpt>; remedy: codex login" ; RETURN exit 6
        otherwise                -> "engine-unreachable — codex exec exited <code>: <stderr excerpt>" ; RETURN exit 5
  6. IF child exit == 0 AND no agent-message item found:
        "malformed-response — codex stream completed with no agent message" ; RETURN exit 7
  7. stdout <- final_message.trim() + "\n" ; RETURN exit 0
```

The seat probe is the served-model preflight's substitute: it upgrades error *quality* (a named auth failure before the expensive spawn), never outcome — exactly the stance the existing preflight comment in `engine.js` documents for probe-less families. There is no model-served probe for codex (no listing endpoint); a bad model name fails classified at step 5.

**Final-message extraction.** Options: parse the JSONL for the last agent-message item; or pass `--output-last-message FILE` and read the file. **Chosen:** parse the JSONL — one transport artifact, one parser, and the stream is already being parsed for failure classification; a second file-based channel would be a redundant source of truth. (`-o` is recorded as the rejected alternative; revisit only if event serialization proves unstable across codex versions.) At the time of writing, codex-rs `exec_events.rs` serializes top-level events as `{"type": "thread.started" | "turn.started" | "turn.completed" | "item.completed", ...}` with agent-message items carrying a `text` field; the parser keys on "item-completed whose item declares the agent-message type", with the exact field spellings pinned at build against the installed binary (Assumptions, item A).

**Malformed-stream posture.** **Chosen:** any non-empty stdout line that fails `JSON.parse` is `malformed-response` (exit 7) — even when a final message was also found. Tolerating stray lines would be a silent-degradation crack; codex directs human-facing chatter to stderr, so stdout under `--json` is all-JSONL by contract. Blank lines are skipped.

**Error categories:** all terminal, no retry (unchanged posture). Config faults (host present, reasoning_off present, auth none, unknown provider) → exit 2 at resolution. Missing binary / timeout / non-auth child failure → exit 5. Missing auth (env unset, probe fail, auth-shaped child failure) → exit 6. Unparseable stream / no agent message → exit 7. Exit 4 (model-not-served) is unused by the codex family — nothing probes the model list, so nothing can emit it.

**Anti-pattern:** falling back to `-o`/file extraction (or a session-model re-run) when the stream fails to parse. Why: every fallback here is a silent downgrade wearing resilience clothes — the whole taxonomy exists so the caller parks on a named failure.

**Anti-pattern:** parsing the probe's stderr text ("Logged in using ChatGPT" vs "…an API key") for control flow. Why: version-brittle; the exit code is the contract (verified in codex-rs `login.rs`: 0 logged-in, 1 not).

**Downstream contract validation** is unchanged: engine call's stdout is handed verbatim to the caller, which locates the `faff-contract:*` block — no engine-side validation, same as the HTTP families.

**`checkRealizable` interaction.** The current loop skips any ref without a host (`if (!present(b.host)) continue`), so a codex backend in a `refs:` chain would silently never count as realizable — a latent contradiction with this ticket, not a hypothetical. **Chosen:** the host-presence test becomes provider-conditional: for `provider: codex` the check is matrix admission only (binary existence is a dispatch-time fact, not a config-time one). Residency is unaffected: a hostless backend derives `egress: external`, which is truthful for codex — a `requires: local` chain correctly refuses it.

**Selftest** (`engine-codex.js` gets its own table; `engineSelftest` invokes it and folds the failure count, so `faff engine --selftest` stays the single entry point). All rows use an injected `spawnFn` — zero real spawns in CI, mirroring `getFn`/`postFn`. Table, minimum rows:

| Row | Injected behavior | Expected |
|---|---|---|
| happy path | probe exit 0; exec exit 0, valid JSONL with one agent message | exit 0, stdout is the message text, exactly one exec spawn |
| missing auth (seat) | probe exit 1 "Not logged in" | exit 6, remedy names `codex login`, exec never spawned |
| missing auth (api-key env) | `api_key_env` declared, env unset | exit 6 before any spawn (probe included) |
| binary missing | spawn error ENOENT | exit 5, remedy names install/`bin_path` |
| malformed JSONL | exec exit 0, stdout contains a non-JSON line | exit 7, excerpt in stderr |
| non-zero child exit (non-auth) | exec exit 1, stderr "model not found" | exit 5, stderr excerpt surfaced |
| non-zero child exit (auth-shaped) | exec exit 1, stderr mentions 401 | exit 6 |
| no agent message | exec exit 0, JSONL with only turn events | exit 7 |
| timeout | spawnSync returns killed/ETIMEDOUT | exit 5 naming the timeout |
| argv shape | pure `buildCodexArgv` | contains `exec --json --ephemeral --skip-git-repo-check --sandbox read-only -m <model> -`, in a stable order |
| config guards | fixture cfgs | host-present / reasoning_off / auth-none / codex-realizability / deriveAuth-codex / matrix-any-harness each behave as specified |

**Tests** extend `test/engine-call.test.mjs` (same fixture-dir + `runCli` + direct pure-fn import conventions) covering the read-time guards via `config get` and the dispatch table via injected spawn.

**Docs touches:** the subagent-dispatch row in `docs/reference/architecture/harness-coupling.md` updates to describe engine call truthfully (HTTP one-shot for ollama/openai families, CLI spawn for codex) and drops the "Follow-on: FAFF-593" pointer. **Chosen:** the transport-family branch is recorded as a new ADR extending ADR-0054's decision (the spawn family is a fourth branch of the same fork), authored at graft time by the `adr` slot — not an edit to ADR-0054's body.

**Failure modes** (approach-level, with observables):

- **The failure:** codex event serialization drifts across versions (field renames in `exec_events.rs`); the parser finds no agent message on a healthy run. **How you'd know:** exit 7 "no agent message" on a manually-verified-good `codex exec --json`. **What it means:** re-pin field names against the installed version; the parser's key-on-shape design localizes the fix to `parseCodexEvents`.
- **The failure:** the seat probe passes but the exec call still auth-fails (expired token mid-window, seat rate-limited). **How you'd know:** exit 6 from step 5 classification despite a green probe. **What it means:** proceed — the probe is quality, not a guarantee; classification catches what it misses.
- **The failure:** `--sandbox read-only` or `--ephemeral` absent from the operator's installed codex version → child exits non-zero on unknown flag. **How you'd know:** exit 5 with the clap error in the stderr excerpt on every dispatch. **What it means:** narrow — the build pins a minimum codex version in the error remedy; do not silently drop the flag.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a backends: entry with provider codex and a logged-in codex CLI on PATH
When faff engine call dispatches an allowlisted lane resolved to that backend
Then the fork runs `codex exec --json` (with --ephemeral, --skip-git-repo-check, --sandbox read-only),
     exits 0, and stdout is exactly the final agent message text
```

```
Given a codex backend and a machine where `codex login status` exits 1
When faff engine call dispatches to it
Then the exit is 6 (auth-failed), stderr names `codex login` as the remedy,
     and codex exec is never spawned
```

```
Given a codex exec child that exits 0 but emits a non-JSON line on stdout
When the stream is parsed
Then the exit is 7 (malformed-response) with the offending line excerpted — never a silent pass
```

- The producer block returned through a codex dispatch MUST validate against the same `faff contract` parsing as a Claude-engine fork's output (no engine-side transformation of the message text beyond trim).
- A codex backend inside a `requires: local` chain MUST refuse with a residency violation (codex egresses).

## 6. Design decision rationale

The contested calls, with rejected alternatives (all markers live in their body sections above):

- **`subscription-seat` reuse vs a `chatgpt-seat` literal** — a second seat literal would fork the auth vocabulary per provider and ripple through `AUTH_VALUES`, constraint validation, and the matrix for zero expressive gain; the provider field already says whose seat. Rejected: new literal.
- **`spawnSync` vs async streaming** — streaming buys nothing this ticket consumes and would make the codex branch the second async handler for no reader benefit. Rejected: async. Revisit when FAFF-604 wants live usage events, at which point the parser's raw-string input is the seam.
- **JSONL extraction vs `--output-last-message` file** — one artifact, one parser; the stream must be parsed for classification anyway. Rejected: the file channel.
- **Effort mapping vs the standing hard-refuse** — the refusal is already the "loud note" the ticket permits, and it keeps the invariant that Agent-tool knobs never silently retarget engines. Rejected: mapping faff lanes onto `model_reasoning_effort` (future Backend field if wanted).
- **Probe-then-spawn vs classify-only** — classification alone is legal per the existing preflight stance, but `codex login status` is cheap, verified stable (exit-code contract in codex-rs source), and turns the commonest operator error into an instant named remedy. Chosen: probe, with classification still behind it.

## 7. Open Questions and Assumptions

**Open questions:** none — every decision above is closed.

**Assumptions** (each with its build-time validation):

- **Assumes:** `codex exec --json` emits JSONL top-level events typed `thread.started` / `turn.started` / `turn.completed` / `item.completed`, with agent-message items carrying a `text` field (read from codex-rs `exec/src/exec_events.rs` at spec time). Validate: run `codex exec --json 'say hi'` against the installed binary before writing the parser; pin the exact item-type/field spellings from the observed output.
- **Assumes:** `codex login status` exists as a subcommand and exits 0 when logged in, 1 when not (read from codex-rs `cli/src/login.rs`). Validate: run it logged-in and against an empty `CODEX_HOME`.
- **Assumes:** the codex child honors `OPENAI_API_KEY` in its environment for api-key auth. Validate: `env OPENAI_API_KEY=<key> CODEX_HOME=<empty dir> codex exec 'say hi'`. If unsupported in the installed version: the api-key arm keeps the env-unset guard but the dispatch error for a failed probe under `auth: api-key` names `codex login --with-api-key` as the remedy instead of the env var — seat auth remains the primary, fully-working mode either way, per the ticket's own subscription note.
- **Assumes:** `codex exec` exits non-zero (1) on fatal errors and failed/interrupted turns (read from codex-rs `exec/src/lib.rs`). Validate: force a bad model name and observe.
- **Assumes:** the flags `--ephemeral`, `--skip-git-repo-check`, `--sandbox read-only`, `-m`, and stdin-prompt via `-` are all supported by the installed codex version (`--ephemeral`/`--skip-git-repo-check` read from `exec/src/cli.rs`; `--sandbox` is a shared option not directly sighted in the excerpt). Validate: `codex exec --help`; any absent flag is a build-time decision to drop or replace it loudly, never a runtime silent drop.

## 8. DONE — Definition of Done

### From WHAT (config shape)
- [ ] `ENGINE_PROVIDER_FAMILY` gains `codex: "codex"`; unknown-provider behavior unchanged
- [ ] `bin_path` added to `BACKEND_RECORD_KEYS` + `normalizeBackend`; absent → spawn uses `"codex"` via PATH
- [ ] `validateEngineRef` on provider codex: requires provider+model, refuses present `host`, refuses `reasoning_off: true`, refuses `auth: none` — each with a named error
- [ ] `deriveAuth`: keyless `provider: codex` → `subscription-seat`
- [ ] `portableMatrixAdmits`: codex + subscription-seat admits on any harness; Anthropic-seat binding unchanged
- [ ] `checkRealizable`: codex refs are admission-checked without the host-presence requirement; a codex ref in a `requires: local` chain refuses (egress external)
- [ ] `resolveEngineForLane` returns a codex-shaped record (bin_path, no host) and its effort refusal message no longer says "local engine"

### From HOW (dispatch)
- [ ] `lib/engine-codex.js` exists with pure `buildCodexArgv` / `parseCodexEvents` / `classifyCodexFailure` + `runCodexCall` with injectable `spawnFn`; `cmdEngine` forks on family `codex`
- [ ] Spawn argv contains exactly the posture flags (`--json --ephemeral --skip-git-repo-check --sandbox read-only -m <model> -`), cwd is a fresh temp dir, prompt (system + blank line + user) arrives on stdin
- [ ] Unset `api_key_env` → exit 6 before any spawn; probe exit ≠ 0 → exit 6 naming `codex login`; ENOENT → exit 5 naming install/`bin_path`; timeout → exit 5; non-JSON stdout line → exit 7 with excerpt; zero agent messages → exit 7; non-auth child failure → exit 5 with stderr excerpt; auth-shaped child failure → exit 6
- [ ] Happy path: exit 0, stdout = final agent message text + newline, exactly one exec spawn, no retry on any failure path

### From HOW (verification and docs)
- [ ] Selftest table above implemented in `engine-codex.js`, folded into `faff engine --selftest`'s pass/fail
- [ ] `test/engine-call.test.mjs` extended: read-time codex guards via `config get`, dispatch table via injected spawn, zero real spawns/network in CI
- [ ] All five Assumptions validated against the installed codex binary before the parser/argv shapes are frozen; any divergence resolved loudly (pinned version in remedies, never a silent drop)
- [ ] `docs/reference/architecture/harness-coupling.md` subagent-dispatch row updated; ADR recording the spawn-family branch (extending ADR-0054) authored at graft

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Fixture repo with backends.codex-seat (provider codex, model m) and models.methodology: engine:codex-seat
  2. Run `faff engine call --lane methodology --system s.md --user u.md` with an injected/stub codex
     binary on PATH that prints a canned valid JSONL stream and exits 0
  3. ASSERT exit 0 and stdout equals the canned agent-message text
  4. Point models.build at engine:codex-seat -> ASSERT config get exits 2 naming the allowlist (unchanged guard)
```

confidence: high
