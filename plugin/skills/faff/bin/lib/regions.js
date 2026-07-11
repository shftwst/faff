// ===========================================================================
// === region:factory — regions — the region map + direction lint + region selftest runner ===
//
// Phase 1 of the extraction topology (ADR 0042): the governance boundary is
// LOGICAL — region tags on section banners + this lint — not a repo split. The
// direction invariant: a governance span never references a factory identifier;
// a shared-infra span references neither region's. factory→governance stays
// legal (the future package-consumer relationship). The dispatch shell (USAGE +
// COMMANDS + main) is exempt — it references everything by design. Self-spawns
// (`<self> <cmd> …`) are invisible to the lint by design: they are process
// boundaries, the exact shape extraction preserves; the lint's claim is scoped
// to in-file identifier references. NO suppression mechanism exists (an escape
// hatch on a boundary lint is the boundary leaking) — a residual false positive
// is fixed by renaming toward clarity.
// ===========================================================================

// The single in-code region map: command name → region. Drives BOTH the
// `regions check` COMMANDS-bijection assert and `regions selftest` membership —
// never a second list (this map is also the future package manifest). Membership
// of a command implies membership of its tagged section's internals.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
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
  "audit": "governance",
  // factory — everything else (faff-the-factory's domain)
  "config": "factory",
  "sync": "factory",
  "prepcheck": "factory",
  "intakecheck": "factory",
  "intake-record": "factory",
  "contain": "factory",
  // economics — a reporting CONSUMER of the governance budget helpers (reads the
  // ledger + reuses measureTokens/attemptsFromLedger), not part of the
  // extractable flight-recorder layer → factory (FAFF-357).
  "economics": "factory",
  // quality — the reporting mirror of economics: reads the run ledger + events.jsonl
  // into a QualityReport, touches no producer → factory (FAFF-418).
  "quality": "factory",
  "run-done": "factory",
  "hooks-ensure": "factory",
  "merge-fence": "factory",
  "validate-adapters": "factory",
  "labels": "factory",
  "label": "factory",
  "eligible": "factory",
  "admissible": "factory",
  "dod": "factory",
  "holdout": "factory",
  "spec-review-lenses": "factory",
  "container-check": "factory",
  "corrective-integrity": "factory",
  "next": "factory",
  "project-next": "factory",
  "state": "factory",
  "park-history": "factory",
  "gitignore-ensure": "factory",
  "adr": "factory",
  "prd": "factory",
  "prdr": "factory",
  "profile": "factory",
  "fixtures": "factory",
  "env": "factory",
  "lights-out": "factory",
  "gates": "factory",
  "contract": "factory",
  "models": "factory",
  "doctor": "factory",
  "worktree-prune": "factory",
  "worktree-root": "factory",
  "lint-refs": "factory",
  "lint-cli-doc": "factory",
  "regions": "factory",
  // FAFF-350: merge-gate references factory identifiers (holdoutGateResult, decideFloor,
  // computeReviewVerdict) so it is NOT in the extractable governance layer; branch-protection-check
  // mirrors the factory container-check assert-don't-enforce probe.
  "merge-gate": "factory",
  "branch-protection-check": "factory",
};

