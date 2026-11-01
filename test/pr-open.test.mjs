// FAFF-1416 — `faff pr open`: graft Step 9b's PR opening as one command.
//
// Most cases drive the exported runner with injected dependencies and record every call in order,
// so the order guarantees (anchor, commit and push before `pr-create`; a commit failure stops before
// the push) are asserted on the executed sequence. The inputs-equal and holdout-payload cases use the
// real input derivation against a temp repo, the CLI-level cases spawn the real `bin/faff pr open`
// against a temp repo with a local bare remote and a `gh` stub on PATH, and the validate-adapters
// cases cover the re-targeted faff-graft Step 9b lint.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, delimiter } from "node:path";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { runPrOpen, defaultDeps } = require("../plugin/skills/faff/bin/lib/pr-open.js");
const { deriveGrantInputs } = require("../plugin/skills/faff/bin/lib/merge-authorize.js");

const cleanups = [];
after(() => { for (const fn of cleanups) { try { fn(); } catch { /* best-effort */ } } });

// --- In-process harness ----------------------------------------------------------------------------

const ok = (stdout = "") => ({ status: 0, stdout, stderr: "", timedOut: false });
const exit = (status, stderr = "", stdout = "") => ({ status, stdout, stderr, timedOut: false });

function gitName(args) {
  if (args[0] === "rev-parse") return args.includes("--abbrev-ref") ? "branch" : "head";
  if (args[0] === "diff") return "diff-cached";
  return args[0]; // remote, ls-tree, add, commit, push
}
function faffName(args) {
  if (args[0] === "commissaire" && args[1] === "contract") return "status";
  if (args[0] === "commissaire" && args[1] === "effect") return `cc-${args[2]}`;
  if (args[0] === "effects") return `${args[1]}-push`;
  if (args[0] === "events") return "anchor";
  if (args[0] === "evidence") return "evidence-write";
  if (args[0] === "bundle") return "bundle";
  return args[0]; // pr-create
}

// fakeDeps({ resp: { name: Spawned | (args, input) => Spawned }, review, sanitize, check, grant, derive, genesis })
function fakeDeps(o = {}) {
  const calls = [];
  const inputs = {};
  const files = { "draft.md": "Body citing TT-2.\n", ...(o.files || {}) };
  const removed = [];
  const defaults = {
    remote: ok("origin\n"), branch: ok("feat\n"), head: ok("abc123\n"), "ls-tree": ok(""),
    add: ok(), "diff-cached": exit(1), commit: ok(), push: ok(),
    status: ok('{"governed":false,"custody":null}\n'), "evidence-write": ok(), anchor: ok("events anchor: ok\n"),
    "declare-push": ok(), "observe-push": ok(), bundle: ok(), "pr-list": ok("[]"),
    "cc-declare": ok(), "cc-authorize": ok('{"verdict":"grant","verdict_seq":3}\n'), "cc-observe": ok(),
    "pr-create": ok('{"verdict":"opened","opened":true,"pr_url":"https://github.com/o/r/pull/7"}\n'),
  };
  const answer = (name, args, input) => {
    calls.push(name);
    if (input !== undefined && input !== null) inputs[name] = input;
    const r = o.resp && o.resp[name] !== undefined ? o.resp[name] : defaults[name];
    return typeof r === "function" ? r(args, input) : r;
  };
  const deps = {
    git: (args) => answer(gitName(args), args),
    gh: (args) => answer(args[0] === "pr" && args[1] === "list" ? "pr-list" : `gh-${args[1]}`, args),
    faff: (args, input) => answer(faffName(args), args, input),
    readReviewVerdict: () => { calls.push("review"); return o.review ?? "pass"; },
    sanitize: (draft, issue) => { calls.push("sanitize"); if (o.sanitize) return o.sanitize(draft, issue); return `${draft}\nCloses ${issue}\n`; },
    check: (body) => { calls.push("check"); if (o.check) return o.check(body); return { ok: true, violations: [] }; },
    validateAnchorGenesis: () => { calls.push("validate-genesis"); return o.genesis ?? { valid: false, code: "no-events" }; },
    prCreateGrantState: () => { calls.push("grant-state"); return o.grant ?? "valid-grant"; },
    deriveInputs: () => { calls.push("derive"); if (o.derive instanceof Error) throw o.derive; return o.derive ?? { level: "L2", attended: true, holdout: "missing" }; },
    readFile: (f) => (Object.prototype.hasOwnProperty.call(files, f) ? files[f] : null),
    writeTemp: (content) => { calls.push("write-temp"); files["/tmp/safe.md"] = content; return "/tmp/safe.md"; },
    removeFile: (f) => { calls.push("remove-temp"); removed.push(f); delete files[f]; },
  };
  return { deps, calls, inputs, removed, files };
}

