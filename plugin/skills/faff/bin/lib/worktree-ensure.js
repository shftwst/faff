"use strict";
// ===========================================================================
// === region:factory — worktree-ensure — FAFF-1415: graft's Step 3 worktree provisioning as one command ===
//
// `faff worktree ensure` finds or creates an issue's build worktree and returns one typed result:
// where the worktree is (`wt`), how it got there (`mode`, `cause`) and what state its work is in
// (`resume_at`: start, existing, gate, review). It composes the existing primitives
// (worktree-check, worktree-heal, build-progress read, resume-store restore, conventions mine/get,
// the worktree-root resolver, setup-worktree.sh and remote-diff-base.sh) and re-implements none of
// them; the git steps the prose used to describe (rebase, recreate) run here, from the primitives'
// JSON. It makes no tracker call: the agent passes the tracker's branch hint and, for the hold
// check, labels from a fresh read. Every disposition exits 0; exit 2 is bad invocation only.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const lightsOut = require("./lights-out");
const configApi = require("./config");
const labelsApi = require("./labels");
const worktreePrune = require("./worktree-prune");
const sharedInfra = require("./shared-infra");
const argvApi = require("./argv");
const ENTRYPOINT = path.resolve(__dirname, "..", "faff");
// The bundled faff-graft skill dir, beside this module's install: plugin/skills/faff/bin/lib -> plugin/skills/faff-graft.
const GRAFT_SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "faff-graft");
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function realDeps(env = process.env) {
    const run = (cmd, args, cwd) => {
        const r = childProcess.spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
        return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    };
    return {
        faff: (args, cwd) => run(process.execPath, [ENTRYPOINT, ...args], cwd),
        git: (args, cwd) => run("git", args, cwd),
        gitBytes: (args, cwd) => {
            const r = childProcess.spawnSync("git", args, { cwd, env });
            return { status: r.status, stdout: r.stdout ?? new Uint8Array(0), stderr: r.stderr ?? new Uint8Array(0) };
        },
        bash: (script, args, cwd) => run("bash", [script, ...args], cwd),
        isDir: (p) => { try {
            return fs.statSync(p).isDirectory();
        }
        catch {
            return false;
        } },
        isFile: (p) => { try {
            return fs.existsSync(p) && !fs.statSync(p).isDirectory();
        }
        catch {
            return false;
        } },
        realpath: (p) => { try {
            return fs.realpathSync(p);
        }
        catch {
            return p;
        } },
        env,
        graftSkillDir: GRAFT_SKILL_DIR,
    };
}
// --- Untyped-JSON helpers. ---
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function field(o, key) {
    return isRecord(o) ? Reflect.get(o, key) : undefined;
}
function str(v) {
    return typeof v === "string" ? v : undefined;
}
function parseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
function firstLine(text) {
    return (text.split("\n").find((l) => l.trim() !== "") ?? "").trim();
}
function lastLine(text) {
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    return lines[lines.length - 1] ?? "";
}
// A bad invocation (exit 2). Thrown only before anything is created on disk.
class EnsureUsageError extends Error {
}
function blocked(s, cause, wt, extra = {}) {
    const auto = s.args.mode === "autonomous";
    return result(s, auto ? "parked" : "hand-over", null, cause, null, wt, null, null, extra);
}
function result(s, disposition, mode, cause, resumeAt, wt, setupScript, resume, extra = {}) {
    return {
        issue: s.args.issue,
        disposition,
        mode,
        cause,
        resume_at: resumeAt,
        wt,
        branch: s.branch,
        base_ref: s.baseRef,
        behind: s.behind,
        setup_script: setupScript,
        graft_skill_dir: s.deps.graftSkillDir,
        resume,
        detail: { ...s.detail, ...extra },
        warnings: s.warnings,
    };
}
// Step 1: the branch name from the branch_naming scheme.
function resolveBranch(args, deps, warnings) {
    const mine = deps.faff(["conventions", "mine"], args.root);
    if (mine.status !== 0)
        warnings.push(`conventions mine failed (exit ${String(mine.status)}); branch_naming resolved without the cache`);
    const get = deps.faff(["conventions", "get", "branch_naming"], args.root);
    let scheme = get.status === 0 ? get.stdout.trim() : "";
    if (scheme === "") {
        warnings.push(`conventions get branch_naming failed (exit ${String(get.status)}); using issue-slug`);
        scheme = "issue-slug";
    }
    const issueSlug = `${args.issue}-${args.slug}`;
    let branch = issueSlug;
    if (scheme === "slash-scoped")
        branch = `feature/${issueSlug}`;
    else if (scheme === "tracker-hint" && args.trackerBranch !== null) {
        const hint = args.trackerBranch;
        const valid = deps.git(["check-ref-format", "--branch", hint], args.root).status === 0;
        if (valid && worktreePrune.tokenMatch(hint, args.issue))
            branch = hint;
        else
            warnings.push(`tracker branch hint ${JSON.stringify(hint)} ${valid ? "does not carry the issue id" : "is not a valid branch name"}; using ${issueSlug}`);
    }
    if (deps.git(["check-ref-format", "--branch", branch], args.root).status !== 0) {
        throw new EnsureUsageError(`branch name ${JSON.stringify(branch)} fails git check-ref-format --branch`);
    }
    return branch;
}
function worktreeCheck(s) {
    const r = s.deps.faff(["worktree-check", "--issue", s.args.issue, "--root", s.args.root, "--json"], s.args.root);
    return { status: r.status, json: parseJson(r.stdout.trim()) };
}
function reuseFrom(s, chk) {
    if (chk.status === 0 || chk.status === 1) {
        const wt = str(field(chk.json, "worktree_path"));
        const baseRef = str(field(chk.json, "base_ref"));
        if (wt === undefined || baseRef === undefined)
            return { kind: "uncertifiable", reason: "unreadable-behind" };
        const behind = field(chk.json, "behind");
        s.baseRef = baseRef;
        s.behind = typeof behind === "number" ? behind : null;
        const checkedOut = str(field(chk.json, "branch"));
        if (checkedOut !== undefined && checkedOut !== s.branch)
            s.warnings.push(`checked-out branch ${checkedOut} differs from expected ${s.branch}`);
        if (chk.status === 0)
            return { kind: "reuse", wt, rebased: false };
        process.stderr.write(`faff worktree ensure: ${wt} is ${String(s.behind)} commit(s) behind ${baseRef}; rebasing in place\n`);
        const stale = { worktree_path: wt, base_ref: baseRef, behind: s.behind };
        const fetch = s.deps.git(["-C", wt, "fetch"], s.args.root);
        if (fetch.status !== 0)
            s.warnings.push(`git fetch in ${wt} failed (exit ${String(fetch.status)}); rebasing onto ${baseRef} as worktree-check fetched it`);
        const rebase = s.deps.git(["-C", wt, "rebase", baseRef], s.args.root);
        if (rebase.status === 0)
            return { kind: "reuse", wt, rebased: true };
        if (s.args.mode === "autonomous")
            s.deps.git(["-C", wt, "rebase", "--abort"], s.args.root);
        return { kind: "blocked", out: blocked(s, "rebase-conflict", wt, stale) };
    }
    const reason = str(field(chk.json, "reason")) ?? "git-unavailable";
    if (reason === "no-worktree")
        return { kind: "none" };
    if (reason === "clobbered-recoverable")
        return { kind: "clobbered" };
    return { kind: "uncertifiable", reason };
}
function verifyCheckpoint(s, record) {
    const build = field(record, "build");
    const branch = str(field(build, "branch"));
    const hash = str(field(build, "diff_hash"));
    if (branch === undefined || branch === "" || hash === undefined)
        return { kind: "mismatch" };
    const baseRun = s.deps.bash(path.join(s.deps.graftSkillDir, "remote-diff-base.sh"), [], s.args.root);
    const base = baseRun.status === 0 ? baseRun.stdout.trim() : "";
    if (base === "")
        return { kind: "blocked", out: blocked(s, "resume-base-unresolvable", null, { exit: baseRun.status, stderr: firstLine(baseRun.stderr) }) };
    s.baseRef = base;
    const fref = base.startsWith("origin/") ? `origin/${branch}` : branch;
    const tipRun = s.deps.git(["rev-parse", "--verify", "--quiet", `${fref}^{commit}`], s.args.root);
    const tip = tipRun.status === 0 ? tipRun.stdout.trim() : "";
    if (tip === "")
        return { kind: "mismatch" };
    const diff = s.deps.gitBytes(["diff", `${base}...${fref}`], s.args.root);
    if (diff.status !== 0)
        return { kind: "mismatch" };
    const cur = crypto.createHash("sha256").update(diff.stdout).digest("hex");
    return cur === hash ? { kind: "match", branch, fref, tip } : { kind: "mismatch" };
}
function hasOrigin(s) {
    return s.deps.git(["remote", "get-url", "origin"], s.args.root).status === 0;
}
// The registered worktrees as {path, branch, head}.
function registeredWorktrees(s) {
    const r = s.deps.git(["worktree", "list", "--porcelain"], s.args.root);
    const out = [];
    if (r.status !== 0)
        return out;
    let cur = null;
    for (const line of r.stdout.split("\n")) {
        if (line.startsWith("worktree ")) {
            if (cur !== null)
                out.push(cur);
            cur = { path: line.slice(9).trim(), branch: null, head: null };
        }
        else if (cur === null)
            continue;
        else if (line.startsWith("HEAD "))
            cur.head = line.slice(5).trim();
        else if (line.startsWith("branch "))
            cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    }
    if (cur !== null)
        out.push(cur);
    return out;
}
function samePath(s, a, b) {
    return path.resolve(s.deps.realpath(a)) === path.resolve(s.deps.realpath(b));
}
function worktreeRootDir(s) {
    const loaded = configApi.loadConfig(s.args.root);
    return lightsOut.resolveWorktreeRoot(s.args.root, s.deps.env, loaded[0]).root;
}
function recreate(s, v) {
    const b = v.branch;
    if (hasOrigin(s)) {
        const f = s.deps.git(["fetch", "origin"], s.args.root);
        if (f.status !== 0)
            return { kind: "blocked", out: blocked(s, "resume-recreate-failed", null, { stderr: firstLine(f.stderr) }) };
    }
    const local = s.deps.git(["rev-parse", "--verify", "--quiet", `refs/heads/${b}^{commit}`], s.args.root);
    if (local.status === 0 && local.stdout.trim() !== v.tip) {
        return { kind: "blocked", out: blocked(s, "resume-branch-diverged", null, { branch: b, local_tip: local.stdout.trim(), verified_tip: v.tip }) };
    }
    const rootDir = worktreeRootDir(s);
    const wtPath = path.join(rootDir, b.replace(/\//g, "-"));
    if (!lightsOut.isStrictlyUnderRoot(rootDir, wtPath)) {
        return { kind: "blocked", out: blocked(s, "resume-recreate-failed", wtPath, { resolved_root: rootDir }) };
    }
    const existing = registeredWorktrees(s).find((w) => samePath(s, w.path, wtPath));
    if (existing !== undefined) {
        if (existing.branch === b && existing.head === v.tip)
            return { kind: "ok", wt: wtPath };
        return { kind: "blocked", out: blocked(s, "resume-recreate-failed", wtPath, { registered_branch: existing.branch, registered_head: existing.head }) };
    }
    const add = s.deps.git(["worktree", "add", wtPath, b], s.args.root);
    if (add.status !== 0)
        return { kind: "blocked", out: blocked(s, "resume-recreate-failed", wtPath, { stderr: firstLine(add.stderr) }) };
    const head = s.deps.git(["-C", wtPath, "rev-parse", "HEAD"], s.args.root);
    if (head.status !== 0 || head.stdout.trim() !== v.tip) {
        return { kind: "blocked", out: blocked(s, "resume-recreate-failed", wtPath, { head: head.stdout.trim(), verified_tip: v.tip }) };
    }
    return { kind: "ok", wt: wtPath };
}
function holdLabelNames(root) {
    const p = configApi.resolveLabelPrefix(root);
    if (p.error !== undefined || p.prefix === undefined)
        throw new EnsureUsageError(p.error ?? "tracking.label_prefix did not resolve");
    const n = configApi.resolveControlLabels(root);
    if (n.error !== undefined || n.names === undefined)
        throw new EnsureUsageError(n.error ?? "tracking.control_labels did not resolve");
    return labelsApi.controlLabels(p.prefix, n.names).filter((l) => l.role === "awaiting-review" || l.role === "awaiting-adjudication").map((l) => l.name);
}
function parseLabels(raw) {
    if (raw === null)
        throw new EnsureUsageError("--labels is required when the resume-store hold check is reached (autonomous, no worktree, no checkpoint)");
    const v = parseJson(raw);
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string"))
        throw new EnsureUsageError("--labels must be a JSON array of strings");
    return v.filter((x) => typeof x === "string");
}
// Step 5: a fresh worktree from the provisioning script.
function freshCreate(s, cause) {
    const project = path.join(s.args.root, "scripts", "setup-worktree.sh");
    const bundled = path.join(s.deps.graftSkillDir, "setup-worktree.sh");
    let script;
    let which;
    if (s.deps.isFile(project)) {
        script = project;
        which = "project";
    }
    else if (s.deps.isFile(bundled)) {
        script = bundled;
        which = "bundled";
    }
    else
        return { kind: "done", out: blocked(s, "setup-script-unresolvable", null, { tried: [project, bundled] }) };
    const out = s.deps.bash(script, [s.branch, s.args.root], s.args.root);
    const wt = lastLine(out.stdout);
    if (out.status !== 0 || wt === "") {
        return { kind: "done", out: blocked(s, "setup-failed", null, { exit: out.status, setup_log: path.join(worktreeRootDir(s), "setup.log") }) };
    }
    return { kind: "placed", wt, mode: "fresh", cause, resumeAt: "start", setupScript: which, resume: null };
}
// Steps 3 and 4: the autonomous resume checks, then the fresh create.
function noWorktree(s) {
    if (s.args.mode === "interactive")
        return freshCreate(s, "no-worktree");
    const runDir = s.args.runDir;
    if (runDir === null)
        throw new EnsureUsageError("autonomous mode requires --run-dir or $FAFF_RUN_DIR");
    const cp = s.deps.faff(["build-progress", "read", runDir, s.args.issue], s.args.root);
    if (cp.status === 0) {
        const v = verifyCheckpoint(s, parseJson(cp.stdout.trim()));
        if (v.kind === "blocked")
            return { kind: "done", out: v.out };
        if (v.kind === "match") {
            const r = recreate(s, v);
            if (r.kind === "blocked")
                return { kind: "done", out: r.out };
            return { kind: "placed", wt: r.wt, mode: "resumed", cause: "checkpoint-match", resumeAt: "gate", setupScript: null, resume: null };
        }
        return freshCreate(s, "checkpoint-mismatch");
    }
    // Step 4: no checkpoint. The store is read only under a hold label.
    const labels = parseLabels(s.args.labels);
    const holds = holdLabelNames(s.args.root);
    const storeRoot = path.join(s.args.root, ".faff", "resume");
    const storePath = path.join(storeRoot, s.args.issue);
    if (!labels.some((l) => holds.includes(l))) {
        if (s.deps.isDir(storePath)) {
            s.warnings.push(`resume store present but no hold label passed; building fresh (${storePath})`);
            s.detail.store_path = storePath;
        }
        return freshCreate(s, "no-worktree");
    }
    const sp = s.deps.faff(["build-progress", "read", storeRoot, s.args.issue], s.args.root);
    if (sp.status !== 0)
        return { kind: "done", out: result(s, "needs-human", null, "store-missing", null, null, null, null, { store_path: storePath, exit: sp.status }) };
    const v = verifyCheckpoint(s, parseJson(sp.stdout.trim()));
    if (v.kind === "blocked")
        return { kind: "done", out: v.out };
    if (v.kind === "mismatch")
        return freshCreate(s, "store-mismatch");
    const r = s.deps.faff(["resume-store", "restore", "--run-dir", runDir, "--issue", s.args.issue, "--store-root", storeRoot], s.args.root);
    if (r.status === 4)
        return { kind: "done", out: result(s, "claimed-by-peer", null, "store-busy", null, null, null, null, { store_path: storePath }) };
    if (r.status !== 0) {
        return { kind: "done", out: result(s, "needs-human", null, `store-restore-failed:${String(r.status)}`, null, null, null, null, { exit: r.status, stderr: firstLine(r.stderr) }) };
    }
    const rec = parseJson(r.stdout.trim());
    const storeCause = field(rec, "cause");
    const dialogue = field(rec, "dialogue");
    const rc = recreate(s, v);
    if (rc.kind === "blocked")
        return { kind: "done", out: rc.out };
    const resumeAt = storeCause === "build-review-dialogue" ? "review" : "gate";
    return { kind: "placed", wt: rc.wt, mode: "resumed-from-store", cause: "store-restored", resumeAt, setupScript: null, resume: { cause: storeCause ?? null, dialogue: dialogue ?? null } };
}
function place(s) {
    let chk = worktreeCheck(s);
    let reuse = reuseFrom(s, chk);
    let healed = false;
    if (reuse.kind === "clobbered") {
        const heal = s.deps.faff(["worktree-heal", "--issue", s.args.issue, "--root", s.args.root, "--json"], s.args.root);
        const healedPath = str(field(parseJson(heal.stdout.trim()), "worktree_path")) ?? str(field(chk.json, "worktree_path")) ?? null;
        if (heal.status !== 0)
            return { kind: "done", out: blocked(s, "heal-failed", healedPath, healedPath === null ? {} : { worktree_path: healedPath }) };
        healed = true;
        chk = worktreeCheck(s);
        reuse = reuseFrom(s, chk);
        if (reuse.kind !== "reuse" && reuse.kind !== "blocked") {
            return { kind: "done", out: blocked(s, "heal-failed", healedPath, { reason: reuse.kind === "uncertifiable" ? reuse.reason : reuse.kind }) };
        }
    }
    if (reuse.kind === "blocked")
        return { kind: "done", out: reuse.out };
    if (reuse.kind === "uncertifiable")
        return { kind: "done", out: blocked(s, `uncertifiable:${reuse.reason}`, null, { reason: reuse.reason }) };
    if (reuse.kind === "reuse") {
        if (healed)
            return { kind: "placed", wt: reuse.wt, mode: "healed", cause: "clobbered-healed", resumeAt: "existing", setupScript: null, resume: null };
        if (reuse.rebased)
            return { kind: "placed", wt: reuse.wt, mode: "rebased", cause: "stale-rebased", resumeAt: "existing", setupScript: null, resume: null };
        return { kind: "placed", wt: reuse.wt, mode: "reused", cause: "worktree-fresh", resumeAt: "existing", setupScript: null, resume: null };
    }
    return noWorktree(s);
}
function ensure(args, deps) {
    const warnings = [];
    const branch = resolveBranch(args, deps, warnings);
    const s = { args, deps, branch, warnings, detail: {}, baseRef: null, behind: null };
    const placed = place(s);
    if (placed.kind === "done")
        return placed.out;
    const { wt } = placed;
    // Step 6: existence, then the root assert, on every ready path.
    if (!deps.isDir(wt))
        return blocked(s, "worktree-missing", wt);
    const top = deps.git(["-C", wt, "rev-parse", "--show-toplevel"], args.root);
    const actual = top.status === 0 ? top.stdout.trim() : "";
    if (actual === "")
        warnings.push(`root assert skipped: git rev-parse --show-toplevel failed in ${wt}`);
    else {
        const rootDir = worktreeRootDir(s);
        const under = lightsOut.isStrictlyUnderRoot(rootDir, actual) || lightsOut.isStrictlyUnderRoot(deps.realpath(rootDir), actual);
        if (!under) {
            const extra = { resolved_root: rootDir, actual };
            if (args.mode === "autonomous")
                return blocked(s, "root-outside", actual, extra);
            warnings.push(`worktree ${actual} is not under the resolved root ${rootDir}`);
            Object.assign(s.detail, extra);
        }
    }
    const current = deps.git(["-C", wt, "branch", "--show-current"], args.root);
    if (current.status === 0 && current.stdout.trim() !== "")
        s.branch = current.stdout.trim();
    return result(s, "ready", placed.mode, placed.cause, placed.resumeAt, wt, placed.setupScript, placed.resume);
}
// --- The verb. ---
const ENSURE_SPEC = {
    flags: {
        "--issue": { arity: 1 },
        "--mode": { arity: 1, enum: ["interactive", "autonomous"] },
        "--slug": { arity: 1 },
        "--tracker-branch": { arity: 1 },
        "--labels": { arity: 1 },
        "--run-dir": { arity: 1 },
        "--root": { arity: 1 },
        "--json": { arity: 0 },
    },
};
const ENSURE_USAGE = "usage: faff worktree ensure --issue ID --mode interactive|autonomous --slug SLUG [--tracker-branch NAME] [--labels JSON] [--run-dir DIR] [--root DIR] [--json]";
const WORKTREE_USAGE = ENSURE_USAGE;
function toMode(v) {
    return v === "interactive" || v === "autonomous" ? v : null;
}
function resolveRepoRoot(flag, deps) {
    const root0 = flag ?? sharedInfra.findRoot();
    if (!deps.isDir(root0))
        throw new EnsureUsageError(`repo root ${root0} is not a directory`);
    const top = deps.git(["-C", root0, "rev-parse", "--show-toplevel"], root0);
    if (top.status !== 0)
        throw new EnsureUsageError(`repo root ${root0} is not a git work tree`);
    return sharedInfra.mainWorktreeRoot(root0) ?? root0;
}
function cmdWorktreeEnsure(argv, deps = realDeps()) {
    const { values, errors } = argvApi.parseArgs(argv, ENSURE_SPEC);
    if (errors.length)
        return argvApi.usageError(errors, ENSURE_USAGE);
    const missing = (flag, what) => argvApi.usageError([{ code: "missing-value", flag, detail: `${flag} ${what} is required` }], ENSURE_USAGE);
    const issue = str(values["--issue"]);
    if (issue === undefined || issue === "")
        return missing("--issue", "ID");
    const mode = toMode(values["--mode"]);
    if (mode === null)
        return missing("--mode", "interactive|autonomous");
    const slug = str(values["--slug"]);
    if (slug === undefined || slug === "")
        return missing("--slug", "SLUG");
    if (!SLUG_RE.test(slug))
        return argvApi.usageError([{ code: "bad-value", flag: "--slug", detail: `--slug must match ${SLUG_RE.source}, got ${JSON.stringify(slug)}` }], ENSURE_USAGE);
    const envRunDir = str(deps.env.FAFF_RUN_DIR);
    const runDir = str(values["--run-dir"]) ?? (envRunDir !== undefined && envRunDir !== "" ? envRunDir : null);
    if (mode === "autonomous" && runDir === null)
        return missing("--run-dir", "DIR (or $FAFF_RUN_DIR) in autonomous mode");
    let out;
    try {
        const root = resolveRepoRoot(str(values["--root"]), deps);
        out = ensure({ issue, mode, slug, trackerBranch: str(values["--tracker-branch"]) ?? null, labels: str(values["--labels"]) ?? null, runDir: runDir === null ? null : path.resolve(runDir), root }, deps);
    }
    catch (e) {
        if (e instanceof EnsureUsageError) {
            process.stderr.write(`faff worktree ensure: ${e.message}\n`);
            return 2;
        }
        throw e;
    }
    if (values["--json"] === true)
        process.stdout.write(`${JSON.stringify(out)}\n`);
    else {
        const how = out.disposition === "ready" ? `${String(out.mode)} (${out.cause}), resume at ${String(out.resume_at)}` : out.cause;
        process.stdout.write(`${out.issue}: ${out.disposition} — ${how}${out.wt === null ? "" : ` — ${out.wt}`}\n`);
        for (const w of out.warnings)
            process.stdout.write(`[warn] ${w}\n`);
    }
    return 0;
}
function cmdWorktree(args) {
    if (args[0] !== "ensure")
        return argvApi.usageError([{ code: "bad-value", detail: "expected a verb: ensure" }], WORKTREE_USAGE);
    return cmdWorktreeEnsure(args.slice(1));
}
module.exports = { cmdWorktree, cmdWorktreeEnsure, ensure, realDeps, ENSURE_USAGE, GRAFT_SKILL_DIR };
