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
import { frontierOpts, buildInvocation } from "../eval/cli-driver.mjs";
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
  // exercises the default argv-array spawn against the real CLI (pure read, no model call)
  assert.equal(resolveEvalModel([]), "claude-sonnet-4-6");
});
