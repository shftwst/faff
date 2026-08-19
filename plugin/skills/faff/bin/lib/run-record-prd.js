// ===========================================================================
// === region:factory — run-record-prd — FAFF-858: the narrow PRD-record verb ===
// over the ONE inherited L4 ledger. Under lights-out, the operator mints exactly
// one run-ledger in cage-1 and hands its directory off via `FAFF_RUN_DIR`; the
// drain (`faff-beep-boop` §0a) and a nested `/faff-plot --autonomous` Ignition
// must REUSE that same ledger end-to-end, never mint a second one. What a later
// stage discovers about the run — the PRD's creative-licence, the resolved root
// container — is written ONTO that one ledger through this narrow, lock-guarded
// field update, never by minting again (the exact defect this ticket closes).
//
// Two exports carry the fix:
//   * `classifyInheritedRunDir(env, root)` — the PURE resolver every reuse call
//     site (§0a, plot Ignition, this verb's own precondition) shares: given a
//     candidate `FAFF_RUN_DIR`, is it unset (`not-l4`, ordinary L3 path), a
//     genuine inherited L4 lights-out ledger (`inherited-l4`, reuse it), or a
//     foreign/invalid handoff (`fault`, fail loud, never guess)?
//   * `recordPrdOnLedger(...)` / `cmdRunRecordPrd` — the WRITE side: validates
//     via the classifier, then mutates ONLY `prd_creative_licence` /
//     `prd_root_container` through `mutateLedgerUnderLock` (heartbeat.js),
//     fenced by the ledger's OWN owner epoch/session — never the caller's
//     environment — so reuse can never masquerade as a takeover.
//
// `--classify` is a report-only mode (parity with `run-outward`'s shape): it
// answers "what does this FAFF_RUN_DIR mean?" without writing, so §0a and plot
// Ignition can each shell out to the SAME classification this verb's own write
// path already trusts, rather than re-deriving the ladder in prose per call site.
// ===========================================================================

"use strict";

const fs = require("fs");
const path = require("path");

const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const { mutateLedgerUnderLock } = require("./heartbeat");
const { prdCreativeLicenceFromFlag, prdRootContainerFromFlags } = require("./lights-out");

// The byte-identical mint id `mintLightsOut` (lights-out.js) stamps, plus the
// `claimRunDir` collision suffix — the ONE shape a genuine lights-out mint's
// run_id can take. A ledger claiming level:"L4" whose run_id doesn't match this
// is a foreign handoff, never a legitimate inherited ledger (see the classifier).
const LIGHTS_OUT_SHAPE_RE = /^run-\d{8}-\d{6}-lights-out(-[0-9a-f]{6})?$/;

function matchesLightsOutShape(id) {
  return typeof id === "string" && LIGHTS_OUT_SHAPE_RE.test(id);
}

const INHERITED_RUN_DIR_VERDICTS = ["not-l4", "inherited-l4", "fault"];

// PURE (fs reads only, no writes, never throws) — classify what a candidate
// `FAFF_RUN_DIR` means for the §0a / plot-Ignition reuse seam. `root` is accepted
// for signature parity with callers that resolve one, but this classifier never
// needs it: `env.FAFF_RUN_DIR`, when set, is already the absolute run dir.
//
//   not-l4        — unset/empty FAFF_RUN_DIR (ordinary L3 path), OR a readable
//                   ledger whose level isn't "L4" (a legitimate nested-L3 run —
//                   NOT a fault; faulting here would regress any L3 beep-boop
//                   that inherits an L3 FAFF_RUN_DIR from its own parent).
//   inherited-l4  — a readable level:"L4" ledger whose run_id matches the
//                   lights-out mint shape: the one ledger to reuse.
//   fault         — FAFF_RUN_DIR is non-empty but names no readable ledger, or
//                   an unparseable one, or an L4 ledger that is NOT a lights-out
//                   mint (foreign run-dir) — fail loud, never guess, never mint
//                   over it.
function classifyInheritedRunDir(env, root) { // eslint-disable-line no-unused-vars -- root: signature parity, see above
  const e = env || {};
  const raw = typeof e.FAFF_RUN_DIR === "string" ? e.FAFF_RUN_DIR : "";
  if (!raw) return { verdict: "not-l4", reason: "no FAFF_RUN_DIR" };

  const ledgerPath = path.join(raw, "run-ledger.json");
  if (!fs.existsSync(ledgerPath)) {
    return { verdict: "fault", reason: "FAFF_RUN_DIR names a dir with no run-ledger.json" };
  }

  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  } catch {
    return { verdict: "fault", reason: "FAFF_RUN_DIR ledger is unreadable/unparseable" };
  }
  if (!ledger || typeof ledger !== "object") {
    return { verdict: "fault", reason: "FAFF_RUN_DIR ledger is unreadable/unparseable" };
  }

  if (ledger.level !== "L4") {
    return { verdict: "not-l4", reason: "inherited ledger is not L4" };
  }

  const runId = typeof ledger.run_id === "string" ? ledger.run_id : path.basename(raw);
  if (!matchesLightsOutShape(runId)) {
    return { verdict: "fault", reason: "L4 ledger is not a lights-out mint (foreign run-dir)" };
  }

  return { verdict: "inherited-l4", runDir: raw, ledger };
}

