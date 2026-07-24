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

const REGION_MAP = {
  // governance — the flight recorder + interlocks (the extractable layer)
  "runcheck": "governance",
  "heartbeat": "governance",
  "events": "governance",
  "effects": "governance",
  "review-progress": "governance",
  "build-progress": "governance",
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
  // quality — the reporting mirror of economics: reads the run ledger + events.jsonl
  // into a QualityReport, touches no producer → factory (FAFF-418).
  "quality": "factory",
  "run-done": "factory",
  // run-outward — the signals.outward producer feeding run-start's outward floor. A
  // pure decision core over caller-supplied TargetRef/SelfRef, no extractable
  // flight-recorder layer → factory (same shape as run-start/contain).
  "run-outward": "factory",
  // run-start — FAFF-496: the run-START trigger predicate (mirror of run-done). A pure
  // signal-composing verb + belt-and-braces schemaCheck, no extractable flight-recorder
  // layer → factory.
  "run-start": "factory",
  "hooks-ensure": "factory",
  "merge-fence": "factory",
  // FAFF-491: the self-backgrounded-gate PreToolUse fence — same family as merge-fence
  // (a pure matcher + --hook stdin shell + --selftest), factory for the identical reason.
  "background-fence": "factory",
  "validate-adapters": "factory",
  "labels": "factory",
  "label": "factory",
  "eligible": "factory",
  "admissible": "factory",
  "dod": "factory",
  "holdout": "factory",
  "spec-review-lenses": "factory",
  "container-check": "factory",
  // evaluator-preflight — FAFF-276: the ADR-0041 rung-2 assert-in probe; reuses
  // containerCheck/realFsq (factory) → factory, like its container-check sibling.
  "evaluator-preflight": "factory",
  "corrective-integrity": "factory",
  "integrity-boundary": "factory", // FAFF-514: the emitter half, lives in corrective-integrity.js (region:factory)
  "integrity-digest": "factory",   // FAFF-518: custody-based tamper detection over the evidence set (region:factory)
  // FAFF-326: corrective requires corrective-integrity (factory) directly and
  // sentry.js's sentryThresholds (governance) — factory→governance is legal (ADR
  // 0042); sentry.js itself stays governance-pure by deriving authority through a
  // CHILD spawn of this bin rather than requiring this module (see sentry.js).
  "corrective": "factory",
  "next": "factory",
  "project-next": "factory",
  "state": "factory",
  // queue-state — FAFF-556: the git-only queue_empty/all_parked differ. Requires
  // shared-infra (findRoot/readLedger/latestRunDir) and governance-profile
  // (activeProfile) — a pure computation command, sibling of run-done/next → factory.
  "queue-state": "factory",
  // findings-reconcile — FAFF-569: the resolved-elsewhere correlation for tidy's
  // structural diagnostics. Pure stdin→stdout computation, no local requires —
  // a pure computation command, sibling of next/contain → factory.
  "findings-reconcile": "factory",
  "park-history": "factory",
  "gitignore-ensure": "factory",
  "adr": "factory",
  "prd": "factory",
  // prd-checklist — FAFF-557: pure checklist-PRD parser emitting the existing prd-coverage
  // shape. Requires only contract-engine's schemaCheck (no shared-infra/governance-profile
  // dependency) — a pure producer command, sibling of prd/prdr → factory.
  "prd-checklist": "factory",
  "prdr": "factory",
  "profile": "factory",
  "fixtures": "factory",
  "env": "factory",
  // engine — the FAFF-422 one-shot local-engine transport for engine-valued producer
  // lanes; part of the dispatch machinery, not the flight recorder → factory.
  "engine": "factory",
  "lights-out": "factory",
  "gates": "factory",
  "contract": "factory",
  "models": "factory",
  "doctor": "factory",
  "worktree-prune": "factory",
  "worktree-root": "factory",
  "stage-guard": "factory",
  "lint-refs": "factory",
  "lint-cli-doc": "factory",
  "regions": "factory",
  "cli-surface": "factory",
  // FAFF-350: merge-gate references factory identifiers (holdoutGateResult, decideFloor,
  // computeReviewVerdict) so it is NOT in the extractable governance layer; branch-protection-check
  // mirrors the factory container-check assert-don't-enforce probe.
  "merge-gate": "factory",
  "branch-protection-check": "factory",
  // FAFF-385: post-merge-check reuses gates.js's discoverRungs/runRung (factory identifiers,
  // same family as gates itself) and reads merge-gate.js's merge-record.json convention —
  // factory, not governance, for the identical reason merge-gate sits here.
  "post-merge-check": "factory",
  // FAFF-391: ci-triage references factory identifiers (deriveTriageAction, CI_TRIAGE_* enums from
  // contract-defs.js) and reuses merge-gate.js's own ghJson/ghRepoSlug gh-shell helpers — the same
  // family as merge-gate/post-merge-check, for the identical reason.
  "ci-triage": "factory",
  // FAFF-363: governance-check references the SAME factory identifiers merge-gate does
  // (readAcComplete/readReviewVerdict/readHoldout from merge-gate.js, which themselves
  // call contract-defs.js's computeReviewVerdict) — for the identical reason merge-gate
  // sits in factory, not governance, despite the name.
  "governance-check": "factory",
  // FAFF-261: mechanical adversarial-backends assembly reads config via loadConfig/dig
  // (factory identifiers, config.js) — same family as config/eligible/models → factory.
  "adversarial-backends": "factory",
  // FAFF-341: review-iteration-cap requires config.js's VALID_APPETITES (factory identifier,
  // same family as models/eligible) → factory.
  "review-iteration-cap": "factory",
  // FAFF-523: backends reads config via loadConfig (factory identifier, config.js) for its
  // resolve/realizable subcommands — same family as adversarial-backends/engine → factory.
  "backends": "factory",
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
  "events": ["events", "--selftest"],
  "effects": ["effects", "--selftest"],
  "review-progress": ["review-progress", "--selftest"],
  "build-progress": ["build-progress", "--selftest"],
  "budget": ["budget", "--selftest"],
  "sentry": ["sentry", "--selftest"],
  "sentry-poller": ["sentry-poller", "--selftest"],
  "sentrycheck": ["sentrycheck", "--selftest"],
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
  "self-intake": ["self-intake", "--selftest"],
  "economics": ["economics", "--selftest"],
  "disposition": ["disposition", "--selftest"],
  "quality": ["quality", "--selftest"],
  "run-done": ["run-done", "--selftest"],
  "run-outward": ["run-outward", "--selftest"],
  "run-start": ["run-start", "--selftest"],
  "hooks-ensure": ["hooks-ensure", "--selftest"],
  "merge-fence": ["merge-fence", "--selftest"],
  "background-fence": ["background-fence", "--selftest"],
  "validate-adapters": null,
  "labels": null,
  "label": ["label", "--selftest"],
  "eligible": ["eligible", "--selftest"],
  "admissible": ["admissible", "--selftest"],
  "dod": ["dod", "--selftest"],
  "holdout": ["holdout", "--selftest"],
  "spec-review-lenses": ["spec-review-lenses", "--selftest"],
  "container-check": ["container-check", "--selftest"],
  "evaluator-preflight": ["evaluator-preflight", "--selftest"],
  "corrective-integrity": ["corrective-integrity", "--selftest"],
  "integrity-boundary": ["integrity-boundary", "--selftest"],
  "integrity-digest": ["integrity-digest", "--selftest"],
  "corrective": ["corrective", "--selftest"],
  "next": ["next", "--selftest"],
  "project-next": ["project-next", "--selftest"],
  "state": null,
  "queue-state": ["queue-state", "--selftest"],
  "findings-reconcile": ["findings-reconcile", "--selftest"],
  "park-history": ["park-history", "--selftest"],
  "gitignore-ensure": ["gitignore-ensure", "--selftest"], // FAFF-548: host-safe selftest (temp roots only)
  "adr": ["adr", "--selftest"],
  "prd": ["prd", "--selftest"],
  "prd-checklist": ["prd-checklist", "--selftest"],
  "prdr": ["prdr", "--selftest"],
  "profile": ["profile", "--selftest"],
  "fixtures": ["fixtures", "--selftest"],
  "env": ["env", "--selftest"],
  "engine": ["engine", "--selftest"],
  "lights-out": ["lights-out", "--selftest"],
  "gates": ["gates", "--selftest"],
  "contract": ["contract", "--selftest"],
  "models": ["models", "--selftest"],
  "doctor": null,
  "worktree-prune": ["worktree-prune", "--selftest"],
  "worktree-root": ["worktree-root", "--selftest"],
  "stage-guard": ["stage-guard", "--selftest"],
  "lint-refs": ["lint-refs", "--selftest"],
  "lint-cli-doc": ["lint-cli-doc", "--selftest"],
  "regions": ["regions", "--selftest"],
  "cli-surface": ["cli-surface", "--selftest"],
  "merge-gate": ["merge-gate", "--selftest"],
  "branch-protection-check": ["branch-protection-check", "--selftest"],
  "post-merge-check": ["post-merge-check", "--selftest"],
  "ci-triage": ["ci-triage", "--selftest"],
  "governance-check": ["governance-check", "--selftest"],
  "adversarial-backends": ["adversarial-backends", "--selftest"],
  "review-iteration-cap": ["review-iteration-cap", "--selftest"],
  "backends": ["backends", "--selftest"],
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
  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (${Object.keys(fixtures).length + 4} cases, ${failed} failed)`);
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
    if (argv === null) {
      const fatal = REGION_MAP[cmd] === "governance";
      if (fatal) failed++;
      status = fatal ? "FAIL (governance member without a selftest)" : "no-selftest";
    } else {
      const r = spawnSync(process.execPath, [ENTRYPOINT, ...argv], { encoding: "utf8", timeout: 120000 });
      if (r.status !== 0) failed++;
      status = r.status === 0 ? "PASS" : `FAIL (exit ${r.status === null ? "timeout/error" : r.status})`;
    }
    console.log(`${cmd.padEnd(width)}  ${REGION_MAP[cmd].padEnd(10)}  ${status}`);
  }
  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (${members.length} members, ${failed} failed)`);
  return failed ? 1 : 0;
}

