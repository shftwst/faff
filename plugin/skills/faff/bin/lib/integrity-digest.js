// === region:factory — integrity-digest — FAFF-518 (custody-based tamper detection) ===
// A deterministic snapshot/verify CLI pair over the evidence set defined by
// `correctiveIntegrityDirs`. A TRUSTED dispatcher holds the emitted manifest in its own
// conversation context across an UNTRUSTED subagent dispatch — custody the subagent
// structurally cannot read or alter — and `verify` recomputes-and-compares to detect
// tampering before the evidence is consumed (the FAFF-354 detective pattern applied to the
// FAFF-278 forge surface). Custody replaces signatures (ADR-0039: a same-uid key is forgeable;
// a context is not). It emits its OWN honestly-labelled trust class (`digest-verified`) and
// NEVER references FAFF_INTEGRITY_BOUNDARY / integrityGate (the mount-asserted basis is a
// separate authority — ADR-0061; conflating them is the lying-attestation failure). This
// module deliberately does not import corrective-integrity's probe/gate — only its dir list.
// ===========================================================================

const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { correctiveIntegrityDirs } = require("./corrective-integrity");

const MANIFEST_VERSION = "d1";
// The same-uid tool-poisoning MITIGATION (not elimination): the absolute root-owned tool, never
// a PATH-resolved / repo-local sha256sum a same-uid lane could shadow.
const SHA256SUM = "/usr/bin/sha256sum";

// Hash a byte buffer via the absolute sha256sum over stdin. Fail-LOUD on any spawn failure
// (binary absent / non-zero) — a hash we could not compute must NEVER read as "verified".
function sha256(bytes) {
  const r = spawnSync(SHA256SUM, [], { input: bytes, encoding: "utf8" });
  if (r.error || r.status !== 0) throw new Error(`sha256sum failed (${r.error ? r.error.code : "exit " + r.status}) — cannot hash; refusing to report verified`);
  const m = (r.stdout || "").match(/^([0-9a-f]{64})\b/);
  if (!m) throw new Error(`sha256sum produced no digest: ${JSON.stringify((r.stdout || "").slice(0, 40))}`);
  return m[1];
}

// Recursively list files under a directory, relative to it, sorted (deterministic order).
function walkFiles(absDir) {
  const out = [];
  const rec = (d, rel) => {
    for (const name of fs.readdirSync(d).sort()) {
      const abs = path.join(d, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) rec(abs, path.join(rel, name));
      else out.push({ sub: path.join(rel, name), abs });
    }
  };
  rec(absDir, "");
  return out;
}

// Snapshot ONE evidence member into a comparable record. events.jsonl is prefix-preserving
// (append-only by construction): record {length, prefix_sha256}. A directory member records a
// per-sub-file digest map (which-file granularity). A plain file records its sha256. A member
// that doesn't exist yet is recorded absent (a freeze must catch appear/disappear, not only edits).
function snapshotMember(abs) {
  let st;
  try { st = fs.statSync(abs); } catch { return { present: false }; }
  if (path.basename(abs) === "events.jsonl") {
    const bytes = fs.readFileSync(abs);
    return { present: true, events: { length: bytes.length, prefix_sha256: sha256(bytes) } };
  }
  if (st.isDirectory()) {
    const files = {};
    for (const f of walkFiles(abs)) files[f.sub] = sha256(fs.readFileSync(f.abs));
    return { present: true, dir: true, files };
  }
  return { present: true, sha256: sha256(fs.readFileSync(abs)) };
}

// The manifest the caller holds in context. `members` keyed by path RELATIVE to runDir (portable
// + readable). One resolver: correctiveIntegrityDirs — never a second hand-written list.
function buildManifest(runDir, issue, events) {
  const members = {};
  for (const abs of correctiveIntegrityDirs(runDir, issue || null, events ? { events: true } : undefined)) {
    members[path.relative(runDir, abs)] = snapshotMember(abs);
  }
  return { version: MANIFEST_VERSION, grain: issue ? "per-issue" : "run", members };
}

