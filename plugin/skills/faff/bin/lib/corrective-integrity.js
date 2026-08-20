// ===========================================================================
// === region:factory — corrective-integrity — FAFF-373 (fail-safe half) + FAFF-325 (activation half). ===
// Under a shared uid faff cannot cryptographically stop a same-uid build lane
// from forging a corrective artifact or rewriting run-ledger.json (bin/faff:1683 —
// "Guardrail, not cryptographic control: a local agent can always write a
// marker"). FAFF-373 shipped DISTRUST BY DEFAULT (asserted:false for every
// input, no trust channel wired). FAFF-325 wires the one trust channel ADR-0061
// admits: an OUTER-LAYER, launch-time declaration
// (`FAFF_INTEGRITY_BOUNDARY=<version>:<dir1>,<dir2>,...`) read ONLY from pid-1's
// environ (`/proc/1/environ`, via the injectable fsq — mirrors container-check's
// containerCheck) — NEVER the CLI's own inherited process env, which shells here
// can poison via shared-fs profile files. No crypto, no secret, no signature — a
// shared-uid secret is itself forgeable, so it is false assurance (ADR-0061); the
// fs boundary set by the outer layer before this process even starts is the only
// closing mechanism. faff's role is ASSERTION, not creation (ADR-0010): with no
// outer-layer mount + declaration, the probe stays asserted:false forever — that
// is correct fail-safe behaviour, not a bug.
// PURE over (env, fsq, requiredDirs) like container-check; the CLI wrapper does the I/O.
// ===========================================================================

const path = require("node:path");
const fs = require("node:fs");
const { realFsq } = require("./container-check");
const { parseArgs, usageError } = require("./argv");

const INTEGRITY_DECL_ENV = "FAFF_INTEGRITY_BOUNDARY";
// FAFF-514: faff owns the (version, dir-set) content of the declaration. The version token is
// PROVENANCE, not a gate — the reader (correctiveIntegrityProbe) never compares it. Bump only if the
// MEANING of the canonical print changes incompatibly; a dir-set addition under the ancestor is not a bump.
const INTEGRITY_BOUNDARY_VERSION = "v1";
// The three "a declaration exists but fails verification" bases — tamper evidence
// or misconfiguration, as distinct from the honest "no-declaration" absence case.
// Violation is NEVER level-graded (spec §3): every consumer refuses on these.
const VIOLATION_BASES = new Set(["env-injection", "malformed", "dir-mismatch"]);

// Parse "<version>:<dir1>,<dir2>,..." -> {version, dirs} or null when malformed
// (no colon, empty version, or an empty/whitespace-only dir list).
function parseIntegrityDeclaration(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const idx = raw.indexOf(":");
  if (idx <= 0) return null; // need a non-empty version strictly before the first colon
  const version = raw.slice(0, idx);
  const dirs = raw.slice(idx + 1).split(",").map((s) => s.trim()).filter(Boolean);
  if (dirs.length === 0) return null;
  return { version, dirs };
}

// NUL-separated KEY=VALUE lookup over a /proc/<pid>/environ-shaped string — mirrors
// container-check's `container=` convention parse exactly.
function readDeclFromEnvironText(environText, key) {
  const kv = (environText || "").split("\0").find((t) => t.startsWith(key + "="));
  return kv ? kv.slice(key.length + 1) : null;
}

// A required path is "covered" by a declared dir when it EQUALS the dir or sits
// strictly under it (path.sep-bounded, so "corrective-evil" can never match a
// declared "corrective" dir by bare string prefix).
function pathCovered(requiredPath, declaredDir) {
  if (requiredPath === declaredDir) return true;
  const withSep = declaredDir.endsWith(path.sep) ? declaredDir : declaredDir + path.sep;
  return requiredPath.startsWith(withSep);
}

function dirsCoverAll(declaredDirs, requiredDirs) {
  return (requiredDirs || []).every((req) => declaredDirs.some((d) => pathCovered(req, d)));
}