const OPTS = { runDir: "/runs/run-1", issue: "TT-1", base: "main", title: "feat: thing", bodyFile: "draft.md", specReviewEvidence: null };
const run = (o = {}, opts = {}) => { const f = fakeDeps(o); return { ...f, r: runPrOpen({ ...OPTS, ...opts }, f.deps) }; };
const governedStatus = ok('{"governed":true,"custody":"in-process"}\n');
const outwardCalls = ["anchor", "commit", "push", "pr-create"];
const noneOf = (calls, names) => names.filter((n) => calls.includes(n));

test("happy path", () => {
  const { r, calls } = run();
  assert.equal(r.token, "opened");
  assert.equal(r.exit, 0);
  assert.equal(r.pr_url, "https://github.com/o/r/pull/7");
  assert.equal(r.pr_number, 7);
  assert.equal(r.anchor_dest, ".faff/anchors/run-1/TT-1/");
  assert.deepEqual(r.tracker_transition, { to: "In Review", governed: false, effect: { kind: "tracker-write", target: "TT-1:In Progress->In Review", reversible: true } });
  const order = ["review", "status", "sanitize", "check", "pr-list", "anchor", "add", "commit", "push", "bundle", "pr-create"];
  assert.deepEqual(calls.filter((c) => order.includes(c)), order);
  assert.deepEqual(noneOf(calls, ["declare-push", "observe-push", "cc-declare", "cc-authorize", "cc-observe", "derive", "grant-state"]), []);
});

test("governed", () => {
  const { r, calls, inputs } = run({ resp: { status: governedStatus } });
  assert.equal(r.token, "opened");
  assert.equal(r.governed, true);
  const at = (n) => calls.indexOf(n);
  assert.ok(at("declare-push") < at("push") && at("push") < at("observe-push"), calls.join(","));
  assert.ok(at("cc-declare") < at("cc-authorize") && at("cc-authorize") < at("pr-create") && at("pr-create") < at("cc-observe"), calls.join(","));
  assert.deepEqual(JSON.parse(inputs["declare-push"]), [{ kind: "push", target: "feat", reversible: true }]);
  assert.deepEqual(JSON.parse(inputs["cc-declare"]), [{ kind: "pr-create", target: "main", reversible: true }]);
  assert.deepEqual(JSON.parse(inputs["cc-authorize"]), { effect: { kind: "pr-create", target: "main" }, level: "L2", attended: true, holdout: "missing" });
});

test("order guarantee", () => {
  // pr-create is never called before the push returned 0: a failed push stops before pr-create.
  for (const resp of [{}, { push: exit(1, "rejected") }, { status: governedStatus }]) {
    const { calls } = run({ resp });
    const create = calls.indexOf("pr-create");
    if (create !== -1) assert.ok(calls.indexOf("push") !== -1 && calls.indexOf("push") < create);
    if (resp.push) assert.equal(create, -1);
    if (create !== -1) assert.ok(calls.indexOf("anchor") < calls.indexOf("commit") && calls.indexOf("commit") < calls.indexOf("push"));
  }
});

test("commit-failure", () => {
  const { r, calls } = run({ resp: { commit: exit(1, "hook rejected") } });
  assert.equal(r.token, "errored");
  assert.equal(r.exit, 2);
  assert.match(r.cause, /commit failure/);
  assert.deepEqual(noneOf(calls, ["push", "pr-create", "bundle"]), []);
  const add = run({ resp: { add: exit(128, "fatal") } });
  assert.equal(add.r.token, "errored");
  assert.deepEqual(noneOf(add.calls, ["commit", "push", "pr-create"]), []);
});

test("nothing-staged", () => {
  const { r, calls } = run({ resp: { "diff-cached": exit(0) } });
  assert.equal(r.token, "opened");
  assert.ok(!calls.includes("commit"));
  assert.ok(calls.includes("push"));
  const broken = run({ resp: { "diff-cached": exit(128, "fatal") } });
  assert.equal(broken.r.token, "errored");
  assert.deepEqual(noneOf(broken.calls, ["commit", "push", "pr-create"]), []);
});

test("review-not-pass", () => {
  for (const signal of ["fail", "needs-human", "unavailable", "missing"]) {
    const { r, calls } = run({ review: signal });
    assert.equal(r.token, "refused", signal);
    assert.equal(r.exit, 1);
    assert.equal(r.cause, "review-not-pass");
    assert.deepEqual(noneOf(calls, ["status", "pr-list", ...outwardCalls]), [], signal);
  }
});

test("body-unsafe", () => {
  const thrown = run({ sanitize: () => { throw new Error("bad target"); } });
  assert.equal(thrown.r.token, "refused");
  assert.equal(thrown.r.cause, "body-unsafe");
  const failed = run({ check: () => ({ ok: false, violations: [{ rule: "sibling-token-present" }] }) });
  assert.equal(failed.r.token, "refused");
  assert.equal(failed.r.cause, "body-unsafe");
  for (const { calls } of [thrown, failed]) assert.deepEqual(noneOf(calls, ["pr-list", "push", ...outwardCalls]), []);
  // The check runs on the bytes read back from the temp file, never on the draft.
  const seen = [];
  run({ check: (body) => { seen.push(body); return { ok: true, violations: [] }; }, sanitize: () => "SAFE\n" });
  assert.deepEqual(seen, ["SAFE\n"]);
});