// Compare the current evidence against a held manifest. Returns the mismatched paths (each named
// down to the sub-file for a directory member). events.jsonl matches iff the on-disk bytes still
// START WITH the snapshotted prefix (a legitimate append extends it; a truncation/rewrite does not).
function diffAgainstManifest(runDir, manifest) {
  const diffs = [];
  const cur = {};
  for (const rel of Object.keys(manifest.members || {})) cur[rel] = snapshotMember(path.join(runDir, rel));
  for (const [rel, was] of Object.entries(manifest.members || {})) {
    const now = cur[rel];
    if (!!was.present !== !!now.present) { diffs.push(rel + (was.present ? " (disappeared)" : " (appeared)")); continue; }
    if (!was.present) continue;
    if (was.events) {
      const abs = path.join(runDir, rel);
      const bytes = fs.readFileSync(abs);
      const okPrefix = bytes.length >= was.events.length && sha256(bytes.subarray(0, was.events.length)) === was.events.prefix_sha256;
      if (!okPrefix) diffs.push(rel + (bytes.length < was.events.length ? " (truncated)" : " (prefix rewritten)"));
    } else if (was.dir) {
      const wf = was.files || {}, nf = now.files || {};
      for (const sub of Object.keys(wf)) { if (!(sub in nf)) diffs.push(path.join(rel, sub) + " (removed)"); else if (nf[sub] !== wf[sub]) diffs.push(path.join(rel, sub)); }
      for (const sub of Object.keys(nf)) { if (!(sub in wf)) diffs.push(path.join(rel, sub) + " (added)"); }
    } else if (was.sha256 !== now.sha256) {
      diffs.push(rel);
    }
  }
  return diffs;
}

function readManifestArg(val) {
  if (val === "-") return fs.readFileSync(0, "utf8");
  if (fs.existsSync(val)) return fs.readFileSync(val, "utf8");
  return val; // inline JSON string
}

function cmdIntegrityDigest(args) {
  if (args.includes("--selftest")) return integrityDigestSelftest();
  const action = args[0];
  const json = args.includes("--json");
  const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; return (v && !v.startsWith("--")) ? v : ""; };
  const runDir = flag("--run-dir");
  const issue = flag("--issue");
  const events = args.includes("--events");

  if (action !== "snapshot" && action !== "verify") { process.stderr.write("faff integrity-digest: <snapshot|verify> is required\n"); return 2; }
  if (!runDir) { process.stderr.write("faff integrity-digest: --run-dir requires a directory argument\n"); return 2; }
  if (issue === "") { process.stderr.write("faff integrity-digest: --issue requires an argument\n"); return 2; }

  try {
    if (action === "snapshot") {
      const manifest = buildManifest(runDir, issue, events);
      process.stdout.write(JSON.stringify(manifest) + "\n");
      return 0;
    }
    // verify
    const manRaw = flag("--manifest");
    if (manRaw === null || manRaw === "") { process.stderr.write("faff integrity-digest verify: --manifest <json|file|-> is required\n"); return 2; }
    let manifest;
    try { manifest = JSON.parse(readManifestArg(manRaw)); } catch (e) { process.stderr.write(`faff integrity-digest verify: --manifest is not valid JSON (${e.message})\n`); return 2; }
    if (!manifest || typeof manifest.members !== "object") { process.stderr.write("faff integrity-digest verify: manifest has no members\n"); return 2; }
    const diffs = diffAgainstManifest(runDir, manifest);
    if (diffs.length === 0) {
      if (json) console.log(JSON.stringify({ verdict: "digest-verified", tampered: [] }));
      else console.log("digest-verified");
      return 0;
    }
    if (json) console.log(JSON.stringify({ verdict: "tampered", tampered: diffs }));
    else console.log(`tampered — ${diffs.join(", ")}`);
    return 1;
  } catch (e) {
    process.stderr.write(`faff integrity-digest: ${e.message}\n`);
    return 2; // fail-loud (e.g. sha256sum unavailable) — never a silent verified
  }
}

