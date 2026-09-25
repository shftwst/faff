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
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { loadConfig, resolveAdrDocsPath, resolveAdrSupersededDocsPath, resolvePrdDocsPath, resolvePrdrDocsPath, resolveSpecDocsPath, resolveSpikeDocsPath } = require("./config");
const { parseArgs, usageError } = require("./argv");
const { dig, findRoot } = require("./shared-infra");

const CONVENTIONS_SCHEMA = 3;   // FAFF-1068: schema 1 (FAFF-1041) was mine-emitted-only; schema 2 added the persisted cache.
                                 // FAFF-1082: schema 3 adds the `rules` manifest (repository rule-file discovery).
const CONVENTIONS_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--refresh": { arity: 0 }, "--root": { arity: 1 }, "--default": { arity: 1, aliases: ["-d"] } }, positionals: { min: 0, max: null, name: "verb key" } };
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

// ---------------------------------------------------------------------------
// FAFF-1082 — repository rule-file discovery. A STRUCTURALLY SEPARATE scan from
// findStandardsDocs above: rule files carry no fixed vocabulary and must never win or reorder
// the first-confident-hit precedence the three style keys (branch_naming/commit_subject/
// pr_title) scan over. This records file PRESENCE + provenance only — never rule-file prose,
// never a style-key resolution input. See findStandardsDocs' region note for the axis this is
// deliberately kept apart from.
// ---------------------------------------------------------------------------
const RULE_WALK_BUDGET = 5000;
const RULE_SOURCE = "discovered";           // a rules-block-only source token; NOT a member of CONVENTIONS_SOURCES
const RULE_EVIDENCE_KINDS = ["rule-file"];  // a rules-block-only evidence-kind set; NOT a member of CONVENTIONS_EVIDENCE_KINDS

// Bounded recursive walk of .claude/rules for *.md files, mirroring walkDocsForNames' own
// safeguards (a budget cap, symlinks skipped) — not a reuse of that helper, which is
// docs/-and-basename specific rather than a general recursive .md glob. Deterministic
// (alphabetic) order.
function walkRuleFiles(root) {
  const out = [];
  const stack = [path.join(root, ".claude", "rules")];
  let budget = RULE_WALK_BUDGET;
  while (stack.length && budget-- > 0) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return out.sort();
}

// Root CLAUDE.md (when present as a regular file) first, then every *.md under .claude/rules at
// any depth, alphabetically. Duplicates removed, order preserved. CLAUDE.md is recorded
// independently of AGENTS.md (already scanned by findStandardsDocs above) — the two files load
// under different semantics and deduping would need a fragile "does this file only import
// another?" heuristic, so none is attempted.
function findRuleFiles(root) {
  const out = [];
  if (conventionsIsFile(path.join(root, "CLAUDE.md"))) out.push("CLAUDE.md");
  for (const rel of walkRuleFiles(root)) out.push(rel);
  return [...new Set(out)];
}

// Maps each discovered rule file to a RuleFileEntry — the same five-field shape a convention
// entry uses ({key, value, source, confidence, evidence}), but with its own rules-only
// vocabulary (source "discovered", evidence.kind "rule-file") so it never has to pass through
// the style-key CONVENTIONS_VOCAB / CONVENTIONS_SOURCES enums.
function scanRuleFiles(root) {
  return findRuleFiles(root).map((rel) => ({
    key: rel,
    value: rel,
    source: RULE_SOURCE,
    confidence: "high",
    evidence: [{ kind: "rule-file", ref: rel, detail: `${rel} discovered as a repository rule file` }],
  }));
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

// ---------------------------------------------------------------------------
// FAFF-1068 cache — .faff/conventions.json (schema 2). The cache freezes the resolved
// three-key set so `get` and graft don't re-derive (a doc scan + `git` subprocess) per call.
//
// source_fingerprint covers the BUILD-STABLE, human-controlled inputs — the standards-doc set
// and the CI-gate workflow files (by stat metadata, not content, so a hit test needs no doc
// content read) plus the `.faffrc conventions:` block (already loaded). It deliberately does
// NOT recompute a live git head/branch-count on the hit path: doing so would be a `git`
// subprocess on every `get` (the "no doc scan or git subprocess" contract) AND would drift the
// instant graft creates its feature branch and commits (breaking "a single mine per run feeds
// all graft reads"). The git head/branch-count is captured as diagnostic `git_signal` instead;
// an explicit `mine --refresh` (or graft mining fresh at run start) is the history-change lever.
// ---------------------------------------------------------------------------

function conventionsCachePath(root) { return path.join(root, ".faff", "conventions.json"); }

function statMeta(p) {
  try { const s = fs.statSync(p); return [s.size, s.mtimeMs]; } catch { return null; }
}

function workflowFiles(root) {
  const wfDir = path.join(root, ".github", "workflows");
  try { return fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/i.test(f)).sort().map((f) => `.github/workflows/${f}`); }
  catch { return []; }
}