test("anchor codes: the classifier's two contracts hold on the real modules", () => {
  // validateAnchorGenesis is exported, and a valid-genesis run with a missing floor file makes the real
  // `faff events anchor` print the prefix the classifier keys on.
  const events = require("../plugin/skills/faff/bin/lib/events.js");
  assert.equal(typeof events.validateAnchorGenesis, "function");
  assert.equal(typeof defaultDeps(process.cwd()).validateAnchorGenesis, "function");
  const fx = cliFixture();
  rmSync(join(fx.runDir, CLI_ISSUE, "ac-checklist.json"));
  const r = runCli(["events", "anchor", "--run-dir", fx.runDir, "--issue", CLI_ISSUE, "--dest", join(fx.root, "anchor-out")], { cwd: fx.repo, env: fx.env });
  assert.equal(r.code, 3);
  assert.ok(r.stderr.split("\n").some((l) => l.startsWith("faff events anchor: floor-incomplete")), r.stderr);
});

test("anchor codes", () => {
  const cases = [
    [{ anchor: exit(3, "faff events anchor: no events.jsonl in /runs/run-1 — nothing to anchor\n") }, { valid: false, code: "no-events" }, /^anchor-no-events/],
    [{ anchor: exit(3, "faff events anchor: /runs/run-1 has no valid genesis chain\n") }, { valid: false, code: "genesis-invalid" }, /^anchor-genesis-invalid/],
    [{ anchor: exit(3, "faff events anchor: floor-incomplete — TT-1/ac-checklist.json is required\n") }, { valid: true }, /^anchor-floor-incomplete: .*build-evidence defect/],
    [{ anchor: exit(3, "something unexpected\n") }, { valid: true }, /^anchor-genesis-invalid/],
  ];
  for (const [resp, genesis, cause] of cases) {
    const { r, calls } = run({ resp, genesis });
    assert.equal(r.token, "needs-human");
    assert.equal(r.exit, 3);
    assert.match(r.cause, cause);
    assert.match(r.cause, /\/runs\/run-1/);
    assert.deepEqual(noneOf(calls, ["add", "commit", "push", "pr-create"]), []);
  }
  const other = run({ resp: { anchor: exit(1, "faff events anchor: precondition failed\n") } });
  assert.equal(other.r.token, "errored");
  assert.match(other.r.cause, /anchor CLI error/);
});

test("commissaire-status-failed", () => {
  const cases = [
    [exit(2, "secret stderr text"), /exit 2/],
    [{ status: null, stdout: "", stderr: "", timedOut: true }, /timeout/],
    [ok("not json"), /unparseable output/],
    [ok('{"governed":"yes"}'), /unparseable output/],
    [ok('{"governed":true}\n{"governed":false}\n'), /unparseable output/],
  ];
  for (const [status, cause] of cases) {
    const { r, calls } = run({ resp: { status } });
    assert.equal(r.token, "needs-human");
    assert.equal(r.exit, 3);
    assert.match(r.cause, /^commissaire-status-failed: /);
    assert.match(r.cause, cause);
    assert.doesNotMatch(r.cause, /secret stderr/);
    assert.deepEqual(noneOf(calls, ["sanitize", "pr-list", ...outwardCalls]), []);
  }
});

test("pr-create-denied", () => {
  const cases = [
    { "cc-authorize": ok('{"verdict":"deny","reason":"holdout-not-meets-spec"}\n') },
    { "cc-authorize": exit(2, "boom") },
    { "cc-authorize": ok("garbage\n") },
    { "cc-declare": exit(1, "boom") },
  ];
  for (const extra of cases) {
    const { r, calls } = run({ resp: { status: governedStatus, ...extra } });
    assert.equal(r.token, "needs-human");
    assert.equal(r.exit, 3);
    assert.match(r.cause, /^pr-create-denied/);
    assert.ok(!calls.includes("pr-create"));
    assert.ok(calls.includes("push"), "the anchor is already pushed");
  }
  const noInputs = run({ resp: { status: governedStatus }, derive: new Error("no trusted committed anchor level") });
  assert.equal(noInputs.r.token, "needs-human");
  assert.match(noInputs.r.cause, /^pr-create-denied: grant inputs/);
  assert.ok(!noInputs.calls.includes("cc-authorize"));
});

const existingPr = (headRefOid, baseRefName = "main") => ok(JSON.stringify([{ number: 5, url: "https://github.com/o/r/pull/5", baseRefName, headRefOid }]));

