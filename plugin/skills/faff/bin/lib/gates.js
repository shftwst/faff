// ===========================================================================
// === region:factory — gates — FAFF-11: the engineering-quality gate ladder. ===
// `faff gates discover` deterministically inspects the repo's OWN declared checks and emits an
// ordered List<Rung> cheapest-first + a discovery classification (confident/none). Sources read
// (v2, FAFF-533): pre-commit hooks, package.json scripts, Makefile targets, and `.github/workflows/*.yml`
// (a `run:`-line scan against a curated recognised-runner allow-list; the CI source lets a repo whose
// gates live ONLY in CI — faff's own, via validate.yml — resolve `confident` instead of `none`).
// (The spec also names CLAUDE.md and other CI hosts as future sources — not yet parsed here; a repo
// declaring checks ONLY in those resolves `discovery: none`, which the fail-closed default routes to
// needs-human rather than silently passing — never green by silence. `gates.fallback: advisory` is
// the explicit opt-out.)
// `faff gates run` discovers then executes the rungs cheapest-first in the worktree sandbox
// (execution_target = cwd; the single FAFF-12 seam) and emits a GatesOutcome + a fenced
// faff-contract:quality-gates block. Pure-deterministic: NO LLM judgement decides what counts as a
// gate, and a command whose only source is an issue description / third-party comment is NEVER
// discovered (TRUSTED-SOURCE-ONLY: only the repo's own config files, like Step 8).
// ===========================================================================

// Cost ranks — lower = cheaper / more-local, the sequencing key (cheapest-first).

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const GATES_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 } }, positionals: { min: 0, max: 1, name: "action" } };
// FAFF-628 — declared grammar. Neither `discover` nor `run` unconditionally requires a flag
// today (both default from --root/findRoot()).
const GATES_SURFACE = {
  kind: "subcommand_dispatch",
  spec: GATES_SPEC,
  subcommands: {
    discover: { required_flags: [] },
    run: { required_flags: [] },
  },
};
const SYNC_SPEC = { flags: { "--json": { arity: 0 }, "--dry-run": { arity: 0 }, "--script": { arity: 1 } } };
const DOCTOR_SPEC = { flags: { "--target": { arity: 1 }, "--root": { arity: 1 } } };
const { loadConfig } = require("./config");
const { contractQualityGates } = require("./contract-defs");
const { commandInvokesFaffHook, preToolUseCommands } = require("./hooks-ensure");
const { dig, findRoot, homeDir, mainWorktreeRoot } = require("./shared-infra");

const GATE_COST = { FORMAT: 10, LINT: 20, TYPECHECK: 30, STATIC_ANALYSIS: 40, UNIT: 50, OTHER: 60 };

// FAFF-533: added to GATE_COST[kind] for a CI-sourced rung, so a locally-declared gate of the same
// kind (pkg/Makefile at base, pre-commit at base-5) always wins the dedup-by-kind (lowest cost_rank).
// CI is the fallback source, discoverable only when it is the SOLE declarer of that kind.
const CI_COST_PENALTY = 5;

// Map a script/target NAME to a RungKind by its conventional intent. Returns null for names that
// are not recognisably an engineering gate (so we never fabricate a gate from an arbitrary script).
function gateKindForName(name) {
  const n = String(name).toLowerCase();
  if (/(^|[^a-z])(fmt|format|prettier|gofmt|rustfmt|black|isort)([^a-z]|$)/.test(n)) return "FORMAT";
  if (/(^|[^a-z])(lint|eslint|flake8|ruff|clippy|vet|rubocop|standard)([^a-z]|$)/.test(n)) return "LINT";
  if (/(^|[^a-z])(typecheck|type-check|tsc|mypy|pyright|types)([^a-z]|$)/.test(n)) return "TYPECHECK";
  if (/(^|[^a-z])(static|analyz|analyse|sast|bandit|semgrep)([^a-z]|$)/.test(n)) return "STATIC_ANALYSIS";
  if (/(^|[^a-z])(test|tests|unit|spec|pytest|jest|vitest|check)([^a-z]|$)/.test(n)) return "UNIT";
  return null;
}

// Discover the package.json scripts that look like engineering gates → rungs.
function discoverPkgScripts(root) {
  const rungs = [];
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return rungs;
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch { return rungs; }
  const scripts = (pkg && pkg.scripts) || {};
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== "string" || !body.trim()) continue;
    const kind = gateKindForName(name);
    if (!kind) continue;
    rungs.push({ kind, name: `${kind.toLowerCase()} (package.json: npm run ${name})`, command: `npm run ${name}`, source: "pkg_script", cost_rank: GATE_COST[kind], required: true });
  }
  return rungs;
}

// Discover Makefile targets that look like engineering gates → rungs. Trusted source: the repo's
// own Makefile. We read target NAMES only (the line `target:` at col 0), never recipe bodies.
function discoverMakefile(root) {
  const rungs = [];
  const mkPath = path.join(root, "Makefile");
  if (!fs.existsSync(mkPath)) return rungs;
  let text;
  try { text = fs.readFileSync(mkPath, "utf8"); } catch { return rungs; }
  const targets = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:(?!=)/.exec(line);
    if (m) targets.add(m[1]);
  }
  for (const t of targets) {
    const kind = gateKindForName(t);
    if (!kind) continue;
    rungs.push({ kind, name: `${kind.toLowerCase()} (Makefile: make ${t})`, command: `make ${t}`, source: "makefile", cost_rank: GATE_COST[kind], required: true });
  }
  return rungs;
}

