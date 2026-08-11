// ===========================================================================
// === region:factory — harness — FAFF-483: the harness-abstraction seam register ===
//
// Most of faff's harness seams are PROSE, not code, so the abstraction cannot be
// a single function signature. This module is the register: a declared list of
// the seven seams where faff's behaviour depends on which harness it runs under,
// each carrying its binding kind (`code` | `prose` | `unbound`), the disposition
// doc row that classifies it, and the concrete artifact the Claude Code driver
// uses today. `faff harness check` is the falsifiable half — it proves every
// declared binding resolves, and that no unregistered credential-forwarding spawn
// has appeared. It is NOT a general prose-reference checker: its claim is bounded
// to the seven bindings it declares (FAFF-663's drift class is out of scope).
//
// Dependency-free CommonJS. Load-time requires are ONLY ./argv and ./shared-infra;
// anything a sibling module owns is required LAZILY inside the lint, so no
// load-time cycle can form when backends.js starts requiring CURRENT_HARNESS here.
//
// NOTE (FAFF-483 build, 2026-08-11): the disposition inventory FAFF-482 landed at
// docs/reference/architecture/harness-coupling.md, NOT the docs/architecture/…
// path the spec cited (the spec's section-7 rule: a present-but-differently-placed
// deliverable is re-anchored, not parked). The register binds the ACTUAL path; the
// seven doc_row labels resolve verbatim in its `## The seams` slice.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");

// --- Closed enums (fail loud on an unrecognised value, backends.js style) -----

const HARNESS_IDS = ["claude-code", "codex"]; // closed
const BINDING_KINDS = ["code", "prose", "unbound"]; // closed; describes TODAY, not the target

// The single harness value the CLI passes today. Harness identity is OWNED here
// (FAFF-483); backends.js requires and re-exports it unchanged, so every existing
// consumer of `CURRENT_HARNESS` is untouched and no second vocabulary is invented.
const CURRENT_HARNESS = "claude-code";

// The disposition inventory every register seam traces to (FAFF-482).
const DISPOSITION_DOC = "docs/reference/architecture/harness-coupling.md";

const BOUNDED_CLAIM =
  "faff harness check proves the register's SEVEN declared bindings resolve, and " +
  "that no resolvable forwarding spawn is unregistered — nothing wider. It is not " +
  "a general prose-reference checker; an undeclared cross-reference goes on drifting.";

// --- The seam register --------------------------------------------------------
// Seven seams: FAFF-482's five, plus the two committed seams it cross-references.
// Each traces to exactly one bold row label of the disposition inventory's
// `## The seams` table. Code seams name a module + exported symbols; prose seams
// name a file + a verbatim section anchor; the one unbound seam names neither and
// carries an open_question instead.
const REGISTER = [
  {
    id: "subagent-dispatch",
    binding: "code",
    doc_row: "Subagent dispatch",
    driver: {
      "claude-code": { module: "engine", exports: ["runEngineCall", "cmdEngine"] },
    },
  },
  {
    id: "skill-artifact",
    binding: "prose",
    doc_row: "Skills + frontmatter",
    driver: {
      "claude-code": { file: "plugin/skills/faff/SKILL.md", section: "name: faff" },
    },
  },
  {
    id: "headless-session-entry",
    binding: "code",
    doc_row: "Headless session entry",
    driver: {
      "claude-code": { module: "engine-codex", exports: ["runCodexCall"] },
    },
    floor: { requires: "container-confirmed", asserted_by: "container-check" },
    // Declared from the reverse sweep's output over the tree at build time, plus
    // eval/cli-driver.mjs:forwardCredentials by hand — a worked example of the
    // one path a SYNTACTIC sweep cannot see (it copies the OAuth credential file
    // onto disk rather than handing it to a spawn's env). Sites are labelled
    // <file>:<outermost enclosing named function>.
    credential_scope: [
      "plugin/skills/faff/bin/lib/engine-codex.js:runCodexCall",
      "eval/cli-driver.mjs:makeCliDriver",
      "eval/live-driver.mjs:makeLiveModel",
      "eval/cli-driver.mjs:forwardCredentials",
    ],
  },
  {
    id: "concurrent-build-fanout",
    binding: "prose",
    doc_row: "Concurrent build fan-out",
    driver: {
      "claude-code": {
        file: "plugin/skills/faffter-dark-concurrency-parallel/SKILL.md",
        section: "Concurrency cap",
      },
    },
  },
  {
    id: "tracker-access",
    binding: "unbound",
    doc_row: "Tracker MCP access",
    driver: {},
    open_question: "FAFF-479",
  },
  {
    id: "skill-chaining-handoff",
    binding: "prose",
    doc_row: "Skill-to-skill chaining handoff",
    driver: {
      "claude-code": { file: "plugin/skills/faff/SKILL.md", section: "Chaining pattern" },
    },
  },
  {
    id: "session-context-file",
    binding: "prose",
    doc_row: "Session context file",
    driver: {
      "claude-code": { file: "AGENTS.md", section: "Product names" },
    },
  },
];