test("already-open anchored", () => {
  const { r, calls } = run({ resp: { "pr-list": existingPr("abc123"), "ls-tree": ok("040000 tree x\t.faff/anchors/run-1/TT-1\n") } });
  assert.equal(r.token, "already-open");
  assert.equal(r.exit, 0);
  assert.equal(r.pr_url, "https://github.com/o/r/pull/5");
  assert.equal(r.pr_number, 5);
  assert.deepEqual(noneOf(calls, ["anchor", "add", "commit", "push", "bundle", "pr-create"]), []);
});

test("already-open ahead", () => {
  const { r, calls } = run({ resp: { "pr-list": existingPr("old999") } });
  assert.equal(r.token, "already-open");
  assert.equal(r.pr_number, 5);
  for (const n of ["anchor", "commit", "push"]) assert.ok(calls.includes(n), n);
  assert.deepEqual(noneOf(calls, ["pr-create", "cc-declare", "cc-authorize"]), []);
  // HEAD at the PR head but carrying no anchor also anchors and pushes.
  const unanchored = run({ resp: { "pr-list": existingPr("abc123"), "ls-tree": ok("") } });
  assert.equal(unanchored.r.token, "already-open");
  assert.ok(unanchored.calls.includes("push"));
});

test("already-open-ungranted", () => {
  const { r, calls } = run({ resp: { status: governedStatus, "pr-list": existingPr("old999") }, grant: "absent-or-invalid" });
  assert.equal(r.token, "needs-human");
  assert.equal(r.exit, 3);
  assert.match(r.cause, /^already-open-ungranted/);
  assert.deepEqual(noneOf(calls, outwardCalls), []);
  const granted = run({ resp: { status: governedStatus, "pr-list": existingPr("old999") }, grant: "valid-grant" });
  assert.equal(granted.r.token, "already-open");
  // An ungoverned run never consults the grant.
  const ungoverned = run({ resp: { "pr-list": existingPr("old999") }, grant: "absent-or-invalid" });
  assert.equal(ungoverned.r.token, "already-open");
  assert.ok(!ungoverned.calls.includes("grant-state"));
});

test("other refusals", () => {
  const otherBase = run({ resp: { "pr-list": existingPr("abc123", "release") } });
  assert.equal(otherBase.r.token, "refused");
  assert.equal(otherBase.r.cause, "open-pr-other-base");
  assert.deepEqual(noneOf(otherBase.calls, outwardCalls), []);

  for (const list of [exit(1, "gh: not logged in"), ok("not json"), ok('{"x":1}')]) {
    const gh = run({ resp: { "pr-list": list } });
    assert.equal(gh.r.token, "errored");
    assert.match(gh.r.cause, /^gh-unavailable/);
    assert.deepEqual(noneOf(gh.calls, outwardCalls), []);
  }

  for (const branch of [ok("main\n"), ok("HEAD\n"), ok("-x\n"), exit(128, "fatal")]) {
    const wrong = run({ resp: { branch } });
    assert.equal(wrong.r.token, "errored");
    assert.match(wrong.r.cause, /^wrong-branch/);
    assert.deepEqual(noneOf(wrong.calls, ["review", ...outwardCalls]), []);
  }
});

// The rule inventory's covering-test cells name these two cases (P3, P21).
test("no-op", () => {
  const noOp = run({ resp: { remote: ok("") } });
  assert.equal(noOp.r.token, "no-op");
  assert.equal(noOp.r.exit, 0);
  assert.deepEqual(noneOf(noOp.calls, ["review", "sanitize", ...outwardCalls]), []);
  // pr-create's own git-only answer maps to no-op too.
  const late = run({ resp: { "pr-create": ok('{"verdict":"no-op","opened":false}\n') } });
  assert.equal(late.r.token, "no-op");
  assert.equal(late.r.exit, 0);
});

test("pr-create-refused", () => {
  const refused = run({ resp: { "pr-create": exit(1, "", '{"verdict":"refuse","opened":false,"blockers":["Commissaire pr-create decision absent or invalid"]}\n') } });
  assert.equal(refused.r.token, "refused");
  assert.equal(refused.r.exit, 1);
  assert.equal(refused.r.cause, "pr-create-refused");
  assert.deepEqual(refused.r.blockers, ["Commissaire pr-create decision absent or invalid"]);
  assert.ok(refused.calls.indexOf("push") < refused.calls.indexOf("pr-create"), "the anchor is already pushed");
  const crashed = run({ resp: { "pr-create": exit(2, "faff pr-create: --title is required") } });
  assert.equal(crashed.r.token, "refused");
  assert.deepEqual(crashed.r.blockers, ["faff pr-create: --title is required"]);
});

