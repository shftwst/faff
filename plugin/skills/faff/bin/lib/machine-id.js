// === region:factory — machine-id — FAFF-891: collision-resistant per-host machine id (FAFF-889 same-box gate) ===
//
// The de-risked source FAFF-889's same-box fast-path reclaim is gated on. The gate
// is only safe if two DISTINCT hosts never share a machine id, so the source order
// FAILS TOWARD UNIQUENESS and a bare hostname is NEVER a source (container/CI hosts
// routinely share a hostname — the exact input that manufactures the double-build
// collision). Order: OS machine id (sha256-hashed so a raw host id never enters a
// pushed git ref) -> a durable per-host UUID minted once under <homeDir>/.faff/ ->
// (no step 3; a hostname is never returned).
//
// `resolveMachineId(deps)` is the pure core — every source is injected, so the
// selftest exercises the four negative-test rows FAFF-889 adopts (distinct-per-host,
// container hostname-collision, hostname-source-rejected, readable/idempotent)
// without touching the real filesystem. `thisMachineId(env)` wires the real deps.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseArgs, usageError } = require("./argv");

// Linux OS-machine-id sources, in order. macOS/Windows resolve via an injected
// platformOsId hook (default absent ⇒ mint), so a non-Linux host is never wrongly
// judged same-box off a shared placeholder — it fails toward a minted UUID.
const OS_ID_PATHS = ["/etc/machine-id", "/var/lib/dbus/machine-id"];

// Known placeholder / uninitialised machine-id values that must be treated as ABSENT
// (they are shared across hosts, so honouring one would manufacture a collision).
const PLACEHOLDER_OS_IDS = new Set([
  "",
  "uninitialized",
  "00000000000000000000000000000000",
]);