// Discover pre-commit hook ids → rungs (declared hooks the repo opted into). Trusted: the repo's
// .pre-commit-config.yaml. We read hook IDs only and run them via `pre-commit run <id> --all-files`.
function discoverPreCommit(root) {
  const rungs = [];
  const cfg = ["", ".yaml", ".yml"].map((e) => path.join(root, ".pre-commit-config" + e)).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!cfg) return rungs;
  let text;
  try { text = fs.readFileSync(cfg, "utf8"); } catch { return rungs; }
  // Minimal: collect `- id: <hook>` lines (our YAML subset parser does lists shallowly; read ids directly).
  const ids = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*-?\s*id:\s*["']?([A-Za-z0-9][A-Za-z0-9._-]*)["']?\s*$/.exec(line);
    if (m) ids.push(m[1]);
  }
  for (const id of ids) {
    // Only sweep in a hook whose id maps to a recognised engineering-gate kind. A repo's
    // pre-commit config can carry arbitrary heavy hooks (an integration suite, a deploy check);
    // running an UNRECOGNISED hook as a REQUIRED gate is exactly the "slow target labelled cheap"
    // failure the spec names. Drop the unknown ones (consistent with the pkg/Makefile paths, which
    // also drop names gateKindForName can't classify) rather than gate on them.
    const kind = gateKindForName(id);
    if (!kind) continue;
    rungs.push({ kind, name: `${kind.toLowerCase()} (pre-commit: ${id})`, command: `pre-commit run ${id} --all-files`, source: "pre_commit", cost_rank: GATE_COST[kind] - 5, required: true });
  }
  return rungs;
}

// FAFF-533: the curated recognised-runner allow-list. Ordered — first match wins. This matches a
// full COMMAND line (not a script/target NAME like gateKindForName), because gateKindForName's loose
// name tokens (`check`, `test`) over-match arbitrary command text (`git checkout`, `container-check`),
// fabricating required rungs from noise — the "slow target labelled cheap" failure. This list stays
// deliberately narrow: over-matching is a bug, under-matching (a missed runner → `none`) is safe.
// The table is the documented one-line extension point for new runners.
const CI_RUNNERS = [
  // --- TYPECHECK ---
  { pattern: /(^|[^a-z])(tsc|mypy|pyright)([^a-z]|$)/, kind: "TYPECHECK" },
  // --- LINT (incl. faff's OWN CLI gates) ---
  { pattern: /(^|[^a-z])(eslint|flake8|ruff|clippy|rubocop|standardrb?)([^a-z]|$)/, kind: "LINT" },
  { pattern: /(^|[^a-z])go\s+vet([^a-z]|$)/, kind: "LINT" },
  { pattern: /(^|[^a-z])(validate-adapters|lint-refs|lint-cli-doc)([^a-z]|$)/, kind: "LINT" }, // faff's own gates
  // --- FORMAT ---
  { pattern: /(^|[^a-z])(prettier|gofmt|rustfmt|black|isort)([^a-z]|$)/, kind: "FORMAT" },
  // --- UNIT ---
  { pattern: /(^|[^a-z])node\b[^\n]*--test([^a-z]|$)/, kind: "UNIT" }, // node --test
  { pattern: /(^|[^a-z])(jest|vitest|mocha|\bava\b|tap|pytest|phpunit|rspec)([^a-z]|$)/, kind: "UNIT" },
  { pattern: /(^|[^a-z])go\s+test([^a-z]|$)/, kind: "UNIT" },
  { pattern: /(^|[^a-z])cargo\s+test([^a-z]|$)/, kind: "UNIT" },
];

// Return the RungKind for a recognised CI runner command, or null for an unrecognised command.
// Matches a full COMMAND line against the curated CI_RUNNERS allow-list (see the note there).
function ciRunnerKind(command) {
  const n = String(command).toLowerCase();
  for (const { pattern, kind } of CI_RUNNERS) {
    if (pattern.test(n)) return kind;
  }
  return null;
}

// FAFF-533: pull the command text out of every `run:` step of a workflow file. A purpose-built
// line scan (NOT a full YAML parse) — the same posture as discoverMakefile (scan `target:` lines)
// and discoverPreCommit (scan `- id:` lines). Handles both the inline form (`run: cmd`) and the
// block-scalar form (`run: |` then an indented body). Returns one candidate command per line.
function extractRunCommands(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  const indentOf = (s) => (s.match(/^[ \t]*/) || [""])[0].length;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^(\s*)-?\s*run:\s*(.*)$/.exec(line);
    if (!m) { i += 1; continue; }
    const keyIndent = indentOf(line);
    const inline = m[2].trim();
    if (/^[|>][+-]?\s*$/.test(inline)) {
      // block scalar — collect the indented body until indentation returns to <= keyIndent.
      i += 1;
      while (i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) > keyIndent)) {
        const body = lines[i].trim();
        if (body !== "") out.push(body);   // one candidate command per non-blank body line
        i += 1;
      }
      continue;                            // i already advanced past the block
    } else if (inline !== "") {
      out.push(inline.replace(/^["']|["']$/g, "")); // inline single-line command (strip surrounding quotes)
    }
    i += 1;
  }
  return out;
}

// FAFF-533: the 4th detector — recognised gate commands declared in `.github/workflows/*.yml`.
// Reads root/.github/workflows/*.{yml,yaml}; emits a rung per recognised `run:` command. A missing
// dir, an unreadable file, or zero recognised commands → [] (never throws). CI-sourced rungs carry
// cost_rank = GATE_COST[kind] + CI_COST_PENALTY, so a local source of the same kind wins dedup.
function discoverCiWorkflows(root) {
  const rungs = [];
  const dir = path.join(root, ".github", "workflows");
  let stat;
  try { stat = fs.statSync(dir); } catch { return rungs; }
  if (!stat.isDirectory()) return rungs;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return rungs; }
  const files = entries.filter((f) => /\.ya?ml$/i.test(f)).sort();
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; } // skip unreadable
    for (const command of extractRunCommands(text)) {
      const kind = ciRunnerKind(command);
      if (!kind) continue;                 // unrecognised → not a gate, drop it
      rungs.push({ kind, name: `${kind.toLowerCase()} (ci-workflow: ${command})`, command, source: "ci_workflow", cost_rank: GATE_COST[kind] + CI_COST_PENALTY, required: true });
    }
  }
  return rungs;
}