// A canonical, content-free digest of the inputs that determine the resolved conventions.
// `get` recomputes this cheaply (stat + already-loaded config only — no file read, no git) to
// decide a cache hit; a changed/added/removed standards doc or workflow changes size/mtime and
// so misses.
function computeSourceFingerprint(root, cfg) {
  const docs = findStandardsDocs(root).map((rel) => [rel, statMeta(path.join(root, rel))]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const workflows = workflowFiles(root).map((rel) => [rel, statMeta(path.join(root, rel))]);
  const rules = findRuleFiles(root).map((rel) => [rel, statMeta(path.join(root, rel))]);   // FAFF-1082: rule-file stat-list, so a changed rule file misses the cache
  const config = dig(cfg, "conventions");
  const record_dirs = recordDirCandidates(root, cfg);   // FAFF-1069: names-only record-dir signal so a moved record dir invalidates
  const canonical = JSON.stringify({ docs, workflows, rules, config: config === undefined ? null : config, record_dirs });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// Diagnostic only — captured at mine time, never part of the hit test (see the region note).
function cheapGitSignal(root) {
  const head = safeGit(root, ["rev-parse", "HEAD"]).trim() || null;
  const branches = readBranchNames(root).length;
  return { head, branches };
}

function writeConventionsCacheAtomic(root, set) {
  const dest = conventionsCachePath(root);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(set, null, 2)}\n`);
  fs.renameSync(tmp, dest);   // atomic swap so a concurrent reader never sees a torn write
}

// null on absent / unreadable / invalid-JSON (torn) — every non-usable state reads as "no cache".
function readConventionsCache(root) {
  try { return JSON.parse(fs.readFileSync(conventionsCachePath(root), "utf8")); }
  catch { return null; }
}

function isUsableCache(cache) {
  return cache !== null && typeof cache === "object" && !Array.isArray(cache) && cache.schema === CONVENTIONS_SCHEMA;
}

// Pure, deterministic, read-only mine — the default `conventions` acquirer, now stamped with the
// schema-2 cache metadata (source_fingerprint + diagnostic git_signal). The CLI `mine` verb
// persists the returned set to .faff/conventions.json; the three style keys are byte-identical
// to FAFF-1041. Resolves commit_subject once and hands its result straight to resolvePrTitle
// rather than going through resolveConvention("pr_title", …) — which would independently
// re-resolve commit_subject a second time (a duplicate doc scan + `git log` subprocess).
function mineConventions(root, cfg) {
  const set = { schema: CONVENTIONS_SCHEMA, generated_at: new Date().toISOString() };
  set.source_fingerprint = computeSourceFingerprint(root, cfg);
  set.git_signal = cheapGitSignal(root);
  set.branch_naming = resolveConvention(root, "branch_naming", cfg);
  set.commit_subject = resolveConvention(root, "commit_subject", cfg);
  set.pr_title = resolvePrTitle(root, cfg, set.commit_subject);
  set.record_locations = scanRecordLocations(root, cfg);   // FAFF-1069: synonym-tolerant record-store detection
  set.rules = scanRuleFiles(root);   // FAFF-1082: repository rule-file manifest (discovery only, never a style-key input)
  return set;
}

// The cache-aware resolver behind `conventions get`: returns the cached entry on a schema-2
// fingerprint match (no doc scan, no history git subprocess), else re-derives byte-identically
// to today and refreshes the whole cache when the directory is writable. `{ entry, hit }`.
function resolveConventionCached(root, key, cfg) {
  const cache = readConventionsCache(root);
  if (isUsableCache(cache) && cache[key] && cache.source_fingerprint === computeSourceFingerprint(root, cfg)) {
    return { entry: cache[key], hit: true };
  }
  const entry = resolveConvention(root, key, cfg);
  try { writeConventionsCacheAtomic(root, mineConventions(root, cfg)); } catch { /* read-only tree: re-derive every call, exactly as pre-cache */ }
  return { entry, hit: false };
}

// ---------------------------------------------------------------------------
// FAFF-1069 — synonym-tolerant record-location scan (Slice 2 of FAFF-1060).
// Locates the six record stores (adr / superseded-adr / prd / prdr / spec /
// spike) by matching directory basenames under docs//doc/ against a built-in
// synonym floor, plus a term the ADR store's own README states, reusing the
// ConventionSet { key, value, source, confidence, evidence } grammar. A
// synonym-mapped hit is source "synonym-mapped", confidence "low"; a
// README-stated hit is "documented", confidence "high" — onboard surfaces both
// as a confirm and never auto-writes. Read-only, bounded (one level under
// docs/, plus one level under the resolved current-ADR dir for the co-located
// superseded store), no git subprocess.
// ---------------------------------------------------------------------------
const RECORD_LOCATION_KEYS = ["adr_docs_path", "adr_superseded_docs_path", "prd_docs_path", "prdr_docs_path", "spec_docs_path", "spike_docs_path"];
const RECORD_SOURCES = ["explicit", "documented", "synonym-mapped", "default"];
const RECORD_SYNONYMS = {
  adr_docs_path: ["adr", "active", "accepted", "current", "decisions"],
  adr_superseded_docs_path: ["superseded", "deprecated", "archived", "retired", "historical"],
  prd_docs_path: ["prd"],
  prdr_docs_path: ["prdr"],
  spec_docs_path: ["spec", "specs"],
  spike_docs_path: ["spike", "spikes"],
};
const RECORD_LADDER_RESOLVERS = {
  adr_docs_path: resolveAdrDocsPath,
  adr_superseded_docs_path: resolveAdrSupersededDocsPath,
  prd_docs_path: resolvePrdDocsPath,
  prdr_docs_path: resolvePrdrDocsPath,
  spec_docs_path: resolveSpecDocsPath,
  spike_docs_path: resolveSpikeDocsPath,
};

// Immediate child directory basenames of a repo-relative dir, sorted, symlinks skipped.
function recordChildDirs(root, rel) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => e.name).sort();
}

// The docs base actually present: docs/ preferred, else doc/, else null (matches the resolveDocsPath ladder).
function recordDocsBase(root) {
  if (fs.existsSync(path.join(root, "docs"))) return "docs";
  if (fs.existsSync(path.join(root, "doc"))) return "doc";
  return null;
}

// First child dir of baseRel whose lowercased basename is EXACTLY in synonyms
// (exact equality, never substring — `prd` must never match `prdr`). null on miss.
function matchSynonymChild(root, baseRel, synonyms) {
  const set = new Set(synonyms.map((s) => s.toLowerCase()));
  for (const name of recordChildDirs(root, baseRel)) if (set.has(name.toLowerCase())) return name;
  return null;
}

// README-stated superseded directory terms for the resolved current-ADR store.
// Deterministic + bounded: one README read, a fixed pattern. Each token is a
// BASENAME match token only — never path-joined/resolved/followed — so a `../`
// or absolute term matches no real child basename and directs nothing outside
// the scanned tree.
const SUPERSEDED_README_CONTEXT_RE = /superseded|deprecated|archived|retired|historical|no longer|moved?\s+to/i;
function readmeSupersededTerms(root, currentAdrRel) {
  if (!currentAdrRel) return [];
  let names;
  try { names = fs.readdirSync(path.join(root, currentAdrRel)); } catch { return []; }
  const readme = names.filter((n) => /^README(\.|$)/i.test(n)).sort()[0];
  if (!readme) return [];
  const text = conventionsSafeRead(path.join(root, currentAdrRel, readme));
  if (!text) return [];
  const terms = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!SUPERSEDED_README_CONTEXT_RE.test(line)) continue;
    const tokens = [];
    for (const m of line.matchAll(/`([^`]+)`/g)) tokens.push(m[1]);
    for (const m of line.matchAll(/([A-Za-z0-9._-]+)\/(?=\s|$|[).,;`])/g)) tokens.push(m[1]);
    for (const t of tokens) {
      const base = String(t).replace(/\/+$/, "").split("/").pop().trim().toLowerCase();
      if (base && /^[a-z0-9._-]+$/.test(base)) terms.add(base);
    }
  }
  return [...terms];
}

function recordDocEvidence(rel, detail) { return { kind: "doc-file", ref: rel, detail }; }

function explicitRecordEntry(cfg, key) {
  const raw = dig(cfg, `tracking.${key}`);
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const value = String(raw).trim().replace(/\/+$/, "");
  return { key, value, source: "explicit", confidence: "high", evidence: [{ kind: "config-key", ref: `.faffrc:tracking.${key}`, detail: `explicit override: ${value}` }] };
}

// Current-ADR store — resolved first because the superseded scan scopes under it.
function resolveCurrentAdrRecord(root, cfg, docsBase) {
  const explicit = explicitRecordEntry(cfg, "adr_docs_path");
  if (explicit) return explicit;
  const dflt = RECORD_LADDER_RESOLVERS.adr_docs_path(root, cfg, false);
  if (docsBase) {
    const hit = matchSynonymChild(root, docsBase, RECORD_SYNONYMS.adr_docs_path);
    if (hit) {
      const rel = `${docsBase}/${hit}`;
      if (rel !== dflt) return { key: "adr_docs_path", value: rel, source: "synonym-mapped", confidence: "low", evidence: [recordDocEvidence(rel, `directory basename '${hit}' matches an ADR-store synonym`)] };
    }
  }
  return { key: "adr_docs_path", value: dflt, source: "default", confidence: "low", evidence: [] };
}

// Superseded-ADR store: scoped under the resolved current-ADR dir first (the
// co-located case, e.g. docs/adr/archived), then a docs-level fallback. The
// current-ADR match never claims its own superseded subdir because the current
// scan only looks at docsBase children, and the two synonym sets are disjoint.
function resolveSupersededAdrRecord(root, cfg, docsBase, currentAdrEntry) {
  const explicit = explicitRecordEntry(cfg, "adr_superseded_docs_path");
  if (explicit) return explicit;
  const dflt = RECORD_LADDER_RESOLVERS.adr_superseded_docs_path(root, cfg, false);
  const builtins = RECORD_SYNONYMS.adr_superseded_docs_path.map((s) => s.toLowerCase());
  const readmeTerms = readmeSupersededTerms(root, currentAdrEntry && currentAdrEntry.value);
  const synonymSet = [...builtins, ...readmeTerms];
  const currentRel = currentAdrEntry && currentAdrEntry.value;
  const build = (rel, hit) => {
    const documented = readmeTerms.includes(hit.toLowerCase()) && !builtins.includes(hit.toLowerCase());
    return documented
      ? { key: "adr_superseded_docs_path", value: rel, source: "documented", confidence: "high", evidence: [recordDocEvidence(rel, `ADR store README names '${hit}' as the superseded store`)] }
      : { key: "adr_superseded_docs_path", value: rel, source: "synonym-mapped", confidence: "low", evidence: [recordDocEvidence(rel, `directory basename '${hit}' matches a superseded-ADR synonym`)] };
  };
  if (currentRel && fs.existsSync(path.join(root, currentRel))) {
    const hit = matchSynonymChild(root, currentRel, synonymSet);
    if (hit) { const rel = `${currentRel}/${hit}`; if (rel !== dflt) return build(rel, hit); }
  }
  if (docsBase) {
    const hit = matchSynonymChild(root, docsBase, synonymSet);
    if (hit) { const rel = `${docsBase}/${hit}`; if (rel !== dflt && rel !== currentRel) return build(rel, hit); }
  }
  return { key: "adr_superseded_docs_path", value: dflt, source: "default", confidence: "low", evidence: [] };
}

function resolvePlainRecord(root, cfg, docsBase, key) {
  const explicit = explicitRecordEntry(cfg, key);
  if (explicit) return explicit;
  const dflt = RECORD_LADDER_RESOLVERS[key](root, cfg, false);
  if (docsBase) {
    const hit = matchSynonymChild(root, docsBase, RECORD_SYNONYMS[key]);
    if (hit) { const rel = `${docsBase}/${hit}`; if (rel !== dflt) return { key, value: rel, source: "synonym-mapped", confidence: "low", evidence: [recordDocEvidence(rel, `directory basename '${hit}' matches a ${key} synonym`)] }; }
  }
  return { key, value: dflt, source: "default", confidence: "low", evidence: [] };
}

// The six-key record_locations object mineConventions persists into the cache.
function scanRecordLocations(root, cfg) {
  const docsBase = recordDocsBase(root);
  const out = {};
  const currentAdr = resolveCurrentAdrRecord(root, cfg, docsBase);
  out.adr_docs_path = currentAdr;
  out.adr_superseded_docs_path = resolveSupersededAdrRecord(root, cfg, docsBase, currentAdr);
  for (const key of ["prd_docs_path", "prdr_docs_path", "spec_docs_path", "spike_docs_path"]) out[key] = resolvePlainRecord(root, cfg, docsBase, key);
  return out;
}

// Content-free record-directory candidate set folded into the cache fingerprint:
// the immediate child dirs under docs//doc/, plus the immediate child dirs of
// the resolved current-ADR dir (the nested co-located superseded location).
// Names only — no file read, no git — so a moved/renamed record dir (including a
// co-located superseded move) invalidates the cache without breaking the
// get-hit "no doc scan or git subprocess" contract.
function recordDirCandidates(root, cfg) {
  const docsBase = recordDocsBase(root);
  const out = [];
  if (docsBase) for (const n of recordChildDirs(root, docsBase)) out.push(`${docsBase}/${n}`);
  const currentRel = resolveCurrentAdrRecord(root, cfg, docsBase).value;
  if (currentRel && fs.existsSync(path.join(root, currentRel))) for (const n of recordChildDirs(root, currentRel)) out.push(`${currentRel}/${n}`);
  return [...new Set(out)].sort();
}

// ---------------------------------------------------------------------------
// Validation — pure, mirrors profile.js's validateProfile shape.
// ---------------------------------------------------------------------------
const CONVENTIONS_EVIDENCE_KINDS = ["config-key", "doc-file", "history"];
const CONVENTIONS_SOURCES = ["explicit", "documented", "inferred", "default"];
const CONVENTIONS_CONFIDENCES = ["high", "medium", "low"];

// FAFF-1082 — validates the `rules` manifest block, mirroring validateConventionSet's shape but
// against the rules-only vocabulary (source "discovered", evidence.kind "rule-file") rather than
// CONVENTIONS_VOCAB/CONVENTIONS_SOURCES. Called unconditionally (never optional, unlike
// record_locations below) — a schema-3 set's `rules` array must always be present, even empty.
function validateRuleManifest(rules) {
  if (!Array.isArray(rules)) return ["rules must be an array"];
  const v = [];
  const seen = new Set();
  rules.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) { v.push(`rules[${i}] must be an object`); return; }
    if (!entry.key || String(entry.key).trim() === "") v.push(`rules[${i}].key must be a non-empty string`);
    else if (seen.has(entry.key)) v.push(`duplicate rule key: ${entry.key}`);
    else seen.add(entry.key);
    if (!entry.value || String(entry.value).trim() === "") v.push(`rules[${i}].value must be a non-empty string`);
    if (entry.source !== RULE_SOURCE) v.push(`rules[${i}].source must be '${RULE_SOURCE}'`);
    if (entry.confidence !== "high") v.push(`rules[${i}].confidence must be 'high'`);
    if (!Array.isArray(entry.evidence) || entry.evidence.length !== 1) {
      v.push(`rules[${i}].evidence must be a length-1 array`);
    } else {
      const ev = entry.evidence[0];
      if (ev === null || typeof ev !== "object" || Array.isArray(ev) || !RULE_EVIDENCE_KINDS.includes(ev.kind) || !ev.ref || String(ev.ref).trim() === "") {
        v.push(`rules[${i}].evidence[0] must be { kind: "rule-file", ref: <non-empty> }`);
      }
    }
  });
  return v;
}

function validateConventionSet(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return ["conventions record must be a JSON object"];
  const v = [];
  if (obj.schema !== CONVENTIONS_SCHEMA) v.push(`schema must be ${CONVENTIONS_SCHEMA}`);
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
  // FAFF-1082 — rules is MANDATORY on a schema-3 set (never absent, may be an empty array).
  v.push(...validateRuleManifest(obj.rules));
  // FAFF-1069 — record_locations is OPTIONAL (a pre-slice schema-2 cache omits it and stays valid);
  // when present it must carry all six keys, each a well-formed entry.
  if (obj.record_locations !== undefined) {
    const rl = obj.record_locations;
    if (rl === null || typeof rl !== "object" || Array.isArray(rl)) {
      v.push("record_locations must be an object");
    } else {
      for (const k of Object.keys(rl)) if (!RECORD_LOCATION_KEYS.includes(k)) v.push(`record_locations has unknown key: ${k}`);
      for (const rkey of RECORD_LOCATION_KEYS) {
        const e = rl[rkey];
        if (e === undefined) { v.push(`record_locations missing key: ${rkey}`); continue; }
        if (e === null || typeof e !== "object" || Array.isArray(e)) { v.push(`record_locations.${rkey} must be an object`); continue; }
        if (e.key !== rkey) v.push(`record_locations.${rkey}.key must equal '${rkey}'`);
        if (typeof e.value !== "string" || e.value.trim() === "") v.push(`record_locations.${rkey}.value must be a non-empty string`);
        if (!RECORD_SOURCES.includes(e.source)) v.push(`record_locations.${rkey}.source must be one of ${RECORD_SOURCES.join("|")}`);
        if (!CONVENTIONS_CONFIDENCES.includes(e.confidence)) v.push(`record_locations.${rkey}.confidence must be one of ${CONVENTIONS_CONFIDENCES.join("|")}`);
        if ((e.source === "synonym-mapped" || e.source === "default") && e.confidence !== "low") v.push(`record_locations.${rkey}: source '${e.source}' must carry confidence 'low'`);
        if ((e.source === "documented" || e.source === "explicit") && e.confidence !== "high") v.push(`record_locations.${rkey}: source '${e.source}' must carry confidence 'high'`);
        if (e.source !== "default" && (!Array.isArray(e.evidence) || e.evidence.length === 0)) v.push(`record_locations.${rkey}: non-default source '${e.source}' must cite evidence`);
        if (Array.isArray(e.evidence)) {
          e.evidence.forEach((ev, i) => {
            if (ev === null || typeof ev !== "object" || Array.isArray(ev)) { v.push(`record_locations.${rkey}.evidence[${i}] must be an object`); return; }
            if (!CONVENTIONS_EVIDENCE_KINDS.includes(ev.kind)) v.push(`record_locations.${rkey}.evidence[${i}].kind must be one of ${CONVENTIONS_EVIDENCE_KINDS.join("|")}`);
            if (!ev.ref || String(ev.ref).trim() === "") v.push(`record_locations.${rkey}.evidence[${i}] missing ref`);
          });
        }
      }
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
    // Persist the cache atomically. `--refresh` is intent-documenting: mine always rewrites, so
    // `mine` and `mine --refresh` behave identically — the flag names the invalidation lever.
    try { writeConventionsCacheAtomic(root, set); }
    catch (e) { process.stderr.write(`faff conventions mine: could not persist .faff/conventions.json (${e.message})\n`); }
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
    const resolved = resolveConventionCached(root, key, cfg).entry;
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
    const cachePath = conventionsCachePath(root);
    let stored = null;
    if (fs.existsSync(cachePath)) {
      try { stored = JSON.parse(fs.readFileSync(cachePath, "utf8")); }
      catch { process.stderr.write("faff conventions show: malformed .faff/conventions.json (invalid JSON)\n"); return 2; }
      // A valid-JSON but non-schema-2 file (a schema-1 cache from before FAFF-1068) is stale, not
      // malformed: treat it as absent so a mine re-derives it, never crash on it.
      if (!isUsableCache(stored)) stored = null;
    }
    const cfg = loadCfg();
    if (cfg === null) return 2;
    const overrideBlock = dig(cfg, "conventions");
    const hasOverride = overrideBlock && typeof overrideBlock === "object" && !Array.isArray(overrideBlock)
      && CONVENTIONS_KEYS.some((k) => overrideBlock[k] !== undefined && overrideBlock[k] !== null && String(overrideBlock[k]).trim() !== "");
    if (!stored && !hasOverride) { process.stderr.write("faff conventions show: no conventions mined; run `faff conventions mine`\n"); return 3; }
    const effective = stored && typeof stored === "object" && !Array.isArray(stored) ? JSON.parse(JSON.stringify(stored)) : { schema: CONVENTIONS_SCHEMA, generated_at: null };
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
  const validSet = mineConventions(os.tmpdir(), {});   // tmpdir has no docs/git/rules signal -> pure defaults
  check("validate: a freshly-mined (all-default) set is valid, current schema", validSet.schema === CONVENTIONS_SCHEMA && validateConventionSet(validSet).length === 0);
  check("validate: a schema-1 set is invalid (stale schema)", validateConventionSet({ ...validSet, schema: 1 }).length > 0);
  check("validate: a tmpdir mine has an empty rules array (no CLAUDE.md/.claude/rules there)", Array.isArray(validSet.rules) && validSet.rules.length === 0);
  check("validate: missing convention is invalid", validateConventionSet({ schema: CONVENTIONS_SCHEMA, generated_at: "t", branch_naming: validSet.branch_naming, pr_title: validSet.pr_title }).length > 0);
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

  // --- FAFF-1068 cache round-trip (a fresh tmp dir, no git/docs -> pure-default resolution) ---
  let ctmp;
  try {
    ctmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-conventions-cache-"));

    // mine-writes-file: mine persists a valid schema-2 cache.
    writeConventionsCacheAtomic(ctmp, mineConventions(ctmp, {}));
    const onDisk = readConventionsCache(ctmp);
    check("cache: mine writes a schema-2 .faff/conventions.json that validates",
      fs.existsSync(conventionsCachePath(ctmp)) && onDisk && onDisk.schema === CONVENTIONS_SCHEMA && validateConventionSet(onDisk).length === 0);

    // get-reads-cache: plant a DIFFERENT value under a MATCHING fingerprint -> get returns the
    // planted value, proving it read the cache rather than re-deriving (re-derivation would give
    // the default 'issue-slug').
    const planted = mineConventions(ctmp, {});
    planted.branch_naming = { key: "branch_naming", value: "slash-scoped", source: "documented", confidence: "high", evidence: [{ kind: "doc-file", ref: "planted", detail: "planted cache value" }] };
    planted.source_fingerprint = computeSourceFingerprint(ctmp, {});   // matches current inputs
    writeConventionsCacheAtomic(ctmp, planted);
    const hitRes = resolveConventionCached(ctmp, "branch_naming", {});
    check("cache: get returns the cached value on a fingerprint match (no re-derive)",
      hitRes.hit === true && hitRes.entry.value === "slash-scoped");

    // fingerprint-mismatch-re-derives: corrupt the stored fingerprint -> get ignores the cache and
    // re-derives the real default value.
    const stale = readConventionsCache(ctmp);
    stale.source_fingerprint = "0".repeat(64);
    writeConventionsCacheAtomic(ctmp, stale);
    const missRes = resolveConventionCached(ctmp, "branch_naming", {});
    check("cache: fingerprint mismatch re-derives (byte-identical default) and refreshes",
      missRes.hit === false && missRes.entry.value === CONVENTIONS_DEFAULTS.branch_naming);
    const refreshed = readConventionsCache(ctmp);
    check("cache: a re-derive refreshes the cache with a matching fingerprint",
      refreshed && refreshed.source_fingerprint === computeSourceFingerprint(ctmp, {}));

    // torn-file-treated-as-absent: an invalid-JSON (torn) cache re-derives without crashing.
    fs.writeFileSync(conventionsCachePath(ctmp), "{ not valid json");
    const tornRes = resolveConventionCached(ctmp, "commit_subject", {});
    check("cache: a torn (invalid-JSON) file is treated as absent -> re-derives, never crashes",
      tornRes.hit === false && tornRes.entry.value === CONVENTIONS_DEFAULTS.commit_subject);
  } catch (e) {
    check(`cache round-trip threw unexpectedly: ${e.message}`, false);
  } finally {
    if (ctmp) fs.rmSync(ctmp, { recursive: true, force: true });
  }

  // --- FAFF-1069 record-location scan (real tmp dirs; no git needed) ---
  let rtmp;
  try {
    const mk = (base, subs) => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), `faff-records-${base}-`));
      for (const s of subs) fs.mkdirSync(path.join(d, s), { recursive: true });
      return d;
    };

    // Co-located current + superseded: docs/adr + docs/adr/archived -> distinct keys, no collision.
    rtmp = mk("adr", ["docs/adr", "docs/adr/archived"]);
    let rl = scanRecordLocations(rtmp, {});
    check("record: docs/adr resolves adr_docs_path to docs/adr (default)", rl.adr_docs_path.value === "docs/adr" && rl.adr_docs_path.source === "default");
    check("record: co-located docs/adr/archived -> adr_superseded_docs_path synonym-mapped low",
      rl.adr_superseded_docs_path.value === "docs/adr/archived" && rl.adr_superseded_docs_path.source === "synonym-mapped" && rl.adr_superseded_docs_path.confidence === "low");
    check("record: co-located dirs map to DISTINCT keys (no collision)", rl.adr_docs_path.value !== rl.adr_superseded_docs_path.value);
    check("record: a synonym-mapped hit cites doc-file evidence", rl.adr_superseded_docs_path.evidence[0] && rl.adr_superseded_docs_path.evidence[0].kind === "doc-file");
    check("record: a freshly-mined set with record_locations validates", validateConventionSet(mineConventions(rtmp, {})).length === 0);
    fs.rmSync(rtmp, { recursive: true, force: true });

    // Current-ADR synonym, non-default: docs/decisions -> adr_docs_path synonym-mapped.
    rtmp = mk("dec", ["docs/decisions"]);
    rl = scanRecordLocations(rtmp, {});
    check("record: docs/decisions -> adr_docs_path synonym-mapped low value docs/decisions",
      rl.adr_docs_path.value === "docs/decisions" && rl.adr_docs_path.source === "synonym-mapped" && rl.adr_docs_path.confidence === "low");
    fs.rmSync(rtmp, { recursive: true, force: true });

    // README-stated CUSTOM superseded term (not in the built-in floor): docs/adr/README.md names
    // graveyard/, docs/adr/graveyard exists -> documented, high (the README override earns 'documented').
    rtmp = mk("readme", ["docs/adr", "docs/adr/graveyard"]);
    fs.writeFileSync(path.join(rtmp, "docs/adr/README.md"), "Superseded ADRs: decisions are archived to `graveyard/`.\n");
    rl = scanRecordLocations(rtmp, {});
    check("record: README-stated custom 'graveyard' maps adr_superseded_docs_path documented high",
      rl.adr_superseded_docs_path.value === "docs/adr/graveyard" && rl.adr_superseded_docs_path.source === "documented" && rl.adr_superseded_docs_path.confidence === "high");
    fs.rmSync(rtmp, { recursive: true, force: true });

    // README naming a nonexistent dir -> no false positive.
    rtmp = mk("readme-absent", ["docs/adr"]);
    fs.writeFileSync(path.join(rtmp, "docs/adr/README.md"), "Superseded ADRs move to `graveyard/`.\n");
    rl = scanRecordLocations(rtmp, {});
    check("record: README naming a nonexistent dir -> adr_superseded stays default (no false positive)", rl.adr_superseded_docs_path.source === "default");
    fs.rmSync(rtmp, { recursive: true, force: true });

    // doc/-only ladder: doc/decisions -> synonym-mapped value doc/decisions.
    rtmp = mk("doconly", ["doc/decisions"]);
    rl = scanRecordLocations(rtmp, {});
    check("record: doc/-only ladder maps doc/decisions -> adr_docs_path synonym-mapped value doc/decisions",
      rl.adr_docs_path.value === "doc/decisions" && rl.adr_docs_path.source === "synonym-mapped");
    fs.rmSync(rtmp, { recursive: true, force: true });

    // Exact-basename equality: docs/prdr must NOT bleed into prd_docs_path.
    rtmp = mk("prdr", ["docs/prdr"]);
    rl = scanRecordLocations(rtmp, {});
    check("record: docs/prdr does not map to prd_docs_path (exact equality, not substring)", rl.prd_docs_path.value === "docs/prd" && rl.prd_docs_path.source === "default");
    check("record: docs/prdr IS the prdr ladder default (source default, no offer)", rl.prdr_docs_path.value === "docs/prdr" && rl.prdr_docs_path.source === "default");
    fs.rmSync(rtmp, { recursive: true, force: true });

    // No-signal repo (no docs/doc at all) -> every key default, no synonym-mapped.
    rtmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-records-none-"));
    rl = scanRecordLocations(rtmp, {});
    check("record: no-signal repo -> every record key source default", RECORD_LOCATION_KEYS.every((k) => rl[k].source === "default"));
    check("record: no-signal repo -> no synonym-mapped entry", !RECORD_LOCATION_KEYS.some((k) => rl[k].source === "synonym-mapped"));
    fs.rmSync(rtmp, { recursive: true, force: true });
    rtmp = undefined;
  } catch (e) {
    check(`record-location scan threw unexpectedly: ${e.message}`, false);
  } finally {
    if (rtmp) fs.rmSync(rtmp, { recursive: true, force: true });
  }

  // --- FAFF-1069 record_locations validator (pure) ---
  {
    const styleDefault = (k, val) => ({ key: k, value: val, source: "default", confidence: "low", evidence: [] });
    const base = { schema: CONVENTIONS_SCHEMA, generated_at: "t", rules: [],
      branch_naming: styleDefault("branch_naming", "issue-slug"),
      commit_subject: styleDefault("commit_subject", "conventional"),
      pr_title: styleDefault("pr_title", "conventional") };
    const rlValid = {};
    for (const k of RECORD_LOCATION_KEYS) rlValid[k] = { key: k, value: `docs/${k}`, source: "default", confidence: "low", evidence: [] };
    check("record validate: a set WITHOUT record_locations is valid (back-compat)", validateConventionSet(base).length === 0);
    check("record validate: a well-formed record_locations passes", validateConventionSet({ ...base, record_locations: rlValid }).length === 0);
    const badSource = JSON.parse(JSON.stringify(rlValid));
    badSource.adr_docs_path = { key: "adr_docs_path", value: "docs/adr", source: "inferred", confidence: "high", evidence: [{ kind: "doc-file", ref: "docs/adr" }] };
    check("record validate: an out-of-vocabulary record source is rejected", validateConventionSet({ ...base, record_locations: badSource }).length > 0);
    const badConf = JSON.parse(JSON.stringify(rlValid));
    badConf.adr_docs_path = { key: "adr_docs_path", value: "docs/decisions", source: "synonym-mapped", confidence: "high", evidence: [{ kind: "doc-file", ref: "docs/decisions" }] };
    check("record validate: synonym-mapped with confidence != low is rejected", validateConventionSet({ ...base, record_locations: badConf }).length > 0);
    const noEvidence = JSON.parse(JSON.stringify(rlValid));
    noEvidence.adr_docs_path = { key: "adr_docs_path", value: "docs/decisions", source: "synonym-mapped", confidence: "low", evidence: [] };
    check("record validate: a non-default record source with no evidence is rejected", validateConventionSet({ ...base, record_locations: noEvidence }).length > 0);
  }

  // --- FAFF-1082 repository rule-file discovery (real tmp dirs) ---
  let ruleTmp;
  try {
    ruleTmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-conventions-rules-"));

    // No rule files at all -> empty manifest, not a missing field or an error.
    check("rules: no CLAUDE.md / .claude/rules -> empty array", findRuleFiles(ruleTmp).length === 0 && scanRuleFiles(ruleTmp).length === 0);

    // Capture style-key resolution BEFORE adding rule files, to prove precedence-isolation below.
    const cfgEmptyRules = {};
    const styleBefore = {
      branch_naming: resolveConvention(ruleTmp, "branch_naming", cfgEmptyRules),
      commit_subject: resolveConvention(ruleTmp, "commit_subject", cfgEmptyRules),
      pr_title: resolveConvention(ruleTmp, "pr_title", cfgEmptyRules),
    };

    // Add a root CLAUDE.md and a nested .claude/rules/managed/documentation.md.
    fs.writeFileSync(path.join(ruleTmp, "CLAUDE.md"), "# rules load automatically\n");
    fs.mkdirSync(path.join(ruleTmp, ".claude", "rules", "managed"), { recursive: true });
    fs.writeFileSync(path.join(ruleTmp, ".claude", "rules", "managed", "documentation.md"), "# doc standards\n");
    fs.writeFileSync(path.join(ruleTmp, ".claude", "rules", "managed", "general.md"), "# general rules\n");
    // A non-.md file under .claude/rules must never be picked up.
    fs.writeFileSync(path.join(ruleTmp, ".claude", "rules", "managed", "notes.txt"), "not markdown\n");

    const rels = findRuleFiles(ruleTmp);
    check("rules: CLAUDE.md discovered", rels.includes("CLAUDE.md"));
    check("rules: nested .claude/rules/**/*.md discovered at depth", rels.includes(".claude/rules/managed/documentation.md") && rels.includes(".claude/rules/managed/general.md"));
    check("rules: non-.md file under .claude/rules excluded", !rels.includes(".claude/rules/managed/notes.txt"));
    check("rules: CLAUDE.md ordered first", rels[0] === "CLAUDE.md");
    check("rules: .claude/rules entries alphabetically ordered", rels.slice(1).join("|") === [...rels.slice(1)].sort().join("|"));

    const entries = scanRuleFiles(ruleTmp);
    const docEntry = entries.find((e) => e.key === ".claude/rules/managed/documentation.md");
    check("rules: entry shape {key,value,source,confidence,evidence}", !!docEntry && docEntry.value === docEntry.key
      && docEntry.source === "discovered" && docEntry.confidence === "high"
      && Array.isArray(docEntry.evidence) && docEntry.evidence.length === 1
      && docEntry.evidence[0].kind === "rule-file" && docEntry.evidence[0].ref === docEntry.key);
    check("rules: one entry per discovered file, keys unique", entries.length === rels.length && new Set(entries.map((e) => e.key)).size === entries.length);

    // Precedence-isolation: adding rule files must not shift the three style keys at all.
    const styleAfter = {
      branch_naming: resolveConvention(ruleTmp, "branch_naming", cfgEmptyRules),
      commit_subject: resolveConvention(ruleTmp, "commit_subject", cfgEmptyRules),
      pr_title: resolveConvention(ruleTmp, "pr_title", cfgEmptyRules),
    };
    check("rules: branch_naming resolution unchanged by rule files", JSON.stringify(styleBefore.branch_naming) === JSON.stringify(styleAfter.branch_naming));
    check("rules: commit_subject resolution unchanged by rule files", JSON.stringify(styleBefore.commit_subject) === JSON.stringify(styleAfter.commit_subject));
    check("rules: pr_title resolution unchanged by rule files", JSON.stringify(styleBefore.pr_title) === JSON.stringify(styleAfter.pr_title));
    check("rules: findStandardsDocs untouched by rule files", !findStandardsDocs(ruleTmp).some((d) => d.startsWith(".claude/")));

    // A freshly-mined schema-3 set carrying the rules manifest validates.
    const minedWithRules = mineConventions(ruleTmp, {});
    check("rules: mineConventions attaches set.rules with the discovered entries", minedWithRules.rules.length === entries.length);
    check("rules: a freshly-mined set with rules validates (schema 3)", minedWithRules.schema === CONVENTIONS_SCHEMA && validateConventionSet(minedWithRules).length === 0);

    // Symlinked file/dir under .claude/rules is skipped, never followed, never hangs.
    const outsideTarget = fs.mkdtempSync(path.join(os.tmpdir(), "faff-conventions-rules-outside-"));
    fs.writeFileSync(path.join(outsideTarget, "escaped.md"), "# should never be discovered\n");
    try { fs.symlinkSync(outsideTarget, path.join(ruleTmp, ".claude", "rules", "linked-dir")); } catch { /* symlink perms unavailable in this sandbox */ }
    try { fs.symlinkSync(path.join(ruleTmp, "CLAUDE.md"), path.join(ruleTmp, ".claude", "rules", "managed", "linked.md")); } catch { /* symlink perms unavailable */ }
    const relsWithSymlinks = findRuleFiles(ruleTmp);
    check("rules: symlinked dir under .claude/rules skipped", !relsWithSymlinks.some((r) => r.includes("linked-dir")));
    check("rules: symlinked file under .claude/rules skipped", !relsWithSymlinks.includes(".claude/rules/managed/linked.md"));
    fs.rmSync(outsideTarget, { recursive: true, force: true });
  } catch (e) {
    check(`rule-file discovery threw unexpectedly: ${e.message}`, false);
  } finally {
    if (ruleTmp) fs.rmSync(ruleTmp, { recursive: true, force: true });
  }

  // --- FAFF-1082 validateRuleManifest (pure) ---
  {
    check("rules validate: not an array is invalid", validateRuleManifest("nope").length > 0);
    check("rules validate: empty array is valid", validateRuleManifest([]).length === 0);
    const goodEntry = { key: "CLAUDE.md", value: "CLAUDE.md", source: "discovered", confidence: "high", evidence: [{ kind: "rule-file", ref: "CLAUDE.md", detail: "CLAUDE.md discovered as a repository rule file" }] };
    check("rules validate: a well-formed entry passes", validateRuleManifest([goodEntry]).length === 0);
    check("rules validate: duplicate key rejected", validateRuleManifest([goodEntry, goodEntry]).length > 0);
    check("rules validate: wrong source rejected", validateRuleManifest([{ ...goodEntry, source: "documented" }]).length > 0);
    check("rules validate: wrong confidence rejected", validateRuleManifest([{ ...goodEntry, confidence: "low" }]).length > 0);
    check("rules validate: missing evidence rejected", validateRuleManifest([{ ...goodEntry, evidence: [] }]).length > 0);
    check("rules validate: wrong evidence.kind rejected", validateRuleManifest([{ ...goodEntry, evidence: [{ kind: "doc-file", ref: "CLAUDE.md" }] }]).length > 0);
  }

  // --- FAFF-1082 cache-fingerprint invalidation on a rule-file change ---
  let fptmp;
  try {
    fptmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-conventions-rules-fp-"));
    fs.mkdirSync(path.join(fptmp, ".claude", "rules"), { recursive: true });
    fs.writeFileSync(path.join(fptmp, ".claude", "rules", "general.md"), "v1\n");
    const fp1 = computeSourceFingerprint(fptmp, {});
    // Force a distinct mtime (some filesystems have coarse mtime resolution).
    const future = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(fptmp, ".claude", "rules", "general.md"), "v2, a longer body\n");
    fs.utimesSync(path.join(fptmp, ".claude", "rules", "general.md"), future, future);
    const fp2 = computeSourceFingerprint(fptmp, {});
    check("rules: fingerprint changes when a discovered rule file's content/stat changes", fp1 !== fp2);
  } catch (e) {
    check(`rule-file fingerprint check threw unexpectedly: ${e.message}`, false);
  } finally {
    if (fptmp) fs.rmSync(fptmp, { recursive: true, force: true });
  }

  if (failed) return 1;
  console.log("conventions --selftest: ok");
  return 0;
}

module.exports = {
  CONVENTIONS_DEFAULTS, CONVENTIONS_FENCE_CLOSE, CONVENTIONS_FENCE_OPEN, CONVENTIONS_KEYS,
  CONVENTIONS_SCHEMA, CONVENTIONS_SPEC, CONVENTIONS_SURFACE, CONVENTIONS_VOCAB,
  cheapGitSignal, classifyBranchName, classifyCommitSubject, cmdConventions, computeSourceFingerprint,
  conventionsCachePath, conventionsSelftest, detectGateFixedValue, dominantScheme, findStandardsDocs,
  inferConvention, matchDocForKey, mineConventions, readConventionsCache, resolveConvention,
  resolveConventionCached, scanDocs, validateConventionSet, writeConventionsCacheAtomic,
  RECORD_LOCATION_KEYS, RECORD_SOURCES, RECORD_SYNONYMS, scanRecordLocations, recordDirCandidates,
  RULE_SOURCE, RULE_EVIDENCE_KINDS, findRuleFiles, scanRuleFiles, validateRuleManifest,
};