function integrityDigestSelftest() {
  const os = require("node:os");
  let total = 0, fail = 0;
  const ok = (cond, label) => { total++; if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };

  // A run dir carrying the evidence surface: run-ledger.json, corrective/<f>, per-issue files, events.jsonl.
  const rd = fs.mkdtempSync(path.join(os.tmpdir(), "faff-idig-"));
  const iss = "FAFF-9";
  fs.writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"x"}');
  fs.mkdirSync(path.join(rd, "corrective"), { recursive: true });
  fs.writeFileSync(path.join(rd, "corrective", "c1.json"), '{"op":"park"}');
  fs.mkdirSync(path.join(rd, iss), { recursive: true });
  fs.writeFileSync(path.join(rd, iss, "ac-checklist.json"), '{"all_verified":true}');
  fs.writeFileSync(path.join(rd, iss, "review-verdict.json"), '{"signal":"pass"}');
  fs.writeFileSync(path.join(rd, iss, "holdout.json"), '{"aggregate":"meets-spec"}');
  fs.writeFileSync(path.join(rd, "events.jsonl"), '{"seq":0}\n');

  const man = buildManifest(rd, iss, true);
  ok(man.version === "d1" && man.grain === "per-issue", "snapshot: manifest version+grain");
  ok(man.members["run-ledger.json"] && man.members["run-ledger.json"].sha256, "snapshot: run-ledger.json hashed");
  ok(man.members["corrective"] && man.members["corrective"].dir && man.members["corrective"].files["c1.json"], "snapshot: corrective/ dir per-file digest");
  ok(man.members["events.jsonl"].events && man.members["events.jsonl"].events.length === 10, "snapshot: events.jsonl recorded as {length, prefix_sha256}");

  ok(diffAgainstManifest(rd, man).length === 0, "verify: clean round-trip → no diffs (digest-verified)");

  // tamper a plain member → verify names it
  fs.writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"TAMPERED"}');
  ok(diffAgainstManifest(rd, man).includes("run-ledger.json"), "verify: edited run-ledger.json → named tampered");
  fs.writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"x"}'); // restore

  // tamper a sub-file inside the corrective/ dir → verify names the sub-path
  fs.writeFileSync(path.join(rd, "corrective", "c1.json"), '{"op":"forbid-surface"}');
  ok(diffAgainstManifest(rd, man).includes(path.join("corrective", "c1.json")), "verify: edited corrective/c1.json → named the sub-path");
  fs.writeFileSync(path.join(rd, "corrective", "c1.json"), '{"op":"park"}'); // restore
  // add a NEW file into corrective/ → appeared
  fs.writeFileSync(path.join(rd, "corrective", "c2.json"), '{"op":"x"}');
  ok(diffAgainstManifest(rd, man).some((d) => d.includes("c2.json") && d.includes("added")), "verify: added corrective/c2.json → named added");
  fs.rmSync(path.join(rd, "corrective", "c2.json"));

  // events.jsonl: a legitimate APPEND is NOT tampering
  fs.appendFileSync(path.join(rd, "events.jsonl"), '{"seq":1}\n');
  ok(diffAgainstManifest(rd, man).length === 0, "verify: events.jsonl append → still digest-verified (prefix preserved)");
  // events.jsonl: TRUNCATE is tampering
  fs.writeFileSync(path.join(rd, "events.jsonl"), '{"se');
  ok(diffAgainstManifest(rd, man).some((d) => d.startsWith("events.jsonl") && d.includes("truncated")), "verify: truncated events.jsonl → tampered");
  // events.jsonl: PREFIX REWRITE (same-or-longer length, different prefix) is tampering
  fs.writeFileSync(path.join(rd, "events.jsonl"), '{"XXX":9}\n{"seq":1}\n');
  ok(diffAgainstManifest(rd, man).some((d) => d.startsWith("events.jsonl") && d.includes("prefix rewritten")), "verify: rewritten events.jsonl prefix → tampered");
  fs.writeFileSync(path.join(rd, "events.jsonl"), '{"seq":0}\n'); // restore

  // a member that DISAPPEARS is tampering
  fs.rmSync(path.join(rd, iss, "holdout.json"));
  ok(diffAgainstManifest(rd, man).some((d) => d.includes("holdout.json") && d.includes("disappeared")), "verify: removed holdout.json → named disappeared");

  // hashing uses the absolute /usr/bin/sha256sum (never PATH)
  ok(SHA256SUM === "/usr/bin/sha256sum" && path.isAbsolute(SHA256SUM), "hashing binary is the absolute /usr/bin/sha256sum (never PATH)");
  // trust-class boundary: the module CODE (comments stripped) never names the mount-asserted
  // symbols. Needles built from fragments so this assertion's own source doesn't match itself.
  const self = fs.readFileSync(__filename, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const mountEnv = ["FAFF", "INTEGRITY", "BOUNDARY"].join("_");
  const gateFn = "integrity" + "Gate";
  ok(!self.includes(mountEnv) && !self.includes(gateFn), "trust-class boundary: no mount-asserted symbol reference in code");

  fs.rmSync(rd, { recursive: true, force: true });
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} checks, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { MANIFEST_VERSION, SHA256SUM, buildManifest, diffAgainstManifest, cmdIntegrityDigest, integrityDigestSelftest };
