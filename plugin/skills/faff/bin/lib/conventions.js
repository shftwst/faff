// ===========================================================================
// === region:factory — conventions — FAFF-1041: repo-convention discovery ===
//   conventions mine [--json] [--root DIR]   deterministic, read-only. Scans standards docs
//                                             then git history; emits ONE faff-contract:conventions
//                                             block (--json: raw JSON). No network/install/subprocess
//                                             beyond `git`; writes no files.
//   conventions get <key> [-d DEFAULT] [--json]   resolve ONE convention with full precedence.
//                                             Always exits 0 with a value — the default is the floor.
//   conventions show                         print the effective ConventionSet
//                                             (.faff/conventions.json ⊕ .faffrc conventions:);
//                                             exit 3 when never mined and no override configured.
// Branch naming, commit-subject grammar, and PR-title grammar — instead of hardcoding faff's own
// opinions. Third leaf of faff's "repo archaeology" family beside profile.js (infra) and gates.js (CI
// gates) — see ADR 0128/0129. Precedence: explicit config > standards doc > a CI gate that
// already enforces the convention > history-inferred (above a dominance threshold) > faff
// default. Never adopts a guessed convention: below the dominance threshold (or below the
// sample floor, or when git history is unreadable) resolution falls to the default with
// confidence "low" — an adopter repo is never worse off than today's hardcoded behaviour.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { loadConfig } = require("./config");
const { parseArgs, usageError } = require("./argv");
const { dig, findRoot } = require("./shared-infra");

const CONVENTIONS_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 }, "--default": { arity: 1, aliases: ["-d"] } }, positionals: { min: 0, max: null, name: "verb key" } };
const CONVENTIONS_SURFACE = {
  kind: "subcommand_dispatch",
  spec: CONVENTIONS_SPEC,
  subcommands: {
    mine: { required_flags: [] },
    get: { required_flags: [] },
    show: { required_flags: [] },
  },
};

const CONVENTIONS_FENCE_OPEN = "```faff-contract:conventions";
const CONVENTIONS_FENCE_CLOSE = "```";

const CONVENTIONS_KEYS = ["branch_naming", "commit_subject", "pr_title"];
const CONVENTIONS_DEFAULTS = { branch_naming: "issue-slug", commit_subject: "conventional", pr_title: "conventional" };
const CONVENTIONS_VOCAB = {
  branch_naming: ["issue-slug", "slash-scoped", "tracker-hint"],
  commit_subject: ["conventional", "bare-imperative"],
  pr_title: ["conventional", "bare-imperative"],
};

const DEFAULT_HISTORY_WINDOW = 200;
const DEFAULT_HISTORY_DOMINANCE = 0.7;
const HISTORY_SAMPLE_FLOOR = 20;   // below this many classifiable samples, inference never adopts

function conventionsSafeRead(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }
function conventionsIsFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

// ---------------------------------------------------------------------------
// Standards-doc walk — fixed scan order (spec §4): CONTRIBUTING*, AGENTS.md, CONVENTIONS*,
// .github/PULL_REQUEST_TEMPLATE*, .github/*commit*, docs/**/{contributing,style}*. Read-only,
// bounded, deterministic (alphabetic within each group so the same repo always scans the
// same order). First confident hit (across the WHOLE ordered list) wins for a given key.
// ---------------------------------------------------------------------------

function listRootMatches(root, re) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isFile() && re.test(e.name)).map((e) => e.name).sort();
}

function listDirMatches(root, sub, re) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, sub), { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isFile() && re.test(e.name)).map((e) => path.join(sub, e.name).split(path.sep).join("/")).sort();
}

// Bounded walk of docs/ for a file whose basename (no extension) starts with contributing|style.
function walkDocsForNames(root, re) {
  const out = [];
  const stack = [path.join(root, "docs")];
  let budget = 5000;
  while (stack.length && budget-- > 0) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));   // reverse so the stack pops alphabetically
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && re.test(path.parse(e.name).name)) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return out.sort();
}

function findStandardsDocs(root) {
  const found = [];
  for (const rel of listRootMatches(root, /^CONTRIBUTING(\.|$)/i)) found.push(rel);
  if (conventionsIsFile(path.join(root, "AGENTS.md"))) found.push("AGENTS.md");
  for (const rel of listRootMatches(root, /^CONVENTIONS(\.|$)/i)) found.push(rel);
  for (const rel of listDirMatches(root, ".github", /^PULL_REQUEST_TEMPLATE/i)) found.push(rel);
  for (const rel of listDirMatches(root, ".github", /commit/i)) found.push(rel);
  for (const rel of walkDocsForNames(root, /^(contributing|style)/i)) found.push(rel);
  return [...new Set(found)];
}

