// ===========================================================================
// === region:factory — engine-codex — the codex spawn family (FAFF-593) ===
// ===========================================================================
// The first SPAWN transport family for `faff engine call` (ADR-0054's fork gains
// a child-process branch): a producer dispatch rides a spawned `codex exec --json`
// child instead of an HTTP POST. The prompt goes in on stdin, the response comes
// back as a JSONL event stream on stdout, and the final agent message is the
// producer block. Everything else — the ENGINE_EXIT taxonomy, the lane allowlist,
// the no-retry/no-fallback posture — is inherited from engine.js unchanged.
//
// The child gets no hands: `--sandbox read-only`, `--ephemeral` (no session
// accretion), `--skip-git-repo-check` plus a fresh throwaway temp cwd (removed
// after). Seat auth (`codex login`) is the primary mode; api-key mode exports
// the named env var's value as OPENAI_API_KEY into the child. Fail loud
// everywhere: missing binary, not logged in, unparseable stream, non-zero child
// exit — each a named non-zero exit with a remedy; the caller NEVER re-dispatches
// on the session model (the FAFF-50 silent-downgrade failure mode).
//
// Event/flag shapes follow codex-rs (`exec/src/exec_events.rs`, `exec/src/cli.rs`,
// `cli/src/login.rs`) as pinned in the spec, and were CONFIRMED against a live
// codex-cli 0.145.0 on 2026-07-28 (FAFF-665): the argv below runs exit 0, the
// `item.completed` → `agent_message` envelope holds, taking the LAST agent_message
// is what returns the answer on a multi-message turn, and the usage subtraction
// checks out. Captures in `docs/reference/architecture/codex-cli-observed.md`.
// The drift observable still stands for future versions — re-pin
// parseCodexEvents/buildCodexArgv if a healthy run exits 7 "no agent message".

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { ENGINE_EXIT } = require("./engine");
const { routeUnknownTtlWrite } = require("./budget");
const { reasoningEffortForTransport } = require("./config");
// FAFF-877: the shared bounded-operation supervisor — the codex exec spawn now runs
// under it (async + detached + heartbeat-renewed) instead of a blocking spawnSync.
const { DEFAULT_OPERATION_DEADLINE_SECS, SUPERVISED_OUTCOME, makeLease, mapKillableOutcome, superviseSubprocess } = require("./supervisor");

const SEAT_PROBE_TIMEOUT_MS = 5000;

function excerpt(s, n = 200) { return String(s || "").trim().slice(0, n); }

// PURE: the exec argv AFTER bin_path — stable order, exactly the spawn posture
// (spec §4): --json is the transport; --ephemeral — a producer dispatch must not
// accrete session files; --skip-git-repo-check + temp cwd — a pure-data-in
// producer gets no repo; --sandbox read-only — the child gets no hands; the
// trailing "-" requests the prompt from stdin.
function buildCodexArgv(model, effort = null) {
  if (!model) throw new Error("buildCodexArgv requires a model");
  const base = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-m", String(model)];
  // FAFF-705: a graded effort rides as a `-c model_reasoning_effort=<mapped>` config override
  // (codex's own reasoning-effort dial), before the trailing stdin `-`. The faff level is mapped
  // onto codex's three-level target (xhigh/max clamp to high). Absent effort → unchanged argv.
  if (effort) base.push("-c", `model_reasoning_effort=${reasoningEffortForTransport(effort)}`);
  return [...base, "-"];
}

// PURE: parse the complete stdout JSONL after child exit. Fail-loud: ANY
// non-empty line that fails JSON.parse throws — even when a final message was
// also found (tolerating stray lines would be a silent-degradation crack;
// stdout under --json is all-JSONL by contract, chatter goes to stderr). Blank
// lines are skipped. Returns { events, finalMessage } — the full parsed event
// list (usage fields on turn.completed included, discarded nowhere) is the
// FAFF-604 spend-read extension point. finalMessage is the text of the LAST
// item.completed event whose item declares the agent-message type, or null.
function parseCodexEvents(raw) {
  const events = [];
  let finalMessage = null;
  for (const line of String(raw || "").split("\n")) {
    if (line.trim() === "") continue;
    let ev;
    try { ev = JSON.parse(line); }
    catch { throw new Error(`non-JSON line in codex event stream: ${excerpt(line)}`); }
    events.push(ev);
    // codex-rs exec_events.rs: item.completed carries an item whose type tag is
    // "agent_message" with a `text` field. Both observed tag spellings
    // (`item_type` / `type`) are accepted — same concept, serde-version drift.
    const item = ev && ev.type === "item.completed" ? ev.item : null;
    if (item && (item.item_type === "agent_message" || item.type === "agent_message") && typeof item.text === "string") {
      finalMessage = item.text;
    }
  }
  return { events, finalMessage };
}