test("usage errors", () => {
  for (const key of ["runDir", "issue", "base", "title", "bodyFile"]) {
    const { r, calls } = run({}, { [key]: "" });
    assert.equal(r.token, "errored", key);
    assert.equal(r.exit, 2);
    assert.match(r.cause, /^usage/);
    assert.deepEqual(calls, [], key);
  }
  for (const issue of ["../x", "-flag", "a b"]) {
    const { r } = run({}, { issue });
    assert.equal(r.token, "errored");
    assert.match(r.cause, /not a valid issue id/);
  }
  const unreadable = run({}, { bodyFile: "missing.md" });
  assert.equal(unreadable.r.token, "errored");
  assert.match(unreadable.r.cause, /unreadable input/);
  // The CLI reports each missing required flag the same way.
  for (const drop of ["--run-dir", "--issue", "--base", "--title", "--body-file"]) {
    const args = { "--run-dir": "/r", "--issue": "TT-1", "--base": "main", "--title": "t", "--body-file": "b.md" };
    delete args[drop];
    const r = runCli(["pr", "open", ...Object.entries(args).flat(), "--json"]);
    assert.equal(r.code, 2, drop);
    assert.equal(JSON.parse(r.stdout).token, "errored");
    assert.match(r.stderr, new RegExp(drop));
  }
});

test("best-effort warnings", () => {
  const cases = [
    [{ "evidence-write": exit(1, "digest mismatch") }, /evidence write/],
    [{ bundle: exit(0, "", "bundle publish: store_unavailable\n") }, /bundle publish/],
    [{ bundle: exit(1, "boom") }, /bundle publish/],
    [{ status: governedStatus, "declare-push": exit(1, "x") }, /effects declare/],
    [{ status: governedStatus, "observe-push": exit(1, "x") }, /effects observe/],
    [{ status: governedStatus, "cc-observe": exit(1, "x") }, /commissaire effect observe/],
    [{ anchor: exit(0, "faff events anchor: evidence-schema warn-only: absent TT-1 (1 non-conforming file(s)); not a refusal\n", "events anchor: ok\n") }, /evidence-schema warn-only/],
  ];
  for (const [resp, warning] of cases) {
    const { r } = run({ resp, files: { "evidence.md": "## Spec-review evidence\n" } }, { specReviewEvidence: "evidence.md" });
    assert.equal(r.token, "opened", String(warning));
    assert.ok(r.warnings.some((w) => warning.test(w)), `${warning} in ${JSON.stringify(r.warnings)}`);
  }
  const unreadable = run({}, { specReviewEvidence: "gone.md" });
  assert.equal(unreadable.r.token, "opened");
  assert.ok(unreadable.r.warnings.some((w) => /unreadable/.test(w)));
});

test("temp-file cleanup", () => {
  const paths = [
    {}, { check: () => ({ ok: false, violations: [] }) }, { resp: { "pr-list": exit(1) } },
    { resp: { commit: exit(1) } }, { resp: { push: exit(1) } }, { resp: { anchor: exit(3) } },
    { resp: { "pr-create": exit(1) } }, { resp: { status: governedStatus, "cc-authorize": exit(2) } },
    { resp: { "pr-list": existingPr("old999") } },
  ];
  for (const o of paths) {
    const { calls, removed, files } = run(o);
    assert.ok(calls.includes("write-temp"));
    assert.deepEqual(removed, ["/tmp/safe.md"], JSON.stringify(o));
    assert.ok(!Object.prototype.hasOwnProperty.call(files, "/tmp/safe.md"));
  }
  // A path that never created the file removes nothing.
  assert.deepEqual(run({ review: "fail" }).removed, []);
  // The real temp-file dependency deletes the file it wrote.
  const real = defaultDeps(process.cwd());
  const p = real.writeTemp("x\n");
  assert.equal(readFileSync(p, "utf8"), "x\n");
  real.removeFile(p);
  assert.equal(existsSync(p), false);
});

test("push-failure", () => {
  const { r, calls } = run({ resp: { push: exit(1, "rejected") } });
  assert.equal(r.token, "errored");
  assert.equal(r.exit, 2);
  assert.match(r.cause, /push failure/);
  assert.deepEqual(noneOf(calls, ["bundle", "pr-create", "cc-declare", "observe-push"]), []);
  assert.equal(calls.filter((c) => c === "pr-list").length, 1);
});

test("tracker_transition descriptor", () => {
  const descriptor = { to: "In Review", governed: false, effect: { kind: "tracker-write", target: "TT-1:In Progress->In Review", reversible: true } };
  assert.deepEqual(run().r.tracker_transition, descriptor);
  assert.deepEqual(run({ resp: { "pr-list": existingPr("old999") } }).r.tracker_transition, descriptor);
  assert.equal(run({ resp: { status: governedStatus } }).r.tracker_transition.governed, true);
  const others = [
    run({ review: "fail" }), run({ resp: { remote: ok("") } }), run({ resp: { anchor: exit(3) } }),
    run({ resp: { push: exit(1) } }), run({ resp: { "pr-create": exit(1) } }),
  ];
  for (const { r } of others) assert.equal(r.tracker_transition, undefined, r.token);
});