// Every occurrence of "conventional commit(s)" / a bare-imperative synonym, tagged by the scope
// its OWN enclosing sentence states — "pr title" or "commit message" — so a doc that documents
// ONLY the PR title (this repo's own CONTRIBUTING.md: "Conventional Commit PR title.** The
// repository squash-merges with the PR title as the … commit subject …") never gets misread as
// also documenting commit-subject grammar just because a later sentence happens to mention
// "commit subject" descriptively. Sentence-scoped, not a fixed character window, so it isn't
// sensitive to prose length on either side. A sentence matching BOTH scopes (or neither)
// contributes no signal (conservative — never adopt an ambiguous statement).
const DOC_VALUE_PATTERNS = [
  { value: "conventional", re: /conventional\s+commits?/gi },
  { value: "bare-imperative", re: /\b(bare[\s-]?imperative|no\s+type\s+prefix|plain\s+imperative(?:\s+commits?)?)\b/gi },
];
const DOC_PR_TITLE_SCOPE_RE = /\bpr\s*-?\s*titles?\b|pull\s+request\s+titles?/i;
const DOC_COMMIT_SUBJECT_SCOPE_RE = /\bcommit\s+(messages?|subjects?)\b/i;

// Split into sentence-ish chunks: a blank/newline boundary, or a `.`/`!`/`?` followed by
// (optional markdown bold/italic close markers, then) whitespace. Tolerates a markdown heading
// like `**Conventional Commit PR title.**` where the period is followed by `**` before the
// space — a fixed-width character window can't reliably separate that from the next sentence.
function splitDocSentences(text) {
  return text.split(/\n+|[.!?][*_]*\s+/).map((s) => s.trim()).filter(Boolean);
}

function scopedDocStatements(text) {
  const out = [];
  for (const sentence of splitDocSentences(text)) {
    const isPrTitle = DOC_PR_TITLE_SCOPE_RE.test(sentence);
    const isCommitSubject = DOC_COMMIT_SUBJECT_SCOPE_RE.test(sentence);
    const scope = isPrTitle && !isCommitSubject ? "pr_title" : (isCommitSubject && !isPrTitle ? "commit_subject" : null);
    if (!scope) continue;   // both or neither scope keyword present -> ambiguous scope, no signal
    for (const { value, re } of DOC_VALUE_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(sentence)) out.push({ scope, value });
    }
  }
  return out;
}

const DOC_BRANCH_SCOPE_RE = /\bbranch(?:es)?(?:\s+nam\w*)?\b/i;
const DOC_BRANCH_SLASH_RE = /\b(feature|bugfix|hotfix|chore)\//i;
const DOC_BRANCH_ISSUE_SLUG_RE = /<issue>-<slug>|issue-slug/i;

function matchBranchNamingDoc(text) {
  if (!DOC_BRANCH_SCOPE_RE.test(text)) return null;
  const hasSlash = DOC_BRANCH_SLASH_RE.test(text);
  const hasIssueSlug = DOC_BRANCH_ISSUE_SLUG_RE.test(text);
  if (hasSlash && hasIssueSlug) return "ambiguous";
  if (hasSlash) return "slash-scoped";
  if (hasIssueSlug) return "issue-slug";
  return null;
}

// Returns "ambiguous" (conflicting statements in this file — treat as no-signal, keep scanning),
// a scheme token, or null (no statement of this key in this file).
function matchDocForKey(text, key) {
  if (key === "branch_naming") return matchBranchNamingDoc(text);
  const stmts = scopedDocStatements(text).filter((s) => s.scope === key);
  if (!stmts.length) return null;
  const values = new Set(stmts.map((s) => s.value));
  return values.size > 1 ? "ambiguous" : [...values][0];
}

