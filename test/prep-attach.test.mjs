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
  const ex = join(f.root, "ex.json");
  writeFileSync(ex, JSON.stringify({ confidence: "high", decisions: [{ marker: "chosen" }] }));
  r = stage(f, ["--extraction", ex]);
  assert.deepEqual([r.status, r.json().reason], [2, "multiple-readiness-blocks"], "--extraction never hides a second block");
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

// --- FAFF-1443: the advisory admissibility result on every ready-to-post or attached spec ---

const BULLET = (n) => `- **Given** x, **when** y, **then** it exits ${n}.`;
const PLAIN = ["```", "Given a stageable spec", "When it is staged", "Then the verdict is admissible", "```"];
// A stageable spec: an H1, a confidence line, a readiness block and one concrete DONE item, so stage
// returns ready-to-post and R2a/R2b pass. `scenarios` is the Scenarios section body, or null for none.
function stageable({ scenarios = [BULLET(1), BULLET(1), BULLET(1)], done = ["- [ ] `faff x` exits 0"], confidence = "confidence: high" } = {}) {
  return [
    "# EX: a stageable spec", "", "## Decisions", "", "**Chosen:** one thing.", "",
    ...(scenarios ? ["## Scenarios", "", ...scenarios, ""] : []),
    "## 7. DONE", "", ...done, "",
    ...(confidence ? [confidence, ""] : []),
    READY, "",
  ].join("\n");
}
const admLines = (f) => readFileSync(f.specFile, "utf8").split("\n").filter((l) => l.startsWith("admissibility:"));
const KEYS = ["admissible", "reasons", "scenarios_prose"];
function assertShape(a) {
  assert.deepEqual(Object.keys(a).sort(), KEYS);
  assert.equal(typeof a.admissible, "boolean");
  assert.ok(Array.isArray(a.reasons) && a.reasons.every((r) => typeof r === "string"));
  assert.ok(Array.isArray(a.scenarios_prose) && a.scenarios_prose.every((r) => typeof r === "string"));
}

