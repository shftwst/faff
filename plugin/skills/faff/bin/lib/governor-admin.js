"use strict";
// ===========================================================================
// === region:factory — governor-admin — FAFF-1217: `commissaire governor pin` and `governor status` (ADR 0135) ===
//
// Two operator commands the human runs from their own account. `pin` proposes a governor's key
// fingerprint for `.commissaire/trust.toml` through a pull request, after refusing any governor whose
// independence it can disprove from host facts (the kernel-reported uid of the process at the socket,
// the runner's groups, the key directory's owner and mode). `status` reports each input to the
// counting decision with a state and a reason. Every check that cannot complete is `unknown`, and
// `unknown` counts as not met.
//
// Commissaire stands alone: this module carries its own `git`, `gh` and `id` calls and never requires
// merge-gate, config or budget. It is required lazily by COMMISSAIRE_DISPATCH. The host-fact seams
// (`AdminDeps`) are reachable only from tests; the CLI passes none.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.repoFromRemoteUrl = repoFromRemoteUrl;
exports.rulesRequirePullRequest = rulesRequirePullRequest;
exports.insertFingerprint = insertFingerprint;
exports.pinCore = pinCore;
exports.statusCore = statusCore;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const producerAuth = require("./producer-auth");
const trust = require("./commissaire-trust");
const governorClient = require("./commissaire-governor-client");
// --- Constants ----------------------------------------------------------------------------------
// A code constant, never configuration: widening it is a reviewed change (ADR 0135).
const ROOT_EQUIVALENT_GROUPS = {
    linux: ["docker", "lxd", "incus-admin", "libvirt", "disk", "sudo", "wheel", "root"],
    macos: ["admin", "wheel"],
};
const REPO_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const BASE_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const GITHUB_HOSTS = ["github.com", "ssh.github.com"];
const TIMEOUTS = { connect_ms: 3000, reply_ms: 10000 };
const HOOKS_OFF = ["-c", "core.hooksPath=/dev/null"];
const TRUST_PATH = ".commissaire/trust.toml";
const FINGERPRINT_COMMENT = "# SHA-256 of each pinned governor's SPKI-DER public key, lowercase hex.";
const APPROVE_SENTENCE = "A human must approve this PR. It changes `.commissaire/trust.toml`, so the runner must not merge it.";
const REFORMAT_LINE = "Reformatted the single-line governor_key_fingerprints array to one entry per line; no existing fingerprint changed";
const BYPASS_CAVEAT = "The rules endpoint hides bypass actors from non-admin callers, so status cannot prove the runner's identity has no bypass. Check bypass lists by hand (FAFF-1213).";
const LOGIN_CAVEAT = "runner_identity is judged from --runner-login as given; a run counts only on its recorded GitHub actor (FAFF-1182).";
const KEY_OPEN_CAVEAT = "host_checks does not try to open the key file; commissaire governor pin does.";
const FLY_APP_RE = /^[a-z0-9][a-z0-9-]*$/;
const FLY_IDENTIFY_COMMAND = "/opt/commissaire/current/bin/commissaire governor identify --json";
const FLY_INSTALL_COMMIT_RE = /^\/opt\/commissaire\/([0-9a-f]{40,64})\//;
const FLY_CHECKLIST = [
    "The runbook records the Fly documentation on isolation between custom private networks and the operator's 2026-10-14 basis for the same-network question (only the governor and runner apps on the network).",
    "`fly ips list -a <app>` shows no public address.",
    "The governor app and the runner app share one custom private network that no other app is on.",
    "The runner app's machines hold no Fly token that can deploy to, SSH into, or manage volumes of the governor app.",
    "The governor was deployed from a clean checkout of a release tag.",
];
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isUid = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const str = (v) => (typeof v === "string" ? v : undefined);
const flagStr = (flags, name) => str(flags[name]);
function exec(bin, args, opts = {}) {
    const r = spawnSync(bin, args, { cwd: opts.cwd, env: opts.env ?? process.env, encoding: "utf8", timeout: 120000 });
    return { status: typeof r.status === "number" ? r.status : null, stdout: typeof r.stdout === "string" ? r.stdout : "", stderr: typeof r.stderr === "string" ? r.stderr : "" };
}
function firstExisting(paths) {
    for (const p of paths) {
        try {
            if (fs.statSync(p).isFile())
                return p;
        }
        catch { /* try the next */ }
    }
    return null;
}
function defaultLookupRunner(name) {
    const idBin = firstExisting(["/usr/bin/id", "/bin/id"]);
    if (idBin === null)
        return null;
    const run = (flag) => {
        const r = exec(idBin, [flag, "--", name], { env: {} });
        return r.status === 0 ? r.stdout.trim() : null;
    };
    const uid = run("-u"), names = run("-Gn"), numbers = run("-G");
    if (uid === null || names === null || numbers === null || !/^[0-9]+$/.test(uid))
        return null;
    const gids = numbers.split(/\s+/).filter(Boolean).map(Number);
    if (!gids.every(isUid))
        return null;
    return { uid: Number(uid), gids, groups: names.split(/\s+/).filter(Boolean) };
}
function defaultAncestors(p) {
    let real;
    try {
        real = fs.realpathSync(p);
    }
    catch {
        return null;
    }
    const chain = [real];
    for (let cur = real; path.dirname(cur) !== cur;) {
        cur = path.dirname(cur);
        chain.push(cur);
    }
    return chain;
}
function defaultRunnerCanWrite(p, runner) {
    let st;
    try {
        st = fs.statSync(p);
    }
    catch {
        return false;
    }
    if (st.uid === runner.uid)
        return true;
    if ((st.mode & 0o002) !== 0)
        return true;
    return (st.mode & 0o020) !== 0 && runner.gids.includes(st.gid);
}
function findDotGit(cwd) {
    for (let dir = path.resolve(cwd);; dir = path.dirname(dir)) {
        const candidate = path.join(dir, ".git");
        try {
            const st = fs.lstatSync(candidate);
            if (st.isDirectory())
                return { top: dir, gitDir: candidate };
            if (st.isFile()) {
                const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(candidate, "utf8"));
                return { top: dir, gitDir: m && m[1] ? path.resolve(dir, m[1].trim()) : null };
            }
        }
        catch { /* not at this level */ }
        if (path.dirname(dir) === dir)
            return null;
    }
}
const defaultGitDir = (cwd) => findDotGit(cwd)?.gitDir ?? null;
const defaultWorkTreeTop = (cwd) => findDotGit(cwd)?.top ?? null;
function defaultCommonDir(gitDir) {
    try {
        const rel = fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim();
        return rel === "" ? null : path.resolve(gitDir, rel);
    }
    catch {
        return null;
    }
}
function defaultResolveBin(name) {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        if (dir === "")
            continue;
        const candidate = path.join(dir, name);
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            if (fs.statSync(candidate).isFile())
                return fs.realpathSync(candidate);
        }
        catch { /* not in this directory */ }
    }
    return null;
}
const DEFAULT_DEPS = {
    peerRequest: (endpoint, request, timeouts) => governorClient.governorRequestWithPeer(endpoint, request, timeouts),
    getuid: () => (typeof process.getuid === "function" ? process.getuid() : -1),
    platform: () => process.platform,
    lookupRunner: defaultLookupRunner,
    lstat: (p) => {
        try {
            const st = fs.lstatSync(p);
            return { uid: st.uid, gid: st.gid, mode: st.mode & 0o7777, isDirectory: st.isDirectory(), isSymlink: st.isSymbolicLink() };
        }
        catch {
            return null;
        }
    },
    openNoFollow: (p) => {
        try {
            const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
            fs.closeSync(fd);
            return "opened";
        }
        catch (e) {
            return isRecord(e) && typeof e.code === "string" ? e.code : "UNKNOWN";
        }
    },
    ancestors: defaultAncestors,
    runnerCanWrite: defaultRunnerCanWrite,
    // peer-cred is loaded lazily inside the request subprocess, so it is never in require.cache here.
    requireClosure: () => [...new Set([...Object.keys(require.cache), require.resolve("./peer-cred"), path.join(__dirname, "peer-cred-helper.py")])],
    execPath: () => process.execPath,
    uidMin: () => {
        try {
            const m = /^\s*UID_MIN\s+(\d+)/m.exec(fs.readFileSync("/etc/login.defs", "utf8"));
            return m && m[1] ? Number(m[1]) : 1000;
        }
        catch {
            return 1000;
        }
    },
    homeOf: (uid) => {
        const getent = firstExisting(["/usr/bin/getent", "/bin/getent"]);
        if (getent === null)
            return null;
        const r = exec(getent, ["passwd", String(uid)], { env: {} });
        const home = r.status === 0 ? r.stdout.trim().split(":")[5] : undefined;
        return home === undefined || home === "" ? null : home;
    },
    resolveBin: defaultResolveBin,
    gitDir: defaultGitDir,
    workTreeTop: defaultWorkTreeTop,
    commonDir: defaultCommonDir,
    runGit: (bin, args, cwd) => exec(bin, [...HOOKS_OFF, ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }),
    runGh: (bin, args) => exec(bin, args),
    runFly: (bin, args) => exec(bin, args),
    hostname: () => os.hostname(),
    now: () => new Date(),
    cwd: () => process.cwd(),
};
const refusal = (reason, detail = null) => ({ reason, detail });
function platformOf(deps) {
    const p = deps.platform();
    return p === "linux" ? "linux" : p === "darwin" ? "macos" : null;
}
const isUsage = (v) => isRecord(v) && typeof v.usage === "string";
// Flag shapes shared by both commands. A usage error never reaches a socket, git or gh.
function parseTarget(verb, flags, requireAll, viaFly = false) {
    const fail = (m) => ({ usage: `faff commissaire governor ${verb}: ${m}` });
    if (viaFly && "--socket" in flags)
        return fail("--fly-app and --socket are mutually exclusive");
    const socket = viaFly ? undefined : flagStr(flags, "--socket") ?? process.env.COMMISSAIRE_GOVERNOR;
    let endpoint = null;
    if (socket !== undefined && socket !== "") {
        try {
            endpoint = governorClient.parseEndpoint(socket);
        }
        catch (e) {
            return fail(e instanceof Error ? e.message : "invalid governor endpoint");
        }
    }
    if (requireAll && !viaFly && endpoint === null)
        return fail("--socket PATH (or COMMISSAIRE_GOVERNOR) is required");
    const runnerUser = flagStr(flags, "--runner-user");
    if (requireAll && (runnerUser === undefined || runnerUser === ""))
        return fail("--runner-user NAME is required");
    const repo = flagStr(flags, "--repo");
    if (requireAll && repo === undefined)
        return fail("--repo OWNER/NAME is required");
    if (repo !== undefined && (!REPO_RE.test(repo) || repo.includes("..") || repo.startsWith("-") || repo.includes("/-")))
        return fail("--repo must be OWNER/NAME");
    const base = flagStr(flags, "--base");
    if (base !== undefined && (!BASE_RE.test(base) || base.includes("..") || base.endsWith("/") || base.includes("//")))
        return fail("--base is not a valid branch name");
    for (const name of ["--socket", "--runner-user", "--repo", "--base", "--runner-login"]) {
        if (name in flags && typeof flags[name] !== "string")
            return fail(`${name} needs a value`);
    }
    return { endpoint, runnerUser: runnerUser === "" ? undefined : runnerUser, repo, base };
}
// OWNER/NAME from a github.com (or ssh.github.com) origin URL (https, ssh:// and scp-like forms), or null.
function repoFromRemoteUrl(url) {
    const trimmed = url.trim();
    const m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed)
        ?? /^(?:[^@/\s]+@)?([^/:\s]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed);
    if (!m || !m[1] || !m[2] || !m[3] || !GITHUB_HOSTS.includes(m[1].toLowerCase()))
        return null;
    const slug = `${m[2]}/${m[3]}`;
    return REPO_RE.test(slug) && !slug.includes("..") ? slug : null;
}
// True when url is a github.com pull request URL in repo (compared case-insensitively).
function prUrlFor(url, repo) {
    const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/.exec(url);
    return m !== null && m[1] !== undefined && m[1].toLowerCase() === repo.toLowerCase();
}
function readOrigin(deps, gitBin) {
    const r = deps.runGit(gitBin, ["remote", "get-url", "origin"], deps.cwd());
    if (r.status !== 0 || r.stdout.trim() === "")
        return { kind: "none" };
    const repo = repoFromRemoteUrl(r.stdout);
    return repo === null ? { kind: "unparseable", url: r.stdout.trim() } : { kind: "ok", repo };
}
const sameRepo = (a, b) => a.toLowerCase() === b.toLowerCase();
// A governor-supplied or filesystem-derived value reduced to printable ASCII without backticks.
const printable = (v, cap = 64) => String(v).replace(/[^\x20-\x7e]/g, "?").replace(/`/g, "'").slice(0, cap);
// The same rule as merge-gate's hasPullRequestRule, kept here so Commissaire does not import faff.
function rulesRequirePullRequest(rules) {
    return Array.isArray(rules) && rules.some((r) => isRecord(r) && r.type === "pull_request");
}
function branchProtection(deps, ghBin, repo, base) {
    if (ghBin === null)
        return { state: "unknown", reason: "gh-unavailable" };
    const r = deps.runGh(ghBin, ["api", `repos/${repo}/rules/branches/${base}`]);
    if (r.status !== 0)
        return { state: "unknown", reason: "rules-unreadable" };
    let rules;
    try {
        rules = JSON.parse(r.stdout);
    }
    catch {
        return { state: "unknown", reason: "rules-unreadable" };
    }
    if (!Array.isArray(rules))
        return { state: "unknown", reason: "rules-unreadable" };
    return rulesRequirePullRequest(rules) ? { state: "met", reason: null } : { state: "not-met", reason: "base-not-protected" };
}
function defaultBranch(deps, ghBin, repo) {
    const r = deps.runGh(ghBin, ["repo", "view", repo, "--json", "defaultBranchRef"]);
    if (r.status !== 0)
        return null;
    try {
        const parsed = JSON.parse(r.stdout);
        const ref = isRecord(parsed) ? parsed.defaultBranchRef : null;
        const name = isRecord(ref) ? str(ref.name) : undefined;
        return name !== undefined && BASE_RE.test(name) && !name.includes("..") ? name : null;
    }
    catch {
        return null;
    }
}
function parseRunnerChecks(v) {
    if (v === null)
        return null;
    if (!isRecord(v))
        return undefined;
    const { schema, runner_user, runner_uid, platform, socket_group, docker_group, sudo_rules, sudo_absent, admin_group, independent, checked_at, install_version, source_tag } = v;
    if (typeof schema !== "number" || typeof runner_user !== "string" || !isUid(runner_uid) || typeof platform !== "string" || typeof socket_group !== "string")
        return undefined;
    if (typeof docker_group !== "boolean" || typeof sudo_rules !== "boolean" || typeof sudo_absent !== "boolean" || typeof independent !== "boolean")
        return undefined;
    if (admin_group !== null && typeof admin_group !== "boolean")
        return undefined;
    if (typeof checked_at !== "string" || typeof install_version !== "string" || typeof source_tag !== "string")
        return undefined;
    return { schema, runner_user, runner_uid, platform, socket_group, docker_group, sudo_rules, sudo_absent, admin_group, independent, checked_at, install_version, source_tag };
}
function identify(deps, endpoint) {
    const res = deps.peerRequest(endpoint, { op: "identify" }, TIMEOUTS);
    if ("unreachable" in res)
        return { kind: "unreachable", detail: res.detail };
    return readIdentifyReply(res.reply, res.peer_uid);
}
function readIdentifyReply(reply, peerUid) {
    if (reply.ok === false)
        return { kind: "refused", reason: printable(str(reply.reason) ?? "unknown") };
    const pk = str(reply.pk), fingerprint = str(reply.pk_fingerprint), keyFile = str(reply.key_file);
    const runnerChecks = parseRunnerChecks(reply.runner_checks);
    if (reply.ok !== true || pk === undefined || pk === "" || fingerprint === undefined || !FINGERPRINT_RE.test(fingerprint))
        return { kind: "invalid" };
    if (keyFile === undefined || !path.isAbsolute(keyFile) || runnerChecks === undefined)
        return { kind: "invalid" };
    let actual;
    try {
        actual = producerAuth.pkFingerprint(pk);
    }
    catch {
        return { kind: "invalid" };
    }
    if (actual !== fingerprint)
        return { kind: "mismatch" };
    return { kind: "ok", identified: { pk, fingerprint, keyFile, runnerChecks, peerUid } };
}
// pin step 3's invoker and runner checks, in order: root, runner lookup, invoker is the runner.
function invokerChecks(deps, runnerUser) {
    const uid = deps.getuid();
    if (uid === 0)
        return { ok: false, refusal: refusal("invoked-as-root", "run pin and status from your own account, not as root") };
    const runner = deps.lookupRunner(runnerUser);
    if (runner === null)
        return { ok: false, refusal: refusal("runner-user-unknown", `no such user: ${printable(runnerUser)}`) };
    if (runner.uid === uid)
        return { ok: false, refusal: refusal("invoked-as-runner", "run pin and status as the human, not as the runner user") };
    return { ok: true, runner };
}
function writablePath(deps, runner, p) {
    const chain = deps.ancestors(p);
    if (chain === null)
        return p;
    return chain.find((c) => deps.runnerCanWrite(c, runner)) ?? null;
}
const INSTALL_COPY_HINT = "; run the installed copy (/opt/commissaire/<version>/) from your own clone";
function codeWritable(deps, runner) {
    for (const file of deps.requireClosure()) {
        const hit = writablePath(deps, runner, file);
        if (hit !== null)
            return refusal("code-runner-writable", `the runner user can write ${printable(hit, 200)} (needed by ${printable(file, 200)})${INSTALL_COPY_HINT}`);
    }
    const interpreter = writablePath(deps, runner, deps.execPath());
    if (interpreter !== null)
        return refusal("code-runner-writable", `the runner user can write the Node interpreter or a directory above it: ${printable(interpreter, 200)}${INSTALL_COPY_HINT}`);
    return null;
}
function binWritable(deps, runner, name, bin) {
    const hit = writablePath(deps, runner, bin);
    return hit === null ? null : refusal("code-runner-writable", `the runner user can write ${name} (${printable(hit, 200)})`);
}
// Everything the runner could edit to steer git: the git directory, the working-tree root, the `.git`
// entry (directory or gitfile), the config files, and for a linked worktree the shared directory.
function repoCustodyPaths(deps, gitDir) {
    const top = deps.workTreeTop(deps.cwd());
    const common = deps.commonDir(gitDir);
    const paths = [gitDir];
    if (top !== null)
        paths.push(top, path.join(top, ".git"));
    if (common !== null)
        paths.push(common);
    // Config files are optional leaves: when absent, creating one needs write access to its directory, which is listed above.
    const leaves = [path.join(gitDir, "config"), path.join(gitDir, "config.worktree")];
    if (common !== null)
        leaves.push(path.join(common, "config"));
    for (const leaf of leaves)
        if (deps.lstat(leaf) !== null)
            paths.push(leaf);
    return [...new Set(paths)];
}
function repoWritable(deps, runner) {
    const gitDir = deps.gitDir(deps.cwd());
    if (gitDir === null)
        return refusal("git-failed", "not inside a git repository");
    for (const candidate of repoCustodyPaths(deps, gitDir)) {
        const hit = writablePath(deps, runner, candidate);
        if (hit !== null)
            return refusal("repo-runner-writable", `the runner user can write ${printable(hit, 200)}; run pin from your own clone`);
    }
    return null;
}
function runnerGroupCheck(runner, platform) {
    const hits = runner.groups.filter((g) => (ROOT_EQUIVALENT_GROUPS[platform] ?? []).includes(g));
    return hits.length === 0 ? null : refusal("runner-root-equivalent", hits.join(", "));
}
function governorUserCheck(deps, peerUid, runner) {
    if (peerUid === 0)
        return refusal("governor-is-root", "the governor process runs as uid 0");
    const invoker = deps.getuid();
    if (peerUid === runner.uid || peerUid === invoker)
        return refusal("governor-same-user", `the governor process runs as uid ${peerUid}, the same as the ${peerUid === runner.uid ? "runner" : "invoker"}`);
    if (peerUid >= deps.uidMin())
        return refusal("governor-not-system-user", `the governor process runs as uid ${peerUid}, outside the system range (below ${deps.uidMin()})`);
    return null;
}
function keyDirCheck(deps, keyFile, peerUid) {
    const dir = path.dirname(keyFile);
    const untrusted = (m) => ({ refusal: refusal("key-dir-untrusted", m) });
    const home = deps.homeOf(peerUid);
    if (home === null)
        return untrusted(`the home directory of uid ${peerUid} could not be read`);
    if (path.resolve(home) !== path.resolve(dir))
        return untrusted(`${printable(dir, 200)} is not the governor account's home directory`);
    const st = deps.lstat(dir);
    if (st === null)
        return untrusted(`${printable(dir, 200)} cannot be inspected`);
    if (st.isSymlink || !st.isDirectory)
        return untrusted(`${printable(dir, 200)} is not a real directory`);
    if (st.uid !== peerUid)
        return untrusted(`${printable(dir, 200)} is owned by uid ${st.uid}, not the governor's uid ${peerUid}`);
    if ((st.mode & 0o7777) !== 0o700)
        return untrusted(`${printable(dir, 200)} is mode ${(st.mode & 0o7777).toString(8)}, want 700`);
    const chain = deps.ancestors(path.dirname(dir));
    if (chain === null)
        return untrusted(`the parent of ${printable(dir, 200)} cannot be resolved`);
    for (const ancestor of chain) {
        const a = deps.lstat(ancestor);
        if (a === null)
            return untrusted(`${printable(ancestor, 200)} cannot be inspected`);
        if (a.uid !== 0)
            return untrusted(`${printable(ancestor, 200)} is not owned by root`);
        if ((a.mode & 0o022) !== 0)
            return untrusted(`${printable(ancestor, 200)} is group- or world-writable`);
    }
    return { facts: { dir, owner: st.uid, mode: st.mode & 0o7777 } };
}
function keyOpenCheck(deps, keyFile) {
    const outcome = deps.openNoFollow(keyFile);
    if (outcome === "opened")
        return refusal("key-readable-by-invoker", `${printable(keyFile, 200)} can be opened by the invoker`);
    if (outcome === "EACCES" || outcome === "EPERM")
        return null;
    return refusal("key-read-check-inconclusive", `opening the key file failed with ${printable(outcome)}`);
}
// pin steps 5 to 7. `facts` carries the key directory's owner and mode for the PR body.
function governorHostChecks(deps, runner, platform, id, openKey) {
    const groups = runnerGroupCheck(runner, platform);
    if (groups !== null)
        return { refusal: groups };
    const user = governorUserCheck(deps, id.peerUid, runner);
    if (user !== null)
        return { refusal: user };
    const dir = keyDirCheck(deps, id.keyFile, id.peerUid);
    if ("refusal" in dir)
        return dir;
    if (openKey) {
        const open = keyOpenCheck(deps, id.keyFile);
        if (open !== null)
            return { refusal: open };
    }
    return dir;
}
// pin step 8's comparison (the record is a claim, trusted only after the host checks above).
function installCheck(rc, runnerUser, runner) {
    if (rc === null)
        return refusal("install-record-missing", "the governor has no runner checks record; install it with commissaire governor install");
    if (rc.runner_user !== runnerUser || rc.runner_uid !== runner.uid)
        return refusal("install-check-failed", "install-runner-mismatch");
    if (rc.platform !== "linux")
        return refusal("install-check-failed", "install-platform-mismatch");
    if (!rc.independent) {
        const failing = [rc.docker_group ? "docker_group true" : null, rc.sudo_rules ? "sudo_rules true" : null, rc.admin_group === true ? "admin_group true" : null].filter((f) => f !== null);
        return refusal("install-check-failed", failing.length > 0 ? failing.join(", ") : "independent false");
    }
    return null;
}
// --- Trust-file text edit ------------------------------------------------------------------------
function arrayExtent(lines, startIdx) {
    const first = lines[startIdx] ?? "";
    const openCol = first.indexOf("[", first.indexOf("="));
    if (openCol === -1)
        return null;
    let last = "none";
    let inString = false;
    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i] ?? "";
        for (let c = i === startIdx ? openCol + 1 : 0; c < line.length; c++) {
            const ch = line.charAt(c);
            if (inString) {
                if (ch === "\\")
                    c++;
                else if (ch === '"')
                    inString = false;
                continue;
            }
            if (ch === "#")
                break;
            if (ch === '"') {
                inString = true;
                last = "string";
            }
            else if (ch === ",")
                last = "comma";
            else if (ch === "]")
                return { endIdx: i, endCol: c, lastToken: last, openCol };
        }
    }
    return null;
}
// Insert `fp` into the governor_key_fingerprints array of `text` (or create the file). Every line
// outside the array stays byte-identical; the one permitted reformat is a single-line array.
function insertFingerprint(text, fp, comment) {
    const entryLine = (indent, lead) => `${indent}${lead ? ", " : ""}"${fp}",  # ${comment}`;
    const newArray = () => `${FINGERPRINT_COMMENT}\ngovernor_key_fingerprints = [\n${entryLine("  ", false)}\n]\n`;
    if (text === null)
        return { text: `schema = 1\n\n${newArray()}`, reformatted: false };
    const crlf = text.includes("\r\n");
    const eol = crlf ? "\r" : "";
    const lines = text.split("\n");
    const doc = trust.parseTrustToml(text);
    const entry = doc.ok ? doc.value.entries.get("governor_key_fingerprints") : undefined;
    if (entry === undefined) {
        const base = text === "" || text.endsWith("\n") ? text : `${text}\n`;
        return { text: `${base}${base === "" ? "" : "\n"}${newArray()}`, reformatted: false };
    }
    const startIdx = entry.line - 1;
    const extent = arrayExtent(lines, startIdx);
    if (extent === null)
        return { error: "could not locate the end of the governor_key_fingerprints array" };
    if (extent.endIdx === startIdx) {
        const line = lines[startIdx] ?? "";
        const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
        const trailing = line.slice(extent.endCol + 1).trim();
        const out = [];
        if (trailing.startsWith("#"))
            out.push(`${indent}${trailing}${eol}`);
        out.push(`${line.slice(0, extent.openCol + 1).replace(/[ \t]+$/, "")}${eol}`);
        for (const e of entry.stringArray ?? [])
            out.push(`${indent}  "${e}",${eol}`);
        out.push(`${entryLine(`${indent}  `, false)}${eol}`);
        out.push(`${indent}]${eol}`);
        return { text: [...lines.slice(0, startIdx), ...out, ...lines.slice(startIdx + 1)].join("\n"), reformatted: true };
    }
    const closing = lines[extent.endIdx] ?? "";
    if (closing.slice(0, extent.endCol).trim() !== "")
        return { error: "the closing bracket of governor_key_fingerprints shares a line with an entry; put it on its own line" };
    const inserted = `${entryLine("  ", extent.lastToken === "string")}${eol}`;
    return { text: [...lines.slice(0, extent.endIdx), inserted, ...lines.slice(extent.endIdx)].join("\n"), reformatted: false };
}
const sanitisedHost = (host) => {
    const h = host.replace(/[^A-Za-z0-9.-]/g, "").slice(0, 63);
    return h === "" ? "unknown-host" : h;
};
function parseTrustText(text) {
    const doc = trust.parseTrustToml(text);
    if (!doc.ok)
        return { ok: false, message: doc.error.message };
    const config = trust.validateSchema1(doc.value);
    return config.ok ? { ok: true, config: config.value } : { ok: false, message: config.error.message };
}
// --- pin ----------------------------------------------------------------------------------------
function ageOf(checkedAt, now) {
    const then = Date.parse(checkedAt);
    const days = Math.floor((now.getTime() - then) / 86400000);
    if (Number.isNaN(then) || days < 0)
        return "age unknown";
    return days === 1 ? "1 day" : `${days} days`;
}
function prBody(f, commit) {
    const rc = f.runnerChecks;
    const reported = [
        `docker_group: ${printable(rc.docker_group)}`, `sudo_rules: ${printable(rc.sudo_rules)}`, `sudo_absent: ${printable(rc.sudo_absent)}`,
        `independent: ${printable(rc.independent)}`, `checked_at: ${printable(rc.checked_at)}`,
        `install_version: ${printable(rc.install_version)}`, `source_tag: ${printable(rc.source_tag)}`,
    ];
    const parts = [
        `Target repository: ${f.repo}, base branch: ${f.base}`,
        `Governor key fingerprint: \`${f.fingerprint}\``,
        `Pushed commit: \`${commit}\``,
        [
            "Checked by `commissaire governor pin`:",
            `- host: ${f.host}`,
            `- runner user: ${printable(f.runnerUser)} (uid ${f.runner.uid})`,
            `- governor process uid: ${f.peerUid}, which differs from the runner's uid ${f.runner.uid} and the invoker's uid ${f.invokerUid}`,
            `- runner groups (${printable(f.runner.groups.join(", "), 200)}) checked against the root-equivalent list (${f.groupsChecked.join(", ")}): none match`,
            `- key directory: ${printable(f.keyDir.dir, 200)}, owner uid ${f.keyDir.owner}, mode ${f.keyDir.mode.toString(8).padStart(4, "0")}`,
        ].join("\n"),
        ["Reported by the governor:", ISO_UTC.test(rc.checked_at) ? `checked_at ${rc.checked_at}, record age ${ageOf(rc.checked_at, f.now)}` : "record age unknown", "```", ...reported, "```"].join("\n"),
    ];
    if (f.reformatted)
        parts.push(REFORMAT_LINE);
    parts.push(APPROVE_SENTENCE);
    return `${parts.join("\n\n")}\n`;
}
const COMMIT_RE = /^[0-9a-f]{40,64}$/;
function prHeadOid(stdout) {
    try {
        const parsed = JSON.parse(stdout);
        const oid = isRecord(parsed) ? str(parsed.headRefOid) : undefined;
        return oid !== undefined && COMMIT_RE.test(oid) ? oid : null;
    }
    catch {
        return null;
    }
}
// The trust file is written into a fresh checkout of the base branch, which can carry symlinks.
function trustPathProblem(dir, file) {
    const real = (p, want) => {
        let st;
        try {
            st = fs.lstatSync(p);
        }
        catch {
            return null;
        }
        if (st.isSymbolicLink() || !(want === "directory" ? st.isDirectory() : st.isFile()))
            return `${path.basename(p)} on the base branch is a symlink or not a regular ${want}; refusing to write ${TRUST_PATH} through it`;
        return null;
    };
    return real(dir, "directory") ?? real(file, "file");
}
function writeNoFollow(file, text) {
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o644);
    try {
        fs.writeFileSync(fd, text);
    }
    finally {
        fs.closeSync(fd);
    }
}
function openPullRequest(deps, c) {
    const branch = `commissaire/pin-${c.fingerprint.slice(0, 12)}`;
    const title = `chore(commissaire): pin governor key ${c.fingerprint.slice(0, 12)}`;
    const cwd = deps.cwd();
    const fail = (reason, detail) => ({ pinned: "refused", pk_fingerprint: c.fingerprint, reason, detail, pr_url: null, branch: null });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "commissaire-pin-"));
    const worktree = path.join(tmp, "wt");
    let branchCreated = false;
    const git = (args, dir = cwd) => deps.runGit(c.git, args, dir);
    const gitFailed = (what, r) => fail("git-failed", `${what}: ${printable(r.stderr.trim() || `exit ${r.status}`, 300)}`);
    try {
        const fetched = git(["fetch", "origin", `+refs/heads/${c.base}:refs/remotes/origin/${c.base}`]);
        if (fetched.status !== 0)
            return gitFailed("git fetch", fetched);
        const added = git(["worktree", "add", "--no-track", "-b", branch, worktree, `origin/${c.base}`]);
        if (added.status !== 0)
            return gitFailed("git worktree add", added);
        branchCreated = true;
        const file = path.join(worktree, TRUST_PATH);
        const unsafe = trustPathProblem(path.dirname(file), file);
        if (unsafe !== null)
            return fail("trust-file-invalid", unsafe);
        const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
        if (current !== c.originalText)
            return fail("base-moved", "the base branch changed since the trust file was read; re-run pin");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        writeNoFollow(file, c.newText);
        const staged = git(["add", "--", TRUST_PATH], worktree);
        if (staged.status !== 0)
            return gitFailed("git add", staged);
        const committed = git(["commit", "--signoff", "-m", title], worktree);
        if (committed.status !== 0)
            return gitFailed("git commit", committed);
        const push = git(["push", "-u", "origin", branch], worktree);
        if (push.status !== 0)
            return gitFailed("git push", push);
        const head = git(["rev-parse", "HEAD"], worktree);
        const commit = head.stdout.trim();
        if (head.status !== 0 || !COMMIT_RE.test(commit))
            return gitFailed("git rev-parse", head);
        const created = deps.runGh(c.gh, ["pr", "create", "--repo", c.repo, "--base", c.base, "--head", branch, "--title", title, "--body", c.makeBody(commit)]);
        if (created.status !== 0) {
            const removal = git(["push", "origin", "--delete", branch], worktree);
            const where = removal.status === 0 ? "the remote branch was deleted" : `the remote branch ${branch} could not be deleted and remains`;
            return fail("gh-failed", `gh pr create: ${printable(created.stderr.trim() || `exit ${created.status}`, 300)}; ${where}`);
        }
        const url = (created.stdout.trim().split("\n").pop() ?? "").trim();
        if (!prUrlFor(url, c.repo)) {
            const removal = git(["push", "origin", "--delete", branch], worktree);
            const where = removal.status === 0 ? "the remote branch was deleted" : `the remote branch ${branch} could not be deleted and remains`;
            return fail("gh-failed", `gh pr create printed no PR URL for ${c.repo} (${printable(url || "empty output", 200)}); ${where}`);
        }
        const opened = deps.runGh(c.gh, ["pr", "view", url, "--repo", c.repo, "--json", "headRefOid"]);
        const openedOid = opened.status === 0 ? prHeadOid(opened.stdout) : null;
        if (openedOid !== commit) {
            const closed = deps.runGh(c.gh, ["pr", "close", url, "--repo", c.repo, "--delete-branch"]);
            const removal = closed.status === 0 ? closed : git(["push", "origin", "--delete", branch], worktree);
            const cleanup = closed.status === 0 ? "the PR was closed and its branch deleted"
                : removal.status === 0 ? `gh pr close failed; the remote branch ${branch} was deleted, which closes the PR`
                    : `the PR ${printable(url, 200)} could not be closed and the remote branch ${branch} remains`;
            const seen = openedOid === null ? "its head commit could not be read" : `its head is ${openedOid}`;
            return fail("pr-head-mismatch", `the PR does not carry the pushed commit ${commit}: ${seen}; ${cleanup}`);
        }
        return { pinned: "opened-pr", pk_fingerprint: c.fingerprint, reason: null, detail: null, pr_url: url, branch };
    }
    finally {
        if (fs.existsSync(worktree))
            git(["worktree", "remove", "--force", worktree]);
        if (branchCreated)
            git(["branch", "-D", branch]);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}
