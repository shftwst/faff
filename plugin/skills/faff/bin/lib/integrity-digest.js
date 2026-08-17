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
// The same-uid tool-poisoning MITIGATION (not elimination): every hasher is an ABSOLUTE root-owned
// path drawn from this fixed in-code list, never a PATH-resolved / repo-local sha256sum a same-uid
// lane could shadow. Two decisions live here separately — WHICH tool hashes and HOW it is found:
// we keep absolute-only resolution but probe a short list so the same mitigation holds on macOS,
// which ships /usr/bin/shasum rather than coreutils' sha256sum. First present wins; fail loud if none.
const SHA256_CANDIDATES = [
  { bin: "/usr/bin/sha256sum", args: [] },          // Linux, coreutils
  { bin: "/bin/sha256sum", args: [] },              // Linux variants without merged /usr
  { bin: "/usr/bin/shasum", args: ["-a", "256"] },  // macOS system tool (also present on most Linux)
];

// The minimal fixed environment every hasher spawn runs under. /usr/bin/shasum is a Perl script, so
// an inherited environment lets a same-uid actor inject code via PERL5LIB / PERL5OPT despite the
// absolute path — a channel the coreutils binary doesn't have. A fixed env with only PATH closes it
// for the script candidate and costs nothing for the binary ones. Mitigation-consistent, not complete.
const SANITIZED_ENV = { PATH: "/usr/bin:/bin" };

let _resolvedDefault = null;
// Return the first candidate whose bin exists on this host. Memoized ONLY for the default list (a
// snapshot hashes many leaves); an injected list is never memoized, so tests can probe freely.
// Fail-LOUD when none exists — a hash we cannot compute must never read as "verified". The tried
// list in the message is derived from the candidates, never restated by hand.
function resolveHasher(candidates = SHA256_CANDIDATES) {
  const isDefault = candidates === SHA256_CANDIDATES;
  if (isDefault && _resolvedDefault) return _resolvedDefault;
  const found = candidates.find((c) => fs.existsSync(c.bin));
  if (!found) {
    const tried = candidates.map((c) => c.bin).join(", ");
    throw new Error(`no SHA-256 tool found (tried ${tried}) — install coreutils or ensure the system shasum exists; cannot hash, refusing to report verified`);
  }
  if (isDefault) _resolvedDefault = found;
  return found;
}

// Hash a byte buffer via the resolved absolute hasher over stdin, under the sanitized env. Fail-LOUD
// on any spawn failure (binary absent / non-zero) — a hash we could not compute must NEVER read as
// "verified". Error messages name the resolved bin, not a hardcoded tool.
function sha256(bytes) {
  const hasher = resolveHasher();
  const r = spawnSync(hasher.bin, hasher.args, { input: bytes, encoding: "utf8", env: SANITIZED_ENV });
  if (r.error || r.status !== 0) throw new Error(`${hasher.bin} failed (${r.error ? r.error.code : "exit " + r.status}) — cannot hash; refusing to report verified`);
  const m = (r.stdout || "").match(/^([0-9a-f]{64})\b/);
  if (!m) throw new Error(`${hasher.bin} produced no digest: ${JSON.stringify((r.stdout || "").slice(0, 40))}`);
  return m[1];
}

// Digest a regular file, or record a SYMLINK without ever following it. A symlink where evidence
// should be is itself a same-uid tamper (redirecting the hash to a lane-stable external file is
// the cheapest bypass), so we NEVER `readFileSync` through one — we record its target instead, so
// a file→symlink swap (or a re-pointed link) reads as tampering. lstat, never stat.
function digestLeaf(abs) {
  const lst = fs.lstatSync(abs);
  if (lst.isSymbolicLink()) return { symlink: true, target: fs.readlinkSync(abs) };
  return { sha256: sha256(fs.readFileSync(abs)) };
}

