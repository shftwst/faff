// Per-lane model selection through the `dispatch:` tree (FAFF-315 lanes, FAFF-1198 form).
// Covers: an unset lane resolves to inherit; the closed Agent-token vocabulary fails LOUD
// (exit 2, names the value + legal set) on an invalid token — never a silent inherit;
// `config resolved` echoes a non-default lane model; the build-model chain
// (by_tier -> by_confidence -> scalar -> inherit); eval.model stays open-vocabulary; and the
// eval frontier driver's flag > config > pinned-default precedence (pure, no live model call).

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

const resolve = (dir, lane, ...flags) => runCli(["dispatch", "resolve", lane, ...flags], { cwd: dir });
const resolved = (dir, lane, ...flags) => {
  const r = resolve(dir, lane, ...flags);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const LEGAL_MODELS = /inherit \| sonnet \| opus \| haiku \| fable/;

test("an unset dispatch lane resolves to inherit; eval.model resolves its pinned default", () => {
  const dir = fixtureDir(); // no .faffrc at all
  try {
    for (const lane of ["build", "prep_explore"]) assert.deepEqual(resolved(dir, lane), { model: "inherit", effort: "inherit" }, lane);
    const r = runCli(["config", "get", "eval.model"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "claude-sonnet-4-6");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config defaults --selftest covers the dispatch vocabulary", () => {
  const r = runCli(["config", "defaults", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

test("a configured Agent-token resolves; an invalid token fails loud (exit 2, names value + legal set)", () => {
  const good = fixtureDir("dispatch:\n  build:\n    model: sonnet\n");
  const dir = fixtureDir("dispatch:\n  prep_explore:\n    model: gpt-5\n");
  try {
    assert.equal(resolved(good, "build").model, "sonnet");
    const bad = resolve(dir, "prep_explore");
    assert.equal(bad.code, 2, "invalid token must exit 2 (fail-loud), not silently inherit");
    assert.match(bad.stderr, /gpt-5/, "message names the bad value");
    assert.match(bad.stderr, /sonnet \| opus \| haiku \| fable/, "message names the legal set");
    assert.equal(bad.stdout.trim(), "", "no value on stdout for an invalid token");
    const read = runCli(["config", "get", "dispatch.prep_explore.model"], { cwd: dir });
    assert.equal(read.code, 2, "the raw read refuses the same token");
  } finally { for (const d of [good, dir]) rmSync(d, { recursive: true, force: true }); }
});

test("producer lanes (spec / spec_review / methodology / intake) default to inherit", () => {
  const dir = fixtureDir(); // no .faffrc
  try {
    for (const lane of ["spec", "spec_review", "methodology", "intake"]) {
      assert.equal(resolved(dir, lane).model, "inherit", lane);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a producer lane resolves a valid token and fails loud on an invalid one (exit 2)", () => {
  const good = fixtureDir("dispatch:\n  spec:\n    model: opus\n");
  const dir = fixtureDir("dispatch:\n  spec_review:\n    model: gpt-5\n");
  try {
    assert.equal(resolved(good, "spec").model, "opus");
    const bad = resolve(dir, "spec_review");
    assert.equal(bad.code, 2, "invalid producer-lane token must exit 2 (fail-loud), not silently inherit");
    assert.match(bad.stderr, /gpt-5/, "message names the bad value");
    assert.match(bad.stderr, LEGAL_MODELS, "message names the legal set");
  } finally { for (const d of [good, dir]) rmSync(d, { recursive: true, force: true }); }
});

test("config resolved echoes a non-default producer lane", () => {
  const dir = fixtureDir("dispatch:\n  methodology:\n    model: opus\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /dispatch methodology: model=opus/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("eval.model is open-vocabulary (any id resolves; claude -p validates it) but refuses engine values", () => {
  const dir = fixtureDir("eval:\n  model: claude-opus-4-8\n");
  const engine = fixtureDir("eval:\n  model: engine:studio\n");
  try {
    const r = runCli(["config", "get", "eval.model"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "claude-opus-4-8");
    const e = runCli(["config", "get", "eval.model"], { cwd: engine });
    assert.equal(e.code, 2, "an engine value on eval.model fails loud");
  } finally { for (const d of [dir, engine]) rmSync(d, { recursive: true, force: true }); }
});

test("models.eval and effort.eval moved to the eval block: reads and writes fail loud naming the new key (ADR-0133)", () => {
  const unset = fixtureDir();
  const legacy = fixtureDir("models:\n  eval: claude-opus-4-8\neffort:\n  eval: medium\n");
  try {
    for (const dir of [unset, legacy]) {
      for (const [oldKey, newKey] of [["models.eval", "eval.model"], ["effort.eval", "eval.effort"]]) {
        const r = runCli(["config", "get", oldKey], { cwd: dir });
        assert.equal(r.code, 2, `${oldKey} read fails loud`);
        assert.match(r.stderr, new RegExp(`moved to ${newKey.replace(".", "\\.")}`));
      }
    }
    const w = runCli(["config", "set", "models.eval", "claude-opus-5-5"], { cwd: unset });
    assert.equal(w.code, 2, "writing the old key fails loud");
    assert.match(w.stderr, /moved to eval\.model/);
  } finally { for (const d of [unset, legacy]) rmSync(d, { recursive: true, force: true }); }
});

test("config resolved echoes a non-default dispatch model (a pinned model is visible, never silent)", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    model: haiku\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /dispatch build: model=haiku/);
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
    assert.deepEqual(args, ["config", "get", "eval.model"]);
    return "claude-haiku-4-5-20251001\n";
  } }), "claude-haiku-4-5-20251001");
  // CLI unavailable → the pinned fallback, not the account default
  assert.equal(resolveEvalModel([], { run: () => { throw new Error("no faff binary"); } }), EVAL_MODEL_FALLBACK);
  assert.equal(EVAL_MODEL_FALLBACK, "claude-sonnet-4-6");
});

test("resolveEvalModel real spawn path resolves the registry default (no shell involved)", () => {
  // exercises the default argv-array spawn against the real CLI (pure read, no model call).
  // Run from an isolated dir with no .faffrc so the spawn resolves the registry DEFAULT, not
  // whatever this repo's own .faffrc sets for eval.model — the test must not depend on repo
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

// ── per-issue build-model routing (`dispatch.build.by_confidence` matcher, FAFF-334) ──

const MATCHER = "dispatch:\n  build:\n    model: opus\n    by_confidence:\n      default:\n        model: opus\n      high:\n        model: sonnet\n      medium:\n        model: opus\n";

test("dispatch.build.by_confidence nested leaves resolve via config get", () => {
  const dir = fixtureDir(MATCHER);
  try {
    for (const [leaf, want] of [["default", "opus"], ["high", "sonnet"], ["medium", "opus"]]) {
      const r = runCli(["config", "get", `dispatch.build.by_confidence.${leaf}.model`], { cwd: dir });
      assert.equal(r.code, 0, `${leaf} exit`);
      assert.equal(r.stdout.trim(), want, leaf);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config resolved echoes the by_confidence matcher (a routing config is never silent)", () => {
  const dir = fixtureDir(MATCHER);
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /dispatch build\.by_confidence\.high: model=sonnet/);
    assert.match(r.stdout, /dispatch build\.by_confidence\.medium: model=opus/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an invalid matcher-leaf token fails loud at read (exit 2, names value + legal set)", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    by_confidence:\n      high:\n        model: gpt-5\n");
  try {
    const bad = runCli(["config", "get", "dispatch.build.by_confidence.high.model"], { cwd: dir });
    assert.equal(bad.code, 2, "invalid matcher token must exit 2, not silently inherit");
    assert.match(bad.stderr, /gpt-5/);
    assert.match(bad.stderr, /sonnet \| opus \| haiku \| fable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dispatch resolve build resolves per confidence from the matcher", () => {
  const dir = fixtureDir(MATCHER);
  try {
    assert.equal(resolved(dir, "build", "--confidence", "high").model, "sonnet");
    assert.equal(resolved(dir, "build", "--confidence", "medium").model, "opus");
    // unknown / low confidence → the default bucket (never guesses high)
    assert.equal(resolved(dir, "build", "--confidence", "low").model, "opus");
    assert.equal(resolved(dir, "build", "--confidence", "zzz").model, "opus");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dispatch resolve build fallback precedence: leaf → default → scalar → inherit", () => {
  // no leaf, no default, has scalar → scalar
  let dir = fixtureDir("dispatch:\n  build:\n    model: haiku\n    by_confidence:\n      high:\n        model: sonnet\n");
  try {
    assert.equal(resolved(dir, "build", "--confidence", "medium").model, "haiku");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // matcher present but nothing matches and no scalar → inherit
  dir = fixtureDir("dispatch:\n  build:\n    by_confidence:\n      high:\n        model: sonnet\n");
  try {
    assert.equal(resolved(dir, "build", "--confidence", "medium").model, "inherit");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a capitalised matcher leaf key (High:) resolves case-insensitively", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    by_confidence:\n      High:\n        model: sonnet\n      default:\n        model: opus\n");
  try {
    assert.equal(resolved(dir, "build", "--confidence", "high").model, "sonnet");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dispatch resolve build fails loud on an invalid resolved token", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    by_confidence:\n      high:\n        model: gpt-5\n");
  try {
    const bad = resolve(dir, "build", "--confidence", "high");
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /gpt-5/);
    assert.match(bad.stderr, /sonnet \| opus \| haiku \| fable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an invalid matcher leaf fails loud even for a confidence that never resolves to it", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    by_confidence:\n      high:\n        model: gpt-5\n      default:\n        model: opus\n");
  try {
    assert.equal(resolve(dir, "build", "--confidence", "medium").code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("matcher absent ⇒ build resolves to the scalar dispatch.build.model", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    model: sonnet\n");   // scalar only, no matcher
  try {
    const scalar = runCli(["config", "get", "dispatch.build.model"], { cwd: dir }).stdout.trim();
    const viaChain = resolved(dir, "build", "--confidence", "high").model;
    assert.equal(viaChain, scalar, "with no matcher the per-issue resolver equals the per-run scalar");
    assert.equal(viaChain, "sonnet");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // no dispatch block at all → inherit
  const dir2 = fixtureDir("tracking:\n  team_key: X\n");
  try {
    assert.equal(resolved(dir2, "build", "--confidence", "high").model, "inherit");
  } finally { rmSync(dir2, { recursive: true, force: true }); }
});

test("dispatch --selftest passes (resolver + matcher-leaf validation table)", () => {
  const r = runCli(["dispatch", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});
