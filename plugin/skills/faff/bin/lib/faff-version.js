"use strict";
// === region:governance — faff-version — FAFF-1395: the one resolver for the faff plugin release version every durable run/prep/graft record stamps ===
//
// One resolver, many sinks: `resolveFaffVersion` is the SINGLE point that reads the plugin
// release `version` from `plugin/.claude-plugin/plugin.json`. Every writer that records
// provenance (run-ledger owner, genesis run-start, the anchored evidence writers, merge-record,
// custody-verdict, judge-trail manifest, intake provenance) asks this function — or is handed
// its return value — and stamps the answer as `faff_version`. No other module reads
// `plugin.json`: two readers drift, which is exactly the divergence `faff harness identify`
// was introduced to stop for harness/model.
//
// Never throws for provenance. A missing, malformed, foreign or unreadable manifest yields the
// literal "unknown" (source "default") and the write the caller was making proceeds exactly as
// it would have. "unknown" is written, never omitted: absence means "written before FAFF-1395",
// "unknown" means "written after, but unresolved".
//
// Requires only node:fs and node:path. It must not live in harness.js (a factory module on the
// standalone Commissaire binary's DENYLIST); governance modules (events, evidence, effects,
// heartbeat) require this one, so it carries no local require at all.
// ===========================================================================
const fs = require("node:fs");
const path = require("node:path");

const UNKNOWN = "unknown";
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;
// The module only trusts plugin.json when it sits at <plugin>/skills/faff/bin/lib — the layout every
// supported install keeps (repo checkout, symlinked install after realpath, marketplace copy).
const EXPECTED_TAIL = ["skills", "faff", "bin", "lib"];

let memo = null; // a RESOLVED result only; a failed read is retried on the next call

function fallback() {
  return { version: UNKNOWN, source: "default" };
}