// Recursively list leaf entries under a directory (relative, sorted), lstat-only so a symlinked
// subtree is recorded as a leaf symlink, never traversed/followed. Resilient: an entry that
// vanishes mid-walk is skipped (its disappearance surfaces as a removed member at verify, not a throw).
function walkLeaves(absDir) {
  const out = [];
  const rec = (d, rel) => {
    let names; try { names = fs.readdirSync(d).sort(); } catch { return; }
    for (const name of names) {
      const abs = path.join(d, name);
      let lst; try { lst = fs.lstatSync(abs); } catch { continue; }
      if (lst.isSymbolicLink()) out.push({ sub: path.join(rel, name), abs, symlink: true });
      else if (lst.isDirectory()) rec(abs, path.join(rel, name));
      else out.push({ sub: path.join(rel, name), abs });
    }
  };
  rec(absDir, "");
  return out;
}

// Snapshot ONE evidence member into a comparable record. `isEvents` (structural — the caller passes
// it only for the runDir-root events.jsonl, never by basename) makes that member prefix-preserving
// (append-only by construction): record {length, prefix_sha256}. A directory member records a
// per-sub-leaf digest/symlink map (which-file granularity). A plain file records its sha256 (or a
// symlink marker). A member that doesn't exist yet is recorded absent (a freeze must catch
// appear/disappear/symlink-swap, not only content edits). lstat throughout — never follows a symlink.
function snapshotMember(abs, isEvents) {
  let lst;
  try { lst = fs.lstatSync(abs); } catch { return { present: false }; }
  if (lst.isSymbolicLink()) return { present: true, symlink: true, target: fs.readlinkSync(abs) };
  if (isEvents) {
    const bytes = fs.readFileSync(abs);
    return { present: true, events: { length: bytes.length, prefix_sha256: sha256(bytes) } };
  }
  if (lst.isDirectory()) {
    const files = {};
    for (const f of walkLeaves(abs)) files[f.sub] = f.symlink ? { symlink: true, target: fs.readlinkSync(f.abs) } : { sha256: sha256(fs.readFileSync(f.abs)) };
    return { present: true, dir: true, files };
  }
  return { present: true, sha256: sha256(fs.readFileSync(abs)) };
}

// The manifest the caller holds in context. `members` keyed by path RELATIVE to runDir (portable
// + readable). One resolver: correctiveIntegrityDirs — never a second hand-written list.
// The evidence-set member paths (relative to runDir). One resolver — correctiveIntegrityDirs —
// never a second hand-written list. `events.jsonl` is identified STRUCTURALLY (its exact runDir-root
// rel), never by basename, so a future `corrective/events.jsonl` never gets the weaker prefix rule.
function memberRels(runDir, issue, events) {
  return correctiveIntegrityDirs(runDir, issue || null, events ? { events: true } : undefined)
    .map((abs) => path.relative(runDir, abs));
}
const isEventsRel = (rel) => rel === "events.jsonl";

function buildManifest(runDir, issue, events) {
  const members = {};
  for (const rel of memberRels(runDir, issue, events)) members[rel] = snapshotMember(path.join(runDir, rel), isEventsRel(rel));
  return { version: MANIFEST_VERSION, grain: issue ? "per-issue" : "run", members };
}

// True iff `rel` is a plain relative path that stays inside runDir (no absolute, no `..` escape).
// A held manifest is the trusted dispatcher's own snapshot, but validating rel is cheap
// defense-in-depth: it prevents a swapped/crafted manifest from redirecting a hash read outside
// the run dir (path.join(runDir, "../../etc/passwd")).
function relWithinRunDir(rel) {
  if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel)) return false;
  return !path.normalize(rel).split(/[/\\]/).includes("..");
}