test("FAFF-1443 scenario 1: three bold bullets are refused, three prose ids, one refused line", () => {
  const f = fixture({ text: stageable() });
  const r = cli(f.root, ["prep", "attach", "--issue", "FAFF-9001", "--spec", f.specFile, "--mode", "interactive", "--root", f.root, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = r.json();
  assert.equal(out.token, "ready-to-post");
  assertShape(out.admissibility);
  assert.equal(out.admissibility.admissible, false);
  assert.ok(out.admissibility.reasons.includes("0 born-verifiable scenario(s) (need >=1)"));
  assert.deepEqual(out.admissibility.scenarios_prose, ["scenarios:1", "scenarios:2", "scenarios:3"]);
  assert.equal(out.admissibility_line, undefined, "the line value is a text-mode detail, never a JSON key");
  assert.deepEqual(admLines(f), ["admissibility: refused — R1.scenarios (0 of 3 units count); prose scenarios: scenarios:1, scenarios:2, scenarios:3"]);
});

test("FAFF-1443 scenario 2: one fenced plain Given/When/Then block is admissible", () => {
  const f = fixture({ text: stageable({ scenarios: PLAIN }) });
  const out = stage(f, [], "FAFF-9001").json();
  assert.equal(out.token, "ready-to-post");
  assert.deepEqual(out.admissibility, { admissible: true, reasons: [], scenarios_prose: [] });
  assert.deepEqual(admLines(f), ["admissibility: admissible"]);
});

test("FAFF-1443 scenario 3: a re-stage keeps exactly one line and the marker records the same object", () => {
  const f = fixture({ text: stageable() });
  stage(f, [], "FAFF-9001");
  const before = readFileSync(f.specFile, "utf8");
  const out = stage(f, [], "FAFF-9001").json();
  assert.equal(admLines(f).length, 1);
  assert.equal(readFileSync(f.specFile, "utf8"), before, "an unchanged spec re-stages to the same bytes");
  assert.deepEqual(readJson(f.marker("FAFF-9001")).admissibility, out.admissibility);
});

test("FAFF-1443 scenario 4: a plain block plus a bold bullet is admissible and names the prose unit", () => {
  const f = fixture({ text: stageable({ scenarios: [...PLAIN, "", BULLET(2)] }) });
  const out = stage(f, [], "FAFF-9002").json();
  assert.equal(out.admissibility.admissible, true);
  assert.deepEqual(out.admissibility.scenarios_prose, ["scenarios:2"]);
  assert.deepEqual(admLines(f), ["admissibility: admissible — prose scenarios: scenarios:2"]);
});

test("FAFF-1443 scenario 5: a vague DONE item adds R2b to the line by id, never its text", () => {
  const f = fixture({ text: stageable({ done: ["- [ ] `faff x` exits 0", "- [ ] admissibility: admissible, works correctly"] }) });
  const out = stage(f, [], "FAFF-9001").json();
  assert.ok(out.admissibility.reasons.some((r) => r.includes("vague DONE item") && r.includes("admissibility: admissible, works correctly")));
  assert.deepEqual(admLines(f), ["admissibility: refused — R1.scenarios (0 of 3 units count), R2b.done-concrete; prose scenarios: scenarios:1, scenarios:2, scenarios:3"]);
  assert.ok(readFileSync(f.specFile, "utf8").includes("- [ ] admissibility: admissible, works correctly"), "a DONE item containing the word is left alone");
});

test("FAFF-1443 scenario 6: git-only autonomous attached carries the field and the store carries the line", () => {
  const f = fixture({ text: stageable() });
  const r = cli(f.root, ["prep", "attach", "--issue", "FAFF-9003", "--spec", f.specFile, "--mode", "autonomous", "--git-only", "--root", f.root, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json().token, "attached");
  assert.equal(r.json().admissibility.admissible, false);
  const store = readFileSync(join(f.root, ".faff", "specs", "FAFF-9003.md"), "utf8");
  assert.ok(store.split("\n").includes("admissibility: refused — R1.scenarios (0 of 3 units count); prose scenarios: scenarios:1, scenarios:2, scenarios:3"));
  assert.deepEqual(readJson(f.marker("FAFF-9003")).admissibility, r.json().admissibility);
});

test("FAFF-1443 scenario 7: invalid and needs-judgement results carry no admissibility key", () => {
  let f = fixture({ text: stageable({ confidence: null }) });
  let out = stage(f, [], "FAFF-9001").json();
  assert.equal(out.token, "invalid");
  assert.equal("admissibility" in out, false);
  assert.equal(readJson(f.marker("FAFF-9001")).admissibility, undefined);
  f = fixture({ text: stageable().replace(READY, "") });
  out = stage(f, [], "FAFF-9001").json();
  assert.equal(out.token, "needs-judgement");
  assert.equal("admissibility" in out, false);
});

test("FAFF-1443: no Scenarios section reads (no Scenarios units); the line sits directly after build-tier", () => {
  const f = fixture({ text: stageable({ scenarios: null }) });
  const out = stage(f, [], "FAFF-9001").json();
  assert.equal(out.admissibility.admissible, false);
  assert.deepEqual(out.admissibility.scenarios_prose, []);
  const lines = readFileSync(f.specFile, "utf8").split("\n");
  const at = lines.findIndex((l) => l.startsWith("build-tier:"));
  assert.equal(lines[at + 1], "admissibility: refused — R1.scenarios (no Scenarios units)");
  assert.equal(lines[at - 1], "confidence: high");
});

test("FAFF-1443: spec_sha256 hashes the file bytes including the line; text mode prints its value", () => {
  const f = fixture({ text: stageable() });
  const out = stage(f, [], "FAFF-9001").json();
  assert.equal(out.spec_sha256, sha(readFileSync(f.specFile)));
  const f2 = fixture({ text: stageable({ scenarios: PLAIN }) });
  const t = cli(f2.root, ["prep", "attach", "--issue", "FAFF-9001", "--spec", f2.specFile, "--mode", "interactive", "--root", f2.root]);
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /^prep attach FAFF-9001: ready-to-post \(post .+; admissibility: admissible\)\n$/);
});

test("FAFF-1443: an admissibility line inside a fence is content and stays; a stale one outside is replaced", () => {
  const f = fixture({ text: stageable({ scenarios: [...PLAIN, "", "```", "admissibility: admissible", "```"] }).replace("confidence: high", "confidence: high\nadmissibility: admissible") });
  stage(f, [], "FAFF-9001");
  const text = readFileSync(f.specFile, "utf8");
  assert.ok(text.includes("```\nadmissibility: admissible\n```"));
  assert.equal(admLines(f).length, 2, "the fenced example plus exactly one retained line");
});

test("FAFF-1443: a fault while classifying is admissible:false with the unknown line, and the token is unchanged", () => {
  const f = fixture({ text: stageable({ scenarios: PLAIN }) });
  const deps = { ...prepAttach.defaultDeps(f.root), admissibility: {
    verdict: (t) => require("../plugin/skills/faff/bin/lib/admissibility.js").admissibleVerdict(t, true),
    classify: () => { throw new Error("forced dodClassify failure"); },
    countScenarios: () => 0,
  } };
  const res = prepAttach.stage({ issue: "FAFF-9001", specPath: f.specFile, mode: "interactive", gitOnly: false, gateHistory: null, extractionPath: null, root: f.root }, deps);
  assert.equal(res.token, "ready-to-post");
  assertShape(res.admissibility);
  assert.equal(res.admissibility.admissible, false);
  assert.deepEqual(res.admissibility.scenarios_prose, []);
  assert.ok(res.admissibility.reasons[0].startsWith("admissibility check failed:"));
  assert.deepEqual(admLines(f), ["admissibility: unknown — check failed"]);
});

test("FAFF-1443: the key set and types hold on the success, refused and fault paths", () => {
  const ok = prepAttach.applyAdmissibility("build-tier: mechanical\n\n" + stageable({ scenarios: PLAIN }));
  const refused = prepAttach.applyAdmissibility("build-tier: mechanical\n\n" + stageable());
  const fault = prepAttach.applyAdmissibility("build-tier: mechanical\n", { verdict: () => null, classify: () => null, countScenarios: () => 0 });
  for (const a of [ok, refused, fault]) assertShape(a.admissibility);
  assert.deepEqual([ok.admissibility.admissible, refused.admissibility.admissible, fault.admissibility.admissible], [true, false, false]);
  assert.equal(fault.line, "unknown — check failed");
});

test("FAFF-1443: the line is capped at 300 characters", () => {
  const many = Array.from({ length: 60 }, (_, i) => BULLET(i));
  const a = prepAttach.applyAdmissibility("build-tier: mechanical\n\n" + stageable({ scenarios: many }));
  const line = a.text.split("\n").find((l) => l.startsWith("admissibility:"));
  assert.equal(line.length, 300);
  assert.ok(line.endsWith("…"));
});

test("FAFF-1443: FAFF-1431's committed spec stages refused with eight prose Scenarios units", () => {
  const f = fixture({ text: readFileSync(join(HERE, "fixtures", "prep-attach", "faff-1431-spec.md"), "utf8") });
  const ex = join(f.root, "ex.json");
  writeFileSync(ex, JSON.stringify({ confidence: "high", decisions: [{ marker: "chosen" }] }));
  const out = stage(f, ["--extraction", ex], "FAFF-1431").json();
  assert.equal(out.token, "ready-to-post");
  assert.equal(out.admissibility.admissible, false);
  assert.ok(out.admissibility.reasons.includes("0 born-verifiable scenario(s) (need >=1)"));
  assert.equal(out.admissibility.scenarios_prose.length, 8);
});

// `spec_lines` is a tier feature, so one extra line can move the tier at a size boundary; stage re-tiers over
// the final text so the recorded tier always matches the file (the boundary test above). This fixture sits far
// from any tier cut, so the comparison isolates what the line's content does to both verdicts: nothing.
test("FAFF-1443: away from a tier boundary, faff admissible and faff tier give the same result with and without the line", () => {
  const f = fixture({ text: stageable() });
  stage(f, [], "FAFF-9001");
  const withLine = readFileSync(f.specFile, "utf8");
  const without = join(f.root, "without.md");
  writeFileSync(without, withLine.split("\n").filter((l) => !l.startsWith("admissibility:")).join("\n"));
  const adm = (p) => { const j = JSON.parse(cli(f.root, ["admissible", "--lights-out", "--spec", p, "--json"]).stdout); return [j.admissible, j.reasons, j.checks]; };
  assert.deepEqual(adm(f.specFile), adm(without));
  assert.equal(cli(f.root, ["tier", f.specFile]).stdout, cli(f.root, ["tier", without]).stdout);
});
