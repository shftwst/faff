// FAFF-577 — strict base .faffrc.yaml parsing: a malformed base fails LOUD at both
// config chokepoints (loadConfig factory / readGovernanceConfig governance), never
// silently resolving budget/sentry ceilings from defaults. Exercised through the
// REAL CLI on the filesystem (the same posture as config-two-file.test.mjs), plus
// in-process assertions on the shared chokepoint helper (warn-fires-before-throw)
// and the lights-out preflight refusal (pure core).
//
// Byte-for-byte back-compat is asserted for the still-valid states: absent, empty,
// and comment-only base files resolve {} silently (no warning, exit codes
// unchanged); the bare-scalar-line case is the DOCUMENTED detection limit (shared
// with the overlay's) covered as a deliberate negative test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin");
const CLI = join(BIN_DIR, "faff");
const require_ = createRequire(import.meta.url);

function run(cwd, args, env = {}) {
  // spawnSync (not execFileSync) so stderr is captured on SUCCESS too — the hatch
  // and sentry-degrade cases assert the warning fired on an exit-0 run.
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, FAFF_CONFIG_BASE_LENIENT: "", ...env } });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: r.stderr ?? "" };
}

function dirWithBase(base) {
  const dir = mkdtempSync(join(tmpdir(), "faff577-"));
  if (base != null) writeFileSync(join(dir, ".faffrc.yaml"), base);
  return dir;
}

const WARNING_RX = /is malformed .*budget\/sentry\s?ceilings.*FAFF_CONFIG_BASE_LENIENT=1/s;

// ---------------------------------------------------------------------------
// Factory chokepoint (loadConfig via `faff config get`)
// ---------------------------------------------------------------------------

test("strict: top-level-sequence base → config get exits 2, stderr warning, stdout empty", () => {
  const dir = dirWithBase("- just\n- a\n- list\n");
  const r = run(dir, ["config", "get", "appetite"]);
  assert.equal(r.code, 2);
  assert.match(r.err, WARNING_RX);
  assert.match(r.err, /base is never a silent default \(FAFF-577\)/);
  assert.equal(r.out, "");
  rmSync(dir, { recursive: true, force: true });
});

test("strict: wholly mis-indented base → config get exits 2 with the warning", () => {
  const dir = dirWithBase("  tracking:\n    repo: x\n");
  const r = run(dir, ["config", "get", "appetite"]);
  assert.equal(r.code, 2);
  assert.match(r.err, WARNING_RX);
  rmSync(dir, { recursive: true, force: true });
});

