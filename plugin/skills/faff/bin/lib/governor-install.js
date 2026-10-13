"use strict";
// ===========================================================================
// === region:factory — governor-install — FAFF-1216: install the Commissaire governor as its own OS user on Linux (ADR 0135) ===
//
// `commissaire governor install` (and `uninstall`): a root-run command that sets up the governor as a
// hidden system user behind a systemd service, with a key directory, socket directory and program copy
// the runner's user cannot tamper with, and records the runner's routes to root-equivalent power.
//
// The plan is data and execution is injected. `planLinux` reads the host through a read-only `Host` and
// returns an ordered list of ops; an `Executor` applies them. Tests drive both seams without root.
// Commissaire never calls sudo or doas to gain privilege: the one `sudo` call is the escape-route
// check's read-only `sudo -n -l -U <runner>`, made while already root. Lazily required by
// COMMISSAIRE_DISPATCH, so it stays out of bin/commissaire's static import closure.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const RELEASE_REPO_URL = "https://github.com/shftwst/faff.git";
const TAG_PATTERN = /^faff--v[0-9]+\.[0-9]+\.[0-9]+$/;
const GOVERNOR_USER = "commissaire";
const CLIENT_GROUP = "commissaire-clients";
const DEFAULT_KEY_DIR = "/var/lib/commissaire";
const DEFAULT_SOCKET_DIR = "/var/lib/commissaire-socket";
const DEFAULT_PREFIX = "/opt/commissaire";
const UNIT_NAME = "commissaire-governor.service";
const UNIT_PATH = `/etc/systemd/system/${UNIT_NAME}`;
const TOOL_DIRS = ["/usr/sbin", "/usr/bin", "/sbin", "/bin"];
const SYSTEM_PATH = "/usr/sbin:/usr/bin:/sbin:/bin";
const SEARCH_PATH = `${SYSTEM_PATH}:/usr/local/sbin:/usr/local/bin`;
const REQUIRED_TOOLS = ["useradd", "userdel", "groupadd", "groupdel", "gpasswd", "systemctl", "getent", "id", "git"];
const NOLOGIN_PATHS = ["/usr/sbin/nologin", "/sbin/nologin"];
const SUDO_PATHS = ["/usr/bin/sudo", "/usr/local/bin/sudo", "/bin/sudo", "/usr/sbin/sudo", "/usr/local/sbin/sudo"];
const DOAS_PATHS = ["/usr/bin/doas", "/usr/local/bin/doas", "/bin/doas", "/usr/sbin/doas", "/usr/local/sbin/doas"];
const DOAS_CONF_PATHS = ["/etc/doas.conf", "/usr/local/etc/doas.conf"];
const RUNTIME_ASSETS = ["bin/lib/peer-cred-helper.py"];
const TRUSTED_PYTHON = "/usr/bin/python3";
const VERSION_DIR = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/;
const USER_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const FINGERPRINT_TIMEOUT_MS = 30_000;
const FINGERPRINT_POLL_MS = 250;
const PROBE_TIMEOUT_MS = 30_000;
class Abort extends Error {
    exit;
    constructor(message, exit) {
        super(message);
        this.exit = exit;
    }
}
function abort(message, exit = 2) {
    throw new Abort(message, exit);
}
// --- Host and executor (production) -----------------------------------------------------------------
const probeEnv = () => ({ PATH: SYSTEM_PATH, LC_ALL: "C" });
function runProcess(cmd, args, env, timeoutMs) {
    const r = spawnSync(cmd, args, { encoding: "utf8", env, timeout: timeoutMs, killSignal: "SIGKILL", cwd: "/" });
    if (r.error)
        return { status: null, stdout: String(r.stdout ?? ""), stderr: String(r.error.message) };
    return { status: r.status, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
}
function createHost() {
    return {
        probe: (cmd, args, opts = {}) => runProcess(cmd, args, opts.env ?? probeEnv(), opts.timeoutMs ?? PROBE_TIMEOUT_MS),
        lstat(p) {
            try {
                const st = fs.lstatSync(p);
                const kind = st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : st.isFile() ? "file" : st.isSocket() ? "socket" : "other";
                return { uid: st.uid, gid: st.gid, mode: st.mode & 0o7777, kind };
            }
            catch {
                return null;
            }
        },
        realpath(p) { try {
            return fs.realpathSync(p);
        }
        catch {
            return null;
        } },
        readdir(p) { try {
            return fs.readdirSync(p);
        }
        catch {
            return [];
        } },
        readFile(p) { try {
            return fs.readFileSync(p);
        }
        catch {
            return null;
        } },
    };
}
const toInt = (s) => (s !== undefined && /^[0-9]+$/.test(s) ? Number(s) : -1);
function getUser(host, name) {
    const r = host.probe("getent", ["passwd", name]);
    if (r.status === 0) {
        const f = r.stdout.trim().split("\n")[0]?.split(":") ?? [];
        const uid = toInt(f[2]), gid = toInt(f[3]);
        if (uid >= 0 && gid >= 0)
            return { name: f[0] ?? name, uid, gid, home: f[5] ?? "", shell: f[6] ?? "" };
    }
    const u = host.probe("id", ["-u", name]), g = host.probe("id", ["-g", name]);
    if (u.status === 0 && g.status === 0) {
        const uid = toInt(u.stdout.trim()), gid = toInt(g.stdout.trim());
        if (uid >= 0 && gid >= 0)
            return { name, uid, gid, home: "", shell: "" };
    }
    return null;
}
function getGroup(host, name) {
    const r = host.probe("getent", ["group", name]);
    if (r.status !== 0)
        return null;
    const f = r.stdout.trim().split("\n")[0]?.split(":") ?? [];
    const gid = toInt(f[2]);
    if (gid < 0)
        return null;
    return { name: f[0] ?? name, gid, members: (f[3] ?? "").split(",").filter((m) => m !== "") };
}
function loginDefsMin(host, key) {
    const text = host.readFile("/etc/login.defs")?.toString("utf8") ?? "";
    const m = new RegExp(`^\\s*${key}\\s+(\\d+)`, "m").exec(text);
    return m && m[1] !== undefined ? Number(m[1]) : 1000;
}
function findTool(host, candidates) {
    for (const c of candidates)
        if (host.lstat(c) !== null)
            return c;
    return null;
}
function toolOnSystemPath(host, tool) {
    return findTool(host, TOOL_DIRS.map((d) => path.join(d, tool)));
}
// The verified real path of a system tool; refuses a tool whose custody chain is loose.
function systemTool(host, tool) {
    const found = toolOnSystemPath(host, tool);
    if (found === null)
        return tool;
    const checked = trustedBinary(host, found);
    if (checked.real === null)
        throw new Error(`tool-not-root-owned: ${tool} at ${found} (${checked.loose} is missing, not root-owned, or group- or world-writable)`);
    return checked.real;
}
function chownTree(p, uid, gid, recursive) {
    fs.lchownSync(p, uid, gid);
    if (!recursive || !fs.lstatSync(p).isDirectory())
        return;
    for (const entry of fs.readdirSync(p))
        chownTree(path.join(p, entry), uid, gid, true);
}
function createExecutor(host) {
    const ids = (owner, group) => {
        const u = getUser(host, owner), g = getGroup(host, group);
        if (u === null)
            throw new Error(`no such user: ${owner}`);
        if (g === null)
            throw new Error(`no such group: ${group}`);
        return { uid: u.uid, gid: g.gid };
    };
    const command = (cmd, args) => {
        const r = runProcess(systemTool(host, cmd), args, { PATH: SYSTEM_PATH, LC_ALL: "C" }, 120_000);
        return r.status === 0 ? { ok: true, value: r.stdout } : { ok: false, message: `${cmd} ${args.join(" ")} failed (${r.status === null ? "no exit" : `exit ${r.status}`}): ${r.stderr.trim() || r.stdout.trim()}` };
    };
    const mkdirParents = (dir) => {
        const missing = [];
        for (let d = dir; !fs.existsSync(d); d = path.dirname(d))
            missing.unshift(d);
        for (const d of missing) {
            fs.mkdirSync(d);
            fs.chownSync(d, 0, 0);
            fs.chmodSync(d, 0o755);
        }
    };
    const assertCheck = (c) => {
        if (c.type === "account") {
            const u = getUser(host, c.name);
            if (u === null)
                return { ok: false, message: `account ${c.name} not found after create` };
            return u.shell === c.shell && u.home === c.home ? { ok: true } : { ok: false, message: `account ${c.name} has shell ${u.shell} and home ${u.home}, want ${c.shell} and ${c.home}` };
        }
        if (c.type === "group_members") {
            const g = getGroup(host, c.group);
            if (g === null)
                return { ok: false, message: `group ${c.group} not found` };
            const want = c.members.slice().sort().join(","), have = g.members.slice().sort().join(",");
            if (want !== have)
                return { ok: false, message: `group ${c.group} members are [${have}], want [${want}]` };
            return g.gid < loginDefsMin(host, "GID_MIN") ? { ok: true } : { ok: false, message: `group ${c.group} is not a system group` };
        }
        const st = host.lstat(c.path);
        if (st === null)
            return { ok: false, message: `${c.path} is missing` };
        const want = ids(c.owner, c.group);
        if (st.uid !== want.uid || st.gid !== want.gid || st.mode !== c.mode) {
            return { ok: false, message: `${c.path} is ${st.uid}:${st.gid} mode ${st.mode.toString(8)}, want ${want.uid}:${want.gid} mode ${c.mode.toString(8)}` };
        }
        return { ok: true };
    };
    const apply = (op) => {
        switch (op.kind) {
            case "create_group": return command("groupadd", ["--system", op.name]);
            case "create_account": return command("useradd", ["--system", "--user-group", "--shell", op.shell, "--home-dir", op.home, "--no-create-home", op.name]);
            case "set_group_members": return command("gpasswd", ["-M", op.members.join(","), op.group]);
            case "restrict_group": {
                const admins = command("gpasswd", ["-A", "", op.group]);
                return admins.ok ? command("gpasswd", ["-r", op.group]) : admins;
            }
            case "delete_account": return command("userdel", [op.name]);
            case "delete_group": return command("groupdel", [op.name]);
            case "service_op": return command("systemctl", op.args);
            case "create_dir": {
                const { uid, gid } = ids(op.owner, op.group);
                mkdirParents(path.dirname(op.path));
                if (!fs.existsSync(op.path))
                    fs.mkdirSync(op.path);
                fs.chownSync(op.path, uid, gid);
                fs.chmodSync(op.path, op.mode);
                return { ok: true };
            }
            case "chown": {
                const { uid, gid } = ids(op.owner, op.group);
                chownTree(op.path, uid, gid, op.recursive);
                return { ok: true };
            }
            case "chmod":
                fs.chmodSync(op.path, op.mode);
                return { ok: true };
            case "write_file": {
                const { uid, gid } = ids(op.owner, op.group);
                mkdirParents(path.dirname(op.path));
                const tmp = path.join(path.dirname(op.path), `.${path.basename(op.path)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
                const fd = fs.openSync(tmp, "wx", 0o600);
                try {
                    fs.writeFileSync(fd, op.content);
                    fs.closeSync(fd);
                    fs.chownSync(tmp, uid, gid);
                    fs.chmodSync(tmp, op.mode);
                    fs.renameSync(tmp, op.path);
                }
                catch (e) {
                    try {
                        fs.unlinkSync(tmp);
                    }
                    catch { /* the original error wins */ }
                    throw e;
                }
                return { ok: true };
            }
            case "copy_file": {
                const { uid, gid } = ids(op.owner, op.group);
                fs.copyFileSync(op.src, op.dest);
                fs.chownSync(op.dest, uid, gid);
                fs.chmodSync(op.dest, op.mode);
                return { ok: true };
            }
            case "remove": {
                if (op.onlyIfEmpty) {
                    if (fs.existsSync(op.path) && fs.readdirSync(op.path).length === 0)
                        fs.rmdirSync(op.path);
                }
                else
                    fs.rmSync(op.path, { recursive: op.recursive, force: true });
                return { ok: true };
            }
            case "make_temp_dir": {
                const dir = fs.mkdtempSync(path.join(op.under, op.prefix));
                fs.chmodSync(dir, 0o700);
                return { ok: true, value: dir };
            }
            case "run_command": {
                const r = runProcess(op.cmd, op.args, op.env, 300_000);
                return r.status === 0 ? { ok: true, value: r.stdout } : { ok: false, message: `${op.cmd} failed (${r.status === null ? "no exit" : `exit ${r.status}`}): ${r.stderr.trim()}` };
            }
            case "assert": return assertCheck(op.check);
        }
    };
    return {
        run(op) {
            try {
                return apply(op);
            }
            catch (e) {
                return { ok: false, message: e instanceof Error ? e.message : String(e) };
            }
        },
    };
}
// --- Custody checks ---------------------------------------------------------------------------------
const looseMode = (mode) => (mode & 0o022) !== 0;
function dirChain(p) {
    const chain = [];
    for (let d = p;; d = path.dirname(d)) {
        chain.unshift(d);
        if (path.dirname(d) === d)
            break;
    }
    return chain;
}
// The first path on the chain from "/" to `p` (inclusive) that is not root-owned or is group- or
// world-writable; null when the whole chain is tight. A path that does not exist yet is skipped.
function firstLooseOnChain(host, p) {
    for (const d of dirChain(p)) {
        const st = host.lstat(d);
        // A symlink's own mode bits are always 0777 and mean nothing; its owner still counts, and its target is checked separately.
        if (st !== null && (st.uid !== 0 || (st.kind !== "symlink" && looseMode(st.mode))))
            return d;
    }
    return null;
}
// The real path of the nearest ancestor of `p` (or `p`) that exists.
function nearestExistingReal(host, p) {
    for (let d = p;; d = path.dirname(d)) {
        const real = host.realpath(d);
        if (real !== null)
            return real;
        if (path.dirname(d) === d)
            return d;
    }
}
function bootstrapText(tag) {
    return [
        "Run install from a root-owned clone of a release tag:",
        `  sudo git clone --depth 1 --branch ${tag} ${RELEASE_REPO_URL} /root/commissaire-${tag}`,
        `  sudo /usr/bin/node /root/commissaire-${tag}/plugin/skills/faff/bin/commissaire governor install \\`,
        `       --runner-user <name> --from-tag ${tag}`,
    ].join("\n");
}
// Install is the one moment root runs Commissaire code, so it must not run code the runner can edit.
// A safety net for an honest mistake, not a control against an edited copy: the control is the bootstrap.
function selfCustodyCheck(host, moduleDir, tag) {
    const dir = host.realpath(moduleDir);
    const binary = host.realpath(path.join(moduleDir, "..", "commissaire"));
    if (dir === null)
        return abort(`install-code-not-root-owned: ${moduleDir}\n${bootstrapText(tag)}`);
    if (binary === null)
        return abort(`install-code-not-root-owned: ${path.join(moduleDir, "..", "commissaire")}\n${bootstrapText(tag)}`);
    const entries = host.readdir(dir).map((e) => host.realpath(path.join(dir, e)) ?? path.join(dir, e));
    for (const target of [dir, binary, ...entries]) {
        const loose = firstLooseOnChain(host, target);
        if (loose !== null)
            abort(`install-code-not-root-owned: ${loose}\n${bootstrapText(tag)}`);
    }
}
// The real path of an interpreter whose literal and resolved chains are both tight; aborts otherwise.
// The unit's ExecStart= names the returned path, so the verified file is the one that runs.
function checkInterpreter(host, node) {
    const hint = "Pass --node <path> with a Node binary from a root-owned system prefix.";
    const checked = trustedBinary(host, node);
    if (checked.real === null)
        return abort(`interpreter-not-root-owned: ${host.realpath(node) ?? node} (${checked.loose} is missing, not root-owned, or group- or world-writable)\n${hint}`);
    if (host.lstat(checked.real)?.kind !== "file")
        return abort(`interpreter-not-root-owned: ${checked.real} (not a regular file)\n${hint}`);
    return checked.real;
}
// Root runs these tools, so each must come from a system directory and sit under a root-owned chain.
// Both the literal path's chain and the resolved path's chain must be tight. Callers execute the returned
// real path, never the literal one, so a link in between cannot be swapped after the check.
function trustedBinary(host, p) {
    const real = host.realpath(p);
    if (real === null)
        return { real: null, loose: p };
    const loose = firstLooseOnChain(host, p) ?? firstLooseOnChain(host, real);
    return loose === null ? { real, loose: null } : { real: null, loose };
}
const trustedBinaryLoose = (host, p) => trustedBinary(host, p).loose;
function requireTools(host) {
    for (const tool of REQUIRED_TOOLS) {
        const found = toolOnSystemPath(host, tool);
        if (found === null)
            abort(`missing tool: ${tool} (not found under ${TOOL_DIRS.join(", ")})`);
        const loose = trustedBinaryLoose(host, found);
        if (loose !== null)
            abort(`tool-not-root-owned: ${tool} at ${found} (${loose} is missing, not root-owned, or group- or world-writable)`);
    }
}
// Tool custody (requireTools) runs earlier, before root executes any tool; this adds python3 and the interpreters.
// Returns the verified real path of `node`.
function preflight(host, node, execPath) {
    const python = trustedBinary(host, TRUSTED_PYTHON);
    if (python.real === null)
        return abort(`tool-not-root-owned: python3 at ${TRUSTED_PYTHON} (${python.loose} is missing, not root-owned, or group- or world-writable)`);
    const py = host.probe(python.real, ["-I", "-c", "import socket, struct"]);
    if (py.status !== 0)
        abort(`python3-missing: ${TRUSTED_PYTHON} cannot import socket and struct; the governor reads peer credentials through it`);
    const real = checkInterpreter(host, node);
    if (execPath !== node)
        checkInterpreter(host, execPath);
    return real;
}
const gitEnv = () => ({
    PATH: SYSTEM_PATH, HOME: "/root", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
});
// The clone is made by root into a root-owned 0700 directory, with a replaced (never inherited)
// environment, so nothing the caller exports reaches git. The source is the constant RELEASE_REPO_URL;
// `file://` is accepted only here, through the exported function, so tests can clone a local bare repo.
function releaseClone(tag, repoUrl = RELEASE_REPO_URL, deps = {}) {
    const host = deps.host ?? createHost();
    const executor = deps.executor ?? createExecutor(host);
    if (!TAG_PATTERN.test(tag))
        abort("from-tag must be a release tag (faff--vX.Y.Z)");
    const isFile = repoUrl.startsWith("file://");
    if (repoUrl !== RELEASE_REPO_URL && !isFile)
        abort(`release clone source must be ${RELEASE_REPO_URL}`);
    const rootHome = host.lstat("/root");
    if (rootHome === null || rootHome.uid !== 0 || rootHome.gid !== 0 || looseMode(rootHome.mode))
        abort("/root must be owned by root:root and not group- or world-writable");
    const made = executor.run({ kind: "make_temp_dir", under: "/root", prefix: "commissaire-release-" });
    if (!made.ok || made.value === undefined)
        return abort(`cannot create the release clone directory: ${made.message ?? "unknown error"}`, 1);
    const dir = made.value;
    const discard = () => { executor.run({ kind: "remove", path: dir, recursive: true, onlyIfEmpty: false }); };
    const env = gitEnv();
    const args = ["-c", "http.sslVerify=true", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always"];
    if (isFile)
        args.push("-c", "protocol.file.allow=always");
    args.push("clone", "--depth", "1", "--branch", tag, "--no-recurse-submodules", "-c", "core.hooksPath=/dev/null", repoUrl, dir);
    const cloned = executor.run({ kind: "run_command", cmd: "git", args, env });
    if (!cloned.ok) {
        discard();
        return abort(`release clone failed: ${cloned.message ?? "unknown error"}`, 1);
    }
    const head = host.probe("git", ["-C", dir, "rev-parse", "HEAD"], { env });
    const tagged = host.probe("git", ["-C", dir, "rev-parse", `refs/tags/${tag}^{commit}`], { env });
    const commit = head.stdout.trim();
    if (head.status !== 0 || tagged.status !== 0 || commit === "" || tagged.stdout.trim() !== commit) {
        discard();
        return abort(`release clone: tag ${tag} does not resolve to the cloned HEAD`, 1);
    }
    return { dir, source_tag: tag, source_commit: commit };
}
// --- Escape-route check -----------------------------------------------------------------------------
function userGroups(host, user) {
    const r = host.probe("id", ["-Gn", user]);
    return r.status === 0 ? r.stdout.trim().split(/\s+/).filter((g) => g !== "") : null;
}
function userGids(host, user) {
    const r = host.probe("id", ["-G", user]);
    if (r.status !== 0)
        return null;
    const ids = r.stdout.trim().split(/\s+/).filter((g) => g !== "").map(toInt);
    return ids.length > 0 && ids.every((g) => g >= 0) ? ids : null;
}
const DOAS_OPTIONS = new Set(["nopass", "nolog", "persist", "nopersist"]);
const DOAS_IDENTITY = /^:?[A-Za-z0-9_.-]+$/;
// True when the config permits the runner, or holds a rule this parser does not understand (fail closed).
function doasPermits(conf, who) {
    const lines = conf.replace(/\\\r?\n/g, " ").split("\n");
    for (const raw of lines) {
        const tokens = raw.replace(/#.*/, "").replace(/([{}])/g, " $1 ").trim().split(/\s+/).filter((t) => t !== "");
        if (tokens.length === 0)
            continue;
        if (tokens[0] === "deny")
            continue;
        if (tokens[0] !== "permit")
            return true;
        let i = 1;
        while (i < tokens.length) {
            const t = tokens[i] ?? "";
            if (DOAS_OPTIONS.has(t)) {
                i++;
                continue;
            }
            if (t === "setenv" || t === "keepenv") {
                i++;
                if (tokens[i] === "{") {
                    while (i < tokens.length && tokens[i] !== "}")
                        i++;
                    if (i >= tokens.length)
                        return true;
                    i++;
                }
                else if (t === "setenv")
                    return true;
                continue;
            }
            break;
        }
        const identity = tokens[i];
        if (identity === undefined || !DOAS_IDENTITY.test(identity))
            return true;
        if (identity.startsWith(":")) {
            const g = identity.slice(1);
            if (who.groups.includes(g) || (/^[0-9]+$/.test(g) && who.gids.includes(Number(g))))
                return true;
        }
        else if (identity === who.user || (/^[0-9]+$/.test(identity) && Number(identity) === who.uid))
            return true;
    }
    return false;
}
// A tool root will execute must be found in the fixed list and sit under a root-owned chain.
// `real` is the verified real path to execute; null when the tool is absent or not trusted.
function trustedTool(host, candidates) {
    const found = findTool(host, candidates);
    return { found, real: found === null ? null : trustedBinary(host, found).real };
}
// A /bin/sh that cannot be trusted is never executed and counts as "present", which fails closed.
function presentByPath(host, name) {
    const sh = trustedBinary(host, "/bin/sh").real;
    if (sh === null)
        return true;
    const r = host.probe(sh, ["-c", `command -v ${name}`], { env: { PATH: SEARCH_PATH, LC_ALL: "C" } });
    return r.status === 0 && (r.stdout.trim().split("\n")[0] ?? "").startsWith("/");
}
// "sudo or doas grants the runner a rule", failing closed. The one sudo call is the read-only
// `sudo -n -l -U <user>`, made while already root; it grants nothing. A sudo that cannot be trusted to
// run as root is never executed and counts as a rule.
function escalationRules(host, user) {
    const sudo = trustedTool(host, SUDO_PATHS);
    const doasKnown = findTool(host, DOAS_PATHS) !== null;
    const doas = doasKnown || presentByPath(host, "doas");
    if (doas) {
        const confPath = findTool(host, DOAS_CONF_PATHS);
        const conf = confPath === null ? null : host.readFile(confPath);
        const groups = userGroups(host, user), gids = userGids(host, user), account = getUser(host, user);
        if (conf === null || groups === null || gids === null || account === null)
            return { sudo_rules: true, sudo_absent: false };
        if (doasPermits(conf.toString("utf8"), { user, uid: account.uid, groups, gids }))
            return { sudo_rules: true, sudo_absent: false };
    }
    if (sudo.found === null) {
        if (presentByPath(host, "sudo"))
            return { sudo_rules: true, sudo_absent: false };
        return { sudo_rules: false, sudo_absent: !doas };
    }
    if (sudo.real === null)
        return { sudo_rules: true, sudo_absent: false };
    const r = host.probe(sudo.real, ["-n", "-l", "-U", user], { env: { PATH: SYSTEM_PATH, LC_ALL: "C" }, timeoutMs: 15_000 });
    if (r.status === 0 && r.stdout.includes("may run the following commands"))
        return { sudo_rules: true, sudo_absent: false };
    if (r.status === 0 && r.stdout.includes("is not allowed to run sudo"))
        return { sudo_rules: false, sudo_absent: false };
    return { sudo_rules: true, sudo_absent: false };
}
function dockerMembership(host, user) {
    const g = host.probe("getent", ["group", "docker"]);
    if (g.status === 2)
        return false;
    if (g.status !== 0)
        return true;
    const listed = (g.stdout.trim().split(":")[3] ?? "").split(",");
    if (listed.includes(user))
        return true;
    const groups = userGroups(host, user);
    return groups === null || groups.includes("docker");
}
function escapeCheck(host, user) {
    return { docker_group: dockerMembership(host, user), ...escalationRules(host, user) };
}
const independentOf = (c) => !c.sudo_rules && !c.docker_group;
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
function requireTargets(text) {
    const out = [];
    const re = /require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
    for (let m = re.exec(text); m !== null; m = re.exec(text))
        if (m[1] !== undefined)
            out.push(m[1]);
    return out;
}
// Reads only inside the clone: a path that resolves outside it (a symlink) aborts the install.
function readInside(host, realRoot, file) {
    const st = host.lstat(file);
    if (st === null || st.kind !== "file")
        return null;
    const real = host.realpath(file);
    if (real === null || !real.startsWith(realRoot + path.sep))
        abort(`release clone path escapes the clone: ${file}`);
    return host.readFile(file);
}
// The static require closure of bin/commissaire (lazy requires included, since the scan reads every
// literal `require("./x")`) plus the non-require assets the closure reads at runtime.
function closureManifest(host, root) {
    const realRoot = host.realpath(root);
    if (realRoot === null)
        return abort(`release clone has no ${root}`, 1);
    const files = new Map();
    const queue = ["bin/commissaire"];
    const add = (rel, mode, required) => {
        if (files.has(rel))
            return rel;
        const data = readInside(host, realRoot, path.join(root, rel));
        if (data === null)
            return required ? abort(`release clone is missing ${rel}`, 1) : null;
        files.set(rel, { rel_path: rel, sha256: sha256(data), source: path.join(root, rel), mode });
        return rel;
    };
    while (queue.length > 0) {
        const rel = queue.shift();
        if (rel === undefined)
            break;
        const added = add(rel, rel === "bin/commissaire" ? 0o755 : 0o644, rel === "bin/commissaire");
        if (added === null)
            continue;
        const text = host.readFile(path.join(root, rel))?.toString("utf8") ?? "";
        for (const target of requireTargets(text)) {
            const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), target));
            if (base.startsWith(".."))
                continue;
            for (const candidate of [base, `${base}.js`]) {
                if (files.has(candidate))
                    break;
                if (host.lstat(path.join(root, candidate))?.kind === "file") {
                    queue.push(candidate);
                    break;
                }
            }
        }
    }
    for (const asset of RUNTIME_ASSETS)
        add(asset, 0o644, true);
    return [...files.values()].sort((a, b) => (a.rel_path < b.rel_path ? -1 : a.rel_path > b.rel_path ? 1 : 0));
}
function manifestVersion(files) {
    const sorted = files.slice().sort((a, b) => (a.rel_path < b.rel_path ? -1 : a.rel_path > b.rel_path ? 1 : 0));
    return sha256(Buffer.from(sorted.map((f) => `${f.rel_path}\0${f.sha256}\n`).join(""), "utf8"));
}
function installCopyOps(host, closure, clone, prefix, node) {
    const version = manifestVersion(closure);
    const dest = path.join(prefix, version);
    const copy = {
        dest, version, source_tag: clone.source_tag, source_commit: clone.source_commit,
        files: closure.map((f) => ({ rel_path: f.rel_path, sha256: f.sha256 })), node,
    };
    const loose = firstLooseOnChain(host, nearestExistingReal(host, prefix));
    if (loose !== null)
        abort(`${loose} must be root-owned and not group- or world-writable (install prefix ancestor)`);
    const manifestText = JSON.stringify({ version, source_tag: clone.source_tag, source_commit: clone.source_commit, files: copy.files }, null, 2) + "\n";
    const manifestPath = path.join(dest, "install-manifest.json");
    const ops = [];
    const root = { owner: "root", group: "root" };
    const destStat = host.lstat(dest);
    let reuse = false;
    if (destStat !== null) {
        if (destStat.kind !== "dir" || destStat.uid !== 0 || looseMode(destStat.mode))
            abort(`${dest} exists and is not a root-owned directory`);
        reuse = closure.every((f) => {
            const have = host.readFile(path.join(dest, f.rel_path));
            return have !== null && sha256(have) === f.sha256;
        });
        if (!reuse)
            ops.push({ kind: "remove", path: dest, recursive: true, onlyIfEmpty: false });
    }
    if (!reuse) {
        const dirs = new Set([prefix, dest]);
        for (const f of closure)
            dirs.add(path.dirname(path.join(dest, f.rel_path)));
        for (const d of [...dirs].sort((a, b) => a.length - b.length))
            ops.push({ kind: "create_dir", path: d, ...root, mode: 0o755 });
        for (const f of closure)
            ops.push({ kind: "copy_file", src: f.source, dest: path.join(dest, f.rel_path), ...root, mode: f.mode });
    }
    const current = host.readFile(manifestPath)?.toString("utf8");
    if (!reuse || current !== manifestText)
        ops.push({ kind: "write_file", path: manifestPath, content: manifestText, ...root, mode: 0o644 });
    return { copy, ops };
}
// --- Directories and service ---------------------------------------------------------------------------
function walkEntries(host, dir, allowedUids, out) {
    for (const name of host.readdir(dir)) {
        const entry = path.join(dir, name);
        const st = host.lstat(entry);
        if (st === null)
            continue;
        if (st.kind === "symlink")
            abort(`${entry} is a symlink inside ${dir}`);
        if (!allowedUids.includes(st.uid))
            abort(`${entry} is owned by uid ${st.uid}, expected root or ${GOVERNOR_USER}`);
        if (st.kind !== "socket" && looseMode(st.mode))
            abort(`${entry} is group- or world-writable (mode ${st.mode.toString(8)})`);
        if (st.kind === "dir")
            walkEntries(host, entry, allowedUids, out);
    }
}
// Verify what is already there, then plan the create-or-fix. A resource owned by anyone but root or
// the governor is never adopted: a runner cannot create root- or governor-owned files, so refusing
// them means it cannot pre-seed a key.
function dirOps(host, plan, governorUid, recursiveChown) {
    const loose = firstLooseOnChain(host, nearestExistingReal(host, path.dirname(plan.path)));
    if (loose !== null)
        abort(`${loose} must be root-owned and not group- or world-writable (ancestor of ${plan.path})`);
    const allowed = governorUid === null ? [0] : [0, governorUid];
    const st = host.lstat(plan.path);
    const ops = [];
    if (st !== null) {
        if (st.kind !== "dir")
            abort(`${plan.path} exists and is not a real directory`);
        if (!allowed.includes(st.uid))
            abort(`${plan.path} is owned by uid ${st.uid}, expected root or ${GOVERNOR_USER}`);
        walkEntries(host, plan.path, allowed, ops);
    }
    ops.push({ kind: "create_dir", path: plan.path, owner: plan.owner, group: plan.group, mode: plan.mode });
    if (st !== null && recursiveChown)
        ops.push({ kind: "chown", path: plan.path, owner: plan.owner, group: plan.group, recursive: true });
    ops.push({ kind: "assert", check: { type: "path", path: plan.path, owner: plan.owner, group: plan.group, mode: plan.mode } });
    return ops;
}
function unitText(u) {
    const defaultKeyDir = u.keyDir === DEFAULT_KEY_DIR;
    const writable = defaultKeyDir ? [u.socketDir] : [u.keyDir, u.socketDir];
    return [
        "[Unit]",
        "Description=Commissaire governor",
        "",
        "[Service]",
        `User=${GOVERNOR_USER}`,
        `ExecStart=${u.node} ${path.join(u.dest, "bin", "commissaire")} governor start --key-dir ${u.keyDir} --socket ${path.join(u.socketDir, "governor.sock")} --socket-group-access`,
        ...(defaultKeyDir ? ["StateDirectory=commissaire", "StateDirectoryMode=0700"] : []),
        `ReadWritePaths=${writable.join(" ")}`,
        "ProtectSystem=strict",
        "ProtectHome=yes",
        "NoNewPrivileges=yes",
        "PrivateTmp=yes",
        "Restart=on-failure",
        "",
        "[Install]",
        "WantedBy=multi-user.target",
        "",
    ].join("\n");
}
function parseUidList(raw) {
    return Array.isArray(raw) ? raw.filter((u) => typeof u === "number" && Number.isInteger(u)) : [];
}
function previousVersion(unit) {
    const exec = (unit ?? "").split("\n").find((l) => l.startsWith("ExecStart="));
    const m = exec === undefined ? null : /([0-9a-f]{64})\/bin\/commissaire/.exec(exec);
    return m && m[1] !== undefined ? m[1] : null;
}
function planLinux(host, inp) {
    const nologin = findTool(host, NOLOGIN_PATHS);
    if (nologin === null)
        return abort(`no nologin shell: neither ${NOLOGIN_PATHS.join(" nor ")} exists`);
    const existing = getUser(host, GOVERNOR_USER);
    if (existing !== null && (!NOLOGIN_PATHS.includes(existing.shell) || existing.home !== inp.keyDir)) {
        abort(`account ${GOVERNOR_USER} exists with shell ${existing.shell} and home ${existing.home}, expected a nologin shell and home ${inp.keyDir}`);
    }
    const group = getGroup(host, CLIENT_GROUP);
    if (group !== null && group.gid >= loginDefsMin(host, "GID_MIN"))
        abort(`group ${CLIENT_GROUP} exists but is not a system group`);
    const members = [inp.runner.name, inp.admin.name];
    const ops = [];
    if (existing === null)
        ops.push({ kind: "create_account", name: GOVERNOR_USER, shell: nologin, home: inp.keyDir });
    ops.push({ kind: "assert", check: { type: "account", name: GOVERNOR_USER, shell: nologin, home: inp.keyDir } });
    if (group === null)
        ops.push({ kind: "create_group", name: CLIENT_GROUP });
    if (group !== null)
        ops.push({ kind: "restrict_group", group: CLIENT_GROUP });
    ops.push({ kind: "set_group_members", group: CLIENT_GROUP, members });
    ops.push({ kind: "assert", check: { type: "group_members", group: CLIENT_GROUP, members } });
    const keyDir = { path: inp.keyDir, owner: GOVERNOR_USER, group: GOVERNOR_USER, mode: 0o700, parents_to_verify: dirChain(path.dirname(inp.keyDir)) };
    const socketDir = { path: inp.socketDir, owner: GOVERNOR_USER, group: CLIENT_GROUP, mode: 0o2750, parents_to_verify: dirChain(path.dirname(inp.socketDir)) };
    ops.push(...dirOps(host, keyDir, existing === null ? null : existing.uid, true));
    const closure = closureManifest(host, path.join(inp.clone.dir, "plugin", "skills", "faff"));
    const { copy, ops: copyOps } = installCopyOps(host, closure, inp.clone, inp.prefix, inp.node);
    const checks = {
        schema: 1, runner_user: inp.runner.name, runner_uid: inp.runner.uid, platform: "linux", socket_group: CLIENT_GROUP,
        docker_group: inp.checks.docker_group, sudo_rules: inp.checks.sudo_rules, sudo_absent: inp.checks.sudo_absent, admin_group: null,
        independent: independentOf(inp.checks), checked_at: inp.checkedAt, install_version: copy.version, source_tag: inp.clone.source_tag,
    };
    const configPath = path.join(inp.keyDir, "governor-config.json");
    const previousConfig = (() => {
        try {
            const parsed = JSON.parse(host.readFile(configPath)?.toString("utf8") ?? "null");
            return typeof parsed === "object" && parsed !== null ? parsed : null;
        }
        catch {
            return null;
        }
    })();
    const oldAllow = parseUidList(previousConfig === null ? undefined : Reflect.get(previousConfig, "allow_uids"));
    const oldAdmin = parseUidList(previousConfig === null ? undefined : Reflect.get(previousConfig, "admin_uids"));
    const allowUids = [inp.runner.uid], adminUids = [inp.admin.uid];
    const configText = JSON.stringify({ allow_uids: allowUids, admin_uids: adminUids, runner_checks: checks }, null, 2) + "\n";
    ops.push({ kind: "write_file", path: configPath, content: configText, owner: GOVERNOR_USER, group: GOVERNOR_USER, mode: 0o600 });
    ops.push({ kind: "assert", check: { type: "path", path: configPath, owner: GOVERNOR_USER, group: GOVERNOR_USER, mode: 0o600 } });
    ops.push(...dirOps(host, socketDir, existing === null ? null : existing.uid, false));
    ops.push(...copyOps);
    const unit = unitText({ node: inp.node, dest: copy.dest, keyDir: inp.keyDir, socketDir: inp.socketDir });
    const previousUnit = host.readFile(UNIT_PATH)?.toString("utf8");
    ops.push({ kind: "write_file", path: UNIT_PATH, content: unit, owner: "root", group: "root", mode: 0o644 });
    const bootstrap = previousUnit === undefined
        ? [["daemon-reload"], ["enable", "--now", UNIT_NAME]]
        : [["daemon-reload"], ["enable", UNIT_NAME], ["restart", UNIT_NAME]];
    for (const args of bootstrap)
        ops.push({ kind: "service_op", args });
    const keep = new Set([copy.version]);
    const previous = previousVersion(previousUnit);
    if (previous !== null)
        keep.add(previous);
    for (const name of host.readdir(inp.prefix).sort()) {
        if (VERSION_DIR.test(name) && !keep.has(name))
            ops.push({ kind: "remove", path: path.join(inp.prefix, name), recursive: true, onlyIfEmpty: false });
    }
    return {
        platform: "linux",
        account: { platform: "linux", user_name: GOVERNOR_USER, group_name: GOVERNOR_USER, uid: existing === null ? null : existing.uid, gid: existing === null ? null : existing.gid, shell: nologin, home: inp.keyDir, real_name: "Commissaire governor", hidden: true },
        key_dir: keyDir, socket_dir: socketDir, install_copy: copy,
        service: { platform: "linux", path: UNIT_PATH, text: unit, bootstrap_ops: bootstrap },
        allow_uids: allowUids, admin_uids: adminUids, client_group: { name: CLIENT_GROUP, members },
        runner_checks: checks, ops,
        replaced: {
            allow_uids: oldAllow.filter((u) => !allowUids.includes(u)),
            admin_uids: oldAdmin.filter((u) => !adminUids.includes(u)),
            group_members: (group === null ? [] : group.members).filter((m) => !members.includes(m)),
        },
    };
}
function executePlan(ops, executor) {
    ops.forEach((op, i) => {
        const r = executor.run(op);
        if (!r.ok)
            abort(`install step ${i + 1} (${op.kind}) failed: ${r.message ?? "unknown error"}`, 1);
    });
}
// --- Fingerprint ------------------------------------------------------------------------------------------
const realClock = {
    now: () => Date.now(),
    sleep: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
};
function learnFingerprint(host, keyDir, clock, timeoutMs = FINGERPRINT_TIMEOUT_MS) {
    const keyFile = path.join(keyDir, "governor-key.json");
    const deadline = clock.now() + timeoutMs;
    for (;;) {
        const raw = host.readFile(keyFile);
        if (raw !== null) {
            try {
                const parsed = JSON.parse(raw.toString("utf8"));
                const fp = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "pk_fingerprint") : undefined;
                if (typeof fp === "string" && fp !== "")
                    return fp;
            }
            catch { /* partially written or unreadable: poll again */ }
        }
        if (clock.now() >= deadline)
            return null;
        clock.sleep(FINGERPRINT_POLL_MS);
    }
}
function contextOf(deps) {
    const host = deps.host ?? createHost();
    return {
        host, executor: deps.executor ?? createExecutor(host),
        io: deps.io ?? { out: (t) => { process.stdout.write(t); }, err: (t) => { process.stderr.write(t); } },
        getuid: deps.getuid ?? (() => (typeof process.getuid === "function" ? process.getuid() : -1)),
        platform: deps.platform ?? (() => (process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux")),
        env: deps.env ?? process.env, execPath: deps.execPath ?? process.execPath, moduleDir: deps.moduleDir ?? __dirname,
        now: deps.now ?? (() => new Date()), clock: deps.clock ?? realClock,
        repoUrl: deps.releaseRepoUrl ?? RELEASE_REPO_URL, fingerprintTimeoutMs: deps.fingerprintTimeoutMs ?? FINGERPRINT_TIMEOUT_MS,
    };
}
const flagString = (flags, name) => {
    const v = flags[name];
    return typeof v === "string" && v !== "" ? v : undefined;
};
function absolutePath(flags, name, fallback) {
    const v = flagString(flags, name);
    if (v === undefined)
        return fallback;
    if (!path.isAbsolute(v))
        abort(`${name} must be an absolute path`);
    if (!SAFE_PATH.test(v) || v.split("/").includes(".."))
        abort(`${name} must match ${SAFE_PATH.source} with no .. segments`);
    return path.normalize(v);
}
function requireRoot(ctx, verb) {
    if (ctx.getuid() !== 0)
        abort(`commissaire governor ${verb} must be run as root`);
    if (ctx.platform() === "macos")
        abort("macOS install is tracked in FAFF-1251");
}
function resolveUser(ctx, name) {
    if (!USER_NAME.test(name))
        return abort(`invalid user name: ${name}`);
    const user = getUser(ctx.host, name);
    return user === null ? abort(`no such user: ${name}`) : user;
}
function finishTimestamp(date) {
    return date.toISOString().replace(/\.\d+Z$/, "Z");
}
function nextSteps(plan, socketPath, runner, admin) {
    return [
        `Set commissaire.governor: ${socketPath} in the runner's .faffrc.yaml (or export COMMISSAIRE_GOVERNOR=${socketPath}).`,
        `Start a new login session for ${runner} and ${admin} so commissaire-clients membership applies.`,
        `As ${admin}, run ${path.join(plan.install_copy.dest, "bin", "commissaire")} governor pin --socket ${socketPath} --runner-user ${runner} --repo <OWNER/NAME>, from the install copy, never a checkout.`,
    ];
}
function renderInstall(r) {
    const lines = [
        `commissaire governor installed (${r.platform})`,
        `  account:        ${r.account.user_name} uid ${r.account.uid ?? "?"} shell ${r.account.shell} home ${r.account.home}`,
        `  key directory:  ${r.key_dir}`,
        `  socket:         ${r.socket_path}`,
        `  install copy:   ${r.install_copy.dest}`,
        `  source tag:     ${r.install_copy.source_tag}`,
        `  source commit:  ${r.install_copy.source_commit}`,
        `  allow_uids:     ${r.allow_uids.join(", ")}`,
        `  admin_uids:     ${r.admin_uids.join(", ")}`,
        `  client group:   ${r.client_group.name} (${r.client_group.members.join(", ")})`,
        `  runner checks:  independent ${r.runner_checks.independent} (docker_group ${r.runner_checks.docker_group}, sudo_rules ${r.runner_checks.sudo_rules}, sudo_absent ${r.runner_checks.sudo_absent})`,
        `  pk_fingerprint: ${r.pk_fingerprint ?? "null (the governor did not write its key within 30 s; inspect with: systemctl status commissaire-governor)"}`,
    ];
    if (r.replaced.allow_uids.length > 0)
        lines.push(`  replaced allow_uids: ${r.replaced.allow_uids.join(", ")}`);
    if (r.replaced.admin_uids.length > 0)
        lines.push(`  replaced admin_uids: ${r.replaced.admin_uids.join(", ")}`);
    if (r.replaced.group_members.length > 0)
        lines.push(`  removed from ${r.client_group.name}: ${r.replaced.group_members.join(", ")}`);
    lines.push("Next steps:", ...r.next_steps.map((s, i) => `  ${i + 1}. ${s}`));
    return lines.join("\n") + "\n";
}
function governorInstall(flags, deps = {}) {
    const ctx = contextOf(deps);
    let clone = null;
    try {
        requireRoot(ctx, "install");
        const tag = flagString(flags, "--from-tag");
        if (tag === undefined || !TAG_PATTERN.test(tag))
            abort("from-tag must be a release tag (faff--vX.Y.Z)");
        selfCustodyCheck(ctx.host, ctx.moduleDir, tag);
        requireTools(ctx.host);
        const runnerName = flagString(flags, "--runner-user");
        if (runnerName === undefined)
            abort("pass --runner-user <name>: the non-root user that runs faff");
        const runner = resolveUser(ctx, runnerName);
        if (runner.uid === 0)
            abort("pass --runner-user <name>: the non-root user that runs faff");
        if (runner.uid < loginDefsMin(ctx.host, "UID_MIN"))
            abort(`runner-user ${runnerName} is a system account`);
        const adminName = flagString(flags, "--admin-user") ?? ctx.env.SUDO_USER;
        if (adminName === undefined || adminName === "")
            abort("pass --admin-user <name>: the human who will run governor pin");
        const admin = resolveUser(ctx, adminName);
        if (admin.uid === 0 || admin.uid === runner.uid || adminName === GOVERNOR_USER)
            abort("admin-user must be a human account other than root, the runner and the governor");
        const keyDir = absolutePath(flags, "--key-dir", DEFAULT_KEY_DIR);
        const socketDir = absolutePath(flags, "--socket-dir", DEFAULT_SOCKET_DIR);
        const prefix = absolutePath(flags, "--install-prefix", DEFAULT_PREFIX);
        const node = absolutePath(flags, "--node", ctx.execPath);
        const realNode = preflight(ctx.host, node, ctx.execPath);
        clone = releaseClone(tag, ctx.repoUrl, { host: ctx.host, executor: ctx.executor });
        const checks = escapeCheck(ctx.host, runner.name);
        const plan = planLinux(ctx.host, { runner, admin, keyDir, socketDir, prefix, node: realNode, clone, checks, checkedAt: finishTimestamp(ctx.now()) });
        executePlan(plan.ops, ctx.executor);
        ctx.executor.run({ kind: "remove", path: clone.dir, recursive: true, onlyIfEmpty: false });
        clone = null;
        const account = getUser(ctx.host, GOVERNOR_USER);
        const socketPath = path.join(socketDir, "governor.sock");
        const fingerprint = learnFingerprint(ctx.host, keyDir, ctx.clock, ctx.fingerprintTimeoutMs);
        const result = {
            platform: "linux",
            account: { user_name: GOVERNOR_USER, uid: account === null ? null : account.uid, gid: account === null ? null : account.gid, shell: plan.account.shell, home: plan.account.home },
            key_dir: keyDir, socket_path: socketPath,
            install_copy: { dest: plan.install_copy.dest, version: plan.install_copy.version, source_tag: plan.install_copy.source_tag, source_commit: plan.install_copy.source_commit },
            allow_uids: plan.allow_uids, admin_uids: plan.admin_uids, client_group: plan.client_group,
            runner_checks: plan.runner_checks, pk_fingerprint: fingerprint, replaced: plan.replaced,
            next_steps: nextSteps(plan, socketPath, runner.name, admin.name),
        };
        ctx.io.out(flags["--json"] === true ? JSON.stringify(result) + "\n" : renderInstall(result));
        return fingerprint === null ? 1 : 0;
    }
    catch (e) {
        if (clone !== null)
            ctx.executor.run({ kind: "remove", path: clone.dir, recursive: true, onlyIfEmpty: false });
        if (e instanceof Abort) {
            ctx.io.err(`commissaire governor install: ${e.message}\n`);
            return e.exit;
        }
        throw e;
    }
}
// --- Uninstall ------------------------------------------------------------------------------------------------
// Uninstall removes and re-owns whole trees named by flags, so each target must be a real directory
// that Commissaire owns, under a root-owned chain, before any op is planned.
function requireOwnedDir(host, target, label, owners, groups) {
    const st = host.lstat(target);
    if (st === null)
        return;
    if (st.kind !== "dir")
        abort(`${label} ${target} is not a real directory (symlinks and files are refused)`);
    if (!owners.includes(st.uid))
        abort(`${label} ${target} is owned by uid ${st.uid}, expected root or ${GOVERNOR_USER}`);
    if (!groups.includes(st.gid))
        abort(`${label} ${target} has group ${st.gid}, expected root or ${CLIENT_GROUP}`);
    const loose = firstLooseOnChain(host, nearestExistingReal(host, path.dirname(target)));
    if (loose !== null)
        abort(`${loose} must be root-owned and not group- or world-writable (ancestor of ${label} ${target})`);
}
const KEY_DIR_FILES = ["governor-key.json", "governor-config.json"];
function verifyUninstallTargets(host, opts, account) {
    const owners = account === null ? [0] : [0, account.uid];
    const clients = getGroup(host, CLIENT_GROUP);
    requireOwnedDir(host, opts.keyDir, "key directory", owners, account === null ? [0] : [0, account.gid]);
    if (host.lstat(opts.keyDir) !== null) {
        walkEntries(host, opts.keyDir, owners, []);
        const names = host.readdir(opts.keyDir);
        if (names.length > 0 && !names.some((n) => KEY_DIR_FILES.includes(n)))
            abort(`key directory ${opts.keyDir} holds no Commissaire key or config; refusing to touch it`);
    }
    requireOwnedDir(host, opts.socketDir, "socket directory", owners, clients === null ? [0] : [0, clients.gid]);
    if (host.lstat(opts.socketDir) !== null) {
        const stray = host.readdir(opts.socketDir).find((n) => n !== "governor.sock");
        if (stray !== undefined)
            abort(`socket directory ${opts.socketDir} holds ${stray}, which is not a governor socket; refusing to remove it`);
    }
    requireOwnedDir(host, opts.prefix, "install prefix", [0], [0]);
}
function planUninstall(host, opts) {
    verifyUninstallTargets(host, opts, getUser(host, GOVERNOR_USER));
    const ops = [];
    const unitExists = host.lstat(UNIT_PATH) !== null;
    if (unitExists) {
        ops.push({ kind: "service_op", args: ["disable", "--now", UNIT_NAME] });
        ops.push({ kind: "remove", path: UNIT_PATH, recursive: false, onlyIfEmpty: false });
        ops.push({ kind: "service_op", args: ["daemon-reload"] });
    }
    const account = getUser(host, GOVERNOR_USER);
    const keyDirExists = host.lstat(opts.keyDir) !== null;
    if (keyDirExists && !opts.purgeKey && account !== null) {
        const configPath = path.join(opts.keyDir, "governor-config.json");
        ops.push({ kind: "write_file", path: configPath, content: JSON.stringify({ allow_uids: [], admin_uids: [] }, null, 2) + "\n", owner: GOVERNOR_USER, group: GOVERNOR_USER, mode: 0o600 });
    }
    if (keyDirExists) {
        if (opts.purgeKey)
            ops.push({ kind: "remove", path: opts.keyDir, recursive: true, onlyIfEmpty: false });
        else
            ops.push({ kind: "chown", path: opts.keyDir, owner: "root", group: "root", recursive: true });
    }
    ops.push({ kind: "remove", path: opts.socketDir, recursive: true, onlyIfEmpty: false });
    if (getGroup(host, CLIENT_GROUP) !== null)
        ops.push({ kind: "delete_group", name: CLIENT_GROUP });
    if (account !== null) {
        ops.push({ kind: "delete_account", name: GOVERNOR_USER });
    }
    for (const name of host.readdir(opts.prefix).sort()) {
        if (VERSION_DIR.test(name))
            ops.push({ kind: "remove", path: path.join(opts.prefix, name), recursive: true, onlyIfEmpty: false });
    }
    ops.push({ kind: "remove", path: opts.prefix, recursive: false, onlyIfEmpty: true });
    return ops;
}
function governorUninstall(flags, deps = {}) {
    const ctx = contextOf(deps);
    try {
        requireRoot(ctx, "uninstall");
        selfCustodyCheck(ctx.host, ctx.moduleDir, "faff--vX.Y.Z");
        requireTools(ctx.host);
        const keyDir = absolutePath(flags, "--key-dir", DEFAULT_KEY_DIR);
        const socketDir = absolutePath(flags, "--socket-dir", DEFAULT_SOCKET_DIR);
        const prefix = absolutePath(flags, "--install-prefix", DEFAULT_PREFIX);
        const purgeKey = flags["--purge-key"] === true;
        const ops = planUninstall(ctx.host, { keyDir, socketDir, prefix, purgeKey });
        executePlan(ops, ctx.executor);
        const result = { uninstalled: true, key_dir: keyDir, key_dir_kept: !purgeKey, socket_dir: socketDir, install_prefix: prefix };
        ctx.io.out(flags["--json"] === true ? JSON.stringify(result) + "\n" : `commissaire governor uninstalled; key directory ${purgeKey ? "removed" : `kept at ${keyDir}, owned by root`}\n`);
        return 0;
    }
    catch (e) {
        if (e instanceof Abort) {
            ctx.io.err(`commissaire governor uninstall: ${e.message}\n`);
            return e.exit;
        }
        throw e;
    }
}
module.exports = {
    governorInstall, governorUninstall, releaseClone, planLinux, planUninstall, escapeCheck, escalationRules, doasPermits,
    selfCustodyCheck, closureManifest, manifestVersion, learnFingerprint, unitText, createHost, createExecutor,
    RELEASE_REPO_URL, TAG_PATTERN,
};