// --- Real input derivation -------------------------------------------------------------------------

const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
function cleanEnv(extra = {}) {
  const e = { ...process.env };
  delete e.FAFF_RUN_DIR;
  delete e.FAFF_SESSION_ID;
  return { ...e, ...extra };
}
function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

// A temp repo whose feature-branch head carries a committed anchor at `level`.
function anchoredRepo(level, issue = "TT-1") {
  const root = tmp("faff1416-derive-");
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "README"), "x\n");
  git(root, "add", "README");
  git(root, "commit", "-q", "-m", "init");
  const minted = runCli(["run-ledger", "init-interactive", "--issue", issue], { cwd: root, env: cleanEnv() });
  assert.equal(minted.code, 0, minted.stderr);
  const runDir = minted.stdout.trim();
  git(root, "checkout", "-q", "-b", "feature");
  const rel = join(".faff", "anchors", basename(runDir), issue, "run-ledger.json");
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), JSON.stringify({ run_id: basename(runDir), level }));
  git(root, "add", "-f", rel);
  git(root, "commit", "-q", "-m", `anchor ${level}`);
  return { root, runDir, head: git(root, "rev-parse", "HEAD") };
}

// Drive a governed runPrOpen whose input derivation is the real one, and return the authorize payload.
function authorizePayload(fx) {
  const real = defaultDeps(fx.root);
  const f = fakeDeps({ resp: { status: governedStatus, head: ok(`${fx.head}\n`) } });
  f.deps.deriveInputs = real.deriveInputs;
  const r = runPrOpen({ ...OPTS, runDir: fx.runDir }, f.deps);
  assert.equal(r.token, "opened", JSON.stringify(r));
  return JSON.parse(f.inputs["cc-authorize"]);
}

test("inputs-equal", () => {
  const fx = anchoredRepo("L3");
  const payload = authorizePayload(fx);
  const derived = deriveGrantInputs(fx.runDir, "TT-1", { cwd: fx.root, repo: null, headSha: fx.head });
  assert.deepEqual({ level: payload.level, attended: payload.attended, holdout: payload.holdout }, derived);
  assert.equal(payload.level, "L3");
});