test("strict: unreadable base → exits 2 with detail 'unreadable'", { skip: process.getuid && process.getuid() === 0 ? "running as root — chmod 000 is still readable" : false }, () => {
  const dir = dirWithBase("tracking:\n  repo: x\n");
  chmodSync(join(dir, ".faffrc.yaml"), 0o000);
  const r = run(dir, ["config", "get", "appetite"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /unreadable/);
  chmodSync(join(dir, ".faffrc.yaml"), 0o644);
  rmSync(dir, { recursive: true, force: true });
});

test("back-compat: absent / empty / comment-only base all resolve defaults silently, exit 0", () => {
  for (const base of [null, "", "# comment only\n---\n"]) {
    const dir = dirWithBase(base);
    const r = run(dir, ["config", "get", "appetite"]);
    assert.equal(r.code, 0, `base=${JSON.stringify(base)}`);
    assert.equal(r.out, "high");
    assert.doesNotMatch(r.err, /malformed/);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("documented limit (negative): bare scalar line parses as a one-key map — NOT flagged", () => {
  // Shared with the overlay's tolerance by construction (one implementation).
  // Tightening this is per-key validation territory, out of scope (FAFF-577 §3).
  const dir = dirWithBase("just some text\n");
  const r = run(dir, ["config", "get", "appetite"]);
  assert.equal(r.code, 0);
  assert.equal(r.out, "high");
  assert.doesNotMatch(r.err, /malformed/);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Escape hatch
// ---------------------------------------------------------------------------

test("hatch: FAFF_CONFIG_BASE_LENIENT=1 → proceeds on defaults, exit 0, warning still fires, stdout clean", () => {
  const dir = dirWithBase("- a\n- list\n");
  const r = run(dir, ["config", "get", "appetite"], { FAFF_CONFIG_BASE_LENIENT: "1" });
  assert.equal(r.code, 0);
  assert.equal(r.out, "high");           // stdout stays pure — the default value only
  assert.match(r.err, WARNING_RX);       // the warning fires on EVERY read, hatch or no hatch
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Governance chokepoint (readGovernanceConfig via `faff budget check`)
// ---------------------------------------------------------------------------

test("governance: budget check on a malformed base exits 2 with the governance-flavoured message", () => {
  const dir = dirWithBase("- ceilings\n- gone\n");
  const r = run(dir, ["budget", "check"]);
  assert.equal(r.code, 2);
  assert.match(r.err, WARNING_RX);
  assert.match(r.err, /governance ceiling must not disappear on a malformed file/);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Diagnosis carve-out (`faff config check` describes the fault, never aborts on it)
// ---------------------------------------------------------------------------

test("config check: malformed base is an error finding (exit 1) naming file + detail — never an exit-2 abort", () => {
  const dir = dirWithBase("- just\n- a\n- list\n");
  const r = run(dir, ["config", "check"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR .faffrc\.yaml: malformed base config/);
  assert.match(r.out, /does not parse to a mapping/);
  const j = run(dir, ["config", "check", "--json"]);
  assert.equal(j.code, 1);
  const parsed = JSON.parse(j.out);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.findings.some((f) => f.severity === "error" && /malformed base config/.test(f.message)));
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Watchdog carve-out (`faff sentry check` degrades loud, poller stays alive)
// ---------------------------------------------------------------------------

test("sentry check: malformed base → exits as it otherwise would, default thresholds, config_malformed: true", () => {
  const dir = dirWithBase("- just\n- a\n- list\n");
  const r = run(dir, ["sentry", "check", "--json"]);
  assert.equal(r.code, 0);               // NEVER a strict exit — a non-zero would fault-cap the poller
  const payload = JSON.parse(r.out);
  assert.equal(payload.config_malformed, true);
  assert.ok(payload.thresholds && typeof payload.thresholds.stall_window_secs === "number"); // built-in defaults resolved
  assert.match(r.err, WARNING_RX);       // the degradation is loud on stderr too
  rmSync(dir, { recursive: true, force: true });
});

test("sentry check: healthy base → config_malformed: false rides the payload", () => {
  const dir = dirWithBase("appetite: high\n");
  const r = run(dir, ["sentry", "check", "--json"]);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).config_malformed, false);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Warn-before-throw (in-process — the throw is caught, the warning already fired)
// ---------------------------------------------------------------------------

test("chokepoint: the stderr warning is written BEFORE the throw (a catching caller cannot re-silence it)", () => {
  const { readBaseConfigStrict } = require_(join(BIN_DIR, "lib", "shared-infra.js"));
  const dir = dirWithBase("- a\n- sequence\n");
  const file = join(dir, ".faffrc.yaml");
  let captured = "";
  const origWrite = process.stderr.write;
  process.stderr.write = (chunk) => { captured += chunk; return true; };
  let threw = null;
  try { readBaseConfigStrict(file, {}); }
  catch (e) { threw = e; }
  finally { process.stderr.write = origWrite; }
  assert.ok(threw, "expected base-parse-error to be thrown");
  assert.equal(threw.message, "base-parse-error");
  assert.equal(threw.file, file);
  assert.match(captured, WARNING_RX);    // the warning fired even though the caller caught the throw
  rmSync(dir, { recursive: true, force: true });
});

test("chokepoint: hatch env (in-process) → warns and returns {} instead of throwing", () => {
  const { readBaseConfigStrict } = require_(join(BIN_DIR, "lib", "shared-infra.js"));
  const dir = dirWithBase("- a\n- sequence\n");
  let captured = "";
  const origWrite = process.stderr.write;
  process.stderr.write = (chunk) => { captured += chunk; return true; };
  let result;
  try { result = readBaseConfigStrict(join(dir, ".faffrc.yaml"), { FAFF_CONFIG_BASE_LENIENT: "1" }); }
  finally { process.stderr.write = origWrite; }
  assert.deepEqual(result, {});
  assert.match(captured, WARNING_RX);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Overlay byte-identity (parseOverlayStrict delegates to the shared helper)
// ---------------------------------------------------------------------------

test("overlay: parseOverlayStrict keeps its exact error name + detail wording (byte-identical behaviour)", () => {
  const { parseOverlayStrict } = require_(join(BIN_DIR, "lib", "shared-infra.js"));
  const dir = mkdtempSync(join(tmpdir(), "faff577o-"));
  const file = join(dir, ".faffrc.local.yaml");
  writeFileSync(file, "- not\n- a\n- map\n");
  let threw = null;
  try { parseOverlayStrict(file); } catch (e) { threw = e; }
  assert.ok(threw);
  assert.equal(threw.message, "overlay-parse-error");
  assert.equal(threw.detail, "does not parse to a mapping (malformed YAML — an overlay must be a key:value mapping)");
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// L4 preflight refusal (pure core — the hatch armed must never mint)
// ---------------------------------------------------------------------------

test("lights-out preflight: FAFF_CONFIG_BASE_LENIENT armed → config-base-lenient refusal", () => {
  const { lightsOutPreflight, LIGHTS_OUT_GUARDRAIL_IDS } = require_(join(BIN_DIR, "lib", "lights-out.js"));
  const reachable = Object.fromEntries(LIGHTS_OUT_GUARDRAIL_IDS.map((id) => [id, true]));
  const okFloor = { no_execute: true, worktree_isolation: true, autonomous_contract: true };
  const base = { container: "contained", reachable, reviewReachable: true, specReviewSlot: true, budgetCeilingSet: true, floor: okFloor };
  const armed = lightsOutPreflight({ ...base, configBaseLenientSet: true });
  assert.equal(armed.proceed, false);
  const refusal = armed.refusals.find((r) => r.gate === "config-base-lenient");
  assert.ok(refusal, "expected a config-base-lenient refusal entry");
  assert.match(refusal.detail, /FAFF_CONFIG_BASE_LENIENT/);
  const unarmed = lightsOutPreflight(base);
  assert.ok(!unarmed.refusals.some((r) => r.gate === "config-base-lenient"), "hatch unset must not fire the gate");
});
