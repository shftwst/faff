"use strict";
// === region:factory — spec-commit — FAFF-1404: graft commits the builder view of the captured spec byte for byte, and checks it before grading ===
// `faff spec commit` writes the builder view of the captured spec into the worktree and commits only
// that file, so the agent never handles the spec's bytes. `faff spec verify` re-splits the captured spec
// and checks that the committed spec in HEAD and in the working tree still equals it, just before graft
// grades acceptance criteria. Each call prints one typed token for the skill to route on. Neither command
// touches the tracker, makes an LLM call, or consults a decision kernel (next, eligible, run-done,
// queue-state).
// ===========================================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { parseArgs, usageError } = require("./argv");
const { dodSplit, dodClassify } = require("./admissibility");
const { loadConfig, resolveSpecDocsPath } = require("./config-core");
const { resolveConvention } = require("./conventions");
const { resolveFaffVersion } = require("./faff-version");

export type SpecToken = "committed" | "already-committed" | "needs-judgement" | "verified" | "mismatch" | "errored";

// One command's result: the token, plus the fields that token carries.
export type SpecResult = {
  issue: string;
  token: SpecToken;
  reason?: string | undefined;
  detail?: string | undefined;
  path?: string | undefined;
  paths?: string[] | undefined;
  commit?: string | undefined;
  source_check?: string | undefined;
  differs?: string[] | undefined;
};
type ResultExtras = Omit<SpecResult, "issue" | "token">;

// The record written to <run-dir>/<issue>/spec-commit.json.
export type SpecCommitRecord = {
  issue: string;
  path: string;
  commit: string;
  committed_sha256: string;
  source_sha256: string;
  holdouts_withheld: number;
  source_check: string;
  faff_version: string;
};

export type GitResult = { status: number; stdout: Buffer; stderr: string };

export type SpecDeps = {
  git: (worktree: string, args: [string, string, ...string[]]) => GitResult;
  readBytes: (p: string) => Buffer;
  exists: (p: string) => boolean;
  mkdirp: (p: string) => void;
  writeBytes: (p: string, buf: Buffer) => void;
  unlink: (p: string) => void;
  isInside: (base: string, target: string) => boolean;
  realpath: (p: string) => string;
  specDir: (worktree: string) => string;
  commitScheme: (worktree: string) => string;
  today: () => string;
  version: () => string;
  prepRoot: (worktree: string) => string;
  readJson: (p: string) => { [key: string]: unknown } | null | undefined;
  writeJson: (p: string, obj: { [key: string]: unknown }) => void;
};

export type CommitOptions = { issue: string; title: string | null; specPath: string; worktree: string; runDir: string; prepRoot?: string | null | undefined };
export type VerifyOptions = { issue: string; specPath: string; worktree: string; runDir: string | null };

function get(v: unknown, k: string): unknown {
  return Reflect.get(Object(v), k);
}

const ISSUE_RE = /^[A-Za-z][A-Za-z0-9]*-[0-9]+$/;
// <YYYY-MM-DD>-<tracker-key>-<rest>.md; only the key directly after the date is the issue id.
const SPEC_NAME_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-([A-Za-z][A-Za-z0-9]*-[0-9]+)-.*\.md$/;

