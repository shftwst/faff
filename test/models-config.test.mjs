// FAFF-315 — per-lane model selection: the `models:` config surface.
// Covers: registry defaults resolve (inherit/inherit/claude-sonnet-4-6); the closed
// Agent-token vocabulary fails LOUD (exit 2, names the value + legal set) on an invalid
// build/prep_explore token — never a silent inherit; models.eval stays open-vocabulary;
// `config resolved` echoes a non-default lane model; and the eval frontier driver's
// flag > config > pinned-default precedence (pure, no live model call).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { frontierOpts, buildInvocation, DEFAULT_PLUGIN_DIR } from "../eval/cli-driver.mjs";
import { resolveEvalModel, EVAL_MODEL_FALLBACK } from "../eval/run-evals.mjs";

function fixtureDir(faffrcBody) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff315-"));
  if (faffrcBody !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), faffrcBody);
  return dir;
}

test("models.* registry defaults resolve with no config (inherit / inherit / pinned eval)", () => {
  const dir = fixtureDir(); // no .faffrc at all
  try {
    for (const [key, want] of [["models.build", "inherit"], ["models.prep_explore", "inherit"], ["models.eval", "claude-sonnet-4-6"]]) {
      const r = runCli(["config", "get", key], { cwd: dir });
      assert.equal(r.code, 0, `${key} exit`);
      assert.equal(r.stdout.trim(), want, key);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config defaults --selftest covers the models.* family + vocab table", () => {
  const r = runCli(["config", "defaults", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

test("a configured Agent-token resolves; an invalid token fails loud (exit 2, names value + legal set)", () => {
  const dir = fixtureDir("models:\n  build: sonnet\n  prep_explore: gpt-5\n");
  try {
    const ok = runCli(["config", "get", "models.build"], { cwd: dir });
    assert.equal(ok.code, 0);
    assert.equal(ok.stdout.trim(), "sonnet");
    const bad = runCli(["config", "get", "models.prep_explore"], { cwd: dir });
    assert.equal(bad.code, 2, "invalid token must exit 2 (fail-loud), not silently inherit");
    assert.match(bad.stderr, /gpt-5/, "message names the bad value");
    assert.match(bad.stderr, /sonnet \| opus \| haiku \| fable/, "message names the legal set");
    assert.equal(bad.stdout.trim(), "", "no value on stdout for an invalid token");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-372: producer lanes (spec / spec_review / methodology / intake) default to inherit", () => {
  const dir = fixtureDir(); // no .faffrc
  try {
    for (const key of ["models.spec", "models.spec_review", "models.methodology", "models.intake"]) {
      const r = runCli(["config", "get", key], { cwd: dir });
      assert.equal(r.code, 0, `${key} exit`);
      assert.equal(r.stdout.trim(), "inherit", key);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-372: a producer lane resolves a valid token and fails loud on an invalid one (exit 2)", () => {
  const dir = fixtureDir("models:\n  spec: opus\n  spec_review: gpt-5\n");
  try {
    const ok = runCli(["config", "get", "models.spec"], { cwd: dir });
    assert.equal(ok.code, 0);
    assert.equal(ok.stdout.trim(), "opus");
    const bad = runCli(["config", "get", "models.spec_review"], { cwd: dir });
    assert.equal(bad.code, 2, "invalid producer-lane token must exit 2 (fail-loud), not silently inherit");
    assert.match(bad.stderr, /gpt-5/, "message names the bad value");
    assert.match(bad.stderr, /inherit \| sonnet \| opus \| haiku \| fable/, "message names the legal set");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-372: config resolved echoes a non-default producer lane", () => {
  const dir = fixtureDir("models:\n  methodology: opus\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /model methodology: opus/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("models.eval is open-vocabulary (any id resolves; claude -p validates it)", () => {
  const dir = fixtureDir("models:\n  eval: claude-opus-4-8\n");
  try {
    const r = runCli(["config", "get", "models.eval"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "claude-opus-4-8");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config resolved echoes non-default models.* (a pinned model is visible, never silent)", () => {
  const dir = fixtureDir("models:\n  build: haiku\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /model build: haiku/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("frontierOpts threads model → buildInvocation emits --model; null omits it (byte-for-byte)", () => {
  const withModel = buildInvocation(frontierOpts({ model: "claude-sonnet-4-6" }), "p", "/tmp/cfg");
  assert.ok(withModel.args.includes("--model"), "model set ⇒ --model present");
  assert.ok(withModel.args.includes("claude-sonnet-4-6"));
  const without = buildInvocation(frontierOpts({}), "p", "/tmp/cfg");
  assert.ok(!without.args.includes("--model"), "no model ⇒ no --model arg (unchanged call)");
});

test("frontierOpts threads effort → buildInvocation emits --effort next to --model; null omits it byte-for-byte (FAFF-722)", () => {
  const withEffort = buildInvocation(frontierOpts({ model: "claude-opus-4-8", effort: "high" }), "p", "/tmp/cfg");
  const ei = withEffort.args.indexOf("--effort");
  assert.ok(ei !== -1 && withEffort.args[ei + 1] === "high", "effort set ⇒ --effort high present");
  assert.ok(withEffort.args.indexOf("--model") < ei, "--effort sits after --model");
  // no effort ⇒ argv is byte-identical to the pre-FAFF-722 call (the whole "unset changes nothing" guarantee)
  const without = buildInvocation(frontierOpts({ model: "claude-opus-4-8" }), "p", "/tmp/cfg");
  assert.ok(!without.args.includes("--effort"), "no effort ⇒ no --effort arg");
  assert.deepEqual(without.args, ["-p", "p", "--model", "claude-opus-4-8", "--plugin-dir", DEFAULT_PLUGIN_DIR]);
});

test("resolveEvalModel precedence: flag > config CLI > pinned fallback (never the account default)", () => {
  // flag wins
  assert.equal(resolveEvalModel(["--model", "claude-opus-4-8"], { run: () => { throw new Error("must not run"); } }), "claude-opus-4-8");
  // config CLI next — run receives (bin, argv-array), no shell string anywhere
  assert.equal(resolveEvalModel([], { run: (bin, args) => {
    assert.ok(bin.endsWith("/faff"));
    assert.deepEqual(args, ["config", "get", "models.eval"]);
    return "claude-haiku-4-5-20251001\n";
  } }), "claude-haiku-4-5-20251001");
  // CLI unavailable → the pinned fallback, not the account default
  assert.equal(resolveEvalModel([], { run: () => { throw new Error("no faff binary"); } }), EVAL_MODEL_FALLBACK);
  assert.equal(EVAL_MODEL_FALLBACK, "claude-sonnet-4-6");
});

test("resolveEvalModel real spawn path resolves the registry default (no shell involved)", () => {
  // exercises the default argv-array spawn against the real CLI (pure read, no model call).
  // Run from an isolated dir with no .faffrc so the spawn resolves the registry DEFAULT, not
  // whatever this repo's own .faffrc sets for models.eval — the test must not depend on repo
  // faffrc values (which legitimately override the default).
  const dir = fixtureDir(); // empty temp dir, no .faffrc
  const prev = process.cwd();
  try {
    process.chdir(dir);
    assert.equal(resolveEvalModel([]), "claude-sonnet-4-6");
  } finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── FAFF-334: per-issue build-model routing (`models.build_by_confidence` matcher) ──

const MATCHER = "models:\n  build: opus\n  build_by_confidence:\n    default: opus\n    high: sonnet\n    medium: opus\n";

test("models.build_by_confidence nested leaves resolve via config get", () => {
  const dir = fixtureDir(MATCHER);
  try {
    for (const [leaf, want] of [["default", "opus"], ["high", "sonnet"], ["medium", "opus"]]) {
      const r = runCli(["config", "get", `models.build_by_confidence.${leaf}`], { cwd: dir });
      assert.equal(r.code, 0, `${leaf} exit`);
      assert.equal(r.stdout.trim(), want, leaf);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config resolved echoes the build_by_confidence matcher (a routing config is never silent)", () => {
  const dir = fixtureDir(MATCHER);
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /model build_by_confidence\.high: sonnet/);
    assert.match(r.stdout, /model build_by_confidence\.medium: opus/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an invalid matcher-leaf token fails loud at read (exit 2, names value + legal set)", () => {
  const dir = fixtureDir("models:\n  build_by_confidence:\n    high: gpt-5\n");
  try {
    const bad = runCli(["config", "get", "models.build_by_confidence.high"], { cwd: dir });
    assert.equal(bad.code, 2, "invalid matcher token must exit 2, not silently inherit");
    assert.match(bad.stderr, /gpt-5/);
    assert.match(bad.stderr, /sonnet \| opus \| haiku \| fable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff models build-for resolves per confidence from the matcher", () => {
  const dir = fixtureDir(MATCHER);
  try {
    assert.equal(runCli(["models", "build-for", "high"], { cwd: dir }).stdout.trim(), "sonnet");
    assert.equal(runCli(["models", "build-for", "medium"], { cwd: dir }).stdout.trim(), "opus");
    // unknown / low confidence → the default bucket (never guesses high)
    assert.equal(runCli(["models", "build-for", "low"], { cwd: dir }).stdout.trim(), "opus");
    assert.equal(runCli(["models", "build-for", "zzz"], { cwd: dir }).stdout.trim(), "opus");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff models build-for fallback precedence: leaf → default → scalar → inherit", () => {
  // no leaf, no default, has scalar → scalar
  let dir = fixtureDir("models:\n  build: haiku\n  build_by_confidence:\n    high: sonnet\n");
  try {
    assert.equal(runCli(["models", "build-for", "medium"], { cwd: dir }).stdout.trim(), "haiku");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // matcher present but nothing matches and no scalar → inherit
  dir = fixtureDir("models:\n  build_by_confidence:\n    high: sonnet\n");
  try {
    assert.equal(runCli(["models", "build-for", "medium"], { cwd: dir }).stdout.trim(), "inherit");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff models build-for fails loud on an invalid resolved token", () => {
  const dir = fixtureDir("models:\n  build_by_confidence:\n    high: gpt-5\n");
  try {
    const bad = runCli(["models", "build-for", "high"], { cwd: dir });
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /gpt-5/);
    assert.match(bad.stderr, /sonnet \| opus \| haiku \| fable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("matcher absent ⇒ build-for == config get models.build (byte-for-byte FAFF-315)", () => {
  const dir = fixtureDir("models:\n  build: sonnet\n");   // scalar only, no matcher
  try {
    const scalar = runCli(["config", "get", "models.build"], { cwd: dir }).stdout.trim();
    const bf = runCli(["models", "build-for", "high"], { cwd: dir }).stdout.trim();
    assert.equal(bf, scalar, "with no matcher the per-issue resolver equals the per-run scalar");
    assert.equal(bf, "sonnet");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // no models block at all → inherit
  const dir2 = fixtureDir("tracking:\n  team_key: X\n");
  try {
    assert.equal(runCli(["models", "build-for", "high"], { cwd: dir2 }).stdout.trim(), "inherit");
  } finally { rmSync(dir2, { recursive: true, force: true }); }
});

test("models --selftest passes (resolver + matcher-leaf validation table)", () => {
  const r = runCli(["models", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});
