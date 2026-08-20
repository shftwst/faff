// FAFF-886 — spec-review-pin: pin the spec-review reviewer across the rounds of one spec's
// loop, so a flapping backend can't silently swap the serving reviewer mid-loop and make a
// converging spec read as churn. Covers the pure resolve/capture/dir functions, the prefer-
// with-fallback pin-first chain + de-dup, the fail-loud/fail-safe directions, the CLI seam
// (bare-array default == adversarial-backends, --json wrap, exit codes, flag-wins-over-env),
// and the SKILL wiring (block-scoped occupant lint + prep's scratch-dir / swap-reset prose).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  backendIdentity,
  resolvePinChain,
  capturePin,
  specReviewDir,
  specReviewPinSelftest,
  specReviewDirSelftest,
} from "../plugin/skills/faff/bin/lib/spec-review-pin.js";
import { detectSpecReviewConvergence } from "../plugin/skills/faff/bin/lib/spec-review-convergence.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const OCCUPANT_SKILL = join(REPO, "plugin", "skills", "faffter-dark-spec-review", "SKILL.md");
const PREP_SKILL = join(REPO, "plugin", "skills", "faff-prep", "SKILL.md");

const CFG = {
  adversarial: { backends: [
    { provider: "openai", model: "mA", host: "https://a/v1", api_key_env: "KA" },
    { provider: "nvidia", model: "mB", host: "https://b/v1", api_key_env: "KB" },
    { provider: "openai", model: "mC", host: "https://c/v1", api_key_env: "KC" },
  ] },
};

function fixtureRepo(faffrc) {
  const d = mkdtempSync(join(tmpdir(), "faff-srp-fix-"));
  writeFileSync(join(d, ".faffrc.yaml"), faffrc);
  return d;
}

// --- pure resolvePinChain ---

