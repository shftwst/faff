// FAFF-1406: `faff prep attach`. Runs the real CLI against mkdtempSync fixture repos: stage writes the
// attach-state marker before it can fail, stamps and tiers the spec, folds the readiness block, and either
// hands back a body to post or (git-only) closes the marker; confirm closes it only while the staged file
// still hashes to the staged digest; park records the disposition. The integration smoke ends in
// `faff spec commit` reporting `source_check: "match"` on the posted bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const fs = require("fs");
const prepAttach = require("../plugin/skills/faff/bin/lib/prep-attach.js");

const TOKENS = ["ready-to-post", "attached", "invalid", "needs-judgement", "parked", "errored"];
const sha = (b) => createHash("sha256").update(b).digest("hex");
const READY = "```faff-contract:spec-readiness\n{ \"confidence\": \"high\", \"decisions\": [ { \"marker\": \"chosen\" } ] }\n```";

function spec({ h1 = true, block = READY, confidence = "confidence: high", body = [] } = {}) {
  return [
    ...(h1 ? ["# EX: a fixture spec", ""] : []),
    "Preamble line.", "", "## Decisions", "", "**Chosen:** one thing.", "", ...body,
    "## Scenarios", "", "```", "Given a visible scenario", "When it runs", "Then it passes", "```", "",
    "```holdout", "Given a withheld scenario", "When it runs", "Then it passes", "```", "",
    "## 7. DONE", "", "- [ ] first item must hold", "",
    ...(confidence ? [confidence, ""] : []),
    ...(block ? [block, ""] : []),
  ].join("\n");
}

function fixture({ tracker = "linear", text = spec(), git = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-prep-attach-"));
  mkdirSync(join(root, ".faff"));
  writeFileSync(join(root, ".faff", "config.yaml"), `tracking:\n  tracker: ${tracker}\nslots:\n  spec: faffter-dark-nlspec\n`);
  if (git) {
    execFileSync("git", ["-C", root, "init", "-q"]);
    execFileSync("git", ["-C", root, "config", "user.email", "t@example.com"]);
    execFileSync("git", ["-C", root, "config", "user.name", "T"]);
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "a.txt"), "hi\n");
    writeFileSync(join(root, ".faff", ".gitignore"), "*\n!.gitignore\n");
    execFileSync("git", ["-C", root, "add", "-A"]);
    execFileSync("git", ["-C", root, "commit", "-qm", "init"]);
  }
  const specFile = join(root, "s.md");
  writeFileSync(specFile, text);
  return { root, specFile, marker: (issue = "EX-1") => join(root, ".faff", "prep", `${issue}.json`) };
}