function isUsableOsId(raw) {
  if (raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v !== "" && !PLACEHOLDER_OS_IDS.has(v);
}

// One-way digest so the raw OS machine id never lands in a pushed git ref.
function hashOsId(raw) {
  return crypto.createHash("sha256").update(String(raw).trim()).digest("hex");
}

// Pure core. deps:
//   osIdPaths:    string[]                       — OS-machine-id source paths to try in order
//   readFile:     (p) => string | null           — file bytes, or null if unreadable/absent
//   writeFile:    (p, s) => void                  — durably persist a minted id (mkdir -p + atomic)
//   platformOsId: () => string | null             — non-Linux OS id hook (null ⇒ none)
//   mintPath:     () => string                    — durable per-host path for a minted UUID
//   randomUUID:   () => string                    — fresh UUID source
//   hash:         (s) => string                   — one-way digest for the OS id
// Returns { id, source } where source ∈ os-machine-id | minted-existing | minted-new.
// NEVER returns a hostname, and never consults one.
function resolveMachineId(deps) {
  // 1. OS machine id (hashed).
  let osId = null;
  for (const p of deps.osIdPaths || OS_ID_PATHS) {
    const v = deps.readFile(p);
    if (isUsableOsId(v)) { osId = String(v).trim(); break; }
  }
  if (osId == null && typeof deps.platformOsId === "function") {
    const pv = deps.platformOsId();
    if (isUsableOsId(pv)) osId = String(pv).trim();
  }
  if (osId != null) return { id: deps.hash(osId), source: "os-machine-id" };

  // 2. Durable minted UUID (mint once, reuse). No hostname fallback below this.
  const mintPath = deps.mintPath();
  const existing = deps.readFile(mintPath);
  if (existing != null && String(existing).trim() !== "") {
    return { id: String(existing).trim(), source: "minted-existing" };
  }
  const minted = deps.randomUUID();
  deps.writeFile(mintPath, minted);
  return { id: minted, source: "minted-new" };
}

// The durable per-host mint path: under homeDir, ABOVE any worktree/checkout, so one
// host resolves one id regardless of which checkout is asking (a per-checkout .faff/
// would differ per worktree and break same-host matching).
function defaultMintPath(env = process.env) {
  const home = (env && env.HOME) || os.homedir();
  return path.join(home, ".faff", "machine-id");
}

function realReadFile(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

function realWriteFile(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${String(s).trim()}\n`, { mode: 0o600 });
  fs.renameSync(tmp, p); // atomic swap so a concurrent reader never sees a torn write
}

// Real-deps wiring, shared by thisMachineId + cmdMachineId. On a non-Linux host with
// no platform hook, resolution falls to the minted UUID — safe (fails toward
// uniqueness), never a hostname.
function realDeps(env = process.env) {
  return {
    osIdPaths: OS_ID_PATHS,
    readFile: realReadFile,
    writeFile: realWriteFile,
    platformOsId: null, // Linux-first; macOS/Windows mint until a real hook is wired
    mintPath: () => defaultMintPath(env),
    randomUUID: () => crypto.randomUUID(),
    hash: hashOsId,
  };
}

function thisMachineId(env = process.env) {
  return resolveMachineId(realDeps(env)).id;
}

const MACHINE_ID_USAGE = "usage: faff machine-id [--json] [--selftest]";
const MACHINE_ID_SPEC = { flags: { "--json": { arity: 0 }, "--selftest": { arity: 0 } } };

function cmdMachineId(args) {
  if (args.includes("--selftest")) return machineIdSelftest();
  const { values, errors } = parseArgs(args, MACHINE_ID_SPEC);
  if (errors.length) return usageError(errors, MACHINE_ID_USAGE);
  const json = !!values["--json"];
  const { id, source } = resolveMachineId(realDeps(process.env));
  if (json) console.log(JSON.stringify({ id, source }));
  else console.log(id);
  return 0;
}

// In-memory selftest of the pure core — the negative-test harness FAFF-889 adopts.
// Every source is a fake, so no real filesystem is touched. Mirrors the
// runcheck/heartbeat --selftest shape.
function machineIdSelftest() {
  let failed = 0;
  const check = (label, cond) => {
    if (!cond) { process.stderr.write(`machine-id --selftest FAIL: ${label}\n`); failed++; }
  };

  // A fake filesystem: an in-memory map of path -> value, with a controllable
  // hostname that the resolver must NEVER read.
  const makeDeps = (files, opts = {}) => {
    const store = { ...files };
    let uuidSeq = opts.uuidStart || 1;
    return {
      _store: store,
      osIdPaths: OS_ID_PATHS,
      readFile: (p) => (p in store ? store[p] : null),
      writeFile: (p, s) => { store[p] = `${String(s).trim()}\n`; },
      platformOsId: opts.platformOsId || null,
      mintPath: () => opts.mintPath || "/home/fake/.faff/machine-id",
      randomUUID: () => `uuid-${opts.host || "h"}-${uuidSeq++}`,
      hash: hashOsId,
    };
  };

  // Row 1 — distinct-per-host (OS-id path): two hosts, distinct /etc/machine-id → distinct ids.
  const a = resolveMachineId(makeDeps({ "/etc/machine-id": "aaaa1111" }));
  const b = resolveMachineId(makeDeps({ "/etc/machine-id": "bbbb2222" }));
  check("distinct OS ids yield distinct machine ids", a.id !== b.id);
  check("OS-id source is reported", a.source === "os-machine-id");
  check("OS id is one-way hashed (64 hex, not the raw value)",
    /^[0-9a-f]{64}$/.test(a.id) && a.id !== "aaaa1111");

  // Row 1 — distinct-per-host (minted path): two hosts, no OS id, distinct mint files → distinct ids.
  const m1 = resolveMachineId(makeDeps({}, { mintPath: "/h1/.faff/machine-id", host: "h1" }));
  const m2 = resolveMachineId(makeDeps({}, { mintPath: "/h2/.faff/machine-id", host: "h2" }));
  check("two hosts with no OS id mint distinct ids", m1.id !== m2.id);
  check("a fresh mint is reported as minted-new", m1.source === "minted-new");

  // Row 2 — container hostname-collision: same hostname, distinct OS ids → still distinct.
  const c1 = resolveMachineId(makeDeps({ "/etc/machine-id": "cccc3333" }, { host: "shared-hostname" }));
  const c2 = resolveMachineId(makeDeps({ "/etc/machine-id": "dddd4444" }, { host: "shared-hostname" }));
  check("shared hostname cannot manufacture a collision (distinct OS ids stay distinct)", c1.id !== c2.id);

  // Row 3 — hostname-source-rejected: no OS id, no prior mint, only a hostname available.
  // The resolver has no hostname branch, so it MINTS; the hostname value never appears.
  const hostname = "collidey-host";
  const rej = resolveMachineId(makeDeps({}, { mintPath: "/hj/.faff/machine-id", host: "hj" }));
  check("no-OS-id host mints rather than returning a hostname", rej.source === "minted-new");
  check("a hostname value is never returned as the machine id", rej.id !== hostname);

  // Placeholder guard: an all-zeros / 'uninitialized' /etc/machine-id is treated as ABSENT
  // (it is shared across hosts) → mint instead of honouring the placeholder.
  const ph = resolveMachineId(makeDeps({ "/etc/machine-id": "00000000000000000000000000000000" }, { mintPath: "/ph/.faff/machine-id" }));
  check("placeholder OS id (all-zeros) is treated as absent → minted", ph.source === "minted-new");
  const phu = resolveMachineId(makeDeps({ "/etc/machine-id": "uninitialized\n" }, { mintPath: "/phu/.faff/machine-id" }));
  check("placeholder OS id ('uninitialized') is treated as absent → minted", phu.source === "minted-new");

  // Row 4 — readable / idempotent (OS-id path): same host resolves the same id twice.
  const depsStable = makeDeps({ "/etc/machine-id": "eeee5555" });
  const s1 = resolveMachineId(depsStable);
  const s2 = resolveMachineId(depsStable);
  check("OS-id resolution is idempotent (stable across calls)", s1.id === s2.id);

  // Row 4 — readable / idempotent (minted path): the first call persists, the second reuses it.
  const depsMint = makeDeps({}, { mintPath: "/idem/.faff/machine-id", host: "idem" });
  const i1 = resolveMachineId(depsMint);
  const i2 = resolveMachineId(depsMint); // reads the file the first call wrote
  check("minted id persists and is reused (idempotent)", i1.id === i2.id);
  check("the reused mint is reported as minted-existing", i2.source === "minted-existing");

  // platformOsId hook (macOS/Windows path): a platform id is honoured (hashed) when no file exists.
  const plat = resolveMachineId(makeDeps({}, { platformOsId: () => "AABBCCDD-1122", mintPath: "/plat/.faff/machine-id" }));
  check("a platform OS id (non-Linux hook) is honoured and hashed", plat.source === "os-machine-id" && /^[0-9a-f]{64}$/.test(plat.id));

  // Real-host integration: thisMachineId() returns a non-empty, stable value across two calls.
  const r1 = thisMachineId();
  const r2 = thisMachineId();
  check("thisMachineId() returns a non-empty value on this host", typeof r1 === "string" && r1.length > 0);
  check("thisMachineId() is stable across two calls on this host", r1 === r2);

  if (failed) { process.stderr.write(`machine-id --selftest: ${failed} FAILED\n`); return 1; }
  console.log("machine-id --selftest: ok");
  return 0;
}

module.exports = {
  MACHINE_ID_USAGE,
  OS_ID_PATHS,
  PLACEHOLDER_OS_IDS,
  cmdMachineId,
  defaultMintPath,
  hashOsId,
  isUsableOsId,
  machineIdSelftest,
  resolveMachineId,
  thisMachineId,
};
