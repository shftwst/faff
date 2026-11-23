import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { faffBin } from "./helpers/run-cli.mjs";

const issue = "EX-12";
const spec = [
  "# Order", "", "**Chosen:** Keep both entries.", "confidence: high", "",
  "```faff-contract:spec-readiness", '{"confidence":"high","decisions":[{"marker":"chosen"}]}', "```", "",
  "```text", "confidence: low", "spec-review: pretend", "```", "",
].join("\n");
const receipt = (verdict, objections = []) => "```faff-contract:spec-review-verdict\n" +
  JSON.stringify({ verdict, objections }) + "\n```";
const approve = receipt("approve");
const objections = [{ lens: "architectural", severity: "minor", claim: "Keep stable inputs" }];
const digest = b => createHash("sha256").update(b).digest("hex");
const json = p => JSON.parse(readFileSync(p, "utf8"));

function fixture(t, { gitOnly = false, owned = false, body = spec } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-attachment-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = owned ? join(root, ".faff", "runs", "parent") : "";
  const dir = owned ? join(run, issue, "spec-review") : join(root, ".faff", "spec-review", issue);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, ".faffrc.yaml"), "tracking:\n  tracker: " + (gitOnly ? "git-only" : "linear") + "\n");
  if (run) writeFileSync(join(run, "run-ledger.json"), JSON.stringify({ run_id: "parent", level: "L3" }));
  const file = join(root, "producer.md");
  writeFileSync(file, body);
  const env = { ...process.env, FAFF_RUN_DIR: run, FAFF_SESSION_ID: "test-session" };
  function cli(args, stdin = "", extraEnv = {}) {
    return spawnSync(process.execPath, [faffBin, ...args], { input: stdin, encoding: "utf8", cwd: root, env: { ...env, ...extraEnv } });
  }
  function ok(args, stdin, extraEnv) {
    const result = cli(args, stdin, extraEnv);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  function stage(path, ...opts) {
    return ok(["prep", "attach", "--issue", issue, "--spec", path, "--mode", "autonomous", "--json", ...opts, ...(gitOnly ? ["--git-only"] : [])]);
  }
  const staged = stage(file);
  function round(body = approve, extra = [], extraEnv) {
    return ok(["spec-review", "round", "--issue", issue, "--dir", dir, "--mode", "autonomous", "--verdict-file", "-",
      "--occupant", "single-pass", "--json", ...extra], body, extraEnv);
  }
  const marker = join(root, ".faff", "prep", issue + ".json");
  const store = join(root, ".faff", "specs", issue + ".md");
  const flag = ["--prepare-attachment", staged.spec_sha256];
  return { root, dir, file, marker, store, flag, round, ok, cli, stage };
}