const COMMIT_SPEC = {
  flags: {
    "--issue": { arity: 1 }, "--title": { arity: 1 }, "--spec": { arity: 1 }, "--worktree": { arity: 1 },
    "--run-dir": { arity: 1 }, "--prep-root": { arity: 1 }, "--json": { arity: 0 },
  },
};
const VERIFY_SPEC = {
  flags: { "--issue": { arity: 1 }, "--spec": { arity: 1 }, "--worktree": { arity: 1 }, "--run-dir": { arity: 1 }, "--json": { arity: 0 } },
};
const COMMIT_USAGE = "usage: faff spec commit --issue ID --title TEXT --spec FILE --worktree DIR --run-dir DIR [--prep-root DIR] [--json]";
const VERIFY_USAGE = "usage: faff spec verify --issue ID --spec FILE --worktree DIR [--run-dir DIR] [--json]";
const SPEC_USAGE = `${COMMIT_USAGE}\n       ${VERIFY_USAGE}\n       faff spec --selftest`;

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------
const sha256 = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex");
const collapseTitle = (t: unknown): string => String(t == null ? "" : t).replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
const slugify = (t: unknown): string => collapseTitle(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "spec";
const commitSubject = (scheme: string, issue: string, title: string): string => (scheme === "bare-imperative" ? `Add spec for ${title} (${issue})` : `docs(${issue}): add spec for ${title}`);

// The issue's spec files among the directory's file names, by the filename grammar.
function matchingSpecNames(names: string[], issue: string): string[] {
  const want = issue.toLowerCase();
  return names.filter((n) => {
    const m = SPEC_NAME_RE.exec(n);
    if (!m) return m;
    const key = m[1];
    if (key === undefined) throw new Error("matchingSpecNames: the issue-key group did not match");
    return key.toLowerCase() === want;
  });
}

// The builder view as bytes. A spec with nothing to withhold comes back as the very bytes read, so a
// file that is not valid UTF-8 is not altered by the decode.
function builderBytes(sourceBuf: Buffer): Buffer {
  const text = sourceBuf.toString("utf8");
  const split = dodSplit(text, "builder").text;
  if (split === text) return sourceBuf;
  if (!Buffer.from(text, "utf8").equals(sourceBuf)) throw new Error("spec is not valid UTF-8, so withholding scenarios would alter its bytes");
  return Buffer.from(split, "utf8");
}

function holdoutsWithheld(sourceBuf: Buffer): number {
  try { return dodClassify(sourceBuf.toString("utf8")).holdout_counts.holdout; } catch { return 0; }
}

// realpath of the deepest existing ancestor, with the not-yet-existing tail re-appended.
function realpathDeep(p: string): string {
  let cur = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...tail.slice().reverse()); } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}
function isInside(base: string, target: string): boolean {
  const rel = path.relative(realpathDeep(base), realpathDeep(target));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

const result = (issue: string, token: SpecToken, extra?: ResultExtras): SpecResult => ({ issue, token, ...extra });
const errored = (issue: string, reason: string, extra?: ResultExtras): SpecResult => result(issue, "errored", { reason, ...extra });

// ---------------------------------------------------------------------------
// Impure shell: the real dependencies. Tests substitute fakes.
// ---------------------------------------------------------------------------
function defaultDeps(): SpecDeps {
  const git = (worktree: string, args: [string, string, ...string[]]): GitResult => {
    const r = spawnSync("git", ["-C", worktree, ...args], { env: { ...process.env, LC_ALL: "C" }, maxBuffer: 256 * 1024 * 1024 });
    return { status: r.status == null ? 1 : r.status, stdout: r.stdout || Buffer.alloc(0), stderr: String(r.stderr || "") };
  };
  return {
    git,
    readBytes: (p) => fs.readFileSync(p),
    exists: (p) => fs.existsSync(p),
    mkdirp: (p) => fs.mkdirSync(p, { recursive: true }),
    writeBytes: (p, buf) => fs.writeFileSync(p, buf),
    unlink: (p) => fs.unlinkSync(p),
    isInside,
    realpath: realpathDeep,
    specDir: (worktree) => resolveSpecDocsPath(worktree, loadConfig(worktree)[0], false),
    commitScheme: (worktree) => resolveConvention(worktree, "commit_subject", loadConfig(worktree)[0]).value,
    today: () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; },
    version: () => resolveFaffVersion().version,
    prepRoot: (worktree) => {
      const r = git(worktree, ["rev-parse", "--git-common-dir"]);
      const common = r.status === 0 ? r.stdout.toString("utf8").trim() : "";
      return common ? path.dirname(path.resolve(worktree, common)) : worktree;
    },
    readJson: (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } },
    writeJson: (p, obj) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
      fs.renameSync(tmp, p);
    },
  };
}