// The deterministic discovery. Reuses the resolution ORDER faff-graft Step 8 documents
// (CLAUDE.md/test+lint via the repo's own declarations) — ONE resolver, no second divergent one.
function discoverRungs(root) {
  let rungs = [
    ...discoverPreCommit(root),
    ...discoverPkgScripts(root),
    ...discoverMakefile(root),
    ...discoverCiWorkflows(root),   // FAFF-533: CI-workflow source (fallback — local sources win dedup)
  ];
  // Deduplicate by kind, preferring the cheapest source (lowest cost_rank) for each kind.
  const byKind = new Map();
  for (const r of rungs.sort((a, b) => a.cost_rank - b.cost_rank)) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, r);
  }
  rungs = [...byKind.values()].sort((a, b) => a.cost_rank - b.cost_rank);
  // discovery classification: confident if any rung resolved; none if nothing; partial reserved for
  // the future ambiguous-config case (we resolve conservatively, so we never emit a fabricated rung).
  const discovery = rungs.length ? "confident" : "none";
  return { rungs, discovery };
}

// Execution target = the worktree sandbox (cwd) — the single FAFF-12 seam (Q1 interim default).
// Runs the rung's command and classifies pass/fail/errored. A 127 (command-not-found) is `errored`
// (tool missing) not `fail` — we can't conclude the code is bad.
function runRung(rung, root) {
  const started = Date.now();
  let res;
  try {
    res = spawnSync(rung.command, { cwd: root, shell: true, encoding: "utf8", timeout: 10 * 60 * 1000 });
  } catch (e) {
    return { kind: rung.kind, name: rung.name, command: rung.command, status: "errored", duration_ms: Date.now() - started, detail: String(e && e.message || e).slice(-500) };
  }
  const duration_ms = Date.now() - started;
  const tail = ((res.stderr || "") + (res.stdout || "")).slice(-500);
  let status;
  if (res.error || res.status === 127) status = "errored";       // tool missing / spawn error
  else if (res.status === 0) status = "pass";
  else status = "fail";
  return { kind: rung.kind, name: rung.name, command: rung.command, status, duration_ms, detail: tail };
}

// Resolve the fallback policy for `discovery: none` from config: fail-closed (default) | advisory.
function gatesFallbackPolicy(root) {
  try {
    const [data] = loadConfig(root);
    const v = dig(data, "gates.fallback");
    if (v === "advisory") return "advisory";
  } catch { /* default */ }
  return "fail-closed";
}

// Run the ladder: cheapest-first, fail-fast on the first failing REQUIRED rung. An errored rung at
// L3 → needs-human (can't conclude the code is bad). discovery:none → the fallback policy decides.
function runLadder(root) {
  const { rungs, discovery } = discoverRungs(root);
  const results = [];
  let signal = "pass";
  let needsHuman = false;
  for (const rung of rungs) {
    const r = runRung(rung, root);
    results.push(r);
    if (r.status === "errored") { needsHuman = true; continue; }   // surface, don't gate as fail
    if (rung.required && r.status === "fail") {
      return { signal: "fail", discovery, rungs: results };         // fail-fast: stop here
    }
  }
  if (discovery === "none") {
    signal = gatesFallbackPolicy(root) === "fail-closed" ? "needs-human" : "pass";
  } else if (needsHuman) {
    signal = "needs-human";
  }
  return { signal, discovery, rungs: results };
}

// Map a GatesOutcome → the quality-gates contract EXTRACTION shape (rungs reduced to {kind,status}).
function gatesContractExtraction(outcome) {
  return { signal: outcome.signal, rungs: outcome.rungs.map((r) => ({ kind: r.kind, status: r.status })) };
}

function cmdGates(args) {
  if (args.includes("--selftest")) return gatesSelftest();
  const { values, positionals, errors } = parseArgs(args, GATES_SPEC);
  if (errors.length) return usageError(errors, "usage: faff gates <discover|run> [--json] [--root DIR]");
  const action = positionals[0];
  const json = !!values["--json"];
  const root = values["--root"] || findRoot();

  if (action === "discover") {
    const { rungs, discovery } = discoverRungs(root);
    if (json) { console.log(JSON.stringify({ discovery, rungs }, null, 2)); return 0; }
    console.log(`gate ladder discovery: ${discovery} (${rungs.length} rung${rungs.length === 1 ? "" : "s"})`);
    for (const r of rungs) console.log(`  ${String(r.cost_rank).padStart(3)}  ${r.kind.padEnd(16)} ${r.command}   [${r.source}]`);
    return 0;
  }

  if (action === "run") {
    const outcome = runLadder(root);
    const extraction = gatesContractExtraction(outcome);
    // Emit the contract block in the SAME fenced-code-block form every faff producer uses
    // (```faff-contract:<name> … ```), so Step 7.5's "locate that block" matches the identical
    // pattern as review-verdict/spec-readiness/delivery-outcome — not a divergent XML envelope.
    const block = "```faff-contract:quality-gates\n" + JSON.stringify(extraction) + "\n```";
    if (json) {
      console.log(JSON.stringify({ ...outcome, contract: extraction }, null, 2));
    } else {
      console.log(`gate ladder: signal=${outcome.signal} discovery=${outcome.discovery}`);
      for (const r of outcome.rungs) console.log(`  ${r.status.padEnd(8)} ${r.kind.padEnd(16)} ${r.command}  (${r.duration_ms}ms)`);
      if (outcome.discovery === "none") console.log("  no declared engineering gates found; ran none");
      console.log(block);
    }
    // exit 0 all-pass / 1 >=1 fail / 2 usage (mirrors the spec). needs-human exits 1 (non-green).
    return outcome.signal === "pass" ? 0 : 1;
  }

  process.stderr.write("faff gates: expected one of: discover | run (or --selftest)\n");
  return 2;
}

