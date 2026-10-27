// FAFF-1404 — `faff spec commit` and `faff spec verify`. Drives the pure core with fake deps for the
// git-failure ordering, then runs the real CLI against a mkdtempSync fixture repo and worktree: the
// builder view lands byte for byte as a one-path commit, a later rewrite (committed or not) makes
// verify fail, and bad input is refused before anything is written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const { runSpecCommit, runSpecVerify } = require("../plugin/skills/faff/bin/lib/spec-commit.js");

const TOKENS = ["committed", "already-committed", "needs-judgement", "verified", "mismatch", "errored"];
const sha = (b) => createHash("sha256").update(b).digest("hex");
const today = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

const SPEC = [
  "# EX: a fixture spec", "", "## Scenarios", "",
  "```", "Given a visible scenario", "When it runs", "Then it passes", "```", "",
  "```holdout", "Given a withheld scenario", "When it runs", "Then it passes", "```", "",
  "## 7. DONE", "", "- [ ] first item must hold", "- [ ] second item must hold", "",
].join("\n");

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

// A fixture repo with docs/, a .faff/config.yaml and a linked worktree. `config` is the config.yaml text.
function fixture({ config = "tracking:\n  tracker: none\n", spec = SPEC } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-spec-commit-"));
  const main = join(root, "main");
  mkdirSync(main);
  git(main, "init", "-q");
  git(main, "config", "user.email", "t@example.com");
  git(main, "config", "user.name", "T");
  mkdirSync(join(main, "docs"));
  mkdirSync(join(main, ".faff"));
  writeFileSync(join(main, ".faff", "config.yaml"), config);
  writeFileSync(join(main, ".faff", ".gitignore"), "*\n!.gitignore\n");
  writeFileSync(join(main, "docs", "a.txt"), "hi\n");
  git(main, "add", "-A");
  git(main, "commit", "-qm", "init");
  const wt = join(root, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "feat");
  mkdirSync(join(wt, ".faff"), { recursive: true });
  writeFileSync(join(wt, ".faff", "config.yaml"), config);
  const specFile = join(root, "s.md");
  writeFileSync(specFile, spec);
  return { root, main, wt, rd: join(root, "rd"), specFile };
}

function cli(args) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}
const commit = (f, over = {}) => cli(["spec", "commit", "--issue", over.issue || "EX-3", "--title", over.title || "Add a thing", "--spec", f.specFile, "--worktree", f.wt, "--run-dir", f.rd, ...(over.extra || []), "--json"]);
const verify = (f, over = {}) => cli(["spec", "verify", "--issue", over.issue || "EX-3", "--spec", f.specFile, "--worktree", f.wt, ...(over.noRunDir ? [] : ["--run-dir", f.rd]), "--json"]);
const specPath = (issue = "EX-3", slug = "add-a-thing") => `docs/specs/${today()}-${issue}-${slug}-design.md`;
const builderView = (f) => execFileSync("node", [CLI, "dod", "split", "--spec", f.specFile, "--view", "builder"]);

test("commit writes the builder view byte for byte as a one-path commit and records it", () => {
  const f = fixture();
  const r = commit(f);
  assert.equal(r.status, 0);
  const res = r.json();
  assert.equal(res.token, "committed");
  assert.equal(res.path, specPath());
  assert.deepEqual(git(f.wt, "show", "--name-only", "--format=", "HEAD").trim().split("\n"), [res.path]);
  const written = readFileSync(join(f.wt, res.path));
  assert.ok(written.equals(builderView(f)));
  assert.ok(!written.toString().includes("withheld scenario"));
  const rec = JSON.parse(readFileSync(join(f.rd, "EX-3", "spec-commit.json"), "utf8"));
  assert.deepEqual(Object.keys(rec).sort(), ["commit", "committed_sha256", "faff_version", "holdouts_withheld", "issue", "path", "source_check", "source_sha256"]);
  assert.equal(rec.path, res.path);
  assert.equal(rec.commit, git(f.wt, "rev-parse", "HEAD").trim());
  assert.equal(rec.committed_sha256, sha(written));
  assert.equal(rec.source_sha256, sha(readFileSync(f.specFile)));
  assert.equal(rec.holdouts_withheld, 1);
  assert.equal(rec.source_check, "no-marker");
  assert.match(rec.faff_version, /^\d+\.\d+\.\d+|^unknown$/);
});