// The spec directory as a path relative to the worktree, or an errored result when it is not inside it.
function resolveDir(issue: string, worktree: string, deps: SpecDeps): { err: SpecResult; dirRel?: undefined; abs?: undefined } | { err?: undefined; dirRel: string; abs: string } {
  let dir;
  try { dir = deps.specDir(worktree); } catch (e) { return { err: errored(issue, `spec-docs-path-unresolved: ${get(e, "message")}`) }; }
  const abs = path.resolve(worktree, dir);
  if (!deps.isInside(worktree, abs)) return { err: errored(issue, "path-outside-spec-dir", { detail: `spec directory ${dir} is outside the worktree` }) };
  const dirRel = path.relative(deps.realpath(worktree), deps.realpath(abs)).split(path.sep).join("/");
  return { dirRel, abs };
}

// The names of the issue's spec files in HEAD's spec directory.
function headSpecs(issue: string, worktree: string, dirRel: string, deps: SpecDeps): { err: SpecResult; paths?: undefined } | { err?: undefined; paths: string[] } {
  const r = deps.git(worktree, ["ls-tree", "-z", "--name-only", "HEAD", "--", `${dirRel}/`]);
  if (r.status !== 0) return { err: errored(issue, `git-ls-tree-failed (exit ${r.status})`) };
  const names = r.stdout.toString("utf8").split("\0").filter(Boolean).map((p) => path.posix.basename(p));
  return { paths: matchingSpecNames(names, issue).map((n) => `${dirRel}/${n}`) };
}

function headBlob(worktree: string, rel: string, deps: SpecDeps): Buffer | null {
  const r = deps.git(worktree, ["show", `HEAD:${rel}`]);
  return r.status === 0 ? r.stdout : null;
}

function recordPath(runDir: string, issue: string): string { return path.join(runDir, issue, "spec-commit.json"); }

function sourceCheck(prepRoot: string, issue: string, sourceBuf: Buffer, deps: SpecDeps): string {
  const marker = deps.readJson(path.join(prepRoot, ".faff", "prep", `${issue}.json`));
  const want = marker && typeof marker.spec_sha256 === "string" ? marker.spec_sha256 : null;
  if (!want) return "no-marker";
  return want === sha256(sourceBuf) ? "match" : "mismatch";
}

// ---------------------------------------------------------------------------
// spec commit.
// ---------------------------------------------------------------------------
function runSpecCommit(opts: CommitOptions, deps: SpecDeps): SpecResult {
  const { issue, title, specPath, worktree, runDir } = opts;
  let source;
  try { source = deps.readBytes(specPath); } catch (e) { return errored(issue, `spec-unreadable: ${get(e, "code") || get(e, "message")}`); }
  let builder;
  try { builder = builderBytes(source); } catch { return errored(issue, "builder-split-failed"); }
  const builderHash = sha256(builder);

  const d = resolveDir(issue, worktree, deps);
  if (d.err) return d.err;
  const name = `${deps.today()}-${issue}-${slugify(title)}-design.md`;
  const rel = `${d.dirRel}/${name}`;
  if (!deps.isInside(d.abs, path.join(worktree, rel))) return errored(issue, "path-outside-spec-dir");

  const record = (extra: { path: string; commit: string }): SpecCommitRecord => {
    const rec = {
      issue, path: extra.path, commit: extra.commit, committed_sha256: builderHash, source_sha256: sha256(source),
      holdouts_withheld: holdoutsWithheld(source),
      source_check: sourceCheck(opts.prepRoot || deps.prepRoot(worktree), issue, source, deps),
      faff_version: deps.version(),
    };
    deps.writeJson(recordPath(runDir, issue), rec);
    return rec;
  };

  const existing = headSpecs(issue, worktree, d.dirRel, deps);
  if (existing.err) return existing.err;
  if (existing.paths.length) {
    const blobs = existing.paths.map((p) => ({ p, blob: headBlob(worktree, p, deps) }));
    const differing = blobs.find((b) => !b.blob || !b.blob.equals(builder));
    if (differing) return result(issue, "needs-judgement", { reason: "committed-spec-differs", path: differing.p, paths: existing.paths });
    const first = existing.paths[0];
    if (first === undefined) throw new Error("spec commit: the matched spec path is missing");
    const log = deps.git(worktree, ["log", "-1", "--format=%H", "--", first]);
    const commit = log.status === 0 ? log.stdout.toString("utf8").trim() : "";
    if (!deps.exists(recordPath(runDir, issue))) {
      const rec = record({ path: first, commit });
      return result(issue, "already-committed", { path: first, commit, source_check: rec.source_check });
    }
    return result(issue, "already-committed", { path: first, commit });
  }

  const abs = path.join(worktree, rel);
  let created = false;
  if (deps.exists(abs)) {
    if (!deps.readBytes(abs).equals(builder)) return result(issue, "needs-judgement", { reason: "uncommitted-file-at-path", path: rel });
  } else {
    deps.mkdirp(path.dirname(abs));
    deps.writeBytes(abs, builder);
    created = true;
  }

  const subject = commitSubject(deps.commitScheme(worktree), issue, collapseTitle(title));
  const add = deps.git(worktree, ["add", "--", rel]);
  const commit = add.status === 0 ? deps.git(worktree, ["commit", "-m", subject, "--", rel]) : add;
  const failedStep = add.status === 0 ? "git-commit-failed" : "git-add-failed";
  if (commit.status !== 0) {
    deps.git(worktree, ["reset", "-q", "--", rel]);
    if (created) { try { deps.unlink(abs); } catch { /* already gone */ } }
    const line = commit.stderr.split("\n").find((l) => l.trim()) || "";
    return errored(issue, `${failedStep} (exit ${commit.status})${line ? `: ${line.trim()}` : ""}`);
  }
  const sha = deps.git(worktree, ["rev-parse", "HEAD"]).stdout.toString("utf8").trim();
  const rec = record({ path: rel, commit: sha });
  return result(issue, "committed", { path: rel, commit: sha, source_check: rec.source_check });
}