// --- Structural register validation (closed-enum + shape, fail loud) ----------
// Runs at module load in the style of backends.js's closed enums: a bad harness
// id or a shape that violates a binding-kind constraint is a hard error, never a
// skipped entry.
function validateRegister(register) {
  for (const s of register) {
    if (!BINDING_KINDS.includes(s.binding)) {
      throw new Error(`harness register: seam ${s.id} has unknown binding kind "${s.binding}" — legal: ${BINDING_KINDS.join(" | ")}`);
    }
    for (const h of Object.keys(s.driver || {})) {
      if (!HARNESS_IDS.includes(h)) {
        throw new Error(`harness register: seam ${s.id} declares harness id "${h}" outside HarnessId — legal: ${HARNESS_IDS.join(" | ")}`);
      }
    }
    if (s.binding === "unbound") {
      if (Object.keys(s.driver || {}).length !== 0) {
        throw new Error(`harness register: unbound seam ${s.id} must have an empty driver map`);
      }
      if (!s.open_question) {
        throw new Error(`harness register: unbound seam ${s.id} must carry an open_question`);
      }
    } else {
      if (!s.driver || !s.driver["claude-code"]) {
        throw new Error(`harness register: ${s.binding} seam ${s.id} must contain a "claude-code" driver entry`);
      }
      for (const [h, b] of Object.entries(s.driver)) {
        if (s.binding === "code" && !(Array.isArray(b.exports) && b.exports.length && b.module)) {
          throw new Error(`harness register: code seam ${s.id} driver ${h} must be a CodeBinding (module + non-empty exports)`);
        }
        if (s.binding === "prose" && !(b.file && b.section)) {
          throw new Error(`harness register: prose seam ${s.id} driver ${h} must be a ProseBinding (file + section)`);
        }
      }
    }
  }
  return register;
}
validateRegister(REGISTER);

// ===========================================================================
// Source masking — replace string / template / comment / regex CONTENT with
// spaces (keeping delimiters + newlines + offsets), so brace-matching, call
// detection, env-key detection and function-header detection never false-match
// on text inside a literal. Pure string→string.
// ===========================================================================
function maskSource(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  // Track the previous significant char to disambiguate regex vs division.
  let prevSig = "";
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " "; };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      let j = i + 2; while (j < n && src[j] !== "\n") j++; blank(i + 2, j); i = j; continue;
    }
    if (c === "/" && c2 === "*") {
      let j = i + 2; while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++; blank(i + 2, Math.min(j + 2, n)); i = Math.min(j + 2, n); continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === c) break; j++; } blank(i + 1, j); i = j + 1; prevSig = c; continue;
    }
    if (c === "`") {
      // Mask the whole template literal content, including ${...}, to spaces.
      let j = i + 1; let depth = 0;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "`" && depth === 0) break;
        if (src[j] === "$" && src[j + 1] === "{") { depth++; j += 2; continue; }
        if (src[j] === "}" && depth > 0) { depth--; j++; continue; }
        j++;
      }
      blank(i + 1, j); i = j + 1; prevSig = "`"; continue;
    }
    if (c === "/") {
      // Regex literal iff the previous significant char permits a regex here.
      const regexOk = prevSig === "" || "(,=:[!&|?{};+-*%^~<>".includes(prevSig) || /\breturn$|\btypeof$|\bcase$|\bin$|\bof$|\bdo$|\belse$/.test(_tail(src, i));
      if (regexOk) {
        let j = i + 1; let inClass = false; let ok = false;
        while (j < n) {
          const d = src[j];
          if (d === "\\") { j += 2; continue; }
          if (d === "\n") break;
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) { ok = true; break; }
          j++;
        }
        if (ok) { blank(i + 1, j); i = j + 1; prevSig = "/"; continue; }
      }
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join("");
}
function _tail(src, i) { return src.slice(Math.max(0, i - 8), i); }

// Depth-0 test: is offset `pos` at brace depth 0 in the masked source?
function braceDepthAt(masked, pos) {
  let depth = 0;
  for (let k = 0; k < pos; k++) { const c = masked[k]; if (c === "{") depth++; else if (c === "}") depth--; }
  return depth;
}

// Match a masked `{`…`}` block starting at the opening-brace offset. Returns the
// offset of the matching `}` (exclusive end = that +1), or -1.
function matchBrace(masked, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < masked.length; k++) {
    if (masked[k] === "{") depth++;
    else if (masked[k] === "}") { depth--; if (depth === 0) return k; }
  }
  return -1;
}

// Balanced-paren span from the offset of a `(`; returns [open, close] inclusive.
function matchParen(masked, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < masked.length; k++) {
    if (masked[k] === "(") depth++;
    else if (masked[k] === ")") { depth--; if (depth === 0) return [openIdx, k]; }
  }
  return [openIdx, masked.length - 1];
}