function gatesSelftest() {
  const cases = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-gates-"));
  const mk = (name, files) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d, { recursive: true });
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
      fs.writeFileSync(path.join(d, f), body);
    }
    return d;
  };

  // 1. package.json with lint + test → both discovered, LINT before UNIT by cost_rank.
  const dPkg = mk("pkg", { "package.json": JSON.stringify({ scripts: { lint: "true", test: "true", build: "true" } }) });
  const dis1 = discoverRungs(dPkg);
  cases.push(["pkg: discovers lint+test, not build", dis1.rungs.length === 2 && dis1.rungs[0].kind === "LINT" && dis1.rungs[1].kind === "UNIT"]);
  cases.push(["pkg: discovery confident", dis1.discovery === "confident"]);
  cases.push(["pkg: cost_rank ascending (LINT<UNIT)", dis1.rungs[0].cost_rank < dis1.rungs[1].cost_rank]);

  // 2. run ladder all-pass → signal pass, rungs both pass, ordered LINT before UNIT.
  const out2 = runLadder(dPkg);
  cases.push(["pkg run: signal pass", out2.signal === "pass"]);
  cases.push(["pkg run: LINT then UNIT", out2.rungs[0].kind === "LINT" && out2.rungs[1].kind === "UNIT"]);
  cases.push(["pkg run: both pass", out2.rungs.every((r) => r.status === "pass")]);

  // 3. lint fails (exit 1) → fail-fast: signal fail, stops BEFORE the test rung (only 1 result).
  const dFail = mk("fail", { "package.json": JSON.stringify({ scripts: { lint: "false", test: "true" } }) });
  const out3 = runLadder(dFail);
  cases.push(["fail-fast: signal fail", out3.signal === "fail"]);
  cases.push(["fail-fast: stopped before UNIT (1 result)", out3.rungs.length === 1 && out3.rungs[0].kind === "LINT" && out3.rungs[0].status === "fail"]);

  // 4. no declared checks → discovery none; fail-closed default → needs-human; explicit advisory → pass.
  const dNone = mk("none", { "README.md": "hi" });
  const out4 = runLadder(dNone);
  cases.push(["none: discovery none", out4.discovery === "none"]);
  cases.push(["none: fail-closed default → needs-human", out4.signal === "needs-human"]);
  const dAdvisory = mk("advisory", { "README.md": "hi", ".faffrc.yaml": "gates:\n  fallback: advisory\n" });
  const outAdvisory = runLadder(dAdvisory);
  cases.push(["none: explicit advisory opt-out → pass", outAdvisory.signal === "pass"]);
  const dClosed = mk("closed", { "README.md": "hi", ".faffrc.yaml": "gates:\n  fallback: fail-closed\n" });
  const out5 = runLadder(dClosed);
  cases.push(["none: explicit fail-closed config → needs-human", out5.signal === "needs-human"]);

  // 5. errored rung (command not found) → needs-human, not fail.
  const dErr = mk("err", { "package.json": JSON.stringify({ scripts: { lint: "this-command-does-not-exist-xyz" } }) });
  const out6 = runLadder(dErr);
  cases.push(["errored rung → needs-human not fail", out6.signal === "needs-human" && out6.rungs[0].status === "errored"]);

  // 6. Makefile target discovery.
  const dMk = mk("mk", { "Makefile": "lint:\n\ttrue\nbuild:\n\ttrue\n" });
  const dis6 = discoverRungs(dMk);
  cases.push(["makefile: discovers lint target only", dis6.rungs.length === 1 && dis6.rungs[0].kind === "LINT" && dis6.rungs[0].source === "makefile"]);

  // 7. dedup: package.json lint preferred over makefile lint (cheaper source already; one LINT rung).
  const dDup = mk("dup", { "package.json": JSON.stringify({ scripts: { lint: "true" } }), "Makefile": "lint:\n\ttrue\n" });
  const dis7 = discoverRungs(dDup);
  cases.push(["dedup: one LINT rung when both pkg+makefile declare it", dis7.rungs.filter((r) => r.kind === "LINT").length === 1]);

  // 8. contract extraction shape pipes cleanly through the quality-gates contract.
  const ext = gatesContractExtraction(out2);
  const c = contractQualityGates(ext);
  cases.push(["contract: pass outcome conforms", !c.failLoud && c.contractData.conformant === true]);

  // 9. pre-commit: only recognised-kind hooks are swept in; an unknown heavy hook is dropped,
  //    never run as a required gate (the "slow target labelled cheap" failure mode).
  const dPc = mk("pc", { ".pre-commit-config.yaml": "repos:\n  - hooks:\n      - id: ruff\n      - id: my-heavy-integration-suite\n" });
  const dis9 = discoverRungs(dPc);
  cases.push(["pre-commit: recognised hook swept, unknown dropped", dis9.rungs.length === 1 && dis9.rungs[0].kind === "LINT" && dis9.rungs[0].source === "pre_commit"]);

  // 10. discover exit code via the cmd path (--root, --json arg handling — the observation gap).
  const exitDiscover = cmdGates(["discover", "--root", dPkg, "--json"]);
  cases.push(["cmd discover --root --json exit 0", exitDiscover === 0]);
  const exitBad = cmdGates(["bogus-action", "--root", dPkg]);
  cases.push(["cmd unknown-action exit 2 (usage)", exitBad === 2]);
  const exitRunPass = cmdGates(["run", "--root", dPkg, "--json"]);
  cases.push(["cmd run all-pass exit 0", exitRunPass === 0]);
  const exitRunFail = cmdGates(["run", "--root", dFail, "--json"]);
  cases.push(["cmd run with fail exit 1", exitRunFail === 1]);

  // 11. ciRunnerKind: recognised runners map to the right kind; unrecognised → null.
  cases.push(["ci: node --test → UNIT", ciRunnerKind("node --test") === "UNIT"]);
  cases.push(["ci: faff validate-adapters → LINT", ciRunnerKind("node plugin/skills/faff/bin/faff validate-adapters") === "LINT"]);
  cases.push(["ci: lint-refs → LINT", ciRunnerKind("node plugin/skills/faff/bin/faff lint-refs") === "LINT"]);
  cases.push(["ci: pytest → UNIT", ciRunnerKind("python -m pytest -q") === "UNIT"]);
  cases.push(["ci: tsc → TYPECHECK", ciRunnerKind("npx tsc --noEmit") === "TYPECHECK"]);
  cases.push(["ci: git checkout → null (no false positive)", ciRunnerKind("git checkout main") === null]);
  cases.push(["ci: bare shell noise → null", ciRunnerKind("echo done") === null && ciRunnerKind("make build") === null]);

  // 12. extractRunCommands: inline form.
  const exInline = extractRunCommands("    steps:\n      - name: t\n        run: node --test\n");
  cases.push(["extract: inline run command", exInline.length === 1 && exInline[0] === "node --test"]);

  // 13. extractRunCommands: block-scalar form, blank line inside the block does not terminate it.
  const exBlock = extractRunCommands("      - name: tests\n        run: |\n          echo setup\n\n          node --test\n      - name: next\n        run: echo done\n");
  cases.push(["extract: block-scalar yields body lines", exBlock.includes("node --test") && exBlock.includes("echo setup")]);
  cases.push(["extract: block does not swallow the next step", exBlock.includes("echo done")]);

  // 14. discoverCiWorkflows: a CI-only repo resolves confident with a UNIT rung (source ci_workflow).
  const dCi = mk("ci", { ".github/workflows/validate.yml": "jobs:\n  v:\n    steps:\n      - name: adapters\n        run: node bin/faff validate-adapters\n      - name: tests\n        run: node --test\n" });
  const disCi = discoverRungs(dCi);
  cases.push(["ci: discovery confident", disCi.discovery === "confident"]);
  cases.push(["ci: UNIT rung node --test source ci_workflow", disCi.rungs.some((r) => r.kind === "UNIT" && r.source === "ci_workflow" && r.command === "node --test")]);
  cases.push(["ci: LINT rung from validate-adapters", disCi.rungs.some((r) => r.kind === "LINT" && r.source === "ci_workflow")]);
  cases.push(["ci: UNIT cost_rank = base + penalty", disCi.rungs.filter((r) => r.kind === "UNIT").every((r) => r.cost_rank === GATE_COST.UNIT + CI_COST_PENALTY)]);

  // 15. dedup: package.json UNIT (test) beats a CI node --test (local wins, lower cost_rank).
  const dCiDup = mk("cidup", { "package.json": JSON.stringify({ scripts: { test: "true" } }), ".github/workflows/ci.yml": "jobs:\n  v:\n    steps:\n      - run: node --test\n" });
  const disCiDup = discoverRungs(dCiDup);
  const unitRungs = disCiDup.rungs.filter((r) => r.kind === "UNIT");
  cases.push(["ci dedup: one UNIT rung", unitRungs.length === 1]);
  cases.push(["ci dedup: local pkg rung wins", unitRungs[0].source === "pkg_script"]);

  // 16. false-positive guard: a workflow of only uses:/name:/non-recognised run: → none, no rung.
  //     A recognised token inside a `name:` label (not a `run:` value) is NOT scanned.
  const dCiNone = mk("cinone", { ".github/workflows/noop.yml": "jobs:\n  v:\n    steps:\n      - uses: actions/checkout@v4\n      - name: Run pytest suite\n        run: echo done\n" });
  const disCiNone = discoverRungs(dCiNone);
  cases.push(["ci false-positive guard: discovery none", disCiNone.discovery === "none"]);
  cases.push(["ci false-positive guard: no rung emitted", disCiNone.rungs.length === 0]);

  // 17. missing .github/workflows dir → [] (the common local-only repo case).
  cases.push(["ci: missing workflows dir → []", discoverCiWorkflows(dPkg).length === 0]);

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }

  let failed = 0;
  for (const [n, ok] of cases) { console.log(`${ok ? "ok  " : "FAIL"} ${n}`); if (!ok) failed++; }
  console.log(`RESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}

// FAFF-190: install-health check. The faff skills can be installed as real-dir COPIES (e.g. a
// marketplace install) rather than symlinks to the repo — in which case shipped repo changes don't
// go live until `link-skills.sh --global --replace`. This reads the FILESYSTEM (is <dir> a symlink?),
// so it reports correctly even when run from a stale installed bin/faff — it is not circular.
// FAFF-434: is the merge-fence PreToolUse hook registered under <root>/.claude/settings.json?
// Independent of the --target skills-dir scan (a different install-health axis entirely) —
// absent/malformed settings.json degrades to "missing", never a crash (a repo with no
// .claude/settings.json yet is the common pre-hooks-ensure state, not a doctor fault).
function mergeFencePresentAt(root) {
  let settings;
  try { settings = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8")); }
  catch { return false; }
  return preToolUseCommands(settings).some((c) => commandInvokesFaffHook(c, "merge-fence"));
}

// FAFF-443: classify a live global skill/CLI symlink by WHERE it resolves. A global install
// is machine-wide, so a link resolving into a linked worktree is "live but fragile" — it will
// dangle when that worktree is removed. The target sits in a LINKED worktree iff that checkout's
// own top-level differs from the repo's main checkout: `mainWorktreeRoot(dir)` is the parent of
// the shared git-common-dir (the MAIN checkout — the SAME value from the main checkout AND from
// any linked worktree, since they share the common dir), while `git rev-parse --show-toplevel`
// is THIS checkout's root — they diverge only inside a linked worktree. (`git -C` resolves from
// any path within a checkout, so the target's containing dir is a sufficient probe.) Returns
// "dangling" (target gone / realpath race), "intoWorktree" (fragile), or "live".
function classifyGlobalLink(full) {
  if (!fs.existsSync(full)) return "dangling";       // symlink target gone
  let real;
  try { real = fs.realpathSync(full); }
  catch { return "dangling"; }                        // TOCTOU: raced removal mid-classify
  const dir = path.dirname(real);
  const mainRoot = mainWorktreeRoot(dir);            // main checkout (common-dir parent), or null
  if (!mainRoot) return "live";                       // bare / non-repo / no git → not fragile
  const top = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0 || !(top.stdout || "").trim()) return "live";
  return path.resolve(mainRoot) !== path.resolve(top.stdout.trim()) ? "intoWorktree" : "live";
}

// FAFF-676: doctor's default scan set must match the installer's global target list
// (scripts/link-skills.sh), or doctor is lying about what it looked at. `--target` and
// `$CLAUDE_PLUGIN_ROOT` each still resolve to exactly one directory — unchanged in effect,
// only rewrapped to return a one-element list. Only the home-directory default branch grows,
// to the SAME two directories the installer writes to in global mode, in the SAME order.
// This is the ONLY place in gates.js naming .claude / .agents as skills directories — see
// the installer-and-doctor agreement test in test/link-skills-worktree.test.mjs, which is
// what keeps this list honest against scripts/link-skills.sh's TARGET_DIRS rather than a
// promise that the two never drift apart.
function resolveDoctorScanSet(targetFlag, pluginRootEnv, home) {
  if (targetFlag) return { scanSet: [targetFlag], collapseNotices: [] };
  if (pluginRootEnv) return { scanSet: [path.join(pluginRootEnv, "skills")], collapseNotices: [] };
  const candidates = [path.join(home, ".claude", "skills"), path.join(home, ".agents", "skills")];
  return dedupeByResolvedPath(candidates);
}

// Mirrors dedupe_by_resolved_path in scripts/link-skills.sh (same rule, kept honest by the
// agreement test rather than shared code — one's bash, one's Node). A path that does not
// exist can alias nothing, so it resolves to itself rather than throwing.
function dedupeByResolvedPath(candidates) {
  const kept = [];
  const seen = new Map(); // resolved path -> first literal path that produced it
  const collapseNotices = [];
  for (const p of candidates) {
    let resolved;
    try { resolved = fs.realpathSync(p); } catch { resolved = p; }
    if (seen.has(resolved)) {
      collapseNotices.push(`${p} resolves to ${seen.get(resolved)} — treating them as one target`);
      continue;
    }
    seen.set(resolved, p);
    kept.push(p);
  }
  return { scanSet: kept, collapseNotices };
}

const isFaffSkillName = (n) => n === "faff" || n.startsWith("faff-") || n.startsWith("faffter-") || n.startsWith("faffidavit-");

// Scans ONE directory and classifies every faff-owned entry — exactly today's per-skill
// logic (live / intoWorktree / dangling / copy), unchanged. Never throws: an unreadable or
// absent directory is recorded as such and returned, not an early exit — the caller decides
// what an all-unreadable scan set means (FAFF-676's whole point: a single bad directory must
// not go silent while another scanned directory is healthy).
function scanDoctorDirectory(directory) {
  let entries;
  try { entries = fs.readdirSync(directory).filter(isFaffSkillName).sort(); }
  catch (e) {
    const reason = e.code === "ENOENT" ? "not present" : `unreadable: ${e.message}`;
    return { directory, readable: false, reason, namesFound: new Set(), copies: 0, dangling: 0, intoWorktree: 0, findings: [] };
  }
  let copies = 0;
  let dangling = 0;
  let intoWorktree = 0;
  const findings = [];
  const namesFound = new Set();
  for (const name of entries) {
    namesFound.add(name);
    const full = path.join(directory, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (st.isSymbolicLink()) {
      // A symlink is healthy only if its target resolves. lstat answers "is-a-symlink"
      // without following the link, so a dangling link (a rename-orphan, FAFF-296) reads
      // as healthy. existsSync follows the link — false ⇒ target gone ⇒ dangling. (FAFF-299)
      // FAFF-443: a live link may still be FRAGILE if it resolves into a linked worktree.
      const state = classifyGlobalLink(full);
      if (state === "live") {
        findings.push(`✓ ${name}  symlink (live → repo)`);
      } else if (state === "intoWorktree") {
        intoWorktree++;
        findings.push(`⚠ ${name}  symlink (live → WORKTREE, not main checkout — will dangle when the worktree is removed)`);
      } else {
        dangling++;
        findings.push(`✗ ${name}  symlink-dangling (target gone — stale orphan)`);
      }
    } else {
      copies++;
      findings.push(`✗ ${name}  COPY — not dev-linked; shipped changes won't go live`);
    }
  }
  return { directory, readable: true, reason: entries.length === 0 ? "no faff skills here" : null, namesFound, copies, dangling, intoWorktree, findings };
}