// PURE (FAFF-604, extended FAFF-666): total the usage carried on the stream's
// `turn.completed` events into the four token classes budget/economics bucket
// by. `turn.completed.usage` reports FIVE fields (codex-cli 0.145.0,
// docs/reference/architecture/codex-cli-observed.md); every one is either summed into a
// class below or dispositioned in this comment — none is silently dropped.
//
// The class model comes from the Anthropic transcript, where the classes are
// DISJOINT (`input_tokens` excludes the two cache classes). The codex/OpenAI
// shape differs: `cached_input_tokens` is a SUBSET of `input_tokens` — which is
// why codex-rs exposes a `non_cached_input()` helper at all. So the cached
// portion is SUBTRACTED out of the input class rather than added alongside it;
// adding both would count those tokens twice and, once codex models reach the
// price map, bill them twice (at the full input rate AND the cache-read rate).
//
// `cache_write_input_tokens` -> the cache-write classes (FAFF-666, settled by
// FAFF-724; FAFF-964 TTL split): codex reports no TTL split for its cache-write, so
// the whole amount is an unknown-TTL write and is routed through the shared
// `routeUnknownTtlWrite` (→ `cache_write_1h`, the overcount-safe direction). A fresh
// codex spend record therefore carries the split keys, and a legacy bare-`cache_write`
// record is read back-compatibly by `readEngineSpend`.
// codex-rs 0.147.0 maps it from `input_tokens_details.cache_write_tokens`.
// OpenAI defines that object as the detailed breakdown of input tokens, and
// codex's own parser fixture partitions 100 input tokens into 40 cached plus
// 60 cache-write tokens. It is therefore a SUBSET of `input_tokens` and must
// be subtracted alongside `cached`. This also gives true class parity with the
// Anthropic reader, whose `input` class already excludes both cache classes
// (see TOKEN_CLASS_FROM_USAGE in budget.js).
//
// `reasoning_output_tokens` is dispositioned here but NOT added to `output`.
// codex-rs maps it from `output_tokens_details.reasoning_tokens`; OpenAI calls
// that object the detailed breakdown of output tokens. The same codex fixture
// reports 10 output tokens, including 5 reasoning tokens, so reasoning is a
// SUBSET already inside `output_tokens`.
//
// Floored at 0: a stream reporting more cached+cache_write than input is
// incoherent, and clamping keeps the class non-negative rather than
// propagating the nonsense. Missing or non-finite fields contribute nothing
// (an under-count, the safe direction — the same posture the transcript loop
// takes on a malformed record).
function sumCodexUsage(events) {
  const totals = { input: 0, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 };
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  for (const ev of events || []) {
    if (!ev || ev.type !== "turn.completed") continue;
    const u = ev.usage;
    if (!u || typeof u !== "object") continue;
    const cached = n(u.cached_input_tokens);
    const cacheWrite = n(u.cache_write_input_tokens);
    totals.input += Math.max(0, n(u.input_tokens) - cached - cacheWrite);
    totals.output += n(u.output_tokens);
    const routed = routeUnknownTtlWrite(cacheWrite);
    totals.cache_write_5m += routed.cache_write_5m;
    totals.cache_write_1h += routed.cache_write_1h;
    totals.cache_read += cached;
  }
  return totals;
}

// PURE: split a failed child exit into auth-failed vs engine-unreachable. An
// auth-shaped signal is stderr matching /login|auth|401|403/i or an auth-classed
// error event in the parsed stream; everything else is unreachable. The seat
// probe already caught the commonest auth failure — this catches what it missed
// (expired token mid-window, seat rate-limited).
function classifyCodexFailure(stderr, events) {
  const authRe = /login|auth|401|403/i;
  if (authRe.test(String(stderr || ""))) return "auth";
  for (const ev of events || []) {
    if (ev && ev.type === "error" && authRe.test(String(ev.message || ""))) return "auth";
  }
  return "unreachable";
}