// Enumerate TOP-LEVEL (depth-0) named function spans: { name, start, bodyStart, bodyEnd }.
// Covers `function NAME(`, `export [async] function NAME(`, and
// `const|let|var NAME = [async] (…) => {` / `= function`. The spawn calls this
// register cares about all sit inside such top-level functions, and "outermost
// enclosing named function" is exactly the depth-0 one that contains the call.
function topLevelFunctions(masked) {
  const fns = [];
  const declRe = /(?:^|[^.\w$])(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = declRe.exec(masked))) {
    const nameStart = m.index + m[0].lastIndexOf(m[1]);
    if (braceDepthAt(masked, nameStart) !== 0) continue;
    const parenOpen = masked.indexOf("(", nameStart);
    const [, parenClose] = matchParen(masked, parenOpen);
    const braceOpen = masked.indexOf("{", parenClose);
    if (braceOpen < 0) continue;
    const braceClose = matchBrace(masked, braceOpen);
    if (braceClose < 0) continue;
    fns.push({ name: m[1], start: m.index, bodyStart: braceOpen, bodyEnd: braceClose });
  }
  const assignRe = /(?:^|[^.\w$])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;
  while ((m = assignRe.exec(masked))) {
    const nameIdx = m.index + m[0].indexOf(m[1]);
    if (braceDepthAt(masked, nameIdx) !== 0) continue;
    const braceOpen = masked.indexOf("{", m.index + m[0].length - 1);
    if (braceOpen < 0) continue;
    // Guard: the `{` must be the function body, not e.g. an object being returned
    // on the same line before a block. For arrow/function expressions the body `{`
    // is the first `{` after the `=>`/`function(...)`, which this finds.
    const braceClose = matchBrace(masked, braceOpen);
    if (braceClose < 0) continue;
    fns.push({ name: m[1], start: m.index, bodyStart: braceOpen, bodyEnd: braceClose });
  }
  return fns;
}

function enclosingFunction(fns, offset) {
  let best = null;
  for (const f of fns) {
    if (offset > f.bodyStart && offset < f.bodyEnd) {
      if (!best || f.start < best.start) best = f; // outermost = smallest start
    }
  }
  return best ? best.name : null;
}

const CP_ENTRIES = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"];