// Selftest invocation per member, where it differs from `<cmd> --selftest`:
// a FULL allowlist over REGION_MAP: every command has an explicit entry — an
// argv array to spawn, or null = deliberately no standalone selftest (reported
// `no-selftest`: non-fatal for factory, FATAL for a governance member). A
// REGION_MAP command MISSING here is exit 2 at `regions selftest` (no
// fall-through: a future flag-tolerant command must never be blind-spawned
// with --selftest and execute its real op — `sync` re-links ~/.claude,
// `gitignore-ensure` writes .gitignore; a selftest runner must never mutate
// the host). A stale null (the handler gained a "--selftest" branch nobody
// wired) is also exit 2 — see regionsStaleNulls.
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
  "audit": ["audit", "--selftest"],
  // factory — argv per member; null = deliberately no standalone selftest
  "config": ["config", "init", "--selftest"],
  "sync": null,
  "prepcheck": ["prepcheck", "--selftest"],
  "intakecheck": ["intakecheck", "--selftest"],
  "intake-record": ["intake-record", "--selftest"],
  "contain": ["contain", "--selftest"],
  "economics": ["economics", "--selftest"],
  "quality": ["quality", "--selftest"],
  "run-done": ["run-done", "--selftest"],
  "hooks-ensure": ["hooks-ensure", "--selftest"],
  "merge-fence": ["merge-fence", "--selftest"],
  "validate-adapters": null,
  "labels": null,
  "label": ["label", "--selftest"],
  "eligible": ["eligible", "--selftest"],
  "admissible": ["admissible", "--selftest"],
  "dod": ["dod", "--selftest"],
  "holdout": ["holdout", "--selftest"],
  "spec-review-lenses": ["spec-review-lenses", "--selftest"],
  "container-check": ["container-check", "--selftest"],
  "corrective-integrity": ["corrective-integrity", "--selftest"],
  "next": ["next", "--selftest"],
  "project-next": ["project-next", "--selftest"],
  "state": null,
  "park-history": ["park-history", "--selftest"],
  "gitignore-ensure": null,
  "adr": ["adr", "--selftest"],
  "prd": ["prd", "--selftest"],
  "prdr": ["prdr", "--selftest"],
  "profile": ["profile", "--selftest"],
  "fixtures": ["fixtures", "--selftest"],
  "env": ["env", "--selftest"],
  "lights-out": ["lights-out", "--selftest"],
  "gates": ["gates", "--selftest"],
  "contract": ["contract", "--selftest"],
  "models": ["models", "--selftest"],
  "doctor": null,
  "worktree-prune": ["worktree-prune", "--selftest"],
  "worktree-root": ["worktree-root", "--selftest"],
  "lint-refs": ["lint-refs", "--selftest"],
  "lint-cli-doc": ["lint-cli-doc", "--selftest"],
  "regions": ["regions", "--selftest"],
  "merge-gate": ["merge-gate", "--selftest"],
  "branch-protection-check": ["branch-protection-check", "--selftest"],
};

const REGION_NAMES = new Set(["governance", "factory", "shared-infra", "shell"]);
const REGION_TAG_RE = /^\/\/ === region:([a-z-]+) — (.*) ===$/;
const REGION_DIVIDER_RE = /^\/\/ ={4,}$/;

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

// Parse a source file's section banners into contiguous region spans. A banner
// is a maximal run of `//` comment lines containing >=1 full-width divider
// (`// ====…`); its tag line is `// === region:<name> — <text> ===`. Content
// before the first banner is the require preamble — exempt by construction (it
// defines no region code). Returns { spans, malformed }; line numbers 1-based.
function regionsParseSpans(rawLines) {
  const banners = [];
  const malformed = [];
  let i = 0;
  while (i < rawLines.length) {
    if (!rawLines[i].startsWith("//")) { i++; continue; }
    let j = i, hasDiv = false, tag = null, tagLine = -1;
    while (j < rawLines.length && rawLines[j].startsWith("//")) {
      if (REGION_DIVIDER_RE.test(rawLines[j])) hasDiv = true;
      if (tag === null) {
        const m = rawLines[j].match(REGION_TAG_RE);
        if (m) { tag = m; tagLine = j; }
      }
      j++;
    }
    if (hasDiv) {
      if (!tag) {
        const nameLine = rawLines.slice(i, j).find((l) => !REGION_DIVIDER_RE.test(l)) || rawLines[i];
        malformed.push(`untagged section banner at line ${i + 1}: ${nameLine}`);
      } else if (!REGION_NAMES.has(tag[1])) {
        malformed.push(`unknown region '${tag[1]}' at line ${tagLine + 1} (legal: ${[...REGION_NAMES].join(" | ")})`);
      } else {
        banners.push({ start: i, region: tag[1], name: tag[2] });
      }
    }
    i = j;
  }
  const spans = banners.map((b, k) => ({
    region: b.region,
    name: b.name,
    start: b.start, // 0-based inclusive
    end: k + 1 < banners.length ? banners[k + 1].start - 1 : rawLines.length - 1,
  }));
  return { spans, malformed };
}