test("a spec with nothing to withhold is committed with its trailing newlines intact", () => {
  for (const tail of ["", "\n", "\n\n\n"]) {
    const f = fixture({ spec: `# plain\n\nbody${tail}` });
    const res = commit(f).json();
    assert.equal(res.token, "committed");
    assert.ok(readFileSync(join(f.wt, res.path)).equals(readFileSync(f.specFile)), JSON.stringify(tail));
  }
});

test("the same commit again is already-committed and changes nothing", () => {
  const f = fixture();
  const first = commit(f).json();
  const head = git(f.wt, "rev-parse", "HEAD");
  const recBefore = readFileSync(join(f.rd, "EX-3", "spec-commit.json"), "utf8");
  const second = commit(f);
  assert.equal(second.status, 0);
  assert.equal(second.json().token, "already-committed");
  assert.equal(second.json().path, first.path);
  assert.equal(git(f.wt, "rev-parse", "HEAD"), head);
  assert.equal(readFileSync(join(f.rd, "EX-3", "spec-commit.json"), "utf8"), recBefore);
});

test("already-committed rewrites a missing record", () => {
  const f = fixture();
  const first = commit(f).json();
  const other = join(f.root, "rd2");
  const r = cli(["spec", "commit", "--issue", "EX-3", "--title", "Add a thing", "--spec", f.specFile, "--worktree", f.wt, "--run-dir", other, "--json"]);
  assert.equal(r.json().token, "already-committed");
  const rec = JSON.parse(readFileSync(join(other, "EX-3", "spec-commit.json"), "utf8"));
  assert.equal(rec.path, first.path);
  assert.equal(rec.committed_sha256, sha(readFileSync(join(f.wt, first.path))));
});

test("verify passes after commit, then fails on a committed rewrite and an uncommitted one", () => {
  const f = fixture();
  const res = commit(f).json();
  const ok = verify(f);
  assert.equal(ok.status, 0);
  assert.equal(ok.json().token, "verified");
  assert.equal(ok.json().path, res.path);

  const file = join(f.wt, res.path);
  writeFileSync(file, readFileSync(file, "utf8").replace("- [ ] second item must hold\n", ""));
  const dirty = verify(f);
  assert.equal(dirty.status, 1);
  assert.deepEqual(dirty.json().differs, ["working-tree"]);

  git(f.wt, "commit", "-qam", "shorten the spec");
  const committed = verify(f);
  assert.equal(committed.status, 1);
  assert.equal(committed.json().token, "mismatch");
  assert.ok(committed.json().differs.includes("head"));

  writeFileSync(file, builderView(f));
  const restored = verify(f);
  assert.equal(restored.status, 1);
  assert.deepEqual(restored.json().differs, ["head"]);
});

test("verify finds the committed spec by filename when the run directory holds no record", () => {
  const f = fixture();
  const res = commit(f).json();
  const r = verify(f, { noRunDir: true });
  assert.equal(r.status, 0);
  assert.equal(r.json().path, res.path);
  const none = verify(fixture(), { noRunDir: true });
  assert.equal(none.status, 2);
  assert.equal(none.json().token, "errored");
  assert.equal(none.json().reason, "no-committed-spec");
});

test("verify with two committed specs and no record is errored and lists both", () => {
  const f = fixture();
  mkdirSync(join(f.wt, "docs", "specs"), { recursive: true });
  writeFileSync(join(f.wt, "docs", "specs", "2026-10-01-EX-3-a-design.md"), builderView(f));
  writeFileSync(join(f.wt, "docs", "specs", "2026-10-02-EX-3-b-design.md"), builderView(f));
  git(f.wt, "add", "-A");
  git(f.wt, "commit", "-qm", "two specs");
  const r = verify(f, { noRunDir: true });
  assert.equal(r.status, 2);
  assert.equal(r.json().reason, "ambiguous-committed-spec");
  assert.equal(r.json().paths.length, 2);
});

test("already-committed names the commit that added the spec, not the branch tip", () => {
  const f = fixture();
  const first = commit(f).json();
  writeFileSync(join(f.wt, "docs", "later.txt"), "later\n");
  git(f.wt, "add", "-A");
  git(f.wt, "commit", "-qm", "later work");
  const again = commit(f).json();
  assert.equal(again.token, "already-committed");
  assert.equal(again.commit, first.commit);
});

