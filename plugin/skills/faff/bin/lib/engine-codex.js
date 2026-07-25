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
// `cli/src/login.rs`) as pinned in the spec. No codex binary was installed on the
// build machine, so the spec's codex-rs-sourced assumptions stand verbatim —
// re-pin parseCodexEvents/buildCodexArgv against a live binary if a healthy run
// exits 7 "no agent message" (the spec's named drift observable).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ENGINE_EXIT } = require("./engine");

const SEAT_PROBE_TIMEOUT_MS = 5000;
const DEFAULT_CODEX_TIMEOUT_MS = 120000;

function excerpt(s, n = 200) { return String(s || "").trim().slice(0, n); }

// PURE: the exec argv AFTER bin_path — stable order, exactly the spawn posture
// (spec §4): --json is the transport; --ephemeral — a producer dispatch must not
// accrete session files; --skip-git-repo-check + temp cwd — a pure-data-in
// producer gets no repo; --sandbox read-only — the child gets no hands; the
// trailing "-" requests the prompt from stdin.
function buildCodexArgv(model) {
  if (!model) throw new Error("buildCodexArgv requires a model");
  return ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-m", String(model), "-"];
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
// guard → seat probe → ONE exec spawn → fail-loud parse → classify. Returns an
// ENGINE_EXIT int synchronously (bin/faff's dispatcher accepts int-or-Promise).
// spawnFn/env/writers injectable — the selftest and CI make zero real spawns.
function runCodexCall({ engine, system, user, spawnFn = spawnSync, env = process.env, stdoutWrite, stderrWrite } = {}) {
  const out = stdoutWrite || ((s) => process.stdout.write(s));
  const err = stderrWrite || ((s) => process.stderr.write(s));
  const binPath = engine.binPath || "codex";
  const timeoutMs = engine.timeoutMs || DEFAULT_CODEX_TIMEOUT_MS;

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
  // control flow (version-brittle).
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

  // 3. The ONE exec spawn: prompt (system + blank line + user — codex exec has
  // no system/user channel split, concatenation order is the contract) on stdin,
  // cwd a fresh temp dir (removed after — a producer dispatch leaves nothing
  // behind). Full env inheritance is DELIBERATE, not a leak: codex needs HOME
  // (auth store discovery), CODEX_HOME (auth store override), and PATH; api-key
  // mode additionally injects the named env var's VALUE as OPENAI_API_KEY.
  const childEnv = apiKey ? { ...env, OPENAI_API_KEY: apiKey } : env;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-codex-"));
  let r;
  try {
    r = spawnFn(binPath, buildCodexArgv(engine.model), {
      encoding: "utf8",
      input: `${String(system ?? "")}\n\n${String(user ?? "")}`,
      cwd: tmp,
      timeout: timeoutMs,
      env: childEnv,
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (r.error && r.error.code === "ENOENT") {
    err(`faff engine call: engine-unreachable — codex binary not found at ${binPath}; install codex or set backends.${engine.name}.bin_path\n`);
    return ENGINE_EXIT.UNREACHABLE;
  }
  if ((r.error && r.error.code === "ETIMEDOUT") || r.signal === "SIGTERM") {
    err(`faff engine call: engine-unreachable — codex exec timed out after ${timeoutMs}ms\n`);
    return ENGINE_EXIT.UNREACHABLE;
  }
  if (r.error) {
    err(`faff engine call: engine-unreachable — codex exec failed to spawn: ${excerpt(r.error.message)}\n`);
    return ENGINE_EXIT.UNREACHABLE;
  }

  // 4. Fail-loud parse of the complete stream (parse BEFORE the exit-code check —
  // a failed run's error events feed classification).
  let parsed;
  try { parsed = parseCodexEvents(r.stdout); }
  catch (e) {
    err(`faff engine call: malformed-response — ${e.message}\n`);
    return ENGINE_EXIT.MALFORMED;
  }

  // 5. Non-zero child exit → auth-failed or engine-unreachable, never a retry.
  if (r.status !== 0) {
    if (classifyCodexFailure(r.stderr, parsed.events) === "auth") {
      err(`faff engine call: auth-failed — ${excerpt(r.stderr) || "codex exec auth failure"}; remedy: codex login\n`);
      return ENGINE_EXIT.AUTH;
    }
    err(`faff engine call: engine-unreachable — codex exec exited ${r.status}: ${excerpt(r.stderr)}\n`);
    return ENGINE_EXIT.UNREACHABLE;
  }

  // 6. A clean exit with no agent message is malformed, not empty-pass.
  if (parsed.finalMessage === null) {
    err("faff engine call: malformed-response — codex stream completed with no agent message\n");
    return ENGINE_EXIT.MALFORMED;
  }

  // 7. stdout is the producer block, handed verbatim to the caller (trim only).
  out(parsed.finalMessage.trim() + "\n");
  return ENGINE_EXIT.OK;
}

// Selftest — the spec's dispatch table via injected spawnFn (zero real spawns)
// plus the config-guard rows. Returns the failure COUNT; engineSelftest folds it
// so `faff engine --selftest` stays the single entry point.
function codexSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL codex: ${name}`); fail++; } else console.log(`ok   codex: ${name}`); };
  const { resolveEngineForLane, validateEngineRef } = require("./config");
  const { checkRealizable, deriveAuth, deriveEgress, mergeBackendsNamespace, portableMatrixAdmits } = require("./backends");

  const sink = () => {};
  const engine = { name: "seat", provider: "codex", family: "codex", model: "gpt-5-codex", binPath: "codex", apiKeyEnv: null, timeoutMs: 1000 };
  const AGENT_LINE = JSON.stringify({ type: "item.completed", item: { id: "item_0", item_type: "agent_message", text: "the block" } });
  const TURN_LINE = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } });
  const probeOk = { status: 0, stdout: "Logged in using ChatGPT", stderr: "", error: null, signal: null };
  // Injected spawn: first call is the probe, rest are exec — mirror getFn/postFn.
  const seq = (probeRes, execRes, calls) => (cmd, args, opts) => {
    if (calls) calls.push({ cmd, args, opts });
    return args[0] === "login" ? probeRes : execRes;
  };

  // argv shape — pure, stable order
  ok("argv is exactly the posture flags in stable order",
    buildCodexArgv("m").join(" ") === "exec --json --ephemeral --skip-git-repo-check --sandbox read-only -m m -");

  // parser — fail-loud, events kept (FAFF-604 seam)
  {
    const p = parseCodexEvents(`${TURN_LINE}\n${AGENT_LINE}\n`);
    ok("parse: final agent message extracted", p.finalMessage === "the block");
    ok("parse: all events kept incl. usage fields (FAFF-604 seam)", p.events.length === 2 && p.events[0].usage.input_tokens === 10);
  }
  { let threw = false; try { parseCodexEvents(`${AGENT_LINE}\nnot json\n`); } catch (e) { threw = /non-JSON line/.test(e.message); }
    ok("parse: stray non-JSON line fails loud even with a message present", threw); }
  ok("parse: only turn events -> no final message (null, not empty pass)", parseCodexEvents(`${TURN_LINE}\n`).finalMessage === null);

  // classifier
  ok("classify: 401 stderr -> auth", classifyCodexFailure("HTTP 401 from upstream", []) === "auth");
  ok("classify: auth-classed error event -> auth", classifyCodexFailure("", [{ type: "error", message: "please login again" }]) === "auth");
  ok("classify: model-not-found stderr -> unreachable", classifyCodexFailure("model not found", []) === "unreachable");

  // dispatch table
  {
    const calls = [];
    let stdout = "";
    const code = runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk, { status: 0, stdout: `${TURN_LINE}\n${AGENT_LINE}\n`, stderr: "", error: null, signal: null }, calls),
      stdoutWrite: (s) => (stdout += s), stderrWrite: sink,
    });
    const exec = calls.filter((c) => c.args[0] === "exec");
    ok("happy path: exit 0, stdout is the message text", code === ENGINE_EXIT.OK && stdout === "the block\n");
    ok("happy path: exactly one exec spawn", exec.length === 1);
    ok("happy path: prompt is system + blank line + user on stdin", exec[0].opts.input === "S\n\nU");
    ok("happy path: temp cwd created fresh and removed after", /faff-codex-/.test(exec[0].opts.cwd) && !fs.existsSync(exec[0].opts.cwd));
  }
  {
    const calls = [];
    let stderr = "";
    const code = runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq({ status: 1, stdout: "", stderr: "Not logged in", error: null, signal: null }, null, calls),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("seat probe fail: exit 6 naming codex login, exec never spawned",
      code === ENGINE_EXIT.AUTH && /codex login/.test(stderr) && calls.every((c) => c.args[0] === "login"));
  }
  {
    let stderr = "";
    const enoent = { status: null, stdout: null, stderr: null, error: Object.assign(new Error("spawnSync codex ENOENT"), { code: "ENOENT" }), signal: null };
    const code = runCodexCall({ engine, system: "S", user: "U", spawnFn: () => enoent, stdoutWrite: sink, stderrWrite: (s) => (stderr += s) });
    ok("binary missing: exit 5 naming install/bin_path", code === ENGINE_EXIT.UNREACHABLE && /install codex|bin_path/.test(stderr));
  }
  {
    const calls = [];
    let stderr = "";
    const keyed = { ...engine, apiKeyEnv: "FAFF593_SELFTEST_UNSET" };
    const code = runCodexCall({ engine: keyed, system: "S", user: "U", spawnFn: seq(probeOk, null, calls), env: {}, stdoutWrite: sink, stderrWrite: (s) => (stderr += s) });
    ok("api_key_env unset: exit 6 before ANY spawn (probe included)",
      code === ENGINE_EXIT.AUTH && /FAFF593_SELFTEST_UNSET/.test(stderr) && calls.length === 0);
  }
  {
    const calls = [];
    const keyed = { ...engine, apiKeyEnv: "FAFF593_SELFTEST_SET" };
    runCodexCall({
      engine: keyed, system: "S", user: "U",
      spawnFn: seq(probeOk, { status: 0, stdout: `${AGENT_LINE}\n`, stderr: "", error: null, signal: null }, calls),
      env: { FAFF593_SELFTEST_SET: "sk-test" }, stdoutWrite: sink, stderrWrite: sink,
    });
    const exec = calls.find((c) => c.args[0] === "exec");
    ok("api-key mode: named env var's value injected as OPENAI_API_KEY", exec && exec.opts.env.OPENAI_API_KEY === "sk-test");
  }
  {
    let stderr = "";
    const code = runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk, { status: 0, stdout: "chatter, not JSON\n", stderr: "", error: null, signal: null }),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("malformed JSONL: exit 7 with excerpt", code === ENGINE_EXIT.MALFORMED && /chatter, not JSON/.test(stderr));
  }
  {
    let stderr = "";
    const code = runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk, { status: 1, stdout: "", stderr: "model not found: gpt-nope", error: null, signal: null }),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("non-auth child failure: exit 5 with stderr excerpt", code === ENGINE_EXIT.UNREACHABLE && /model not found/.test(stderr));
  }
  {
    const code = runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk, { status: 1, stdout: "", stderr: "HTTP 401 unauthorized", error: null, signal: null }),
      stdoutWrite: sink, stderrWrite: sink,
    });
    ok("auth-shaped child failure: exit 6", code === ENGINE_EXIT.AUTH);
  }
  {
    const code = runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk, { status: 0, stdout: `${TURN_LINE}\n`, stderr: "", error: null, signal: null }),
      stdoutWrite: sink, stderrWrite: sink,
    });
    ok("no agent message: exit 7", code === ENGINE_EXIT.MALFORMED);
  }
  {
    let stderr = "";
    const code = runCodexCall({
      engine, system: "S", user: "U",
      spawnFn: seq(probeOk, { status: null, stdout: "", stderr: "", error: Object.assign(new Error("spawnSync codex ETIMEDOUT"), { code: "ETIMEDOUT" }), signal: "SIGTERM" }),
      stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
    });
    ok("timeout: exit 5 naming the timeout", code === ENGINE_EXIT.UNREACHABLE && /timed out after 1000ms/.test(stderr));
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

module.exports = { buildCodexArgv, classifyCodexFailure, codexSelftest, parseCodexEvents, runCodexCall };