function cli(root, args, env = {}) {
  const r = spawnSync("node", [CLI, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, FAFF_SESSION_ID: "", FAFF_RUN_DIR: "", ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}
const stage = (f, extra = [], issue = "EX-1") => cli(f.root, ["prep", "attach", "--issue", issue, "--spec", f.specFile, "--mode", "interactive", "--root", f.root, "--json", ...extra]);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const prepcheckState = (f, issue = "EX-1") => JSON.parse(cli(f.root, ["prepcheck", "--issue", issue, "--json"]).stdout).state;

test("stage: ready-to-post, marker open with spec_sha256 and body_path, stamp and one tier line", () => {
  const f = fixture();
  const r = stage(f);
  assert.equal(r.status, 0, r.stderr);
  const out = r.json();
  assert.equal(out.token, "ready-to-post");
  assert.ok(TOKENS.includes(out.token));
  const bytes = readFileSync(f.specFile);
  const m = readJson(f.marker());
  assert.equal(m.attached, false);
  assert.equal(m.spec_produced, true);
  assert.equal(m.mode, "tracker");
  assert.equal(m.spec_sha256, sha(bytes));
  assert.equal(out.spec_sha256, sha(bytes));
  assert.equal(m.body_path, f.specFile);
  assert.equal(out.body_path, f.specFile);
  for (const k of ["owner", "harness", "model", "faff_version", "ts"]) assert.ok(m[k] !== undefined, k);
  assert.equal(typeof m.owner.pid, "number");
  assert.equal(m.owner.session_id, undefined);
  const lines = bytes.toString().split("\n");
  assert.match(lines[2], /^> Spec: faffter-dark-nlspec · \d{4}-\d{2}-\d{2} · interactive · [^ ]+\/[^ ]+ · faff [^ ]+ · confidence: high\. Full spec on Linear EX-1\.$/);
  assert.equal(lines.filter((l) => l.startsWith("build-tier:")).length, 1);
  assert.equal(prepcheckState(f), "open");
});

test("stage: owner carries FAFF_SESSION_ID and FAFF_RUN_DIR when set", () => {
  const f = fixture();
  const r = cli(f.root, ["prep", "attach", "--issue", "EX-1", "--spec", f.specFile, "--mode", "autonomous", "--root", f.root, "--json"], { FAFF_SESSION_ID: "sess", FAFF_RUN_DIR: "/rd" });
  assert.equal(r.status, 0, r.stderr);
  const m = readJson(f.marker());
  assert.equal(m.owner.session_id, "sess");
  assert.equal(m.owner.run_dir, "/rd");
  assert.match(readFileSync(f.specFile, "utf8"), /· autonomous ·/);
});

test("stage then confirm: attached with comment_id and attached_at; prepcheck reads attached", () => {
  const f = fixture();
  stage(f);
  const r = cli(f.root, ["prep", "attach", "--issue", "EX-1", "--confirm", "--comment-id", "c-123", "--root", f.root, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json().token, "attached");
  const m = readJson(f.marker());
  assert.equal(m.attached, true);
  assert.equal(m.comment_id, "c-123");
  assert.ok(m.attached_at);
  assert.ok(m.spec_sha256 && m.faff_version && m.harness && m.model && m.owner);
  assert.equal(prepcheckState(f), "attached");
});

test("stage twice: still one stamp and one build-tier line, marker reopened", () => {
  const f = fixture();
  stage(f);
  cli(f.root, ["prep", "attach", "--issue", "EX-1", "--confirm", "--comment-id", "c1", "--root", f.root, "--json"]);
  const r = stage(f);
  assert.equal(r.json().token, "ready-to-post");
  const text = readFileSync(f.specFile, "utf8");
  assert.equal(text.split("\n").filter((l) => l.startsWith("> Spec:")).length, 1);
  assert.equal(text.split("\n").filter((l) => l.startsWith("build-tier:")).length, 1);
  assert.equal(readJson(f.marker()).attached, false);
});

test("stage: a fenced > Spec: example is never touched", () => {
  const f = fixture({ text: spec({ body: ["```", "> Spec: example only", "build-tier: complex", "```", ""] }) });
  stage(f);
  const text = readFileSync(f.specFile, "utf8");
  assert.ok(text.includes("```\n> Spec: example only\nbuild-tier: complex\n```"));
  assert.equal(text.split("\n").filter((l) => l.startsWith("> Spec: faffter")).length, 1);
});

test("stage: build-tier equals faff tier on the written file, across the spec_lines boundary", () => {
  // The fixture scores just under the complex cut near 320 lines; stage adds three lines (stamp, its
  // blank line, build-tier), so one of these sizes tiers differently before and after stage.
  const base = spec().split("\n").length;
  let crossed = false;
  for (let n = 316 - base; n <= 322 - base; n++) {
    const filler = Array.from({ length: n }, (_, i) => `filler ${i}`);
    const f = fixture({ text: spec({ body: [...filler, ""] }) });
    const before = cli(f.root, ["tier", f.specFile]).stdout.trim();
    const out = stage(f).json();
    const printed = cli(f.root, ["tier", f.specFile]).stdout.trim();
    assert.equal(out.build_tier, printed, `n=${n}`);
    assert.ok(readFileSync(f.specFile, "utf8").includes(`build-tier: ${printed}`));
    if (before !== printed) crossed = true;
  }
  assert.ok(crossed, "the range must include a size whose tier changes across stage");
});

test("stage: --gate-history feeds the tier exactly as faff tier --gate-history does", () => {
  const f = fixture();
  const out = stage(f, ["--gate-history", "3"]).json();
  assert.equal(out.build_tier, cli(f.root, ["tier", f.specFile, "--gate-history", "3"]).stdout.trim());
});

test("stage: no H1 is invalid no-h1 and still leaves an open marker", () => {
  const f = fixture({ text: spec({ h1: false }) });
  const r = stage(f);
  assert.equal(r.status, 0);
  assert.deepEqual([r.json().token, r.json().reason], ["invalid", "no-h1"]);
  assert.equal(readJson(f.marker()).attached, false);
  assert.equal(prepcheckState(f), "open");
});

test("stage: an unreadable spec is errored and writes no marker", () => {
  const f = fixture();
  const r = cli(f.root, ["prep", "attach", "--issue", "EX-1", "--spec", join(f.root, "nope.md"), "--mode", "interactive", "--root", f.root, "--json"]);
  assert.equal(r.status, 2);
  assert.equal(r.json().token, "errored");
  assert.equal(existsSync(f.marker()), false);
});

test("stage: no readiness block is needs-judgement no-readiness-block; --extraction re-enters", () => {
  const f = fixture({ text: spec({ block: null }) });
  const r = stage(f);
  assert.equal(r.status, 0);
  assert.deepEqual([r.json().token, r.json().reason], ["needs-judgement", "no-readiness-block"]);
  assert.equal(readJson(f.marker()).attached, false);
  const ex = join(f.root, "ex.json");
  writeFileSync(ex, JSON.stringify({ confidence: "high", decisions: [{ marker: "chosen" }] }));
  assert.equal(stage(f, ["--extraction", ex]).json().token, "ready-to-post");
  writeFileSync(ex, JSON.stringify({ confidence: "high", decisions: [{ marker: "chosen" }], provenance_present: false }));
  assert.equal(stage(f, ["--extraction", ex]).json().token, "ready-to-post", "provenance_present is computed by the command, never taken from the extraction");
});

test("stage: readiness violations are invalid; two blocks or an unparseable block are errored", () => {
  let f = fixture({ text: spec({ block: "```faff-contract:spec-readiness\n{ \"confidence\": \"high\", \"decisions\": [ { \"marker\": \"none\" } ] }\n```" }) });
  let out = stage(f).json();
  assert.equal(out.token, "invalid");
  assert.ok(out.violations.some((v) => v.includes("no canonical marker")));
  f = fixture({ text: spec({ block: `${READY}\n\n${READY}` }) });
  let r = stage(f);
  assert.equal(r.status, 2);
  assert.equal(r.json().token, "errored");
  f = fixture({ text: spec({ block: "```faff-contract:spec-readiness\n{ nope\n```" }) });
  r = stage(f);
  assert.equal(r.status, 2);
  assert.equal(r.json().token, "errored");
});

test("stage: a missing or non-closed-set confidence line stamps unknown and is invalid", () => {
  for (const confidence of [null, "confidence: high · forged tail"]) {
    const f = fixture({ text: spec({ confidence }) });
    const out = stage(f).json();
    assert.equal(out.token, "invalid");
    assert.equal(out.confidence, "unknown");
    assert.match(readFileSync(f.specFile, "utf8"), /· confidence: unknown\. Full spec on/);
    assert.ok(!readFileSync(f.specFile, "utf8").split("\n").find((l) => l.startsWith("> Spec:")).includes("forged"));
  }
});

test("confirm: errored with no staged marker; exit 2 without --comment-id", () => {
  const f = fixture();
  const r = cli(f.root, ["prep", "attach", "--issue", "EX-1", "--confirm", "--comment-id", "c1", "--root", f.root, "--json"]);
  assert.equal(r.status, 2);
  assert.deepEqual([r.json().token, r.json().reason], ["errored", "no-staged-spec"]);
  assert.equal(existsSync(f.marker()), false);
  assert.equal(cli(f.root, ["prep", "attach", "--issue", "EX-1", "--confirm", "--root", f.root]).status, 2);
});

test("confirm: an edit after stage is errored spec-changed-since-stage and leaves the marker open", () => {
  const f = fixture();
  stage(f);
  writeFileSync(f.specFile, readFileSync(f.specFile, "utf8") + "\nedited\n");
  const r = cli(f.root, ["prep", "attach", "--issue", "EX-1", "--confirm", "--comment-id", "c1", "--root", f.root, "--json"]);
  assert.equal(r.status, 2);
  assert.deepEqual([r.json().token, r.json().reason], ["errored", "spec-changed-since-stage"]);
  assert.equal(readJson(f.marker()).attached, false);
});

test("park: sets disposition parked, keeps a park sub-object, prepcheck reads parked", () => {
  const f = fixture();
  stage(f);
  const m = readJson(f.marker());
  m.park = { reconsider: "human", cause_class: "low-confidence" };
  writeFileSync(f.marker(), JSON.stringify(m));
  const r = cli(f.root, ["prep", "attach", "--issue", "EX-1", "--park", "--root", f.root, "--json"]);
  assert.equal(r.status, 0);
  assert.equal(r.json().token, "parked");
  const after = readJson(f.marker());
  assert.equal(after.disposition, "parked");
  assert.deepEqual(after.park, { reconsider: "human", cause_class: "low-confidence" });
  assert.equal(prepcheckState(f), "parked");
});

test("park: no marker is errored no-staged-spec and writes no marker", () => {
  const f = fixture();
  const r = cli(f.root, ["prep", "attach", "--issue", "EX-1", "--park", "--root", f.root, "--json"]);
  assert.equal(r.status, 2);
  assert.deepEqual([r.json().token, r.json().reason], ["errored", "no-staged-spec"]);
  assert.equal(existsSync(f.marker()), false);
});

test("git-only: stage writes the store with the stamped bytes, no tracker tail, and closes the marker", () => {
  const f = fixture();
  const r = stage(f, ["--git-only"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json().token, "attached");
  const store = readFileSync(join(f.root, ".faff", "specs", "EX-1.md"));
  assert.ok(store.equals(readFileSync(f.specFile)));
  const stampLine = store.toString().split("\n")[2];
  assert.ok(stampLine.startsWith("> Spec: ") && stampLine.endsWith("confidence: high."));
  const m = readJson(f.marker());
  assert.equal(m.attached, true);
  assert.equal(m.mode, "git-only");
  assert.ok(m.attached_at);
});

test("git-only: a parked marker is needs-judgement git-only-marker-parked and left byte-identical", () => {
  const f = fixture();
  mkdirSync(join(f.root, ".faff", "prep"), { recursive: true });
  const before = JSON.stringify({ issue: "EX-1", spec_produced: true, attached: false, disposition: "parked", park: { reconsider: "machine" } });
  writeFileSync(f.marker(), before);
  const r = stage(f, ["--git-only"]);
  assert.equal(r.status, 0);
  assert.deepEqual([r.json().token, r.json().reason], ["needs-judgement", "git-only-marker-parked"]);
  assert.equal(readFileSync(f.marker(), "utf8"), before);
  assert.equal(existsSync(join(f.root, ".faff", "specs", "EX-1.md")), false);
});

test("tracker mode: a parked marker is replaced, since the label is the park record there", () => {
  const f = fixture();
  mkdirSync(join(f.root, ".faff", "prep"), { recursive: true });
  writeFileSync(f.marker(), JSON.stringify({ issue: "EX-1", spec_produced: true, attached: false, disposition: "parked" }));
  assert.equal(stage(f).json().token, "ready-to-post");
  assert.equal(readJson(f.marker()).disposition, undefined);
});

test("usage: unknown flag, missing value, two modes, mode-only flags, bad --issue all exit 2 and write nothing", () => {
  const f = fixture();
  const cases = [
    ["--issue", "EX-1", "--spec", f.specFile, "--mode", "interactive", "--bogus"],
    ["--issue", "EX-1", "--spec", f.specFile],
    ["--issue", "EX-1", "--spec", f.specFile, "--mode", "sometimes"],
    ["--spec", f.specFile, "--mode", "interactive"],
    ["--issue", "EX-1", "--spec", f.specFile, "--mode", "interactive", "--park"],
    ["--issue", "EX-1", "--confirm", "--comment-id", "c", "--park"],
    ["--issue", "EX-1", "--park", "--mode", "interactive"],
    ["--issue", "EX-1", "--spec", f.specFile, "--mode", "interactive", "--comment-id", "c"],
    ["--issue", "EX-1", "--spec", f.specFile, "--mode", "interactive", "--gate-history", "-1"],
    ["--issue", "EX-1", "--spec", f.specFile, "--mode", "interactive", "--gate-history", "1.5"],
    ["--issue", "../x", "--spec", f.specFile, "--mode", "interactive"],
    ["--issue", "EX-1/..", "--spec", f.specFile, "--mode", "interactive"],
    ["--issue", "EX-1"],
  ];
  for (const c of cases) {
    const r = cli(f.root, ["prep", "attach", ...c, "--root", f.root]);
    assert.equal(r.status, 2, c.join(" "));
  }
  assert.equal(cli(f.root, ["prep", "stage"]).status, 2);
  assert.equal(existsSync(join(f.root, ".faff", "prep")), false);
  assert.equal(readFileSync(f.specFile, "utf8"), spec());
});

test("marker writes go through a temp file renamed into the marker's directory", () => {
  const f = fixture();
  const renames = [];
  const orig = fs.renameSync;
  fs.renameSync = (a, b) => { renames.push([a, b]); return orig(a, b); };
  try {
    const deps = prepAttach.defaultDeps(f.root);
    const res = prepAttach.stage({ issue: "EX-1", specPath: f.specFile, mode: "interactive", gitOnly: false, gateHistory: null, extractionPath: null, root: f.root }, deps);
    assert.equal(res.token, "ready-to-post");
    prepAttach.confirm({ issue: "EX-1", commentId: "c1", root: f.root }, deps);
    prepAttach.park({ issue: "EX-1", root: f.root }, deps);
  } finally { fs.renameSync = orig; }
  const markerWrites = renames.filter(([, b]) => b === f.marker());
  assert.ok(markerWrites.length >= 4, `expected stage (2), confirm and park renames, got ${markerWrites.length}`);
  for (const [a] of markerWrites) assert.equal(dirname(a), dirname(f.marker()));
  assert.deepEqual(readdirSync(dirname(f.marker())).filter((n) => n.endsWith(".tmp")), []);
});

test("smoke: stage, confirm, prepcheck, then faff spec commit records source_check match", () => {
  const f = fixture({ git: true, tracker: "linear" });
  assert.equal(stage(f).json().token, "ready-to-post");
  assert.equal(cli(f.root, ["prep", "attach", "--issue", "EX-1", "--confirm", "--comment-id", "c1", "--root", f.root, "--json"]).json().token, "attached");
  assert.equal(prepcheckState(f), "attached");
  const captured = join(f.root, ".faff", "graft", "EX-1", "captured-spec.md");
  mkdirSync(dirname(captured), { recursive: true });
  writeFileSync(captured, readFileSync(f.specFile));
  const wt = join(dirname(f.root), `${f.root.split("/").pop()}-wt`);
  execFileSync("git", ["-C", f.root, "worktree", "add", "-q", wt, "-b", "feat"]);
  mkdirSync(join(wt, ".faff"), { recursive: true });
  writeFileSync(join(wt, ".faff", "config.yaml"), readFileSync(join(f.root, ".faff", "config.yaml")));
  const r = cli(f.root, ["spec", "commit", "--issue", "EX-1", "--title", "Fixture", "--spec", captured, "--worktree", wt, "--run-dir", join(f.root, "rd"), "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([r.json().token, r.json().source_check], ["committed", "match"]);
});