test("a spec that is not valid UTF-8 is refused when withholding would alter its bytes", () => {
  const f = fixture();
  writeFileSync(f.specFile, Buffer.concat([Buffer.from(SPEC), Buffer.from([0xff, 0xfe, 0x0a])]));
  const r = commit(f);
  assert.equal(r.status, 2);
  assert.equal(r.json().reason, "builder-split-failed");
  assert.ok(!existsSync(join(f.wt, "docs", "specs")));
  const plain = fixture({ spec: "# plain\n" });
  writeFileSync(plain.specFile, Buffer.from([0x23, 0x20, 0xff, 0x0a]));
  const ok = commit(plain).json();
  assert.equal(ok.token, "committed");
  assert.ok(readFileSync(join(plain.wt, ok.path)).equals(readFileSync(plain.specFile)));
});

test("verify refuses a record whose path leaves the spec directory", () => {
  const f = fixture();
  commit(f);
  writeFileSync(join(f.root, "outside.md"), builderView(f));
  for (const bad of ["../../../outside.md", join(f.root, "outside.md"), "docs/a.txt"]) {
    writeFileSync(join(f.rd, "EX-3", "spec-commit.json"), JSON.stringify({ path: bad }));
    const r = verify(f);
    assert.equal(r.status, 2, bad);
    assert.equal(r.json().reason, "path-outside-spec-dir", bad);
  }
});

test("a differing committed spec for the issue is needs-judgement and nothing is written", () => {
  const f = fixture();
  mkdirSync(join(f.wt, "docs", "specs"), { recursive: true });
  writeFileSync(join(f.wt, "docs", "specs", "2026-10-01-EX-3-old-design.md"), "a shortened rewrite\n");
  git(f.wt, "add", "-A");
  git(f.wt, "commit", "-qm", "old spec");
  const head = git(f.wt, "rev-parse", "HEAD");
  const r = commit(f);
  assert.equal(r.status, 0);
  assert.equal(r.json().token, "needs-judgement");
  assert.equal(r.json().reason, "committed-spec-differs");
  assert.equal(git(f.wt, "rev-parse", "HEAD"), head);
  assert.deepEqual(readdirSync(join(f.wt, "docs", "specs")), ["2026-10-01-EX-3-old-design.md"]);
  assert.ok(!existsSync(f.rd));
});

test("one identical committed file does not hide a divergent one", () => {
  const f = fixture();
  mkdirSync(join(f.wt, "docs", "specs"), { recursive: true });
  writeFileSync(join(f.wt, "docs", "specs", "2026-10-01-ex-3-same-design.md"), builderView(f));
  writeFileSync(join(f.wt, "docs", "specs", "2026-10-02-EX-3-other-design.md"), "different\n");
  git(f.wt, "add", "-A");
  git(f.wt, "commit", "-qm", "two specs");
  const res = commit(f).json();
  assert.equal(res.token, "needs-judgement");
  assert.equal(res.reason, "committed-spec-differs");
  assert.equal(res.path, "docs/specs/2026-10-02-EX-3-other-design.md");
  assert.equal(res.paths.length, 2);
});

test("a committed spec for another issue whose slug names this id is not a match", () => {
  const f = fixture();
  mkdirSync(join(f.wt, "docs", "specs"), { recursive: true });
  writeFileSync(join(f.wt, "docs", "specs", "2026-10-20-FAFF-9-fix-ex-3-flake-design.md"), "unrelated\n");
  git(f.wt, "add", "-A");
  git(f.wt, "commit", "-qm", "other spec");
  assert.equal(commit(f).json().token, "committed");
});

test("an untracked file at the target path is kept if it differs and committed if it is identical", () => {
  const f = fixture();
  const target = join(f.wt, specPath());
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, "a lane's draft\n");
  const head = git(f.wt, "rev-parse", "HEAD");
  const res = commit(f).json();
  assert.equal(res.token, "needs-judgement");
  assert.equal(res.reason, "uncommitted-file-at-path");
  assert.equal(res.path, specPath());
  assert.equal(readFileSync(target, "utf8"), "a lane's draft\n");
  assert.equal(git(f.wt, "rev-parse", "HEAD"), head);

  writeFileSync(target, builderView(f));
  assert.equal(commit(f).json().token, "committed");
  assert.deepEqual(git(f.wt, "show", "--name-only", "--format=", "HEAD").trim().split("\n"), [specPath()]);
});