// Module-local spawn-family binding set: CP entries the module imports, PLUS
// local bindings/param-defaults initialised to one of them (resolved to a
// fixpoint). Resolution is by BINDING, not by call-site spelling — this is what
// makes runCodexCall's `spawnFn = spawnSync` parameter default visible while a
// name-only matcher would miss it, and what keeps claude-config-isolation.js's
// default-less `spawnFn` OUT (no spawn-family default ⇒ not spawn-family).
function spawnFamilyBindings(masked, raw) {
  const set = new Set();
  // Imported CP entries (require destructuring OR esm import). Detected on the
  // RAW source — the module specifier is a string literal, which masking blanks.
  const src = raw || masked;
  const reqRe = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*["'](?:node:)?child_process["']\s*\)/g;
  const impRe = /import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?child_process["']/g;
  for (const re of [reqRe, impRe]) {
    let m;
    while ((m = re.exec(src))) {
      for (const raw of m[1].split(",")) {
        const nm = raw.split(":").pop().trim().replace(/\s+as\s+.*/, "").trim();
        const asName = raw.includes(" as ") ? raw.split(/\s+as\s+/).pop().trim() : nm;
        if (CP_ENTRIES.includes(nm)) set.add(asName || nm);
      }
    }
  }
  // Aliases + param defaults: NAME = <existing spawn-family binding>. Iterate to
  // a fixpoint so an alias of an alias is caught.
  let grew = true;
  while (grew) {
    grew = false;
    const aliasRe = /([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\b/g;
    let m;
    while ((m = aliasRe.exec(masked))) {
      const lhs = m[1], rhs = m[2];
      if (set.has(rhs) && !set.has(lhs)) { set.add(lhs); grew = true; }
    }
  }
  return set;
}

// Module-level `const NAME = { …string/number literals, no process.env, no spread }`
// names — the constant-env allowlist the sweep resolves an `env: IDENT` against.
function moduleConstEnvNames(masked) {
  const names = new Set();
  const re = /(?:^|[^.\w$])const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(masked))) {
    const nameIdx = m.index + m[0].indexOf(m[1]);
    if (braceDepthAt(masked, nameIdx) !== 0) continue;
    const braceOpen = masked.indexOf("{", m.index + m[0].length - 1);
    const braceClose = matchBrace(masked, braceOpen);
    if (braceClose < 0) continue;
    const body = masked.slice(braceOpen, braceClose + 1);
    if (classifyEnvValue(body) === "constant") names.add(m[1]);
  }
  return names;
}

// Classify an `env` VALUE text (masked; string delimiters preserved) as
// "constant" (a fixed object literal of string/number literals, no process.env,
// no parameter/imported reference) or "forwarding" (anything else, incl. the
// undecidable — fail safe toward forwarding). `constEnvNames` resolves a bare
// identifier value against the module's constant-env allowlist.
function classifyEnvValue(valueText, constEnvNames) {
  const t = valueText.trim();
  if (t === "") return "forwarding";
  if (t[0] === "{") {
    const close = matchBrace(t, 0);
    const inner = close > 0 ? t.slice(1, close) : t.slice(1);
    if (inner.trim() === "") return "constant"; // {}
    if (/process\.env/.test(t) || /\.\.\./.test(t)) return "forwarding";
    for (const pair of splitTopLevelCommas(inner)) {
      const seg = pair.trim();
      if (seg === "") continue;
      const ci = seg.indexOf(":");
      if (ci < 0) return "forwarding"; // shorthand ⇒ a variable
      const v = seg.slice(ci + 1).trim();
      if (!(/^(['"]).*\1$/.test(v) || /^-?\d[\d_.]*$/.test(v))) return "forwarding";
    }
    return "constant";
  }
  const idm = t.match(/^([A-Za-z_$][\w$]*)$/);
  if (idm) return (constEnvNames && constEnvNames.has(idm[1])) ? "constant" : "forwarding";
  return "forwarding";
}

function splitTopLevelCommas(s) {
  const parts = []; let depth = 0; let cur = "";
  for (const ch of s) {
    if ("{[(".includes(ch)) depth++;
    else if ("}])".includes(ch)) depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts;
}

// Find forwarding spawn-family sites in one module's source. Returns
// [{ fn, kind: "forwarding" }]. `rel` labels the file for the caller.
function forwardingSpawnSites(src) {
  const masked = maskSource(src);
  const bindings = spawnFamilyBindings(masked, src);
  if (bindings.size === 0) return [];
  const fns = topLevelFunctions(masked);
  const constEnvNames = moduleConstEnvNames(masked);
  const sites = [];
  for (const name of bindings) {
    const callRe = new RegExp(`(?:^|[^.\\w$])${name.replace(/[$]/g, "\\$")}\\s*\\(`, "g");
    let m;
    while ((m = callRe.exec(masked))) {
      const parenOpen = masked.indexOf("(", m.index);
      const [, parenClose] = matchParen(masked, parenOpen);
      const args = masked.slice(parenOpen + 1, parenClose);
      const envMatch = /[,{]\s*env\s*(:|,|\})/.exec(args);
      if (!envMatch) continue;
      let cls;
      if (envMatch[1] === ":") {
        // Capture the value after `env:` up to the enclosing object's next
        // top-level separator.
        const start = envMatch.index + envMatch[0].length;
        cls = classifyEnvValue(captureEnvValue(args.slice(start)), constEnvNames);
      } else {
        // shorthand `env` ⇒ a variable named env; forwarding unless it is a
        // module-const-env name (it never is in practice — env is a param/derived).
        cls = constEnvNames.has("env") ? "constant" : "forwarding";
      }
      if (cls !== "forwarding") continue;
      const fn = enclosingFunction(fns, parenOpen);
      sites.push({ fn: fn || "(module)" });
    }
  }
  return sites;
}

function captureEnvValue(s) {
  let depth = 0; let out = "";
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if ("{[(".includes(c)) depth++;
    else if ("}])".includes(c)) { if (depth === 0) break; depth--; }
    else if (c === "," && depth === 0) break;
    out += c;
  }
  return out;
}

// ===========================================================================
// The lint. Every dependency is injectable so the selftest exercises every
// finding kind with zero real filesystem / module / network I/O.
// ===========================================================================
const SWEEP_GLOBS = ["plugin/skills/faff/bin/lib", "eval"];

function realDeps(root) {
  return {
    readFile: (rel) => fs.readFileSync(path.join(root, rel), "utf8"),
    requireModule: (mod) => require("./" + mod),
    listSweepFiles: () => {
      const out = [];
      for (const dir of SWEEP_GLOBS) {
        const abs = path.join(root, dir);
        let entries = [];
        try { entries = fs.readdirSync(abs); } catch { continue; }
        for (const f of entries) {
          if (dir.endsWith("lib") ? f.endsWith(".js") : f.endsWith(".mjs")) out.push(path.posix.join(dir, f));
        }
      }
      return out;
    },
    // Never called on the check path (the floor check reads COMMANDS in process,
    // never re-derives a container verdict via a child). Threaded only so the
    // selftest can assert zero invocations.
    spawnFn: () => { throw new Error("harness check must spawn no child process"); },
  };
}

function parseSeamTableRows(docText) {
  // Slice between "## The seams" and the next H2; parse bold first-cell labels
  // of THAT slice only (never the disposition-vocabulary table).
  const lines = docText.split("\n");
  let i = 0;
  while (i < lines.length && !/^##\s+The seams\s*$/.test(lines[i])) i++;
  if (i >= lines.length) return null; // heading absent
  const slice = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) break;
    slice.push(lines[j]);
  }
  const rows = [];
  let sawTable = false;
  for (const line of slice) {
    const m = line.match(/^\|\s*\*\*([^*]+)\*\*/);
    if (m) { rows.push(m[1].trim()); sawTable = true; }
    else if (/^\|/.test(line) && /\|/.test(line.slice(1))) sawTable = sawTable || false;
  }
  if (!sawTable && rows.length === 0) return { rows: [], hasTable: /^\|/m.test(slice.join("\n")) };
  return { rows, hasTable: true };
}

function harnessCheck(opts = {}) {
  const root = opts.root || ".";
  const COMMANDS = opts.COMMANDS || {};
  const deps = Object.assign({}, realDeps(root), opts);
  const register = opts.register || REGISTER;
  const findings = [];

  // Step 2: locate the seam table.
  let docRows = null;
  let docText = null;
  try { docText = deps.readFile(DISPOSITION_DOC); } catch { docText = null; }
  if (docText === null) {
    findings.push({ kind: "seam-table-missing", detail: DISPOSITION_DOC });
  } else {
    const parsed = parseSeamTableRows(docText);
    if (parsed === null || !parsed.hasTable) {
      findings.push({ kind: "seam-table-missing", detail: DISPOSITION_DOC });
    } else {
      docRows = new Set(parsed.rows);
    }
  }

  // Step 3: per-seam binding resolution.
  if (docRows) {
    for (const seam of register) {
      if (!docRows.has(seam.doc_row)) {
        findings.push({ seam: seam.id, kind: "no-doc-row", detail: seam.doc_row });
      }
    }
  }
  for (const seam of register) {
    for (const [, binding] of Object.entries(seam.driver || {})) {
      if (seam.binding === "code") {
        let mod = null;
        try { mod = deps.requireModule(binding.module); } catch { mod = null; }
        if (!mod) { findings.push({ seam: seam.id, kind: "module-missing", detail: binding.module }); continue; }
        for (const name of binding.exports) {
          if (!(name in mod)) findings.push({ seam: seam.id, kind: "export-missing", detail: name });
        }
      } else if (seam.binding === "prose") {
        let text = null;
        try { text = deps.readFile(binding.file); } catch { text = null; }
        if (text === null) findings.push({ seam: seam.id, kind: "file-missing", detail: binding.file });
        else if (!text.includes(binding.section)) findings.push({ seam: seam.id, kind: "section-missing", detail: binding.section });
      }
    }
    // Floor: asserted_by must be a key of COMMANDS (read in process; no spawn).
    if (seam.floor) {
      if (!Object.prototype.hasOwnProperty.call(COMMANDS, seam.floor.asserted_by)) {
        findings.push({ seam: seam.id, kind: "floor-contract-missing", detail: seam.floor.asserted_by });
      }
    }
    // Credential scope, forward direction: each registered site's file + symbol
    // must still exist.
    for (const site of seam.credential_scope || []) {
      const ci = site.lastIndexOf(":");
      const file = site.slice(0, ci);
      const sym = site.slice(ci + 1);
      let text = null;
      try { text = deps.readFile(file); } catch { text = null; }
      if (text === null || !text.includes(sym)) {
        findings.push({ seam: seam.id, kind: "credential-site-missing", detail: site });
      }
    }
  }

  // Step 4: reverse credential sweep.
  const registered = new Set();
  for (const seam of register) for (const s of seam.credential_scope || []) registered.add(s);
  for (const rel of deps.listSweepFiles()) {
    let src = null;
    try { src = deps.readFile(rel); } catch { continue; }
    for (const site of forwardingSpawnSites(src)) {
      const label = `${rel}:${site.fn}`;
      if (!registered.has(label)) findings.push({ kind: "credential-site-unregistered", detail: label });
    }
  }

  // Step 5: informational — seam-table rows with no register seam.
  const informational = [];
  if (docRows) {
    const declared = new Set(register.map((s) => s.doc_row));
    for (const row of docRows) if (!declared.has(row)) informational.push({ kind: "unregistered", detail: row, severity: "informational" });
  }

  const nonInformational = findings.length;
  return { findings, informational, exit: nonInformational ? 1 : 0, bounded_claim: BOUNDED_CLAIM };
}

// --- Register view (faff harness seams) --------------------------------------
function seamsView(register = REGISTER) {
  return register.map((s) => ({
    id: s.id,
    binding: s.binding,
    doc_row: s.doc_row,
    driver: s.driver || {},
    floor: s.floor || null,
    credential_scope: s.credential_scope || null,
    open_question: s.open_question || null,
    driver_side_check: s.binding !== "unbound",
  }));
}

// ===========================================================================
// CLI
// ===========================================================================
const HARNESS_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 },
}, positionals: { min: 0, max: 1, name: "verb" } };
const HARNESS_USAGE = "usage: faff harness <seams|check> [--json] [--root DIR]";

function cmdHarness(args, COMMANDS) {
  if (args.includes("--selftest")) return harnessSelftest();
  const { values, positionals, errors } = parseArgs(args, HARNESS_SPEC);
  if (errors.length) return usageError(errors, HARNESS_USAGE);
  const verb = positionals[0];
  const json = !!values["--json"];
  const root = values["--root"] || findRoot();

  if (verb === "seams") {
    const view = seamsView();
    if (json) { console.log(JSON.stringify({ bounded_claim: BOUNDED_CLAIM, seams: view })); }
    else {
      console.log(BOUNDED_CLAIM);
      for (const s of view) {
        const detail = s.binding === "unbound"
          ? `unbound — no driver-side check (open_question: ${s.open_question})`
          : `${s.binding} → ${Object.keys(s.driver).join(", ")}`;
        console.log(`  ${s.id}  [${s.doc_row}]  ${detail}`);
      }
    }
    return 0;
  }

  if (verb === "check") {
    const res = harnessCheck({ root, COMMANDS: COMMANDS || {} });
    if (json) {
      console.log(JSON.stringify({ bounded_claim: BOUNDED_CLAIM, exit: res.exit, findings: res.findings, informational: res.informational }));
    } else {
      console.log(BOUNDED_CLAIM);
      for (const f of res.findings) console.log(`  ${f.seam ? f.seam + " " : ""}${f.kind}${f.detail ? ": " + f.detail : ""}`);
      for (const f of res.informational) console.log(`  [informational] ${f.kind}: ${f.detail}`);
      console.log(res.exit === 0 ? "ok: every declared binding resolves; no unregistered forwarding spawn" : `FAIL: ${res.findings.length} finding(s)`);
    }
    return res.exit;
  }

  return usageError([`unknown harness verb: ${verb ?? "(none)"}`], HARNESS_USAGE);
}

// ===========================================================================
// Selftest — exercises every finding kind with injected readers, an injected
// module resolver, an injected COMMANDS map and an injected spawn function.
// Zero real filesystem / module / network I/O.
// ===========================================================================
function harnessSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL harness: ${name}`); fail++; } else console.log(`ok   harness: ${name}`); };

  const DOC_OK = [
    "## Disposition vocabulary",
    "| Term | Definition |",
    "| **portable** | works everywhere |",
    "",
    "## The seams",
    "| Seam | Today | Disposition | Evidence |",
    "|---|---|---|---|",
    "| **Subagent dispatch** | x | adapter | y |",
    "| **Skills + frontmatter** | x | portable | y |",
    "| **Headless session entry** | x | adapter | y |",
    "| **Concurrent build fan-out** | x | adapter | y |",
    "| **Tracker MCP access** | x | adapter | y |",
    "| **Skill-to-skill chaining handoff** | x | drop | y |",
    "| **Session context file** | x | adapter | y |",
    "| **Deterministic CLI** | x | portable | y |",
    "",
    "## Next",
  ].join("\n");

  const spawnSpy = { calls: 0 };
  const baseDeps = (over = {}) => Object.assign({
    readFile: (rel) => {
      if (rel === DISPOSITION_DOC) return DOC_OK;
      if (rel === "plugin/skills/faff/SKILL.md") return "---\nname: faff\n---\n## Chaining pattern\n";
      if (rel === "plugin/skills/faffter-dark-concurrency-parallel/SKILL.md") return "## Concurrency cap\n";
      if (rel === "AGENTS.md") return "## Product names\n";
      // Registered credential-scope files (forward-check: the site symbol must appear).
      if (rel === "plugin/skills/faff/bin/lib/engine-codex.js") return "function runCodexCall() {}";
      if (rel === "eval/cli-driver.mjs") return "function makeCliDriver() {} export function forwardCredentials() {}";
      if (rel === "eval/live-driver.mjs") return "function makeLiveModel() {}";
      throw new Error("ENOENT " + rel);
    },
    requireModule: (mod) => {
      if (mod === "engine") return { runEngineCall() {}, cmdEngine() {} };
      if (mod === "engine-codex") return { runCodexCall() {} };
      throw new Error("MODULE_NOT_FOUND " + mod);
    },
    listSweepFiles: () => [],
    spawnFn: () => { spawnSpy.calls++; return {}; },
  }, over);

  const cleanCOMMANDS = { "container-check": () => 0 };

  // 1. All bindings resolve → exit 0, no findings.
  let r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps() });
  ok("clean tree → exit 0, zero findings", r.exit === 0 && r.findings.length === 0);
  ok("clean tree → 'Deterministic CLI' reported informational", r.informational.some((f) => f.kind === "unregistered" && f.detail === "Deterministic CLI"));

  // 2. export-missing.
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    requireModule: (mod) => (mod === "engine" ? { cmdEngine() {} } : { runCodexCall() {} }),
  }) });
  ok("renamed export → export-missing naming runEngineCall, exit 1",
    r.exit === 1 && r.findings.some((f) => f.kind === "export-missing" && f.detail === "runEngineCall"));

  // 3. module-missing.
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    requireModule: (mod) => { if (mod === "engine-codex") return { runCodexCall() {} }; throw new Error("gone"); },
  }) });
  ok("absent module → module-missing, exit 1", r.exit === 1 && r.findings.some((f) => f.kind === "module-missing"));

  // 4. section-missing (prose reword) — and no code-binding finding raised for it.
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    readFile: (rel) => {
      if (rel === DISPOSITION_DOC) return DOC_OK;
      if (rel === "plugin/skills/faff/SKILL.md") return "---\nname: faff\n---\n## Chain handoff\n"; // reworded
      if (rel === "plugin/skills/faffter-dark-concurrency-parallel/SKILL.md") return "## Concurrency cap\n";
      if (rel === "AGENTS.md") return "## Product names\n";
      throw new Error("ENOENT " + rel);
    },
  }) });
  ok("reworded section → section-missing for skill-chaining-handoff, exit 1",
    r.exit === 1 && r.findings.some((f) => f.kind === "section-missing" && f.seam === "skill-chaining-handoff")
    && !r.findings.some((f) => f.seam === "skill-chaining-handoff" && (f.kind === "module-missing" || f.kind === "export-missing")));

  // 5. file-missing.
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    readFile: (rel) => {
      if (rel === DISPOSITION_DOC) return DOC_OK;
      if (rel === "plugin/skills/faff/SKILL.md") return "---\nname: faff\n---\n## Chaining pattern\n";
      if (rel === "AGENTS.md") return "## Product names\n";
      throw new Error("ENOENT " + rel); // concurrency SKILL.md gone
    },
  }) });
  ok("missing prose file → file-missing, exit 1", r.exit === 1 && r.findings.some((f) => f.kind === "file-missing"));

  // 6. no-doc-row (a FAFF-482 row absent).
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    readFile: (rel) => {
      if (rel === DISPOSITION_DOC) return DOC_OK.replace("| **Tracker MCP access** | x | adapter | y |\n", "");
      if (rel === "plugin/skills/faff/SKILL.md") return "---\nname: faff\n---\n## Chaining pattern\n";
      if (rel === "plugin/skills/faffter-dark-concurrency-parallel/SKILL.md") return "## Concurrency cap\n";
      if (rel === "AGENTS.md") return "## Product names\n";
      throw new Error("ENOENT " + rel);
    },
  }) });
  ok("removed seam row → no-doc-row for tracker-access, exit 1",
    r.exit === 1 && r.findings.some((f) => f.kind === "no-doc-row" && f.seam === "tracker-access"));

  // 7. seam-table-missing (heading gone).
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    readFile: (rel) => { if (rel === DISPOSITION_DOC) return "# doc\nno seams heading here\n"; throw new Error("ENOENT " + rel); },
  }) });
  ok("no '## The seams' heading → seam-table-missing, exit 1", r.exit === 1 && r.findings.some((f) => f.kind === "seam-table-missing"));

  // 8. collision — a disposition-vocab label equal to a doc_row must NOT satisfy it.
  const collideDoc = [
    "## Disposition vocabulary",
    "| **Tracker MCP access** | not the real row |", // collision in the WRONG table
    "## The seams",
    "| Seam | x |", "|---|---|",
    "| **Subagent dispatch** | x |",
    "| **Skills + frontmatter** | x |",
    "| **Headless session entry** | x |",
    "| **Concurrent build fan-out** | x |",
    "| **Skill-to-skill chaining handoff** | x |",
    "| **Session context file** | x |",
    "## Next",
  ].join("\n");
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    readFile: (rel) => {
      if (rel === DISPOSITION_DOC) return collideDoc;
      if (rel === "plugin/skills/faff/SKILL.md") return "---\nname: faff\n---\n## Chaining pattern\n";
      if (rel === "plugin/skills/faffter-dark-concurrency-parallel/SKILL.md") return "## Concurrency cap\n";
      if (rel === "AGENTS.md") return "## Product names\n";
      throw new Error("ENOENT " + rel);
    },
  }) });
  ok("vocab-table label collision → still no-doc-row for tracker-access",
    r.findings.some((f) => f.kind === "no-doc-row" && f.seam === "tracker-access"));

  // 9. floor-contract-missing.
  r = harnessCheck({ root: ".", COMMANDS: {}, register: REGISTER, ...baseDeps() });
  ok("floor contract not in COMMANDS → floor-contract-missing, exit 1",
    r.exit === 1 && r.findings.some((f) => f.kind === "floor-contract-missing"));

  // 10. reverse sweep — a NEW forwarding spawn via a parameter default (spawnFn =
  // spawnSync) forwarding process.env, in no credential_scope → unregistered.
  const NEWMOD = [
    'const { spawnSync } = require("node:child_process");',
    "function doThing(spawnFn = spawnSync) {",
    '  return spawnFn("x", [], { env: process.env });',
    "}",
  ].join("\n");
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    listSweepFiles: () => ["plugin/skills/faff/bin/lib/newmod.js"],
    readFile: (rel) => {
      if (rel === "plugin/skills/faff/bin/lib/newmod.js") return NEWMOD;
      return baseDeps().readFile(rel);
    },
  }) });
  ok("new forwarding spawn (param-default callee) → credential-site-unregistered naming file:fn",
    r.exit === 1 && r.findings.some((f) => f.kind === "credential-site-unregistered" && f.detail === "plugin/skills/faff/bin/lib/newmod.js:doThing"));

  // 11. constant sanitized-env spawn raises NO finding (the hasher shape).
  const HASHER = [
    'const { spawnSync } = require("node:child_process");',
    'const SANITIZED_ENV = { PATH: "/usr/bin:/bin" };',
    "function sha256(bytes) {",
    '  return spawnSync("shasum", ["-a", "256"], { input: bytes, env: SANITIZED_ENV });',
    "}",
  ].join("\n");
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    listSweepFiles: () => ["plugin/skills/faff/bin/lib/hasher.js"],
    readFile: (rel) => {
      if (rel === "plugin/skills/faff/bin/lib/hasher.js") return HASHER;
      return baseDeps().readFile(rel);
    },
  }) });
  ok("sanitized-env spawn (module const literal) → no finding, exit 0",
    r.exit === 0 && !r.findings.some((f) => f.kind === "credential-site-unregistered"));

  // 12. an env value the classifier cannot resolve → forwarding (reported).
  const COMPUTED = [
    'const { spawnSync } = require("node:child_process");',
    "function run(base) {",
    '  return spawnSync("x", [], { env: Object.assign({}, base) });',
    "}",
  ].join("\n");
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    listSweepFiles: () => ["plugin/skills/faff/bin/lib/computed.js"],
    readFile: (rel) => {
      if (rel === "plugin/skills/faff/bin/lib/computed.js") return COMPUTED;
      return baseDeps().readFile(rel);
    },
  }) });
  ok("undecidable env (computed) → treated as forwarding, reported",
    r.exit === 1 && r.findings.some((f) => f.kind === "credential-site-unregistered" && f.detail.endsWith(":run")));

  // 13. a default-less injected spawnFn is NOT spawn-family (claude-config-isolation shape).
  const INJECTED = [
    "async function withIsolated(spawnFn, opts = {}) {",
    "  const env = { CLAUDE_CONFIG_DIR: opts.dir };",
    "  return await spawnFn({ env, cwd: opts.dir });",
    "}",
  ].join("\n");
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    listSweepFiles: () => ["plugin/skills/faff/bin/lib/injected.js"],
    readFile: (rel) => {
      if (rel === "plugin/skills/faff/bin/lib/injected.js") return INJECTED;
      return baseDeps().readFile(rel);
    },
  }) });
  ok("default-less injected spawnFn is not spawn-family → no finding",
    r.exit === 0 && !r.findings.some((f) => f.kind === "credential-site-unregistered"));

  // 14. credential-site-missing (a registered site's symbol disappears).
  r = harnessCheck({ root: ".", COMMANDS: cleanCOMMANDS, register: REGISTER, ...baseDeps({
    readFile: (rel) => {
      if (rel === DISPOSITION_DOC) return DOC_OK;
      if (rel === "plugin/skills/faff/SKILL.md") return "---\nname: faff\n---\n## Chaining pattern\n";
      if (rel === "plugin/skills/faffter-dark-concurrency-parallel/SKILL.md") return "## Concurrency cap\n";
      if (rel === "AGENTS.md") return "## Product names\n";
      if (rel === "plugin/skills/faff/bin/lib/engine-codex.js") return "// the symbol was renamed away\n";
      if (rel === "eval/cli-driver.mjs") return "makeCliDriver forwardCredentials";
      if (rel === "eval/live-driver.mjs") return "makeLiveModel";
      throw new Error("ENOENT " + rel);
    },
  }) });
  ok("registered credential site symbol gone → credential-site-missing, exit 1",
    r.exit === 1 && r.findings.some((f) => f.kind === "credential-site-missing"));

  // 15. closed-enum: an unknown harness id in a register is a hard load error.
  let threw = false;
  try { validateRegister([{ id: "x", binding: "code", doc_row: "d", driver: { "borg": { module: "m", exports: ["e"] } } }]); }
  catch { threw = true; }
  ok("unknown harness id → hard error (closed enum)", threw);

  // 16. closed-enum: an unbound seam with a non-empty driver / no open_question is a hard error.
  threw = false;
  try { validateRegister([{ id: "x", binding: "unbound", doc_row: "d", driver: { "claude-code": {} }, open_question: "Q" }]); }
  catch { threw = true; }
  ok("unbound seam with non-empty driver → hard error", threw);
  threw = false;
  try { validateRegister([{ id: "x", binding: "unbound", doc_row: "d", driver: {} }]); }
  catch { threw = true; }
  ok("unbound seam with no open_question → hard error", threw);

  // 17. the real register: tracker-access is unbound, empty driver, open_question FAFF-479.
  const tracker = REGISTER.find((s) => s.id === "tracker-access");
  ok("tracker-access is unbound / empty driver / open_question FAFF-479",
    tracker.binding === "unbound" && Object.keys(tracker.driver).length === 0 && tracker.open_question === "FAFF-479");
  ok("register declares exactly the seven named seams", REGISTER.length === 7);

  // 18. no child process spawned across the whole selftest's check runs.
  ok("harness check spawned zero child processes", spawnSpy.calls === 0);

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  HARNESS_IDS, BINDING_KINDS, CURRENT_HARNESS, DISPOSITION_DOC, REGISTER, BOUNDED_CLAIM,
  validateRegister, harnessCheck, seamsView, cmdHarness, harnessSelftest,
  maskSource, spawnFamilyBindings, forwardingSpawnSites, classifyEnvValue, parseSeamTableRows,
};
