// ===========================================================================
// === region:factory — gates-discover — the run-path discovery sources: package.json scripts, Makefile, pre-commit, runner files, and the CI_RUNNERS recogniser over workflow `run:` lines (discoverRungs) ===
// Split out of gates.js (FAFF-1390), which re-exports every name it exported before.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { localOs } = require("./gates-config");

// Cost ranks — lower = cheaper / more-local, the sequencing key (cheapest-first).

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

// FAFF-1269: executable runner files directly under repo-root script/, scripts/ and bin/ (the
// "Scripts to Rule Them All" layout). Names only, like the Makefile source: a file body is never
// read. RUNNER_DIRS order is the precedence on a stem clash. The cost offset sits between the local
// sources (base) and CI (base + CI_COST_PENALTY), so pkg/Makefile/pre-commit win and CI loses.
const RUNNER_DIRS = ["script", "scripts", "bin"];
const SAFE_RUNNER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RUNNER_COST_OFFSET = 2;
const RUNNER_KEYWORDS = { LINT: ["lint", "lints"], UNIT: ["test", "tests"] };
const RUNNER_QUALIFIERS = new Set(["unit", "integration", "e2e", "smoke", "system", "acceptance",
  "functional", "regression", "all", "run", "js", "ts", "py", "go", "rb", "css", "style"]);
// gateKindForName's LINT and UNIT vocabularies, minus `check` (often a whole pre-push suite).
const RUNNER_TOKENS = {
  LINT: /(^|[^a-z])(lint|eslint|flake8|ruff|clippy|vet|rubocop|standard)([^a-z]|$)/,
  UNIT: /(^|[^a-z])(test|tests|unit|spec|pytest|jest|vitest)([^a-z]|$)/,
};

// A stem matches kind K by a keyword prefix (`test*`), a keyword suffix whose lead is empty, ends in
// a separator, or is one qualifier word (`unittests`, `run-tests`, never `latest`), or a bounded
// vocabulary token (`eslint`). Only LINT and UNIT: FORMAT runners often rewrite files.
function runnerKindForName(stem) {
  const s = String(stem).toLowerCase();
  for (const kind of ["LINT", "UNIT"]) {
    for (const kw of RUNNER_KEYWORDS[kind]) {
      if (s.startsWith(kw)) return kind;
      if (s.endsWith(kw)) {
        const lead = s.slice(0, -kw.length);
        if (lead === "" || /[-_.]$/.test(lead) || RUNNER_QUALIFIERS.has(lead)) return kind;
      }
    }
    if (RUNNER_TOKENS[kind].test(s)) return kind;
  }
  return null;
}

function runnerStem(name) {
  return String(name).replace(/\.[A-Za-z0-9]{1,4}$/, "").toLowerCase();
}

function isExecutableFileInside(file, realRoot) {
  let real;
  try { real = fs.realpathSync(file); } catch { return false; }
  const rel = path.relative(realRoot, real);
  if (rel === "" || rel.split(path.sep)[0] === ".." || path.isAbsolute(rel)) return false;
  try {
    if (!fs.statSync(real).isFile()) return false;
    fs.accessSync(real, fs.constants.X_OK);
  } catch { return false; }
  return true;
}

function discoverRunnerFiles(root, { hostOs = localOs(), cap = 5, exclude = [] } = {}) {
  const rungs = [];
  const exclusions = [];
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { return { rungs, exclusions }; }
  const seenStems = new Set();
  const perKind = new Map();
  for (const dir of RUNNER_DIRS) {
    const abs = path.join(root, dir);
    let names;
    try {
      if (!fs.statSync(abs).isDirectory()) continue;
      names = fs.readdirSync(abs).sort();
    } catch { continue; }
    for (const name of names) {
      if (!SAFE_RUNNER_NAME.test(name)) continue;
      const stem = runnerStem(name);
      const kind = runnerKindForName(stem);
      if (!kind || seenStems.has(stem)) continue;
      const command = `./${dir}/${name}`;
      if (hostOs === "windows") { exclusions.push({ command, reason: "os-mismatch" }); continue; }
      if (!isExecutableFileInside(path.join(abs, name), realRoot)) continue;
      seenStems.add(stem);
      if (exclude.some((pat) => pat && command.includes(pat))) { exclusions.push({ command, reason: "configured" }); continue; }
      const used = perKind.get(kind) || 0;
      if (used >= cap) continue;
      perKind.set(kind, used + 1);
      rungs.push({ kind, name: `${kind.toLowerCase()} (runner: ${command})`, command, source: "runner_file", cost_rank: GATE_COST[kind] + RUNNER_COST_OFFSET, required: true });
    }
  }
  return { rungs, exclusions };
}

// The three-tier dedup shared by the reporting and execution resolvers: local rungs (already
// collapsed by kind) suppress runner rungs of their kind; local and runner rungs together suppress
// CI rungs of their kind. Each CI rung a runner took over is reported as `runner-covered`, so a
// false-positive runner displacing the real suite is visible in `faff gates run`.
function mergeRunnerTier(dedupedLocal, runnerRungs, dedupedCi) {
  const localKinds = new Set(dedupedLocal.map((r) => r.kind));
  const keptRunners = runnerRungs.filter((r) => !localKinds.has(r.kind));
  const runnerKinds = new Set(keptRunners.map((r) => r.kind));
  const keptCi = [];
  const displaced = [];
  for (const r of dedupedCi) {
    if (localKinds.has(r.kind)) continue;
    if (runnerKinds.has(r.kind)) { displaced.push({ command: r.command, reason: "runner-covered" }); continue; }
    keptCi.push(r);
  }
  return { rungs: [...dedupedLocal, ...keptRunners, ...keptCi], displaced };
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
    for (const raw of extractRunCommands(text)) {
      const kind = ciRunnerKind(raw);
      if (!kind) continue;                 // unrecognised → not a gate, drop it
      // FAFF-987: derive the runnable LOCAL rung — strip --test-shard so a sharded CI node --test
      // line runs the whole suite unsharded here too (this legacy discoverRungs path feeds
      // post-merge-check's re-run). No-op for a command without --test-shard.
      const command = normaliseLocalRungCommand(raw);
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
    ...discoverRunnerFiles(root).rungs,
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

// FAFF-987: a sharded CI UNIT command — `node … --test --test-shard=<i>/<N> test/` — is not
// runnable as-is on a dev box: there is no matrix, so an unexpanded `${{ matrix.shard }}` is a
// bash bad-substitution and an unset `$SHARD/$SHARD_TOTAL` env-var form resolves to an invalid
// shard (`/`). Strip the `--test-shard=<value>` token when deriving the LOCAL rung so it runs the
// whole suite unsharded, exactly once. The value runs to the next TOP-LEVEL whitespace; whitespace
// INSIDE a `${{ … }}` expression does not terminate it (so the unexpanded matrix form is removed
// whole). Only the `--test-shard` token is removed — any OTHER `${{ … }}` in the command survives,
// so it still trips the github-context exclusion (gates-select.js :: exclusionReason). A command without `--test-shard` is returned
// byte-identical, so this is a no-op for every non-sharded rung.
function normaliseLocalRungCommand(command) {
  return String(command)
    .replace(/\s*--test-shard=(?:\$\{\{[^}]*\}\}|\S)+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

module.exports = { CI_COST_PENALTY, CI_RUNNERS, GATE_COST, ciRunnerKind, discoverCiWorkflows, discoverMakefile, discoverPkgScripts, discoverPreCommit, discoverRungs, discoverRunnerFiles, extractRunCommands, gateKindForName, mergeRunnerTier, normaliseLocalRungCommand, runnerKindForName };