// render_missing (spec HOW → "How much an empty directory prints"): a directory that found
// NOTHING is one fact, stated once — never one MISSING line per skill, which would turn the
// most-seen post-FAFF-672 report (a healthy ~/.claude/skills beside an absent
// ~/.agents/skills) into thirty near-identical lines burying the RESULT line. A directory
// missing only a SUBSET gets one line per missing skill, uncapped — that is the genuinely
// per-skill fact worth naming.
function renderDoctorScanBody(scan, unionSize) {
  if (scan.namesFound.size === 0) {
    return [`✗ ${scan.reason} — all ${unionSize} faff skill(s) found elsewhere are MISSING here`];
  }
  const lines = [...scan.findings];
  for (const name of scan.missingHere) lines.push(`✗ ${name}  MISSING here — this harness cannot see it`);
  return lines;
}

function cmdDoctor(args) {
  const { values, errors } = parseArgs(args, DOCTOR_SPEC);
  if (errors.length) return usageError(errors, "usage: faff doctor [--target live|intoWorktree] [--root DIR]");
  const targetFlag = values["--target"] === undefined ? null : values["--target"];
  let root = values["--root"] === undefined ? null : values["--root"];
  root = root || findRoot();

  const { scanSet, collapseNotices } = resolveDoctorScanSet(targetFlag, process.env.CLAUDE_PLUGIN_ROOT, homeDir());
  const scans = scanSet.map(scanDoctorDirectory);

  // FAFF-676: exit 2 ("nothing installed anywhere") is now evaluated ACROSS every scanned
  // directory rather than the first one — the old behaviour returned early the instant any
  // one directory was unreadable or empty, which is exactly the state ~/.agents/skills is in
  // on every pre-FAFF-672 machine even though ~/.claude/skills is perfectly healthy. That
  // early return is the bug this ticket exists to fix: it must never come back as a
  // per-directory early exit inside the loop above.
  const union = new Set();
  for (const s of scans) for (const n of s.namesFound) union.add(n);
  if (union.size === 0) {
    process.stderr.write(`faff doctor: no faff skills found under any of: ${scanSet.join(", ")}\n`);
    return 2;
  }

  for (const s of scans) {
    s.missingHere = s.namesFound.size === 0
      ? [...union].sort()
      : [...union].filter((n) => !s.namesFound.has(n)).sort();
  }

  const multi = scans.length > 1;
  const out = [];
  out.push(multi
    ? `faff doctor — install health (${scans.length} directories scanned)`
    : `faff doctor — install health (${scans[0].directory})`);
  for (const notice of collapseNotices) out.push(`  ${notice}`);
  if (multi) {
    for (const s of scans) {
      out.push("");
      out.push(`  ${s.directory}`);
      for (const line of renderDoctorScanBody(s, union.size)) out.push(`    ${line}`);
    }
    out.push("");
  } else {
    for (const line of renderDoctorScanBody(scans[0], union.size)) out.push(`  ${line}`);
  }

  let copies = 0;
  let dangling = 0;
  let intoWorktree = 0;
  for (const s of scans) { copies += s.copies; dangling += s.dangling; intoWorktree += s.intoWorktree; }

  const bin = path.join(homeDir(), ".local", "bin", "faff");
  try {
    const bst = fs.lstatSync(bin);
    if (bst.isSymbolicLink()) {
      // FAFF-443: same fragility check for the CLI link — a worktree-sourced bin/faff dangles too.
      // Machine-wide: this runs exactly once per invocation, independent of the scan set size.
      if (classifyGlobalLink(bin) === "intoWorktree") {
        intoWorktree++;
        out.push(`  ⚠ bin/faff  symlink (live → WORKTREE, not main checkout — will dangle when the worktree is removed)`);
      } else {
        out.push(`  ✓ bin/faff  symlink (live)`);
      }
    } else {
      out.push(`  • bin/faff  real file (copy)`);
    }
  } catch { /* bin link optional */ }

  // FAFF-434: the merge-fence PreToolUse registration — a distinct install-health axis
  // from the skill-link scan above (reads <root>/.claude/settings.json, not a scanned skills
  // dir), reported alongside it and folded into the same non-clean exit. Machine-wide: runs
  // exactly once per invocation regardless of how many directories were scanned.
  const fenceOk = mergeFencePresentAt(root);
  out.push(fenceOk
    ? `  ✓ merge-fence PreToolUse fence present`
    : `  ✗ merge-fence PreToolUse fence MISSING — run: faff hooks-ensure`);

  const anyMissingHere = scans.some((s) => s.missingHere.length > 0);
  if (copies > 0 || dangling > 0 || intoWorktree > 0 || anyMissingHere || !fenceOk) {
    const problems = [];
    if (copies > 0 || dangling > 0) problems.push(`${copies} copy / ${dangling} dangling skill link(s)`);
    if (intoWorktree > 0) problems.push(`${intoWorktree} worktree-sourced link(s) (fragile — will dangle on worktree removal)`);
    for (const s of scans) {
      if (s.missingHere.length > 0) problems.push(`${s.missingHere.length} skill(s) missing from ${s.directory}`);
    }
    if (!fenceOk) problems.push("merge-fence PreToolUse fence missing");
    out.push("");
    out.push(`RESULT: ${problems.join(" + ")} — install is not clean.`);
    const fixes = [];
    if (copies > 0 || dangling > 0 || intoWorktree > 0 || anyMissingHere) fixes.push("bash scripts/link-skills.sh --global --replace --prune  (from the main checkout)");
    if (!fenceOk) fixes.push("faff hooks-ensure");
    out.push(`Fix: ${fixes.join(" && ")}`);
    console.log(out.join("\n"));
    return 1;
  }
  out.push("");
  out.push(`RESULT: all faff skills are dev-linked (symlinks) — repo is live.`);
  console.log(out.join("\n"));
  return 0;
}