// The one-shot spawn orchestration (spec §4 PROCEDURE dispatch_codex): api-key
// guard → seat probe → ONE exec spawn → fail-loud parse → classify. Returns
// Promise<ENGINE_EXIT> (FAFF-877: was a synchronous int — the exec spawn is now
// ASYNC + DETACHED and runs under the shared operation supervisor, so the parent
// heartbeat renews for the call's full duration instead of a blocked spawnSync
// starving it; bin/faff's dispatcher already accepts int-or-Promise, unchanged).
// spawnFn (the seat probe only, still spawnSync-shaped) / spawnAsyncFn (the ONE exec
// child, node:child_process.spawn-shaped) / env / writers injectable — the selftest
// and CI make zero real spawns.
async function runCodexCall({
  engine, system, user,
  spawnFn = spawnSync, spawnAsyncFn = spawn,
  env = process.env, stdoutWrite, stderrWrite, mkdtempFn = fs.mkdtempSync,
  spendSink = null, nowFn = () => new Date().toISOString(),
  // FAFF-877: the EXACT parent run_dir the supervisor's heartbeat lease renews —
  // absent outside a run (an ad-hoc call), which still runs the same bounded,
  // killable spawn, it just has nothing to renew. `superviseFn`/`importKillableSpawn`
  // injectable so the selftest drives every branch with zero real timers/processes.
  runDir = null, graceSec = undefined,
  superviseFn = superviseSubprocess,
  importKillableSpawn = () => import("./killable-spawn.mjs"),
} = {}) {
  const out = stdoutWrite || ((s) => process.stdout.write(s));
  const err = stderrWrite || ((s) => process.stderr.write(s));
  const binPath = engine.binPath || "codex";

  // 1. api-key mode pre-spawn guard — a declared env var name whose env is unset
  // is auth-failed BEFORE any spawn (probe included), byte-consistent with the
  // HTTP families' behavior.
  let apiKey = null;
  if (engine.apiKeyEnv) {
    apiKey = env[engine.apiKeyEnv];
    if (!apiKey) {
      err(`faff engine call: auth-failed — backends.${engine.name} declares api_key_env "${engine.apiKeyEnv}" but that env var is unset\n`);
      return ENGINE_EXIT.AUTH;
    }
  }

  // 2. Seat probe — `codex login status` (exit-code contract from codex-rs
  // login.rs: 0 logged in, 1 not). The served-model preflight's substitute: it
  // upgrades error QUALITY (a named auth failure before the expensive spawn),
  // never outcome. Probe stderr text is informational only, never parsed for
  // control flow (version-brittle). UNCHANGED — a short, bounded synchronous
  // call (5s ceiling); only the exec child below is long-running.
  const probe = spawnFn(binPath, ["login", "status"], { encoding: "utf8", timeout: SEAT_PROBE_TIMEOUT_MS, env });
  if (probe.error && probe.error.code === "ENOENT") {
    err(`faff engine call: engine-unreachable — codex binary not found at ${binPath}; install codex or set backends.${engine.name}.bin_path\n`);
    return ENGINE_EXIT.UNREACHABLE;
  }
  if (probe.error || probe.status !== 0) {
    const note = excerpt((probe.error && probe.error.message) || probe.stderr || probe.stdout);
    err(`faff engine call: auth-failed — codex is not logged in (${note}); remedy: run \`codex login\` on this machine\n`);
    return ENGINE_EXIT.AUTH;
  }

  // 3. Fresh temp cwd (removed after — a producer dispatch leaves nothing behind).
  // Full env inheritance is DELIBERATE, not a leak: codex needs HOME (auth store
  // discovery), CODEX_HOME (auth store override), and PATH; api-key mode additionally
  // injects the named env var's VALUE as OPENAI_API_KEY. mkdtemp failure (tmpdir
  // unwritable/full) must land on a NAMED exit, never an escaped throw — mkdtempFn
  // injectable so the selftest can drive this row without touching the real tmpdir.
  const childEnv = apiKey ? { ...env, OPENAI_API_KEY: apiKey } : env;
  let tmp;
  try {
    tmp = mkdtempFn(path.join(os.tmpdir(), "faff-codex-"));
  } catch (e) {
    err(`faff engine call: engine-unreachable — could not create temp working dir for codex exec: ${excerpt(e && e.message)}\n`);
    return ENGINE_EXIT.UNREACHABLE;
  }

  // 4. FAFF-877: the ONE exec spawn — prompt (system + blank line + user — codex exec
  // has no system/user channel split, concatenation order is the contract) written to
  // stdin, now via an ASYNC DETACHED child (its own process group) run under the shared
  // supervisor, instead of a blocking spawnSync. Total budget is the LEASE's operation
  // deadline (engine.operationDeadlineSecs, default 3600s, per-consumer overridable —
  // section 6's human decision) — the old DEFAULT_CODEX_TIMEOUT_MS/spawnSync-`timeout`
  // role is retired for this spawn family; a connection-style timeout stays meaningful
  // only where an actual HTTP connection applies (engine.js's runEngineCall).
  //
  // `capturingSpawnFn` is what makes the RELOCATED killable-spawn.mjs's runKillable —
  // built for review-spawn.mjs's inherit-stdio, pass-the-exit-code-through use — work
  // for this module's need to CAPTURE stdout/stderr for JSONL parsing instead: it wraps
  // the injected `spawnAsyncFn`, pipes stdio, writes the prompt to stdin, and buffers
  // output into this closure's `stdout`/`stderr` — runKillable never inspects the opts
  // object it builds itself beyond handing it to the injected spawnFn (its own documented
  // contract), so overriding stdio here changes nothing about its kill discipline.
  const prompt = `${String(system ?? "")}\n\n${String(user ?? "")}`;
  const argv = buildCodexArgv(engine.model, engine.effort);
  const deadlineSecs = engine.operationDeadlineSecs || DEFAULT_OPERATION_DEADLINE_SECS;
  let stdout = "";
  let stderr = "";
  let spawnErr = null;
  const capturingSpawnFn = (cmd, args) => {
    let child;
    try {
      child = spawnAsyncFn(cmd, args, { cwd: tmp, env: childEnv, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      spawnErr = e;
      throw e; // killable-spawn.mjs's runKillable catches a throwing spawnFn -> spawn-failed
    }
    if (child.stdin) { try { child.stdin.write(prompt); child.stdin.end(); } catch { /* a real fault surfaces on the 'error' event below */ } }
    if (child.stdout) child.stdout.on("data", (c) => { stdout += c; });
    if (child.stderr) child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", (e) => { if (!spawnErr) spawnErr = e; }); // captured for classification; runKillable's OWN "error" listener (registered after this returns) still drives its outcome
    return child;
  };

  let killed;
  try {
    if (runDir) {
      const lease = makeLease({ name: "engine:codex", run_dir: runDir, deadline_secs: deadlineSecs });
      killed = await superviseFn({ lease, target: [binPath, ...argv], spawnFn: capturingSpawnFn, graceSec });
    } else {
      // No run to attribute a heartbeat lease to (an ad-hoc call outside a run) — the
      // spawn is still bounded and killable via the SAME relocated killGroup discipline,
      // it just has nothing to renew (no lease, no supervisor wrapper needed).
      const { runKillable, DEFAULT_GRACE_SECONDS } = await importKillableSpawn();
      const raw = await runKillable(
        { deadlineSec: deadlineSecs, graceSec: graceSec != null ? graceSec : DEFAULT_GRACE_SECONDS, target: [binPath, ...argv] },
        { spawnFn: capturingSpawnFn },
      );
      killed = mapKillableOutcome(raw);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (killed.outcome === SUPERVISED_OUTCOME.DEADLINE_KILLED) {
    err(`faff engine call: engine-unreachable — codex exec exceeded its operation deadline of ${deadlineSecs}s\n`);
    return ENGINE_EXIT.UNREACHABLE;
  }
  if (killed.outcome === SUPERVISED_OUTCOME.CANCELLED) {
    err(`faff engine call: engine-unreachable — codex exec aborted (${(killed.result && killed.result.signal) || killed.signal || "signal"})\n`);
    return ENGINE_EXIT.UNREACHABLE;
  }
  if (killed.outcome === SUPERVISED_OUTCOME.FAILED) {
    if (spawnErr && spawnErr.code === "ENOENT") {
      err(`faff engine call: engine-unreachable — codex binary not found at ${binPath}; install codex or set backends.${engine.name}.bin_path\n`);
      return ENGINE_EXIT.UNREACHABLE;
    }
    err(`faff engine call: engine-unreachable — codex exec failed to spawn: ${excerpt((killed.error && killed.error.message) || (spawnErr && spawnErr.message))}\n`);
    return ENGINE_EXIT.UNREACHABLE;
  }

  // killed.outcome === COMPLETED — killed.result is killable-spawn's own
  // {status:"exited", innerExit, signal} outcome shape.
  const exitCode = killed.result && killed.result.innerExit;

  // 5. Fail-loud parse of the complete stream (parse BEFORE the exit-code check —
  // a failed run's error events feed classification).
  let parsed;
  try { parsed = parseCodexEvents(stdout); }
  catch (e) {
    err(`faff engine call: malformed-response — ${e.message}\n`);
    return ENGINE_EXIT.MALFORMED;
  }

  // 6. Non-zero child exit → auth-failed or engine-unreachable, never a retry.
  if (exitCode !== 0) {
    if (classifyCodexFailure(stderr, parsed.events) === "auth") {
      err(`faff engine call: auth-failed — ${excerpt(stderr) || "codex exec auth failure"}; remedy: codex login\n`);
      return ENGINE_EXIT.AUTH;
    }
    err(`faff engine call: engine-unreachable — codex exec exited ${exitCode}: ${excerpt(stderr)}\n`);
    return ENGINE_EXIT.UNREACHABLE;
  }

  // 7. A clean exit with no agent message is malformed, not empty-pass.
  if (parsed.finalMessage === null) {
    err("faff engine call: malformed-response — codex stream completed with no agent message\n");
    return ENGINE_EXIT.MALFORMED;
  }

  // 8. FAFF-604 — record this call's spend. codex exec is `--ephemeral`: no
  // session file, temp cwd already gone, so nothing codex-side survives to be
  // attributed later. The call boundary is the ONLY place that knows both the
  // usage and the run, so attribution happens here, via an injected sink (the
  // caller supplies one bound to the run dir; absent — an ad-hoc call outside a
  // run — nothing is recorded). A sink fault WARNS and leaves the exit code
  // alone: spend metering must never break a producer dispatch. Recorded only on
  // the success path; a failed call's partial usage is left uncounted, the same
  // under-count-not-over-count direction the transcript path already errs in.
  if (spendSink) {
    try {
      spendSink({
        ts: nowFn(),
        engine: engine.name,
        provider: engine.provider,
        model: engine.model,
        source: "exec-json-events",
        // FAFF-705: carry the resolved faff effort level so `economics --by effort` buckets an
        // engine-lane call like an Agent-lane one. Omit the key entirely when null (inherit) —
        // NOT `effort: null` — so an inherit call's record is byte-identical to today.
        ...(engine.effort ? { effort: engine.effort } : {}),
        ...sumCodexUsage(parsed.events),
      });
    } catch (e) {
      err(`faff engine call: warning — could not record codex spend: ${excerpt(e && e.message)}\n`);
    }
  }

  // 9. stdout is the producer block, handed verbatim to the caller (trim only).
  out(parsed.finalMessage.trim() + "\n");
  return ENGINE_EXIT.OK;
}

// Selftest — the spec's dispatch table via injected spawnFn (zero real spawns)
// plus the config-guard rows. Returns the failure COUNT; engineSelftest folds it
// so `faff engine --selftest` stays the single entry point.
async function codexSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL codex: ${name}`); fail++; } else console.log(`ok   codex: ${name}`); };
  const { resolveEngineForLane, validateEngineRef } = require("./config");
  const { checkRealizable, deriveAuth, deriveEgress, mergeBackendsNamespace, portableMatrixAdmits } = require("./backends");
  const { EventEmitter } = require("node:events");

  const sink = () => {};
  const engine = { name: "seat", provider: "codex", family: "codex", model: "gpt-5-codex", binPath: "codex", apiKeyEnv: null, timeoutMs: 1000, operationDeadlineSecs: 3600 };
  const AGENT_LINE = JSON.stringify({ type: "item.completed", item: { id: "item_0", item_type: "agent_message", text: "the block" } });
  const TURN_LINE = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } });
  const probeOk = { status: 0, stdout: "Logged in using ChatGPT", stderr: "", error: null, signal: null };
  // Injected sync spawn — the SEAT PROBE ONLY (unchanged spawnSync-shaped contract).
  const seq = (probeRes, calls) => (cmd, args, opts) => {
    if (calls) calls.push({ cmd, args, opts });
    return probeRes;
  };

  // FAFF-877: a fake ASYNC exec child (node:child_process.spawn's return shape — pid,
  // stdin.write/end, stdout/stderr as event emitters, on(event,cb)) built on a real
  // node:events EventEmitter so BOTH this test's own listeners (stdin capture) and
  // runKillable's own "error"/"exit" listeners (registered after spawnFn returns)
  // coexist correctly. Events fire on a microtask — after capturingSpawnFn's own
  // synchronous listener registration completes, mirroring real async spawn timing.
  // Zero real processes, zero real timers.
  function fakeExecChild({ stdout = "", stderr = "", exitCode = 0, signal = null, errorCode = null, onStdin = null } = {}) {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: (s) => { if (onStdin) onStdin(s); }, end: () => {} };
    queueMicrotask(() => {
      if (errorCode) {
        const e = new Error(`spawn codex ${errorCode}`);
        e.code = errorCode;
        child.emit("error", e);
        return;
      }
      if (stdout) child.stdout.emit("data", stdout);
      if (stderr) child.stderr.emit("data", stderr);
      child.emit("exit", exitCode, signal);
    });
    return child;
  }
  // seqAsync: the exec spawn fake — one call per invocation, each entry exposing the
  // stdin text actually written (`entry.stdin()`) alongside cmd/args/opts (no `input`
  // option any more — FAFF-877 writes the prompt to the child's stdin stream instead).
  const seqAsync = (execSpec, calls) => (cmd, args, opts) => {
    let written = "";
    if (calls) calls.push({ cmd, args, opts, stdin: () => written });
    return fakeExecChild({ ...execSpec, onStdin: (s) => { written += s; } });
  };

  // argv shape — pure, stable order
  ok("argv is exactly the posture flags in stable order",
    buildCodexArgv("m").join(" ") === "exec --json --ephemeral --skip-git-repo-check --sandbox read-only -m m -");
  // FAFF-705: a graded effort appends -c model_reasoning_effort=<mapped> before the trailing -.
  ok("argv: graded effort appends model_reasoning_effort before trailing -",
    buildCodexArgv("m", "medium").join(" ") === "exec --json --ephemeral --skip-git-repo-check --sandbox read-only -m m -c model_reasoning_effort=medium -");
  ok("argv: above-ceiling effort clamps to high in argv",
    buildCodexArgv("m", "xhigh").join(" ") === "exec --json --ephemeral --skip-git-repo-check --sandbox read-only -m m -c model_reasoning_effort=high -");
  ok("argv: absent effort → unchanged argv (byte-identity)",
    buildCodexArgv("m", null).join(" ") === "exec --json --ephemeral --skip-git-repo-check --sandbox read-only -m m -");

  // parser — fail-loud, events kept (FAFF-604 seam)
  {
    const p = parseCodexEvents(`${TURN_LINE}\n${AGENT_LINE}\n`);
    ok("parse: final agent message extracted", p.finalMessage === "the block");
    ok("parse: all events kept incl. usage fields (FAFF-604 seam)", p.events.length === 2 && p.events[0].usage.input_tokens === 10);
  }
  { let threw = false; try { parseCodexEvents(`${AGENT_LINE}\nnot json\n`); } catch (e) { threw = /non-JSON line/.test(e.message); }
    ok("parse: stray non-JSON line fails loud even with a message present", threw); }
  ok("parse: only turn events -> no final message (null, not empty pass)", parseCodexEvents(`${TURN_LINE}\n`).finalMessage === null);

  // usage summing (FAFF-604) — pure
  {
    const u = sumCodexUsage([
      { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 3 } },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } },
      { type: "item.completed", usage: { input_tokens: 999 } }, // not a turn event — never counted
    ]);
    // input_tokens 10+1 = 11, of which 3 are cached → 8 non-cached input + 3 cache_read.
    ok("usage: sums turn.completed, splitting cached input OUT of the input class (disjoint, never double-counted)",
      u.input === 8 && u.output === 7 && u.cache_read === 3 && u.cache_write_5m === 0 && u.cache_write_1h === 0);
    ok("usage: the two input classes partition input_tokens", u.input + u.cache_read === 11);
    ok("usage: a non-turn event's usage is not counted", u.input === 8);
    // FAFF-964: codex reports no TTL split, so its cache-write routes entirely to 1h.
    const uw = sumCodexUsage([{ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 0, cache_write_input_tokens: 60 } }]);
    ok("usage: codex cache_write routes to cache_write_1h (unknown-TTL → 1h), subtracted out of input",
      uw.cache_write_1h === 60 && uw.cache_write_5m === 0 && uw.input === 40);
    const empty = sumCodexUsage([{ type: "turn.completed" }, { type: "turn.completed", usage: { input_tokens: "x" } }]);
    ok("usage: missing/non-numeric fields contribute nothing (under-count, the safe direction)",
      empty.input === 0 && empty.output === 0 && empty.cache_read === 0);
    ok("usage: empty/absent stream -> zeros, never a throw", sumCodexUsage(null).input === 0 && sumCodexUsage([]).output === 0);
  }

  // spend sink (FAFF-604) — the call-boundary attribution, zero real I/O
  {
    const recorded = [];
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: `${TURN_LINE}\n${AGENT_LINE}\n` }),
      stdoutWrite: sink, stderrWrite: sink,
      spendSink: (r) => recorded.push(r), nowFn: () => "2026-07-25T00:00:00Z",
    });
    const r = recorded[0];
    ok("sink: a successful call records exactly one SpendRecord",
      code === ENGINE_EXIT.OK && recorded.length === 1);
    ok("sink: record carries engine/provider/model + the exec-json-events source label",
      r && r.engine === "seat" && r.provider === "codex" && r.model === "gpt-5-codex" && r.source === "exec-json-events");
    ok("sink: record carries the class-mapped usage sums",
      r && r.input === 10 && r.output === 5 && r.cache_read === 0 && r.cache_write_5m === 0 && r.cache_write_1h === 0);
    ok("sink: TURN_LINE carries no cached tokens, so input is unsplit here", r && r.input === 10);
    // FAFF-705: an inherit (no effort) call records NO effort key — byte-identity for pre-705 runs.
    ok("sink: inherit call omits the effort key (byte-identity)", r && !("effort" in r));
  }
  // FAFF-705: a graded-effort codex call carries -c model_reasoning_effort in argv AND the
  // resolved faff level on the SpendRecord (stored pre-map, for the economics effort axis).
  {
    const recorded = [];
    const calls = [];
    const effEngine = { ...engine, effort: "high" };
    const code = await runCodexCall({
      engine: effEngine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: `${TURN_LINE}\n${AGENT_LINE}\n` }, calls),
      stdoutWrite: sink, stderrWrite: sink,
      spendSink: (r) => recorded.push(r), nowFn: () => "2026-08-09T00:00:00Z",
    });
    const exec = calls[0];
    ok("sink: graded effort argv carries -c model_reasoning_effort=high",
      code === ENGINE_EXIT.OK && exec && exec.args.join(" ").includes("-c model_reasoning_effort=high"));
    ok("sink: graded effort record carries the faff level (pre-map)",
      recorded[0] && recorded[0].effort === "high");
  }
  {
    // A failed call records nothing — attributing partial usage from a failure is
    // an over-count risk; leaving it uncounted errs the way the transcript already does.
    const recorded = [];
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: "", stderr: "boom", exitCode: 1 }),
      stdoutWrite: sink, stderrWrite: sink, spendSink: (r) => recorded.push(r),
    });
    ok("sink: a FAILED call records no spend", code !== ENGINE_EXIT.OK && recorded.length === 0);
  }
  {
    // A sink fault must never change the dispatch's exit code — metering is
    // observability, not a precondition of the producer call succeeding.
    let stderr = "", stdout = "";
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: `${TURN_LINE}\n${AGENT_LINE}\n` }),
      stdoutWrite: (s) => (stdout += s), stderrWrite: (s) => (stderr += s),
      spendSink: () => { throw new Error("ENOSPC writing engine-spend.jsonl"); },
    });
    ok("sink: a write fault warns and leaves the exit code + producer output untouched",
      code === ENGINE_EXIT.OK && stdout.trim() === "the block"
      && /warning — could not record codex spend/.test(stderr) && /ENOSPC/.test(stderr));
  }
  {
    // No sink (an ad-hoc call outside a run) is a clean no-op, never a throw.
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: `${TURN_LINE}\n${AGENT_LINE}\n` }),
      stdoutWrite: sink, stderrWrite: sink, spendSink: null,
    });
    ok("sink: absent sink is a clean no-op", code === ENGINE_EXIT.OK);
  }

  // classifier
  ok("classify: 401 stderr -> auth", classifyCodexFailure("HTTP 401 from upstream", []) === "auth");
  ok("classify: auth-classed error event -> auth", classifyCodexFailure("", [{ type: "error", message: "please login again" }]) === "auth");
  ok("classify: model-not-found stderr -> unreachable", classifyCodexFailure("model not found", []) === "unreachable");

  // dispatch table
  {
    const calls = [];
    let stdout = "";
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: `${TURN_LINE}\n${AGENT_LINE}\n` }, calls),
      stdoutWrite: (s) => (stdout += s), stderrWrite: sink,
    });
    ok("happy path: exit 0, stdout is the message text", code === ENGINE_EXIT.OK && stdout === "the block\n");
    ok("happy path: exactly one exec spawn", calls.length === 1);
    // FAFF-877: the prompt now travels via the child's stdin STREAM, not a spawnSync
    // `input` option — the ONE exec spawn's args[0] is "exec" (buildCodexArgv's own
    // stable first token), and the child's captured stdin equals the same concatenation.
    ok("happy path: exactly one exec spawn is the codex exec command", calls[0].args[0] === "exec");
    ok("happy path: prompt is system + blank line + user, written to the child's stdin", calls[0].stdin() === "S\n\nU");
    ok("happy path: temp cwd created fresh and removed after", /faff-codex-/.test(calls[0].opts.cwd) && !fs.existsSync(calls[0].opts.cwd));
    ok("happy path: the exec child is spawned detached with piped stdio (FAFF-877 — never inherit, never a blocking sync spawn)",
      calls[0].opts.detached === true && Array.isArray(calls[0].opts.stdio) && calls[0].opts.stdio.every((s) => s === "pipe"));
  }
  {
    const probeCalls = [];
    const execCalls = [];
    let stderr = "";
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq({ status: 1, stdout: "", stderr: "Not logged in", error: null, signal: null }, probeCalls),
      spawnAsyncFn: seqAsync({}, execCalls),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("seat probe fail: exit 6 naming codex login, exec never spawned",
      code === ENGINE_EXIT.AUTH && /codex login/.test(stderr) && probeCalls.length === 1 && execCalls.length === 0);
  }
  {
    // The PROBE's own ENOENT branch (step 2) — the exec spawn is never reached.
    let stderr = "";
    const execCalls = [];
    const enoent = { status: null, stdout: null, stderr: null, error: Object.assign(new Error("spawnSync codex ENOENT"), { code: "ENOENT" }), signal: null };
    const code = await runCodexCall({ engine, system: "S", user: "U", spawnFn: () => enoent, spawnAsyncFn: seqAsync({}, execCalls), stdoutWrite: sink, stderrWrite: (s) => (stderr += s) });
    ok("binary missing (probe): exit 5 naming install/bin_path, exec never spawned",
      code === ENGINE_EXIT.UNREACHABLE && /install codex|bin_path/.test(stderr) && execCalls.length === 0);
  }
  {
    // FAFF-877: the EXEC's own ENOENT branch — a distinct code path from the probe's
    // (the FAILED outcome's spawnErr.code check), so it needs its own coverage.
    let stderr = "";
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ errorCode: "ENOENT" }),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("binary missing (exec): exit 5 naming install/bin_path", code === ENGINE_EXIT.UNREACHABLE && /install codex|bin_path/.test(stderr));
  }
  {
    const probeCalls = [];
    let stderr = "";
    const keyed = { ...engine, apiKeyEnv: "FAFF593_SELFTEST_UNSET" };
    const code = await runCodexCall({ engine: keyed, system: "S", user: "U", spawnFn: seq(probeOk, probeCalls), env: {}, stdoutWrite: sink, stderrWrite: (s) => (stderr += s) });
    ok("api_key_env unset: exit 6 before ANY spawn (probe included)",
      code === ENGINE_EXIT.AUTH && /FAFF593_SELFTEST_UNSET/.test(stderr) && probeCalls.length === 0);
  }
  {
    const calls = [];
    const keyed = { ...engine, apiKeyEnv: "FAFF593_SELFTEST_SET" };
    await runCodexCall({
      engine: keyed, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: `${AGENT_LINE}\n` }, calls),
      env: { FAFF593_SELFTEST_SET: "sk-test" }, stdoutWrite: sink, stderrWrite: sink,
    });
    ok("api-key mode: named env var's value injected as OPENAI_API_KEY", calls[0] && calls[0].opts.env.OPENAI_API_KEY === "sk-test");
  }
  {
    let stderr = "";
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: "chatter, not JSON\n" }),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("malformed JSONL: exit 7 with excerpt", code === ENGINE_EXIT.MALFORMED && /chatter, not JSON/.test(stderr));
  }
  {
    const probeCalls = [];
    const execCalls = [];
    let stderr = "";
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk, probeCalls),
      spawnAsyncFn: seqAsync({}, execCalls),
      mkdtempFn: () => { throw new Error("ENOSPC: no space left on device"); },
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("mkdtemp failure: named exit 5, no exec spawn, never an escaped throw",
      code === ENGINE_EXIT.UNREACHABLE && /temp working dir/.test(stderr) && /ENOSPC/.test(stderr) && probeCalls.length === 1 && execCalls.length === 0);
  }
  {
    let stderr = "";
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: "", stderr: "model not found: gpt-nope", exitCode: 1 }),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("non-auth child failure: exit 5 with stderr excerpt", code === ENGINE_EXIT.UNREACHABLE && /model not found/.test(stderr));
  }
  {
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: "", stderr: "HTTP 401 unauthorized", exitCode: 1 }),
      stdoutWrite: sink, stderrWrite: sink,
    });
    ok("auth-shaped child failure: exit 6", code === ENGINE_EXIT.AUTH);
  }
  {
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      spawnAsyncFn: seqAsync({ stdout: `${TURN_LINE}\n` }),
      stdoutWrite: sink, stderrWrite: sink,
    });
    ok("no agent message: exit 7", code === ENGINE_EXIT.MALFORMED);
  }
  {
    // FAFF-877: the old spawnSync-`timeout`/ETIMEDOUT path is retired for this spawn
    // family — a slow/hung exec is now bounded by the LEASE's operation deadline,
    // enforced by the relocated killable-spawn.mjs's own deadline+grace kill. Drive it
    // via an injected `importKillableSpawn` returning killed-deadline directly (no real
    // timers) and assert the resulting message names the operation deadline.
    let stderr = "";
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      importKillableSpawn: async () => ({ DEFAULT_GRACE_SECONDS: 30, runKillable: async () => ({ status: "killed-deadline", innerExit: null, signal: "SIGKILL" }) }),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("operation deadline exceeded: exit 5 naming the configured deadline (3600s)",
      code === ENGINE_EXIT.UNREACHABLE && /operation deadline of 3600s/.test(stderr));
  }
  {
    // The same deadline path, with a per-consumer override on the engine record —
    // confirms the message names the ACTUAL configured value, not a hardcoded one.
    let stderr = "";
    const shortDeadline = { ...engine, operationDeadlineSecs: 60 };
    const code = await runCodexCall({
      engine: shortDeadline, system: "S", user: "U",
      spawnFn: seq(probeOk),
      importKillableSpawn: async () => ({ DEFAULT_GRACE_SECONDS: 30, runKillable: async () => ({ status: "killed-deadline", innerExit: null, signal: "SIGKILL" }) }),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("operation deadline exceeded: names a per-consumer override, not the default", code === ENGINE_EXIT.UNREACHABLE && /operation deadline of 60s/.test(stderr));
  }
  {
    // CANCELLED (SIGINT/SIGTERM during the exec) -> engine-unreachable, signal named.
    let stderr = "";
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      importKillableSpawn: async () => ({ DEFAULT_GRACE_SECONDS: 30, runKillable: async () => ({ status: "killed-abort", innerExit: null, signal: "SIGTERM" }) }),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("exec aborted (SIGTERM): exit 5, signal named", code === ENGINE_EXIT.UNREACHABLE && /aborted \(SIGTERM\)/.test(stderr));
  }
  {
    // FAFF-877: runDir wiring — a real run_dir threads through to a LEASE the injected
    // superviseFn receives, carrying the exact run_dir and the resolved operation
    // deadline; a null run_dir (an ad-hoc call outside a run) never builds a lease at
    // all and takes the importKillableSpawn branch instead (already exercised above).
    // The stub superviseFn also invokes the passed-through spawnFn (mirroring
    // superviseSubprocess's own real contract of calling into killable-spawn's
    // runKillable, which calls spawnFn) so the exec's captured stdout still flows.
    let seenLease = null;
    let seenTarget = null;
    const code = await runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk),
      runDir: "/some/run/dir",
      superviseFn: async ({ lease, target, spawnFn: execSpawnFn }) => {
        seenLease = lease;
        seenTarget = target;
        const child = execSpawnFn(target[0], target.slice(1));
        const exitCode = await new Promise((resolve) => child.on("exit", (code_) => resolve(code_)));
        return { outcome: SUPERVISED_OUTCOME.COMPLETED, result: { status: "exited", innerExit: exitCode, signal: null } };
      },
      spawnAsyncFn: seqAsync({ stdout: `${TURN_LINE}\n${AGENT_LINE}\n` }),
      stdoutWrite: sink, stderrWrite: sink,
    });
    ok("runDir present: builds a lease with the EXACT run_dir and the resolved operation deadline",
      code === ENGINE_EXIT.OK && seenLease && seenLease.run_dir === "/some/run/dir" && seenLease.deadline_secs === 3600 && seenLease.name === "engine:codex");
    ok("runDir present: the target argv is [binPath, ...codex exec argv]", seenTarget && seenTarget[0] === "codex" && seenTarget[1] === "exec");
  }

  // config guards (fixture cfg objects — the read-time half)
  const codexCfg = () => ({ backends: { seat: { provider: "codex", model: "gpt-5-codex" } }, models: { methodology: "engine:seat" } });
  {
    const r = resolveEngineForLane(codexCfg(), "methodology");
    ok("resolve: codex-shaped record (family codex, bin_path default, no host)",
      !r.error && r.family === "codex" && r.binPath === "codex" && r.host === null);
    const r2 = resolveEngineForLane({ backends: { seat: { provider: "codex", model: "m", bin_path: "/opt/codex" } }, models: { intake: "engine:seat" } }, "intake");
    ok("resolve: explicit bin_path honored", !r2.error && r2.binPath === "/opt/codex");
  }
  ok("guard: host present on codex refused, named",
    /no host/.test(validateEngineRef({ backends: { seat: { provider: "codex", model: "m", host: "http://h:1" } } }, "engine:seat") || ""));
  ok("guard: reasoning_off on codex refused, named",
    /reasoning_off/.test(validateEngineRef({ backends: { seat: { provider: "codex", model: "m", reasoning_off: true } } }, "engine:seat") || ""));
  ok("guard: auth none on codex refused, named",
    /auth "none"/.test(validateEngineRef({ backends: { seat: { provider: "codex", model: "m", auth: "none" } } }, "engine:seat") || ""));
  ok("guard: deriveAuth keyless codex -> subscription-seat", deriveAuth({ provider: "codex" }) === "subscription-seat");
  ok("guard: codex seat admits on ANY harness (Anthropic binding untouched)",
    portableMatrixAdmits("some-other-harness", "codex", "subscription-seat") === true
    && portableMatrixAdmits("some-other-harness", "anthropic", "subscription-seat") === false
    && portableMatrixAdmits("claude-code", "anthropic", "subscription-seat") === true);
  {
    const cfg = { backends: { seat: { provider: "codex", model: "m" } } };
    ok("guard: hostless codex ref is realizable (matrix admission only)", checkRealizable(cfg, { refs: ["seat"] }).ok === true);
    const res = checkRealizable(cfg, { refs: ["seat"], requires: "local" });
    ok("guard: codex in a requires:local chain refuses (egress external)", res.refuse === true && /residency-violation/.test(res.reason));
    const merged = mergeBackendsNamespace(cfg);
    ok("guard: deriveEgress on hostless codex -> external (deliberate, not accidental)", deriveEgress(merged.backends.seat) === "external" && merged.backends.seat.egress === "external");
  }

  return fail;
}

module.exports = { buildCodexArgv, classifyCodexFailure, codexSelftest, parseCodexEvents, runCodexCall, sumCodexUsage };
