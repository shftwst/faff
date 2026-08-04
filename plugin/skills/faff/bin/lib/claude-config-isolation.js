// ===========================================================================
// === region:factory — claude-config-isolation (FAFF-647) ===
// ===========================================================================
// Carries ADR-0003's config-isolation lesson into the `faff engine call` seam,
// ahead of ADR-0054's reserved third transport branch (a tool-needing `claude -p`
// spawn). A nested `claude -p` and the session that spawned it both reach for the
// same global config (`~/.claude.json`, the wider `~/.claude` dir) unless the
// child is pointed elsewhere via CLAUDE_CONFIG_DIR — ADR-0003 recorded the crash
// that happens when they race over it. The eval driver (`eval/cli-driver.mjs`)
// already solved this for its own reps (FAFF-138/139); this module adopts that
// proven shape — full ambient env, one surgical CLAUDE_CONFIG_DIR override, only
// the credential file forwarded, per-spawn `finally` cleanup — as a reusable
// helper in the plugin's (CommonJS) engine-call library, so a future `claude -p`
// branch adopts isolation by construction instead of re-assembling it under
// deadline.
//
// The primary API is withIsolatedClaudeConfig: ONE orchestration function that
// owns mint -> try{build-env -> late-credential-forward -> spawn -> capture} ->
// finally{cleanup}. The three sub-steps (mint / forward / build-env) stay
// exported as injectable seams for the selftest below and the conformance
// selftest in engine.js — they are testing seams, not a caller-facing kit; a
// future `claude` runner calls ONLY the orchestrator and cannot sequence the
// isolation wrong because it never assembles the sequence itself.
//
// No live consumer ships in this ticket (ADR-0054's `claude -p` transport is
// explicitly out of scope — see FAFF-647 §2); this is precursor hardening. The
// registry that makes the guarantee enforceable against a future runner lives in
// engine.js (SPAWN_FAMILY_RUNNERS).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CREDENTIAL_FILENAME = ".credentials.json";
// The env var name a `claude -p` child reads its Anthropic auth token from —
// mirrors codex's OPENAI_API_KEY injection (engine-codex.js) for api-key mode.
const CLAUDE_AUTH_TOKEN_ENV = "ANTHROPIC_API_KEY";
const REDACTED_MASK = "***REDACTED***";

function excerpt(s, n = 200) { return String(s || "").trim().slice(0, n); }

// mintIsolatedConfigDir({ mkdtempFn, baseDir, chmodFn }) -> path
// A fresh, empty dir under baseDir (default os.tmpdir()), forced to mode 0700 —
// never relying on the platform mkdtemp default for the dir's mode. baseDir is a
// SEAM: if os.tmpdir() ever shares claude-box's host bind mount, the fix is
// passing a container-local baseDir here, a parameter, not a redesign. Errors
// (tmpdir full/unwritable) are NOT caught here — they must surface so the caller
// can name a non-zero engine exit rather than silently proceeding unisolated.
function mintIsolatedConfigDir({ mkdtempFn = fs.mkdtempSync, baseDir = os.tmpdir(), chmodFn = fs.chmodSync } = {}) {
  const dir = mkdtempFn(path.join(baseDir, "faff-claude-cfg-"));
  chmodFn(dir, 0o700);
  return dir;
}

// forwardClaudeCredential(isolatedDir, { ambientDir, copyFn, chmodFn }) -> path | null
// Copies ONLY .credentials.json from ambientDir into isolatedDir, chmod 0600 on
// the copy (a copy does not preserve mode). Best-effort: a missing credential
// file (or any copy/chmod fault) returns null, never throws — api-key auth needs
// no credential file, and a genuinely mis-configured seat surfaces downstream as
// the child's own "Not logged in". Reads from ambientDir; writes NOTHING into it.
function forwardClaudeCredential(isolatedDir, { ambientDir, copyFn = fs.copyFileSync, chmodFn = fs.chmodSync } = {}) {
  if (!ambientDir) return null;
  const src = path.join(ambientDir, CREDENTIAL_FILENAME);
  const dst = path.join(isolatedDir, CREDENTIAL_FILENAME);
  try {
    copyFn(src, dst);
    chmodFn(dst, 0o600);
    return dst;
  } catch {
    return null;
  }
}