// The narrow, lock-guarded write core. Validates via the SAME classifier every
// reuse call site shares, then mutates ONLY `prd_creative_licence` /
// `prd_root_container` — every other ledger field is byte-unchanged. Fenced by
// `expectedOwner` read from the VALIDATED ledger (never the caller's env), so a
// concurrent `--resume` takeover makes this yield (never clobber) rather than
// silently stamping a superseded owner's ledger.
//
// Returns { code, written, yielded, reason?, before_sha256?, after_sha256? } —
// `code` is the verb's own exit-contract code (see cmdRunRecordPrd below), kept
// here so the pure core and the CLI formatter never disagree on the mapping.
function recordPrdOnLedger(runDir, { licence, rootContainer }) {
  const pre = classifyInheritedRunDir({ FAFF_RUN_DIR: runDir }, null);
  if (pre.verdict === "fault") {
    return { code: 3, written: false, yielded: false, reason: pre.reason };
  }
  if (pre.verdict === "not-l4") {
    // runDir is non-empty by construction here (the CLI already refused an
    // empty/absent --run-dir with code 3 before ever calling this) — so the
    // only way to land `not-l4` is a readable ledger whose level isn't "L4".
    return { code: 2, written: false, yielded: false, reason: pre.reason };
  }

  const expectedOwner = {
    epoch: (pre.ledger.owner && pre.ledger.owner.epoch) || 0,
    session_id: pre.ledger.owner && pre.ledger.owner.session_id,
  };

  // Belt-and-braces re-assert lives INSIDE the mutate callback (the under-lock fresh
  // read) so a write never lands on a ledger that stopped being L4 between the
  // pre-lock classify above and lock acquisition. A throw from inside the callback
  // propagates OUT of mutateLedgerUnderLock uncaught (withFileLock's `finally` only
  // releases the lock, per heartbeat.js — it never swallows the callback's own
  // exception, the same contract budget.js's baseline writer relies on) — so this
  // call is wrapped in try/catch, never left to crash the CLI on the narrow,
  // practically-unreachable race this guards against.
  let res;
  try {
    res = mutateLedgerUnderLock(runDir, (fresh) => {
      if (!fresh || fresh.level !== "L4") throw new Error(`resolved ledger in ${runDir} is not level "L4"`);
      if (licence != null) fresh.prd_creative_licence = licence;
      if (rootContainer != null) fresh.prd_root_container = rootContainer;
      return fresh;
    }, expectedOwner);
  } catch (e) {
    return { code: 2, written: false, yielded: false, reason: (e && e.message) || "ledger mutation failed" };
  }

  if (res.yielded) {
    return { code: 4, written: false, yielded: true, reason: "owner epoch/session moved on — a newer owner owns this run" };
  }
  if (!res.written) {
    return { code: 3, written: false, yielded: false, reason: "ledger write did not complete (lock contention/abort)" };
  }
  return { code: 0, written: true, yielded: false, before_sha256: res.before_sha256, after_sha256: res.after_sha256 };
}