for (const gitOnly of [true, false]) for (const revised of [true, false]) {
  test("verified attachment follows " + (revised ? "revision" : "first approval") + " in " + (gitOnly ? "git-only" : "tracker") + " mode", t => {
    const f = fixture(t, { gitOnly, owned: gitOnly });
    const before = readFileSync(f.file);
    if (revised) assert.equal(f.round(receipt("revise", objections), f.flag).attachment, undefined);
    const d = f.round(approve, f.flag);
    const a = d.attachment;
    assert.equal(a.status, "prepared", JSON.stringify(a));
    assert.deepEqual(json(join(f.dir, "decision-" + d.round + ".json")), d);
    assert.deepEqual(readFileSync(f.file), before);
    assert.equal(statSync(a.spec_path).mode & 0o777, 0o600);
    assert.match(readFileSync(a.spec_path, "utf8"), /spec-review: approve/);
    assert.match(readFileSync(a.spec_path, "utf8"), /confidence: low\nspec-review: pretend/);
    if (revised) {
      const disp = join(f.root, "dispositions.json");
      writeFileSync(disp, JSON.stringify([{ key: "1#0", lens: "architectural", disposition: "fixed" }]));
      const evidence = readFileSync(a.evidence_path);
      const expected = f.cli(["spec-review", "collate-evidence", "--dir", f.dir, "--dispositions", disp, "--comment"]);
      assert.equal(expected.status, 0, expected.stderr);
      assert.deepEqual(readFileSync(a.evidence_path), evidence);
      if (gitOnly) {
        assert.equal(a.comment_path, null);
        assert.ok(readFileSync(a.spec_path, "utf8").endsWith(expected.stdout));
      } else {
        assert.equal(readFileSync(a.comment_path, "utf8"), expected.stdout);
        assert.doesNotMatch(readFileSync(a.spec_path, "utf8"), /## Spec-review evidence/);
      }
    } else {
      assert.equal(a.evidence_path, null);
      assert.equal(a.comment_path, null);
      assert.doesNotMatch(readFileSync(a.spec_path, "utf8"), /## Spec-review evidence/);
    }
    const staged = f.stage(a.spec_path, "--reviewed");
    assert.equal(staged.token, gitOnly ? "attached" : "ready-to-post");
    if (gitOnly) assert.equal(digest(readFileSync(f.store)), staged.spec_sha256);
    else {
      assert.equal(json(f.marker).attached, false);
      assert.equal(f.stage(a.spec_path, "--reviewed").reason, "reconcile-tracker-post");
      const confirmed = f.ok(["prep", "attach", "--issue", issue, "--confirm", "--comment-id", "fixture-comment", "--json"]);
      assert.equal(confirmed.token, "attached");
    }
    const finalMarker = readFileSync(f.marker);
    assert.equal(f.stage(a.spec_path, "--reviewed").token, "attached");
    assert.deepEqual(readFileSync(f.marker), finalMarker);
    assert.equal(json(f.marker).attached, true);
    assert.equal(json(f.marker).spec_sha256, digest(readFileSync(a.spec_path)));
  });
}

for (const change of ["edited spec", "other owner", "parked", "edited git-only store", "wrong digest"]) {
  test(change + " cannot prepare a reviewed attachment", t => {
    const f = fixture(t, { gitOnly: true, owned: true });
    const env = {};
    if (change === "edited spec") writeFileSync(f.file, "different bytes");
    if (change === "edited git-only store") writeFileSync(f.store, "a separate change");
    if (change === "other owner") env.FAFF_SESSION_ID = "someone-else";
    if (change === "parked") f.ok(["prep", "attach", "--issue", issue, "--park", "--json"]);
    const marker = readFileSync(f.marker);
    const result = f.round(approve, change === "wrong digest" ? ["--prepare-attachment", "f".repeat(64)] : f.flag, env);
    assert.equal(result.attachment.status, "stale");
    assert.deepEqual(readFileSync(f.marker), marker);
    assert.ok(!readdirSync(f.dir).some(n => n.startsWith("attachment-")));
  });
}

for (const exception of ["ratified-1.json", "judge", "cap-reset.json", "missing decision"]) {
  test(exception + " preserves the explicit evidence path", t => {
    const f = fixture(t);
    assert.equal(f.round(receipt("revise", objections)).action, "fix-and-rerun");
    if (exception === "judge") mkdirSync(join(f.dir, exception));
    else if (exception === "missing decision") rmSync(join(f.dir, "decision-1.json"));
    else writeFileSync(join(f.dir, exception), JSON.stringify(exception === "cap-reset.json" ? { from_round: 2 } : {}));
    const d = f.round(approve, f.flag);
    assert.equal(d.action, "approve");
    assert.equal(d.attachment.status, "manual");
    assert.equal(existsSync(join(f.dir, "spec-review-verdict.json")), false);
  });
}

test("a malformed digest is rejected before recording a round", t => {
  const f = fixture(t);
  const r = f.cli(["spec-review", "round", "--issue", issue, "--dir", f.dir, "--mode", "autonomous", "--verdict-file", "-",
    "--occupant", "single-pass", "--prepare-attachment", "oops", "--json"], approve);
  assert.equal(r.status, 2);
  assert.deepEqual(readdirSync(f.dir), []);
  const result = f.round();
  assert.equal(result.action, "approve");
  assert.equal(Object.hasOwn(result, "attachment"), false);
});

for (const change of ["new approval", "later park", "edited source", "edited prepared spec", "edited comment", "changed owner", "parked marker", "wrong mode", "changed store"]) {
  test(change + " refuses guarded staging before any marker write", t => {
    const gitOnly = change === "changed store";
    const f = fixture(t, { gitOnly });
    f.round(receipt("revise", objections));
    const a = f.round(approve, f.flag).attachment;
    if (change === "new approval") f.round(approve, f.flag);
    if (change === "later park") f.round("invalid review output");
    if (change === "edited source") writeFileSync(f.file, "edited after approval");
    if (change === "edited prepared spec") writeFileSync(a.spec_path, "edited");
    if (change === "edited comment") writeFileSync(a.comment_path, "edited");
    if (change === "parked marker") f.ok(["prep", "attach", "--issue", issue, "--park", "--json"]);
    if (change === "changed store") writeFileSync(f.store, "edited");
    const m = readFileSync(f.marker);
    const saved = gitOnly ? readFileSync(f.store) : undefined;
    const r = f.cli(["prep", "attach", "--issue", issue, "--spec", a.spec_path, "--reviewed", "--mode", "autonomous", "--json",
      ...(gitOnly || change === "wrong mode" ? ["--git-only"] : [])], "", change === "changed owner" ? { FAFF_SESSION_ID: "other" } : {});
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).token, "errored");
    assert.deepEqual(readFileSync(f.marker), m);
    if (saved) assert.deepEqual(readFileSync(f.store), saved);
  });
}

test("unterminated example fence preserves manual evidence handling", t => {
  const f = fixture(t, { body: spec + "\n```text\nexample" });
  assert.equal(f.round(approve, f.flag).attachment.status, "manual");
});