function moduleDirReal() {
  try { return fs.realpathSync(__dirname); } catch { return __dirname; }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// opts.readFile — (path) -> string, injectable; opts.path — override the manifest path;
// opts.moduleDir — override the module directory the location check inspects.
// Never throws. A resolved version is memoised per process when called with no opts.
function resolveFaffVersion(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const noOpts = Object.keys(o).length === 0;
  try {
    if (noOpts && memo) return { ...memo };
    const dir = o.moduleDir || moduleDirReal();
    const segs = path.resolve(dir).split(path.sep).filter(Boolean);
    const tail = segs.slice(-EXPECTED_TAIL.length);
    if (tail.length !== EXPECTED_TAIL.length || tail.some((s, i) => s !== EXPECTED_TAIL[i])) return fallback();
    const file = o.path || path.resolve(dir, "../../../../.claude-plugin/plugin.json");
    let obj;
    try {
      const text = (o.readFile || ((p) => fs.readFileSync(p, "utf8")))(file);
      obj = JSON.parse(text);
    } catch {
      return fallback();
    }
    if (!isPlainObject(obj) || obj.name !== "faff" || typeof obj.version !== "string" || !VERSION_PATTERN.test(obj.version)) {
      return fallback();
    }
    const result = { version: obj.version, source: "plugin-json" };
    if (noOpts) memo = result;
    return { ...result };
  } catch {
    return fallback();
  }
}

// Returns a NEW object with faff_version inserted directly after schema_version (first when the
// document has no schema_version). Never mutates doc; replaces an existing faff_version in place.
function stampFaffVersion(doc, version) {
  const v = typeof version === "string" ? version : resolveFaffVersion().version;
  const out = {};
  let placed = false;
  const src = isPlainObject(doc) ? doc : {};
  if (!("schema_version" in src)) { out.faff_version = v; placed = true; }
  for (const k of Object.keys(src)) {
    if (k === "faff_version") continue;
    out[k] = src[k];
    if (k === "schema_version") { out.faff_version = v; placed = true; }
  }
  if (!placed) out.faff_version = v;
  return out;
}

const VERSION_USAGE = "usage: faff version [--json] [--selftest]";

function cmdVersion(args) {
  const argv = Array.isArray(args) ? args : [];
  const known = new Set(["--json", "--selftest"]);
  const bad = argv.filter((a) => !known.has(a));
  if (bad.length) {
    process.stderr.write(`faff: unknown argument for version: ${bad[0]}\n${VERSION_USAGE}\n`);
    return 2;
  }
  if (argv.includes("--selftest")) return versionSelftest();
  const r = resolveFaffVersion();
  if (argv.includes("--json")) console.log(JSON.stringify({ version: r.version, source: r.source }));
  else console.log(r.version);
  return 0; // always — resolution never fails; an unresolved version is the value "unknown"
}

function versionSelftest() {
  let failed = 0;
  const check = (label, cond) => {
    if (!cond) { process.stderr.write(`version --selftest FAIL: ${label}\n`); failed++; }
  };
  const dir = path.join(path.sep, "x", "plugin", "skills", "faff", "bin", "lib");
  const at = (manifest) => resolveFaffVersion({ moduleDir: dir, readFile: () => (typeof manifest === "string" ? manifest : JSON.stringify(manifest)) });
  const is = (r, version, source) => r.version === version && r.source === source;
  const unk = (r) => is(r, UNKNOWN, "default");

  check("valid version", is(at({ name: "faff", version: "0.42.0" }), "0.42.0", "plugin-json"));
  check("prerelease version", is(at({ name: "faff", version: "0.43.0-rc.1" }), "0.43.0-rc.1", "plugin-json"));
  check("missing file", unk(resolveFaffVersion({ moduleDir: dir, readFile: () => { throw new Error("ENOENT"); } })));
  check("non-JSON", unk(at("not json")));
  check("non-object (array)", unk(at("[1]")));
  check("non-object (null)", unk(at("null")));
  check("wrong name", unk(at({ name: "other", version: "0.42.0" })));
  check("missing version", unk(at({ name: "faff" })));
  check("non-string version", unk(at({ name: "faff", version: 42 })));
  check("two-part version", unk(at({ name: "faff", version: "0.42" })));
  check("dangling prerelease dash", unk(at({ name: "faff", version: "0.42.0-" })));
  check("word version", unk(at({ name: "faff", version: "latest" })));
  check("module dir not at skills/faff/bin/lib",
    unk(resolveFaffVersion({ moduleDir: path.join(path.sep, "x", "ctx", "lib"), readFile: () => JSON.stringify({ name: "faff", version: "0.42.0" }) })));
  check("deeply nested copy is still rejected",
    unk(resolveFaffVersion({ moduleDir: path.join(path.sep, "repo", "plugin", "skills", "faff", "bin", "lib", "ctx", "lib"), readFile: () => JSON.stringify({ name: "faff", version: "0.42.0" }) })));

  // A failed read is not memoised; a later read succeeds; injected calls never change the memo.
  const saved = memo;
  memo = null;
  try {
    const f1 = resolveFaffVersion({ moduleDir: dir, readFile: () => { throw new Error("EIO"); } });
    check("failed read returns unknown", unk(f1));
    check("failed read is not memoised", memo === null);
    const real = resolveFaffVersion();
    if (real.source === "plugin-json") {
      check("resolved version is memoised", memo !== null && memo.version === real.version);
      resolveFaffVersion({ moduleDir: dir, readFile: () => JSON.stringify({ name: "faff", version: "9.9.9" }) });
      check("injected call leaves the memo unchanged", resolveFaffVersion().version === real.version);
    }
  } finally {
    memo = saved;
  }

  // stampFaffVersion: second key after schema_version, first when none, never mutates, no duplicate.
  const doc = { schema_version: 1, all_verified: true };
  const stamped = stampFaffVersion(doc, "0.42.0");
  check("stamp is the second key", Object.keys(stamped).join(",") === "schema_version,faff_version,all_verified");
  check("stamp does not mutate the input", Object.keys(doc).join(",") === "schema_version,all_verified");
  check("stamp is first when no schema_version", Object.keys(stampFaffVersion({ a: 1 }, "0.42.0")).join(",") === "faff_version,a");
  check("restamp replaces in place", stampFaffVersion(stamped, "0.43.0").faff_version === "0.43.0"
    && Object.keys(stampFaffVersion(stamped, "0.43.0")).join(",") === "schema_version,faff_version,all_verified");

  if (failed) {
    process.stderr.write(`version --selftest: ${failed} case(s) FAILED\n`);
    return 1;
  }
  console.log("version --selftest: ok");
  return 0;
}

module.exports = { resolveFaffVersion, stampFaffVersion, cmdVersion, versionSelftest, VERSION_PATTERN };
