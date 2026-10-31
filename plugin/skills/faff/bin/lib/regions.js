// ===========================================================================
// === region:factory — regions — the region map + require-graph direction lint + region selftest runner ===
//
// The CLI is real CommonJS modules (ADR 0052): each file under bin/lib (+ the
// entrypoint) carries exactly one region banner, and every cross-region
// reference is necessarily a `require("./…")` edge — there are no cross-file
// globals. `regions check` builds the file→region map from those banners and
// asserts the ADR-0042 direction invariant directly on the require graph: a
// governance file never requires a factory file; a shared-infra file requires
// no local module at all. factory→governance stays legal (the future
// package-consumer relationship). The dispatch shell (USAGE + COMMANDS + main)
// is exempt — it references everything by design. Self-spawns (`<self> <cmd>
// …`) are invisible to the lint by design: they are process boundaries, not
// require edges. NO suppression mechanism exists (an escape hatch on a
// boundary lint is the boundary leaking) — a residual violation is fixed by
// moving the code, never by silencing the lint.
// ===========================================================================

// The single in-code region map: command name → region. Drives BOTH the
// `regions check` COMMANDS-bijection assert and `regions selftest` membership —
// never a second list (this map is also the future package manifest). Membership
// of a command implies membership of its tagged section's internals.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseArgs, usageError } = require("./argv");
const { spawnSync } = require("node:child_process");
const { ENTRYPOINT } = require("./shared-infra");

// FAFF-441: the source set the direction lint + stale-null scan read now that the
// CLI is modularised — the entrypoint plus every bin/lib module, resolved relative
// to this file (co-located with the entrypoint under both install shapes). Replaces
// the pre-split single-file __filename self-read; the invariant is now enforced over
// the whole module set, not a thin entrypoint (which would make the guard vacuous).
function regionSources() {
  const libFiles = fs.readdirSync(__dirname).filter((f) => f.endsWith(".js")).sort().map((f) => path.join(__dirname, f));
  return [ENTRYPOINT, ...libFiles];
}

// FAFF-1170: the emit-coverage guard enumerates `.ts` SOURCES under bin/lib (not only `.js` — which
// is what made a `.js`-only list vacuous). The governed artifact is the committed `.js` emit, so
// every TypeScript source MUST ship its compiled sibling; a `.ts` lacking its `.js` would run
// un-emitted (and so un-governed by region lint / the import-independence guard). `FAFF_EMIT_COVERAGE_TS_DIR`
// is a test-only seam (same idiom as FAFF_TEST_LEDGER_INTERLEAVE) letting a command-level test point
// the scan at a fixture dir; it defaults to bin/lib for every real invocation.
// FAFF-1431: the scan is recursive (a nested module must not escape either leg) and shared by the
// emit floor and the TS-first leg below. Returns absolute paths, so the FAFF-1170 contract holds.
function regionsScanDir() {
  return process.env.FAFF_EMIT_COVERAGE_TS_DIR || __dirname;
}

function regionTsSources() {
  const dir = regionsScanDir();
  return regionsWalk(dir).files.filter(regionsIsTsSource).map((f) => path.join(dir, f));
}

// Existence-only floor (FAFF-1170): a `.ts` without a committed sibling `.js` emit is MISSING.
// Staleness detection (the committed `.js` is older than / differs from a fresh build) is FAFF-1171's
// `git diff --exit-code` freshness gate (ratified mitigation-sequencing), not this slice. Returns
// { missing: [string] }. `baseDir`, when given, names each file by its path under that dir.
function regionsEmitCoverage(tsFiles, baseDir) {
  const missing = [];
  for (const tsf of tsFiles) {
    const jsf = tsf.slice(0, -3) + ".js";
    const name = baseDir ? path.relative(baseDir, tsf).split(path.sep).join("/") : path.basename(tsf);
    if (!fs.existsSync(jsf)) missing.push(`${name}: no committed .js emit sibling (run \`npm run build\` under plugin/skills/faff and commit the emit)`);
  }
  return { missing };
}

// === FAFF-1431: the TS-first leg ===========================================================
// The inverse of the emit floor: a JavaScript module under bin/lib must have a `.ts` source, or be
// one of the legacy modules listed in legacy-js-modules.json. The list only shrinks: a stale entry
// fails, and with --base an entry the base did not have fails. A `.ts` outside tsconfig.json
// `include` fails too, because CI would never type-check it or rebuild its emit.
const TS_FIRST_ALLOWLIST = "legacy-js-modules.json";
const JS_MODULE_RE = /\.(?:js|mjs|cjs)$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const BASE_REF_RE = /^[A-Za-z0-9._/-]+$/;
const regionsQuote = (s) => JSON.stringify(s);
const regionsIsTsSource = (f) => f.endsWith(".ts") && !f.endsWith(".d.ts");
const regionsHasTsSibling = (f, tsSet) => f.endsWith(".js") && tsSet.has(f.slice(0, -3) + ".ts");