// FAFF-204: locate scripts/link-skills.sh by a layered resolver that survives the
// stale copy-install state sync exists to repair. An explicit --script wins outright
// (and, if unreadable, fails loud against exactly that path — never silently replaced
// by a default). Otherwise: (1) the cwd/repo anchor via findRoot — the only anchor that
// holds when the CLI is a real-file copy rather than a symlink into the repo; then
// (2) walk-up-from-self — the legacy anchor, which only resolves when the CLI is a
// symlink into the repo (linked-dev run from outside the tree). Returns the first
// readable candidate plus the ordered list of every candidate tried (de-duplicated),
// for the fail-loud message.
function resolveSyncScript(scriptOverride) {
  if (scriptOverride) {
    const readable = (() => { try { fs.accessSync(scriptOverride, fs.constants.R_OK); return true; } catch { return false; } })();
    return { path: readable ? scriptOverride : null, tried: [scriptOverride] };
  }
  const candidates = [];
  // Strategy 1 — cwd/repo anchor (survives copy-install): the reliable primary.
  candidates.push(path.join(findRoot(process.cwd()), "scripts", "link-skills.sh"));
  // Strategy 2 — walk up from the CLI's own resolved location. bin/faff lives at
  // <repo>/plugin/skills/faff/bin/faff → repo root is four dirs up from bin/. Only
  // resolves the repo when the CLI is a symlink into it (i.e. a linked-dev install).
  let self;
  try { self = fs.realpathSync(process.argv[1]); } catch { self = process.argv[1]; }
  const selfCandidate = path.join(path.resolve(path.dirname(self), "..", "..", "..", ".."), "scripts", "link-skills.sh");
  if (!candidates.includes(selfCandidate)) candidates.push(selfCandidate);

  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.R_OK); return { path: c, tried: candidates.slice(0, candidates.indexOf(c) + 1) }; }
    catch { /* not readable — try the next candidate */ }
  }
  return { path: null, tried: candidates };
}