test("holdout payload", () => {
  const fx = anchoredRepo("L4");
  assert.equal(authorizePayload(fx).holdout, "missing");
  const dir = join(fx.runDir, "TT-1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "holdout.json"), JSON.stringify({ aggregate: "meets-spec", code_blind: true, criteria: [] }));
  const later = new Date(Date.now() + 3600_000).toISOString();
  writeFileSync(join(dir, "build-progress.json"), JSON.stringify({ updated_at: later, build: { pushed_at: later } }));
  assert.equal(authorizePayload(fx).holdout, "blocked");
});

// --- CLI-level -------------------------------------------------------------------------------------

const GH_STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const cfg = JSON.parse(fs.readFileSync(process.env.STUB_GH_CONFIG, "utf8"));
const args = process.argv.slice(2);
const entry = { args };
if (args[0] === "pr" && args[1] === "create") {
  const i = args.indexOf("--body-file");
  entry.body = i === -1 ? null : fs.readFileSync(args[i + 1], "utf8");
  try { entry.origin_head = execFileSync("git", ["--git-dir", cfg.bare, "rev-parse", "refs/heads/" + cfg.branch], { encoding: "utf8" }).trim(); } catch { entry.origin_head = null; }
}
fs.appendFileSync(cfg.log, JSON.stringify(entry) + "\\n");
if (args[0] === "pr" && args[1] === "list") { process.stdout.write(JSON.stringify(cfg.prList)); process.exit(0); }
if (args[0] === "pr" && args[1] === "create") { process.stdout.write(cfg.prCreateUrl + "\\n"); process.exit(0); }
process.stderr.write("stub gh: unhandled " + args.join(" ") + "\\n");
process.exit(3);
`;

const CLI_ISSUE = "TT-1";

// A feature worktree on branch b with a local bare remote as origin, a minted run dir and a gh stub.
function cliFixture({ review = "pass", remote = true, emptyEvents = false } = {}) {
  const root = tmp("faff1416-cli-");
  const repo = join(root, "repo");
  const bare = join(root, "origin.git");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "user.email", "t@example.com");
  writeFileSync(join(repo, "README"), "seed\n");
  git(repo, "add", "README");
  git(repo, "commit", "-q", "-m", "seed");
  if (remote) {
    git(root, "init", "-q", "--bare", bare);
    git(repo, "remote", "add", "origin", bare);
    git(repo, "push", "-q", "origin", "main");
  }
  git(repo, "checkout", "-q", "-b", "b");
  writeFileSync(join(repo, "work.txt"), "work\n");
  git(repo, "add", "work.txt");
  git(repo, "commit", "-q", "-m", "work");
  if (remote) git(repo, "push", "-q", "origin", "b");
  const minted = runCli(["run-ledger", "init-interactive", "--issue", CLI_ISSUE], { cwd: repo, env: cleanEnv() });
  assert.equal(minted.code, 0, minted.stderr);
  const runDir = minted.stdout.trim();
  const issueDir = join(runDir, CLI_ISSUE);
  mkdirSync(issueDir, { recursive: true });
  writeFileSync(join(issueDir, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
  writeFileSync(join(issueDir, "review-verdict.json"), JSON.stringify({ signal: review, findings: [] }));
  if (emptyEvents) writeFileSync(join(runDir, "events.jsonl"), "");
  const draft = join(root, "draft.md");
  writeFileSync(draft, "Summary of the change.\n\nRelated to TT-2. Implements TT-1.\n");
  const ghDir = join(root, "gh-bin");
  mkdirSync(ghDir);
  writeFileSync(join(ghDir, "gh"), GH_STUB);
  chmodSync(join(ghDir, "gh"), 0o755);
  const log = join(root, "gh.log");
  const cfgFile = join(root, "gh.json");
  const setPrList = (prList) => writeFileSync(cfgFile, JSON.stringify({ log, bare, branch: "b", prList, prCreateUrl: "https://example.invalid/pr/7" }));
  setPrList([]);
  const env = cleanEnv({ PATH: `${ghDir}${delimiter}${process.env.PATH}`, STUB_GH_CONFIG: cfgFile });
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const originHead = () => (remote ? git(root, "--git-dir", bare, "rev-parse", "refs/heads/b") : null);
  const open = () => runCli(["pr", "open", "--run-dir", runDir, "--issue", CLI_ISSUE, "--base", "main", "--title", "T", "--body-file", draft, "--json"], { cwd: repo, env });
  return { root, repo, bare, runDir, draft, env, calls, originHead, open, setPrList };
}
const creates = (fx) => fx.calls().filter((c) => c.args[0] === "pr" && c.args[1] === "create");

test("CLI-level: opens the PR at the pushed, anchor-carrying head with a sanitized body", () => {
  const fx = cliFixture();
  const r = fx.open();
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.token, "opened");
  assert.equal(out.pr_url, "https://example.invalid/pr/7");
  const head = fx.originHead();
  assert.equal(git(fx.repo, "log", "-1", "--format=%s", head), `chore(${CLI_ISSUE}): anchor run evidence`);
  const files = git(fx.repo, "show", "--name-only", "--format=", head).split("\n");
  assert.ok(files.length > 0 && files.every((f) => f.startsWith(`.faff/anchors/${basename(fx.runDir)}/${CLI_ISSUE}/`)), files.join(","));
  const [create] = creates(fx);
  assert.ok(create, "gh pr create was called");
  assert.equal(create.origin_head, head, "origin already pointed at the anchor commit when pr create ran");
  // The body: no bare sibling token, exactly one closing reference to the target.
  assert.doesNotMatch(create.body, /\bTT-2\b/);
  assert.equal((create.body.match(/\bTT-1\b/g) || []).length, 1);
  assert.match(create.body, /Closes TT-1\n$/);
});

test("CLI-level: a fail review verdict refuses before anything outward", () => {
  const fx = cliFixture({ review: "fail" });
  const before = fx.originHead();
  const r = fx.open();
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.token, "refused");
  assert.equal(out.cause, "review-not-pass");
  assert.equal(fx.originHead(), before);
  assert.equal(git(fx.repo, "log", "-1", "--format=%s"), "work");
  assert.equal(creates(fx).length, 0);
});

test("CLI-level: an empty events.jsonl parks as anchor-genesis-invalid and leaves the log untouched", () => {
  const fx = cliFixture({ emptyEvents: true });
  const before = fx.originHead();
  const r = fx.open();
  assert.equal(r.code, 3, r.stderr + r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.token, "needs-human");
  assert.match(out.cause, /^anchor-genesis-invalid/);
  assert.equal(readFileSync(join(fx.runDir, "events.jsonl"), "utf8"), "");
  assert.equal(fx.originHead(), before);
  assert.equal(creates(fx).length, 0);
});

test("CLI-level: a run dir missing its AC checklist parks as anchor-floor-incomplete", () => {
  const fx = cliFixture();
  rmSync(join(fx.runDir, CLI_ISSUE, "ac-checklist.json"));
  const before = fx.originHead();
  const r = fx.open();
  assert.equal(r.code, 3, r.stderr + r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.token, "needs-human");
  assert.match(out.cause, /^anchor-floor-incomplete: .*build-evidence defect/);
  assert.equal(fx.originHead(), before);
  assert.equal(creates(fx).length, 0);
});

test("CLI-level: a re-run on the unchanged tree returns already-open and pushes nothing", () => {
  const fx = cliFixture();
  assert.equal(fx.open().code, 0);
  const head = fx.originHead();
  const commits = git(fx.repo, "rev-list", "--count", "HEAD");
  fx.setPrList([{ number: 7, url: "https://example.invalid/pr/7", baseRefName: "main", headRefOid: git(fx.repo, "rev-parse", "HEAD") }]);
  const r = fx.open();
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.token, "already-open");
  assert.equal(out.pr_url, "https://example.invalid/pr/7");
  assert.equal(out.tracker_transition.to, "In Review");
  assert.equal(git(fx.repo, "rev-list", "--count", "HEAD"), commits);
  assert.equal(fx.originHead(), head);
  assert.equal(creates(fx).length, 1);
});

test("CLI-level: a rejecting pre-commit hook errors with origin unchanged and no PR", () => {
  const fx = cliFixture();
  const hook = join(fx.repo, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o755);
  const before = fx.originHead();
  const r = fx.open();
  assert.equal(r.code, 2, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).token, "errored");
  assert.equal(fx.originHead(), before);
  assert.equal(creates(fx).length, 0);
});

test("CLI-level: a repository with no remote is a no-op and creates no commit", () => {
  const fx = cliFixture({ remote: false });
  const commits = git(fx.repo, "rev-list", "--count", "HEAD");
  const r = fx.open();
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).token, "no-op");
  assert.equal(git(fx.repo, "rev-list", "--count", "HEAD"), commits);
  assert.equal(fx.calls().length, 0);
});

// --- The re-targeted faff-graft Step 9b lint -------------------------------------------------------

const REPO = join(import.meta.dirname, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
function validateGraft(body) {
  const dir = tmp("faff1416-lint-");
  mkdirSync(join(dir, "faff-graft"));
  writeFileSync(join(dir, "faff-graft", "SKILL.md"), body);
  return spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
}
const step9b = (inner) => `# faff-graft fixture\n\n**Step 9b: Open the PR**\n\n${inner}\n\n**Step 10: Merge-confidence gate**\n`;

test("validate-adapters: the real faff-graft Step 9b passes the re-targeted lint", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { encoding: "utf8", cwd: REPO });
  assert.doesNotMatch(r.stdout, /FAIL {2}faff-graft \(Step 9b/);
});