// Pure probe. Returns { asserted, basis[, version, dirs] }. Trust ONLY ever comes
// from `fsq.readEnviron("/proc/1/environ")` — `env` (the CLI's own inherited
// process env) is read ONLY to detect a poisoning attempt (a declaration present
// there that pid-1 does not corroborate), never as a trust source itself.
// `env` NEVER contributes a positive trust signal, including on agreement: the
// asserted:true branch below is derived ENTIRELY from the pid-1 value (`parsed`),
// never from `env` matching it. A build lane that reads its own pid-1's genuine
// declaration (same-uid read access) and copies it into its OWN inherited env
// gains nothing — it cannot rewrite pid-1's actual environ (a fixed exec-time
// kernel snapshot, not a live/writable channel from a sibling process), and the
// probe's trust decision was already earned by that same genuine pid-1 value
// regardless of what `env` says. `env` agreement is therefore inert, not a hole
// (adversarial review, FAFF-325 — disposition: proven false, logged).
// `requiredDirs` is the explicitly-passed integrity-dir set the declaration's
// ro-dir-set must cover (FAFF-337: the probe never does latest-run discovery); a
// non-array value degrades to "nothing required", never to a security hole.
// SCOPE NOTE (assert-don't-implement, ADR-0010): the probe verifies the
// declaration's SOURCE is unforgeable by the build lane and its dir set is not
// too NARROW (dirsCoverAll below) — it does NOT and CANNOT verify the outer
// layer's declaration is HONEST (that the mount genuinely, exactly matches the
// declared dirs, no broader). A declaration of "/" is not a code bug here; it is
// an outer-layer correctness question this ticket explicitly does not scope in —
// "asserts, not creates" (see the module header + ADR-0061). Faff trusts the
// launcher's claim once it is confirmed genuinely pid-1-sourced; it never audits
// the launcher's honesty (adversarial review, FAFF-325 — logged, out of scope).
//   asserted:true  ONLY when: a pid-1 declaration exists, is well-formed, AND its
//                  dir set ⊇ requiredDirs.
//   asserted:false otherwise, with `basis` distinguishing:
//     no-declaration — honest absence (nothing in pid-1 environ, nothing inherited).
//     env-injection  — a declaration in the inherited env with no pid-1 match, or
//                      one that disagrees with a genuine pid-1 declaration.
//     malformed      — a pid-1 declaration exists but does not parse.
//     dir-mismatch   — a well-formed pid-1 declaration whose dir set does not
//                      cover requiredDirs (a bypass, not a partial pass).
function correctiveIntegrityProbe(env, fsq, requiredDirs) {
  env = env || {};
  const dirs = Array.isArray(requiredDirs) ? requiredDirs : [];
  const pid1Text = (fsq && typeof fsq.readEnviron === "function") ? (fsq.readEnviron("/proc/1/environ") || "") : "";
  const pid1Decl = readDeclFromEnvironText(pid1Text, INTEGRITY_DECL_ENV);
  const inheritedDecl = Object.prototype.hasOwnProperty.call(env, INTEGRITY_DECL_ENV) ? String(env[INTEGRITY_DECL_ENV]) : null;

  if (pid1Decl === null) {
    return inheritedDecl === null ? { asserted: false, basis: "no-declaration" } : { asserted: false, basis: "env-injection" };
  }
  if (inheritedDecl !== null && inheritedDecl !== pid1Decl) return { asserted: false, basis: "env-injection" };

  const parsed = parseIntegrityDeclaration(pid1Decl);
  if (!parsed) return { asserted: false, basis: "malformed" };
  if (!dirsCoverAll(parsed.dirs, dirs)) return { asserted: false, basis: "dir-mismatch" };

  return { asserted: true, basis: "asserted", version: parsed.version, dirs: parsed.dirs };
}

// Pure gate. Given a probe result + a consumer, decide trust + disposition.
// asserted:true -> trusted, for every consumer.
// Unasserted degrades per consumer:
//   corrective  -> channel-D (human relay; FAFF-326's future wiring).
//   detection   -> reconcile-only (ledger content cross-checked vs git; FAFF-324).
//   merge-floor -> "refuse" on a violation basis (never level-graded — every level
//                  refuses); "unasserted" on honest absence (cmdMergeGate then
//                  applies its OWN level-branch: L4 defence-in-depth refuse,
//                  L1-L3 proceed+annotate — level-sourcing lives THERE, on the
//                  invocation-context --level flag, never here and never off
//                  run-ledger.json, per the "forged level input" failure mode).
// An UNKNOWN consumer fails safe to channel-D — never trusted.
function integrityGate(probeResult, consumer) {
  const p = probeResult || {};
  if (p.asserted === true) return { trusted: true, disposition: "trusted" };
  if (consumer === "merge-floor") {
    return VIOLATION_BASES.has(p.basis)
      ? { trusted: false, disposition: "refuse" }
      : { trusted: false, disposition: "unasserted" };
  }
  if (consumer === "detection") return { trusted: false, disposition: "reconcile-only" };
  return { trusted: false, disposition: "channel-D" };
}