// FAFF-200: skill-owned repair for a stale copy-install. A thin wrapper over the
// tested scripts/link-skills.sh --global --replace (re-links the skill dirs + the CLI
// onto PATH). The repair logic is NOT reimplemented in Node — single source of truth.
// Never auto-run in autonomous mode (it mutates ~/.claude outside any PR): the caller
// (the gateway doctor-at-entry check) only invokes it on an interactive human accept.
function cmdSync(args) {
  const { values, errors } = parseArgs(args, SYNC_SPEC);
  if (errors.length) return usageError(errors, "usage: faff sync [--dry-run] [--script PATH] [--json]");
  const dryRun = !!values["--dry-run"];
  const asJson = !!values["--json"];
  const scriptOverride = values["--script"] === undefined ? null : values["--script"];

  const { path: scriptPath, tried } = resolveSyncScript(scriptOverride);
  if (!scriptPath) {
    process.stderr.write(`faff sync: cannot find link-skills.sh (tried: ${tried.join(", ")})\n`);
    return 2;
  }

  const linkArgs = ["--global", "--replace", ...(dryRun ? ["--dry-run"] : [])];
  const r = spawnSync("bash", [scriptPath, ...linkArgs], { stdio: asJson ? "pipe" : "inherit", encoding: "utf8" });
  if (r.error) { process.stderr.write(`faff sync: failed to run ${scriptPath}: ${r.error.message}\n`); return 2; }

  const result = { script: scriptPath, ran: !dryRun, dry_run: dryRun, exit: r.status, ok: r.status === 0 };
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(r.status === 0
      ? `faff sync: re-linked faff skills to the repo${dryRun ? " (dry-run — nothing changed)" : ""}`
      : `faff sync: link-skills reported exit ${r.status} — see output above`);
  }
  // Pass the script's fail-loud (2) through; map any other non-zero to 1.
  return r.status === 0 ? 0 : (r.status === 2 ? 2 : 1);
}


module.exports = { CI_COST_PENALTY, GATES_SPEC, GATES_SURFACE, GATE_COST, ciRunnerKind, cmdDoctor, cmdGates, cmdSync, discoverCiWorkflows, discoverMakefile, discoverPkgScripts, discoverPreCommit, discoverRungs, extractRunCommands, gateKindForName, gatesContractExtraction, gatesFallbackPolicy, gatesSelftest, mergeFencePresentAt, resolveSyncScript, runLadder, runRung };