// First confident hit across the fixed-order candidate list wins; a file with no statement, or
// an ambiguous one, is skipped (never adopted) and scanning continues.
function scanDocs(root, key) {
  for (const rel of findStandardsDocs(root)) {
    const text = conventionsSafeRead(path.join(root, rel));
    if (!text) continue;
    const hit = matchDocForKey(text, key);
    if (!hit || hit === "ambiguous") continue;
    return { value: hit, evidence: { kind: "doc-file", ref: rel, detail: `${rel} states ${key} = ${hit}` } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gate-vs-style boundary (spec §1 "Stylistic opinion is not a CI gate"): a CI-enforced
// commit-message/PR-title check is authoritative and must never be overridden by history
// inference. A recognised gate-action signature in a committed workflow is stronger evidence
// than an inferred pattern (though weaker than an explicit human statement in a standards
// doc), so it sits between the documented and inferred tiers.
// ---------------------------------------------------------------------------
const GATE_SIGNALS = {
  commit_subject: [/commitlint/i, /conventional-changelog/i, /commit-check/i],
  pr_title: [/semantic-pull-request/i, /amannn\/action-semantic-pull-request/i, /commitlint/i],
};

function detectGateFixedValue(root, key) {
  const signals = GATE_SIGNALS[key];
  if (!signals) return null;
  const wfDir = path.join(root, ".github", "workflows");
  let files;
  try { files = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/i.test(f)).sort(); } catch { return null; }
  for (const f of files) {
    const text = conventionsSafeRead(path.join(wfDir, f));
    if (!text) continue;
    if (signals.some((re) => re.test(text))) {
      const ref = `.github/workflows/${f}`;
      return { value: "conventional", evidence: { kind: "doc-file", ref, detail: `${ref} runs a discovered CI gate enforcing Conventional-Commits grammar — the gate is authoritative, never overridden by history` } };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// History study (spec §4 PROCEDURE infer). Read-only `git` subprocess calls (constraint: no
// network/install — `git log`/`git for-each-ref` are local, read-only). Any failure (not a
// git repo, no history, `git` unavailable) is swallowed to an empty sample set, which the
// caller treats identically to "below the sample floor" — never a crash.
// ---------------------------------------------------------------------------

function safeGit(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function readGitLogSubjects(root, n) {
  return safeGit(root, ["log", "--format=%s", "-n", String(n)]).split("\n").filter((s) => s.trim() !== "");
}

function readBranchNames(root) {
  return safeGit(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).split("\n").filter((s) => s.trim() !== "");
}

// Known faff/Conventional-Commits types only (precision over recall) — an arbitrary
// "Note: something" subject must never misclassify as "conventional".
const CONVENTIONAL_TYPE_RE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w.\/-]+\))?!?:\s+\S/;
function classifyCommitSubject(subject) {
  return CONVENTIONAL_TYPE_RE.test(String(subject).trim()) ? "conventional" : "bare-imperative";
}

const SLASH_SCOPED_BRANCH_RE = /^[a-z][a-z0-9]*\/[a-z0-9][a-z0-9._-]*$/i;
const ISSUE_SLUG_BRANCH_RE = /^[a-z][a-z0-9]*-\d+-[a-z0-9-]+$/i;
// Unclassifiable branch names (main/master/HEAD/etc.) return null — excluded from the sample,
// never counted against either scheme.
function classifyBranchName(name) {
  if (SLASH_SCOPED_BRANCH_RE.test(name)) return "slash-scoped";
  if (ISSUE_SLUG_BRANCH_RE.test(name)) return "issue-slug";
  return null;
}

// Pure over an already-collected sample array — the seam a selftest exercises directly without
// needing a real git repo for every threshold case.
function dominantScheme(samples, historyDominance) {
  const total = samples.length;
  if (total < HISTORY_SAMPLE_FLOOR) return null;
  const counts = {};
  for (const s of samples) counts[s] = (counts[s] || 0) + 1;
  let winner = null;
  let winnerCount = 0;
  for (const [k, c] of Object.entries(counts)) { if (c > winnerCount) { winner = k; winnerCount = c; } }
  const share = winnerCount / total;
  if (share < historyDominance) return null;
  const confidence = share >= 0.85 ? "high" : "medium";
  return { value: winner, confidence, count: winnerCount, total, share };
}

function inferConvention(root, key, historyWindow, historyDominance) {
  const samples = key === "branch_naming"
    ? readBranchNames(root).map(classifyBranchName).filter(Boolean)
    : readGitLogSubjects(root, historyWindow).map(classifyCommitSubject);
  const dom = dominantScheme(samples, historyDominance);
  if (!dom) return null;
  const ref = key === "branch_naming" ? "git-for-each-ref:refs/heads" : `git-log:last-${dom.total}`;
  const detail = `history: ${dom.count}/${dom.total} (${dom.share.toFixed(2)})`;
  return { value: dom.value, confidence: dom.confidence, evidence: { kind: "history", ref, detail } };
}

// ---------------------------------------------------------------------------
// Resolution — precedence-ordered (spec §4 PROCEDURE resolve): explicit config > documented >
// a discovered CI gate > history-inferred > faff default. `dig` is a raw, DEFAULTS-blind
// config read (undefined stays undefined regardless of config.js's DEFAULTS registry), which
// is exactly what tier-1 needs: a key that is genuinely UNSET in .faffrc must fall through to
// tier 2, never read back as "explicitly set to the default value".
// ---------------------------------------------------------------------------

function historyKnobs(cfg) {
  const w = Number(dig(cfg, "conventions.history_window"));
  const d = Number(dig(cfg, "conventions.history_dominance"));
  return {
    historyWindow: Number.isFinite(w) && w > 0 ? w : DEFAULT_HISTORY_WINDOW,
    historyDominance: Number.isFinite(d) && d >= 0 && d <= 1 ? d : DEFAULT_HISTORY_DOMINANCE,
  };
}

// Resolves ONE key against a fixed default value (used for branch_naming and — as the base
// resolution pr_title mirrors when it carries no signal of its own — commit_subject).
function resolveConventionCore(root, key, cfg, fallbackDefault) {
  const explicit = dig(cfg, `conventions.${key}`);
  if (explicit !== null && explicit !== undefined && String(explicit).trim() !== "") {
    const v = String(explicit).trim();
    if (CONVENTIONS_VOCAB[key].includes(v)) {
      return { key, value: v, source: "explicit", confidence: "high", evidence: [{ kind: "config-key", ref: `.faffrc:conventions.${key}`, detail: `explicit override: ${v}` }] };
    }
    // out-of-vocabulary explicit value -> no signal from this tier, never invent a token; fall through
  }

  const docHit = scanDocs(root, key);
  if (docHit && CONVENTIONS_VOCAB[key].includes(docHit.value)) {
    return { key, value: docHit.value, source: "documented", confidence: "high", evidence: [docHit.evidence] };
  }

  const gateHit = detectGateFixedValue(root, key);
  if (gateHit && CONVENTIONS_VOCAB[key].includes(gateHit.value)) {
    return { key, value: gateHit.value, source: "documented", confidence: "high", evidence: [gateHit.evidence] };
  }

  const { historyWindow, historyDominance } = historyKnobs(cfg);
  const inferred = inferConvention(root, key, historyWindow, historyDominance);
  if (inferred && CONVENTIONS_VOCAB[key].includes(inferred.value)) {
    return { key, value: inferred.value, source: "inferred", confidence: inferred.confidence, evidence: [inferred.evidence] };
  }

  return { key, value: fallbackDefault, source: "default", confidence: "low", evidence: [] };
}

// pr_title's OWN default tier is not a fixed literal — it mirrors whatever commit_subject
// resolved to (spec: "pr_title … derived: mirrors commit_subject grammar unless a doc says
// otherwise"). Its explicit/documented/gate tiers are independent of commit_subject's (this
// repo's own CONTRIBUTING.md documents ONLY the PR title, never the raw commit subject).
function resolvePrTitle(root, cfg, commitSubjectResult) {
  const explicit = dig(cfg, "conventions.pr_title");
  if (explicit !== null && explicit !== undefined && String(explicit).trim() !== "") {
    const v = String(explicit).trim();
    if (CONVENTIONS_VOCAB.pr_title.includes(v)) {
      return { key: "pr_title", value: v, source: "explicit", confidence: "high", evidence: [{ kind: "config-key", ref: ".faffrc:conventions.pr_title", detail: `explicit override: ${v}` }] };
    }
  }
  const docHit = scanDocs(root, "pr_title");
  if (docHit && CONVENTIONS_VOCAB.pr_title.includes(docHit.value)) {
    return { key: "pr_title", value: docHit.value, source: "documented", confidence: "high", evidence: [docHit.evidence] };
  }
  const gateHit = detectGateFixedValue(root, "pr_title");
  if (gateHit && CONVENTIONS_VOCAB.pr_title.includes(gateHit.value)) {
    return { key: "pr_title", value: gateHit.value, source: "documented", confidence: "high", evidence: [gateHit.evidence] };
  }
  // No pr_title-specific signal -> mirror commit_subject's own resolved value verbatim,
  // including its source/confidence, so pr_title never claims stronger evidence than what it
  // actually rode in on.
  const mirrorEvidence = commitSubjectResult.evidence.length
    ? [{ kind: commitSubjectResult.evidence[0].kind, ref: commitSubjectResult.evidence[0].ref, detail: `mirrors commit_subject (${commitSubjectResult.source}): ${commitSubjectResult.value}` }]
    : [];
  return { key: "pr_title", value: commitSubjectResult.value, source: commitSubjectResult.source, confidence: commitSubjectResult.confidence, evidence: mirrorEvidence };
}

function resolveConvention(root, key, cfg) {
  if (key === "pr_title") {
    const commitSubjectResult = resolveConventionCore(root, "commit_subject", cfg, CONVENTIONS_DEFAULTS.commit_subject);
    return resolvePrTitle(root, cfg, commitSubjectResult);
  }
  return resolveConventionCore(root, key, cfg, CONVENTIONS_DEFAULTS[key]);
}

// Pure, deterministic, read-only mine — the default `conventions` acquirer. Writes no files;
// the orchestrator (faff-graft) validates the emitted block and persists .faff/conventions.json.
function mineConventions(root, cfg) {
  const set = { schema: 1, generated_at: new Date().toISOString() };
  for (const key of CONVENTIONS_KEYS) set[key] = resolveConvention(root, key, cfg);
  return set;
}

// ---------------------------------------------------------------------------
// Validation — pure, mirrors profile.js's validateProfile shape.
// ---------------------------------------------------------------------------
const CONVENTIONS_EVIDENCE_KINDS = ["config-key", "doc-file", "history"];
const CONVENTIONS_SOURCES = ["explicit", "documented", "inferred", "default"];
const CONVENTIONS_CONFIDENCES = ["high", "medium", "low"];

function validateConventionSet(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return ["conventions record must be a JSON object"];
  const v = [];
  if (obj.schema !== 1) v.push("schema must be 1");
  if (!obj.generated_at) v.push("missing required field: generated_at");
  for (const key of CONVENTIONS_KEYS) {
    const conv = obj[key];
    if (conv === undefined) { v.push(`missing convention: ${key}`); continue; }
    if (conv === null || typeof conv !== "object" || Array.isArray(conv)) { v.push(`${key} must be an object`); continue; }
    if (conv.key !== key) v.push(`${key}.key must equal '${key}'`);
    if (!CONVENTIONS_VOCAB[key] || !CONVENTIONS_VOCAB[key].includes(conv.value)) v.push(`${key}.value '${conv.value}' is not in the ${key} vocabulary`);
    if (!CONVENTIONS_SOURCES.includes(conv.source)) v.push(`${key}.source must be one of ${CONVENTIONS_SOURCES.join("|")}`);
    if (!CONVENTIONS_CONFIDENCES.includes(conv.confidence)) v.push(`${key}.confidence must be one of ${CONVENTIONS_CONFIDENCES.join("|")}`);
    if (conv.source === "default" && conv.confidence !== "low") v.push(`${key}: source 'default' must carry confidence 'low'`);
    if (conv.source !== "default" && (!Array.isArray(conv.evidence) || conv.evidence.length === 0)) v.push(`${key}: non-default source '${conv.source}' must cite evidence`);
    if (Array.isArray(conv.evidence)) {
      conv.evidence.forEach((e, i) => {
        if (e === null || typeof e !== "object" || Array.isArray(e)) { v.push(`${key}.evidence[${i}] must be an object`); return; }
        if (!CONVENTIONS_EVIDENCE_KINDS.includes(e.kind)) v.push(`${key}.evidence[${i}].kind must be one of ${CONVENTIONS_EVIDENCE_KINDS.join("|")}`);
        if (!e.ref || String(e.ref).trim() === "") v.push(`${key}.evidence[${i}] missing ref`);
      });
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------
function cmdConventions(args) {
  const gate = parseArgs(args, CONVENTIONS_SPEC);
  if (gate.errors.length) return usageError(gate.errors, "usage: faff conventions <mine|get|show> [<key>] [-d DEFAULT] [--json] [--root DIR]");
  let root = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") { root = args[++i]; continue; }
    if (args[i] === "-d" || args[i] === "--default") { i++; continue; }   // consumed via parsed values below
    rest.push(args[i]);
  }
  root = root || findRoot();
  const cmd = rest[0];

  if (cmd === "--selftest" || rest.includes("--selftest")) return conventionsSelftest();

  const loadCfg = () => {
    try { return loadConfig(root)[0]; }
    catch (e) {
      if (e.message === "legacy-config-name" || e.message === "multiple-config") { process.stderr.write(`faff conventions: ${e.message}\n`); return null; }
      throw e;
    }
  };

  if (cmd === "mine") {
    const cfg = loadCfg();
    if (cfg === null) return 2;
    const set = mineConventions(root, cfg);
    const json = JSON.stringify(set, null, 2);
    if (rest.includes("--json")) { console.log(json); return 0; }
    console.log(CONVENTIONS_FENCE_OPEN);
    console.log(json);
    console.log(CONVENTIONS_FENCE_CLOSE);
    return 0;
  }

  if (cmd === "get") {
    const key = rest[1];
    if (!key || !CONVENTIONS_KEYS.includes(key)) { process.stderr.write(`faff conventions get: <key> must be one of ${CONVENTIONS_KEYS.join("|")}\n`); return 2; }
    const cfg = loadCfg();
    if (cfg === null) return 2;
    const resolved = resolveConvention(root, key, cfg);
    // exit 0 always resolves — the default IS the floor, so `get` never fails for "unset".
    // -d/--default (when given AND resolution genuinely fell to the "default" tier) overrides
    // the vocabulary default with the caller-supplied one — parity with `config get -d`.
    const gd = parseArgs(args, CONVENTIONS_SPEC).values["--default"];
    if (resolved.source === "default" && gd !== undefined) resolved.value = gd;
    if (rest.includes("--json")) { console.log(JSON.stringify(resolved)); return 0; }
    console.log(resolved.value);
    return 0;
  }

  if (cmd === "show") {
    const cachePath = path.join(root, ".faff", "conventions.json");
    let stored = null;
    if (fs.existsSync(cachePath)) {
      try { stored = JSON.parse(fs.readFileSync(cachePath, "utf8")); }
      catch { process.stderr.write("faff conventions show: malformed .faff/conventions.json (invalid JSON)\n"); return 2; }
    }
    const cfg = loadCfg();
    if (cfg === null) return 2;
    const overrideBlock = dig(cfg, "conventions");
    const hasOverride = overrideBlock && typeof overrideBlock === "object" && !Array.isArray(overrideBlock)
      && CONVENTIONS_KEYS.some((k) => overrideBlock[k] !== undefined && overrideBlock[k] !== null && String(overrideBlock[k]).trim() !== "");
    if (!stored && !hasOverride) { process.stderr.write("faff conventions show: no conventions mined; run `faff conventions mine`\n"); return 3; }
    const effective = stored && typeof stored === "object" && !Array.isArray(stored) ? JSON.parse(JSON.stringify(stored)) : { schema: 1, generated_at: null };
    for (const key of CONVENTIONS_KEYS) {
      const v = overrideBlock && overrideBlock[key];
      if (v !== undefined && v !== null && CONVENTIONS_VOCAB[key].includes(String(v))) {
        effective[key] = { key, value: String(v), source: "explicit", confidence: "high", evidence: [{ kind: "config-key", ref: `.faffrc:conventions.${key}`, detail: `explicit override: ${v}` }] };
      } else if (!effective[key]) {
        effective[key] = { key, value: CONVENTIONS_DEFAULTS[key], source: "default", confidence: "low", evidence: [] };
      }
    }
    console.log(JSON.stringify(effective, null, 2));
    return 0;
  }

  process.stderr.write("faff conventions: expected one of mine | get | show (or --selftest)\n");
  return 2;
}

// ---------------------------------------------------------------------------
// Self-test — pure-function assertions plus a handful of real (throwaway tmp) git repos, so the
// history-inference tiering (the one part with a real subprocess boundary) is exercised against
// real `git log`/`git for-each-ref` output rather than mocked.
// ---------------------------------------------------------------------------
function conventionsSelftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`conventions --selftest FAIL: ${label}\n`); failed++; } };

  // --- classifyCommitSubject ---
  check("classify: conventional 'fix(FAFF-1): thing'", classifyCommitSubject("fix(FAFF-1): thing") === "conventional");
  check("classify: conventional 'docs: add spec'", classifyCommitSubject("docs: add spec") === "conventional");
  check("classify: conventional with bang 'feat!: breaking'", classifyCommitSubject("feat!: breaking") === "conventional");
  check("classify: bare-imperative 'Fix widget rendering bug'", classifyCommitSubject("Fix widget rendering bug") === "bare-imperative");
  check("classify: bare-imperative 'Note: something' (unknown type)", classifyCommitSubject("Note: something") === "bare-imperative");

  // --- classifyBranchName ---
  check("classify branch: issue-slug 'faff-1041-discover-conventions'", classifyBranchName("faff-1041-discover-conventions") === "issue-slug");
  check("classify branch: slash-scoped 'feature/widgets'", classifyBranchName("feature/widgets") === "slash-scoped");
  check("classify branch: unclassifiable 'main' -> null", classifyBranchName("main") === null);

  // --- dominantScheme (the threshold table — pure, no git needed) ---
  const highConf = dominantScheme(Array(18).fill("bare-imperative").concat(Array(2).fill("conventional")), 0.7);
  check("dominance: 18/20 (0.9) -> inferred, confidence high", highConf && highConf.value === "bare-imperative" && highConf.confidence === "high");
  const medConf = dominantScheme(Array(15).fill("conventional").concat(Array(5).fill("bare-imperative")), 0.7);
  check("dominance: 15/20 (0.75) -> inferred, confidence medium", medConf && medConf.value === "conventional" && medConf.confidence === "medium");
  const belowThreshold = dominantScheme(Array(10).fill("conventional").concat(Array(10).fill("bare-imperative")), 0.7);
  check("dominance: 10/20 (0.5, below 0.7) -> no adoption (null)", belowThreshold === null);
  const belowFloor = dominantScheme(Array(19).fill("conventional"), 0.7);
  check("dominance: 19 samples (below the 20 floor) -> no adoption (null)", belowFloor === null);

  // --- validateConventionSet ---
  const validSet = mineConventions(os.tmpdir(), {});   // tmpdir has no docs/git signal -> pure defaults
  check("validate: a freshly-mined (all-default) set is valid", validateConventionSet(validSet).length === 0);
  check("validate: wrong schema is invalid", validateConventionSet({ ...validSet, schema: 2 }).length > 0);
  check("validate: missing convention is invalid", validateConventionSet({ schema: 1, generated_at: "t", branch_naming: validSet.branch_naming, pr_title: validSet.pr_title }).length > 0);
  check("validate: out-of-vocabulary value is invalid", validateConventionSet({ ...validSet, branch_naming: { ...validSet.branch_naming, value: "camelCase" } }).length > 0);
  check("validate: default source with non-low confidence is invalid", validateConventionSet({ ...validSet, branch_naming: { ...validSet.branch_naming, confidence: "high" } }).length > 0);
  check("validate: not an object is invalid", validateConventionSet([]).length > 0);

  // --- fence round-trip (mine's own emitted shape) ---
  check("fence constants stay backtick-fenced", CONVENTIONS_FENCE_OPEN.startsWith("```") && CONVENTIONS_FENCE_CLOSE === "```");

  // --- doc parsing (pure string functions — the deterministic doc-parse, no LLM seam) ---
  const contribBoth = "## Pull requests\n\n- **Conventional Commit PR title.** The repository squash-merges with the PR title as the commit subject.\n";
  check("doc: 'Conventional Commit PR title' scopes to pr_title only", matchDocForKey(contribBoth, "pr_title") === "conventional" && matchDocForKey(contribBoth, "commit_subject") === null);
  const commitMsgDoc = "## Commit messages\n\nWe use Conventional Commits for every commit message in this repository.\n";
  check("doc: 'Conventional Commits' scoped to commit messages -> commit_subject", matchDocForKey(commitMsgDoc, "commit_subject") === "conventional");
  const ambiguousDoc = "Commit messages should be bare imperative, but we also mention Conventional Commits for commit subjects elsewhere.";
  check("doc: conflicting statements for the same key -> ambiguous (no adoption)", matchDocForKey(ambiguousDoc, "commit_subject") === "ambiguous");
  const noSignalDoc = "This project has no rules about commit style.";
  check("doc: no statement -> null (no signal)", matchDocForKey(noSignalDoc, "commit_subject") === null);
  const branchDoc = "Branch naming: use <issue>-<slug> for every feature branch.";
  check("doc: branch naming issue-slug statement", matchDocForKey(branchDoc, "branch_naming") === "issue-slug");
  const branchSlashDoc = "Branches follow type/scope, e.g. feature/widgets or bugfix/typo.";
  check("doc: branch naming slash-scoped statement", matchDocForKey(branchSlashDoc, "branch_naming") === "slash-scoped");

  // --- gate-fixed detection (pure string match against a synthetic workflow body) ---
  check("gate: commitlint action recognised for commit_subject", GATE_SIGNALS.commit_subject.some((re) => re.test("uses: wagoid/commitlint-github-action@v5")));
  check("gate: semantic-pull-request action recognised for pr_title", GATE_SIGNALS.pr_title.some((re) => re.test("uses: amannn/action-semantic-pull-request@v5")));

  // --- real tmp-repo integration (the one part with a genuine `git` subprocess boundary) ---
  let tmp;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-conventions-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmp, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmp, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmp, stdio: "ignore" });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: tmp, stdio: "ignore" });

    // Case A — no docs, 18/20 bare-imperative history -> inferred bare-imperative, high confidence.
    for (let i = 0; i < 18; i++) execFileSync("git", ["commit", "--allow-empty", "--no-verify", "-m", `Do thing number ${i}`], { cwd: tmp, stdio: "ignore" });
    for (let i = 0; i < 2; i++) execFileSync("git", ["commit", "--allow-empty", "--no-verify", "-m", `fix: thing ${i}`], { cwd: tmp, stdio: "ignore" });
    const cfgEmpty = {};
    const caseA = resolveConvention(tmp, "commit_subject", cfgEmpty);
    check("tmp-repo A: inferred bare-imperative from real git history", caseA.source === "inferred" && caseA.value === "bare-imperative" && caseA.confidence === "high");
    check("tmp-repo A: evidence cites git-log", caseA.evidence[0] && caseA.evidence[0].kind === "history" && /git-log/.test(caseA.evidence[0].ref));

    // Case B — no docs, no history signal (repo has NO commits at this point already covered by
    // A having commits; test the "unreadable/empty" fallback on a DIFFERENT, git-less directory).
    const barren = fs.mkdtempSync(path.join(os.tmpdir(), "faff-conventions-barren-"));
    const caseB = resolveConvention(barren, "commit_subject", cfgEmpty);
    check("barren dir (no git at all): falls to default, never crashes", caseB.source === "default" && caseB.value === "conventional" && caseB.confidence === "low");
    fs.rmSync(barren, { recursive: true, force: true });

    // Case C — explicit config wins over a documented convention (CONTRIBUTING.md says
    // issue-slug; .faffrc says slash-scoped).
    fs.writeFileSync(path.join(tmp, "CONTRIBUTING.md"), "Branch naming: use <issue>-<slug> for every feature branch.\n");
    const cfgExplicit = { conventions: { branch_naming: "slash-scoped" } };
    const caseC = resolveConvention(tmp, "branch_naming", cfgExplicit);
    check("tmp-repo C: explicit config beats a documented convention", caseC.source === "explicit" && caseC.value === "slash-scoped");
    const caseCNoOverride = resolveConvention(tmp, "branch_naming", cfgEmpty);
    check("tmp-repo C: without the override, the doc statement wins (documented)", caseCNoOverride.source === "documented" && caseCNoOverride.value === "issue-slug");

    // Case D — out-of-vocabulary explicit value falls through to the next tier (never invented).
    const cfgBogus = { conventions: { branch_naming: "camelCase-branches" } };
    const caseD = resolveConvention(tmp, "branch_naming", cfgBogus);
    check("tmp-repo D: out-of-vocabulary explicit value falls through (never invented)", caseD.source !== "explicit" && CONVENTIONS_VOCAB.branch_naming.includes(caseD.value));

    // Case E — a discovered CI gate beats history inference even when history disagrees.
    fs.mkdirSync(path.join(tmp, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".github", "workflows", "lint.yml"), "jobs:\n  lint:\n    steps:\n      - uses: wagoid/commitlint-github-action@v5\n");
    // Remove the CONTRIBUTING.md commit-subject signal by using a repo path with no such doc but the same bare-imperative-dominant history: reuse tmp (its CONTRIBUTING.md only documents branch_naming, not commit_subject, so this exercises gate > inferred cleanly).
    const caseE = resolveConvention(tmp, "commit_subject", cfgEmpty);
    check("tmp-repo E: a discovered CI gate overrides bare-imperative-dominant history", caseE.source === "documented" && caseE.value === "conventional");

    // Case F — pr_title mirrors commit_subject when it carries no signal of its own.
    // (tmp's CONTRIBUTING.md doesn't mention pr_title; the commitlint gate is scoped to
    // commit_subject only, so pr_title has no CI-gate/doc signal here and must mirror commit_subject.)
    const caseF = resolveConvention(tmp, "pr_title", cfgEmpty);
    check("tmp-repo F: pr_title mirrors commit_subject's resolved value + source", caseF.value === caseE.value && caseF.source === caseE.source);
  } catch (e) {
    check(`tmp-repo integration threw unexpectedly: ${e.message}`, false);
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failed) return 1;
  console.log("conventions --selftest: ok");
  return 0;
}

module.exports = {
  CONVENTIONS_DEFAULTS, CONVENTIONS_FENCE_CLOSE, CONVENTIONS_FENCE_OPEN, CONVENTIONS_KEYS,
  CONVENTIONS_SPEC, CONVENTIONS_SURFACE, CONVENTIONS_VOCAB,
  classifyBranchName, classifyCommitSubject, cmdConventions, conventionsSelftest,
  detectGateFixedValue, dominantScheme, findStandardsDocs, inferConvention, matchDocForKey,
  mineConventions, resolveConvention, scanDocs, validateConventionSet,
};