const REGIONS_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--region": { arity: 1 } }, positionals: { min: 0, max: 1, name: "verb" } };

function cmdRegions(args, COMMANDS) {
  if (args.includes("--selftest")) return regionsSelftest(COMMANDS);
  const { values, positionals, errors } = parseArgs(args, REGIONS_SPEC);
  if (errors.length) return usageError(errors, "usage: faff regions <list|check|selftest> [--json] [--region governance|factory|all]");
  const sub = positionals[0];

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
    console.log("PASS  regions check: require-graph direction invariant holds (governance↛factory, shared-infra↛any local module)");
    return 0;
  }

  if (sub === "selftest") {
    return regionsSelftestRun(values["--region"] === undefined ? null : values["--region"], COMMANDS);
  }

  process.stderr.write("usage: faff regions <list|check|selftest> [--json] [--region governance|factory|all]\n");
  return 2;
}


module.exports = { REGEX_PRECEDING_KEYWORDS, REGION_MAP, REGION_NAMES, REGION_SELFTEST_ARGV, REGION_TAG_RE, cmdRegions, regionsCheck, regionsExitFor, regionsFileMap, regionsFnRange, regionsRequireEdges, regionsResolveRelative, regionsSelftest, regionsSelftestRun, regionsStaleNulls, regionsStripSource };