// FAFF-892 (merge-floor sibling to ADR-0114): the composition fold that admits the
// digest-custody basis into the MERGE-FLOOR decision as a distinct, weaker basis than
// mount-asserted. Pure — no I/O. Mirrors corrective.js's `foldCorrectiveAuthority`, but
// adds branch 2 (the mount-violation branch): `integrityGate(_, "merge-floor")` DOES
// return disposition "refuse" on a VIOLATION_BASES probe (the corrective consumer never
// does), so a proven-invalid declaration must refuse ABOVE the digest consult — a clean
// digest can NEVER rescue a forged/malformed/dir-mismatched declaration. Precedence is
// load-bearing: branch 1 (mount-trusted) wins over any digest state; branch 2 (mount
// violation) sits above the digest branches; branch 3 (uncomputable verify) sits above
// the grant so an indeterminate verify never falls through to trust. `integrityGate`
// itself is UNCHANGED — composition lives here, never inline in the gate (ADR-0114).
//
// mountGate    = integrityGate(correctiveIntegrityProbe(env, fsq, dirs), "merge-floor")
// digestVerify = a discriminated union the CALLER constructs (never computed here) —
// `error` and `diffs` are MUTUALLY EXCLUSIVE (the caller sets exactly one):
//   { held: false }                         no per-issue custody verdict admitted
//   { held: true, diffs: [] }               verify clean over the forge surface
//   { held: true, diffs: [<paths>, ...] }   verify reports tampered members
//   { held: true, error: <reason> }         verify could not be computed / untrustworthy
// Anti-pattern (the caller's obligation): `try { diffs = verify(...) } catch { diffs = [] }`
// — defaulting a throw to empty diffs flips an uncomputable verify (branch 3) into
// custody-trusted (branch 4). The caller MUST construct { held: true, error } on a throw;
// this fold's branch-3-before-4 ordering is what makes that construction load-bearing.
function foldMergeFloorAuthority(mountGate, digestVerify) {
  if (mountGate && mountGate.trusted === true) {
    return { trusted: true, disposition: "trusted", basis: "asserted" }; // branch 1: strongest wins
  }
  if (mountGate && mountGate.disposition === "refuse") {
    return { trusted: false, disposition: "refuse", basis: "violated-mount" }; // branch 2: a genuine violation refuses, ABOVE the digest consult
  }
  const dv = digestVerify || { held: false };
  if (dv.held === true && dv.error != null) {
    return { trusted: false, disposition: "refuse", basis: "unverifiable" }; // branch 3: never trust an uncomputable verify
  }
  if (dv.held === true && Array.isArray(dv.diffs) && dv.diffs.length === 0) {
    return { trusted: true, disposition: "custody-trusted", basis: "digest-verified" }; // branch 4: the grant
  }
  if (dv.held === true && Array.isArray(dv.diffs) && dv.diffs.length > 0) {
    return { trusted: false, disposition: "refuse", basis: "tampered" }; // branch 5: proven forge
  }
  return { trusted: false, disposition: "unasserted", basis: "none" }; // branch 6: no bracket ran — caller applies today's level-branch
}