// ---------------------------------------------------------------------------
// spec verify.
// ---------------------------------------------------------------------------
function runSpecVerify(opts: VerifyOptions, deps: SpecDeps): SpecResult {
  const { issue, specPath, worktree, runDir } = opts;
  let expected;
  try { expected = builderBytes(deps.readBytes(specPath)); } catch (e) { return errored(issue, e && get(e, "code") ? `spec-unreadable: ${get(e, "code")}` : "builder-split-failed"); }

  const d = resolveDir(issue, worktree, deps);
  if (d.err) return d.err;
  let rel = null;
  const rec = runDir ? deps.readJson(recordPath(runDir, issue)) : null;
  if (rec && typeof rec.path === "string") rel = rec.path;
  else {
    const found = headSpecs(issue, worktree, d.dirRel, deps);
    if (found.err) return found.err;
    if (found.paths.length === 0) return errored(issue, "no-committed-spec");
    if (found.paths.length > 1) return errored(issue, "ambiguous-committed-spec", { paths: found.paths });
    const only = found.paths[0];
    if (only === undefined) throw new Error("spec verify: the matched spec path is missing");
    rel = only;
  }
  if (!deps.isInside(d.abs, path.resolve(worktree, rel))) return errored(issue, "path-outside-spec-dir", { path: rel });

  const head = headBlob(worktree, rel, deps);
  let working = null;
  try { working = deps.readBytes(path.join(worktree, rel)); } catch { /* absent: counts as differing */ }
  const differs = [];
  if (!head || !head.equals(expected)) differs.push("head");
  if (!working || !working.equals(expected)) differs.push("working-tree");
  return differs.length ? result(issue, "mismatch", { path: rel, differs }) : result(issue, "verified", { path: rel });
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------
function emit(res: SpecResult, json: boolean, verb: string): void {
  if (json) console.log(JSON.stringify(res));
  else {
    const bits = [res.path, res.commit && res.commit.slice(0, 12), res.differs && `differs: ${res.differs.join(",")}`].filter(Boolean);
    console.log(`spec ${verb} ${res.issue}: ${res.token}${res.reason ? `:${res.reason}` : ""}${bits.length ? ` (${bits.join("; ")})` : ""}`);
  }
}

function cmdSpec(args: string[], deps?: SpecDeps): number {
  if (args.includes("--selftest")) return specSelftest();
  const verb = args[0];
  if (verb !== "commit" && verb !== "verify") return usageError([{ code: "bad-value", detail: "expected a verb: commit or verify" }], SPEC_USAGE);
  const isCommit = verb === "commit";
  const { values, errors } = parseArgs(args.slice(1), isCommit ? COMMIT_SPEC : VERIFY_SPEC);
  const usage = isCommit ? COMMIT_USAGE : VERIFY_USAGE;
  if (errors.length) return usageError(errors, usage);
  const required = isCommit ? ["--issue", "--title", "--spec", "--worktree", "--run-dir"] : ["--issue", "--spec", "--worktree"];
  const missing = required.filter((f) => !values[f]);
  if (missing.length) return usageError([{ code: "missing-value", detail: `${missing.join(", ")} required` }], usage);
  const issue = values["--issue"];
  if (!ISSUE_RE.test(issue)) return usageError([{ code: "bad-value", flag: "--issue", detail: `--issue must match ${ISSUE_RE.source}` }], usage);
  const title = isCommit ? collapseTitle(values["--title"]) : null;
  if (isCommit && !title) return usageError([{ code: "bad-value", flag: "--title", detail: "--title is empty" }], usage);

  const d = deps || defaultDeps();
  const base = { issue, specPath: values["--spec"], worktree: values["--worktree"], runDir: values["--run-dir"] || null };
  let res;
  try { res = isCommit ? runSpecCommit({ ...base, title, prepRoot: values["--prep-root"] || null }, d) : runSpecVerify(base, d); } catch (e) { res = errored(issue, `unexpected: ${e && get(e, "message") ? get(e, "message") : e}`); }
  emit(res, !!values["--json"], verb);
  if (res.token === "errored") return 2;
  return res.token === "mismatch" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// --selftest: the pure helpers and both procedures over fake dependencies.
// ---------------------------------------------------------------------------
function specSelftest(): number {
  let fail = 0;
  const ok = (name: string, cond: unknown) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };
  const SPEC = "# s\n\n## Scenarios\n\n```\nGiven a\nWhen b\nThen c\n```\n\n```holdout\nGiven x\nWhen y\nThen z\n```\n";
  const BUILDER = builderBytes(Buffer.from(SPEC));

  ok("issue ids: tracker-key shaped only", ISSUE_RE.test("EX-3") && ISSUE_RE.test("faff-1112") && !ISSUE_RE.test("../x-1") && !ISSUE_RE.test("EX-*") && !ISSUE_RE.test("EX-3\n"));
  ok("title: whitespace and control characters collapse to one line", collapseTitle("  a\nb\t\u0007c  ") === "a b c" && collapseTitle("\n\t ") === "");
  ok("slug: lowercase, runs of other characters become one dash", slugify("Add a  Thing!") === "add-a-thing" && slugify("!!!") === "spec");
  ok("subject: both schemes", commitSubject("conventional", "EX-3", "T") === "docs(EX-3): add spec for T" && commitSubject("bare-imperative", "EX-3", "T") === "Add spec for T (EX-3)");
  const names = ["2026-10-20-FAFF-9-fix-ex-3-flake-design.md", "2026-10-24-ex-3-a-design.md", "2026-10-25-EX-3-b-design.md", "notes.md", "2026-10-25-EX-30-c-design.md"];
  ok("filename grammar: the id after the date only, case-insensitive", matchingSpecNames(names, "EX-3").join() === "2026-10-24-ex-3-a-design.md,2026-10-25-EX-3-b-design.md");
  ok("builder view: holdout scenario withheld, no-marker spec untouched", !BUILDER.toString().includes("Given x") && builderBytes(Buffer.from("plain\n")).toString() === "plain\n");
  ok("holdouts withheld counted", holdoutsWithheld(Buffer.from(SPEC)) === 1);

  // A fake worktree: files in a map, HEAD as a map of path to bytes, git calls scripted.
  type FakeState = {
    files: { has(k: string): boolean; get(k: string | undefined): Buffer; set(k: string | undefined, v: Buffer): unknown; delete(k: string): boolean; readonly size: number };
    head: Map<string | undefined, Buffer | undefined>;
    commits: number;
    records: Map<string, { [key: string]: unknown }>;
    gitFail: boolean;
    marker: { [key: string]: unknown } | null;
    calls: string[];
  };
  const fake = (over: Partial<FakeState> = {}) => {
    const st: FakeState = { files: new Map(), head: new Map(), commits: 0, records: new Map(), gitFail: false, marker: null, calls: [] };
    Object.assign(st, over);
    const deps: SpecDeps = {
      git: (_w, a) => {
        st.calls.push(a.join(" "));
        if (a[0] === "ls-tree") return { status: 0, stdout: Buffer.from([...st.head.keys()].join("\0")), stderr: "" };
        if (a[0] === "show") { const b = st.head.get(a[1].slice(5)); return b ? { status: 0, stdout: b, stderr: "" } : { status: 128, stdout: Buffer.alloc(0), stderr: "" }; }
        if (a[0] === "commit") { if (st.gitFail) return { status: 1, stdout: Buffer.alloc(0), stderr: "hook rejected\n" }; st.commits++; const p = a[a.length - 1]; st.head.set(p, st.files.get(p)); return { status: 0, stdout: Buffer.alloc(0), stderr: "" }; }
        if (a[0] === "rev-parse") return { status: 0, stdout: Buffer.from(`sha${st.commits}\n`), stderr: "" };
        if (a[0] === "log") return { status: 0, stdout: Buffer.from("sha0\n"), stderr: "" };
        return { status: 0, stdout: Buffer.alloc(0), stderr: "" };
      },
      readBytes: (p) => { if (p === "s.md") return Buffer.from(SPEC); if (!st.files.has(p.replace(/^wt\//, ""))) { const e: NodeJS.ErrnoException = new Error("nope"); e.code = "ENOENT"; throw e; } return st.files.get(p.replace(/^wt\//, "")); },
      exists: (p) => st.files.has(p.replace(/^wt\//, "")) || st.records.has(p),
      mkdirp: () => {}, writeBytes: (p, b) => st.files.set(p.replace(/^wt\//, ""), b), unlink: (p) => st.files.delete(p.replace(/^wt\//, "")),
      isInside: (b, t) => path.resolve(t).startsWith(path.resolve(b) + path.sep), realpath: (p) => path.resolve(p),
      specDir: () => "docs/specs", commitScheme: () => "conventional", today: () => "2026-10-27", version: () => "0.0.0",
      prepRoot: () => "root", readJson: (p) => (st.records.has(p) ? st.records.get(p) : p.includes(".faff/prep") ? st.marker : null),
      writeJson: (p, o) => st.records.set(p, o),
    };
    return { st, deps };
  };
  const base = { issue: "EX-3", title: "Add a thing", specPath: "s.md", worktree: "wt", runDir: "rd" };

  let f = fake();
  let r = runSpecCommit(base, f.deps);
  ok("commit: committed, one file, builder bytes", r.token === "committed" && r.path === "docs/specs/2026-10-27-EX-3-add-a-thing-design.md" && f.st.files.get(r.path).equals(BUILDER) && f.st.commits === 1);
  const rec = f.st.records.get(path.join("rd", "EX-3", "spec-commit.json"));
  ok("commit: record carries every field", rec && ["issue", "path", "commit", "committed_sha256", "source_sha256", "holdouts_withheld", "source_check", "faff_version"].every((k) => rec[k] !== undefined) && rec.committed_sha256 === sha256(BUILDER) && rec.holdouts_withheld === 1);
  ok("commit: no prep marker is no-marker", r.source_check === "no-marker");
  r = runSpecCommit(base, f.deps);
  ok("commit again: already-committed, no new commit", r.token === "already-committed" && f.st.commits === 1);

  f = fake({ marker: { spec_sha256: sha256(Buffer.from(SPEC)) } });
  ok("source check: match on the captured spec's digest", runSpecCommit(base, f.deps).source_check === "match");
  f = fake({ marker: { spec_sha256: "0".repeat(64) } });
  ok("source check: mismatch is advisory, token unchanged", runSpecCommit(base, f.deps).token === "committed");

  f = fake(); f.st.head.set("docs/specs/2026-10-01-EX-3-old-design.md", Buffer.from("rewritten"));
  r = runSpecCommit(base, f.deps);
  ok("commit: a differing committed spec is needs-judgement, nothing written", r.token === "needs-judgement" && r.reason === "committed-spec-differs" && f.st.commits === 0 && f.st.files.size === 0);
  f.st.head.set("docs/specs/2026-10-02-EX-3-same-design.md", BUILDER);
  r = runSpecCommit(base, f.deps);
  const bothPaths = r.paths;
  if (bothPaths === undefined) throw new Error("spec selftest: needs-judgement result has no paths");
  ok("commit: one identical file does not hide a divergent one", r.token === "needs-judgement" && bothPaths.length === 2);
  f = fake(); f.st.head.set("docs/specs/2026-10-20-FAFF-9-fix-ex-3-flake-design.md", Buffer.from("other"));
  ok("commit: another issue's slug naming this id is not a match", runSpecCommit(base, f.deps).token === "committed");

  f = fake(); f.st.files.set("docs/specs/2026-10-27-EX-3-add-a-thing-design.md", Buffer.from("draft"));
  r = runSpecCommit(base, f.deps);
  ok("commit: an untracked file with other bytes is left alone", r.token === "needs-judgement" && r.reason === "uncommitted-file-at-path" && f.st.files.get(r.path).toString() === "draft");
  f = fake(); f.st.files.set("docs/specs/2026-10-27-EX-3-add-a-thing-design.md", BUILDER);
  ok("commit: an untracked file with the builder bytes is committed as is", runSpecCommit(base, f.deps).token === "committed");

  f = fake({ gitFail: true });
  r = runSpecCommit(base, f.deps);
  ok("commit: a failed git commit errors and removes the file it created", r.token === "errored" && f.st.files.size === 0);
  f = fake({ gitFail: true }); f.st.files.set("docs/specs/2026-10-27-EX-3-add-a-thing-design.md", BUILDER);
  r = runSpecCommit(base, f.deps);
  ok("commit: a failed git commit keeps a file that already existed", r.token === "errored" && f.st.files.size === 1);

  f = fake(); runSpecCommit(base, f.deps);
  const vbase = { issue: "EX-3", specPath: "s.md", worktree: "wt", runDir: "rd" };
  ok("verify: verified after commit", runSpecVerify(vbase, f.deps).token === "verified");
  const p = [...f.st.head.keys()][0];
  f.st.head.set(p, Buffer.from("shortened"));
  r = runSpecVerify(vbase, f.deps);
  const headOnly = r.differs;
  if (headOnly === undefined) throw new Error("spec selftest: mismatch result has no differs");
  ok("verify: a committed rewrite whose working file matches differs in head only", r.token === "mismatch" && headOnly.join() === "head");
  f.st.files.set(p, Buffer.from("shortened"));
  const bothDiffer = runSpecVerify(vbase, f.deps).differs;
  if (bothDiffer === undefined) throw new Error("spec selftest: mismatch result has no differs");
  ok("verify: a committed rewrite checked out in the working tree differs in both", bothDiffer.join() === "head,working-tree");
  f.st.head.set(p, BUILDER); f.st.files.set(p, Buffer.from("edited"));
  const workingOnly = runSpecVerify(vbase, f.deps).differs;
  if (workingOnly === undefined) throw new Error("spec selftest: mismatch result has no differs");
  ok("verify: an uncommitted rewrite differs in the working tree only", workingOnly.join() === "working-tree");
  f.st.records.set(path.join("rd", "EX-3", "spec-commit.json"), { path: "../../etc/passwd" });
  ok("verify: a record path outside the spec directory is errored", runSpecVerify(vbase, f.deps).reason === "path-outside-spec-dir");
  ok("verify: no record and no committed file is errored", runSpecVerify({ ...vbase, runDir: null }, fake().deps).reason === "no-committed-spec");

  console.log(`RESULT ${fail ? "fail" : "ok"} spec selftest (${fail} failures)`);
  return fail ? 1 : 0;
}

module.exports = {
  ISSUE_RE, SPEC_NAME_RE, collapseTitle, slugify, commitSubject, matchingSpecNames, builderBytes, isInside,
  runSpecCommit, runSpecVerify, defaultDeps, recordPath, cmdSpec, specSelftest,
};