// buildIsolatedChildEnv(ambientEnv, isolatedDir, injectedApiKeyEnv?) -> { env, redactedEnv }
// env: the full ambient env (HOME/PATH/etc — the child needs it to function)
// with CLAUDE_CONFIG_DIR overridden, plus (api-key mode) the named auth token
// value injected. redactedEnv: the SAME map with that auth-token value masked.
// Exactly one isolation override; full ambient inheritance otherwise. `env` is
// NEVER logged verbatim by any caller — see the conformance selftest in
// engine.js, which test-enforces this rather than leaving it as caller discipline.
function buildIsolatedChildEnv(ambientEnv, isolatedDir, injectedApiKeyEnv = null) {
  const env = { ...ambientEnv, CLAUDE_CONFIG_DIR: isolatedDir };
  const redactedEnv = { ...env };
  if (injectedApiKeyEnv && injectedApiKeyEnv.name) {
    env[injectedApiKeyEnv.name] = injectedApiKeyEnv.value;
    redactedEnv[injectedApiKeyEnv.name] = REDACTED_MASK;
  }
  return { env, redactedEnv };
}

// withIsolatedClaudeConfig(spawnFn, opts) -> Promise<result>
// opts: { authMode: "api-key"|"subscription-seat", ambientDir, ambientEnv,
//         apiKeyEnv?, baseDir?, seams? }
// Owns the WHOLE lifecycle (spec §3/§4 PROCEDURE): mint -> TRY { build-env ->
// forward credential (LATE, immediately before spawn, subscription-seat only) ->
// spawnFn({env, cwd}) -> capture } -> FINALLY { best-effort rmSync; on fault,
// log loud + best-effort overwrite the forwarded credential; never rethrow over
// the dispatch result }. Returns whatever spawnFn returns, AFTER cleanup has run.
// spawnFn may be sync or return a Promise — always awaited.
//
// mkdtemp failure happens OUTSIDE the try (step 2 of the procedure) and is left
// to propagate uncaught: the caller (a future runner) turns that into a named,
// non-zero engine exit, exactly as runCodexCall already does for its own
// temp-cwd mkdtemp failure — never an escaped throw swallowed silently here.
async function withIsolatedClaudeConfig(spawnFn, opts = {}) {
  const { authMode, ambientDir = null, ambientEnv = process.env, apiKeyEnv = null, baseDir = os.tmpdir(), seams = {} } = opts;
  const {
    mkdtempFn = fs.mkdtempSync,
    chmodFn = fs.chmodSync,
    copyFn = fs.copyFileSync,
    rmFn = fs.rmSync,
    writeFileFn = fs.writeFileSync,
    warnFn = (msg) => process.stderr.write(msg),
  } = seams;

  const isolatedDir = mintIsolatedConfigDir({ mkdtempFn, baseDir, chmodFn });
  let credentialPath = null;
  try {
    let injectedApiKeyEnv = null;
    if (authMode === "api-key" && apiKeyEnv) {
      injectedApiKeyEnv = { name: CLAUDE_AUTH_TOKEN_ENV, value: ambientEnv[apiKeyEnv] };
    }
    const { env } = buildIsolatedChildEnv(ambientEnv, isolatedDir, injectedApiKeyEnv);
    if (authMode === "subscription-seat") {
      credentialPath = forwardClaudeCredential(isolatedDir, { ambientDir, copyFn, chmodFn });
    }
    const result = await spawnFn({ env, cwd: isolatedDir });
    return result; // captured into the caller's own return value BEFORE cleanup runs (finally, below)
  } finally {
    try {
      rmFn(isolatedDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      // Best-effort scrub before abandoning a dir we could not remove — a
      // swallowed rmSync fault would otherwise leave a live credential copy in
      // tmp indefinitely with no signal. Truncation is itself best-effort; the
      // loud log below is the backstop if it also faults.
      if (credentialPath) {
        try { writeFileFn(credentialPath, ""); } catch { /* best-effort only — the warn below is the backstop */ }
      }
      warnFn(`faff engine call: warning — could not remove isolated CLAUDE_CONFIG_DIR ${isolatedDir}: ${excerpt(cleanupErr && cleanupErr.message)}\n`);
      // never rethrow — a cleanup fault must not mask the dispatch's real result
    }
  }
}

// Selftest — exercises withIsolatedClaudeConfig end-to-end against a REAL
// mkdtemp'd "ambient" dir (so it proves the real fs.mkdtemp/copyFile/chmod
// seams, not just injected mocks) plus injected spy seams that record every
// path touched. Zero real filesystem writes outside a temp tree. Folded into
// `faff engine --selftest` by engine.js (async — engineSelftest already is).
async function claudeConfigIsolationSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL claude-config-isolation: ${name}`); fail++; } else console.log(`ok   claude-config-isolation: ${name}`); };

  // buildIsolatedChildEnv — pure
  {
    const { env, redactedEnv } = buildIsolatedChildEnv({ HOME: "/home/u", PATH: "/bin" }, "/tmp/iso1");
    ok("buildIsolatedChildEnv: full ambient inheritance + one override", env.HOME === "/home/u" && env.PATH === "/bin" && env.CLAUDE_CONFIG_DIR === "/tmp/iso1");
    ok("buildIsolatedChildEnv: no api-key override -> redactedEnv identical to env", redactedEnv.HOME === "/home/u" && !("ANTHROPIC_API_KEY" in redactedEnv));
  }
  {
    const { env, redactedEnv } = buildIsolatedChildEnv({ HOME: "/home/u" }, "/tmp/iso2", { name: "ANTHROPIC_API_KEY", value: "sk-real-secret" });
    ok("buildIsolatedChildEnv: api-key mode injects the real value into env", env.ANTHROPIC_API_KEY === "sk-real-secret");
    ok("buildIsolatedChildEnv: redactedEnv masks the same key, never the raw value", redactedEnv.ANTHROPIC_API_KEY === REDACTED_MASK && redactedEnv.ANTHROPIC_API_KEY !== "sk-real-secret");
  }

  // Real fs — an ambient dir with a dummy credential + dummy mutable config.
  const ambientDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-claude-cfg-selftest-ambient-"));
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-claude-cfg-selftest-base-"));
  try {
    fs.writeFileSync(path.join(ambientDir, CREDENTIAL_FILENAME), JSON.stringify({ token: "seat-oauth-token" }));
    const mutableConfigPath = path.join(ambientDir, ".claude.json");
    fs.writeFileSync(mutableConfigPath, JSON.stringify({ mutable: true }));
    const mutableBefore = fs.readFileSync(mutableConfigPath);

    // mintIsolatedConfigDir — a fresh dir under baseDir, distinct from ambient, 0700.
    {
      const dir = mintIsolatedConfigDir({ baseDir });
      try {
        ok("mintIsolatedConfigDir: fresh dir created under baseDir", dir.startsWith(baseDir));
        ok("mintIsolatedConfigDir: distinct from the ambient dir", dir !== ambientDir);
        ok("mintIsolatedConfigDir: mode 0700, not the platform default", (fs.statSync(dir).mode & 0o777) === 0o700);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }

    // forwardClaudeCredential — only the credential file, chmod 0600, nothing else, writes nothing into ambient.
    {
      const dir = mintIsolatedConfigDir({ baseDir });
      try {
        const dst = forwardClaudeCredential(dir, { ambientDir });
        ok("forwardClaudeCredential: returns the copied path", dst === path.join(dir, CREDENTIAL_FILENAME));
        ok("forwardClaudeCredential: credential copy exists, mode 0600", fs.existsSync(dst) && (fs.statSync(dst).mode & 0o777) === 0o600);
        ok("forwardClaudeCredential: mutable .claude.json is NOT copied", !fs.existsSync(path.join(dir, ".claude.json")));
        ok("forwardClaudeCredential: ambient dir untouched (byte-identical mutable config)", fs.readFileSync(mutableConfigPath).equals(mutableBefore));
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
    ok("forwardClaudeCredential: absent credential file -> null, never throws", forwardClaudeCredential(fs.mkdtempSync(path.join(os.tmpdir(), "faff-claude-cfg-nofile-")), { ambientDir: fs.mkdtempSync(path.join(os.tmpdir(), "faff-claude-cfg-empty-ambient-")) }) === null);
  } finally {
    fs.rmSync(ambientDir, { recursive: true, force: true });
    fs.rmSync(baseDir, { recursive: true, force: true });
  }

  // withIsolatedClaudeConfig — end-to-end, injected spy seams recording every touched path.
  {
    const ambient2 = fs.mkdtempSync(path.join(os.tmpdir(), "faff-claude-cfg-selftest-ambient2-"));
    const base2 = fs.mkdtempSync(path.join(os.tmpdir(), "faff-claude-cfg-selftest-base2-"));
    fs.writeFileSync(path.join(ambient2, CREDENTIAL_FILENAME), "cred");
    fs.writeFileSync(path.join(ambient2, ".claude.json"), "mutable");
    try {
      const touched = [];
      const spySeams = {
        mkdtempFn: (p) => { const d = fs.mkdtempSync(p); touched.push({ op: "mkdtemp", path: d }); return d; },
        chmodFn: (p, mode) => { touched.push({ op: "chmod", path: p }); fs.chmodSync(p, mode); },
        copyFn: (src, dst) => { touched.push({ op: "copy-src", path: src }); touched.push({ op: "copy-dst", path: dst }); fs.copyFileSync(src, dst); },
        rmFn: (...a) => fs.rmSync(...a),
        writeFileFn: (...a) => fs.writeFileSync(...a),
      };
      let capturedCwd = null;
      let capturedEnv = null;
      const spawnFn = async ({ env, cwd }) => { capturedEnv = env; capturedCwd = cwd; return { stdout: "ok" }; };
      const result = await withIsolatedClaudeConfig(spawnFn, { authMode: "subscription-seat", ambientDir: ambient2, ambientEnv: { HOME: "/h" }, baseDir: base2, seams: spySeams });
      ok("withIsolatedClaudeConfig: returns spawnFn's result", result && result.stdout === "ok");
      ok("withIsolatedClaudeConfig: child CLAUDE_CONFIG_DIR is fresh, under baseDir, distinct from ambient", capturedEnv.CLAUDE_CONFIG_DIR && capturedEnv.CLAUDE_CONFIG_DIR.startsWith(base2) && capturedEnv.CLAUDE_CONFIG_DIR !== ambient2);
      ok("withIsolatedClaudeConfig: cwd handed to spawnFn is the isolated dir", capturedCwd === capturedEnv.CLAUDE_CONFIG_DIR);
      ok("withIsolatedClaudeConfig: full ambient env inherited (HOME preserved)", capturedEnv.HOME === "/h");
      ok("withIsolatedClaudeConfig: isolated dir removed after (the finally ran)", !fs.existsSync(capturedCwd));
      // copy-src is a READ from the ambient dir (fetching the credential) — legitimate per spec
      // ("reads from ambientDir but writes NOTHING into ambientDir"); only write-shaped ops
      // (mkdtemp/chmod/copy-dst) must never target a path inside the ambient dir.
      ok("withIsolatedClaudeConfig: no WRITE seam call ever targeted a path inside the ambient dir", !touched.some((t) => t.op !== "copy-src" && t.path.startsWith(ambient2)));
      const scrubbed = touched.filter((t) => t.op === "copy-dst")[0];
      ok("withIsolatedClaudeConfig: the credential WAS forwarded (copy-dst recorded, late, before spawn)", !!scrubbed);
    } finally {
      fs.rmSync(ambient2, { recursive: true, force: true });
      fs.rmSync(base2, { recursive: true, force: true });
    }
  }

  // Cleanup-fault path: forced rmFn throw -> logged loud + best-effort credential overwrite, dispatch result preserved.
  {
    const ambient3 = fs.mkdtempSync(path.join(os.tmpdir(), "faff-claude-cfg-selftest-ambient3-"));
    fs.writeFileSync(path.join(ambient3, CREDENTIAL_FILENAME), "the-real-secret-token");
    let warned = "";
    let overwritten = null;
    const spawnFn = async ({ cwd }) => ({ stdout: "done", cwd });
    const result = await withIsolatedClaudeConfig(spawnFn, {
      authMode: "subscription-seat",
      ambientDir: ambient3,
      ambientEnv: {},
      seams: {
        rmFn: () => { throw new Error("EACCES: permission denied"); },
        writeFileFn: (p_, content) => { overwritten = { path: p_, content }; },
        warnFn: (msg) => { warned += msg; },
      },
    });
    ok("cleanup fault: dispatch result is preserved (not masked)", result && result.stdout === "done");
    ok("cleanup fault: logged loud with the isolated dir path", /warning — could not remove isolated CLAUDE_CONFIG_DIR/.test(warned) && warned.includes(result.cwd));
    ok("cleanup fault: EACCES cause named in the warning", /EACCES/.test(warned));
    ok("cleanup fault: forwarded credential best-effort overwritten before abandoning the dir", overwritten && overwritten.content === "" && overwritten.path.endsWith(CREDENTIAL_FILENAME));
    fs.rmSync(ambient3, { recursive: true, force: true });
  }

  return fail;
}

module.exports = {
  buildIsolatedChildEnv,
  claudeConfigIsolationSelftest,
  CLAUDE_AUTH_TOKEN_ENV,
  CREDENTIAL_FILENAME,
  forwardClaudeCredential,
  mintIsolatedConfigDir,
  withIsolatedClaudeConfig,
};