const RUN_RECORD_PRD_SPEC = {
  flags: {
    "--run-dir": { arity: 1 },
    "--prd-creative-licence": { arity: 1 },
    "--prd-root-container": { arity: 1 },
    "--classify": { arity: 0 },
    "--json": { arity: 0 },
    "--selftest": { arity: 0 },
  },
};

const USAGE = "usage: faff run-record-prd [--run-dir DIR] [--classify | --prd-creative-licence broad|tight [--prd-root-container C]] [--json]";

function cmdRunRecordPrd(args) {
  if (args.includes("--selftest")) return runRecordPrdSelftest();
  const { values, errors } = parseArgs(args, RUN_RECORD_PRD_SPEC);
  if (errors.length) return usageError(errors, USAGE);
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const json = !!values["--json"];
  const runDir = get("--run-dir") || process.env.FAFF_RUN_DIR || null;

  // --classify — report-only (parity with `run-outward`): answers what this
  // FAFF_RUN_DIR means WITHOUT writing, so §0a / plot Ignition can shell out to
  // the exact same classification this verb's own write path trusts. Exit 0
  // regardless of verdict — the caller branches on the payload, mirrors
  // run-outward's "does not decide, only reports" stance.
  if (values["--classify"]) {
    // `root` is accepted by the classifier for signature parity only (it never reads
    // it — see classifyInheritedRunDir above) — no `--root` flag exists on this verb
    // (unlike run-ledger/lint-cli-doc): there is nothing here to search FROM, only a
    // FAFF_RUN_DIR to validate. findRoot() is resolved anyway so the param is never
    // literally undefined, but it is genuinely inert.
    const v = classifyInheritedRunDir({ FAFF_RUN_DIR: runDir }, findRoot());
    const payload = { verdict: v.verdict, run_dir: v.runDir || runDir || null, reason: v.reason || null };
    if (json) process.stdout.write(JSON.stringify(payload) + "\n");
    else process.stdout.write(`verdict: ${payload.verdict}${payload.reason ? ` (${payload.reason})` : ""}\n`);
    return 0;
  }

  if (!runDir) {
    const msg = "faff run-record-prd: no ledger resolvable (pass --run-dir or set $FAFF_RUN_DIR)";
    if (json) process.stdout.write(JSON.stringify({ written: false, error: msg }) + "\n");
    else process.stderr.write(msg + "\n");
    return 3;
  }

  // Validate flag SHAPE before touching the ledger — reuses the mint-side
  // validators verbatim (never a forked vocabulary check).
  const licenceRaw = get("--prd-creative-licence");
  const prdLicence = prdCreativeLicenceFromFlag(licenceRaw);
  if (!prdLicence.ok) {
    const msg = `faff run-record-prd: --prd-creative-licence must be "broad" or "tight" (got ${JSON.stringify(licenceRaw)})`;
    if (json) process.stdout.write(JSON.stringify({ written: false, error: msg }) + "\n");
    else process.stderr.write(msg + "\n");
    return 2;
  }
  const containerRaw = get("--prd-root-container");
  const prdRoot = prdRootContainerFromFlags(containerRaw, licenceRaw);
  if (!prdRoot.ok) {
    const msg = `faff run-record-prd: --prd-root-container requires --prd-creative-licence and a non-empty value (got ${JSON.stringify(containerRaw)})`;
    if (json) process.stdout.write(JSON.stringify({ written: false, error: msg }) + "\n");
    else process.stderr.write(msg + "\n");
    return 2;
  }

  const result = recordPrdOnLedger(runDir, { licence: prdLicence.value, rootContainer: prdRoot.value });
  if (result.code !== 0) {
    const msg = `faff run-record-prd: ${result.reason}`;
    if (json) process.stdout.write(JSON.stringify({ written: false, yielded: !!result.yielded, error: msg }) + "\n");
    else process.stderr.write(msg + "\n");
    return result.code;
  }

  if (json) {
    process.stdout.write(JSON.stringify({
      written: true,
      run_dir: runDir,
      prd_creative_licence: prdLicence.value != null ? prdLicence.value : undefined,
      prd_root_container: prdRoot.value != null ? prdRoot.value : undefined,
      ledger_sha256_before: result.before_sha256,
      ledger_sha256_after: result.after_sha256,
    }) + "\n");
  } else {
    process.stdout.write(`recorded onto ${runDir}\n`);
  }
  return 0;
}