test("resolve unpinned dir → full assembled chain, pinned:false", () => {
  const d = mkdtempSync(join(tmpdir(), "faff-srp-"));
  try {
    const res = resolvePinChain(CFG, d, undefined);
    assert.equal(res.pinned, false);
    assert.equal(res.chain.length, 3);
    assert.equal(res.chain[0].model, "mA");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("resolve pinned → pin-first [pin, ...rest], pin de-duped out of the tail", () => {
  const d = mkdtempSync(join(tmpdir(), "faff-srp-"));
  try {
    // pin the second backend (mB): resolved chain must be [mB, mA, mC], mB not repeated
    writeFileSync(join(d, "pinned-reviewer.json"), JSON.stringify(CFG.adversarial.backends[1]));
    const res = resolvePinChain(CFG, d, undefined);
    assert.equal(res.pinned, true);
    assert.equal(res.chain[0].model, "mB", "pin is first");
    assert.equal(res.chain.filter((b) => b.model === "mB").length, 1, "pin de-duped out of tail");
    assert.deepEqual(res.chain.map((b) => b.model), ["mB", "mA", "mC"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("resolve malformed pin file → pin-malformed (fail-loud), NEVER a bare full chain", () => {
  const d = mkdtempSync(join(tmpdir(), "faff-srp-"));
  try {
    writeFileSync(join(d, "pinned-reviewer.json"), "not json at all");
    const res = resolvePinChain(CFG, d, undefined);
    assert.equal(res.error, "pin-malformed");
    assert.equal(res.chain, undefined, "no chain emitted on a broken pin");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("resolve passes through unset/malformed config errors from assembleAdversarialBackends", () => {
  assert.equal(resolvePinChain({}, "/nonexistent", undefined).error, "unset");
  const bad = { adversarial: { provider: "nvidia", model: "m1", host: "https://a/v1", fallbacks: "{not json" } };
  assert.equal(resolvePinChain(bad, "/nonexistent", undefined).error, "malformed");
});

test("backendIdentity keys on provider|model|host and tolerates non-objects", () => {
  assert.equal(backendIdentity({ provider: "p", model: "m", host: "h" }), "p|m|h");
  assert.notEqual(backendIdentity({ provider: "p", model: "m", host: "h1" }), backendIdentity({ provider: "p", model: "m", host: "h2" }));
  assert.equal(backendIdentity(null), "|");
});

// --- capturePin ---

test("capture is an idempotent first-write; rounds ≥ 2 never overwrite round 1's pin", () => {
  const d = mkdtempSync(join(tmpdir(), "faff-srp-"));
  try {
    assert.equal(capturePin(d, CFG.adversarial.backends, 0).written, true);
    assert.equal(JSON.parse(readFileSync(join(d, "pinned-reviewer.json"), "utf8")).model, "mA");
    assert.equal(capturePin(d, CFG.adversarial.backends, 1).written, false, "second write is a no-op");
    assert.equal(JSON.parse(readFileSync(join(d, "pinned-reviewer.json"), "utf8")).model, "mA", "still round 1's pin");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("capture out-of-range / non-array is fail-loud and writes no pin", () => {
  const d = mkdtempSync(join(tmpdir(), "faff-srp-"));
  try {
    assert.equal(capturePin(d, CFG.adversarial.backends, 9).error, "bad-capture");
    assert.equal(capturePin(d, "nope", 0).error, "bad-capture");
    assert.equal(existsSync(join(d, "pinned-reviewer.json")), false, "no pin left behind");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("config edited mid-loop: a pin whose backend is no longer in config is emitted verbatim as the head", () => {
  const d = mkdtempSync(join(tmpdir(), "faff-srp-"));
  try {
    // the pinned backend (mZ) is NOT in CFG's assembled chain — the pin is self-contained, so it is
    // still emitted as the head and the whole current chain is the fallback tail (nothing de-duped out).
    writeFileSync(join(d, "pinned-reviewer.json"), JSON.stringify({ provider: "openai", model: "mZ", host: "https://z/v1", api_key_env: "KZ" }));
    const res = resolvePinChain(CFG, d, undefined);
    assert.equal(res.pinned, true);
    assert.equal(res.chain[0].model, "mZ", "self-contained pin emitted verbatim as head");
    assert.deepEqual(res.chain.map((b) => b.model), ["mZ", "mA", "mB", "mC"], "full current chain is the fallback tail");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("end-to-end oracle: single-reviewer round records converge; the pre-fix reviewer-swap would park", () => {
  // The pin makes every round a single reviewer, so the (unchanged) convergence detector yields.
  const mk = (total, lens, blockers = 0) => Array.from({ length: total }, (_, i) => ({ lens, severity: i < blockers ? "blocker" : "major" }));
  const converging = detectSpecReviewConvergence([
    { verdict: "reject-approach", objections: mk(6, "architectural", 0) },
    { verdict: "reject-approach", objections: mk(3, "architectural", 0) },
  ]);
  assert.equal(converging.converging, true, "one reviewer, strictly decreasing → the loop yields");

  // The pre-fix drift: a mid-loop reviewer swap raises a fresh lens ⇒ churn ⇒ the detector does NOT
  // converge (it would have force-parked). The pin (holding the reviewer) is what removes this.
  const swapped = detectSpecReviewConvergence([
    { verdict: "reject-approach", objections: mk(6, "architectural", 0) },
    { verdict: "reject-approach", objections: mk(3, "architectural", 0).concat(mk(1, "infosec", 0)) },
  ]);
  assert.equal(swapped.converging, false, "a swapped reviewer's fresh lens reads as churn → would park");
});

test("nothing served in round 1 → no pin file (capture never called with a winner)", () => {
  // The occupant returns early on an empty exit-0 lens set, so capturePin is never invoked;
  // the guarantee is that the scratch dir carries no pin afterwards and a later resolve is unpinned.
  const d = mkdtempSync(join(tmpdir(), "faff-srp-"));
  try {
    assert.equal(existsSync(join(d, "pinned-reviewer.json")), false);
    assert.equal(resolvePinChain(CFG, d, undefined).pinned, false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// --- specReviewDir ---

test("specReviewDir: run-dir → <run-dir>/<issue>/spec-review; none → .faff/spec-review/<issue>", () => {
  assert.equal(specReviewDir("FAFF-886", "/runs/r1"), join("/runs/r1", "FAFF-886", "spec-review"));
  assert.equal(specReviewDir("FAFF-886", null), join(".faff", "spec-review", "FAFF-886"));
  assert.ok(!specReviewDir("FAFF-886", null).includes(sep + sep));
});

// --- CLI seam ---

test("CLI resolve unpinned prints a chain byte-identical to `adversarial-backends`", () => {
  const repo = fixtureRepo("adversarial:\n  backends:\n    - { provider: openai, model: mA, host: https://a/v1, api_key_env: KA }\n    - { provider: nvidia, model: mB, host: https://b/v1, api_key_env: KB }\n");
  try {
    const scratch = mkdtempSync(join(tmpdir(), "faff-srp-scr-"));
    const pin = runCli(["spec-review-pin", "--resolve", "--dir", scratch, "--consumer", "spec_review"], { cwd: repo });
    const adv = runCli(["adversarial-backends", "--consumer", "spec_review"], { cwd: repo });
    assert.equal(pin.code, 0);
    assert.equal(adv.code, 0);
    assert.equal(pin.stdout.trim(), adv.stdout.trim(), "unpinned resolve is a drop-in for adversarial-backends");
    rmSync(scratch, { recursive: true, force: true });
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("CLI resolve --json wraps as {chain, pinned}; pinned resolve prints bare [pin, ...rest]", () => {
  const repo = fixtureRepo("adversarial:\n  backends:\n    - { provider: openai, model: mA, host: https://a/v1, api_key_env: KA }\n    - { provider: nvidia, model: mB, host: https://b/v1, api_key_env: KB }\n");
  try {
    const scratch = mkdtempSync(join(tmpdir(), "faff-srp-scr-"));
    const wrapped = runCli(["spec-review-pin", "--resolve", "--dir", scratch, "--consumer", "spec_review", "--json"], { cwd: repo });
    const w = JSON.parse(wrapped.stdout);
    assert.equal(w.pinned, false);
    assert.ok(Array.isArray(w.chain));

    writeFileSync(join(scratch, "pinned-reviewer.json"), JSON.stringify({ provider: "nvidia", model: "mB", host: "https://b/v1", api_key_env: "KB" }));
    const bare = runCli(["spec-review-pin", "--resolve", "--dir", scratch, "--consumer", "spec_review"], { cwd: repo });
    const chain = JSON.parse(bare.stdout);
    assert.ok(Array.isArray(chain), "default output is a bare array");
    assert.equal(chain[0].model, "mB", "pin first");
    assert.equal(chain.filter((b) => b.model === "mB").length, 1, "pin de-duped");
    rmSync(scratch, { recursive: true, force: true });
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("CLI resolve on a malformed pin → exit 2, never a chain on stdout", () => {
  const repo = fixtureRepo("adversarial:\n  backends:\n    - { provider: openai, model: mA, host: https://a/v1, api_key_env: KA }\n");
  try {
    const scratch = mkdtempSync(join(tmpdir(), "faff-srp-scr-"));
    writeFileSync(join(scratch, "pinned-reviewer.json"), "{ broken");
    const r = runCli(["spec-review-pin", "--resolve", "--dir", scratch, "--consumer", "spec_review"], { cwd: repo });
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), "", "no chain printed on a broken pin");
    rmSync(scratch, { recursive: true, force: true });
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("CLI capture: idempotent first-write, exit-2 on out-of-range", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-srp-scr-"));
  const bj = join(scratch, "backends.json");
  try {
    writeFileSync(bj, JSON.stringify(CFG.adversarial.backends));
    const c1 = runCli(["spec-review-pin", "--capture", "--dir", scratch, "--backends-json", bj, "--winner-index", "0"]);
    assert.equal(c1.code, 0);
    assert.equal(JSON.parse(c1.stdout).written, true);
    const c2 = runCli(["spec-review-pin", "--capture", "--dir", scratch, "--backends-json", bj, "--winner-index", "1"]);
    assert.equal(JSON.parse(c2.stdout).written, false, "idempotent no-op");
    const oor = runCli(["spec-review-pin", "--capture", "--dir", join(scratch, "fresh"), "--backends-json", bj, "--winner-index", "9"]);
    assert.equal(oor.code, 2);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("CLI spec-review-dir: both modes + --run-dir wins over $FAFF_RUN_DIR", () => {
  const viaFlag = runCli(["spec-review-dir", "--issue", "FAFF-886", "--run-dir", "/flag/run"], { env: { ...process.env, FAFF_RUN_DIR: "/env/run" } });
  assert.equal(viaFlag.stdout.trim(), join("/flag/run", "FAFF-886", "spec-review"), "flag wins over env");
  const viaEnv = runCli(["spec-review-dir", "--issue", "FAFF-886"], { env: { ...process.env, FAFF_RUN_DIR: "/env/run" } });
  assert.equal(viaEnv.stdout.trim(), join("/env/run", "FAFF-886", "spec-review"));
  const env = { ...process.env }; delete env.FAFF_RUN_DIR;
  const none = runCli(["spec-review-dir", "--issue", "FAFF-886"], { env });
  assert.equal(none.stdout.trim(), join(".faff", "spec-review", "FAFF-886"), "interactive .faff path");
});

test("CLI --dir is required for resolve/capture; exactly one of --resolve/--capture", () => {
  assert.notEqual(runCli(["spec-review-pin", "--resolve", "--consumer", "spec_review"]).code, 0);
  assert.notEqual(runCli(["spec-review-pin", "--dir", "/x"]).code, 0); // neither resolve nor capture
});

test("--selftest reports PASS in-process (both commands)", () => {
  assert.equal(specReviewPinSelftest(), 0);
  assert.equal(specReviewDirSelftest(), 0);
});

// --- SKILL wiring: block-scoped occupant lint + prep scratch-dir/swap-reset prose ---

test("occupant SKILL chain-assembly block calls `spec-review-pin --resolve`, NOT `adversarial-backends`", () => {
  const body = readFileSync(OCCUPANT_SKILL, "utf8");
  // Locate the fenced ```bash block that assembles $backends_json (the chain-resolve step) and
  // scope the presence/absence check to THAT block — mentions of `adversarial-backends` elsewhere
  // in the SKILL (the outcome-table exit-3/2 prose) are expected and allowed.
  const blocks = body.split("```").filter((b) => b.startsWith("bash") && b.includes("backends_json"));
  assert.ok(blocks.length >= 1, "found the chain-assembly bash block");
  const block = blocks.find((b) => b.includes("--resolve")) || blocks[0];
  assert.match(block, /spec-review-pin --resolve --dir "\$pin_dir" --consumer spec_review/, "resolve step names spec-review-pin");
  assert.doesNotMatch(block, /adversarial-backends/, "the chain-assembly block no longer calls adversarial-backends directly");
});

test("occupant SKILL documents the round-1 pin capture step (min chain[<i>], idempotent)", () => {
  const body = readFileSync(OCCUPANT_SKILL, "utf8");
  assert.match(body, /spec-review-pin --capture --dir "\$pin_dir" --backends-json "\$backends_json" --winner-index/);
  assert.match(body, /min\(i\)|lowest chain index that served/);
});

test("prep SKILL resolves the scratch dir via `spec-review-dir` and points convergence/churn at it", () => {
  const body = readFileSync(PREP_SKILL, "utf8");
  assert.match(body, /spec-review-dir --issue/, "prep resolves the scratch dir");
  assert.match(body, /faff spec-review-convergence --dir \$scratch/, "convergence reads the resolved dir");
  assert.match(body, /\$scratch\/round-<n>\.json/, "round records land under the resolved dir");
  assert.doesNotMatch(body, /faff spec-review-convergence --dir <the run's spec-review dir>/, "no stale hardcoded-dir wording");
});

test("prep SKILL documents swap-round detection + convergence-window reset", () => {
  const body = readFileSync(PREP_SKILL, "utf8");
  assert.match(body, /swap round/i);
  assert.match(body, /window_start/);
  assert.match(body, /\[window_start \.\. n\]/);
});