test("a failed git commit leaves no new file, nothing staged, and keeps a file that already existed", () => {
  const f = fixture();
  const hook = join(f.main, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  const r = commit(f);
  assert.equal(r.status, 2);
  assert.equal(r.json().token, "errored");
  assert.match(r.json().reason, /^git-commit-failed \(exit 1\)/);
  assert.ok(!existsSync(join(f.wt, specPath())));
  assert.equal(git(f.wt, "status", "--porcelain", "--untracked-files=all", "--", "docs").trim(), "");
  assert.ok(!existsSync(join(f.rd, "EX-3", "spec-commit.json")));

  const target = join(f.wt, specPath());
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, builderView(f));
  assert.equal(commit(f).status, 2);
  assert.ok(readFileSync(target).equals(builderView(f)));
});

test("a bad --issue exits 2 and writes nothing", () => {
  const f = fixture();
  for (const issue of ["../x-1", "EX-*", "EX-3\nEX-4", "EX", "-1", "a/b-2"]) {
    const r = cli(["spec", "commit", "--issue", issue, "--title", "t", "--spec", f.specFile, "--worktree", f.wt, "--run-dir", f.rd]);
    assert.equal(r.status, 2, issue);
  }
  assert.ok(!existsSync(f.rd));
  assert.ok(!existsSync(join(f.wt, "docs", "specs")));
  assert.equal(git(f.wt, "log", "--oneline").trim().split("\n").length, 1);
});

test("a multi-line title gives a one-line subject and no extra message lines", () => {
  const f = fixture();
  const r = commit(f, { title: "Add a thing\n\nSigned-off-by: Eve <e@example.com>\r\nmore" });
  assert.equal(r.json().token, "committed");
  const message = git(f.wt, "log", "-1", "--format=%B").trim();
  assert.ok(!message.includes("\n"));
  assert.equal(message, "docs(EX-3): add spec for Add a thing Signed-off-by: Eve <e@example.com> more");
  assert.match(r.json().path, /-EX-3-add-a-thing-signed-off-by-eve-e-example-com-more-design\.md$/);
  const empty = cli(["spec", "commit", "--issue", "EX-3", "--title", " \n\t ", "--spec", f.specFile, "--worktree", f.wt, "--run-dir", f.rd]);
  assert.equal(empty.status, 2);
});

test("the subject follows the resolved commit_subject scheme", () => {
  const conventional = fixture();
  commit(conventional);
  assert.equal(git(conventional.wt, "log", "-1", "--format=%s").trim(), "docs(EX-3): add spec for Add a thing");
  const bare = fixture({ config: "tracking:\n  tracker: none\nconventions:\n  commit_subject: bare-imperative\n" });
  commit(bare);
  assert.equal(git(bare.wt, "log", "-1", "--format=%s").trim(), "Add spec for Add a thing (EX-3)");
});

test("the issue id keeps its case in the filename", () => {
  const f = fixture();
  assert.equal(commit(f, { issue: "ex-3" }).json().path, specPath("ex-3"));
  const g = fixture();
  assert.equal(commit(g, { issue: "EX-3" }).json().path, specPath("EX-3"));
});

test("source_check reads the prep marker's spec_sha256 and never changes the token", () => {
  const cases = [
    [JSON.stringify({ spec_sha256: "PLACEHOLDER" }), "match"],
    [JSON.stringify({ spec_sha256: "0".repeat(64) }), "mismatch"],
    [JSON.stringify({ other: 1 }), "no-marker"],
    ["not json", "no-marker"],
  ];
  for (const [body, want] of cases) {
    const f = fixture();
    mkdirSync(join(f.main, ".faff", "prep"), { recursive: true });
    writeFileSync(join(f.main, ".faff", "prep", "EX-3.json"), body.replace("PLACEHOLDER", sha(readFileSync(f.specFile))));
    const r = commit(f);
    assert.equal(r.json().token, "committed");
    assert.equal(r.json().source_check, want);
    assert.equal(JSON.parse(readFileSync(join(f.rd, "EX-3", "spec-commit.json"), "utf8")).source_check, want);
  }
  const f = fixture();
  const elsewhere = join(f.root, "prep-root");
  mkdirSync(join(elsewhere, ".faff", "prep"), { recursive: true });
  writeFileSync(join(elsewhere, ".faff", "prep", "EX-3.json"), JSON.stringify({ spec_sha256: sha(readFileSync(f.specFile)) }));
  assert.equal(commit(f, { extra: ["--prep-root", elsewhere] }).json().source_check, "match");
});