// The forge-surface path set for a run: the corrective-artifact dir + run-ledger.json
// (FAFF-373), PLUS — when `issue` is given — the five per-issue evidence members:
// the three merge-floor artifacts F1's audit fold added (FAFF-325):
// <run-dir>/<issue>/ac-checklist.json, <run-dir>/<issue>/review-verdict.json,
// <run-dir>/<issue>/holdout.json, and (FAFF-751, ADR-0077 Decision 7 delivered) the
// two merge-tail records now written on the trusted side after slices 1–2 relocated
// their writers above the dispatch cut: <run-dir>/<issue>/merge-record.json and
// <run-dir>/<issue>/post-merge-verification.json. Omitting `issue` (the L4 run-start
// preflight call site, which runs before any issue is dispatched and before a run-dir
// even exists) yields the original 2-entry set — existing callers are unaffected.
// Single-sourced from the SAME run-dir layout readAcComplete/readReviewVerdict/
// readHoldout use in merge-gate.js; never a second, divergent hand-written list.
// PURE — derives paths only.
// FAFF-466: an additive, opt-in third `opts.events` param appends events.jsonl to
// the forge surface for the `detection` consumer only — the `corrective`/`merge-floor`
// 2-/7-entry shapes those callers (`merge-gate.js`'s `resolveIntegrity`, `corrective.js`)
// depend on stay byte-identical (opts omitted ⇒ unchanged return).
// Member-count contract: correctiveIntegrityDirs(runDir) -> 2;
// correctiveIntegrityDirs(runDir, issue) -> 7;
// correctiveIntegrityDirs(runDir, null, {events:true}) -> 3;
// correctiveIntegrityDirs(runDir, issue, {events:true}) -> 8.
// The two merge-tail members are byte-exact (default snapshotMember branch), NOT
// prefix-preserving; only events.jsonl keeps the append-tolerant carve-out (Decision 5).
function correctiveIntegrityDirs(runDir, issue, opts) {
  const dirs = [
    path.join(runDir, "corrective"),
    path.join(runDir, "run-ledger.json"),
  ];
  if (issue) {
    dirs.push(
      path.join(runDir, issue, "ac-checklist.json"),
      path.join(runDir, issue, "review-verdict.json"),
      path.join(runDir, issue, "holdout.json"),
      path.join(runDir, issue, "merge-record.json"),
      path.join(runDir, issue, "post-merge-verification.json"),
    );
  }
  if (opts && opts.events === true) {
    dirs.push(path.join(runDir, "events.jsonl"));
  }
  return dirs;
}

// === FAFF-514: the integrity-boundary EMITTER — faff originates the declaration's CONTENT ===
// The cage (and today's hand-operator) shells this to compose FAFF_INTEGRITY_BOUNDARY instead of
// hand-writing faff-internal dir names, so a future dir-set change is a faff-only change. Origin
// only — never reads/validates pid-1 environ (that is the reader's separate authority).

// Strict root resolution — NEVER a guessed path (an emitter whose output becomes a trust declaration
// must fail rather than guess). Deliberately tightens findRoot (which falls back to path.resolve(cwd)):
// an explicit --root must EXIST; without it, walk up for the first .git/.faff/.faffrc.yaml ancestor.
function integrityBoundaryResolveRoot(explicitRoot) {
  if (explicitRoot != null) {
    const abs = path.resolve(explicitRoot);
    try { if (!fs.statSync(abs).isDirectory()) throw 0; } catch { return { root: null, err: `--root ${JSON.stringify(explicitRoot)} is not an existing directory` }; }
    return { root: abs };
  }
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, ".faff")) || fs.existsSync(path.join(dir, ".faffrc.yaml"))) return { root: dir };
    const parent = path.dirname(dir);
    if (parent === dir) return { root: null, err: "no .git/.faff/.faffrc.yaml marker found walking up from cwd — never printing a guessed path" };
    dir = parent;
  }
}

// Pure: (resolved opts) -> {version, mode, dirs, declaration} | {err}. Launch grain (default) prints
// the stable ancestor <root>/.faff/runs (coverage math accepts ancestors, and per-run paths can't
// exist at cage launch); run-dir grain prints the exact correctiveIntegrityDirs set. A comma in any
// emitted path fails loud — it would re-parse into a different (silently-wrong) dir set.
function integrityBoundaryDeclaration(opts) {
  const version = INTEGRITY_BOUNDARY_VERSION;
  let dirs, mode;
  if (opts.runDir != null) {
    mode = "run-dir";
    dirs = correctiveIntegrityDirs(opts.runDir, opts.issue || null, opts.events ? { events: true } : undefined);
  } else {
    mode = "launch";
    dirs = [path.join(opts.root, ".faff", "runs")];
  }
  for (const d of dirs) if (String(d).includes(",")) return { err: `emitted path contains a comma (would corrupt the comma-separated declaration): ${d}` };
  return { version, mode, dirs, declaration: `${version}:${dirs.join(",")}` };
}


const INTEGRITY_BOUNDARY_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--events": { arity: 0 }, "--root": { arity: 1 }, "--run-dir": { arity: 1 }, "--issue": { arity: 1 } } };