test("validate-adapters: a Step 9b that bypasses faff pr open fails", () => {
  const clean = validateGraft(step9b("Run `faff pr open --run-dir \"$run_dir\" --issue <ISSUE> --base <base> --title <t> --body-file draft.md --json`."));
  assert.doesNotMatch(clean.stdout, /Step 9b/);
  // The shell form the skills use, in a fenced block, counts as the call.
  const fenced = validateGraft(step9b('```bash\n"$faff" pr open --run-dir "$run_dir" --issue <ISSUE> --json\n```'));
  assert.doesNotMatch(fenced.stdout, /Step 9b/);
  for (const call of ["gh pr create --body-file safe.md", "faff pr-create --run-dir d --issue X", "faff pr-body sanitize --target X", "faff events anchor --run-dir d", "git push origin b", '"$faff" pr-create --run-dir d', '"$faff" events anchor --run-dir d']) {
    const r = validateGraft(step9b(`Run \`faff pr open --run-dir d\`, then \`${call}\`.`));
    assert.match(r.stdout, /FAIL {2}faff-graft \(Step 9b PR open\)/, call);
    assert.notEqual(r.status, 0, call);
  }
  // Prose that only names a command outside a code span stays clean.
  const named = validateGraft(step9b("Run `faff pr open --run-dir d`; it calls faff pr-create itself, never gh pr create."));
  assert.doesNotMatch(named.stdout, /Step 9b PR open/);
});

test("validate-adapters: a Step 9b that never invokes faff pr open fails, and a missing section still fails", () => {
  const without = validateGraft(step9b("Open the PR by hand."));
  assert.match(without.stdout, /FAIL {2}faff-graft \(Step 9b PR open\)/);
  // A prose mention with no flags is not the call.
  const mentionOnly = validateGraft(step9b("**In Review transition (after `faff pr open` returns `opened`).** Move the ticket."));
  assert.match(mentionOnly.stdout, /FAIL {2}faff-graft \(Step 9b PR open\)/);
  assert.match(mentionOnly.stdout, /must open the PR with/);
  const missing = validateGraft("# faff-graft fixture\n\n**Step 9x: Open the PR**\n\n**Step 10: Merge-confidence gate**\n");
  assert.match(missing.stdout, /FAIL {2}faff-graft \(Step 9b PR open\)/);
  assert.match(missing.stdout, /bounded Step 9b section/);
  // Another skill with no Step 9b section raises nothing.
  const dir = tmp("faff1416-lint-other-");
  mkdirSync(join(dir, "faff-other"));
  writeFileSync(join(dir, "faff-other", "SKILL.md"), "# other\n\nNo PR here.\n");
  const other = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  assert.doesNotMatch(other.stdout, /Step 9b/);
});