test("bad usage exits 2", () => {
  const f = fixture();
  const base = ["--issue", "EX-3", "--title", "t", "--spec", f.specFile, "--worktree", f.wt, "--run-dir", f.rd];
  assert.equal(cli(["spec"]).status, 2);
  assert.equal(cli(["spec", "frobnicate"]).status, 2);
  assert.equal(cli(["spec", "commit", ...base, "--bogus"]).status, 2);
  for (const drop of ["--issue", "--title", "--spec", "--worktree", "--run-dir"]) {
    const i = base.indexOf(drop);
    assert.equal(cli(["spec", "commit", ...base.slice(0, i), ...base.slice(i + 2)]).status, 2, drop);
  }
  assert.equal(cli(["spec", "verify", "--issue", "EX-3", "--spec", f.specFile]).status, 2);
  assert.equal(cli(["spec", "verify", "--issue", "../x-1", "--spec", f.specFile, "--worktree", f.wt]).status, 2);
  assert.equal(cli(["spec", "verify", "--issue", "EX-3", "--spec", f.specFile, "--worktree", f.wt, "--bogus"]).status, 2);
});

test("an unreadable spec is errored and nothing is written", () => {
  const f = fixture();
  const r = cli(["spec", "commit", "--issue", "EX-3", "--title", "t", "--spec", join(f.root, "missing.md"), "--worktree", f.wt, "--run-dir", f.rd, "--json"]);
  assert.equal(r.status, 2);
  assert.equal(r.json().token, "errored");
  assert.ok(!existsSync(join(f.wt, "docs", "specs")));
});

test("every --json result carries a token from the closed set", () => {
  const f = fixture();
  for (const r of [commit(f), commit(f), verify(f), verify(f, { issue: "EX-9", noRunDir: true })]) {
    const res = r.json();
    assert.ok(TOKENS.includes(res.token), res.token);
    assert.equal(typeof res.issue, "string");
  }
});

test("faff spec --selftest passes", () => {
  const r = cli(["spec", "--selftest"]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /RESULT ok spec selftest/);
});

// The pure core, with the git calls scripted: the order of cleanup after a failed commit.
test("pure core: a failed commit unstages and removes only the file it created", () => {
  const files = new Map();
  const calls = [];
  const deps = {
    git: (_w, a) => { calls.push(a[0]); return a[0] === "commit" ? { status: 3, stdout: Buffer.alloc(0), stderr: "boom\n" } : { status: 0, stdout: Buffer.alloc(0), stderr: "" }; },
    readBytes: (p) => { if (p === "s.md") return Buffer.from("# s\n"); const b = files.get(p); if (!b) throw Object.assign(new Error("x"), { code: "ENOENT" }); return b; },
    exists: (p) => files.has(p), mkdirp: () => {}, writeBytes: (p, b) => files.set(p, b), unlink: (p) => files.delete(p),
    isInside: () => true, realpath: (p) => resolve(p), specDir: () => "docs/specs", commitScheme: () => "conventional",
    today: () => "2026-10-27", version: () => "0.0.0", prepRoot: () => "root", readJson: () => null, writeJson: () => { throw new Error("no record on failure"); },
  };
  const r = runSpecCommit({ issue: "EX-3", title: "t", specPath: "s.md", worktree: "wt", runDir: "rd" }, deps);
  assert.equal(r.token, "errored");
  assert.match(r.reason, /\(exit 3\): boom/);
  assert.equal(files.size, 0);
  assert.deepEqual(calls.slice(-3), ["add", "commit", "reset"]);
  assert.equal(runSpecVerify({ issue: "EX-3", specPath: "missing.md", worktree: "wt", runDir: null }, deps).reason.startsWith("spec-unreadable"), true);
});