// Every file under `dir`, recursively, as sorted `dir`-relative `/`-separated paths. Any symlink is
// malformed rather than followed or skipped (a link must not hide a module, nor pair a source that
// lives elsewhere), and so is a name holding a control character (it could forge a log line).
function regionsWalk(dir) {
  const files = [];
  const malformed = [];
  const visit = (rel) => {
    for (const e of fs.readdirSync(rel ? path.join(dir, rel) : dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (CONTROL_CHAR_RE.test(e.name)) { malformed.push(`${regionsQuote(r)}: file name contains a control character`); continue; }
      if (e.isDirectory()) { visit(r); continue; }
      if (e.isSymbolicLink()) {
        let isDir = false;
        try { isDir = fs.statSync(path.join(dir, r)).isDirectory(); } catch { isDir = false; }
        malformed.push(`${regionsQuote(r)}: ${isDir ? "symlinked directory" : "symlinked file"} (a link must not hide or stand in for a module)`);
        continue;
      }
      files.push(r);
    }
  };
  visit("");
  files.sort();
  return { files, malformed };
}

// The `.js`, `.mjs` and `.cjs` modules under `dir`: { files, malformed }.
function regionsJsModules(dir) {
  const { files, malformed } = regionsWalk(dir);
  return { files: files.filter((f) => JS_MODULE_RE.test(f)), malformed };
}

// Shape check for an allowlist value: a sorted array of distinct bin/lib-relative JS module paths.
// Returns { entries, malformed }; any malformed line means the list cannot be trusted at all.
function regionsValidateAllowlist(value, label) {
  if (!Array.isArray(value)) return { entries: [], malformed: [`${regionsQuote(label)}: not a JSON array of bin/lib-relative paths`] };
  const malformed = [];
  value.forEach((e, i) => {
    if (typeof e !== "string") { malformed.push(`${regionsQuote(label)}: entry ${i} is not a string`); return; }
    if (CONTROL_CHAR_RE.test(e) || e.startsWith("/") || e.includes("\\") || e.split("/").includes("..") || !JS_MODULE_RE.test(e)) {
      malformed.push(`${regionsQuote(label)}: entry ${regionsQuote(e)} is not a bin/lib-relative .js, .mjs or .cjs path`);
      return;
    }
    if (i > 0 && typeof value[i - 1] === "string") {
      if (value[i - 1] === e) malformed.push(`${regionsQuote(label)}: duplicate entry ${regionsQuote(e)}`);
      else if (value[i - 1] > e) malformed.push(`${regionsQuote(label)}: entry ${regionsQuote(e)} is out of order (keep the list sorted)`);
    }
  });
  return { entries: malformed.length ? [] : value, malformed };
}

// Pure: the four TS-first rules over already-read inputs. No fs, no git.
// `baseAllowlist` (an array, or undefined) enables rule 4; `baseLabel` names it in the diagnostic.
function regionsTsFirst({ jsFiles, tsFiles, allowlist, include, baseAllowlist, baseLabel }) {
  const violations = [];
  const malformed = [];
  for (const n of [...jsFiles, ...tsFiles]) {
    if (CONTROL_CHAR_RE.test(n)) malformed.push(`${regionsQuote(n)}: file name contains a control character`);
  }
  const js = jsFiles.filter((n) => !CONTROL_CHAR_RE.test(n));
  const ts = tsFiles.filter((n) => !CONTROL_CHAR_RE.test(n));
  const tsSet = new Set(ts);
  const jsSet = new Set(js);
  const allow = new Set(allowlist);
  const inc = new Set(include);
  for (const f of js) {
    if (!regionsHasTsSibling(f, tsSet) && !allow.has(f)) {
      violations.push(`${regionsQuote(f)}: new bin/lib module has no TypeScript source (write ${regionsQuote(f.replace(JS_MODULE_RE, ".ts"))} and commit its emit; see AGENTS.md)`);
    }
  }
  for (const f of allowlist) {
    if (!jsSet.has(f) || regionsHasTsSibling(f, tsSet)) violations.push(`${regionsQuote(f)}: allowlist entry is stale (remove it from ${TS_FIRST_ALLOWLIST})`);
  }
  for (const f of ts) {
    if (!inc.has(`bin/lib/${f}`)) malformed.push(`${regionsQuote(f)}: not listed in tsconfig.json include, so CI never type-checks it or rebuilds its emit`);
  }
  if (Array.isArray(baseAllowlist)) {
    const base = new Set(baseAllowlist);
    for (const f of allowlist) {
      if (!base.has(f)) violations.push(`${regionsQuote(f)}: added to ${TS_FIRST_ALLOWLIST} since ${regionsQuote(baseLabel)}; new modules are TypeScript, the allowlist only shrinks (rebase onto ${regionsQuote(baseLabel)} if it converted this module)`);
    }
  }
  return { violations, malformed };
}

function regionsGit(cwd, args) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

// The allowlist at `ref`. When `ref` has no allowlist file, the set is derived from `ref`'s tree:
// its JS modules with no `.ts` sibling. Git always runs from the repository root, so the pathspecs
// resolve the same from any working directory. Any git failure throws (the caller maps it to
// malformed): a broken base read must never disable the ratchet.
function regionsReadBaseAllowlist(ref, { scanDir, allowlistPath }) {
  const top = regionsGit(scanDir, ["rev-parse", "--show-toplevel"]);
  if (top.error || top.status !== 0) throw new Error(`git rev-parse --show-toplevel failed beside ${regionsQuote(scanDir)}`);
  const toplevel = top.stdout.trim();
  const verify = regionsGit(toplevel, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (verify.status !== 0) throw new Error(`--base ${regionsQuote(ref)} does not name a commit`);
  const rel = (p) => path.relative(toplevel, p).split(path.sep).join("/");
  const allowRel = rel(path.join(fs.realpathSync(path.dirname(allowlistPath)), path.basename(allowlistPath)));
  if (allowRel.startsWith("../") || path.isAbsolute(allowRel)) throw new Error(`${regionsQuote(allowlistPath)} is outside the repository at ${regionsQuote(toplevel)}`);
  const present = regionsGit(toplevel, ["ls-tree", "-z", "--name-only", ref, "--", allowRel]);
  if (present.status !== 0) throw new Error(`git ls-tree ${regionsQuote(ref)} failed`);
  if (present.stdout !== "") {
    const show = regionsGit(toplevel, ["show", `${ref}:${allowRel}`]);
    if (show.status !== 0) throw new Error(`git show ${regionsQuote(`${ref}:${allowRel}`)} failed`);
    let parsed = null;
    try { parsed = JSON.parse(show.stdout); } catch { throw new Error(`${regionsQuote(allowRel)} at ${regionsQuote(ref)} is not valid JSON`); }
    if (!Array.isArray(parsed) || !parsed.every((e) => typeof e === "string")) throw new Error(`${regionsQuote(allowRel)} at ${regionsQuote(ref)} is not an array of strings`);
    return { source: "file", entries: parsed };
  }
  const scanRel = rel(fs.realpathSync(scanDir));
  const tree = regionsGit(toplevel, ["ls-tree", "-r", "-z", "--name-only", ref, "--", `${scanRel}/`]);
  if (tree.status !== 0) throw new Error(`git ls-tree -r ${regionsQuote(ref)} failed`);
  const files = tree.stdout.split("\0").filter(Boolean).map((f) => f.slice(scanRel.length + 1));
  const tsSet = new Set(files.filter(regionsIsTsSource));
  return { source: "tree", entries: files.filter((f) => JS_MODULE_RE.test(f) && !regionsHasTsSibling(f, tsSet)) };
}

// The TS-first leg's IO: read the allowlist and tsconfig.json (from the seam dir when the test seam
// is set, so a fixture never meets the real config), optionally read the base, then apply the rules.
function regionsTsFirstRun({ scanDir, files, base }) {
  const seam = process.env.FAFF_EMIT_COVERAGE_TS_DIR;
  const configDir = seam || path.resolve(__dirname, "..", "..");
  const allowlistPath = path.join(configDir, TS_FIRST_ALLOWLIST);
  const tsconfigPath = path.join(configDir, "tsconfig.json");
  const readJson = (p) => {
    let text = null;
    try { text = fs.readFileSync(p, "utf8"); } catch { return { error: `${regionsQuote(p)}: missing or unreadable` }; }
    try { return { value: JSON.parse(text) }; } catch { return { error: `${regionsQuote(p)}: not valid JSON` }; }
  };
  const malformed = [];
  const allowRead = readJson(allowlistPath);
  const tsconfigRead = readJson(tsconfigPath);
  if (allowRead.error) malformed.push(allowRead.error);
  if (tsconfigRead.error) malformed.push(tsconfigRead.error);
  if (malformed.length) return { violations: [], malformed };
  const allow = regionsValidateAllowlist(allowRead.value, allowlistPath);
  const include = tsconfigRead.value && Array.isArray(tsconfigRead.value.include) ? tsconfigRead.value.include : null;
  if (!include) malformed.push(`${regionsQuote(tsconfigPath)}: has no include array`);
  if (allow.malformed.length || malformed.length) return { violations: [], malformed: [...allow.malformed, ...malformed] };
  let baseAllowlist;
  if (base !== undefined) {
    try { baseAllowlist = regionsReadBaseAllowlist(base, { scanDir, allowlistPath }).entries; } catch (e) { return { violations: [], malformed: [String(e.message)] }; }
  }
  return regionsTsFirst({
    jsFiles: files.filter((f) => JS_MODULE_RE.test(f)),
    tsFiles: files.filter(regionsIsTsSource),
    allowlist: allow.entries,
    include,
    baseAllowlist,
    baseLabel: base,
  });
}

const REGION_MAP = {
  // governance — the flight recorder + interlocks (the extractable layer)
  "runcheck": "governance",
  "heartbeat": "governance",
  // version — FAFF-1395: the one release-version resolver (faff-version.js). Requires only node:fs +
  // node:path (no local module), so governance writers can require it without crossing into factory.
  "version": "governance",
  "events": "governance",
  "evidence": "governance",
  "effects": "governance",
  "review-progress": "governance",
  "build-progress": "governance",
  "landing-progress": "governance",
  "budget": "governance",
  "sentry": "governance",
  // sentry-poller — FAFF-470: the mint-scoped detached watchdog poller (ADR-0065's
  // primary invocation locus). Same governance family as sentry/events/heartbeat —
  // a pure tick-decision core behind a thin I/O shell, no factory-identifier
  // references (D2: kept OUT of sentry.js to preserve that module's "mutates
  // nothing on the check path" purity claim).
  "sentry-poller": "governance",
  // sentrycheck — FAFF-471: ADR-0065's cheap ASSIST watchdog locus, a Stop-hook
  // staleness consult sibling of runcheck/prepcheck. Reuses runcheck's
  // runIsOwned/runIsHeld verbatim + child-spawns the unmodified sentry CLI — same
  // governance family (a pure gate core behind a thin I/O shell), no
  // factory-identifier references.
  "sentrycheck": "governance",
  // inflightcheck — FAFF-884: the mechanical turn-end floor over the orchestrator's
  // Agent-dispatch arm, a Stop-hook sibling of runcheck/prepcheck/sentrycheck. Reuses
  // runcheck's runIsHeld + reads the run ledger for foreign-marker liveness — a pure
  // gate core behind a thin I/O shell, no factory-identifier references (same governance
  // family as sentrycheck; imports only governance/shared modules).
  "inflightcheck": "governance",
  // resumecheck — FAFF-896: the same-session release of an unworked resume claim (owner
  // running→aborted-resumable at a no-work turn-exit). Reuses runcheck's
  // runIsOwned/resolveRunDir + events' tail reader + heartbeat's mutateLedgerUnderLock —
  // a pure decision behind a thin I/O shell, governance family (no factory imports).
  "resumecheck": "governance",
  // turncheck — FAFF-854: the STATE-based turn-end floor (the enumeration-based
  // inflightcheck's sibling) — refuses a non-terminal turn-end when owner.status is
  // still "running" with a clean queue and nothing in flight. Reuses runcheck's
  // runIsOwned/runIsHeld/auditLedger + inflightcheck's owner-scope marker read — a
  // pure gate core behind a thin I/O shell, governance family (no factory imports).
  "turncheck": "governance",
  "audit": "governance",
  // reconcile — FAFF-397: the run-end GROUND-TRUTH gate, part of the same flight-recorder
  // family as runcheck (completeness) / effects (declared-vs-observed) / audit (forensics) —
  // a pure core with NO factory-identifier references, so it belongs in governance too.
  "reconcile": "governance",
  // profiles — FAFF-362: the declared vocabulary table runcheck/events/sentry read via a
  // threaded profile parameter (governance-profile.js) — pure data + a pure shape
  // validator, no factory-identifier references, mirrors `regions` itself but for the
  // governance dialect rather than the region map.
  "profiles": "governance",
  // factory — everything else (faff-the-factory's domain)
  "config": "factory",
  "sync": "factory",
  "prepcheck": "factory",
  "intakecheck": "factory",
  "intake-record": "factory",
  "contain": "factory",
  // commissaire — FAFF-828: the external Commissaire facade shell (external CLI, admission, key
  // delivery, PK publication). Requires the governance cores (producer-auth.js, events.js,
  // effects.js) — factory→governance is legal (ADR-0042); the pure split-key cores stay in
  // governance so no governance file requires this factory shell.
  "commissaire": "factory",
  // FAFF-822: the nine-scenario Phase 0 reference-matrix emitter. buildScenarioRecord /
  // renderReport are PURE (read only their inputs, no factory-identifier references) —
  // governance, and requires NO factory file (the require-graph direction lint holds).
  // Region and CLI namespace are independent axes: it is deliberately NOT a commissaire
  // facade object (ADR-0123 fixes those as contract/effect/verdict/audit), so it gets its
  // own `faff scenario-matrix` group while staying governance-region.
  "scenario-matrix": "governance",
  // self-intake — FAFF-539: the mechanical same-repo/team gate on the outward-self-intake
  // reclassification. Reads config via loadConfig (factory identifier) + imports contain's
  // isSafeRunId — factory, like contain; the pure comparator lives in shared-infra so
  // audit (governance) recomputes it without a factory reference (ADR 0042).
  "self-intake": "factory",
  // economics — a reporting CONSUMER of the governance budget helpers (reads the
  // ledger + reuses measureTokens/attemptsFromLedger), not part of the
  // extractable flight-recorder layer → factory (FAFF-357).
  "economics": "factory",
  // disposition — FAFF-396: the run-end verdict a headless wrapper exits on. Reads the
  // ledger + faff-parks + events into a DispositionReport, reuses governance's
  // auditLedger/TERMINAL_STATES (factory→governance is legal), writes nothing → factory.
  "disposition": "factory",
  // reconcile-recover — FAFF-797: the auto-close half of the merged-but-unclosed seam.
  // References factory identifiers throughout (disposition.js's readMergedMap/readMergedDetails,
  // post-merge.js's verifyPostMerge, a run-ledger record-outcome subprocess) — the same
  // "reuses factory identifiers → factory, not governance" reasoning as merge-gate/
  // post-merge-check/ci-triage above.
  "reconcile-recover": "factory",
  // machine-id — FAFF-891: collision-resistant per-host id for FAFF-889's same-box gate.
  "machine-id": "factory",
  // quality — the reporting mirror of economics: reads the run ledger + events.jsonl
  // into a QualityReport, touches no producer → factory (FAFF-418).
  "quality": "factory",
  "run-done": "factory",
  "run-ledger": "factory",
  // run-outward — the signals.outward producer feeding run-start's outward floor. A
  // pure decision core over caller-supplied TargetRef/SelfRef, no extractable
  // flight-recorder layer → factory (same shape as run-start/contain).
  "run-outward": "factory",
  // run-record-prd — FAFF-858: the narrow PRD-record verb over the one inherited L4
  // ledger, reusing lights-out.js's mint-side PRD-flag validators (factory identifiers)
  // + heartbeat.js's mutateLedgerUnderLock (governance→factory is a legal require edge
  // the other direction only; this module is itself factory, same family as run-ledger
  // which it mirrors) → factory.
  "run-record-prd": "factory",
  // run-start — FAFF-496: the run-START trigger predicate (mirror of run-done). A pure
  // signal-composing verb + belt-and-braces schemaCheck, no extractable flight-recorder
  // layer → factory.
  "run-start": "factory",
  "hooks-ensure": "factory",
  // judge-trail / judge-history — FAFF-994: the durable spec-review judgement trail writer
  // + reader core over refs/faff/judge-trail/*. Factory (git-ref plumbing over
  // run-dir scratch material, mirrors bundle.js). audit.js (governance) reaches
  // judge-history ONLY via a spawnSync self-spawn — never a require edge (see judge-trail.js
  // banner + audit.js's durable-second-source call site).
  "judge-trail": "factory",
  "judge-history": "factory",
  "merge-fence": "factory",
  // FAFF-491: the self-backgrounded-gate PreToolUse fence — same family as merge-fence
  // (a pure matcher + --hook stdin shell + --selftest), factory for the identical reason.
  "background-fence": "factory",
  "validate-adapters": "factory",
  "labels": "factory",
  "label": "factory",
  "eligible": "factory",
  // discovered-scope-priority — the shared discovered-scope priority lookup (relationship x
  // source x gate_defect -> high|medium|low). Pure total function, same shape as eligible/
  // contain -> factory.
  "discovered-scope-priority": "factory",
  "claim-verdict": "factory",
  // park-verdict — FAFF-835: the stale-park validity function. Pure age-less
  // predicate (status + signals → verdict, no tracker/clock) — same shape as
  // claim-verdict/eligible → factory.
  "park-verdict": "factory",
  // punt-scan — FAFF-1078: the blocking-vs-deferred Punt reporter. Pure spec-file read
  // (topic/OUT-OF-SCOPE crossref → PuntScanResult, no tracker/clock), reusing heading-slug's
  // headingSlug — same shape as tier/park-verdict → factory.
  "punt-scan": "factory",
  // pr-body — FAFF-214: PR-body citation-hygiene sanitizer/checker. A pure
  // string-transform core (no factory-identifier references) — same shape as
  // claim-verdict/eligible → factory.
  "pr-body": "factory",
  "admissible": "factory",
  "dod": "factory",
  "holdout": "factory",
  "spec-review-lenses": "factory",
  // verification — FAFF-1061: the interactive high-assurance verification resolver. A pure
  // config+ledger read (resolveInteractiveVerification in config.js) behind a thin resolve/selftest
  // shell — same shape as eligible/spec-review-lenses → factory.
  "verification": "factory",
  "container-check": "factory",
  // evaluator-preflight — FAFF-276: the ADR-0041 rung-2 assert-in probe; reuses
  // containerCheck/realFsq (factory) → factory, like its container-check sibling.
  "evaluator-preflight": "factory",
  // lane-boundary — FAFF-859: the emit half of the same ADR-0041 seam; a pure
  // assemble-validate-write over computeLaneBoundary (factory) → factory.
  "lane-boundary": "factory",
  "corrective-integrity": "factory",
  "integrity-boundary": "factory", // FAFF-514: the emitter half, lives in corrective-integrity.js (region:factory)
  "integrity-digest": "factory",   // FAFF-518: custody-based tamper detection over the evidence set (region:factory)
  // FAFF-819: Phase-0 recovery-bundle publish + fail-closed verify. References factory identifiers
  // (integrity-digest's buildManifest/diffAgainstManifest, contract-defs' computeBundleVerdict,
  // config's loadConfig for the bundle_store slot) — same family as integrity-digest/merge-gate.
  "bundle": "factory",
  // FAFF-889: the build-queue mutex verb — buildClaimStore (a claimStoreCore binding) in bundle.js.
  "build-claim": "factory",
  // FAFF-842: the endgame-only landing-resume concurrency floor — landingClaimStore (a THIRD
  // claimStoreCore binding, beside recoveryClaimStore/buildClaimStore) in bundle.js.
  "landing-claim": "factory",
  // FAFF-820: the read-only recovery verb. References factory identifiers throughout
  // (bundle.js's verifyBundleIdentity/resolveBundleStore, resume.js's pure resume cores,
  // lights-out.js's gatherResumeEvidence, effects.js's computeEscapes, contract-defs'
  // computeRecoveryDispositionVerdict) — same family as reconcile-recover/bundle above.
  "bundle-recover": "factory",
  // FAFF-326: corrective requires corrective-integrity (factory) directly and
  // sentry.js's sentryThresholds (governance) — factory→governance is legal (ADR
  // 0042); sentry.js itself stays governance-pure by deriving authority through a
  // CHILD spawn of this bin rather than requiring this module (see sentry.js).
  "corrective": "factory",
  "next": "factory",
  "project-next": "factory",
  "state": "factory",
  // tracker — FAFF-695: the tracker-pin classifier. Requires config (loadConfig) +
  // shared-infra (findRoot/dig) — a pure computation command, sibling of state → factory.
  "tracker": "factory",
  // queue-state — FAFF-556: the git-only queue_empty/all_parked differ. Requires
  // shared-infra (findRoot/readLedger/latestRunDir) and governance-profile
  // (activeProfile) — a pure computation command, sibling of run-done/next → factory.
  "queue-state": "factory",
  // drain-filter (FAFF-1412): filters the runner pre-check's candidates against the run
  // ledgers' decline records. Read-only over run state, requires argv + shared-infra → factory.
  "drain-filter": "factory",
  // findings-reconcile — FAFF-569: the resolved-elsewhere correlation for tidy's
  // structural diagnostics. Pure stdin→stdout computation, no local requires —
  // a pure computation command, sibling of next/contain → factory.
  "findings-reconcile": "factory",
  "park-history": "factory",
  // FAFF-993: the git-only Unpark decision + write contract. Load-time requires
  // are queue-state/heartbeat/runcheck (ledger seams) + argv/shared-infra — a
  // pure classify (classifyReEntry) plus a ledger-authority-parameterised write
  // helper; the compute core is factory, sibling of park-history's file-read shape.
  "park-reconsider": "factory",
  "gitignore-ensure": "factory",
  // FAFF-483: the harness-abstraction seam register + its lint. Requires only
  // argv + shared-infra at load time (sibling modules lazily), owns CURRENT_HARNESS
  // which backends.js now re-exports — a pure factory computation, sibling of the
  // other deterministic CLI resolvers → factory.
  "harness": "factory",
  "adr": "factory",
  // andon — FAFF-386: the push-alerting pump reads the full `andon.*` config block
  // via the factory `loadConfig` resolver (mirrors `adr`/`decisions`'s choice, not
  // budget.js/sentry.js's narrower governance-only `readGovernanceConfig`) — factory,
  // not governance, for that one edge (governance must not require factory).
  "andon": "factory",
  // decisions — FAFF-448: the ADR-lite decisions register. Requires only argv (shared-infra) +
  // shared-infra findRoot, no tracker/config/contract dependency — a pure computation command,
  // lighter sibling of adr → factory.
  "decisions": "factory",
  // decision-capture — FAFF-821: read-only decision-kernel instrumentation. Requires
  // events.js (appendEventRecord/tailReadState/sha256Hex/HEX64_RE — governance) and
  // redact.js (governance) — factory→governance is legal (ADR-0042), same family as
  // decisions/andon above.
  "decision-capture": "factory",
  // shadow-fidelity — FAFF-826: the read-only coordination-fidelity study. Imports the
  // nine in-scope pure kernels (next/eligible/run-done/queue-state/claim-verdict/park-verdict/
  // project-next/run-outward/run-start) plus decision-capture's KERNEL_REGISTRY and argv/
  // shared-infra; all factory/decision-kernel, the same read-only family as economics/disposition.
  "shadow-fidelity": "factory",
  "prd": "factory",
  // prd-checklist — FAFF-557: pure checklist-PRD parser emitting the existing prd-coverage
  // shape. Requires only contract-engine's schemaCheck (no shared-infra/governance-profile
  // dependency) — a pure producer command, sibling of prd/prdr → factory.
  "prd-checklist": "factory",
  // ratified-scope — FAFF-919: read-only ratified-scope block assembler/validator. Requires only
  // admissibility (sectionBody), decisions, prd, argv, shared-infra — a pure reader command, sibling
  // of decisions/prd → factory.
  "ratified-scope": "factory",
  "prdr": "factory",
  "profile": "factory",
  // manifest — FAFF-1103: the Tier-1 binding-manifest schema + names-only validator.
  // A pure validator behind a thin stdin/--file shell (requires only argv), the same
  // descriptor-block family as profile → factory.
  "manifest": "factory",
  // conventions — FAFF-1041: read-only repo-convention discovery (branch naming / commit-subject
  // / PR-title grammar), the third "repo archaeology" leaf beside profile/gates. Requires only
  // config (dig/loadConfig), argv, shared-infra (dig/findRoot) — a pure acquirer + resolver,
  // sibling of profile → factory.
  "conventions": "factory",
  // native-map — FAFF-1081: the pure faff-type→tracker-template-identity writer. Requires only
  // config (emitScalar), argv, shared-infra (parseYamlSubset/dig/findRoot) — a persist-only
  // writer with no MCP/env/network, sibling of config init/set → factory.
  "native-map": "factory",
  // github-templates — FAFF-1112: the pure offline GitHub issue-template scanner. Requires only
  // node:fs/path, argv, shared-infra (parseYamlSubset/findRoot) and native-map (FAFF_TYPES) — no
  // MCP/env/network/git, sibling of native-map → factory.
  "github-templates": "factory",
  "fixtures": "factory",
  "env": "factory",
  // eval — FAFF-752: the advisory touched-surface→affected-KIND-subset deriver. Reuses
  // validate-adapters.js's readJudgementSeam/loadSeamRegistryForLint (factory identifiers) +
  // shared-infra findRoot — a pure classifier behind a thin git/fs shell, sibling of
  // eligible/validate-adapters → factory.
  "eval": "factory",
  // engine — the FAFF-422 one-shot local-engine transport for engine-valued producer
  // lanes; part of the dispatch machinery, not the flight recorder → factory.
  "engine": "factory",
  "lights-out": "factory",
  "gates": "factory",
  "contract": "factory",
  "doctor": "factory",
  "worktree-check": "factory",
  // worktree-heal — FAFF-1114: self-heal a clobbered graft worktree (recreate the pruned
  // admin metadata + `git worktree repair`). Reuses worktree-prune.js's tokenMatch and shells
  // the worktree-root resolver — a fs/git surgery command, sibling of worktree-check → factory.
  "worktree-heal": "factory",
  "worktree-prune": "factory",
  "worktree-root": "factory",
  // review-target — FAFF-957: the worktree/PR-aware review-target resolver + ambient-cwd/branch
  // mismatch guard. Reuses worktree-prune.js's matcher + worktree-check.js's base resolver — both
  // factory — so it belongs in the same family.
  "review-target": "factory",
  "stage-guard": "factory",
  "lint-refs": "factory",
  "lint-cli-doc": "factory",
  // lint-cli-coverage — FAFF-581: the registry-coverage gate (every COMMANDS entry is
  // tested by a non-null selftest OR a declared test file). Sibling of lint-cli-doc,
  // reads REGION_SELFTEST_ARGV — factory, same family.
  "lint-cli-coverage": "factory",
  "regions": "factory",
  "cli-surface": "factory",
  // FAFF-350: merge-gate references factory identifiers (holdoutGateResult, decideFloor,
  // computeReviewVerdict) so it is NOT in the extractable governance layer; branch-protection-check
  // mirrors the factory container-check assert-don't-enforce probe.
  "merge-gate": "factory",
  // FAFF-1118: pr-create is the sole sanctioned `gh pr create` path, colocated in merge-gate.js and
  // reusing its factory identifiers (resolvePrCreateGrant + the chokepoint machinery) → factory, for
  // the identical reason merge-gate sits here.
  "pr-create": "factory",
  // FAFF-1426: `faff merge authorize|observe` writes the merge-step grants from the run's own facts
  // for a governed graft merged after PR open; it reuses merge-gate's factory resolvers → factory.
  merge: "factory",
  "branch-protection-check": "factory",
  // FAFF-728: the run-start GitHub-auth preflight probe — colocated in merge-gate.js, reuses its
  // spawnSync gh idiom, mirrors the branch-protection-check assert-don't-enforce probe → factory.
  "github-auth-check": "factory",
  // FAFF-385: post-merge-check reuses gates.js's discoverRungs/runRung (factory identifiers,
  // same family as gates itself) and reads merge-gate.js's merge-record.json convention —
  // factory, not governance, for the identical reason merge-gate sits here.
  "post-merge-check": "factory",
  // FAFF-391: ci-triage references factory identifiers (deriveTriageAction, CI_TRIAGE_* enums from
  // contract-defs.js) and reuses merge-gate.js's own ghJson/ghRepoSlug gh-shell helpers — the same
  // family as merge-gate/post-merge-check, for the identical reason.
  "ci-triage": "factory",
  // FAFF-1396: land drives graft's landing loop over merge-gate's observeCi and ci-triage's
  // runCiTriage (factory identifiers), the same family as ci-triage and merge-gate.
  land: "factory",
  // FAFF-1404: spec commit/verify reuse admissibility's dodSplit, config-core's spec-docs-path resolver and
  // conventions' commit_subject scheme (factory) plus the governance faff-version resolver.
  spec: "factory",
  // FAFF-1406: prep attach reuses tier, harness, config-core and contract-defs-review (factory) plus
  // the governance faff-version resolver.
  prep: "factory",
  // FAFF-1414: graft admit composes the factory kernels next, eligible, intake-provenance, admissibility,
  // claim-verdict and decision-capture with the build-claim store read (bundle.js, factory).
  graft: "factory",
  // FAFF-1435: run summary composes economics, gates-doctor, merge-gate-gh and config-core (factory)
  // with the governance reconcile, budget, events, heartbeat and holdout-record functions.
  run: "factory",
  // FAFF-1442: prose-size reads the skills dir and git history only; validate-adapters (factory) calls it.
  "prose-size": "factory",
  // FAFF-363: governance-check references the SAME factory identifiers merge-gate does
  // (readAcComplete/readReviewVerdict/readHoldout from merge-gate.js, which themselves
  // call contract-defs.js's computeReviewVerdict) — for the identical reason merge-gate
  // sits in factory, not governance, despite the name.
  "governance-check": "factory",
  // FAFF-1263: evidence-readiness requires governance-check.js (deriveAnchorDirs), a factory file,
  // so it cannot sit in the governance region beside evidence.js; it reads evidence.js (factory to governance).
  "evidence-readiness": "factory",
  // FAFF-860: landing-comment renders the ready-to-land PR comment by shelling merge-gate
  // (a factory verb) and reading FLOOR_LEVELS from contract-defs — same family as
  // governance-check/merge-gate, factory for the identical reason.
  "landing-comment": "factory",
  // FAFF-261: mechanical adversarial-backends assembly reads config via loadConfig/dig
  // (factory identifiers, config.js) — same family as config/eligible → factory.
  "adversarial-backends": "factory",
  // FAFF-341: review-iteration-cap requires config.js's VALID_APPETITES (factory identifier,
  // same family as eligible) → factory.
  "review-iteration-cap": "factory",
  // review-fixture-paths reads config via loadConfig/dig (config.js, factory identifiers) — same
  // family as review-iteration-cap/adversarial-backends → factory.
  "review-fixture-paths": "factory",
  // FAFF-523: backends reads config via loadConfig (factory identifier, config.js) for its
  // resolve/realizable subcommands — same family as adversarial-backends/engine → factory.
  "backends": "factory",
  // FAFF-707: spec-review-churn is a pure comparator over two round-record JSON files
  // (no factory-identifier reference at all — closer to park-history's file-read shape
  // than to review-iteration-cap's config-read shape) — factory, same family as the
  // other small deterministic CLI resolvers faff-prep/faff-graft shell out to.
  "spec-review-churn": "factory",
  // FAFF-1157: spec-review extract-evidence is a pure section-locator + fence-extractor over a
  // committed spec (the sibling of adr extract-intent) — factory, same family.
  "spec-review": "factory",
  // FAFF-874: spec-review-convergence is a pure comparator over the ordered round-record JSON
  // files (reuses spec-review-churn's lensSet/readRoundRecord — factory→factory is a legal
  // require edge, ADR-0042) — factory, same family as the other small deterministic CLI
  // resolvers faff-prep shells out to.
  "spec-review-convergence": "factory",
  // FAFF-886: spec-review-pin wraps assembleAdversarialBackends (adversarial-backends.js) with
  // the reviewer-pin, and spec-review-dir is a pure path resolver — both small deterministic CLI
  // resolvers the faffter-dark-spec-review occupant + faff-prep shell out to. factory→factory is
  // a legal require edge (ADR-0042).
  "spec-review-pin": "factory",
  "spec-review-dir": "factory",
  // FAFF-888: spec-review-reputation is the recompute-on-read per-backend reputation ledger
  // that strikes a candidate-degenerate spec_review reviewer at slot selection. Pure arithmetic
  // over run artifacts (reuses spec-review-pin's backendIdentity + spec-review-churn's
  // roundNumberFromPath — factory→factory, ADR-0042); same family as the other deterministic
  // spec-review resolvers.
  "spec-review-reputation": "factory",
  // FAFF-909: spec-review-window derives the next round number from disk (reuses
  // spec-review-convergence's roundFilesInDir — factory→factory, ADR-0042) and owns the
  // window.json sidecar read/write — a small deterministic CLI resolver faff-prep shells out to.
  "spec-review-window": "factory",
  // FAFF-922: spec-review-iteration-cap re-exports review-iteration-cap's APPETITE_CAP/resolver
  // (factory→factory, ADR-0042) and spec-judge-evidence shells the deterministic spec-review
  // resolvers to assemble the judge's evidence bundle — both small deterministic CLI resolvers
  // faff-prep shells out to, same family as the other spec-review resolvers → factory.
  "spec-review-iteration-cap": "factory",
  "spec-judge-evidence": "factory",
  // FAFF-996: build-review-churn/build-review-convergence are the build-review dialogue loop's
  // siblings of spec-review-churn/spec-review-convergence (finding-identity comparator, not a
  // lens-set) — same small-deterministic-CLI-resolver family → factory. build-judge-evidence
  // shells the case-file assembler/roll-up + dispatches the two-phase judge — same family as
  // spec-judge-evidence → factory.
  "build-review-churn": "factory",
  "build-review-convergence": "factory",
  "build-judge-evidence": "factory",
  // FAFF-1276: review-prior lists the previous review round's findings by handle for the
  // reviewer — reads the same round directories as the build-review resolvers → factory.
  "review-prior": "factory",
  // FAFF-1314: resume-store stashes and restores a held build's per-issue state and reads
  // the build-review round counter through spec-review-window (factory→factory, ADR-0042).
  "resume-store": "factory",
  // FAFF-945: spec-judge-accept-bar is the deterministic accept-bar roll-up faff-prep's judge
  // step shells — a pure coercion over the evidence bundle + the judge verdict, same family as
  // the other small spec-review resolvers → factory.
  "spec-judge-accept-bar": "factory",
  // FAFF-417: tier is a pure deterministic classifier over spec text (no factory-identifier
  // reference — same shape as spec-review-churn) — factory, same family as the other small
  // deterministic CLI resolvers.
  "tier": "factory",
  // FAFF-1197: dispatch (the one dispatch: tree's resolver verb) requires config.js —
  // factory -> factory, legal under ADR-0042.
  "dispatch": "factory",
};

// Selftest invocation per member, where it differs from `<cmd> --selftest`:
// a FULL allowlist over REGION_MAP: every command has an explicit entry — an
// argv array to spawn, or null = deliberately no standalone selftest (reported
// `no-selftest`: non-fatal for factory, FATAL for a governance member). A
// REGION_MAP command MISSING here is exit 2 at `regions selftest` (no
// fall-through: a future flag-tolerant command must never be blind-spawned
// with --selftest and execute its real op — e.g. `sync` re-links ~/.claude; a
// selftest runner must never mutate the host, so such a command stays null.
// (`gitignore-ensure` gained a host-safe --selftest in FAFF-548 — it runs only
// against throwaway temp roots, never the host .gitignore — so it is now wired.)
// A stale null (the handler gained a "--selftest" branch nobody wired) is also
// exit 2 — see regionsStaleNulls.
const REGION_SELFTEST_ARGV = {
  // governance — every member MUST carry a runnable selftest
  "runcheck": ["runcheck", "--selftest"],
  "heartbeat": ["heartbeat", "--selftest"],
  "version": ["version", "--selftest"],
  "events": ["events", "--selftest"],
  "evidence": ["evidence", "--selftest"],
  "effects": ["effects", "--selftest"],
  "review-progress": ["review-progress", "--selftest"],
  "build-progress": ["build-progress", "--selftest"],
  "landing-progress": ["landing-progress", "--selftest"],
  "budget": ["budget", "--selftest"],
  "sentry": ["sentry", "--selftest"],
  "sentry-poller": ["sentry-poller", "--selftest"],
  "sentrycheck": ["sentrycheck", "--selftest"],
  "inflightcheck": ["inflightcheck", "--selftest"],
  "resumecheck": ["resumecheck", "--selftest"],
  "turncheck": ["turncheck", "--selftest"],
  "audit": ["audit", "--selftest"],
  "reconcile": ["reconcile", "--selftest"],
  "profiles": ["profiles", "--selftest"],
  // factory — argv per member; null = deliberately no standalone selftest
  "config": ["config", "init", "--selftest"],
  "sync": null,
  "prepcheck": ["prepcheck", "--selftest"],
  "intakecheck": ["intakecheck", "--selftest"],
  "intake-record": ["intake-record", "--selftest"],
  "contain": ["contain", "--selftest"],
  "commissaire": ["commissaire", "--selftest"],
  "self-intake": ["self-intake", "--selftest"],
  "economics": ["economics", "--selftest"],
  "disposition": ["disposition", "--selftest"],
  "reconcile-recover": ["reconcile-recover", "--selftest"],
  "machine-id": ["machine-id", "--selftest"],
  "quality": ["quality", "--selftest"],
  "run-done": ["run-done", "--selftest"],
  "run-ledger": ["run-ledger", "--selftest"],
  "run-outward": ["run-outward", "--selftest"],
  "run-record-prd": ["run-record-prd", "--selftest"],
  "run-start": ["run-start", "--selftest"],
  "hooks-ensure": ["hooks-ensure", "--selftest"],
  "judge-trail": ["judge-trail", "--selftest"],
  // judge-history's reader-core logic is exercised transitively by judge-trail's own
  // --selftest fixtures (collectObjections) plus test/judge-trail.test.mjs's full mint ->
  // read git round trip; no separate standalone selftest (non-fatal for factory).
  "judge-history": null,
  "merge-fence": ["merge-fence", "--selftest"],
  "background-fence": ["background-fence", "--selftest"],
  "validate-adapters": null,
  "labels": ["labels", "--selftest"],
  "label": ["label", "--selftest"],
  "eligible": ["eligible", "--selftest"],
  "discovered-scope-priority": ["discovered-scope-priority", "--selftest"],
  "claim-verdict": ["claim-verdict", "--selftest"],
  "park-verdict": ["park-verdict", "--selftest"],
  "punt-scan": ["punt-scan", "--selftest"],
  "pr-body": ["pr-body", "--selftest"],
  "admissible": ["admissible", "--selftest"],
  "dod": ["dod", "--selftest"],
  "holdout": ["holdout", "--selftest"],
  "spec-review-lenses": ["spec-review-lenses", "--selftest"],
  "verification": ["verification", "--selftest"],
  "container-check": ["container-check", "--selftest"],
  "evaluator-preflight": ["evaluator-preflight", "--selftest"],
  "lane-boundary": ["lane-boundary", "--selftest"],
  "corrective-integrity": ["corrective-integrity", "--selftest"],
  "integrity-boundary": ["integrity-boundary", "--selftest"],
  "integrity-digest": ["integrity-digest", "--selftest"],
  "bundle": ["bundle", "--selftest"],
  "build-claim": ["build-claim", "--selftest"],
  "landing-claim": ["landing-claim", "--selftest"],
  "bundle-recover": ["bundle-recover", "--selftest"],
  "corrective": ["corrective", "--selftest"],
  "next": ["next", "--selftest"],
  "project-next": ["project-next", "--selftest"],
  "state": null,
  "tracker": ["tracker", "--selftest"],
  "queue-state": ["queue-state", "--selftest"],
  "drain-filter": null, // FAFF-1412: no selftest by design; covered by test/drain-filter.test.mjs (TEST_FILE_COVERAGE)
  "findings-reconcile": ["findings-reconcile", "--selftest"],
  "park-history": ["park-history", "--selftest"],
  "park-reconsider": ["park-reconsider", "--selftest"], // FAFF-993: reason-table + confine fixtures (no operator unpark side effect)
  "gitignore-ensure": ["gitignore-ensure", "--selftest"], // FAFF-548: host-safe selftest (temp roots only)
  "harness": ["harness", "--selftest"],
  "adr": ["adr", "--selftest"],
  "andon": ["andon", "--selftest"],
  "decisions": ["decisions", "--selftest"],
  "decision-capture": ["decision-capture", "--selftest"],
  "shadow-fidelity": ["shadow-fidelity", "--selftest"],
  "prd": ["prd", "--selftest"],
  "prd-checklist": ["prd-checklist", "--selftest"],
  "ratified-scope": ["ratified-scope", "--selftest"],
  "prdr": ["prdr", "--selftest"],
  "profile": ["profile", "--selftest"],
  "manifest": ["manifest", "validate", "--selftest"],
  "conventions": ["conventions", "--selftest"],
  "native-map": ["native-map", "set", "--selftest"],
  "github-templates": ["github-templates", "--selftest"],
  "fixtures": ["fixtures", "--selftest"],
  "env": ["env", "--selftest"],
  "scenario-matrix": ["scenario-matrix", "--selftest"],
  "eval": ["eval", "affected", "--selftest"],
  "engine": ["engine", "--selftest"],
  "lights-out": ["lights-out", "--selftest"],
  "gates": ["gates", "--selftest"],
  "contract": ["contract", "--selftest"],
  "doctor": null,
  "worktree-check": ["worktree-check", "--selftest"],
  "worktree-heal": ["worktree-heal", "--selftest"],
  "worktree-prune": ["worktree-prune", "--selftest"],
  "worktree-root": ["worktree-root", "--selftest"],
  "review-target": ["review-target", "--selftest"],
  "stage-guard": ["stage-guard", "--selftest"],
  "lint-refs": ["lint-refs", "--selftest"],
  "lint-cli-doc": ["lint-cli-doc", "--selftest"],
  "lint-cli-coverage": ["lint-cli-coverage", "--selftest"],
  "regions": ["regions", "--selftest"],
  "cli-surface": ["cli-surface", "--selftest"],
  "merge-gate": ["merge-gate", "--selftest"],
  // FAFF-1118: pr-create opens a real PR (the sole `gh pr create` path) — no host-safe standalone
  // --selftest; its resolvers/andGrants/coattail logic are covered by `merge-gate --selftest` + the
  // suite, so it takes a factory null (non-fatal), like sync/doctor/state.
  "pr-create": null,
  // FAFF-1426: new code adds no --selftest (AGENTS.md); covered by test/merge-authorize.test.mjs.
  merge: null,
  "branch-protection-check": ["branch-protection-check", "--selftest"],
  "github-auth-check": ["github-auth-check", "--selftest"],
  "post-merge-check": ["post-merge-check", "--selftest"],
  "ci-triage": ["ci-triage", "--selftest"],
  land: ["land", "--selftest"],
  spec: ["spec", "--selftest"],
  // FAFF-1406: no --selftest (tests live in test/ only); test/prep-attach.test.mjs is declared in
  // lint-cli-coverage's TEST_FILE_COVERAGE.
  prep: null,
  // FAFF-1414: no --selftest (tests live in test/ only); lint-cli-coverage's TEST_FILE_COVERAGE names them.
  graft: null,
  // FAFF-1435: no --selftest (tests live in test/ only); lint-cli-coverage's TEST_FILE_COVERAGE names them.
  run: null,
  // FAFF-1442: no --selftest (tests live in test/ only); lint-cli-coverage's TEST_FILE_COVERAGE names them.
  "prose-size": null,
  "governance-check": ["governance-check", "--selftest"],
  "evidence-readiness": ["evidence-readiness", "--selftest"],
  "landing-comment": ["landing-comment", "--selftest"],
  "adversarial-backends": ["adversarial-backends", "--selftest"],
  "review-iteration-cap": ["review-iteration-cap", "--selftest"],
  "review-fixture-paths": ["review-fixture-paths", "--selftest"],
  "backends": ["backends", "--selftest"],
  "spec-review-churn": ["spec-review-churn", "--selftest"],
  "spec-review": ["spec-review", "--selftest"],
  "spec-review-convergence": ["spec-review-convergence", "--selftest"],
  "spec-review-pin": ["spec-review-pin", "--selftest"],
  "spec-review-dir": ["spec-review-dir", "--selftest"],
  "spec-review-reputation": ["spec-review-reputation", "--selftest"],
  "spec-review-window": ["spec-review-window", "--selftest"],
  "spec-review-iteration-cap": ["spec-review-iteration-cap", "--selftest"],
  // spec-judge-evidence has no standalone --selftest (its shelling seam is exercised by
  // test/spec-judge-evidence.test.mjs, declared in lint-cli-coverage's TEST_FILE_COVERAGE).
  "spec-judge-evidence": null,
  // spec-judge-accept-bar has no standalone --selftest either — its coercion + fail-closed
  // seam is exercised by test/spec-judge-accept-bar.test.mjs (lint-cli-coverage TEST_FILE_COVERAGE).
  "spec-judge-accept-bar": null,
  "build-review-churn": ["build-review-churn", "--selftest"],
  "build-review-convergence": ["build-review-convergence", "--selftest"],
  // build-judge-evidence has no standalone --selftest (--assemble/--admit only; its dispatch
  // loop + admit roll-up are exercised through the real CLI entrypoint by
  // test/build-judge-evidence.test.mjs, declared in lint-cli-coverage's TEST_FILE_COVERAGE).
  "build-judge-evidence": null,
  "review-prior": ["review-prior", "--selftest"],
  "resume-store": ["resume-store", "--selftest"],
  "tier": ["tier", "--selftest"],
  "dispatch": ["dispatch", "--selftest"],
};

const REGION_NAMES = new Set(["governance", "factory", "shared-infra", "shell"]);
const REGION_TAG_RE = /^\/\/ === region:([a-z-]+) — (.*) ===$/;

// Keywords a `/` may legally follow while still opening a REGEX literal (the
// standard lexer heuristic: `return /re/`, `typeof /re/`, `case /re/:` …).
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);

// Strip comments, string literals, AND regex literals from source, preserving
// line structure — stripped characters become spaces so line arithmetic
// survives. Template `${…}` interpolations are KEPT as code (a real reference
// inside one still counts). Regex-vs-division: a `/` in code state opens a
// regex literal iff the previous significant character is not an identifier
// char / `)` / `]` — or ends a keyword like `return` — and the literal is then
// consumed through its unescaped closing `/`, honouring `\` escapes and `[…]`
// character classes (a `/` inside a class does not close). Without this, a
// regex like /https?:\/\// would enter line-comment state and HIDE the rest of
// its line from the lint.
function regionsStripSource(src) {
  const n = src.length;
  const out = new Array(n);
  // String-open checks run BEFORE the tplStack brace counting below, so a brace
  // inside a quoted string in an interpolation (`${ x ? "{" : "}" }`) is never
  // counted — state ordering is load-bearing.
  const tplStack = []; // brace-depth counters for `${` nesting inside templates
  let state = "code";
  let i = 0;
  // Previous significant (non-whitespace) char of the ALREADY-EMITTED output —
  // stripped content is spaces, so this sees code only.
  const prevSignificantIdx = (idx) => {
    let k = idx - 1;
    while (k >= 0 && (out[k] === " " || out[k] === "\n" || out[k] === "\t" || out[k] === "\r" || out[k] === undefined)) k--;
    return k;
  };
  const regexPosition = (idx) => {
    const k = prevSignificantIdx(idx);
    if (k < 0) return true; // start of file → regex
    const ch = out[k];
    if (ch === ")" || ch === "]") return false; // call/index result → division
    if (!/[A-Za-z0-9_$]/.test(ch)) return true; // operator/punctuation → regex
    // identifier/number end: still a regex when the word is a keyword (return /re/)
    let s = k;
    while (s >= 0 && /[A-Za-z0-9_$]/.test(out[s])) s--;
    return REGEX_PRECEDING_KEYWORDS.has(out.slice(s + 1, k + 1).join(""));
  };
  while (i < n) {
    const c = src[i], d = i + 1 < n ? src[i + 1] : "";
    if (state === "code") {
      if (c === "/" && d === "/") { state = "line"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
      if (c === "/" && d === "*") { state = "block"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
      if (c === "/" && regexPosition(i)) {
        // regex literal: blank through the unescaped closing `/` (class-aware).
        out[i] = " "; i++;
        let inClass = false;
        while (i < n) {
          const rc = src[i];
          if (rc === "\\") { out[i] = " "; if (i + 1 < n) out[i + 1] = src[i + 1] === "\n" ? "\n" : " "; i += 2; continue; }
          if (rc === "\n") { out[i] = "\n"; i++; break; } // defensive: regexes are single-line
          if (rc === "[") inClass = true;
          else if (rc === "]") inClass = false;
          else if (rc === "/" && !inClass) { out[i] = " "; i++; break; }
          out[i] = " "; i++;
        }
        continue;
      }
      if (c === "'") { state = "sq"; out[i] = " "; i++; continue; }
      if (c === '"') { state = "dq"; out[i] = " "; i++; continue; }
      if (c === "`") { state = "tpl"; out[i] = " "; i++; continue; }
      if (tplStack.length) {
        if (c === "{") tplStack[tplStack.length - 1]++;
        else if (c === "}") {
          if (tplStack[tplStack.length - 1] === 0) { tplStack.pop(); state = "tpl"; out[i] = " "; i++; continue; }
          tplStack[tplStack.length - 1]--;
        }
      }
      out[i] = c; i++; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out[i] = c; } else out[i] = " ";
      i++; continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") { state = "code"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
      out[i] = c === "\n" ? c : " "; i++; continue;
    }
    if (state === "sq" || state === "dq") {
      const q = state === "sq" ? "'" : '"';
      if (c === "\\") { out[i] = " "; if (i + 1 < n) out[i + 1] = src[i + 1] === "\n" ? "\n" : " "; i += 2; continue; }
      if (c === q || c === "\n") { state = "code"; out[i] = c === "\n" ? c : " "; i++; continue; }
      out[i] = " "; i++; continue;
    }
    // state === "tpl"
    if (c === "\\") { out[i] = " "; if (i + 1 < n) out[i + 1] = src[i + 1] === "\n" ? "\n" : " "; i += 2; continue; }
    if (c === "`") { state = "code"; out[i] = " "; i++; continue; }
    if (c === "$" && d === "{") { tplStack.push(0); state = "code"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
    out[i] = c === "\n" ? c : " "; i++; continue;
  }
  return out.join("");
}

// Build the file→region map from each file's OWN region banner(s) — the
// module system now carries attribution, so no second list is needed. A file
// with no banner, with banners naming MORE THAN ONE distinct region, or with a
// banner naming an unknown region is malformed: attribution must be
// unambiguous (economics.js's two factory banners, or the entrypoint's two
// shell banners, are legal — same region repeated). Returns
// { fileRegion: Map<path,region>, malformed: [string] }.
function regionsFileMap(files) {
  const fileRegion = new Map();
  const malformed = [];
  for (const file of files) {
    const rawLines = fs.readFileSync(file, "utf8").split("\n");
    const names = new Set();
    for (const line of rawLines) {
      const m = line.match(REGION_TAG_RE);
      if (m) names.add(m[1]);
    }
    const base = path.basename(file);
    if (names.size === 0) {
      malformed.push(`${base}: no region banner (every source-set file must declare exactly one region)`);
    } else if (names.size > 1) {
      malformed.push(`${base}: mixed-region banners (${[...names].sort().join(", ")}) — a file must attribute to exactly one region`);
    } else {
      const [name] = names;
      if (!REGION_NAMES.has(name)) {
        malformed.push(`${base}: unknown region '${name}' (legal: ${[...REGION_NAMES].join(" | ")})`);
      } else {
        fileRegion.set(file, name);
      }
    }
  }
  return { fileRegion, malformed };
}

// Resolve a relative require literal against the requiring file's directory,
// against the SOURCE SET (extension-optional, mirroring Node's own resolution
// for these flat `.js` modules). Returns the resolved absolute path, or null
// if it lands outside the source set (a layout escape — malformed, not missed).
function regionsResolveRelative(fromFile, spec, sourceSet) {
  const dir = path.dirname(fromFile);
  const joined = path.normalize(path.join(dir, spec));
  if (sourceSet.has(joined)) return joined;
  const withExt = joined.endsWith(".js") ? joined : `${joined}.js`;
  return sourceSet.has(withExt) ? withExt : null;
}

// Extract require() edges from a BOUND (governance | shared-infra) file. Scans
// the STRIPPED source for genuine `require(` call sites (comment/string-embedded
// require-shaped text is blanked by regionsStripSource and so never matches
// here), then re-reads the ORIGINAL source at that same offset — stripping
// blanks string content too, so the literal argument itself must come from the
// raw text — to parse a single-quoted or double-quoted string-literal argument.
// A non-literal argument, or a relative literal that does not resolve inside the
// source set, is malformed (an unattributable/escaping edge — fail-closed, never
// silently skipped). node:*/bare-package literals are outside the region model
// and are skipped. Returns { edges: [{toFile, toRegion, line}], malformed }.
function regionsRequireEdges(file, fileRegion, sourceSet) {
  const raw = fs.readFileSync(file, "utf8");
  const stripped = regionsStripSource(raw);
  const base = path.basename(file);
  const edges = [];
  const malformed = [];
  const CALL_RE = /\brequire\s*\(/g;
  let m;
  while ((m = CALL_RE.exec(stripped)) !== null) {
    const argStart = m.index + m[0].length;
    const line = raw.slice(0, m.index).split("\n").length;
    const tail = raw.slice(argStart);
    const lit = tail.match(/^\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\)/);
    if (!lit) {
      malformed.push(`${base}:${line}: require() argument is not a single string literal — unattributable edge`);
      continue;
    }
    const spec = lit[2];
    if (!spec.startsWith(".")) continue; // node:*/bare package — outside the region model
    const resolved = regionsResolveRelative(file, spec, sourceSet);
    if (!resolved) {
      malformed.push(`${base}:${line}: require("${spec}") does not resolve inside the source set — unattributable edge`);
      continue;
    }
    edges.push({ toFile: resolved, toRegion: fileRegion.get(resolved), line });
  }
  return { edges, malformed };
}

// The direction-lint core, over the REAL require graph: build the file→region
// map from banners, then for every BOUND file (governance | shared-infra),
// extract its require edges and assert the ADR-0042 direction invariant —
// governance never requires factory; shared-infra requires no local module at
// all. factory and shell files are unchecked (legal consumers) and are never
// scanned for edges. Returns { malformed: [string], violations: [string] }.
function regionsCheck(files) {
  const { fileRegion, malformed: mapMalformed } = regionsFileMap(files);
  if (mapMalformed.length) return { malformed: mapMalformed, violations: [] };
  const sourceSet = new Set(files);
  const malformed = [];
  const violations = [];
  for (const file of files) {
    const region = fileRegion.get(file);
    if (region !== "governance" && region !== "shared-infra") continue;
    const { edges, malformed: edgeMalformed } = regionsRequireEdges(file, fileRegion, sourceSet);
    for (const em of edgeMalformed) malformed.push(em);
    const fromBase = path.basename(file);
    for (const e of edges) {
      const toBase = path.basename(e.toFile);
      if (region === "governance" && e.toRegion === "factory") {
        violations.push(`${fromBase} (governance) requires ${toBase} (factory) — line ${e.line}`);
      } else if (region === "shared-infra") {
        violations.push(`${fromBase} (shared-infra) requires ${toBase} (${e.toRegion}) — line ${e.line}`);
      }
    }
  }
  return { malformed, violations };
}

const regionsExitFor = (res) => (res.malformed.length ? 2 : (res.violations.length ? 1 : 0));

// Fixture-table selftest for the require-graph core: each fixture is a small
// synthetic MODULE SET (two or three files with banners + require lines) in a
// tmp dir, driven through regionsCheck exactly as `check` drives the real
// source set. Proves: a clean set → 0; a governance→factory require → 1 naming
// both ends + line; a shared-infra→local require → 1; a bannerless file,
// mixed-region-banner file, non-literal require, and unresolvable relative
// require (all in a bound file) → 2; a require("./x") inside a comment/string
// → 0 (no edge); factory→governance stays legal → 0. Also pins the
// REGION_MAP ↔ COMMANDS bijection (the single-list invariant).
function regionsSelftest(COMMANDS) {
  const fixtures = {
    "clean set": {
      files: {
        "shared.js": [
          "// === region:shared-infra — helpers ===",
          "function sharedHelper() { return 1; }",
        ].join("\n"),
        "gov.js": [
          "// === region:governance — gov ===",
          'const { sharedHelper } = require("./shared");',
          "function govThing() { return sharedHelper(); }",
        ].join("\n"),
        "fact.js": [
          "// === region:factory — fact ===",
          'const { govThing } = require("./gov");',
          "function factThing() { return govThing(); }",
        ].join("\n"),
      },
      wantExit: 0,
    },
    "governance→factory require": {
      files: {
        "gov.js": [
          "// === region:governance — gov ===",
          'const { factThing } = require("./fact");',
        ].join("\n"),
        "fact.js": [
          "// === region:factory — fact ===",
          "function factThing() { return 2; }",
        ].join("\n"),
      },
      wantExit: 1,
      wantViolation: /gov\.js \(governance\) requires fact\.js \(factory\) — line 2/,
    },
    "shared-infra→local require": {
      files: {
        "shared.js": [
          "// === region:shared-infra — helpers ===",
          'const { govThing } = require("./gov");',
        ].join("\n"),
        "gov.js": [
          "// === region:governance — gov ===",
          "function govThing() { return 1; }",
        ].join("\n"),
      },
      wantExit: 1,
      wantViolation: /shared\.js \(shared-infra\) requires gov\.js \(governance\) — line 2/,
    },
    "bannerless file": {
      files: {
        "gov.js": [
          "// === region:governance — gov ===",
          "function govThing() { return 1; }",
        ].join("\n"),
        "nobanner.js": "function mystery() { return 2; }",
      },
      wantExit: 2,
      wantMalformed: /nobanner\.js: no region banner/,
    },
    "mixed-region banners in one file": {
      files: {
        "mixed.js": [
          "// === region:governance — gov ===",
          "function govThing() { return 1; }",
          "// === region:factory — fact ===",
          "function factThing() { return 2; }",
        ].join("\n"),
      },
      wantExit: 2,
      wantMalformed: /mixed\.js: mixed-region banners \(factory, governance\)/,
    },
    "non-literal require in a bound file": {
      files: {
        "gov.js": [
          "// === region:governance — gov ===",
          'const name = "./fact";',
          "require(name);",
        ].join("\n"),
        "fact.js": [
          "// === region:factory — fact ===",
          "function factThing() { return 2; }",
        ].join("\n"),
      },
      wantExit: 2,
      wantMalformed: /gov\.js:3: require\(\) argument is not a single string literal/,
    },
    "unresolvable relative require in a bound file": {
      files: {
        "gov.js": [
          "// === region:governance — gov ===",
          'require("./missing");',
        ].join("\n"),
      },
      wantExit: 2,
      wantMalformed: /gov\.js:2: require\("\.\/missing"\) does not resolve inside the source set/,
    },
    "require(\"./x\") inside a comment or string produces no edge": {
      files: {
        "gov.js": [
          "// === region:governance — gov ===",
          '// require("./fact") in a line comment',
          'const note = "require(\\"./fact\\")";',
          "function govThing() { return note; }",
        ].join("\n"),
        "fact.js": [
          "// === region:factory — fact ===",
          "function factThing() { return 2; }",
        ].join("\n"),
      },
      wantExit: 0,
    },
    "factory→governance require is legal": {
      files: {
        "fact.js": [
          "// === region:factory — fact ===",
          'const { govThing } = require("./gov");',
          "function factThing() { return govThing(); }",
        ].join("\n"),
        "gov.js": [
          "// === region:governance — gov ===",
          "function govThing() { return 1; }",
        ].join("\n"),
      },
      wantExit: 0,
    },
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-regions-"));
  let failed = 0;
  const report = (name, ok, detail) => {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };
  try {
    let n = 0;
    for (const [name, f] of Object.entries(fixtures)) {
      const dir = path.join(tmp, `fx-${n++}`);
      fs.mkdirSync(dir);
      const filePaths = [];
      for (const [rel, content] of Object.entries(f.files)) {
        const p = path.join(dir, rel);
        fs.writeFileSync(p, `${content}\n`);
        filePaths.push(p);
      }
      const res = regionsCheck(filePaths);
      const exit = regionsExitFor(res);
      let ok = exit === f.wantExit;
      if (ok && f.wantViolation) ok = res.violations.some((v) => f.wantViolation.test(v));
      if (ok && f.wantMalformed) ok = res.malformed.some((v) => f.wantMalformed.test(v));
      report(name, ok, ok ? "" : `exit ${exit} (want ${f.wantExit}); ${JSON.stringify(res)}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // Single-list invariant: the map and the registry name exactly the same commands,
  // and the selftest allowlist covers the map exactly (no fall-through spawns).
  const mapKeys = Object.keys(REGION_MAP).sort().join(",");
  const cmdKeys = Object.keys(COMMANDS).sort().join(",");
  report("REGION_MAP ↔ COMMANDS bijection", mapKeys === cmdKeys, mapKeys === cmdKeys ? "" : "map/registry drift");
  const argvKeys = Object.keys(REGION_SELFTEST_ARGV).sort().join(",");
  report("REGION_SELFTEST_ARGV covers REGION_MAP exactly", argvKeys === mapKeys,
    argvKeys === mapKeys ? "" : "allowlist/map drift");
  // Every governance member declares a runnable selftest (the provable-boundary claim).
  const govNoSelftest = Object.keys(REGION_MAP)
    .filter((c) => REGION_MAP[c] === "governance" && REGION_SELFTEST_ARGV[c] === null);
  report("every governance member has a selftest", govNoSelftest.length === 0, govNoSelftest.join(", "));
  // Stale-null detector fires on a handler that mentions the quoted "--selftest"
  // literal, and only on that (helper-driven fixture, no file round-trip).
  const staleFixture = [
    "function cmdFoo(args) {",
    '  if (args.includes("--selftest")) return 1;',
    "  return 0;",
    "}",
    "function cmdBar(args) {",
    "  return 0; // no --selftest branch (bare mention in a comment must not trip)",
    "}",
  ];
  const staleGot = regionsStaleNulls(staleFixture,
    { "foo": null, "bar": null, "baz": ["baz", "--selftest"] },
    (c) => ({ "foo": "cmdFoo", "bar": "cmdBar", "baz": "cmdBaz" }[c]));
  const staleOk = staleGot.length === 1 && staleGot[0] === "foo";
  report("stale-null detection (quoted \"--selftest\" in a null's handler)",
    staleOk, staleOk ? "" : `got [${staleGot.join(", ")}]`);
  // regionsFailDetail (FAFF-997) — a failed member's captured stdout/stderr
  // must surface, indented, beneath its FAIL summary line; an empty result
  // must render no stray labels; a timeout/spawn-error result must name its
  // cause. Exercised against synthetic spawnSync-shaped results, never a real
  // child process — the helper is pure.
  const detailBoth = regionsFailDetail({ status: 1, stdout: "ok 1\nnot ok 2 - boom\n", stderr: "warning: flaky\n", error: null, signal: null });
  const detailBothOk = detailBoth.includes("not ok 2 - boom") && detailBoth.includes("warning: flaky")
    && detailBoth.split("\n").every((l) => l === "" || /^\s/.test(l));
  report("regionsFailDetail surfaces failing stdout + stderr, indented", detailBothOk, detailBoth);
  const detailEmpty = regionsFailDetail({ status: 1, stdout: "", stderr: "", error: null, signal: null });
  report("regionsFailDetail returns \"\" when nothing to show", detailEmpty === "", JSON.stringify(detailEmpty));
  const detailTimeout = regionsFailDetail({ status: null, stdout: "", stderr: "", error: new Error("spawn ETIMEDOUT"), signal: "SIGTERM" });
  const detailTimeoutOk = detailTimeout.includes("spawn ETIMEDOUT") && detailTimeout.includes("SIGTERM");
  report("regionsFailDetail surfaces error message + signal on a timeout/spawn-error result",
    detailTimeoutOk, detailTimeout);
  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (${Object.keys(fixtures).length + 7} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}

// Locate a top-level function's line range [start, end] (to its column-0 `}`).
function regionsFnRange(rawLines, fnName) {
  const start = rawLines.findIndex(
    (l) => l.startsWith(`function ${fnName}(`) || l.startsWith(`async function ${fnName}(`));
  if (start === -1) return null;
  for (let k = start + 1; k < rawLines.length; k++) if (rawLines[k] === "}") return [start, k];
  return [start, rawLines.length - 1];
}

// Stale-null detector: a REGION_SELFTEST_ARGV null whose handler body mentions
// the QUOTED "--selftest" literal means the command gained a selftest nobody
// wired — the null is stale, fail loud. Scans RAW handler text deliberately:
// the `args.includes("--selftest")` literal lives inside a string, which the
// stripper blanks — a post-strip scan could never see it. Quoted-form matching
// keeps a bare `--selftest` in a comment from false-tripping.
function regionsStaleNulls(rawLines, argvMap, fnNameOf) {
  const stale = [];
  for (const [cmd, argv] of Object.entries(argvMap)) {
    if (argv !== null) continue;
    const fnName = fnNameOf(cmd);
    if (!fnName) continue;
    const range = regionsFnRange(rawLines, fnName);
    if (!range) continue;
    const body = rawLines.slice(range[0], range[1] + 1).join("\n");
    if (body.includes('"--selftest"') || body.includes("'--selftest'")) stale.push(cmd);
  }
  return stale;
}

// Spawn each member's own selftest as a child process (the lights-out probe
// pattern) and report a per-command table. Exit 0 iff every spawned selftest
// passed AND (for governance) every member has one — a governance member
// without a selftest breaks the standalone-boundary proof. Exit 2 (before any
// spawn) on allowlist drift: a REGION_MAP command missing from
// REGION_SELFTEST_ARGV, or a stale null.
//
// Wall-clock: each member gets a 120s timeout; worst case for `--region all`
// is ~43 × 120s ≈ 86 min, but the selftests are in-memory tables that finish
// in seconds — a full sweep is typically well under a minute.
function regionsSelftestRun(regionArg, COMMANDS) {
  const want = regionArg || "all";
  if (!["governance", "factory", "all"].includes(want)) {
    process.stderr.write("usage: faff regions selftest [--region governance|factory|all]\n");
    return 2;
  }
  // Allowlist completeness — checked over the WHOLE map (not just the selected
  // region): a gap anywhere is config drift, fail loud before spawning anything.
  const unlisted = Object.keys(REGION_MAP).filter((c) => !(c in REGION_SELFTEST_ARGV));
  if (unlisted.length) {
    process.stderr.write(`faff regions selftest: MALFORMED — REGION_MAP command(s) missing from the REGION_SELFTEST_ARGV allowlist: ${unlisted.join(", ")}\n`);
    return 2;
  }
  // Stale-null drift — a null entry whose handler now carries a "--selftest" branch.
  // Read across the whole module set (entrypoint + bin/lib) so a handler that moved
  // into a sibling module is still found (FAFF-441).
  const rawLines = regionSources().flatMap((fp) => fs.readFileSync(fp, "utf8").split("\n"));
  const stale = regionsStaleNulls(rawLines, REGION_SELFTEST_ARGV, (c) => COMMANDS[c] && COMMANDS[c].name);
  if (stale.length) {
    process.stderr.write(`faff regions selftest: MALFORMED — stale null(s) in REGION_SELFTEST_ARGV (the handler mentions "--selftest" but the map says no-selftest): ${stale.join(", ")}\n`);
    return 2;
  }
  const members = Object.keys(REGION_MAP).filter((c) => want === "all" || REGION_MAP[c] === want);
  let failed = 0;
  const width = Math.max(...members.map((c) => c.length));
  for (const cmd of members) {
    const argv = REGION_SELFTEST_ARGV[cmd];
    let status;
    let detail = "";
    if (argv === null) {
      const fatal = REGION_MAP[cmd] === "governance";
      if (fatal) failed++;
      status = fatal ? "FAIL (governance member without a selftest)" : "no-selftest";
    } else {
      const r = spawnSync(process.execPath, [ENTRYPOINT, ...argv], { encoding: "utf8", timeout: 120000 });
      if (r.status !== 0) failed++;
      status = r.status === 0 ? "PASS" : `FAIL (exit ${r.status === null ? "timeout/error" : r.status})`;
      if (r.status !== 0) detail = regionsFailDetail(r);
    }
    console.log(`${cmd.padEnd(width)}  ${REGION_MAP[cmd].padEnd(10)}  ${status}`);
    if (detail) console.log(detail);
  }
  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (${members.length} members, ${failed} failed)`);
  return failed ? 1 : 0;
}

// Render a failed member's captured spawnSync output as an indented detail
// block, printed beneath its FAIL summary line by regionsSelftestRun. Pure
// function of the spawn result — no I/O, no spawning — so a synthetic failing
// result exercises it directly without a real child process (FAFF-997). Only
// the failure path calls this; the happy path (PASS / no-selftest / the
// governance no-selftest FAIL) never does, so passing output stays untouched.
function regionsFailDetail(r) {
  const lines = [];
  const addBlock = (label, text) => {
    if (text === null || text === undefined) return;
    const trimmed = String(text).replace(/\s+$/, "");
    if (!trimmed) return;
    lines.push(`  ${label}:`);
    for (const line of trimmed.split("\n")) lines.push(`    ${line}`);
  };
  // status === null means spawnSync itself didn't get a normal exit (timeout or
  // spawn error) — the summary line already says "FAIL (exit timeout/error)",
  // so name the cause here rather than leaving it opaque.
  if (r.status === null) {
    const bits = [];
    if (r.error && r.error.message) bits.push(r.error.message);
    if (r.signal) bits.push(`signal ${r.signal}`);
    if (bits.length) addBlock("error", bits.join(" — "));
  }
  addBlock("stdout", r.stdout);
  addBlock("stderr", r.stderr);
  return lines.join("\n");
}

const REGIONS_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--region": { arity: 1 }, "--base": { arity: 1 } }, positionals: { min: 0, max: 1, name: "verb" } };
const REGIONS_USAGE = "usage: faff regions <list|check|selftest> [--json] [--region governance|factory|all] [--base REF]";

function cmdRegions(args, COMMANDS) {
  if (args.includes("--selftest")) return regionsSelftest(COMMANDS);
  const { values, positionals, errors } = parseArgs(args, REGIONS_SPEC);
  if (errors.length) return usageError(errors, REGIONS_USAGE);
  const sub = positionals[0];
  if (values["--base"] !== undefined && sub !== "check") {
    process.stderr.write(`faff regions ${regionsQuote(sub || "")}: --base applies only to \`regions check\`\n`);
    return 2;
  }

  if (sub === "list") {
    if (values["--json"]) { console.log(JSON.stringify(REGION_MAP)); return 0; }
    const byRegion = {};
    for (const [c, r] of Object.entries(REGION_MAP)) (byRegion[r] = byRegion[r] || []).push(c);
    for (const r of Object.keys(byRegion)) {
      console.log(`${r} (${byRegion[r].length}):`);
      for (const c of byRegion[r].sort()) console.log(`  ${c}`);
    }
    console.log("(shared-infra and shell are code-only regions — no commands)");
    return 0;
  }

  if (sub === "check") {
    // FAFF-1431: --base names the ratchet's comparison point; only a plain ref reaches git.
    const base = values["--base"];
    if (base !== undefined && (!BASE_REF_RE.test(base) || base.startsWith("-"))) {
      process.stderr.write(`faff regions check: --base ${regionsQuote(base)} is not a plain ref (letters, digits, . _ / - only, not starting with -)\n`);
      return 2;
    }
    // The shared recursive scan. A symlinked directory, a control-character name, or a non-.ts
    // TypeScript source is malformed before anything else reads the tree.
    const scanDir = regionsScanDir();
    const walk = regionsWalk(scanDir);
    const pre = [...walk.malformed];
    for (const f of walk.files) {
      if (/\.(?:mts|cts)$/.test(f)) pre.push(`${regionsQuote(f)}: bin/lib sources are .ts (the build emits only .ts to .js)`);
    }
    if (pre.length) {
      for (const m of pre) process.stderr.write(`faff regions check: TS-FIRST — ${m}\n`);
      return 2;
    }
    // FAFF-1170 emit-coverage floor — runs first: a `.ts` source without its committed `.js` emit
    // means the governed artifact is missing, so no later leg can meaningfully lint it.
    const emit = regionsEmitCoverage(walk.files.filter(regionsIsTsSource).map((f) => path.join(scanDir, f)), scanDir);
    if (emit.missing.length) {
      for (const m of emit.missing) process.stderr.write(`faff regions check: EMIT-MISSING — ${m}\n`);
      process.stderr.write(`faff regions check: ${emit.missing.length} TypeScript source(s) lack a committed .js emit — run \`npm run build\` under plugin/skills/faff and commit the emit\n`);
      return 2;
    }
    // FAFF-1431 TS-first leg — after the emit floor, before the require-graph lint.
    const tsFirst = regionsTsFirstRun({ scanDir, files: walk.files, base });
    if (tsFirst.malformed.length) {
      for (const m of tsFirst.malformed) process.stderr.write(`faff regions check: TS-FIRST — ${m}\n`);
      return 2;
    }
    if (tsFirst.violations.length) {
      for (const v of tsFirst.violations) process.stderr.write(`faff regions check: TS-FIRST — ${v}\n`);
      process.stderr.write(`faff regions check: ${tsFirst.violations.length} TS-first violation(s) — new bin/lib modules are TypeScript, and ${TS_FIRST_ALLOWLIST} only shrinks\n`);
      return 1;
    }
    const res = regionsCheck(regionSources());
    if (res.malformed.length) {
      for (const m of res.malformed) process.stderr.write(`faff regions check: MALFORMED — ${m}\n`);
      return 2;
    }
    // Single-list invariant, enforced live: map/registry drift is a malformed map.
    const mapKeys = Object.keys(REGION_MAP).sort();
    const cmdKeys = Object.keys(COMMANDS).sort();
    if (mapKeys.join(",") !== cmdKeys.join(",")) {
      const missing = cmdKeys.filter((k) => !mapKeys.includes(k));
      const orphaned = mapKeys.filter((k) => !cmdKeys.includes(k));
      process.stderr.write(`faff regions check: MALFORMED — REGION_MAP/COMMANDS drift (missing: ${missing.join(", ") || "none"}; orphaned: ${orphaned.join(", ") || "none"})\n`);
      return 2;
    }
    if (res.violations.length) {
      for (const v of res.violations) process.stderr.write(`faff regions check: VIOLATION — ${v}\n`);
      process.stderr.write(`faff regions check: ${res.violations.length} direction violation(s) — governance must not require factory; shared-infra must require no local module\n`);
      return 1;
    }
    console.log("PASS  regions check: require-graph direction invariant holds (governance↛factory, shared-infra↛any local module), every bin/lib module has a TypeScript source or a legacy allowlist entry");
    return 0;
  }

  if (sub === "selftest") {
    return regionsSelftestRun(values["--region"] === undefined ? null : values["--region"], COMMANDS);
  }

  process.stderr.write(`${REGIONS_USAGE}\n`);
  return 2;
}


module.exports = { REGEX_PRECEDING_KEYWORDS, REGION_MAP, REGION_NAMES, REGION_SELFTEST_ARGV, REGION_TAG_RE, cmdRegions, regionsCheck, regionsEmitCoverage, regionTsSources, regionsJsModules, regionsReadBaseAllowlist, regionsTsFirst, regionsValidateAllowlist, regionsWalk, regionsExitFor, regionsFailDetail, regionsFileMap, regionsFnRange, regionsRequireEdges, regionsResolveRelative, regionsSelftest, regionsSelftestRun, regionsStaleNulls, regionsStripSource };