// In-memory selftest (mirrors run-outward/run-ledger): pure classifier + record-core
// assertions over a throwaway tmp tree, plus real mutateLedgerUnderLock round-trips.
function runRecordPrdSelftest() {
  const os = require("os");
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

  // --- matchesLightsOutShape ---
  ok("shape: accepts the byte-identical mint id", matchesLightsOutShape("run-20260819-045200-lights-out"));
  ok("shape: accepts the claimRunDir collision suffix", matchesLightsOutShape("run-20260819-045200-lights-out-a1b2c3"));
  ok("shape: rejects a graft-minted L2 id", !matchesLightsOutShape("run-20260819-045200-graft-FAFF-1"));
  ok("shape: rejects a non-string", !matchesLightsOutShape(undefined));

  // --- classifyInheritedRunDir: unset/empty ---
  ok("classify: unset FAFF_RUN_DIR -> not-l4", classifyInheritedRunDir({}, "/root").verdict === "not-l4");
  ok("classify: empty-string FAFF_RUN_DIR -> not-l4 (indistinguishable from unset)", classifyInheritedRunDir({ FAFF_RUN_DIR: "" }, "/root").verdict === "not-l4");

  let tmp = null;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-run-record-prd-selftest-"));

    // --- classify: non-empty FAFF_RUN_DIR naming a dir with no ledger -> fault ---
    const noLedgerDir = path.join(tmp, "no-ledger");
    fs.mkdirSync(noLedgerDir, { recursive: true });
    ok("classify: non-empty FAFF_RUN_DIR, no run-ledger.json -> fault", classifyInheritedRunDir({ FAFF_RUN_DIR: noLedgerDir }, tmp).verdict === "fault");

    // --- classify: unparseable ledger -> fault ---
    const badLedgerDir = path.join(tmp, "bad-ledger");
    fs.mkdirSync(badLedgerDir, { recursive: true });
    fs.writeFileSync(path.join(badLedgerDir, "run-ledger.json"), "{ not json");
    ok("classify: unparseable ledger -> fault", classifyInheritedRunDir({ FAFF_RUN_DIR: badLedgerDir }, tmp).verdict === "fault");

    // --- classify: readable non-L4 ledger -> not-l4 (legit nested-L3, NOT a fault) ---
    const l3Dir = path.join(tmp, "l3");
    fs.mkdirSync(l3Dir, { recursive: true });
    fs.writeFileSync(path.join(l3Dir, "run-ledger.json"), JSON.stringify({ level: "L3", run_id: "run-x" }));
    ok("classify: readable non-L4 ledger -> not-l4 (not fault)", classifyInheritedRunDir({ FAFF_RUN_DIR: l3Dir }, tmp).verdict === "not-l4");

    // --- classify: L4 ledger with a non-lights-out run_id -> fault (foreign) ---
    const foreignDir = path.join(tmp, "foreign-l4");
    fs.mkdirSync(foreignDir, { recursive: true });
    fs.writeFileSync(path.join(foreignDir, "run-ledger.json"), JSON.stringify({ level: "L4", run_id: "run-20260819-045200-graft-FAFF-1" }));
    ok("classify: L4 ledger, non-lights-out run_id -> fault (foreign)", classifyInheritedRunDir({ FAFF_RUN_DIR: foreignDir }, tmp).verdict === "fault");

    // --- classify: a genuine lights-out L4 ledger -> inherited-l4 ---
    const runId = "run-20260819-045200-lights-out";
    const l4Dir = path.join(tmp, ".faff", "runs", runId);
    fs.mkdirSync(l4Dir, { recursive: true });
    const nowIso = "2026-08-19T00:00:00.000Z";
    mutateLedgerUnderLock(l4Dir, () => ({
      run_id: runId, level: "L4", admitted: [], outcomes: {}, prd_creative_licence: null, prd_root_container: null,
      owner: { status: "running", session_id: "sess-1", pid: 1, started_at: nowIso, last_heartbeat: nowIso },
    }));
    const classified = classifyInheritedRunDir({ FAFF_RUN_DIR: l4Dir }, tmp);
    ok("classify: a genuine lights-out L4 ledger -> inherited-l4", classified.verdict === "inherited-l4" && classified.runDir === l4Dir);

    // --- recordPrdOnLedger: writes only the two narrow fields, all else byte-unchanged ---
    const before = JSON.parse(fs.readFileSync(path.join(l4Dir, "run-ledger.json"), "utf8"));
    const rec = recordPrdOnLedger(l4Dir, { licence: "tight", rootContainer: "faff-x" });
    ok("record: writes exit 0", rec.code === 0 && rec.written === true);
    const after = JSON.parse(fs.readFileSync(path.join(l4Dir, "run-ledger.json"), "utf8"));
    ok("record: prd_creative_licence set", after.prd_creative_licence === "tight");
    ok("record: prd_root_container set", after.prd_root_container === "faff-x");
    ok("record: every other field byte-unchanged", after.run_id === before.run_id && after.level === before.level && JSON.stringify(after.owner) === JSON.stringify(before.owner) && JSON.stringify(after.admitted) === JSON.stringify(before.admitted));

    // --- record: idempotent re-run is a byte-stable no-op, exit 0 ---
    const rec2 = recordPrdOnLedger(l4Dir, { licence: "tight", rootContainer: "faff-x" });
    ok("record: idempotent re-run is exit 0", rec2.code === 0 && rec2.written === true);
    const after2 = JSON.parse(fs.readFileSync(path.join(l4Dir, "run-ledger.json"), "utf8"));
    ok("record: idempotent re-run leaves values byte-stable", after2.prd_creative_licence === "tight" && after2.prd_root_container === "faff-x");

    // --- record: not-L4 ledger -> exit 2, never writes ---
    const rec3 = recordPrdOnLedger(l3Dir, { licence: "tight", rootContainer: null });
    ok("record: not-L4 ledger -> exit 2", rec3.code === 2 && rec3.written === false);

    // --- record: absent ledger -> exit 3, never writes ---
    const rec4 = recordPrdOnLedger(noLedgerDir, { licence: "tight", rootContainer: null });
    ok("record: absent ledger -> exit 3", rec4.code === 3 && rec4.written === false);

    // --- record: superseded owner (epoch fence) -> exit 4, nothing written ---
    const fencedDir = path.join(tmp, ".faff", "runs", "run-20260819-050000-lights-out");
    fs.mkdirSync(fencedDir, { recursive: true });
    mutateLedgerUnderLock(fencedDir, () => ({
      run_id: "run-20260819-050000-lights-out", level: "L4", admitted: [], outcomes: {},
      prd_creative_licence: null, prd_root_container: null,
      owner: { status: "running", epoch: 1, session_id: "sess-new", pid: 1, started_at: nowIso, last_heartbeat: nowIso },
    }));
    // Simulate a stale writer that validated against epoch 0 (before a resume bumped it to 1):
    // classifyInheritedRunDir reads the CURRENT on-disk ledger (epoch 1), so to exercise the
    // fence we call the lock core directly with a deliberately-stale expectedOwner.
    const staleRes = mutateLedgerUnderLock(fencedDir, (fresh) => {
      fresh.prd_creative_licence = "broad";
      return fresh;
    }, { epoch: 0, session_id: "sess-old" });
    ok("record: owner-epoch fence yields on a superseded writer", staleRes.yielded === true && staleRes.written === false);
    const afterFence = JSON.parse(fs.readFileSync(path.join(fencedDir, "run-ledger.json"), "utf8"));
    ok("record: fenced write leaves the ledger untouched", afterFence.prd_creative_licence === null);
  } catch (e) {
    ok(`selftest threw: ${e && e.message}`, false);
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  INHERITED_RUN_DIR_VERDICTS,
  classifyInheritedRunDir,
  matchesLightsOutShape,
  recordPrdOnLedger,
  cmdRunRecordPrd,
  runRecordPrdSelftest,
};