// Collect top-level definitions (column-0 `function` / `const` / `let` / `var`)
// per span, from the STRIPPED lines (so template-literal content can never fake
// a definition). Returns [{ name, line (1-based), span }].
//
// Require-preamble exemption (load-bearing): everything before the first banner
// — `fs`/`path`/`os`/`spawnSync`/`HERE` — is destructured/derived require state
// in NO region's definition set, so a reference to it from any span is never a
// violation. That is deliberate: the preamble is the module system, not region
// code.
//
// Property-access-skip soundness (see scanSpan's `before === "."` skip): in a
// single-file CommonJS script, module-scoped top-level bindings are NOT
// reachable via property or computed access (`obj.loadConfig` can only name a
// property on some object, never the top-level `loadConfig` binding), so
// skipping dotted matches cannot hide an in-file cross-region edge. Revisit at
// physical extraction, where exports become properties.
// Module-system names present in EVERY module's require preamble (fs/path/os/
// spawnSync, plus HERE/ENTRYPOINT derived in shared-infra). Post-modularisation
// (FAFF-441) these live inside each file's tagged span rather than a single
// pre-banner preamble, so the collector skips them BY NAME to preserve the original
// require-preamble exemption: they are the module system, not region code, and a
// re-require of `fs` in a factory file and a governance file is not a cross-region
// duplicate. Their references are likewise never region edges (a governance file
// using `fs` is not reaching into factory). Real cross-region require edges are
// still caught — the imported factory identifier is used at call sites the scan sees.
const REQUIRE_PRELUDE = new Set(["fs", "path", "os", "spawnSync", "HERE", "ENTRYPOINT"]);
function regionsCollectDefs(strippedLines, spans) {
  const defs = [];
  for (const span of spans) {
    for (let ln = span.start; ln <= span.end && ln < strippedLines.length; ln++) {
      const m = strippedLines[ln].match(/^(?:async\s+)?(?:function\s+|const\s+|let\s+|var\s+)([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (m && !REQUIRE_PRELUDE.has(m[1])) defs.push({ name: m[1], line: ln + 1, span });
    }
  }
  return defs;
}

// The direction-lint core, factored over a file path so the selftest can drive
// it against synthetic fixtures. Rules: a governance span must not reference a
// factory-span identifier; a shared-infra span must not reference either
// region's. factory and shell spans are unchecked (legal consumers). Returns
// { malformed: [string], violations: [string] }.
// Multi-file direction lint (FAFF-441): parse spans + collect defs PER FILE, union
// the definitions across the whole module set, then run the direction scan on each
// file's spans against the union's forbidden sets — so a governance module that
// destructure-requires a factory identifier is caught at the require line and every
// call site, the same invariant as the pre-split single file. Single-file is the
// one-element case (the fixture selftest drives that via regionsCheckFile below), so
// its output is byte-identical. Returns { malformed: [string], violations: [string] }.
function regionsCheckFiles(filePaths) {
  const malformed = [];
  const perFile = [];   // { spans, strippedLines } per source file
  const defs = [];      // union of top-level defs across all files, each tagged with its span
  const multi = filePaths.length > 1;
  for (const filePath of filePaths) {
    const src = fs.readFileSync(filePath, "utf8");
    const rawLines = src.split("\n");
    const { spans, malformed: mf } = regionsParseSpans(rawLines);
    const tag = multi ? `${path.basename(filePath)}: ` : "";
    for (const m of mf) malformed.push(`${tag}${m}`);
    const strippedLines = regionsStripSource(src).split("\n");
    perFile.push({ spans, strippedLines });
    for (const d of regionsCollectDefs(strippedLines, spans)) defs.push(d);
  }
  if (malformed.length) return { malformed, violations: [] };
  // A top-level name defined in TWO DIFFERENT regions makes reference attribution
  // ambiguous (last-write-wins would mis-blame or false-pass) — malformed-class
  // failure naming both definition sites. Same-region duplicates stay legal.
  const defByName = new Map();
  for (const d of defs) {
    const prev = defByName.get(d.name);
    if (prev && prev.span.region !== d.span.region) {
      malformed.push(
        `cross-region duplicate definition of '${d.name}': line ${prev.line} ` +
        `(${prev.span.region} — ${prev.span.name}) and line ${d.line} (${d.span.region} — ${d.span.name})`);
    }
    if (!prev) defByName.set(d.name, d);
  }
  if (malformed.length) return { malformed, violations: [] };
  const defsByRegion = (regions) => {
    const map = new Map();
    for (const d of defs) if (regions.includes(d.span.region)) map.set(d.name, d);
    return map;
  };
  const violations = [];
  const scanSpan = (span, strippedLines, forbidden) => {
    if (forbidden.size === 0) return;
    const re = new RegExp(`\\b(${[...forbidden.keys()].join("|")})\\b`, "g");
    for (let ln = span.start; ln <= span.end && ln < strippedLines.length; ln++) {
      const line = strippedLines[ln];
      let m;
      while ((m = re.exec(line)) !== null) {
        const before = m.index > 0 ? line[m.index - 1] : "";
        const after = line[m.index + m[0].length] || "";
        if (before === ".") continue;  // property access, not the top-level binding
        if (after === ":") continue;   // object-literal key, not a reference
        const d = forbidden.get(m[0]);
        violations.push(
          `${m[0]} referenced at line ${ln + 1} (${span.region} — ${span.name}) ` +
          `but defined at line ${d.line} (${d.span.region} — ${d.span.name})`);
      }
    }
  };
  const factoryDefs = defsByRegion(["factory"]);
  const regionDefs = defsByRegion(["factory", "governance"]);
  for (const { spans, strippedLines } of perFile) {
    for (const span of spans) {
      if (span.region === "governance") scanSpan(span, strippedLines, factoryDefs);
      else if (span.region === "shared-infra") scanSpan(span, strippedLines, regionDefs);
    }
  }
  return { malformed, violations };
}

// The direction-lint core, factored over a file path so the selftest can drive it
// against synthetic fixtures. The union is the single file (byte-identical to the
// pre-split single-file behaviour).
function regionsCheckFile(filePath) {
  return regionsCheckFiles([filePath]);
}

const regionsExitFor = (res) => (res.malformed.length ? 2 : (res.violations.length ? 1 : 0));

// Fixture-table selftest for the lint core: synthetic files in a tmp dir prove
// clean → 0, a governance→factory reference → 1 naming both ends, an untagged
// banner → 2, and string/comment mentions are ignored. Also pins the
// REGION_MAP ↔ COMMANDS bijection (the single-list invariant).
function regionsSelftest(COMMANDS) {
  const B = "// ==========";
  const mk = (...lns) => lns.join("\n") + "\n";
  const fixtures = {
    "clean": {
      text: mk(
        B, "// === region:shared-infra — helpers ===", B,
        "function sharedHelper() { return 1; }",
        B, "// === region:governance — gov ===", B,
        "function govThing() { return sharedHelper(); }",
        B, "// === region:factory — fact ===", B,
        "const factConst = 2;",
        "function factThing() { return govThing() + sharedHelper() + factConst; }",
        B, "// === region:shell — dispatch ===", B,
        "const SHELL_MAP = { run: factThing, gov: govThing };"),
      wantExit: 0,
    },
    "governance→factory reference": {
      text: mk(
        B, "// === region:governance — gov ===", B,
        "function govThing() { return factThing(); }",
        B, "// === region:factory — fact ===", B,
        "function factThing() { return 2; }"),
      wantExit: 1,
      wantViolation: /factThing referenced at line 4 \(governance — gov\) but defined at line 8 \(factory — fact\)/,
    },
    "shared-infra→governance reference": {
      text: mk(
        B, "// === region:shared-infra — helpers ===", B,
        "function sharedHelper() { return govThing(); }",
        B, "// === region:governance — gov ===", B,
        "function govThing() { return 1; }"),
      wantExit: 1,
      wantViolation: /govThing referenced at line 4 \(shared-infra — helpers\)/,
    },
    "untagged banner": {
      text: mk(
        B, "// === region:factory — fact ===", B,
        "function factThing() { return 2; }",
        B, "// a section with no region tag", B,
        "function mystery() { return 3; }"),
      wantExit: 2,
      wantMalformed: /untagged section banner at line 5/,
    },
    "string/comment mentions ignored": {
      text: mk(
        B, "// === region:governance — gov ===", B,
        'const a = "factThing()";',
        "const b = `factThing`;",
        "// factThing in a line comment",
        "/* factThing in a block comment */",
        "function govThing() { return a + b; }",
        B, "// === region:factory — fact ===", B,
        "function factThing() { return 2; }"),
      wantExit: 0,
    },
    "template interpolation still counts": {
      text: mk(
        B, "// === region:governance — gov ===", B,
        "function govThing() { return `x ${factThing()} y`; }",
        B, "// === region:factory — fact ===", B,
        "function factThing() { return 2; }"),
      wantExit: 1,
      wantViolation: /factThing referenced at line 4/,
    },
    "regex literal cannot hide a reference on its line": {
      text: mk(
        B, "// === region:governance — gov ===", B,
        "function govThing(x) { if (/https:\\/\\//.test(x)) factThing(); return 1; }",
        B, "// === region:factory — fact ===", B,
        "function factThing() { return 2; }"),
      wantExit: 1,
      wantViolation: /factThing referenced at line 4 \(governance — gov\)/,
    },
    "regex literal does not swallow subsequent lines": {
      text: mk(
        B, "// === region:governance — gov ===", B,
        "const starRe = /\\*/;",
        "const slashStarRe = /x\\/*y/;",
        "const classRe = /[/]z/;",
        "function govThing() { return factThing(); }",
        B, "// === region:factory — fact ===", B,
        "function factThing() { return 2; }"),
      wantExit: 1,
      wantViolation: /factThing referenced at line 7 \(governance — gov\)/,
    },
    "cross-region duplicate definition is malformed": {
      text: mk(
        B, "// === region:factory — fact ===", B,
        "function dupThing() { return 1; }",
        B, "// === region:governance — gov ===", B,
        "function dupThing() { return 2; }"),
      wantExit: 2,
      wantMalformed: /cross-region duplicate definition of 'dupThing': line 4 \(factory — fact\) and line 8 \(governance — gov\)/,
    },
    "braces inside strings inside an interpolation": {
      text: mk(
        B, "// === region:governance — gov ===", B,
        'function govThing(x) { return `a ${ x ? "{" : "}" } b ${factThing()} c`; }',
        B, "// === region:factory — fact ===", B,
        "function factThing() { return 2; }"),
      wantExit: 1,
      wantViolation: /factThing referenced at line 4 \(governance — gov\)/,
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
      const p = path.join(tmp, `fixture-${n++}.js`);
      fs.writeFileSync(p, f.text);
      const res = regionsCheckFile(p);
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

function cmdRegions(args, COMMANDS) {
  if (args.includes("--selftest")) return regionsSelftest(COMMANDS);
  const sub = args.find((a) => !a.startsWith("-"));

  if (sub === "list") {
    if (args.includes("--json")) { console.log(JSON.stringify(REGION_MAP)); return 0; }
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
    const res = regionsCheckFiles(regionSources());
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
      process.stderr.write(`faff regions check: ${res.violations.length} direction violation(s) — governance must not reference factory; shared-infra must reference neither region\n`);
      return 1;
    }
    console.log("PASS  regions check: direction invariant holds (governance↛factory, shared-infra↛regions)");
    return 0;
  }

  if (sub === "selftest") {
    const i = args.indexOf("--region");
    return regionsSelftestRun(i !== -1 ? args[i + 1] : null, COMMANDS);
  }

  process.stderr.write("usage: faff regions <list|check|selftest> [--json] [--region governance|factory|all]\n");
  return 2;
}


module.exports = { REGEX_PRECEDING_KEYWORDS, REGION_DIVIDER_RE, REGION_MAP, REGION_NAMES, REGION_SELFTEST_ARGV, REGION_TAG_RE, cmdRegions, regionsCheckFile, regionsCollectDefs, regionsExitFor, regionsFnRange, regionsParseSpans, regionsSelftest, regionsSelftestRun, regionsStaleNulls, regionsStripSource };