function cmdIntegrityBoundary(args) {
  if (args.includes("--selftest")) return integrityBoundarySelftest();
  const parsed = parseArgs(args, INTEGRITY_BOUNDARY_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff integrity-boundary [--run-dir DIR [--issue ID] [--events]] [--root DIR] [--json]");
  const values = parsed.values;
  const json = !!values["--json"];
  const val = (name) => (values[name] === undefined ? null : values[name]);
  const runDir = val("--run-dir");
  const issue = val("--issue");
  const events = !!values["--events"];

  if (runDir === null && (issue !== null || events)) { process.stderr.write("faff integrity-boundary: --issue/--events modify the per-run set only — pass them with --run-dir\n"); return 2; }
  let res;
  if (runDir !== null) {
    if (!runDir) { process.stderr.write("faff integrity-boundary: --run-dir requires a directory argument\n"); return 2; }
    if (issue === "") { process.stderr.write("faff integrity-boundary: --issue requires an argument\n"); return 2; }
    // --issue composes a run-dir SUBPATH (path.join(runDir, issue, …)); a separator or `..` would
    // escape the run-dir and emit a silently-wrong forge-surface declaration — fail loud instead.
    if (issue && (/[/\\]/.test(issue) || issue.split(/[/\\]/).includes("..") || issue.includes(".."))) { process.stderr.write(`faff integrity-boundary: --issue must not contain a path separator or '..' (got ${JSON.stringify(issue)})\n`); return 2; }
    res = integrityBoundaryDeclaration({ runDir, issue: issue || null, events });
  } else {
    const rootArg = val("--root");
    if (rootArg === "") { process.stderr.write("faff integrity-boundary: --root requires a directory argument\n"); return 2; }
    const r = integrityBoundaryResolveRoot(rootArg);
    if (r.err) { process.stderr.write(`faff integrity-boundary: ${r.err}\n`); return 2; }
    res = integrityBoundaryDeclaration({ root: r.root });
  }
  if (res.err) { process.stderr.write(`faff integrity-boundary: ${res.err}\n`); return 2; }
  if (json) console.log(JSON.stringify({ version: res.version, mode: res.mode, dirs: res.dirs, declaration: res.declaration }));
  else console.log(res.declaration);
  return 0;
}

// The round-trip property IS the emitter's contract: the default launch print for root R makes a
// pid-1 environ fixture assert against correctiveIntegrityDirs for a run under R (the ancestor covers
// the full per-issue, events-on surface); and the per-run print equals the declaration of exactly
// that set — both sides are the same function, so emitter and reader can never drift.
function integrityBoundarySelftest() {
  let total = 0, fail = 0;
  const ok = (cond, label) => { total++; if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };
  const mkFsq = (environText) => ({ readEnviron: () => environText || "" });
  const R = path.join("/tmp", "faff-ib-root");
  const runsAncestor = path.join(R, ".faff", "runs");

  // launch grain
  const launch = integrityBoundaryDeclaration({ root: R });
  ok(launch.declaration === `v1:${runsAncestor}` && launch.mode === "launch" && launch.dirs.length === 1, "launch: v1:<root>/.faff/runs, single dir");

  // ROUND-TRIP: the launch ancestor asserts against the full per-issue, events-on forge surface
  const someRun = path.join(runsAncestor, "run-20260716");
  for (const [iss, ev] of [[null, false], ["FAFF-9", false], ["FAFF-9", true]]) {
    const req = correctiveIntegrityDirs(someRun, iss, ev ? { events: true } : undefined);
    ok(correctiveIntegrityProbe({ [INTEGRITY_DECL_ENV]: launch.declaration },
      mkFsq(`${INTEGRITY_DECL_ENV}=${launch.declaration}`), req).asserted === true,
      `round-trip: launch ancestor asserts over correctiveIntegrityDirs(issue=${iss}, events=${ev})`);
  }

  // run-dir grain equals the declaration of exactly that set, for every issue×events combination
  for (const [iss, ev] of [[null, false], ["FAFF-9", false], ["FAFF-9", true]]) {
    const d = integrityBoundaryDeclaration({ runDir: someRun, issue: iss, events: ev });
    const expect = `v1:${correctiveIntegrityDirs(someRun, iss, ev ? { events: true } : undefined).join(",")}`;
    ok(d.declaration === expect && d.mode === "run-dir", `run-dir grain equals correctiveIntegrityDirs join (issue=${iss}, events=${ev})`);
  }

  // reader stays version-ungated: an arbitrary token still asserts
  const weird = `weird-7:${correctiveIntegrityDirs(someRun, "FAFF-9", { events: true }).join(",")}`;
  ok(correctiveIntegrityProbe({ [INTEGRITY_DECL_ENV]: weird }, mkFsq(`${INTEGRITY_DECL_ENV}=${weird}`),
    correctiveIntegrityDirs(someRun, "FAFF-9", { events: true })).asserted === true, "reader ungated: arbitrary version token still asserts");

  // NEGATIVE round-trip: a SIBLING of the runs ancestor must NOT assert over a run under .faff/runs
  // (proves pathCovered's separator-bounding actually bites — the ancestor acceptance isn't a substring match).
  const siblingDecl = `v1:${path.join(R, ".faff", "runs-other")}`;
  ok(correctiveIntegrityProbe({ [INTEGRITY_DECL_ENV]: siblingDecl }, mkFsq(`${INTEGRITY_DECL_ENV}=${siblingDecl}`),
    correctiveIntegrityDirs(someRun, "FAFF-9", { events: true })).asserted === false,
    "negative round-trip: a sibling `.faff/runs-other` ancestor does NOT assert over a run under `.faff/runs`");

  // comma-in-path fails loud
  ok(integrityBoundaryDeclaration({ root: path.join("/tmp", "has,comma") }).err != null, "comma in any emitted path -> err (never a corrupt declaration)");

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} checks, ${fail} failed)`);
  return fail ? 1 : 0;
}

const CONSUMERS = ["corrective", "detection", "merge-floor"];

const CORRECTIVE_INTEGRITY_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--consumer": { arity: 1 }, "--run-dir": { arity: 1 }, "--issue": { arity: 1 } } };

function cmdCorrectiveIntegrity(args) {
  if (args.includes("--selftest")) return correctiveIntegritySelftest();
  const { values, errors } = parseArgs(args, CORRECTIVE_INTEGRITY_SPEC);
  if (errors.length) return usageError(errors, "usage: faff corrective-integrity [--consumer NAME] [--run-dir DIR [--issue ID]] [--json]");
  const json = !!values["--json"];
  const consumer = values["--consumer"] || "corrective";
  // Closed vocabulary — reject an unknown --consumer loudly (usage error, exit 2),
  // matching the CLI's other flag validation. The gate's unknown->channel-D fail-safe
  // is defence-in-depth, not a licence for the CLI to accept garbage silently.
  if (!CONSUMERS.includes(consumer)) {
    process.stderr.write(`corrective-integrity: unknown --consumer '${consumer}' (expected: ${CONSUMERS.join(" | ")})\n`);
    return 2;
  }
  const runDir = values["--run-dir"] === undefined ? null : values["--run-dir"];
  const issue = values["--issue"] === undefined ? null : values["--issue"];
  // No --run-dir -> no required dirs (the probe can still surface no-declaration /
  // env-injection / malformed; dir-mismatch needs a concrete dir set to check).
  // FAFF-466: the `detection` consumer's forge surface additionally covers
  // events.jsonl — the consumer name alone is enough to opt in, no new CLI flag.
  const dirs = runDir ? correctiveIntegrityDirs(runDir, issue, consumer === "detection" ? { events: true } : undefined) : [];
  const probe = correctiveIntegrityProbe(process.env, realFsq(), dirs);
  const gate = integrityGate(probe, consumer);
  const out = { asserted: probe.asserted, basis: probe.basis, trusted: gate.trusted, disposition: gate.disposition };
  if (json) console.log(JSON.stringify(out));
  else console.log(`corrective-integrity: asserted=${out.asserted} basis=${out.basis} → trusted=${out.trusted} disposition=${out.disposition} (consumer: ${consumer})`);
  // Report/degrade, never a hard failure — an unasserted boundary is a legitimate
  // (rung-0) posture, NOT an error. Always exit 0; cmdMergeGate/lightsOutPreflight
  // are the call sites that turn a disposition into a refusal.
  return 0;
}

// In-memory selftest over synthetic fixtures — mirrors the container-check shape
// (per-case ok/FAIL + a RESULT line, non-zero on any fail).
function correctiveIntegritySelftest() {
  let total = 0, fail = 0;
  const ok = (cond, label) => { total++; if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };

  const mkFsq = (environText) => ({ readEnviron: () => environText || "" });
  const runDir = path.join("/tmp", "faff-run-xyz");
  const reqDirs = correctiveIntegrityDirs(runDir, "FAFF-1");
  const wellFormedDecl = `v1:${path.join(runDir, "corrective")},${path.join(runDir, "run-ledger.json")},${path.join(runDir, "FAFF-1")}`;
  const narrowDecl = `v1:${path.join(runDir, "corrective")}`; // omits run-ledger.json + the FAFF-1 dir

  // --- probe: honest absence ---
  ok(correctiveIntegrityProbe({}, mkFsq(""), []).basis === "no-declaration", "probe: bare env/fsq -> no-declaration");
  ok(correctiveIntegrityProbe({}, mkFsq("HOME=/root"), []).basis === "no-declaration", "probe: pid-1 environ present but no FAFF_INTEGRITY_BOUNDARY key -> no-declaration");
  ok(correctiveIntegrityProbe({}, mkFsq(""), reqDirs).asserted === false, "probe: no declaration + real required dirs -> still unasserted");

  // --- probe: env-injection (the profile-poison red-team case) ---
  ok(correctiveIntegrityProbe({ FAFF_INTEGRITY_BOUNDARY: wellFormedDecl }, mkFsq(""), []).basis === "env-injection",
    "probe: declaration ONLY in inherited env (shell-sourced rc file), absent from pid-1 -> env-injection (SECURITY-CRITICAL: never honoured)");
  ok(correctiveIntegrityProbe({ FAFF_INTEGRITY_BOUNDARY: narrowDecl }, mkFsq(`X=1\0${INTEGRITY_DECL_ENV}=${wellFormedDecl}`), []).basis === "env-injection",
    "probe: inherited env disagrees with a genuine pid-1 declaration -> env-injection (mismatch is tamper evidence)");
  ok(correctiveIntegrityProbe({ FAFF_INTEGRITY_BOUNDARY: wellFormedDecl }, mkFsq(`X=1\0${INTEGRITY_DECL_ENV}=${wellFormedDecl}`), reqDirs).asserted === true,
    "probe: inherited env AGREES with a genuine pid-1 declaration -> not penalised (still asserted when dirs cover)");

  // --- probe: malformed ---
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=garbage-no-colon`), []).basis === "malformed", "probe: pid-1 declaration with no colon -> malformed");
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=v1:`), []).basis === "malformed", "probe: pid-1 declaration with empty dir list -> malformed");
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=:${runDir}`), []).basis === "malformed", "probe: pid-1 declaration with empty version -> malformed");

  // --- probe: dir-mismatch ---
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=${narrowDecl}`), reqDirs).basis === "dir-mismatch",
    "probe: well-formed declaration whose dir set omits required dirs -> dir-mismatch (bypass, not partial pass)");
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=${narrowDecl}`), [path.join(runDir, "FAFF-1", "review-verdict.json")]).basis === "dir-mismatch",
    "probe: dir set individually omitting the review-verdict.json path -> dir-mismatch");

  // --- probe: asserted+clean ---
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=${wellFormedDecl}`), reqDirs).asserted === true,
    "probe: well-formed pid-1 declaration covering the full forge surface -> asserted:true");
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=${wellFormedDecl}`), []).asserted === true,
    "probe: well-formed declaration + no required dirs (vacuously covered) -> asserted:true");

  // --- probe: a garbage requiredDirs param never opens a hole ---
  ok(correctiveIntegrityProbe({}, mkFsq(""), { asserted: true, source: "shared-fs" }).asserted === false,
    "probe: non-array requiredDirs degrades to empty, never a trust shortcut");
  ok(correctiveIntegrityProbe({}, mkFsq(""), "trust-me").asserted === false,
    "probe: string requiredDirs degrades to empty, never a trust shortcut");

  // --- gate: corrective / detection (unchanged FAFF-373 shape) ---
  const unasserted = { asserted: false, basis: "no-declaration" };
  const violated = { asserted: false, basis: "env-injection" };
  const asserted = { asserted: true, basis: "asserted" };
  ok(integrityGate(unasserted, "corrective").disposition === "channel-D", "gate corrective/unasserted -> channel-D");
  ok(integrityGate(unasserted, "detection").disposition === "reconcile-only", "gate detection/unasserted -> reconcile-only");
  ok(integrityGate(unasserted, "wat").disposition === "channel-D", "gate unknown consumer -> channel-D (fail-safe)");
  ok(integrityGate(asserted, "corrective").trusted === true && integrityGate(asserted, "corrective").disposition === "trusted", "gate asserted:true -> trusted (any consumer)");

  // --- gate: merge-floor (FAFF-325, the F1 audit fold) ---
  ok(integrityGate(asserted, "merge-floor").disposition === "trusted", "gate merge-floor + asserted -> trusted");
  ok(integrityGate(unasserted, "merge-floor").disposition === "unasserted", "gate merge-floor + no-declaration -> unasserted (level-branch is cmdMergeGate's job)");
  for (const basis of VIOLATION_BASES) {
    ok(integrityGate({ asserted: false, basis }, "merge-floor").disposition === "refuse", `gate merge-floor + ${basis} -> refuse (violation, never level-graded)`);
  }

  // --- correctiveIntegrityDirs ---
  const base = correctiveIntegrityDirs(runDir);
  ok(base.length === 2, "correctiveIntegrityDirs(runDir): 2 base entries with no issue");
  ok(base.every((d) => d === runDir || d.startsWith(runDir + path.sep)), "correctiveIntegrityDirs(runDir): all under runDir");
  ok(base.includes(path.join(runDir, "run-ledger.json")), "correctiveIntegrityDirs(runDir): includes the ledger path");
  ok(base.includes(path.join(runDir, "corrective")), "correctiveIntegrityDirs(runDir): includes the corrective-artifact dir");
  const withIssue = correctiveIntegrityDirs(runDir, "FAFF-1");
  ok(withIssue.length === 7, "correctiveIntegrityDirs(runDir, issue): 7 entries (2 base + 3 merge-floor + 2 merge-tail)");
  ok(withIssue.includes(path.join(runDir, "FAFF-1", "ac-checklist.json")), "correctiveIntegrityDirs(runDir, issue): includes ac-checklist.json");
  ok(withIssue.includes(path.join(runDir, "FAFF-1", "review-verdict.json")), "correctiveIntegrityDirs(runDir, issue): includes review-verdict.json");
  ok(withIssue.includes(path.join(runDir, "FAFF-1", "holdout.json")), "correctiveIntegrityDirs(runDir, issue): includes holdout.json");
  ok(withIssue.includes(path.join(runDir, "FAFF-1", "merge-record.json")), "correctiveIntegrityDirs(runDir, issue): includes merge-record.json (FAFF-751)");
  ok(withIssue.includes(path.join(runDir, "FAFF-1", "post-merge-verification.json")), "correctiveIntegrityDirs(runDir, issue): includes post-merge-verification.json (FAFF-751)");

  // --- correctiveIntegrityDirs: additive opts.events extension (FAFF-466) ---
  ok(correctiveIntegrityDirs(runDir).length === 2, "correctiveIntegrityDirs(runDir) with no opts stays byte-identical (2 entries)");
  ok(correctiveIntegrityDirs(runDir, "FAFF-1").length === 7, "correctiveIntegrityDirs(runDir, issue) with no opts stays byte-identical (7 entries)");
  const withEvents = correctiveIntegrityDirs(runDir, null, { events: true });
  ok(withEvents.length === 3, "correctiveIntegrityDirs(runDir, null, {events:true}): 3 entries (2 base + events.jsonl)");
  ok(withEvents.includes(path.join(runDir, "events.jsonl")), "correctiveIntegrityDirs with {events:true} includes events.jsonl");
  const withIssueAndEvents = correctiveIntegrityDirs(runDir, "FAFF-1", { events: true });
  ok(withIssueAndEvents.length === 8, "correctiveIntegrityDirs(runDir, issue, {events:true}): 8 entries (7 + events.jsonl)");

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} checks, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = {
  cmdCorrectiveIntegrity, correctiveIntegrityDirs, correctiveIntegrityProbe,
  correctiveIntegritySelftest, integrityGate, foldMergeFloorAuthority, parseIntegrityDeclaration, VIOLATION_BASES,
  INTEGRITY_BOUNDARY_VERSION, cmdIntegrityBoundary, integrityBoundaryDeclaration,
  integrityBoundaryResolveRoot, integrityBoundarySelftest,
};
