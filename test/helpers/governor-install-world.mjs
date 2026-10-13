// A fake Linux host for the FAFF-1216 install tests: an in-memory file table, a user and group
// database, scripted probe results and a recording executor. Paths under CLONE read through to this
// repository's plugin tree, so the closure walk runs over the real source without any root-owned clone.

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CLONE = "/root/commissaire-release-abc123";
export const COMMIT = "0123456789abcdef0123456789abcdef01234567";
export const TAG = "faff--v0.42.0";
export const FINGERPRINT = "f".repeat(64);

const dir = (uid = 0, gid = 0, mode = 0o755) => ({ uid, gid, mode, kind: "dir" });
const file = (content = "", uid = 0, gid = 0, mode = 0o755) => ({ uid, gid, mode, kind: "file", content });

export function makeWorld(options = {}) {
  const fsTable = new Map();
  for (const d of ["/", "/usr", "/usr/bin", "/usr/sbin", "/sbin", "/bin", "/etc", "/etc/systemd", "/etc/systemd/system", "/var", "/var/lib", "/opt", "/home", "/opt/installer", "/opt/installer/bin", "/opt/installer/bin/lib"]) fsTable.set(d, dir());
  fsTable.set("/root", dir(0, 0, 0o700));
  for (const f of ["/usr/sbin/useradd", "/usr/sbin/userdel", "/usr/sbin/groupadd", "/usr/sbin/groupdel", "/usr/bin/gpasswd", "/usr/bin/getent", "/usr/bin/id", "/usr/bin/git", "/usr/bin/systemctl", "/usr/bin/python3", "/usr/sbin/nologin", "/usr/bin/node", "/bin/sh", "/opt/installer/bin/commissaire"]) fsTable.set(f, file());
  fsTable.set("/opt/installer/bin/lib/governor-install.js", file("", 0, 0, 0o644));
  fsTable.set("/etc/login.defs", file("UID_MIN 1000\nGID_MIN 1000\n", 0, 0, 0o644));
  const users = new Map([
    ["root", { uid: 0, gid: 0, home: "/root", shell: "/bin/bash" }],
    ["alice", { uid: 1000, gid: 1000, home: "/home/alice", shell: "/bin/bash" }],
    ["hal", { uid: 1001, gid: 1001, home: "/home/hal", shell: "/bin/bash" }],
    ["mallory", { uid: 1002, gid: 1002, home: "/home/mallory", shell: "/bin/bash" }],
    ["svc", { uid: 500, gid: 500, home: "/srv/svc", shell: "/bin/sh" }],
  ]);
  const groups = new Map([["root", { gid: 0, members: [] }], ["alice", { gid: 1000, members: [] }]]);
  const userGroups = new Map([["alice", ["alice"]], ["hal", ["hal"]]]);
  const world = {
    fs: fsTable, users, groups, userGroups, calls: [], ops: [], out: "", err: "",
    python: true, sudoOutput: null, gitHead: COMMIT, gitTag: COMMIT, keyAppears: true, failKind: null,
    commandV: new Map(),
    ...options,
  };
  const mapped = (p) => (p === CLONE || p.startsWith(`${CLONE}/`) ? join(REPO, p.slice(CLONE.length)) : null);
  const statReal = (p) => {
    try {
      const st = lstatSync(p);
      return { uid: 0, gid: 0, mode: st.mode & 0o7777, kind: st.isDirectory() ? "dir" : st.isFile() ? "file" : "other" };
    } catch { return null; }
  };

  world.host = {
    probe(cmd, args, opts = {}) {
      world.calls.push({ cmd, args, opts });
      const base = cmd.split("/").pop();
      const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
      const fail = (status = 1, stderr = "") => ({ status, stdout: "", stderr });
      if (base === "getent") {
        const [db, name] = args;
        if (db === "passwd") {
          const u = users.get(name);
          return u ? ok(`${name}:x:${u.uid}:${u.gid}::${u.home}:${u.shell}\n`) : fail(2);
        }
        const g = groups.get(name);
        return g ? ok(`${name}:x:${g.gid}:${g.members.join(",")}\n`) : fail(2);
      }
      if (base === "id") {
        const u = users.get(args[args.length - 1]);
        if (!u) return fail(1);
        if (args[0] === "-u") return ok(`${u.uid}\n`);
        if (args[0] === "-g") return ok(`${u.gid}\n`);
        if (world.idFails) return fail(1);
        if (args[0] === "-G") return ok(`${(userGroups.get(args[args.length - 1]) ?? [args[args.length - 1]]).map((n) => groups.get(n)?.gid ?? u.gid).join(" ")}\n`);
        return ok(`${(userGroups.get(args[args.length - 1]) ?? [args[args.length - 1]]).join(" ")}\n`);
      }
      if (/^python3/.test(base)) return world.python ? ok() : fail(1, "No module");
      if (base === "sudo") return world.sudoOutput === "error" ? fail(1, "sudo: a password is required") : ok(world.sudoOutput ?? "User alice is not allowed to run sudo on host.\n");
      if (base === "git") {
        if (args.includes("HEAD")) return ok(`${world.gitHead}\n`);
        return ok(`${world.gitTag}\n`);
      }
      if (base === "sh") {
        const m = /command -v (\w+)/.exec(args[1] ?? "");
        const found = m && world.commandV.get(m[1]);
        return found ? ok(`${found}\n`) : fail(1);
      }
      return fail(127);
    },
    lstat(p) {
      if (fsTable.has(p)) return fsTable.get(p);
      const real = mapped(p);
      return real ? statReal(real) : null;
    },
    realpath(p) {
      for (let hops = 0; fsTable.get(p)?.kind === "symlink" && hops < 8; hops++) p = fsTable.get(p).target;
      if (fsTable.has(p)) return p;
      const real = mapped(p);
      return real && existsSync(real) ? p : null;
    },
    readdir(p) {
      const names = new Set();
      const prefix = p === "/" ? "/" : `${p}/`;
      for (const k of fsTable.keys()) if (k !== p && k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) names.add(k.slice(prefix.length));
      const real = mapped(p);
      if (real && existsSync(real)) for (const n of readdirSync(real)) names.add(n);
      return [...names];
    },
    readFile(p) {
      const entry = fsTable.get(p);
      if (entry && entry.kind === "file") return Buffer.from(entry.content ?? "");
      const real = mapped(p);
      try { return real ? readFileSync(real) : null; } catch { return null; }
    },
  };

  world.executor = {
    run(op) {
      world.ops.push(op);
      if (world.failKind === op.kind) return { ok: false, message: `${op.kind} refused by the test` };
      if (op.kind === "make_temp_dir") return { ok: true, value: CLONE };
      if (op.kind === "service_op" && op.args[0] === "enable" && world.keyAppears) {
        const keyDir = world.keyDir ?? "/var/lib/commissaire";
        fsTable.set(join(keyDir, "governor-key.json"), file(JSON.stringify({ pk_fingerprint: FINGERPRINT }), 300, 300, 0o600));
      }
      return { ok: true };
    },
  };

  const clock = { t: 1_000_000, now: () => clock.t, sleep: (ms) => { clock.t += ms; } };
  world.clock = clock;
  world.deps = (extra = {}) => ({
    host: world.host, executor: world.executor, clock,
    getuid: () => 0, platform: () => "linux", env: { SUDO_USER: "hal" },
    execPath: "/usr/bin/node", moduleDir: "/opt/installer/bin/lib",
    now: () => new Date("2026-10-12T04:00:00.123Z"),
    io: { out: (t) => { world.out += t; }, err: (t) => { world.err += t; } },
    ...extra,
  });
  world.flags = (extra = {}) => ({ "--runner-user": "alice", "--from-tag": TAG, "--json": true, ...extra });
  world.callsTo = (name) => world.calls.filter((c) => c.cmd.split("/").pop() === name);
  world.opKinds = () => world.ops.map((o) => o.kind);
  return world;
}

export { dir as fakeDir, file as fakeFile };