// Compare current evidence against a held manifest. Returns the mismatched paths (named down to the
// sub-file for a directory member). A symlink where a file was (or vice versa, or a re-pointed link)
// is tampering. events.jsonl matches iff the on-disk bytes still START WITH the snapshotted prefix
// (a legitimate append extends it; truncation/rewrite does not — the appended tail is the lane's own,
// deliberately mutable per the FAFF-519 write-authority split).
function leafEq(a, b) {
  if (!!a.symlink !== !!b.symlink) return false;
  return a.symlink ? a.target === b.target : a.sha256 === b.sha256;
}
function diffAgainstManifest(runDir, manifest) {
  const diffs = [];
  for (const [rel, was] of Object.entries(manifest.members || {})) {
    if (!relWithinRunDir(rel)) { diffs.push(String(rel) + " (invalid member path — outside run dir)"); continue; }
    const now = snapshotMember(path.join(runDir, rel), isEventsRel(rel));
    if (!!was.present !== !!now.present) { diffs.push(rel + (was.present ? " (disappeared)" : " (appeared)")); continue; }
    if (!was.present) continue;
    if (was.symlink || now.symlink) {
      if (!leafEq(was, now)) diffs.push(rel + (!!was.symlink !== !!now.symlink ? " (symlink swapped)" : " (symlink re-pointed)"));
    } else if (was.events) {
      const bytes = fs.readFileSync(path.join(runDir, rel));
      const okPrefix = bytes.length >= was.events.length && sha256(bytes.subarray(0, was.events.length)) === was.events.prefix_sha256;
      if (!okPrefix) diffs.push(rel + (bytes.length < was.events.length ? " (truncated)" : " (prefix rewritten)"));
    } else if (was.dir) {
      const wf = was.files || {}, nf = now.files || {};
      for (const sub of Object.keys(wf)) { if (!(sub in nf)) diffs.push(path.join(rel, sub) + " (removed)"); else if (!leafEq(wf[sub], nf[sub])) diffs.push(path.join(rel, sub)); }
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

const { parseArgs, usageError } = require("./argv");
const INTEGRITY_DIGEST_SPEC = {
  flags: {
    "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--events": { arity: 0 }, "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--manifest": { arity: 1 },
    // FAFF-784: atomic custody-verdict recording — additive to plain `verify`, never required by it.
    "--issue-context": { arity: 1 }, "--merge-state": { arity: 1 }, "--record-result": { arity: 1 },
  },
  positionals: { min: 0, max: 1, name: "action" },
};

// === region:factory — custody verdict recording (FAFF-784) — see contract-defs.js's custody-verdict
// section for the RECORD shape/enums this writes and the pure admission gate merge-gate.js binds to.
// ===========================================================================
const CUSTODY_MERGE_STATES = ["pre-merge", "post-merge"];
const CUSTODY_DETAIL_MAX = 4000;
const ISSUE_CONTEXT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// The ONE canonical per-issue custody-verdict path — the file is deliberately OUTSIDE the manifest
// the invocation that writes it just verified (a failed verify never has to write into the suspect
// ledger — ADR-cited rationale in the spec's WHY).
function custodyVerdictPath(runDir, issueContext) {
  return path.join(runDir, issueContext, "custody-verdict.json");
}

// Atomic write: a sibling temp file in the SAME directory, written in full, then renamed onto the
// final path. Either the final path ends up holding the COMPLETE bytes, or (any failure, including an
// injected rename fault) neither the final path nor a lingering temp file exists — never a partial
// target. `fsImpl` is injectable (tests only; defaults to the real fs) so the DoD's fault-injection-
// around-rename requirement is exercisable without mocking the module loader.
function atomicWriteVerdictBytes(finalPath, bytes, fsImpl = fs) {
  const dir = path.dirname(finalPath);
  fsImpl.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.custody-verdict.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  fsImpl.writeFileSync(tmp, bytes);
  try {
    fsImpl.renameSync(tmp, finalPath);
  } catch (e) {
    try { fsImpl.unlinkSync(tmp); } catch { /* best-effort cleanup only — never mask the original error */ }
    throw e;
  }
}

// The verify-and-record shell: validates the canonical path (fail-loud BEFORE any verification or
// write), verifies the held manifest, classifies (clean/tamper/verification-unavailable — any
// exception thrown by verification itself degrades to verification-unavailable, never a thrown
// error), atomically persists the verdict, and hashes the EXACT persisted bytes via this module's
// own hasher (never a second implementation). No validation, interruption, or filesystem failure may
// yield a clean result or a partial target: a write failure on an intended clean/tamper record falls
// back to a best-effort "verification-unavailable" record (never silently claims the original
// classification succeeded); if that fallback ALSO fails, exit 2 with no persisted record at all.
// Exit 0 = clean, exit 1 = valid tamper (non-empty paths, durably recorded), exit 2 = verification-
// unavailable / record failure (both fail-closed, but only exit 1 ever claims tamper).
function verifyAndRecord({ runDir, manifest, issueContext, mergeState, recordResultPath, json, fsImpl = fs }) {
  if (typeof issueContext !== "string" || !issueContext || !ISSUE_CONTEXT_RE.test(issueContext) || issueContext.includes("..")) {
    process.stderr.write(`faff integrity-digest verify: --issue-context ${JSON.stringify(issueContext)} is not a valid issue id\n`);
    return 2;
  }
  if (!CUSTODY_MERGE_STATES.includes(mergeState)) {
    process.stderr.write(`faff integrity-digest verify: --merge-state ${JSON.stringify(mergeState)} not in {${CUSTODY_MERGE_STATES.join(",")}}\n`);
    return 2;
  }
  // Canonical-path validation — the FIRST check, before any verification runs: a non-canonical,
  // out-of-run, or issue-mismatched --record-result path refuses outright (never written to).
  const canonical = custodyVerdictPath(runDir, issueContext);
  if (typeof recordResultPath !== "string" || !recordResultPath || path.resolve(recordResultPath) !== path.resolve(canonical)) {
    process.stderr.write(`faff integrity-digest verify: --record-result must be the canonical path ${canonical} (got ${JSON.stringify(recordResultPath)})\n`);
    return 2;
  }

  let classification, diffPaths, detail;
  try {
    const diffs = diffAgainstManifest(runDir, manifest);
    if (diffs.length === 0) {
      classification = "clean"; diffPaths = []; detail = "digest-verified — no diffs against the held manifest";
    } else {
      classification = "tamper"; diffPaths = diffs; detail = `tampered — ${diffs.join(", ")}`;
    }
  } catch (e) {
    classification = "verification-unavailable"; diffPaths = []; detail = `verification failed: ${e.message}`;
  }
  if (detail.length > CUSTODY_DETAIL_MAX) detail = detail.slice(0, CUSTODY_DETAIL_MAX);

  const base = {
    schema_version: 1,
    run_id: path.basename(runDir),
    issue: issueContext,
    verified_at: new Date().toISOString(),
    merge_state_at_verification: mergeState,
  };
  const attempt = (cls, paths, det) => {
    const bytes = JSON.stringify({ ...base, classification: cls, paths, detail: det }, null, 2) + "\n";
    atomicWriteVerdictBytes(canonical, bytes, fsImpl);
    return bytes;
  };

  let persistedBytes;
  let persistedClassification = classification, persistedPaths = diffPaths, persistedDetail = detail;
  try {
    persistedBytes = attempt(classification, diffPaths, detail);
  } catch (e) {
    if (classification === "verification-unavailable") {
      // Already the maximally-honest downgrade — recording itself failed, nothing safer to fall back to.
      process.stderr.write(`faff integrity-digest verify: could not record verdict: ${e.message}\n`);
      return 2;
    }
    // A write failure on an intended clean/tamper record must NEVER stand as that classification —
    // fall back to a best-effort "verification-unavailable" record naming the failure.
    persistedClassification = "verification-unavailable";
    persistedPaths = [];
    persistedDetail = `record failure while persisting ${classification}: ${e.message}`.slice(0, CUSTODY_DETAIL_MAX);
    try {
      persistedBytes = attempt(persistedClassification, persistedPaths, persistedDetail);
    } catch (e2) {
      process.stderr.write(`faff integrity-digest verify: could not record verdict: ${e2.message}\n`);
      return 2;
    }
  }

  const verdictSha256 = sha256(Buffer.from(persistedBytes, "utf8"));
  const out = { classification: persistedClassification, verdict_path: canonical, verdict_sha256: verdictSha256, detail: persistedDetail, paths: persistedPaths };
  if (json) console.log(JSON.stringify(out));
  else console.log(`${persistedClassification} — ${persistedDetail}`);

  if (persistedClassification === "clean") return 0;
  if (persistedClassification === "tamper") return 1;
  return 2; // verification-unavailable
}

function cmdIntegrityDigest(args) {
  if (args.includes("--selftest")) return integrityDigestSelftest();
  const { values, positionals, errors } = parseArgs(args, INTEGRITY_DIGEST_SPEC);
  if (errors.length) return usageError(errors, "usage: faff integrity-digest <snapshot|verify|hash> --run-dir DIR [--issue ID] [--events] [--manifest json|file|-] [--json]");
  const action = positionals[0];
  const json = !!values["--json"];
  const flag = (name) => (values[name] === undefined ? null : values[name]);
  const runDir = flag("--run-dir");
  const issue = flag("--issue");
  const events = !!values["--events"];

  if (action !== "snapshot" && action !== "verify" && action !== "hash") { process.stderr.write("faff integrity-digest: <snapshot|verify|hash> is required\n"); return 2; }

  try {
    if (action === "hash") {
      // Read stdin to EOF and print the digest — the orchestrator's intended-content check pipes
      // its in-context bytes here so it shares this module's one resolver instead of its own policy.
      process.stdout.write(sha256(fs.readFileSync(0)) + "\n");
      return 0;
    }
    if (!runDir) { process.stderr.write("faff integrity-digest: --run-dir requires a directory argument\n"); return 2; }
    if (issue === "") { process.stderr.write("faff integrity-digest: --issue requires an argument\n"); return 2; }
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
    // FAFF-784: --record-result engages the atomic verify-and-record path; plain verify (no
    // --record-result) is byte-for-byte unchanged below.
    const recordResult = flag("--record-result");
    if (recordResult !== null) {
      return verifyAndRecord({ runDir, manifest, issueContext: flag("--issue-context"), mergeState: flag("--merge-state"), recordResultPath: recordResult, json });
    }
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
  fs.writeFileSync(path.join(rd, iss, "holdout.json"), '{"aggregate":"meets-spec"}'); // restore (test hygiene — extension-safe)

  // SYMLINK SWAP: a same-uid lane replaces a member file with a symlink to a lane-stable external
  // file → must be detected (we never follow it to hash the target). The cheapest same-uid tamper.
  const ext = path.join(os.tmpdir(), "faff-idig-ext-" + process.pid);
  fs.writeFileSync(ext, '{"run":"x"}'); // identical content to the original run-ledger.json
  fs.rmSync(path.join(rd, "run-ledger.json")); fs.symlinkSync(ext, path.join(rd, "run-ledger.json"));
  ok(diffAgainstManifest(rd, man).some((d) => d.startsWith("run-ledger.json") && d.includes("symlink")), "verify: file→symlink swap (even to identical content) → tampered (never followed)");
  fs.rmSync(path.join(rd, "run-ledger.json")); fs.writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"x"}'); fs.rmSync(ext); // restore
  ok(diffAgainstManifest(rd, man).length === 0, "verify: restored → clean again");

  // rel-traversal: a crafted manifest member escaping runDir is rejected, never read
  const evil = { version: "d1", grain: "run", members: { "../../../etc/passwd": { present: true, sha256: "0".repeat(64) } } };
  ok(diffAgainstManifest(rd, evil).some((d) => d.includes("invalid member path")), "verify: a manifest member escaping runDir (..) is rejected, never read");

  // hashing resolves an ABSOLUTE candidate, never a bare name / PATH — asserted without pinning a platform
  const resolved = resolveHasher();
  ok(path.isAbsolute(resolved.bin) && SHA256_CANDIDATES.includes(resolved), "resolved hasher bin is absolute and a member of SHA256_CANDIDATES (never PATH)");
  ok(SHA256_CANDIDATES.every((c) => path.isAbsolute(c.bin)), "every candidate bin is an absolute path");
  let threw = false;
  try { resolveHasher([{ bin: "/nonexistent/sha256sum", args: [] }, { bin: "/also/missing/shasum", args: ["-a", "256"] }]); } catch (e) { threw = /no SHA-256 tool found \(tried /.test(e.message); }
  ok(threw, "resolveHasher with an all-missing injected list throws the no-candidate message");
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

module.exports = {
  MANIFEST_VERSION, SHA256_CANDIDATES, resolveHasher, sha256, buildManifest, diffAgainstManifest, cmdIntegrityDigest, integrityDigestSelftest,
  // FAFF-784
  atomicWriteVerdictBytes, custodyVerdictPath, verifyAndRecord, CUSTODY_MERGE_STATES,
};