// pin steps 9 to 13, shared by both transports: repository, base, branch protection, trust file, then the PR.
function pinTail(t) {
    const { flags, deps, git, gh, repo, fingerprint } = t;
    const refused = (r) => ({ result: { pinned: "refused", pk_fingerprint: fingerprint, reason: r.reason, detail: r.detail, pr_url: null, branch: null } });
    // 9. repository, base, branch protection, trust file
    const origin = readOrigin(deps, git);
    if (origin.kind === "none")
        return refused(refusal("no-remote-base", "no git remote named origin"));
    if (origin.kind === "unparseable")
        return refused(refusal("repo-mismatch", `origin ${printable(origin.url, 200)} does not name a github.com OWNER/NAME (another host, an SSH host alias, or an unparseable URL); set origin to https://github.com/${repo} or git@github.com:${repo}; --repo is ${repo}`));
    if (!sameRepo(origin.repo, repo))
        return refused(refusal("repo-mismatch", `origin names ${origin.repo} but --repo is ${repo}`));
    const base = t.baseFlag ?? defaultBranch(deps, gh, repo);
    if (base === null)
        return refused(refusal("gh-failed", `could not read the default branch of ${repo}`));
    const protection = branchProtection(deps, gh, repo, base);
    if (protection.state === "not-met")
        return refused(refusal("base-not-protected", `${base} has no pull_request rule; a pin on a base the runner can push to proves nothing`));
    if (protection.state === "unknown")
        return refused(refusal("base-protection-unknown", `the rules for ${base} could not be read`));
    const read = trust.readTrustFileText({ repoDir: deps.cwd(), ref: base, transport: "remote", repoSlug: repo, gitBin: git, ghBin: gh });
    if (!read.ok)
        return refused(refusal("gh-failed", read.error.message));
    const existing = read.value;
    let currentConfig = null;
    if (existing.present && existing.text !== null) {
        const parsed = parseTrustText(existing.text);
        if (!parsed.ok)
            return refused(refusal("trust-file-invalid", parsed.message));
        currentConfig = parsed.config;
    }
    // 10 and 11. already pinned, or edit in place
    if (currentConfig !== null && currentConfig.governorKeyFingerprints.includes(fingerprint)) {
        return { result: { pinned: "already-pinned", pk_fingerprint: fingerprint, reason: null, detail: null, pr_url: null, branch: null } };
    }
    const now = deps.now();
    const edited = insertFingerprint(existing.text, fingerprint, t.variant.comment(now));
    if ("error" in edited)
        return refused(refusal("trust-file-invalid", edited.error));
    const reparsed = parseTrustText(edited.text);
    if (!reparsed.ok)
        return refused(refusal("trust-file-invalid", reparsed.message));
    const expected = [...(currentConfig?.governorKeyFingerprints ?? []), fingerprint];
    if (reparsed.config.governorKeyFingerprints.join(",") !== expected.join(","))
        return refused(refusal("trust-file-invalid", "the edited trust file does not list exactly the old fingerprints plus the new one"));
    // 12. dry run
    if (flags["--dry-run"] === true) {
        return { result: { pinned: "dry-run", pk_fingerprint: fingerprint, reason: null, detail: edited.text, pr_url: null, branch: null } };
    }
    // 13. branch and PR
    const facts = { repo, base, fingerprint, now, reformatted: edited.reformatted };
    return { result: openPullRequest(deps, { git, gh, repo, base, fingerprint, newText: edited.text, originalText: existing.text, makeBody: (commit) => t.variant.body(facts, commit) }) };
}
function parseFlyIdentify(stdout) {
    const line = stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).pop();
    if (line === undefined)
        return null;
    try {
        const parsed = JSON.parse(line);
        return isRecord(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function flyBody(app, sourceCommit) {
    return (f, commit) => {
        const parts = [
            `Target repository: ${f.repo}, base branch: ${f.base}`,
            `Governor key fingerprint: \`${f.fingerprint}\``,
            `Pushed commit: \`${commit}\``,
            [
                `Fly app: \`${app}\``,
                `Image source commit: ${sourceCommit === null ? "not reported by the governor" : `\`${sourceCommit}\``}`,
            ].join("\n"),
            [
                "Read by `commissaire governor pin --fly-app` from its own `fly ssh console` session inside the governor machine, and checked against the SHA-256 of the SPKI-DER public key the governor reported.",
                "To read the same fingerprint independently before approving, run:",
                "```",
                `fly ssh console -a ${app} -C "${FLY_IDENTIFY_COMMAND}"`,
                "```",
            ].join("\n"),
            ["Checklist for the approving human (pin cannot observe these Fly facts):", ...FLY_CHECKLIST.map((item) => `- [ ] ${item}`)].join("\n"),
        ];
        if (f.reformatted)
            parts.push(REFORMAT_LINE);
        parts.push(APPROVE_SENTENCE);
        return `${parts.join("\n\n")}\n`;
    };
}
// `pin --fly-app APP`: the identify reply is read from the operator's own `fly ssh console` process,
// never from a file, and the local host-fact checks (peer uid, key directory, runner groups, install
// record, key readability) are skipped because they describe a governor on this machine.
function pinViaFly(flags, deps, app) {
    const target = parseTarget("pin", flags, true, true);
    if (isUsage(target))
        return target;
    const { runnerUser, repo, base: baseFlag } = target;
    if (runnerUser === undefined || repo === undefined)
        return { usage: "faff commissaire governor pin: missing required flag" };
    const refused = (r, fingerprint = null) => ({ result: { pinned: "refused", pk_fingerprint: fingerprint, reason: r.reason, detail: r.detail, pr_url: null, branch: null } });
    const who = invokerChecks(deps, runnerUser);
    if (!who.ok)
        return refused(who.refusal);
    const runner = who.runner;
    const codeProblem = codeWritable(deps, runner);
    if (codeProblem !== null)
        return refused(codeProblem);
    const git = deps.resolveBin("git"), gh = deps.resolveBin("gh"), fly = deps.resolveBin("fly");
    if (git === null)
        return refused(refusal("git-failed", "git was not found on PATH"));
    if (gh === null)
        return refused(refusal("gh-failed", "gh was not found on PATH"));
    if (fly === null)
        return refused(refusal("fly-failed", "fly was not found on PATH"));
    const binProblem = binWritable(deps, runner, "git", git) ?? binWritable(deps, runner, "gh", gh) ?? binWritable(deps, runner, "fly", fly);
    if (binProblem !== null)
        return refused(binProblem);
    const repoProblem = repoWritable(deps, runner);
    if (repoProblem !== null)
        return refused(repoProblem);
    const ran = deps.runFly(fly, ["ssh", "console", "-a", app, "-C", FLY_IDENTIFY_COMMAND]);
    if (ran.status !== 0)
        return refused(refusal("governor-unreachable", `fly ssh console failed: ${printable(ran.stderr.trim() || `exit ${ran.status}`, 300)}`));
    const reply = parseFlyIdentify(ran.stdout);
    if (reply === null)
        return refused(refusal("identify-invalid", "fly ssh console printed no identify reply"));
    const found = readIdentifyReply(reply, -1);
    if (found.kind === "refused")
        return refused(refusal("governor-refused", found.reason));
    if (found.kind === "invalid")
        return refused(refusal("identify-invalid", "the identify reply is missing or mistypes a field"));
    if (found.kind === "mismatch")
        return refused(refusal("fingerprint-mismatch", "the reported fingerprint does not match the reported public key"));
    if (found.kind !== "ok")
        return refused(refusal("identify-invalid", "the identify reply could not be read"));
    const fingerprint = found.identified.fingerprint;
    const reported = str(reply.source_commit);
    const sourceCommit = reported !== undefined && COMMIT_RE.test(reported) ? reported : null;
    return pinTail({
        flags, deps, git, gh, repo, baseFlag, fingerprint,
        variant: {
            comment: (now) => `fly app ${app}, pinned ${now.toISOString().slice(0, 10)}`,
            body: flyBody(app, sourceCommit),
        },
    });
}
function pinCore(flags, deps = DEFAULT_DEPS) {
    if ("--fly-app" in flags) {
        const app = flagStr(flags, "--fly-app");
        if (app === undefined || !FLY_APP_RE.test(app))
            return { usage: "faff commissaire governor pin: --fly-app must be a Fly app name matching ^[a-z0-9-]+$" };
        return pinViaFly(flags, deps, app);
    }
    const target = parseTarget("pin", flags, true);
    if (isUsage(target))
        return target;
    const { endpoint, runnerUser, repo, base: baseFlag } = target;
    if (endpoint === null || runnerUser === undefined || repo === undefined)
        return { usage: "faff commissaire governor pin: missing required flag" };
    let fingerprint = null;
    const refused = (r) => ({ result: { pinned: "refused", pk_fingerprint: fingerprint, reason: r.reason, detail: r.detail, pr_url: null, branch: null } });
    // 2. platform and transport
    const platform = platformOf(deps);
    if (platform !== "linux")
        return refused(refusal("platform-unsupported", "macOS governor install is tracked in FAFF-1251"));
    if (endpoint.kind === "tcp")
        return refused(refusal("remote-governor-unsupported", "pinning a remote governor is FAFF-1181"));
    // 3. invoker, runner, and what the runner could tamper with
    const who = invokerChecks(deps, runnerUser);
    if (!who.ok)
        return refused(who.refusal);
    const runner = who.runner;
    const codeProblem = codeWritable(deps, runner);
    if (codeProblem !== null)
        return refused(codeProblem);
    const git = deps.resolveBin("git"), gh = deps.resolveBin("gh");
    if (git === null)
        return refused(refusal("git-failed", "git was not found on PATH"));
    if (gh === null)
        return refused(refusal("gh-failed", "gh was not found on PATH"));
    const binProblem = binWritable(deps, runner, "git", git) ?? binWritable(deps, runner, "gh", gh);
    if (binProblem !== null)
        return refused(binProblem);
    const repoProblem = repoWritable(deps, runner);
    if (repoProblem !== null)
        return refused(repoProblem);
    // 4. the governor's key, from the socket
    const found = identify(deps, endpoint);
    if (found.kind === "unreachable")
        return refused(refusal("governor-unreachable", found.detail));
    if (found.kind === "refused")
        return refused(refusal("governor-refused", found.reason));
    if (found.kind === "invalid")
        return refused(refusal("identify-invalid", "the identify reply is missing or mistypes a field"));
    if (found.kind === "mismatch")
        return refused(refusal("fingerprint-mismatch", "the reported fingerprint does not match the reported public key"));
    const id = found.identified;
    fingerprint = id.fingerprint;
    // 5 to 7. host facts
    const host = governorHostChecks(deps, runner, platform, id, true);
    if ("refusal" in host)
        return refused(host.refusal);
    // 8. the runner checks record
    const installProblem = installCheck(id.runnerChecks, runnerUser, runner);
    if (installProblem !== null)
        return refused(installProblem);
    const runnerChecks = id.runnerChecks;
    if (runnerChecks === null)
        return refused(refusal("install-record-missing"));
    return pinTail({
        flags, deps, git, gh, repo, baseFlag, fingerprint: id.fingerprint,
        variant: {
            comment: (now) => `${sanitisedHost(deps.hostname())} governor uid ${id.peerUid}, pinned ${now.toISOString().slice(0, 10)}`,
            body: (f, commit) => prBody({
                repo: f.repo, base: f.base, fingerprint: f.fingerprint, host: sanitisedHost(deps.hostname()), runnerUser, runner, peerUid: id.peerUid,
                invokerUid: deps.getuid(), groupsChecked: ROOT_EQUIVALENT_GROUPS[platform] ?? [], keyDir: host.facts, runnerChecks, now: f.now, reformatted: f.reformatted,
            }, commit),
        },
    });
}
// --- status -------------------------------------------------------------------------------------
const normaliseLogin = (login) => login.replace(/\[bot\]$/, "").toLowerCase();
function statusCore(flags, deps = DEFAULT_DEPS) {
    const target = parseTarget("status", flags, false);
    if (isUsage(target))
        return target;
    const { endpoint, runnerUser, repo: repoFlag, base: baseFlag } = target;
    const runnerLogin = flagStr(flags, "--runner-login");
    const platform = platformOf(deps);
    const caveats = [];
    const result = {
        custody: endpoint === null ? "in-process" : "governor",
        socket: "not-configured", transport: endpoint === null ? null : endpoint.kind, governor_uid: null,
        runner_user: runnerUser ?? null, host_checks: "unknown", pk_fingerprint: null, pinned_on_base: "unknown", trust_source: null,
        runner_checks: null, install_result: "unknown",
        counting: { remote_base: { state: "unknown", reason: null }, branch_protection: { state: "unknown", reason: null }, runner_identity: { state: "unknown", reason: null } },
        ready_to_count: false, caveats,
    };
    const foundGit = deps.resolveBin("git"), foundGh = deps.resolveBin("gh");
    // pin would refuse to run git or gh from a place the runner can edit; status then does not run them.
    const runnerLookup = runnerUser === undefined ? null : invokerChecks(deps, runnerUser);
    const custodyRunner = runnerLookup !== null && runnerLookup.ok ? runnerLookup.runner : null;
    const gitProblem = custodyRunner !== null && foundGit !== null ? binWritable(deps, custodyRunner, "git", foundGit) : null;
    const ghProblem = custodyRunner !== null && foundGh !== null ? binWritable(deps, custodyRunner, "gh", foundGh) : null;
    const repoCustody = custodyRunner === null ? null : repoWritable(deps, custodyRunner);
    const repoProblem = repoCustody !== null && repoCustody.reason === "repo-runner-writable" ? repoCustody : null;
    const gitBlock = gitProblem !== null ? "git-runner-writable" : repoProblem !== null ? "repo-runner-writable" : null;
    const ghBlock = ghProblem !== null ? "gh-runner-writable" : null;
    const gitBin = gitBlock === null ? foundGit : null, ghBin = ghBlock === null ? foundGh : null;
    // 1 and 2. the governor and the host facts
    let runner = null;
    let invokerFailure = null;
    if (runnerLookup !== null) {
        if (runnerLookup.ok)
            runner = runnerLookup.runner;
        else if (runnerLookup.refusal.reason !== "runner-user-unknown")
            invokerFailure = `failed:${runnerLookup.refusal.reason}`;
    }
    else if (deps.getuid() === 0)
        invokerFailure = "failed:invoked-as-root";
    if (invokerFailure !== null)
        result.host_checks = invokerFailure;
    let identified = null;
    if (endpoint !== null && endpoint.kind === "unix") {
        const found = identify(deps, endpoint);
        if (found.kind === "ok") {
            identified = found.identified;
            result.socket = "answers";
            result.pk_fingerprint = identified.fingerprint;
            result.governor_uid = identified.peerUid;
            result.runner_checks = identified.runnerChecks;
            if (invokerFailure === null && runner !== null && platform === "linux") {
                const host = governorHostChecks(deps, runner, platform, identified, false);
                result.host_checks = "refusal" in host ? `failed:${host.refusal.reason}` : "passed";
            }
        }
        else if (found.kind === "refused")
            result.socket = `refused:${found.reason}`;
        else if (found.kind === "unreachable")
            result.socket = "unreachable";
        else
            result.socket = "invalid-reply";
    }
    else if (endpoint !== null) {
        caveats.push("Remote governors over TCP are not supported until FAFF-1181; the socket was not queried.");
    }
    // 3. the install record
    if (identified !== null && runner !== null && runnerUser !== undefined) {
        const problem = identified.runnerChecks === null ? null : installCheck(identified.runnerChecks, runnerUser, runner);
        result.install_result = identified.runnerChecks === null ? "missing" : problem === null ? "passed" : "failed";
    }
    // 4. the remote base
    const origin = gitBin === null ? { kind: "none" } : readOrigin(deps, gitBin);
    const repo = repoFlag ?? (origin.kind === "ok" ? origin.repo : null);
    const mismatch = repoFlag !== undefined && (origin.kind === "unparseable" || (origin.kind === "ok" && !sameRepo(origin.repo, repoFlag)));
    let base = baseFlag ?? null;
    if (base === null && repo !== null && ghBin !== null)
        base = defaultBranch(deps, ghBin, repo);
    let remoteConfig = null;
    let remoteRead = false;
    const remote = result.counting.remote_base;
    let readLocal = true;
    if (gitBlock !== null) {
        remote.state = "unknown";
        remote.reason = gitBlock;
    }
    else if (origin.kind === "none") {
        remote.state = "not-met";
        remote.reason = "no-remote-base";
    }
    else if (mismatch) {
        remote.state = "not-met";
        remote.reason = "repo-mismatch";
    }
    else if (repo === null || ghBin === null || gitBin === null || base === null) {
        remote.state = "unknown";
        remote.reason = ghBlock ?? "gh-unavailable";
    }
    else {
        const read = trust.readTrustFile({ repoDir: deps.cwd(), ref: base, transport: "remote", repoSlug: repo, gitBin, ghBin });
        if (read.ok) {
            remote.state = "met";
            result.trust_source = "remote-base";
            remoteConfig = read.value.config;
            remoteRead = true;
            readLocal = false;
        }
        else if (read.error.stage !== "Read") {
            return { error: { error: "trust-file-invalid", detail: read.error.message } };
        }
        else {
            remote.state = "unknown";
            remote.reason = "gh-unavailable";
        }
    }
    if (readLocal && gitBin !== null) {
        const ref = origin.kind === "ok" && base !== null ? `origin/${base}` : (base ?? "HEAD");
        const local = trust.readTrustFile({ repoDir: deps.cwd(), ref, transport: "local", gitBin });
        if (local.ok)
            result.trust_source = "local-ref";
        else if (local.error.stage !== "Read")
            return { error: { error: "trust-file-invalid", detail: local.error.message } };
    }
    // 5. is the identified governor pinned
    if (identified !== null && result.trust_source === "remote-base") {
        result.pinned_on_base = remoteConfig !== null && remoteConfig.governorKeyFingerprints.includes(identified.fingerprint) ? "yes" : "no";
    }
    // 6. branch protection
    const protection = result.counting.branch_protection;
    if (ghBlock !== null) {
        protection.state = "unknown";
        protection.reason = ghBlock;
    }
    else if (repo === null) {
        protection.state = "unknown";
        protection.reason = "repo-unknown";
    }
    else if (base === null) {
        protection.state = "unknown";
        protection.reason = "gh-unavailable";
    }
    else
        Object.assign(protection, branchProtection(deps, ghBin, repo, base));
    // 7. runner identity
    const identity = result.counting.runner_identity;
    if (runnerLogin === undefined) {
        identity.state = "unknown";
        identity.reason = "runner-login-not-given";
    }
    else if (ghBlock !== null) {
        identity.state = "unknown";
        identity.reason = ghBlock;
    }
    else {
        const me = ghBin === null ? null : deps.runGh(ghBin, ["api", "user"]);
        let human;
        if (me !== null && me.status === 0) {
            try {
                const parsed = JSON.parse(me.stdout);
                human = isRecord(parsed) ? str(parsed.login) : undefined;
            }
            catch {
                human = undefined;
            }
        }
        if (human === undefined || human === "") {
            identity.state = "unknown";
            identity.reason = "human-login-unreadable";
        }
        else if (normaliseLogin(runnerLogin) === normaliseLogin(human)) {
            identity.state = "not-met";
            identity.reason = "runner-identity-not-separate";
        }
        else if (!remoteRead) {
            identity.state = "unknown";
            identity.reason = "approvers-unreadable";
        }
        else if ((remoteConfig?.pinChangeApprovers ?? []).map(normaliseLogin).includes(normaliseLogin(runnerLogin))) {
            identity.state = "not-met";
            identity.reason = "runner-is-pin-approver";
        }
        else {
            identity.state = "met";
            identity.reason = null;
        }
    }
    // 8. caveats
    caveats.push(BYPASS_CAVEAT, LOGIN_CAVEAT, KEY_OPEN_CAVEAT);
    if (platform === "macos")
        caveats.push("macOS governors are not supported until FAFF-1251.");
    if (runner !== null) {
        for (const problem of [codeWritable(deps, runner), gitProblem, ghProblem, repoProblem]) {
            if (problem !== null)
                caveats.push(`pin would refuse ${problem.reason}: ${problem.detail ?? ""}`);
        }
    }
    // 9. ready_to_count
    const conditionsMet = Object.values(result.counting).every((c) => c.state === "met");
    const everythingButPin = result.custody === "governor" && result.transport === "unix" && result.host_checks === "passed" && result.install_result === "passed" && conditionsMet;
    result.ready_to_count = everythingButPin && result.pinned_on_base === "yes";
    if (everythingButPin && result.pinned_on_base === "no")
        caveats.push("Only the pin is missing: merge the pin PR on the base branch.");
    return { result };
}
// --- CLI entry points ----------------------------------------------------------------------------
function usageExit(message) {
    process.stderr.write(`${message}\n`);
    return 2;
}
function governorPin(flags, deps) {
    const outcome = pinCore(flags, deps);
    if ("usage" in outcome)
        return usageExit(outcome.usage);
    console.log(JSON.stringify(outcome.result));
    return outcome.result.pinned === "refused" ? 1 : 0;
}
function governorStatus(flags, deps) {
    const outcome = statusCore(flags, deps);
    if ("usage" in outcome)
        return usageExit(outcome.usage);
    if ("error" in outcome) {
        console.log(JSON.stringify(outcome.error));
        return 2;
    }
    console.log(JSON.stringify(outcome.result));
    return 0;
}
// The thin client behind `commissaire governor identify --json`: one identify request over the governor's
// local Unix socket, the reply printed as JSON. On a Fly machine it runs inside the operator's own
// `fly ssh console` session as uid 0, the governor's admin caller. `source_commit` names the install
// directory the running code was loaded from, when that directory is /opt/commissaire/<commit>/.
function installSourceCommit() {
    try {
        const m = FLY_INSTALL_COMMIT_RE.exec(`${fs.realpathSync(__dirname)}/`);
        return m !== null && m[1] !== undefined ? m[1] : null;
    }
    catch {
        return null;
    }
}
function governorIdentify(flags, request = governorClient.governorRequest) {
    const socketFlag = flagStr(flags, "--socket");
    const keyDirFlag = flagStr(flags, "--key-dir");
    const keyDir = keyDirFlag ?? (process.env.COMMISSAIRE_KEY_DIR || path.join(os.homedir(), ".local", "state", "commissaire"));
    const socket = socketFlag ?? path.join(keyDir, "governor.sock");
    const res = request({ kind: "unix", socket_path: socket }, { op: "identify" }, TIMEOUTS);
    if ("unreachable" in res) {
        console.log(JSON.stringify({ ok: false, reason: "governor-unreachable", detail: res.detail }));
        return 1;
    }
    const commit = installSourceCommit();
    console.log(JSON.stringify(res.reply.ok === true && commit !== null ? { ...res.reply, source_commit: commit } : res.reply));
    return res.reply.ok === true ? 0 : 1;
}
module.exports = {
    governorPin, governorStatus, governorIdentify, pinCore, statusCore, insertFingerprint, repoFromRemoteUrl, rulesRequirePullRequest,
    ROOT_EQUIVALENT_GROUPS, DEFAULT_DEPS,
};
