// ===========================================================================
// === region:factory — prdr — product requirements DECISION records. The ===
// supersedable product-axis decision record sitting BETWEEN the immutable PRD
// (`faff prd`, FAFF-252) and the per-slice spec. PRD *content* given ADR
// *mechanics*: immutable + globally-numbered + supersedable, so current product
// truth = the non-superseded set. A `cmdPrdr` fused from `cmdAdr` (numbering +
// supersession) and `cmdPrd` (container + lenient presence validate). Reuses
// adrSlug/adrField/the supersession ref-parsers/the symmetric validator/the
// supersede writer VERBATIM (no fork). RECORD-DON'T-JUDGE: `validate` checks the
// four body sections are PRESENT, never what the DoD says (born-verifiable shape
// is FAFF-254/257). `supersede` is a pure mechanical linker — NO actor/authority
// concept; provenance-authority enforcement lives one rung up in FAFF-255.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { adrField, adrSlug, recordSupersede, recordSupersededBy, recordSupersessionProblems, renumberRefsTo } = require("./adr");
const { parseArgs, requireFlags, usageError } = require("./argv");
const PRDR_SPEC = { flags: {
  "--drops-last-goal": { arity: 0 }, "--grounding-present": { arity: 0 }, "--json": { arity: 0 },
  "--live": { arity: 0 }, "--local": { arity: 0 }, "--new-capability": { arity: 0 }, "--no-branch": { arity: 0 }, "--self": { arity: 0 },
  "--selftest": { arity: 0 }, "--serves-goal": { arity: 0 }, "--within-scope": { arity: 0 },
  "--actor": { arity: 1 }, "--admit-verdict": { arity: 1 }, "--base": { arity: 1 }, "--by": { arity: 1 }, "--challenge": { arity: 1 },
  "--challenge-ground": { arity: 1 }, "--challenge-reason": { arity: 1 }, "--container": { arity: 1 }, "--date": { arity: 1 },
  "--dod-covers": { arity: 1 }, "--dod-verdicts": { arity: 1 }, "--issue": { arity: 1 },
  "--lineage-supersessions": { arity: 1 }, "--live-prdrs": { arity: 1 }, "--lower": { arity: 1 },
  "--prd-goal": { arity: 1 }, "--prd-goals": { arity: 1 }, "--proposal": { arity: 1 }, "--proposal-reason": { arity: 1 },
  "--provenance": { arity: 1 }, "--ref-scope": { arity: 1 }, "--root": { arity: 1 }, "--run-dir": { arity: 1 }, "--status": { arity: 1 },
  "--supersedes-provenance": { arity: 1 }, "--thrash-max": { arity: 1 }, "--to": { arity: 1 }, "--upper": { arity: 1 },
}, positionals: { min: 0, max: null, name: "verb selector" } };
// FAFF-628 — declared grammar for `faff cli-surface --json` + the drift-guard's flag-layer
// assertions. `new` is the only subcommand with an unconditional required-flag check today;
// `coverage`'s --prd-goals is genuinely OPTIONAL now (the FAFF-512 regression is gone) — an
// empty required_flags list here is what keeps the guard honest about that.
const PRDR_SURFACE = {
  kind: "subcommand_dispatch",
  spec: PRDR_SPEC,
  subcommands: {
    path: { required_flags: [] },
    list: { required_flags: [] },
    validate: { required_flags: [] },
    accept: { required_flags: [] },
    renumber: { required_flags: [] },
    new: { required_flags: ["--container"] }, // --prd-goal / --prd-goals: one-of, checked in the handler (FAFF-856)
    supersede: { required_flags: ["--by"] },
    admit: { required_flags: [] },
    yagni: { required_flags: [] },
    coverage: { required_flags: [] },
    distance: { required_flags: [] },
    land: { required_flags: ["--local"] }, // FAFF-875 — --local is the only supported mode in v1
  },
};
const { DEFAULTS, loadConfig, resolvePrdrDocsPath } = require("./config");
const { PRDR_ACTORS, PRDR_SUPERSEDES, PRDR_YAGNI_CHALLENGE_GROUNDS, PRDR_YAGNI_PROPOSAL_VERDICTS, computePrdCoverage, computePrdCoverageVerdict, computePrdDistance, contractPrdDistance, computePrdrAdmission, computePrdrAdmissionVerdict, computePrdrYagni, computePrdrYagniVerdict } = require("./contract-defs");
const { schemaCheck } = require("./contract-engine");
const { dig, findRoot } = require("./shared-infra");
// FAFF-875 — `prdr land --local` reuses merge-gate's git-only primitives verbatim: the
// no-remote bypass-guard predicate, the local-base resolver, and the shared ff-only
// base-advance helper (Case A/B/C — see landBaseFfOnly's own header comment in merge-gate.js).
const { gitRemoteEmpty, landBaseFfOnly, resolveLocalBase } = require("./merge-gate");

const PRDR_STATUSES = ["Proposed", "Accepted", "Rejected", "Superseded"];
const PRDR_PROVENANCES = ["human", "loop"];
const PRDR_SECTIONS = ["Context", "Decision", "Scope", "Definition of done"];
const PRDR_FILE_RE = /^(\d{4})-(.+)\.md$/;

function prdrDir(root) { return path.join(root, resolvePrdrDocsPath(root, loadConfig(root)[0], false)); }

// FAFF-856 — the bare comma was doing two jobs at once (the between-goals separator on write,
// the split(",") token on read), so a goal whose OWN text contains a comma fragmented on
// read and could never be cited/covered. The canonical write (prdrTemplate) now emits a JSON
// array on the single citation-field line — a structure a goal string can never collide with.
// The reader stays lenient and migration-free (ADR 0111): try the JSON-array parse first, and
// fall back to the legacy bare comma-split (bare comma-joined string, or the legacy singular
// `PRD-goal:` field) on anything that isn't a JSON array — never throwing, never rejecting.
function parsePrdGoalsField(raw) {
  if (raw == null || !raw.trim()) return []; // preserves FAFF-850 blank-field behaviour
  try {
    const parsed = JSON.parse(raw);
    // nullish elements are dropped BEFORE coercion (String(null) would otherwise stringify to
    // the literal "null", a non-empty string the trailing filter(Boolean) would not catch).
    if (Array.isArray(parsed)) return parsed.filter((el) => el != null).map((el) => String(el).trim()).filter(Boolean);
    // valid JSON but not an array (string/number/object) — fall through to the legacy split
  } catch { /* malformed/pathological JSON — never propagate the throw; fall through */ }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Pure per-file parse — the SHARED core `listPrdrs` (fs-backed) and `listPrdrsAtRef` (git-show-backed,
// FAFF-875) both reduce to, so a ref-pinned read is never a forked/divergent parser.
function parsePrdrRecord(file, text) {
  const m = file.match(PRDR_FILE_RE);
  if (!m) return null;
  const titleM = text.match(/^#\s*PRDR\s+\d+\s*[—\-]\s*(.+)$/mi);
  // FAFF-815 — citation is a set. Parse the plural `PRD-goals:` field (colon-anchored, so it never
  // matches a legacy `PRD-goal:` line); fall back to the legacy singular field. `prd_goal` stays as
  // the primary (prd_goals[0]) for distance/list and any single-goal consumer.
  const goalsRaw = adrField(text, "PRD-goals") ?? adrField(text, "PRD-goal");
  const prd_goals = parsePrdGoalsField(goalsRaw);
  // FAFF-953 — the persisted per-PRDR DoD verdict (the trust-gated holdout result the
  // bridge writes with `faff holdout verdicts --persist`). Surface it as `dod_verdict`
  // ONLY when present, so an absent field stays `undefined` and the `--dod-verdicts`
  // merge guard in coverage/distance (`p.dod_verdict === undefined`) still fills a
  // record that carries none. A present value is the bridge's closed vocabulary verbatim.
  const dodVerdict = adrField(text, "DoD-verdict");
  return {
    number: parseInt(m[1], 10), num: m[1], slug: m[2], file,
    title: titleM ? titleM[1].trim() : null,
    container: adrField(text, "Container"),
    prd_goals,
    prd_goal: prd_goals[0] ?? "",
    status: adrField(text, "Status"),
    provenance: adrField(text, "Provenance"),
    date: adrField(text, "Date"),
    ...(dodVerdict != null ? { dod_verdict: dodVerdict } : {}),
  };
}

// FAFF-953 — write the trust-gated DoD verdict onto a PRDR record's metadata block, add-or-
// replace. The value MUST be the bridge's gate output (computeHoldoutVerdictsMap), never a
// caller-supplied literal — the sole writer is `faff holdout verdicts --persist`. Returns
// true on write, false if no record with `num` exists in `dir`.
function setPrdrDodVerdict(dir, num, verdict) {
  const rec = listPrdrs(dir).find((p) => p.num === num);
  if (!rec) return false;
  const p = path.join(dir, rec.file);
  let text = fs.readFileSync(p, "utf8");
  const line = `- **DoD-verdict:** ${verdict}`;
  if (/^- \*\*DoD-verdict:\*\*.*$/m.test(text)) {
    text = text.replace(/^- \*\*DoD-verdict:\*\*.*$/m, line);
  } else {
    // Insert as the last metadata line, immediately before the blank line that precedes
    // the first `## ` section (the template always separates metadata from body by one
    // blank line). First-match only, so it lands in the metadata block, not a body list.
    text = text.replace(/\n\n(## )/, `\n${line}\n\n$1`);
  }
  fs.writeFileSync(p, text);
  return true;
}

function listPrdrs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!PRDR_FILE_RE.test(f)) continue;
    const rec = parsePrdrRecord(f, fs.readFileSync(path.join(dir, f), "utf8"));
    if (rec) out.push(rec);
  }
  return out.sort((a, b) => a.number - b.number);
}

// FAFF-875 (D6 reader) — the REF-PINNED sibling of `listPrdrs`: reads the PRDR directory as it
// exists at `ref` (a branch/sha) via `git ls-tree` + `git show`, never the filesystem. Needed
// because a Case-A `land` (bare `update-ref`) advances `base` WITHOUT touching the invoking
// worktree's own checkout — the working tree stays stale, so a coverage recompute that read the
// filesystem would silently reflect the OLD base. `dir` is the absolute PRDR directory (as
// `prdrDir(root)` returns); `root` is the repo root the ref lives in. Best-effort: any git
// failure (ls-tree/show) degrades to treating that path/file as absent, never throws.
function listPrdrsAtRef(root, dir, ref) {
  const rel = path.relative(root, dir);
  const lsOut = gitOut(root, ["ls-tree", "-r", "--name-only", ref, "--", rel]);
  if (lsOut == null) return [];
  const files = lsOut.split("\n").map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const f of files) {
    const base = path.basename(f);
    if (!PRDR_FILE_RE.test(base)) continue;
    const text = gitOut(root, ["show", `${ref}:${f}`]);
    if (text == null) continue;
    const rec = parsePrdrRecord(base, text);
    if (rec) out.push(rec);
  }
  return out.sort((a, b) => a.number - b.number);
}

function prdrNextNumber(dir) {
  const max = listPrdrs(dir).reduce((m, a) => Math.max(m, a.number), 0);
  return String(max + 1).padStart(4, "0");
}

function prdrTemplate({ num, title, date, container, prdGoal, provenance, status }) {
  // FAFF-856 — canonical write: always emit the PRD-goals field as a JSON array, so any goal's own
  // comma is safely contained inside its array element. `prdGoal` accepts either an array directly
  // (the `new --prd-goals` path) or a single string, normalized to a one-element array (`--prd-goal`).
  const goals = Array.isArray(prdGoal) ? prdGoal : (prdGoal ? [prdGoal] : []);
  const lines = [`# PRDR ${num} — ${title}`, "",
    `- **Status:** ${status || "Proposed"}`,
    `- **Provenance:** ${provenance || "human"}`,
    `- **Date:** ${date}`,
    `- **Container:** ${container}`,
    `- **PRD-goals:** ${JSON.stringify(goals)}`, "",
    "## Context", "", "_TODO: the product need this decision answers + the PRD goal it serves._", "",
    "## Decision", "", "_TODO: the product decision, stated forward._", "",
    "## Scope", "", "_TODO: what this decision covers (and explicitly excludes)._", "",
    "## Definition of done", "", "_TODO: the completion bar for this decision (born-verifiable enforcement is FAFF-254/257)._", ""];
  return lines.join("\n");
}

// Lenient validate (mirrors adrValidate + prdValidate philosophy): metadata PRESENT, enums
// match, numbering contiguous, the four body sections PRESENT, supersession symmetric. NEVER
// checks WHAT a section says (record-don't-judge; a _TODO_ DoD passes presence — P2).
function prdrValidate(dir) {
  const prdrs = listPrdrs(dir);
  const problems = [];
  const texts = new Map();
  for (const a of prdrs) {
    const text = fs.readFileSync(path.join(dir, a.file), "utf8");
    texts.set(a.num, text);
    const titleM = text.match(/^#\s*PRDR\s+(\d+)\s*[—\-]\s*.+$/mi);
    if (!titleM) problems.push(`${a.file}: missing '# PRDR NNNN — Title' heading`);
    else if (parseInt(titleM[1], 10) !== a.number) problems.push(`${a.file}: heading number PRDR ${titleM[1]} != filename ${a.num}`);
    if (!a.status) problems.push(`${a.file}: missing Status field`);
    else if (!PRDR_STATUSES.some((s) => new RegExp(`^${s}`, "i").test(a.status))) problems.push(`${a.file}: Status "${a.status.slice(0, 30)}" must start with one of ${PRDR_STATUSES.join("|")}`);
    if (!a.provenance) problems.push(`${a.file}: missing Provenance field`);
    else if (!PRDR_PROVENANCES.some((p) => new RegExp(`^${p}$`, "i").test(a.provenance.trim()))) problems.push(`${a.file}: Provenance "${a.provenance.slice(0, 30)}" must be one of ${PRDR_PROVENANCES.join("|")}`);
    if (!a.date) problems.push(`${a.file}: missing Date field`);
    if (!a.container) problems.push(`${a.file}: missing Container field`);
    // FAFF-815 — a valid record cites a non-empty goal SET (either the plural `PRD-goals:` field or a
    // legacy singular `PRD-goal:`, both parsed into prd_goals by listPrdrs).
    if (!a.prd_goals || !a.prd_goals.length) problems.push(`${a.file}: missing PRD-goal(s) citation field`);
    // Presence-only body check (P2): each of the four sections must exist as a "## " heading.
    for (const s of PRDR_SECTIONS) {
      if (!new RegExp(`^##\\s+${s}\\s*$`, "mi").test(text)) problems.push(`${a.file}: missing "## ${s}" section`);
    }
  }
  // Contiguous global numbering (mirror adrValidate).
  const seen = new Set();
  for (const a of prdrs) {
    if (seen.has(a.number)) problems.push(`duplicate PRDR number ${a.num}`);
    seen.add(a.number);
  }
  for (let i = 1; i <= prdrs.length; i++) {
    if (!seen.has(i)) problems.push(`numbering gap: PRDR ${String(i).padStart(4, "0")} missing (expected contiguous 0001..${String(prdrs.length).padStart(4, "0")})`);
  }
  // Symmetric supersession back-refs — the SHARED validator, prefix "PRDR".
  problems.push(...recordSupersessionProblems(prdrs, texts, "PRDR"));
  return problems;
}

// === FAFF-463: PRDR git-landing (accept sole-writer + renumber port + git-aware validate tier) ===
// The one place the CLI edits/commits a PRDR record's Status into `Accepted`. All git is local
// (spawnSync per stage.js precedent, FAFF-457) — push/PR is the calling skill's job.
const { spawnSync } = require("node:child_process");
const git = (root, a, opts) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8", ...(opts || {}) });
const gitOk = (root, a) => git(root, a).status === 0;
const gitOut = (root, a) => { const r = git(root, a); return r.status === 0 ? (r.stdout || "").trim() : null; };

// Git-awareness tier (P: FAIL accepted-uncommitted, NOTE proposed-uncommitted). `prdr.validate_git`:
// auto (default; degrades to silent outside a git work tree) | off. Presence-only elsewhere; tracked-ness
// is a shape fact, not content. Returns { fails: string[], notes: string[] }.
function prdrGitTier(dir, root, cfg) {
  const mode = (cfg && cfg["prdr.validate_git"]) || DEFAULTS["prdr.validate_git"];
  if (mode === "off") return { fails: [], notes: [] };
  if (!gitOk(root, ["rev-parse", "--is-inside-work-tree"])) return { fails: [], notes: [] };
  const fails = [], notes = [];
  for (const a of listPrdrs(dir)) {
    const rel = path.relative(root, path.join(dir, a.file)) || a.file;
    const tracked = gitOk(root, ["ls-files", "--error-unmatch", "--", rel]);
    const modified = !!gitOut(root, ["status", "--porcelain", "--", rel]);
    const st = a.status || "";
    if (/^Accepted/i.test(st) && (!tracked || modified)) fails.push(`${a.file}: accepted-uncommitted — Status Accepted but the file is untracked-or-modified vs HEAD`);
    else if (/^Proposed/i.test(st) && !tracked) notes.push(`${a.file}: proposed-uncommitted — a Proposed record not yet tracked (the legitimate authoring state)`);
  }
  return { fails, notes };
}

// Resolve the base branch to land off (merge-gate.js:566-567 precedent: gh → origin/HEAD → "main").
function resolveDefaultBase(root) {
  const gh = spawnSync("gh", ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"], { cwd: root, encoding: "utf8" });
  if (gh.status === 0 && gh.stdout.trim()) return gh.stdout.trim();
  const originHead = gitOut(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (originHead) return originHead.replace(/^origin\//, "");
  return "main";
}

// THE sole writer of `Status: Accepted`. Atomic-or-clean: any failure leaves the working tree, the
// original branch, and the record's Status exactly as they were.
function prdrAccept(dir, root, number, { actor, admitVerdictJson, noBranch, cfg } = {}) {
  const rec = (() => { const d = String(number || "").match(/^(\d{1,4})/); return d ? listPrdrs(dir).find((a) => a.num === d[1].padStart(4, "0")) : null; })();
  if (!rec) return { code: 1, err: `faff prdr accept: no PRDR matching "${number}" in ${path.relative(root, dir) || dir}\n` };
  if (/^(Accepted|Rejected|Superseded)/i.test(rec.status || "")) return { code: 1, err: `faff prdr accept: PRDR-${rec.num} Status is already terminal ("${(rec.status || "").split(/[ (.]/)[0]}") — accept only flips Proposed\n` };
  if (!gitOk(root, ["rev-parse", "--is-inside-work-tree"])) return { code: 1, err: `faff prdr accept: not a git work tree — accept is a git gesture\n` };
  const curBranch = gitOut(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!curBranch) return { code: 1, err: `faff prdr accept: HEAD is detached — no branch to restore or to carry the commit\n` };

  if (actor === "loop") {
    if (!admitVerdictJson) return { code: 2, err: `faff prdr accept: --actor loop requires --admit-verdict '<json>'\n` };
    let parsed; try { parsed = JSON.parse(admitVerdictJson); } catch { return { code: 2, err: `faff prdr accept: --admit-verdict is not valid JSON\n` }; }
    const sc = schemaCheck(parsed, "prdr-admission");
    if (sc) return { code: 2, err: `faff prdr accept: --admit-verdict fails prdr-admission schema: ${sc}\n` };
    if (parsed.disposition !== "admit") return { code: 1, err: `faff prdr accept: --admit-verdict disposition is "${parsed.disposition}", not "admit" — the loop may only accept an admitted PRDR\n` };
  }

  const filePath = path.join(dir, rec.file);
  const base = noBranch ? curBranch : resolveDefaultBase(root);
  const prefix = (cfg && cfg["prdr.accept_branch_prefix"]) || DEFAULTS["prdr.accept_branch_prefix"];
  const landing = `${prefix}${rec.num}-${adrSlug(rec.title || rec.slug || "prdr")}`;

  // --- branch setup (skipped for --no-branch): NOTHING is mutated until a switch succeeds ---
  if (!noBranch) {
    if (gitOut(root, ["diff", "--cached", "--name-only"])) return { code: 1, err: `faff prdr accept: the index has staged changes — commit or reset them first (accept must not smuggle unrelated work)\n` };
    if (gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${landing}`])) return { code: 1, err: `faff prdr accept: landing branch "${landing}" already exists — delete it or use --no-branch\n` };
    const sw = git(root, ["switch", "-c", landing, base]);
    if (sw.status !== 0) return { code: 1, err: `faff prdr accept: could not create landing branch "${landing}" off "${base}" (nothing mutated): ${(sw.stderr || "").trim()}\n` };
  }

  // --- the mutation, strictly AFTER a successful switch — on the landing branch, never the original ---
  const orig = fs.readFileSync(filePath, "utf8");
  const restore = (extra) => {  // full rollback: unstage, restore file content, restore branch, drop landing
    try { git(root, ["reset", "-q"]); } catch {}          // unstage (never `git checkout -- file`, which restores the staged Accepted copy)
    try { fs.writeFileSync(filePath, orig); } catch {}     // content back to Proposed
    if (!noBranch) { git(root, ["switch", curBranch]); git(root, ["branch", "-D", landing]); }
    return extra;
  };
  fs.writeFileSync(filePath, orig.replace(/^([\s>*-]*\*{0,2}Status[ \t*]*:[ \t*]*).*$/mi, "$1Accepted"));
  const relPath = path.relative(root, filePath) || rec.file;
  const add = git(root, ["add", "--", relPath]);
  if (add.status !== 0) return { code: 1, ...restore({ err: `faff prdr accept: git add failed (rolled back — Status still Proposed): ${(add.stderr || "").trim()}\n` }) };
  const commit = git(root, ["commit", "-m", `docs(prdr): accept PRDR-${rec.num} — ${rec.title || rec.slug}`]);
  if (commit.status !== 0) return { code: 1, ...restore({ err: `faff prdr accept: git commit failed (rolled back — Status still Proposed): ${(commit.stderr || "").trim()}\n` }) };

  // --- success: return to the original branch (the landing branch holds the commit) ---
  let warn = "";
  if (!noBranch) { const back = git(root, ["switch", curBranch]); if (back.status !== 0) warn = `warning: commit landed on "${landing}" but could not switch back to "${curBranch}" — run: git switch ${curBranch}\n`; }
  return { code: 0, out: JSON.stringify({ file: filePath, branch: noBranch ? curBranch : landing, base }) + "\n", err: warn };
}

// === FAFF-875: `faff prdr land --local` — land an Accepted doc-only PRDR onto `main` in a
// no-remote repo. A sibling landing gate to `merge-gate --local` (D1: never an overload of it) —
// narrower (doc-only, PRDR-shaped preconditions), reusing the same ff-only base-advance
// primitive (`landBaseFfOnly`, extracted out of merge-gate.js) rather than forking it. ===

// D3.3 — segment-anchored containment: every path the land would introduce must stay wholly
// under the configured PRDR directory. `prefix` is ALREADY trailing-slash-stripped
// (resolvePrdrDocsPath's own contract). Deliberately NOT a bare `startsWith(prefix)` — that
// would admit a sibling-prefix escape like `records/prdr-notes/evil.js` (the round-1 review's
// infosec finding); a segment boundary (`prefix + "/"`) plus a traversal-segment guard is the
// precedent `deriveAnchorDirs` (governance-check.js) already established for the same shape of
// problem. `f === prefix` (a path equal to the directory itself, no separator) also passes, per
// the spec's own predicate — an edge case no real `git diff --name-only` row produces (that
// command never emits a bare directory path) but harmless to admit.
function landPathAllowed(f, prefix) {
  if (typeof f !== "string" || !f) return false;
  if (f !== prefix && !f.startsWith(prefix + "/")) return false;
  return f.split("/").every((seg) => seg !== "." && seg !== ".." && seg !== "");
}

// D3.4 — candidate validation runs against the LANDING TREE (the state `main` would have once
// landed), never the current filesystem (which, in the common single-worktree flow, still shows
// the base copy — still Proposed, since `accept` only ever touches the landing branch). Follows
// the post-merge.js `git worktree add --detach` precedent: materialise `ref` into a throwaway
// detached worktree, run the existing FAFF-463 validators (`prdrValidate` + `prdrGitTier`)
// against THAT tree, then always clean up (a stray worktree entry is the one failure mode the
// `finally` exists to prevent). Returns a flat problems[] (empty ⟹ clean).
function landCandidateProblems(root, ref) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-land-"));
  try {
    const added = spawnSync("git", ["worktree", "add", "--detach", tmp, ref], { cwd: root, encoding: "utf8" });
    if (added.status !== 0) return [`could not materialise the candidate tree at ${ref}: ${((added.stderr || "") + (added.stdout || "")).trim().slice(-300)}`];
    const candidateCfg = loadConfig(tmp)[0];
    const candidateDir = prdrDir(tmp);
    const problems = prdrValidate(candidateDir);
    const { fails } = prdrGitTier(candidateDir, tmp, candidateCfg);
    return problems.concat(fails);
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", tmp], { cwd: root, encoding: "utf8" });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// The full `land` procedure (D2–D6), kept as its own function (mirrors `prdrAccept`'s shape) so
// `cmdPrdr`'s `land` branch stays a thin flag-parse + dispatch, and so the selftest can drive it
// directly without shelling the CLI. Returns { code, out?, err? } — `out` is the D5 JSON record
// on success (always emitted, `--json` or not — the auditable landing record, per spec D5).
function prdrLand(dir, root, number, { baseFlag, prdGoalsRaw, runDir, issue, cfg } = {}) {
  // D2.1 — no-remote gate (indeterminate fails toward "has a remote", fail-closed).
  const remoteEmpty = gitRemoteEmpty(root);
  if (remoteEmpty !== true) {
    return { code: 2, err: "faff prdr land --local: repo has a remote (or its remote-state is indeterminate) — land an Accepted PRDR via the forge PR path\n" };
  }

  const d = String(number || "").match(/^(\d{1,4})/);
  const num = d ? d[1].padStart(4, "0") : null;
  if (!num) return { code: 2, err: `faff prdr land: invalid PRDR number "${number}"\n` };

  // D2.3 — the landing branch must exist and be one `faff prdr accept` produced. Discovered by
  // NUMBER-PREFIXED GLOB on refs/heads (`git for-each-ref`), never by recomputing the expected
  // branch name from a title read out of the WORKING TREE: `accept`'s landing branch is created
  // off `base` at accept-time and can carry the PRDR record as its OWN first-ever commit — when
  // the record was authored but never committed to base (the exact "stranded, coverage reads
  // 0/5" repro this ticket exists to fix), `accept`'s closing `git switch <curBranch>` makes git
  // remove that now-tracked-only-on-landing file from the base worktree entirely, so a
  // filesystem read here would find nothing to land. The glob needs no title at all.
  const branchPrefix = (cfg && cfg["prdr.accept_branch_prefix"]) || DEFAULTS["prdr.accept_branch_prefix"];
  const refOut = gitOut(root, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${branchPrefix}${num}-*`]);
  const landingCandidates = (refOut || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (landingCandidates.length === 0) {
    return { code: 1, err: `faff prdr land: no landing branch matching "${branchPrefix}${num}-*" — land only advances a branch created by \`faff prdr accept\`\n` };
  }
  if (landingCandidates.length > 1) {
    return { code: 1, err: `faff prdr land: ambiguous — multiple landing branches match "${branchPrefix}${num}-*": ${landingCandidates.join(", ")}\n` };
  }
  const landing = landingCandidates[0];

  // D2.2 — the record + its Status are read from the LANDING BRANCH TIP's own tree (`git
  // ls-tree` + `git show`), never the base/working-tree copy — again so an absent-from-base
  // record still lands correctly.
  const prdrPrefix = resolvePrdrDocsPath(root, cfg, false); // trailing slash already stripped
  const lsOut = gitOut(root, ["ls-tree", "-r", "--name-only", landing, "--", prdrPrefix]);
  const landingFiles = (lsOut || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const matchPath = landingFiles.find((f) => PRDR_FILE_RE.test(path.basename(f)) && path.basename(f).startsWith(`${num}-`));
  if (!matchPath) {
    return { code: 1, err: `faff prdr land: landing branch "${landing}" carries no PRDR-${num} record under ${prdrPrefix}\n` };
  }
  const tipText = gitOut(root, ["show", `${landing}:${matchPath}`]);
  if (tipText == null) return { code: 1, err: `faff prdr land: cannot read ${matchPath} at ${landing}\n` };
  const rec = parsePrdrRecord(path.basename(matchPath), tipText);
  if (!rec) return { code: 1, err: `faff prdr land: ${matchPath} at ${landing} does not parse as a PRDR record\n` };
  const tipStatus = rec.status || "";
  if (!/^Accepted/i.test(tipStatus)) {
    return { code: 1, err: `faff prdr land: PRDR-${num} Status at ${landing} is "${tipStatus.split(/[ (.]/)[0] || "?"}", not Accepted — land only ratifies an Accepted record\n` };
  }

  // Resolve the LOCAL base branch — the git-only resolver merge-gate --local itself uses (parity).
  const base = resolveLocalBase(root, baseFlag);
  if (!base) return { code: 2, err: "faff prdr land --local: cannot resolve a local base branch (no --base, and neither main nor master exists locally)\n" };
  if (base === landing) return { code: 2, err: `faff prdr land: base and landing branch are the same ref (${base}) — nothing to land\n` };

  const baseShaBefore = gitOut(root, ["rev-parse", base]);
  const tipSha = gitOut(root, ["rev-parse", landing]);
  if (!baseShaBefore || !tipSha) return { code: 1, err: "faff prdr land: cannot resolve base/landing branch tips\n" };

  // D3.2 — fast-forward descendant (rebase-first if base moved; non-ff is out of scope).
  if (!gitOk(root, ["merge-base", "--is-ancestor", base, landing])) {
    return { code: 1, err: `faff prdr land: "${landing}" is not a fast-forward descendant of "${base}" — rebase the accept branch onto ${base} first (ff-only)\n` };
  }

  // D3.3 — every changed path stays wholly under the configured PRDR directory (segment-anchored).
  // (`prdrPrefix` was already resolved above for the D2.2 ls-tree scope — reused verbatim.)
  const changedRaw = gitOut(root, ["diff", "--name-only", base, landing]);
  const changed = (changedRaw || "").split("\n").map((s) => s.trim()).filter(Boolean);
  for (const f of changed) {
    if (!landPathAllowed(f, prdrPrefix)) {
      return { code: 1, err: `faff prdr land refuses: ${f} is outside the PRDR directory ${prdrPrefix} (doc-only landing only)\n` };
    }
  }

  // D3.4 — candidate validation against the landing tree (never the stale working copy).
  const candidateProblems = landCandidateProblems(root, landing);
  if (candidateProblems.length) {
    return { code: 1, err: candidateProblems.map((p) => `FAIL  ${p}`).join("\n") + "\n" };
  }

  // D4 — atomic ff-only advance, shared with `merge-gate --local`. `allowInPlace: true` arms
  // Case C (the ordinary git-only single-worktree PRDR flow: `accept` switched back to base, so
  // the invoking worktree normally sits ON base already) — see landBaseFfOnly's header comment
  // for why merge-gate --local itself never sets this.
  const adv = landBaseFfOnly({ cwd: root, base, tipSha, baseShaBefore, allowInPlace: true, retryHint: `faff prdr land --local ${rec.num}` });
  if (!adv.ok) return { code: 1, err: `faff prdr land: ${adv.blocker}\n` };

  // D6 — recompute coverage from the UPDATED base. The ff-only advance means the new base tip IS
  // the landing tip; read live PRDRs from the filesystem when the invoking worktree itself now
  // reflects that tip (Case C — the common flow), else ref-pinned (Case A/B, where the invoking
  // worktree's own checkout was never touched — see listPrdrsAtRef's header comment).
  const newBaseSha = tipSha;
  const selfNowBranch = gitOut(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const rawLive = selfNowBranch === base ? listPrdrs(dir) : listPrdrsAtRef(root, dir, newBaseSha);
  const livePrdrs = rawLive.filter((p) => !recordSupersededBy(p.status, "PRDR"))
    .map((p) => ({ id: p.num, prd_goals: p.prd_goals, prd_goal: p.prd_goal, dod_verdict: p.dod_verdict }));

  let prdGoals = [];
  if (prdGoalsRaw != null) {
    try { prdGoals = JSON.parse(prdGoalsRaw); } catch (e) { return { code: 2, err: `faff prdr land: --prd-goals is not valid JSON: ${e.message}\n` }; }
    if (!Array.isArray(prdGoals)) return { code: 2, err: "faff prdr land: --prd-goals must be a JSON array of strings\n" };
  }
  const coverage = computePrdCoverageVerdict({ prdGoals, livePrdrs });

  const result = { prdr: rec.num, file: rec.file, base, old_base_sha: baseShaBefore, new_base_sha: newBaseSha, landed: true, coverage };

  // D5 — persist the landing record when a run dir is supplied; the stdout JSON is always the
  // load-bearing record either way (the spec's own punt on the exact persisted-record path).
  let warn = "";
  if (runDir && issue) {
    try {
      const outDir = path.join(runDir, issue);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, `prdr-landing-${rec.num}.json`), JSON.stringify(result, null, 2) + "\n");
    } catch (e) { warn = `warning: could not persist landing record: ${e.message}\n`; }
  }

  return { code: 0, out: JSON.stringify(result) + "\n", err: warn };
}

// Merge-time collision repair — port of adrRenumber for PRDR (uses the shared renumberRefsTo).
// selector = a filename or a bare number (a DUPLICATED bare number is rejected — pass the filename);
// target = a 1–4 digit number or "next". Renames the file, fixes the heading, rewrites in-ref-scope
// back-refs, re-validates. git-agnostic (pure fs; the caller stages the rename).
function prdrRenumber(dir, root, selector, target, refScopeArg) {
  if (!selector || !target) return { code: 2, err: `usage: faff prdr renumber <file-or-number> --to next|<NNNN> [--ref-scope <scope>]\n` };
  if (target !== "next" && !/^\d{1,4}$/.test(String(target))) return { code: 2, err: `faff prdr renumber: --to must be "next" or a 1–4 digit number (got ${JSON.stringify(target)})\n` }; // mirror adrRenumber's target guard
  const prdrs = listPrdrs(dir);
  let rec;
  if (/^\d{1,4}$/.test(String(selector))) {
    const num = String(selector).padStart(4, "0");
    const hits = prdrs.filter((a) => a.num === num);
    if (hits.length > 1) return { code: 2, err: `faff prdr renumber: bare number ${num} is ambiguous (${hits.length} files) — pass the filename\n` };
    rec = hits[0];
  } else {
    const base = path.basename(String(selector));
    rec = prdrs.find((a) => a.file === base);
  }
  if (!rec) return { code: 1, err: `faff prdr renumber: no PRDR matching "${selector}" in ${path.relative(root, dir) || dir}\n` };
  const newNum = target === "next" ? prdrNextNumber(dir) : String(target).padStart(4, "0");
  if (newNum === rec.num) return { code: 0, out: `${rec.file} (no-op — already ${newNum})\n` };
  if (prdrs.some((a) => a.num === newNum)) return { code: 1, err: `faff prdr renumber: target ${newNum} is already occupied — pick a free slot or use --to next\n` };
  const oldPath = path.join(dir, rec.file);
  const newFile = `${newNum}-${rec.file.replace(/^\d{1,4}-/, "")}`;
  const newPath = path.join(dir, newFile);
  if (fs.existsSync(newPath)) return { code: 1, err: `faff prdr renumber: ${newFile} already exists\n` };
  // Fix the heading number in the moved file's own text.
  let text = fs.readFileSync(oldPath, "utf8").replace(/^(#\s*PRDR\s+)\d+(\s*[—\-])/mi, `$1${newNum}$2`);
  fs.writeFileSync(oldPath, text);
  fs.renameSync(oldPath, newPath);
  // Rewrite canonical supersession back-refs pointing at oldNum within the ref-scope (default: all PRDRs).
  const scope = refScopeArg ? refScopeArg.split(/\s+/).filter(Boolean).map((s) => path.basename(s)) : null;
  for (const a of listPrdrs(dir)) {
    if (scope && !scope.includes(a.file)) continue;
    const p = path.join(dir, a.file);
    const before = fs.readFileSync(p, "utf8");
    const after = renumberRefsTo(before, rec.num, newNum, "PRDR");
    if (after !== before) fs.writeFileSync(p, after);
  }
  const problems = prdrValidate(dir);
  if (problems.length) return { code: 1, err: `faff prdr renumber: tree does not re-validate after renumber:\n${problems.map((p) => "  FAIL " + p).join("\n")}\n` };
  return { code: 0, out: `${rec.file} → ${newFile}\n` };
}

function cmdPrdr(args) {
  if (args.includes("--selftest")) return prdrSelftest();
  const parsed = parseArgs(args, PRDR_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff prdr <path|new|supersede|renumber|validate|list|admit|yagni|...> [selector] [flags]");
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const action = args[0];
  const root = get("--root") || findRoot();
  const dir = prdrDir(root);

  if (action === "path") {
    // No arg → the resolved docs/prdr directory; <number> → that record's file path.
    const tok = (args[1] && !args[1].startsWith("--")) ? args[1] : null;
    if (!tok) { process.stdout.write(dir + "\n"); return 0; }
    const d = String(tok).match(/^(\d{1,4})/);
    const rec = d ? listPrdrs(dir).find((a) => a.num === d[1].padStart(4, "0")) : null;
    if (!rec) { process.stderr.write(`faff prdr path: no PRDR matching "${tok}" in ${path.relative(root, dir) || dir}\n`); return 1; }
    process.stdout.write(path.join(dir, rec.file) + "\n");
    return 0;
  }

  if (action === "list") {
    let prdrs = listPrdrs(dir);
    const container = get("--container");
    if (container) prdrs = prdrs.filter((p) => p.container && adrSlug(p.container) === adrSlug(container));
    if (args.includes("--live")) prdrs = prdrs.filter((p) => !recordSupersededBy(p.status, "PRDR"));
    if (args.includes("--json")) {
      console.log(JSON.stringify(prdrs.map(({ number, num, title, container, prd_goals, prd_goal, status, provenance, date, file }) =>
        ({ number, id: num, title, container, prd_goals, prd_goal, status, provenance, date, file })), null, 2));
    } else if (!prdrs.length) {
      console.log(`No PRDRs in ${path.relative(root, dir) || dir}.`);
    } else {
      for (const p of prdrs) console.log(`${p.num}  ${p.title || p.slug}  [${(p.status || "?").split(/[ (.]/)[0]}]  ${p.provenance || "?"}  ${p.container || ""}`.trimEnd());
    }
    return 0;
  }

  if (action === "validate") {
    const problems = prdrValidate(dir);
    const { fails, notes } = prdrGitTier(dir, root, loadConfig(root)[0]); // FAFF-463: git-awareness tier
    const allFails = problems.concat(fails);
    if (!allFails.length) { console.log(`OK — ${listPrdrs(dir).length} PRDR(s) in ${path.relative(root, dir) || dir} valid.`); for (const n of notes) console.log(`NOTE  ${n}`); return 0; }
    for (const p of allFails) console.log(`FAIL  ${p}`);
    for (const n of notes) console.log(`NOTE  ${n}`);
    return 1;
  }

  if (action === "accept") {
    const number = (args[1] && !args[1].startsWith("--")) ? args[1] : null;
    if (!number) { process.stderr.write("faff prdr accept: <number> is required\n"); return 2; }
    const actor = get("--actor") || "human";
    if (!["human", "loop"].includes(actor)) { process.stderr.write("faff prdr accept: --actor must be human|loop\n"); return 2; }
    const r = prdrAccept(dir, root, number, {
      actor, admitVerdictJson: get("--admit-verdict"),
      noBranch: args.includes("--no-branch"), cfg: loadConfig(root)[0],
    });
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    return r.code;
  }

  if (action === "renumber") {
    const selector = (args[1] && !args[1].startsWith("--")) ? args[1] : null;
    const r = prdrRenumber(dir, root, selector, get("--to"), get("--ref-scope"));
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    return r.code;
  }

  if (action === "new") {
    const title = (args[1] && !args[1].startsWith("--")) ? args[1] : null;
    const container = get("--container");
    const prdGoal = get("--prd-goal");
    if (!title) { process.stderr.write("faff prdr new: <title> is required\n"); return 2; }
    // FAFF-856 — --prd-goals is an explicit JSON-array set (parity with the coverage/yagni/distance
    // guards: same parse-then-array-shape check, same exit 2, only the verb name differs in stderr).
    // The comma can no longer double as the author's separator, so this is the multi-goal input path.
    let prdGoals = null;
    const goalsRaw = get("--prd-goals");
    if (goalsRaw != null) {
      try { prdGoals = JSON.parse(goalsRaw); } catch (e) { process.stderr.write(`faff prdr new: --prd-goals is not valid JSON: ${e.message}\n`); return 2; }
      if (!Array.isArray(prdGoals)) { process.stderr.write("faff prdr new: --prd-goals must be a JSON array of strings\n"); return 2; }
    }
    const reqErr = requireFlags(parsed.values, PRDR_SURFACE.subcommands.new, "prdr", "new");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    // --prd-goal / --prd-goals: one-of (mechanical required_flags only covers --container now — a
    // record needs SOME goal citation, from either input, but not necessarily both).
    if (prdGoals == null && !prdGoal) { process.stderr.write("faff prdr new: --prd-goal or --prd-goals is required\n"); return 2; }
    const provenance = get("--provenance");
    if (provenance && !PRDR_PROVENANCES.includes(provenance)) { process.stderr.write(`faff prdr new: --provenance must be one of ${PRDR_PROVENANCES.join("|")}\n`); return 2; }
    const date = get("--date") || new Date().toISOString().slice(0, 10);
    const num = prdrNextNumber(dir);
    const file = `${num}-${adrSlug(title)}.md`;
    const full = path.join(dir, file);
    if (fs.existsSync(full)) { process.stderr.write(`faff prdr new: ${file} already exists — never overwrite (append-only)\n`); return 1; }
    fs.mkdirSync(dir, { recursive: true });
    // provenance default = human (fail-safe: the harder-to-supersede tier; the loop passes --provenance loop).
    // --prd-goals (an explicit set) takes precedence when both are given; prdrTemplate JSON-stringifies
    // an array directly and normalizes a single --prd-goal string to a one-element array.
    fs.writeFileSync(full, prdrTemplate({ num, title, date, container, prdGoal: prdGoals != null ? prdGoals : prdGoal, provenance: provenance || "human", status: get("--status") }));
    process.stdout.write(full + "\n");   // stdout = path ONLY (parity with `adr new`/`prd new`)
    return 0;
  }

  if (action === "supersede") {
    // Pure mechanical linker — the SHARED writer, prefix "PRDR" (mirror `adr supersede` exactly;
    // NO actor/authority concept — that is FAFF-255's gate, P1).
    const reqErr = requireFlags(parsed.values, PRDR_SURFACE.subcommands.supersede, "prdr", "supersede");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    const r = recordSupersede(dir, root, listPrdrs(dir), args[1], get("--by"), "PRDR");
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    return r.code;
  }

  if (action === "admit") {
    // The two-gate admission gate (FAFF-255). Pure — no tracker/network call (parity with `faff next`):
    // the agent maps the move's state onto these closed-vocabulary flags. <prdr> is accepted for the
    // human-readable echo / lineage label; the verdict itself is a pure function of the flags.
    const actor = get("--actor");
    if (!PRDR_ACTORS.includes(actor)) { process.stderr.write("faff prdr admit: --actor must be loop|human\n"); return 2; }
    const sup = get("--supersedes-provenance");
    if (!PRDR_SUPERSEDES.includes(sup)) { process.stderr.write("faff prdr admit: --supersedes-provenance must be human|loop|none\n"); return 2; }
    const cfg = loadConfig(root)[0];
    const tmRaw = get("--thrash-max") ?? dig(cfg, "prdr.thrash_max") ?? DEFAULTS["prdr.thrash_max"];
    const thrashMax = parseInt(tmRaw, 10);
    // thrash_max + lineage are COUNTS — a negative is nonsensical and would breach the ratchet at
    // lineage 0 (lineage >= negative is always true), spuriously rejecting every admit. Reject it.
    if (!Number.isInteger(thrashMax) || thrashMax < 0) { process.stderr.write(`faff prdr admit: thrash_max "${tmRaw}" must be a non-negative integer\n`); return 2; }
    const lsRaw = get("--lineage-supersessions");
    const lineageSupersessions = lsRaw != null ? parseInt(lsRaw, 10) : 0;
    if (!Number.isInteger(lineageSupersessions) || lineageSupersessions < 0) { process.stderr.write(`faff prdr admit: --lineage-supersessions "${lsRaw}" must be a non-negative integer\n`); return 2; }
    let upper = null, lower = null;
    const upRaw = get("--upper");
    if (upRaw != null) { try { upper = JSON.parse(upRaw); } catch (e) { process.stderr.write(`faff prdr admit: --upper is not valid JSON: ${e.message}\n`); return 2; } }
    const loRaw = get("--lower");
    if (loRaw != null) { try { lower = JSON.parse(loRaw); } catch (e) { process.stderr.write(`faff prdr admit: --lower is not valid JSON: ${e.message}\n`); return 2; } }
    const verdict = computePrdrAdmissionVerdict({
      actor, supersedesProvenance: sup,
      self: args.includes("--self"),
      newCapability: args.includes("--new-capability"),
      dropsLastGoal: args.includes("--drops-last-goal"),
      lineageSupersessions, thrashMax, upper, lower,
    });
    // Belt-and-braces: the produced verdict must itself conform to the prdr-admission contract schema.
    const schemaErr = schemaCheck(verdict, "prdr-admission");
    if (schemaErr) { process.stderr.write(`faff prdr admit: ${schemaErr}\n`); return 2; }
    process.stdout.write(JSON.stringify(verdict) + "\n");
    return 0;   // report-only (parity with `faff next`): the disposition is in the payload, never the exit code
  }

  if (action === "yagni") {
    // The UPPER (YAGNI) gate producer (FAFF-256). Pure — no tracker/network call (parity with `admit`):
    // the agent maps the trace + the two slot results onto these closed-vocabulary flags. <prdr> is
    // accepted for the human-readable echo; the verdict is a pure function of the flags. Emits 255's
    // `upper` shape (admit, reason) plus the audit trail; feed it to `faff prdr admit --upper`.
    const prdGoal = get("--prd-goal");
    let prdGoals = [];
    const goalsRaw = get("--prd-goals");
    if (goalsRaw != null) {
      try { prdGoals = JSON.parse(goalsRaw); } catch (e) { process.stderr.write(`faff prdr yagni: --prd-goals is not valid JSON: ${e.message}\n`); return 2; }
      if (!Array.isArray(prdGoals)) { process.stderr.write("faff prdr yagni: --prd-goals must be a JSON array of strings\n"); return 2; }
    }
    const proposalVerdict = get("--proposal");
    if (proposalVerdict != null && !PRDR_YAGNI_PROPOSAL_VERDICTS.includes(proposalVerdict)) {
      process.stderr.write("faff prdr yagni: --proposal must be admit|reject\n"); return 2;
    }
    const challenge = get("--challenge");
    if (challenge != null && challenge !== "survived" && challenge !== "overturned") {
      process.stderr.write("faff prdr yagni: --challenge must be survived|overturned (omit when Phase 2 did not conclude)\n"); return 2;
    }
    // FAFF-815 — V (the DoD-covered goal set); absent ⇒ [] ⇒ byte-identical to pre-815 (over_scope/under_cited false).
    let dodCovers = [];
    const dcRaw = get("--dod-covers");
    if (dcRaw != null) {
      try { dodCovers = JSON.parse(dcRaw); } catch (e) { process.stderr.write(`faff prdr yagni: --dod-covers is not valid JSON: ${e.message}\n`); return 2; }
      if (!Array.isArray(dodCovers)) { process.stderr.write("faff prdr yagni: --dod-covers must be a JSON array of strings\n"); return 2; }
    }
    // FAFF-815 (Q7) — the closed-vocab overturn ground; absent ⇒ producer defaults to "other" (fail-safe).
    const challengeGround = get("--challenge-ground");
    if (challengeGround != null && !PRDR_YAGNI_CHALLENGE_GROUNDS.includes(challengeGround)) {
      process.stderr.write(`faff prdr yagni: --challenge-ground must be one of ${PRDR_YAGNI_CHALLENGE_GROUNDS.join("|")}\n`); return 2;
    }
    const verdict = computePrdrYagniVerdict({
      prdGoal, prdGoals, dodCovers, challengeGround,
      proposalVerdict, proposalReason: get("--proposal-reason"),
      servesGoal: args.includes("--serves-goal"), withinScope: args.includes("--within-scope"),
      challenge, challengeReason: get("--challenge-reason"),
      groundingPresent: args.includes("--grounding-present"),
    });
    // Belt-and-braces: the produced verdict must itself conform to the prdr-yagni contract schema.
    const schemaErr = schemaCheck(verdict, "prdr-yagni");
    if (schemaErr) { process.stderr.write(`faff prdr yagni: ${schemaErr}\n`); return 2; }
    process.stdout.write(JSON.stringify(verdict) + "\n");
    return 0;   // report-only (parity with `admit`): the verdict is in the payload, never the exit code
  }

  if (action === "coverage") {
    // The LOWER (coverage) gate + `prd-satisfied` roll-up producer (FAFF-257). Pure — no tracker/network
    // call (parity with `admit` / `yagni`): the agent maps the PRD's declared goals + the live-PRDR set
    // (and FAFF-34's per-PRDR DoD verdicts, when the evaluator exists) onto these closed-vocabulary flags.
    // Emits 255's `lower` shape at the top level ({covered, uncovered_goals} — feed to `prdr admit --lower`)
    // plus the `prd-satisfied` roll-up; pipe the block to `faff contract prd-coverage`.
    let prdGoals = [];
    const goalsRaw = get("--prd-goals");
    if (goalsRaw != null) {
      try { prdGoals = JSON.parse(goalsRaw); } catch (e) { process.stderr.write(`faff prdr coverage: --prd-goals is not valid JSON: ${e.message}\n`); return 2; }
      if (!Array.isArray(prdGoals)) { process.stderr.write("faff prdr coverage: --prd-goals must be a JSON array of strings\n"); return 2; }
    }
    // livePrdrs: the live (non-superseded) PRDR set — each { id, prd_goal, dod_verdict? }. Either pass it
    // directly via --live-prdrs (pure; e.g. from `prdr list --live --json`), or omit it to let the
    // producer read the live PRDRs from docs/prdr itself (the static coverage convenience).
    let livePrdrs = null;
    const liveRaw = get("--live-prdrs");
    if (liveRaw != null) {
      try { livePrdrs = JSON.parse(liveRaw); } catch (e) { process.stderr.write(`faff prdr coverage: --live-prdrs is not valid JSON: ${e.message}\n`); return 2; }
      if (!Array.isArray(livePrdrs)) { process.stderr.write("faff prdr coverage: --live-prdrs must be a JSON array of objects\n"); return 2; }
    } else {
      // Read live PRDRs from docs/prdr (no network — filesystem only, still pure of side effects).
      let prdrs = listPrdrs(dir).filter((p) => !recordSupersededBy(p.status, "PRDR"));
      const container = get("--container");
      if (container) prdrs = prdrs.filter((p) => p.container && adrSlug(p.container) === adrSlug(container));
      // FAFF-815 — carry the plural cited set so coverage unions it (prd_goal kept for legacy readers).
      livePrdrs = prdrs.map((p) => ({ id: p.num, prd_goals: p.prd_goals, prd_goal: p.prd_goal, dod_verdict: p.dod_verdict }));
    }
    // --dod-verdicts: optional FAFF-34 verdict map { "<prdr-id>": "met"|... }, merged onto livePrdrs by id.
    // Absent ⇒ every DoD unverified ⇒ conservatively not-met (the unbuilt-evaluator default).
    const dvRaw = get("--dod-verdicts");
    if (dvRaw != null) {
      let dodVerdicts;
      try { dodVerdicts = JSON.parse(dvRaw); } catch (e) { process.stderr.write(`faff prdr coverage: --dod-verdicts is not valid JSON: ${e.message}\n`); return 2; }
      if (dodVerdicts === null || typeof dodVerdicts !== "object" || Array.isArray(dodVerdicts)) { process.stderr.write("faff prdr coverage: --dod-verdicts must be a JSON object { prdr-id: verdict }\n"); return 2; }
      livePrdrs = livePrdrs.map((p) => (p && typeof p === "object" && !Array.isArray(p) && p.dod_verdict === undefined && p.id != null && Object.prototype.hasOwnProperty.call(dodVerdicts, p.id)) ? { ...p, dod_verdict: dodVerdicts[p.id] } : p);
    }
    const verdict = computePrdCoverageVerdict({ prdGoals, livePrdrs });
    // Belt-and-braces: the produced verdict must itself conform to the prd-coverage contract schema.
    const schemaErr = schemaCheck(verdict, "prd-coverage");
    if (schemaErr) { process.stderr.write(`faff prdr coverage: ${schemaErr}\n`); return 2; }
    process.stdout.write(JSON.stringify(verdict) + "\n");
    return 0;   // report-only (parity with `admit`/`yagni`): the verdict is in the payload, never the exit code
  }

  if (action === "distance") {
    // The PRD-satisfaction-greedy drain-ordering PRODUCER (FAFF-535). Pure — no tracker/network call
    // (parity with `coverage`): the agent maps the PRD's declared goals + the live-PRDR set (and FAFF-34's
    // per-PRDR DoD verdicts, when the evaluator exists) onto these closed-vocabulary flags. Flag-for-flag
    // mirror of `coverage`; emits the per-sibling distance-class ladder for the methodology to compose as a
    // within-band ordering tiebreaker. Not gate-consumed; pipe the block to `faff contract prd-distance`.
    let prdGoals = [];
    const goalsRaw = get("--prd-goals");
    if (goalsRaw != null) {
      try { prdGoals = JSON.parse(goalsRaw); } catch (e) { process.stderr.write(`faff prdr distance: --prd-goals is not valid JSON: ${e.message}\n`); return 2; }
      if (!Array.isArray(prdGoals)) { process.stderr.write("faff prdr distance: --prd-goals must be a JSON array of strings\n"); return 2; }
    }
    let livePrdrs = null;
    const liveRaw = get("--live-prdrs");
    if (liveRaw != null) {
      try { livePrdrs = JSON.parse(liveRaw); } catch (e) { process.stderr.write(`faff prdr distance: --live-prdrs is not valid JSON: ${e.message}\n`); return 2; }
      if (!Array.isArray(livePrdrs)) { process.stderr.write("faff prdr distance: --live-prdrs must be a JSON array of objects\n"); return 2; }
    } else {
      // Read live PRDRs from docs/prdr (no network — filesystem only, still pure of side effects).
      // NB: unlike `coverage`, distance CARRIES `container` (the Entry record mandates it for the
      // methodology's issue↔sibling slug-match) — do not drop it here.
      let prdrs = listPrdrs(dir).filter((p) => !recordSupersededBy(p.status, "PRDR"));
      const container = get("--container");
      if (container) prdrs = prdrs.filter((p) => p.container && adrSlug(p.container) === adrSlug(container));
      livePrdrs = prdrs.map((p) => ({ id: p.num, prd_goal: p.prd_goal, container: p.container, dod_verdict: p.dod_verdict }));
    }
    // --dod-verdicts: optional FAFF-34 verdict map { "<prdr-id>": "met"|... }, merged onto livePrdrs by id.
    const dvRaw = get("--dod-verdicts");
    if (dvRaw != null) {
      let dodVerdicts;
      try { dodVerdicts = JSON.parse(dvRaw); } catch (e) { process.stderr.write(`faff prdr distance: --dod-verdicts is not valid JSON: ${e.message}\n`); return 2; }
      if (dodVerdicts === null || typeof dodVerdicts !== "object" || Array.isArray(dodVerdicts)) { process.stderr.write("faff prdr distance: --dod-verdicts must be a JSON object { prdr-id: verdict }\n"); return 2; }
      livePrdrs = livePrdrs.map((p) => (p && typeof p === "object" && !Array.isArray(p) && p.dod_verdict === undefined && p.id != null && Object.prototype.hasOwnProperty.call(dodVerdicts, p.id)) ? { ...p, dod_verdict: dodVerdicts[p.id] } : p);
    }
    const verdict = computePrdDistance({ prdGoals, livePrdrs });
    // Belt-and-braces: the produced verdict must itself conform to the prd-distance contract schema.
    const schemaErr = schemaCheck(verdict, "prd-distance");
    if (schemaErr) { process.stderr.write(`faff prdr distance: ${schemaErr}\n`); return 2; }
    process.stdout.write(JSON.stringify(verdict) + "\n");
    return 0;   // report-only (parity with `coverage`): the verdict is in the payload, never the exit code
  }

  if (action === "land") {
    // FAFF-875 — land an Accepted, doc-only PRDR from its `prdr/NNNN-slug` branch onto the local
    // base branch. `--local` is the only supported mode in v1 (D1's punt); required here so the
    // surface reads as deliberately git-only.
    const reqErr = requireFlags(parsed.values, PRDR_SURFACE.subcommands.land, "prdr", "land");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    const number = (args[1] && !args[1].startsWith("--")) ? args[1] : null;
    if (!number) { process.stderr.write("faff prdr land: <number> is required\n"); return 2; }
    const cfg = loadConfig(root)[0];
    const r = prdrLand(dir, root, number, {
      baseFlag: get("--base"), prdGoalsRaw: get("--prd-goals"),
      runDir: get("--run-dir"), issue: get("--issue"), cfg,
    });
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    return r.code;
  }

  process.stderr.write("faff prdr: expected one of: path | new | list | supersede | validate | admit | yagni | coverage | distance | land (or --selftest)\n");
  return 2;
}

function prdrSelftest() {
  const os = require("node:os");
  const cases = [];
  const t = (name, ok) => cases.push([name, !!ok]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-"));
  const dir = path.join(tmp, "docs", "prdr");
  fs.mkdirSync(dir, { recursive: true });
  const mk = (num, slug, opts = {}) => fs.writeFileSync(path.join(dir, `${num}-${slug}.md`),
    prdrTemplate({ num, title: opts.title || slug, date: "2026-06-27", container: opts.container || "portal", prdGoal: opts.prdGoal || "ship the booking flow", provenance: opts.provenance || "human", status: opts.status }));

  // resolver
  t("resolver default docs/prdr", resolvePrdrDocsPath(tmp, {}, false) === "docs/prdr");
  t("resolver honours config", resolvePrdrDocsPath(tmp, { tracking: { prdr_docs_path: "x/y/" } }, false) === "x/y");
  t("empty next-number → 0001", prdrNextNumber(dir) === "0001");

  // new template: full metadata + four sections, listed + parsed
  mk("0001", "booking-flow");
  const l1 = listPrdrs(dir);
  t("new file listed + parsed", l1.length === 1 && l1[0].container === "portal" && l1[0].provenance === "human" && l1[0].prd_goal === "ship the booking flow");
  t("template carries the four sections", (() => {
    const tpl = prdrTemplate({ num: "0009", title: "T", date: "2026-06-27", container: "c", prdGoal: "g", provenance: "loop" });
    return PRDR_SECTIONS.every((s) => new RegExp(`^##\\s+${s}\\s*$`, "mi").test(tpl)) && /\*\*Provenance:\*\* loop/.test(tpl);
  })());
  t("next-number after 0001 → 0002", prdrNextNumber(dir) === "0002");
  t("validate clean", prdrValidate(dir).length === 0);

  // presence-only: a _TODO_ DoD (template default) passes (P2)
  t("a vacuous _TODO_ DoD still validates (presence-only)", prdrValidate(dir).length === 0);

  // FAFF-850: a PRESENT-BUT-BLANK PRD-goals field reads back empty (not the following heading),
  // which re-activates the missing-goal guard the phantom next-line value used to defeat.
  fs.writeFileSync(path.join(dir, "0003-blankgoal.md"),
    "# PRDR 0003 — blankgoal\n\n- **Status:** Proposed\n- **Provenance:** loop\n- **Date:** 2026-06-27\n- **Container:** portal\n- **PRD-goals:** \n\n## Context\nx\n\n## Decision\ny\n\n## Scope\nz\n\n## Definition of done\nw\n");
  {
    const bg = listPrdrs(dir).find((p) => p.num === "0003");
    t("FAFF-850: blank PRD-goals yields prd_goals [] and prd_goal ''", bg.prd_goals.length === 0 && bg.prd_goal === "");
    t("FAFF-850: blank PRD-goals is not captured as '## Context'", bg.prd_goal !== "## Context");
    t("FAFF-850: re-activated goal guard flags the blank-goal PRDR", prdrValidate(dir).some((p) => /0003-blankgoal\.md: missing PRD-goal\(s\) citation field/.test(p)));
  }
  fs.unlinkSync(path.join(dir, "0003-blankgoal.md"));

  // missing-section flagged
  fs.writeFileSync(path.join(dir, "0002-nodod.md"), "# PRDR 0002 — nodod\n\n- **Status:** Proposed\n- **Provenance:** loop\n- **Date:** 2026-06-27\n- **Container:** portal\n- **PRD-goal:** g\n\n## Context\nx\n## Decision\ny\n## Scope\nz\n");
  t("missing '## Definition of done' flagged", prdrValidate(dir).some((p) => /missing "## Definition of done"/.test(p)));
  fs.unlinkSync(path.join(dir, "0002-nodod.md"));

  // bad provenance flagged
  fs.writeFileSync(path.join(dir, "0002-badprov.md"), "# PRDR 0002 — badprov\n\n- **Status:** Proposed\n- **Provenance:** robot\n- **Date:** 2026-06-27\n- **Container:** portal\n- **PRD-goal:** g\n\n## Context\nx\n\n## Decision\ny\n\n## Scope\nz\n\n## Definition of done\nw\n");
  t("bad Provenance flagged", prdrValidate(dir).some((p) => /Provenance .* must be one of/.test(p)));
  fs.unlinkSync(path.join(dir, "0002-badprov.md"));

  // supersession via the shared writer
  mk("0002", "booking-flow-v2", { title: "booking flow v2" });
  const sup = recordSupersede(dir, tmp, listPrdrs(dir), "0001", "0002", "PRDR");
  t("supersede returns code 0", sup.code === 0);
  t("OLD marked Superseded by PRDR-0002", /\*\*Status:\*\* Superseded by PRDR-0002/.test(fs.readFileSync(path.join(dir, "0001-booking-flow.md"), "utf8")));
  t("NEW marked Supersedes PRDR-0001", /\*\*Supersedes:\*\* PRDR-0001/.test(fs.readFileSync(path.join(dir, "0002-booking-flow-v2.md"), "utf8")));
  t("symmetric supersession validates clean", prdrValidate(dir).length === 0);
  t("double-supersede refused", recordSupersede(dir, tmp, listPrdrs(dir), "0001", "0002", "PRDR").code !== 0);
  t("self-supersede refused", recordSupersede(dir, tmp, listPrdrs(dir), "0002", "0002", "PRDR").code !== 0);

  // --live excludes the superseded record
  const live = listPrdrs(dir).filter((p) => !recordSupersededBy(p.status, "PRDR"));
  t("--live excludes superseded", live.length === 1 && live[0].num === "0002");

  fs.rmSync(tmp, { recursive: true, force: true });

  // --- admit gate (FAFF-255): the pure two-gate producer (no fs needed). ---
  const adm = (opts) => computePrdrAdmissionVerdict({ thrashMax: 3, ...opts });
  t("loop→loop, gates pass → admit", adm({ actor: "loop", supersedesProvenance: "loop" }).disposition === "admit");
  t("loop→human → propose-only (needs ratification)", adm({ actor: "loop", supersedesProvenance: "human" }).disposition === "propose-only");
  t("human→human → admit (human is the encloser)", adm({ actor: "human", supersedesProvenance: "human" }).disposition === "admit");
  t("inner-loop self-supersede → reject (by-level)", (() => { const v = adm({ actor: "loop", supersedesProvenance: "loop", self: true }); return v.disposition === "reject" && v.authority.by_level === "violation"; })());
  t("new-capability + 256 absent → reject (fail-safe, no gold-plating)", (() => { const v = adm({ actor: "loop", supersedesProvenance: "none", newCapability: true }); return v.disposition === "reject" && v.upper.admit === false; })());
  t("like-for-like + 256 absent → upper admits (fail-safe)", adm({ actor: "loop", supersedesProvenance: "loop" }).upper.admit === true);
  t("drops-last-goal + 257 absent → reject (coverage, no silent abandonment)", (() => { const v = adm({ actor: "loop", supersedesProvenance: "loop", dropsLastGoal: true }); return v.disposition === "reject" && v.lower.covered === false; })());
  t("ratchet breach (lineage ≥ thrash_max) → reject + breached", (() => { const v = adm({ actor: "loop", supersedesProvenance: "loop", lineageSupersessions: 3 }); return v.disposition === "reject" && v.ratchet.breached === true; })());
  t("under thrash_max → not breached", adm({ actor: "loop", supersedesProvenance: "loop", lineageSupersessions: 2 }).ratchet.breached === false);
  t("explicit --upper admit:false → reject", adm({ actor: "loop", supersedesProvenance: "loop", upper: { admit: false, reason: "yagni" } }).disposition === "reject");
  t("explicit --lower covered:false → reject", adm({ actor: "loop", supersedesProvenance: "loop", lower: { covered: false, uncovered_goals: ["g"] } }).disposition === "reject");
  t("hard violation beats propose-only (loop→human + self → reject)", adm({ actor: "loop", supersedesProvenance: "human", self: true }).disposition === "reject");
  t("every produced verdict is contract-conformant", ["admit", "propose-only", "reject"].every((d) => {
    const v = adm({ actor: "loop", supersedesProvenance: d === "propose-only" ? "human" : "loop", self: d === "reject" });
    return computePrdrAdmission(v).contractData.conformant === true && v.disposition === d;
  }));

  // --- FAFF-256: the upper (YAGNI) gate producer ---
  const yag = (opts) => computePrdrYagniVerdict({ prdGoal: "ship booking", prdGoals: ["ship booking", "reduce no-shows"], proposalVerdict: "admit", challenge: "survived", ...opts });
  t("trace + propose-admit + survived → admit", yag({}).admit === true);
  t("no trace → reject, no slot needed", (() => { const v = yag({ prdGoal: "gold-plate the dashboard" }); return v.admit === false && v.trace_to_goal === false && /no PRD-goal trace/.test(v.reason); })());
  t("empty prd_goal → reject (trace)", yag({ prdGoal: "" }).admit === false);
  t("methodology proposes reject → conservative reject", (() => { const v = yag({ proposalVerdict: "reject", proposalReason: "unwarranted" }); return v.admit === false && /conservative reject/.test(v.reason); })());
  t("adversarial overturns → conservative reject", (() => { const v = yag({ challenge: "overturned", challengeReason: "gold-plating" }); return v.admit === false && /overturned/.test(v.reason); })());
  t("Phase-2 did not conclude (challenge omitted) → conservative reject", (() => { const v = yag({ challenge: undefined }); return v.admit === false && v.challenge.ran === false && /did not conclude/.test(v.reason); })());
  t("grounding advisory — absent never blocks admit", yag({ groundingPresent: false }).admit === true);
  t("grounding present is shape-carried", yag({ groundingPresent: true }).grounding_present === true);
  t("verdict emits 255's upper shape {admit,reason}", (() => { const v = yag({}); return typeof v.admit === "boolean" && typeof v.reason === "string"; })());
  t("unknown proposal verdict coerces to reject (producer side)", yag({ proposalVerdict: "maybe" }).admit === false);
  t("absent Phase-1 proposal → honest conservative reject (not 'methodology proposed reject')", (() => { const v = yag({ proposalVerdict: undefined }); return v.admit === false && /no methodology \(Phase-1\) proposal supplied/.test(v.reason); })());
  t("explicit methodology reject keeps its own distinct reason", (() => { const v = yag({ proposalVerdict: "reject", proposalReason: "off-mission" }); return v.admit === false && /methodology proposed reject/.test(v.reason); })());
  t("every produced yagni verdict is contract-conformant", [
    yag({}),
    yag({ prdGoal: "nope" }),
    yag({ proposalVerdict: "reject", proposalReason: "x" }),
    yag({ challenge: "overturned", challengeReason: "x" }),
    yag({ challenge: undefined }),
  ].every((v) => computePrdrYagni(v).contractData.conformant === true && computePrdrYagni(v).failLoud == null));
  t("admit verdict round-trips through admit --upper to admit disposition", (() => {
    const up = yag({});
    const v = computePrdrAdmissionVerdict({ actor: "loop", supersedesProvenance: "loop", thrashMax: 3, upper: { admit: up.admit, reason: up.reason } });
    return v.upper.admit === true && v.disposition === "admit";
  })());
  t("reject verdict round-trips through admit --upper to reject disposition", (() => {
    const up = yag({ challenge: "overturned" });
    const v = computePrdrAdmissionVerdict({ actor: "loop", supersedesProvenance: "loop", thrashMax: 3, upper: { admit: up.admit, reason: up.reason } });
    return v.upper.admit === false && v.disposition === "reject";
  })());

  // --- FAFF-815: the three-goal-set model (plural citation, over-scope vs under-citation, Q7 ground) ---
  // D = declared, C = cited, V = DoD-covered. The full predicate-boundary matrix (QA/minor — Q7 risk).
  const D5 = ["g1", "g2", "g3", "g4", "g5"];
  const y815 = (opts) => computePrdrYagniVerdict({ prdGoals: D5, proposalVerdict: "admit", challenge: "survived", ...opts });
  t("815 (WHY): cite-all-five + covers-all-five + survived → admit, trace, no over-scope", (() => {
    const v = y815({ prdGoal: "g1,g2,g3,g4,g5", dodCovers: D5 });
    return v.admit === true && v.trace_to_goal === true && v.over_scope === false;
  })());
  t("815 AC#1: under-citation + overturn(over-scope) → admit, cited_goals widened to C∪V", (() => {
    const v = y815({ prdGoal: "g1", dodCovers: D5, challenge: "overturned", challengeGround: "over-scope" });
    return v.admit === true && v.over_scope === false &&
      JSON.stringify([...v.cited_goals].sort()) === JSON.stringify([...D5].sort());
  })());
  t("815 Q7: under-citation + overturn(unserved) → conservative reject (skeptic authority preserved)", (() => {
    const v = y815({ prdGoal: "g1", dodCovers: D5, challenge: "overturned", challengeGround: "unserved" });
    return v.admit === false && /overturned \(unserved\)/.test(v.reason);
  })());
  t("815 Q7: under-citation + overturn(absent ground ⇒ other) → reject", (() => {
    const v = y815({ prdGoal: "g1", dodCovers: D5, challenge: "overturned" });
    return v.admit === false && v.challenge.ground === "other";
  })());
  t("815 AC#3: genuine over-scope (V⊄D) + survived → reject, over_scope true, names the extra goal", (() => {
    const v = y815({ prdGoal: "g1", dodCovers: ["g1", "analytics dashboard"], challenge: "survived" });
    return v.admit === false && v.over_scope === true && /analytics dashboard/.test(v.reason);
  })());
  t("815: C⊇V (cites all it covers) + overturn(over-scope) → reject (nothing under-cited)", (() => {
    const v = y815({ prdGoal: "g1,g2,g3,g4,g5", dodCovers: D5, challenge: "overturned", challengeGround: "over-scope" });
    return v.admit === false;
  })());
  t("815 back-compat: V=∅ (--dod-covers omitted) + overturn(over-scope) → reject", (() => {
    const v = y815({ prdGoal: "g1", challenge: "overturned", challengeGround: "over-scope" });
    return v.admit === false && v.dod_covers.length === 0 && v.over_scope === false;
  })());
  t("815: V=C=D + survived → admit (clean fully-cited MVP)", y815({ prdGoal: "g1,g2,g3,g4,g5", dodCovers: D5 }).admit === true);
  t("815: empty D/C/V → reject (no trace)", computePrdrYagniVerdict({ prdGoals: [], prdGoal: "", dodCovers: [], proposalVerdict: "admit", challenge: "survived" }).admit === false);
  t("815: legacy single --prd-goal traces + admits as a 1-element set", y815({ prdGoal: "g3", dodCovers: ["g3"] }).admit === true && y815({ prdGoal: "g3" }).trace_to_goal === true);
  t("815 consumer: the under-citation admit is conformant", (() => {
    const v = y815({ prdGoal: "g1", dodCovers: D5, challenge: "overturned", challengeGround: "over-scope" });
    return computePrdrYagni(v).contractData.conformant === true;
  })());
  t("815 consumer: a hand-forged over-scope admit is flagged non-conformant", (() => {
    const forged = { admit: true, reason: "x", trace_to_goal: true, cited_goals: ["g1"], dod_covers: ["g1", "x"], over_scope: true,
      proposal: { serves_goal: true, within_scope: true, verdict: "admit", reason: "" },
      challenge: { ran: true, overturns: false, reason: "", ground: "other" }, grounding_present: false };
    return computePrdrYagni(forged).contractData.conformant === false;
  })());
  t("815 coverage: union of plural prd_goals over one PRDR covers all five (AC#2)", (() => {
    const v = computePrdCoverageVerdict({ prdGoals: D5, livePrdrs: [{ id: "0001", prd_goals: D5 }] });
    return v.covered === true && v.uncovered_goals.length === 0;
  })());
  t("815 coverage: a legacy single prd_goal is still accepted (one goal covered)", (() => {
    const v = computePrdCoverageVerdict({ prdGoals: D5, livePrdrs: [{ id: "0001", prd_goal: "g1" }] });
    return v.covered === false && v.uncovered_goals.length === 4;
  })());
  t("815 parse: plural PRD-goals field + legacy PRD-goal fallback, prd_goal = prd_goals[0]", (() => {
    const tp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-815-"));
    const dd = path.join(tp, "docs", "prdr"); fs.mkdirSync(dd, { recursive: true });
    // FAFF-856: prdrTemplate now always emits the canonical JSON-array citation format, so a
    // legacy bare-comma multi-goal fixture is hand-written directly (bypassing the writer) to
    // exercise the reader's legacy-fallback path — same as the sibling 0002-legacy.md fixture.
    fs.writeFileSync(path.join(dd, "0001-plural.md"), "# PRDR 0001 — plural\n\n- **Status:** Proposed\n- **Provenance:** loop\n- **Date:** 2026-08-16\n- **Container:** c\n- **PRD-goals:** g1, g2, g3\n\n## Context\nx\n\n## Decision\ny\n\n## Scope\nz\n\n## Definition of done\nw\n");
    fs.writeFileSync(path.join(dd, "0002-legacy.md"), "# PRDR 0002 — legacy\n\n- **Status:** Proposed\n- **Provenance:** loop\n- **Date:** 2026-08-16\n- **Container:** c\n- **PRD-goal:** only\n\n## Context\nx\n\n## Decision\ny\n\n## Scope\nz\n\n## Definition of done\nw\n");
    const ll = listPrdrs(dd);
    const a = ll.find((p) => p.num === "0001"), b = ll.find((p) => p.num === "0002");
    const ok = a.prd_goals.length === 3 && a.prd_goals[0] === "g1" && a.prd_goal === "g1" &&
      b.prd_goals.length === 1 && b.prd_goals[0] === "only" && b.prd_goal === "only" && prdrValidate(dd).length === 0;
    fs.rmSync(tp, { recursive: true, force: true });
    return ok;
  })());

  // === FAFF-856: PRD-goals JSON-array storage — comma-in-goal round-trip + new selftest cases ===
  {
    const tp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-856-"));
    const dd = path.join(tp, "docs", "prdr"); fs.mkdirSync(dd, { recursive: true });

    // Comma-in-goal round-trip: the canonical writer emits a JSON array, so a goal whose own
    // text contains a comma survives write→read as exactly one element (not fragmented).
    const commaGoal = "Codes survive an api container restart, proving the datastore is real.";
    fs.writeFileSync(path.join(dd, "0001-commagoal.md"), prdrTemplate({ num: "0001", title: "commagoal", date: "2026-08-18", container: "c", prdGoal: commaGoal, provenance: "loop" }));
    t("856: a goal with an internal comma round-trips as ONE goal, not fragments", (() => {
      const p = listPrdrs(dd).find((x) => x.num === "0001");
      return p.prd_goals.length === 1 && p.prd_goals[0] === commaGoal && p.prd_goal === commaGoal;
    })());
    t("856: prdrTemplate emits the PRD-goals field as a JSON array", /^\s*-\s*\*\*PRD-goals:\*\*\s*\[/m.test(fs.readFileSync(path.join(dd, "0001-commagoal.md"), "utf8")));

    // Legacy bare comma-joined field still parses (no migration, ADR 0111 preserved).
    fs.writeFileSync(path.join(dd, "0002-legacybare.md"), "# PRDR 0002 — legacybare\n\n- **Status:** Proposed\n- **Provenance:** loop\n- **Date:** 2026-08-18\n- **Container:** c\n- **PRD-goals:** g1, g2, g3\n\n## Context\nx\n\n## Decision\ny\n\n## Scope\nz\n\n## Definition of done\nw\n");
    t("856: legacy bare comma-joined PRD-goals still parses (no migration)", (() => {
      const p = listPrdrs(dd).find((x) => x.num === "0002");
      return p.prd_goals.length === 3 && p.prd_goals[1] === "g2";
    })());

    // Non-string element coercion: each JSON-array element is String()-coerced + trimmed; empty/nullish dropped.
    fs.writeFileSync(path.join(dd, "0003-coerce.md"), `# PRDR 0003 — coerce\n\n- **Status:** Proposed\n- **Provenance:** loop\n- **Date:** 2026-08-18\n- **Container:** c\n- **PRD-goals:** ${JSON.stringify(["ok", 42, null, " padded "])}\n\n## Context\nx\n\n## Decision\ny\n\n## Scope\nz\n\n## Definition of done\nw\n`);
    t("856: non-string JSON-array elements are String()-coerced + trimmed, empty/nullish dropped", (() => {
      const p = listPrdrs(dd).find((x) => x.num === "0003");
      return JSON.stringify(p.prd_goals) === JSON.stringify(["ok", "42", "padded"]);
    })());

    // A malformed/pathological JSON-looking value never throws — falls back to the legacy split.
    fs.writeFileSync(path.join(dd, "0004-pathological.md"), "# PRDR 0004 — pathological\n\n- **Status:** Proposed\n- **Provenance:** loop\n- **Date:** 2026-08-18\n- **Container:** c\n- **PRD-goals:** [\"unterminated, oops\n\n## Context\nx\n\n## Decision\ny\n\n## Scope\nz\n\n## Definition of done\nw\n");
    t("856: a pathological JSON-looking PRD-goals value does not throw — falls back to legacy split", (() => {
      let p;
      try { p = listPrdrs(dd).find((x) => x.num === "0004"); } catch { return false; }
      return p != null && p.prd_goals.length > 0;
    })());

    // `prdrValidate` stays presence-only — a malformed-format citation is NOT flagged (human tie-break).
    t("856: prdrValidate does not newly flag a malformed-format citation (presence-only, unchanged)", !prdrValidate(dd).some((p) => /0004-pathological\.md/.test(p)));

    fs.rmSync(tp, { recursive: true, force: true });
  }

  // `new --prd-goals` guard — pinned to the exact coverage/yagni/distance stderr shape, verb name only differs.
  {
    const tp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-856-new-"));
    const dd = path.join(tp, "docs", "prdr");
    const origErr = process.stderr.write, origOut = process.stdout.write;
    // capture BOTH streams — a successful `new` prints the created path to real stdout, which
    // would otherwise leak into the selftest's own console output.
    const capture = () => {
      let buf = "";
      process.stderr.write = (s) => { buf += s; return true; };
      process.stdout.write = () => true;
      return () => { process.stderr.write = origErr; process.stdout.write = origOut; return buf; };
    };

    { const stop = capture();
      const code = cmdPrdr(["new", "T", "--container", "c", "--prd-goals", "not json", "--root", tp]);
      const err = stop();
      t("856: new --prd-goals invalid JSON → exit 2, no record, pinned stderr", code === 2 && /faff prdr new: --prd-goals is not valid JSON:/.test(err) && !fs.existsSync(dd)); }

    { const stop = capture();
      const code = cmdPrdr(["new", "T", "--container", "c", "--prd-goals", "123", "--root", tp]);
      const err = stop();
      t("856: new --prd-goals valid JSON but not an array (number) → exit 2, pinned stderr", code === 2 && /faff prdr new: --prd-goals must be a JSON array of strings/.test(err) && !fs.existsSync(dd)); }

    { const stop = capture();
      const code = cmdPrdr(["new", "T", "--container", "c", "--prd-goals", '{"a":1}', "--root", tp]);
      const err = stop();
      t("856: new --prd-goals valid JSON but not an array (object) → exit 2, pinned stderr", code === 2 && /faff prdr new: --prd-goals must be a JSON array of strings/.test(err) && !fs.existsSync(dd)); }

    { const stop = capture();
      const code = cmdPrdr(["new", "T", "--container", "c", "--root", tp]); // neither --prd-goal nor --prd-goals
      const err = stop();
      t("856: new with neither --prd-goal nor --prd-goals → exit 2", code === 2 && /--prd-goal or --prd-goals is required/.test(err) && !fs.existsSync(dd)); }

    { const stop = capture();
      const code = cmdPrdr(["new", "T", "--container", "c", "--prd-goals", '["g1, has a comma", "g2"]', "--root", tp]);
      stop();
      const file = fs.existsSync(dd) ? fs.readdirSync(dd).find((f) => /^0001-/.test(f)) : null;
      const rec = file ? listPrdrs(dd).find((p) => p.num === "0001") : null;
      t("856: new --prd-goals with a valid JSON array writes a record whose goals round-trip exactly", code === 0 && rec != null && rec.prd_goals.length === 2 && rec.prd_goals[0] === "g1, has a comma"); }

    fs.rmSync(tp, { recursive: true, force: true });
  }

  // --- FAFF-257: the lower (coverage) gate + prd-satisfied roll-up producer ---
  const cov = (opts) => computePrdCoverageVerdict({ prdGoals: ["ship booking", "reduce no-shows"], livePrdrs: [{ id: "0001", prd_goal: "ship booking" }, { id: "0002", prd_goal: "reduce no-shows" }], ...opts });
  t("every goal covered → covered (lower admits)", cov({}).covered === true && cov({}).uncovered_goals.length === 0);
  t("a goal with no live PRDR → uncovered (lower violation, no silent abandonment)", (() => {
    const v = cov({ livePrdrs: [{ id: "0001", prd_goal: "ship booking" }] });
    return v.covered === false && v.uncovered_goals.includes("reduce no-shows");
  })());
  t("supersession dropping a goal's last live PRDR → uncovered (prospective live set excludes it)", (() => {
    // 0002 superseded with no replacement citing "reduce no-shows" → the prospective live set drops it.
    const v = cov({ livePrdrs: [{ id: "0001", prd_goal: "ship booking" }] });
    return v.covered === false && v.satisfied === false && /uncovered goals/.test(v.reason);
  })());
  t("covered + every live PRDR DoD met → prd-satisfied:true (the full roll-up)", (() => {
    const v = cov({ livePrdrs: [{ id: "0001", prd_goal: "ship booking", dod_verdict: "met" }, { id: "0002", prd_goal: "reduce no-shows", dod_verdict: "met" }] });
    return v.covered === true && v.completion.all_met === true && v.satisfied === true && v.reason === "";
  })());
  t("conservative default — absent FAFF-34 verdict ⇒ unverified ⇒ not satisfied (evaluator unbuilt)", (() => {
    const v = cov({}); // no dod_verdict on any live PRDR
    return v.covered === true && v.satisfied === false && v.completion.all_met === false && v.completion.unmet_or_unverified.length === 2 && /unmet\/unverified/.test(v.reason);
  })());
  t("a single unverified DoD blocks prd-satisfied (no false done)", (() => {
    const v = cov({ livePrdrs: [{ id: "0001", prd_goal: "ship booking", dod_verdict: "met" }, { id: "0002", prd_goal: "reduce no-shows" }] });
    return v.covered === true && v.satisfied === false && v.completion.unmet_or_unverified.includes("0002");
  })());
  t("a non-'met' DoD verdict (e.g. 'unmet') is not met", (() => {
    const v = cov({ livePrdrs: [{ id: "0001", prd_goal: "ship booking", dod_verdict: "unmet" }, { id: "0002", prd_goal: "reduce no-shows", dod_verdict: "met" }] });
    return v.satisfied === false && v.completion.unmet_or_unverified.includes("0001");
  })());
  // FAFF-953: a DoD verdict persisted on the record makes a cold coverage read reproduce it.
  const build953 = (dd) => listPrdrs(dd).map((p) => ({ id: p.num, prd_goals: p.prd_goals, prd_goal: p.prd_goal, dod_verdict: p.dod_verdict }));
  t("953: setPrdrDodVerdict writes the field, parse reads it, cold coverage flips to satisfied", (() => {
    const tp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-953-"));
    const dd = path.join(tp, "docs", "prdr"); fs.mkdirSync(dd, { recursive: true });
    fs.writeFileSync(path.join(dd, "0001-mvp.md"), "# PRDR 0001 — mvp\n\n- **Status:** Accepted\n- **Provenance:** loop\n- **Date:** 2026-08-31\n- **Container:** c\n- **PRD-goal:** ship it\n\n## Context\nx\n\n## Decision\ny\n\n## Scope\nz\n\n## Definition of done\nw\n");
    const before = computePrdCoverageVerdict({ prdGoals: ["ship it"], livePrdrs: build953(dd) });
    const wrote = setPrdrDodVerdict(dd, "0001", "met");
    const rec = parsePrdrRecord("0001-mvp.md", fs.readFileSync(path.join(dd, "0001-mvp.md"), "utf8"));
    const after = computePrdCoverageVerdict({ prdGoals: ["ship it"], livePrdrs: build953(dd) });
    return before.satisfied === false && wrote === true && rec.dod_verdict === "met" && after.covered === true && after.satisfied === true;
  })());
  t("953: absent DoD-verdict leaves the record byte-identical and coverage conservative", (() => {
    const tp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-953b-"));
    const dd = path.join(tp, "docs", "prdr"); fs.mkdirSync(dd, { recursive: true });
    const body = "# PRDR 0001 — mvp\n\n- **Status:** Accepted\n- **Provenance:** loop\n- **Date:** 2026-08-31\n- **Container:** c\n- **PRD-goal:** ship it\n\n## Context\nx\n\n## Definition of done\nw\n";
    fs.writeFileSync(path.join(dd, "0001-mvp.md"), body);
    const rec = parsePrdrRecord("0001-mvp.md", body);
    return !("dod_verdict" in rec) && fs.readFileSync(path.join(dd, "0001-mvp.md"), "utf8") === body;
  })());
  t("953: setPrdrDodVerdict replaces an existing field (no duplicate) and returns false for a missing record", (() => {
    const tp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-953c-"));
    const dd = path.join(tp, "docs", "prdr"); fs.mkdirSync(dd, { recursive: true });
    fs.writeFileSync(path.join(dd, "0001-mvp.md"), "# PRDR 0001 — mvp\n\n- **Status:** Accepted\n- **Provenance:** loop\n- **Date:** 2026-08-31\n- **Container:** c\n- **PRD-goal:** g\n- **DoD-verdict:** fails\n\n## Context\nx\n\n## Definition of done\nw\n");
    setPrdrDodVerdict(dd, "0001", "met");
    const text = fs.readFileSync(path.join(dd, "0001-mvp.md"), "utf8");
    const rec = parsePrdrRecord("0001-mvp.md", text);
    return rec.dod_verdict === "met" && (text.match(/DoD-verdict/g) || []).length === 1 && setPrdrDodVerdict(dd, "9999", "met") === false;
  })());
  t("empty PRD (no goals) → vacuously covered, satisfied (additive/pure: a repo with no goals is unchanged)", (() => {
    const v = computePrdCoverageVerdict({ prdGoals: [], livePrdrs: [] });
    return v.covered === true && v.satisfied === true && v.uncovered_goals.length === 0;
  })());
  t("coverage verdict is pure — same inputs, same output (no fs/network read in the producer fn)", (() => {
    const a = JSON.stringify(cov({})); const b = JSON.stringify(cov({}));
    return a === b;
  })());
  t("lower shape feeds prdr admit --lower → reject on uncovered", (() => {
    const v = cov({ livePrdrs: [{ id: "0001", prd_goal: "ship booking" }] });
    const adm2 = computePrdrAdmissionVerdict({ actor: "loop", supersedesProvenance: "loop", thrashMax: 3, lower: { covered: v.covered, uncovered_goals: v.uncovered_goals } });
    return adm2.lower.covered === false && adm2.disposition === "reject";
  })());
  t("covered lower shape feeds prdr admit --lower → admits the lower gate", (() => {
    const v = cov({ livePrdrs: [{ id: "0001", prd_goal: "ship booking", dod_verdict: "met" }, { id: "0002", prd_goal: "reduce no-shows", dod_verdict: "met" }] });
    const adm2 = computePrdrAdmissionVerdict({ actor: "loop", supersedesProvenance: "loop", thrashMax: 3, lower: { covered: v.covered, uncovered_goals: v.uncovered_goals } });
    return adm2.lower.covered === true && adm2.disposition === "admit";
  })());
  t("every produced coverage verdict is contract-conformant", [
    cov({}),
    cov({ livePrdrs: [{ id: "0001", prd_goal: "ship booking" }] }),
    cov({ livePrdrs: [{ id: "0001", prd_goal: "ship booking", dod_verdict: "met" }, { id: "0002", prd_goal: "reduce no-shows", dod_verdict: "met" }] }),
    computePrdCoverageVerdict({ prdGoals: [], livePrdrs: [] }),
  ].every((v) => computePrdCoverage(v).contractData.conformant === true && computePrdCoverage(v).failLoud == null));
  t("consumed arrays are deduped on duplicate caller input (uncovered_goals fed to admit --lower)", (() => {
    const v = computePrdCoverageVerdict({ prdGoals: ["g1", "g1", "g2"], livePrdrs: [{ id: "0001", prd_goal: "g2", dod_verdict: "met" }] });
    return v.uncovered_goals.length === 1 && v.uncovered_goals[0] === "g1" && computePrdCoverage(v).contractData.conformant === true;
  })());

  // --- FAFF-535: the PRD-satisfaction-greedy drain-ordering producer (faff prdr distance) ---
  const dist = (opts) => computePrdDistance({
    prdGoals: ["g1", "g2", "g3"],
    livePrdrs: [{ id: "0001", prd_goal: "g1", container: "portal", dod_verdict: "met" }, { id: "0002", prd_goal: "g2", container: "api" }],
    ...opts,
  });
  t("class ladder: met↦0, absent-verdict↦unverified 1, uncovered goal↦goal entry rank 3", (() => {
    const v = dist({}); // g3 uncovered, A met, B unverified
    const a = v.entries[0], b = v.entries[1], g = v.entries[2];
    return a.id === "0001" && a.distance_class === "met" && a.class_rank === 0 &&
      b.id === "0002" && b.distance_class === "unverified" && b.class_rank === 1 &&
      g.kind === "goal" && g.prd_goal === "g3" && g.distance_class === "uncovered" && g.class_rank === 3;
  })());
  t("entries sorted by (class_rank, id|goal) ascending; first actionable is B", (() => {
    const v = dist({}); return v.entries.map((e) => e.class_rank).join(",") === "0,1,3" && v.entries.find((e) => e.class_rank > 0).id === "0002";
  })());
  t("prd_satisfied echoes the coverage roll-up (false when uncovered)", dist({}).prd_satisfied === false);
  t("dod-verdict merge would satisfy: every goal covered + met → prd_satisfied true", (() => {
    const v = computePrdDistance({ prdGoals: ["g1", "g2"], livePrdrs: [{ id: "0001", prd_goal: "g1", container: "portal", dod_verdict: "met" }, { id: "0002", prd_goal: "g2", container: "api", dod_verdict: "met" }] });
    return v.prd_satisfied === true && v.entries.every((e) => e.distance_class === "met");
  })());
  t("present non-'met' verdict (incl. unknown string) ↦ unmet 2", (() => {
    const v = computePrdDistance({ prdGoals: ["g1"], livePrdrs: [{ id: "0001", prd_goal: "g1", container: "c", dod_verdict: "partial" }] });
    return v.entries[0].distance_class === "unmet" && v.entries[0].class_rank === 2 && v.entries[0].dod_verdict === "partial";
  })());
  t("carries container onto prdr entries (issue↔sibling slug-match input)", dist({}).entries[0].container === "portal");
  t("goal entries carry null id/container/dod_verdict", (() => { const g = dist({}).entries[2]; return g.id === null && g.container === null && g.dod_verdict === null; })());
  t("empty PRD → entries:[], prd_satisfied:true", (() => { const v = computePrdDistance({ prdGoals: [], livePrdrs: [] }); return v.entries.length === 0 && v.prd_satisfied === true; })());
  t("duplicate goals deduped (uncovered set from coverage classifier)", (() => {
    const v = computePrdDistance({ prdGoals: ["g1", "g1", "g2"], livePrdrs: [{ id: "0001", prd_goal: "g2", container: "c", dod_verdict: "met" }] });
    return v.entries.filter((e) => e.kind === "goal").length === 1 && v.entries.find((e) => e.kind === "goal").prd_goal === "g1";
  })());
  t("met-only siblings but goals uncovered → only ranked gaps point at the remaining goal", (() => {
    const v = computePrdDistance({ prdGoals: ["g1", "g2"], livePrdrs: [{ id: "0001", prd_goal: "g1", container: "c", dod_verdict: "met" }] });
    return v.entries.some((e) => e.kind === "goal" && e.prd_goal === "g2") && v.prd_satisfied === false;
  })());
  t("distance producer is pure — same inputs, same output", (() => JSON.stringify(dist({})) === JSON.stringify(dist({})))());
  t("every produced distance verdict is contract-conformant + fail-loud-free", [
    dist({}),
    computePrdDistance({ prdGoals: [], livePrdrs: [] }),
    computePrdDistance({ prdGoals: ["g1"], livePrdrs: [{ id: "0001", prd_goal: "g1", container: "c", dod_verdict: "partial" }] }),
  ].every((v) => { const r = contractPrdDistance(v); return r.failLoud == null && r.contractData.conformant === true; }));
  t("contract validator flags a class_rank/distance_class ladder breach", (() => {
    const r = contractPrdDistance({ entries: [{ kind: "prdr", id: "0001", container: "c", prd_goal: "g", dod_verdict: null, distance_class: "unverified", class_rank: 2 }], prd_satisfied: false });
    return r.failLoud == null && r.contractData.conformant === false && r.contractData.violations.some((s) => /class_rank/.test(s));
  })());
  t("contract validator flags a kind/uncovered biconditional breach", (() => {
    const r = contractPrdDistance({ entries: [{ kind: "goal", id: null, container: null, prd_goal: "g", dod_verdict: null, distance_class: "unmet", class_rank: 2 }], prd_satisfied: false });
    return r.failLoud == null && r.contractData.conformant === false && r.contractData.violations.some((s) => /kind/.test(s));
  })());
  t("contract validator fail-loud on a non-object extraction", contractPrdDistance("not an object").failLoud != null);

  // === FAFF-463: git-landing (accept sole-writer, renumber, git-aware validate tier) ===
  {
    const mkRepo = () => {
      const r = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-git-"));
      git(r, ["init", "-q"]); git(r, ["config", "user.email", "t@t"]); git(r, ["config", "user.name", "t"]);
      git(r, ["commit", "-q", "--allow-empty", "-m", "init"]); git(r, ["checkout", "-q", "-B", "main"]);
      const d = path.join(r, "docs", "prdr"); fs.mkdirSync(d, { recursive: true });
      return { r, d };
    };
    const seed = (d, num = "0001", status) => fs.writeFileSync(path.join(d, `${num}-smoke.md`),
      prdrTemplate({ num, title: "smoke", date: "2026-07-15", container: "c", prdGoal: "g", provenance: "human", status }));
    const statusOf = (d, num = "0001") => (fs.readFileSync(path.join(d, `${num}-smoke.md`), "utf8").match(/^[\s>*-]*\*{0,2}Status[\s*]*:[\s*]*(\S+)/mi) || [])[1];
    const hasLanding = (r) => !!gitOut(r, ["for-each-ref", "--format=%(refname:short)", "refs/heads/prdr/"]);

    // happy path
    { const { r, d } = mkRepo(); seed(d); const res = prdrAccept(d, r, "1", {});
      const out = res.code === 0 ? JSON.parse(res.out) : {};
      t("accept: happy path exits 0, prints branch+base", res.code === 0 && out.branch === "prdr/0001-smoke" && out.base === "main");
      t("accept: original branch restored (main)", gitOut(r, ["symbolic-ref", "--short", "HEAD"]) === "main");
      t("accept: landing branch holds Status Accepted", gitOut(r, ["show", "prdr/0001-smoke:docs/prdr/0001-smoke.md"]).match(/Status:\*\* Accepted/) != null);
      t("accept: exactly one commit on the landing branch touching only the PRDR file",
        gitOut(r, ["show", "--name-only", "--format=", "prdr/0001-smoke"]).trim() === "docs/prdr/0001-smoke.md");
      t("accept: validate on the landing branch is clean (no FAIL, no NOTE)", (() => { git(r, ["switch", "-q", "prdr/0001-smoke"]); const gt = prdrGitTier(d, r, {}); return gt.fails.length === 0 && gt.notes.length === 0; })());
      fs.rmSync(r, { recursive: true, force: true }); }

    // refusals — each mutates nothing
    { const { r, d } = mkRepo(); seed(d, "0001", "Accepted"); const res = prdrAccept(d, r, "1", {});
      t("accept: refuses an already-terminal Status (exit 1)", res.code === 1 && /terminal/.test(res.err) && !hasLanding(r)); fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); seed(d); git(r, ["checkout", "-q", "--detach"]); const res = prdrAccept(d, r, "1", {});
      t("accept: refuses detached HEAD (exit 1), Status unflipped", res.code === 1 && /detached/.test(res.err) && statusOf(d) === "Proposed" && !hasLanding(r)); fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); seed(d); fs.writeFileSync(path.join(r, "other.txt"), "x"); git(r, ["add", "other.txt"]); const res = prdrAccept(d, r, "1", {});
      t("accept: refuses a staged index (exit 1), Status unflipped", res.code === 1 && /staged/.test(res.err) && statusOf(d) === "Proposed" && !hasLanding(r)); fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); seed(d); git(r, ["branch", "prdr/0001-smoke"]); const res = prdrAccept(d, r, "1", {});
      t("accept: refuses an existing landing branch (exit 1), Status unflipped", res.code === 1 && /already exists/.test(res.err) && statusOf(d) === "Proposed"); fs.rmSync(r, { recursive: true, force: true }); }
    { const noGit = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-nogit-")); const d = path.join(noGit, "docs", "prdr"); fs.mkdirSync(d, { recursive: true }); seed(d);
      const res = prdrAccept(d, noGit, "1", {}); t("accept: refuses a non-git tree (exit 1)", res.code === 1 && /not a git/.test(res.err)); fs.rmSync(noGit, { recursive: true, force: true }); }

    // rollback on injected commit failure (a failing pre-commit hook) — file restored, branch restored, landing gone
    { const { r, d } = mkRepo(); seed(d);
      const hooks = path.join(r, ".git", "hooks"); fs.mkdirSync(hooks, { recursive: true });
      fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n"); fs.chmodSync(path.join(hooks, "pre-commit"), 0o755);
      const res = prdrAccept(d, r, "1", {});
      t("accept: rollback on commit failure — exit non-zero", res.code !== 0);
      t("accept: rollback — Status back to Proposed", statusOf(d) === "Proposed");
      t("accept: rollback — original branch restored, landing branch deleted", gitOut(r, ["symbolic-ref", "--short", "HEAD"]) === "main" && !hasLanding(r));
      fs.rmSync(r, { recursive: true, force: true }); }

    // loop-actor gating — the FAFF-255 admit verdict is the key to the writer
    { const { r, d } = mkRepo(); seed(d); const res = prdrAccept(d, r, "1", { actor: "loop" });
      t("accept --actor loop without --admit-verdict → refused (exit 2), no mutation", res.code === 2 && statusOf(d) === "Proposed" && !hasLanding(r)); fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); seed(d); const res = prdrAccept(d, r, "1", { actor: "loop", admitVerdictJson: JSON.stringify({ disposition: "propose-only" }) });
      t("accept --actor loop with a non-admit disposition → refused, Status still Proposed, no branch", res.code !== 0 && statusOf(d) === "Proposed" && !hasLanding(r)); fs.rmSync(r, { recursive: true, force: true }); }

    // --no-branch: commits on the current branch, no branch ops
    { const { r, d } = mkRepo(); seed(d); const res = prdrAccept(d, r, "1", { noBranch: true });
      t("accept --no-branch: commits on current branch, Status Accepted, no landing branch",
        res.code === 0 && gitOut(r, ["symbolic-ref", "--short", "HEAD"]) === "main" && statusOf(d) === "Accepted" && !hasLanding(r) &&
        /accept PRDR-0001/.test(gitOut(r, ["log", "-1", "--format=%s"]))); fs.rmSync(r, { recursive: true, force: true }); }

    // validator git-tier
    { const { r, d } = mkRepo(); seed(d, "0001", "Accepted"); const gt = prdrGitTier(d, r, {});
      t("git-tier: Accepted + untracked → FAIL accepted-uncommitted", gt.fails.some((f) => /accepted-uncommitted/.test(f)) && gt.notes.length === 0); fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); seed(d); const gt = prdrGitTier(d, r, {});
      t("git-tier: Proposed + untracked → NOTE proposed-uncommitted (no FAIL)", gt.notes.some((n) => /proposed-uncommitted/.test(n)) && gt.fails.length === 0); fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); seed(d, "0001", "Accepted"); const gt = prdrGitTier(d, r, { "prdr.validate_git": "off" });
      t("git-tier: validate_git=off → silent (no FAIL)", gt.fails.length === 0 && gt.notes.length === 0); fs.rmSync(r, { recursive: true, force: true }); }
    { const noGit = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-nogit2-")); const d = path.join(noGit, "docs", "prdr"); fs.mkdirSync(d, { recursive: true }); seed(d, "0001", "Accepted");
      t("git-tier: non-git tree → degrades silent (no FAIL)", prdrGitTier(d, noGit, {}).fails.length === 0); fs.rmSync(noGit, { recursive: true, force: true }); }

    // renumber — the merge-collision case: a DUPLICATE number renumbered to next makes the tree contiguous
    { const { r, d } = mkRepo(); seed(d, "0001"); seed(d, "0002");
      fs.writeFileSync(path.join(d, "0002-dup.md"), fs.readFileSync(path.join(d, "0002-smoke.md"), "utf8")); // a second 0002 (collision)
      t("renumber: tree with a duplicate 0002 does not validate", prdrValidate(d).some((p) => /duplicate PRDR number 0002/.test(p)));
      const res = prdrRenumber(d, r, "0002-dup.md", "next");
      t("renumber: duplicate 0002-dup → next (0003) renames + fixes heading + re-validates clean",
        res.code === 0 && fs.existsSync(path.join(d, "0003-dup.md")) && !fs.existsSync(path.join(d, "0002-dup.md")) &&
        /# PRDR 0003 —/.test(fs.readFileSync(path.join(d, "0003-dup.md"), "utf8")) && prdrValidate(d).length === 0);
      fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); seed(d, "0001"); seed(d, "0002");
      const res = prdrRenumber(d, r, "0002-smoke.md", "0001");
      t("renumber: refuses an already-occupied target (exit 1)", res.code === 1 && /already occupied/.test(res.err)); fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); seed(d, "0001");
      const res = prdrRenumber(d, r, "0001-smoke.md", "abc");
      t("renumber: refuses a non-numeric --to (exit 2), never mints a regex-invalid filename", res.code === 2 && /must be "next" or a 1–4 digit/.test(res.err) && fs.existsSync(path.join(d, "0001-smoke.md")) && prdrValidate(d).length === 0); fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); seed(d, "0001"); const res = prdrRenumber(d, r, "0001-smoke.md", "0001");
      t("renumber: to the same number is a no-op exit 0", res.code === 0 && /no-op/.test(res.out)); fs.rmSync(r, { recursive: true, force: true }); }
  }

  // === FAFF-875: `faff prdr land --local` — land an Accepted doc-only PRDR onto `main` ===
  {
    const mkRepo = () => {
      const r = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-land-"));
      git(r, ["init", "-q", "-b", "main"]); git(r, ["config", "user.email", "t@t"]); git(r, ["config", "user.name", "t"]);
      fs.writeFileSync(path.join(r, "README.md"), "seed\n");
      const d = path.join(r, "docs", "prdr"); fs.mkdirSync(d, { recursive: true });
      git(r, ["add", "-A"]); git(r, ["commit", "-q", "-m", "init"]);
      return { r, d };
    };
    // Author the PRDR WITHOUT committing it to base, then accept — this is the exact "authored
    // but stranded, coverage reads 0/5" repro shape (the record's only-ever appearance in git
    // history is the accept commit ON the landing branch): the tougher, load-bearing case for
    // AC #8's uncovered→covered transition (a record already committed to base as Proposed
    // already trivially "covers" its goal — citation is status-blind — so ONLY the never-on-base
    // case actually exercises the transition this ticket exists to fix).
    // `cmdPrdr(["new", ...])` prints the created path to real stdout on success — suppress it here
    // (mirrors the FAFF-856 `new --prd-goals` guard block's own capture() above) so this block's
    // fixture setup doesn't flood the selftest's console output.
    const silently = (fn) => { const orig = process.stdout.write; process.stdout.write = () => true; try { return fn(); } finally { process.stdout.write = orig; } };
    const authorAndAccept = (r, d, opts = {}) => {
      const newRes = silently(() => cmdPrdr(["new", opts.title || "Widget", "--container", "c", "--prd-goal", opts.goal || "ship it", "--root", r]));
      const acceptRes = prdrAccept(d, r, "1", {});
      return { newRes, acceptRes };
    };

    // AC #2 — remote present (or indeterminate) → refuse exit 2, base never advanced.
    { const { r, d } = mkRepo(); authorAndAccept(r, d);
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-land-bare-")); git(bare, ["init", "-q", "--bare"]);
      git(r, ["remote", "add", "origin", bare]);
      const before = gitOut(r, ["rev-parse", "main"]);
      const res = prdrLand(d, r, "1", {});
      t("land: repo WITH a remote → refuse exit 2, base unchanged", res.code === 2 && /repo has a remote/.test(res.err) && gitOut(r, ["rev-parse", "main"]) === before);
      fs.rmSync(r, { recursive: true, force: true }); }

    // AC #3 — non-Accepted (Proposed) landing branch → refuse.
    { const { r, d } = mkRepo(); silently(() => cmdPrdr(["new", "Widget", "--container", "c", "--prd-goal", "g", "--root", r]));
      git(r, ["add", "-A"]); git(r, ["commit", "-q", "-m", "add widget"]);
      git(r, ["branch", "prdr/0001-widget"]); // a landing-shaped branch, but never actually accepted (still Proposed)
      const res = prdrLand(d, r, "1", {});
      t("land: a non-Accepted (Proposed) landing branch → refuse", res.code === 1 && /not Accepted/.test(res.err));
      fs.rmSync(r, { recursive: true, force: true }); }

    // AC #3 — landing branch absent → refuse.
    { const { r, d } = mkRepo(); silently(() => cmdPrdr(["new", "Widget", "--container", "c", "--prd-goal", "g", "--root", r]));
      const res = prdrLand(d, r, "1", {});
      t("land: no matching landing branch → refuse", res.code === 1 && /no landing branch matching/.test(res.err));
      fs.rmSync(r, { recursive: true, force: true }); }

    // AC #4 — non-ff-descendant (base moved independently since accept) → refuse.
    { const { r, d } = mkRepo(); authorAndAccept(r, d);
      fs.appendFileSync(path.join(r, "README.md"), "more\n"); git(r, ["add", "-A"]); git(r, ["commit", "-q", "-m", "base moves"]);
      const res = prdrLand(d, r, "1", {});
      t("land: base moved (non-ff) → refuse, names rebase remedy", res.code === 1 && /not a fast-forward descendant/.test(res.err) && /rebase/.test(res.err));
      fs.rmSync(r, { recursive: true, force: true }); }

    // AC #4 — the base is DIRTY in the invoking worktree (Case C) → refuse, nothing landed.
    { const { r, d } = mkRepo(); authorAndAccept(r, d);
      fs.writeFileSync(path.join(r, "README.md"), "uncommitted local edit\n"); // dirty, never staged/committed
      const beforeSha = gitOut(r, ["rev-parse", "main"]);
      const res = prdrLand(d, r, "1", {});
      t("land: a dirty invoking worktree (base checked out there) → refuse, base unchanged", res.code === 1 && /uncommitted changes/.test(res.err) && gitOut(r, ["rev-parse", "main"]) === beforeSha);
      fs.rmSync(r, { recursive: true, force: true }); }

    // AC #4 — path-segment safety, unit-level: `landPathAllowed` rejects traversal segments
    // (`.`/`..`) and any path not segment-anchored under the prefix, admits a genuine record path.
    { const prefix = "docs/prdr";
      t("landPathAllowed: rejects a `..` traversal segment", landPathAllowed(`${prefix}/../secrets.md`, prefix) === false);
      t("landPathAllowed: rejects a `.` segment", landPathAllowed(`${prefix}/./x.md`, prefix) === false);
      t("landPathAllowed: rejects a sibling-prefix escape (bare startsWith would wrongly admit this)", landPathAllowed("docs/prdr-notes/evil.js", prefix) === false);
      t("landPathAllowed: rejects an empty segment (doubled slash)", landPathAllowed(`${prefix}//x.md`, prefix) === false);
      t("landPathAllowed: admits a genuine record path under the prefix", landPathAllowed(`${prefix}/0001-x.md`, prefix) === true);
      t("landPathAllowed: admits the prefix itself (the spec's own f===prefix clause)", landPathAllowed(prefix, prefix) === true); }

    // AC #4 — a changed path OUTSIDE the PRDR directory (sibling-prefix escape) → refuse.
    { const { r, d } = mkRepo(); authorAndAccept(r, d);
      git(r, ["checkout", "-q", "prdr/0001-widget"]);
      fs.mkdirSync(path.join(r, "docs", "prdr-notes"), { recursive: true });
      fs.writeFileSync(path.join(r, "docs", "prdr-notes", "evil.js"), "x\n");
      git(r, ["add", "-A"]); git(r, ["commit", "-q", "-m", "sibling-prefix escape"]);
      git(r, ["checkout", "-q", "main"]);
      const res = prdrLand(d, r, "1", {});
      t("land: a changed path outside the PRDR dir (sibling-prefix escape) → refuse", res.code === 1 && /is outside the PRDR directory/.test(res.err) && /prdr-notes\/evil\.js/.test(res.err));
      fs.rmSync(r, { recursive: true, force: true }); }

    // AC #5 — candidate validation FAIL (a missing body section on the landing tree) blocks the land.
    { const { r, d } = mkRepo(); authorAndAccept(r, d);
      git(r, ["checkout", "-q", "prdr/0001-widget"]);
      const p = path.join(d, "0001-widget.md");
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/## Definition of done[\s\S]*$/, ""));
      git(r, ["add", "-A"]); git(r, ["commit", "-q", "-m", "drop a required section"]);
      git(r, ["checkout", "-q", "main"]);
      const res = prdrLand(d, r, "1", {});
      t("land: candidate validation FAIL (missing section) blocks the land", res.code === 1 && /missing "## Definition of done"/.test(res.err));
      fs.rmSync(r, { recursive: true, force: true }); }

    // AC #6 + #8 — happy path (single-worktree, invoking worktree ON base): ff-advance via
    // in-place merge, working tree reflects the landed record, JSON result shape, persisted
    // landing record under --run-dir/--issue, and coverage moves uncovered→covered.
    { const { r, d } = mkRepo(); authorAndAccept(r, d, { goal: "ship booking" });
      const beforeCov = computePrdCoverageVerdict({ prdGoals: ["ship booking"], livePrdrs: listPrdrs(d).map((p) => ({ id: p.num, prd_goals: p.prd_goals, prd_goal: p.prd_goal })) });
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prdr-land-rundir-"));
      const beforeSha = gitOut(r, ["rev-parse", "main"]);
      const res = prdrLand(d, r, "1", { runDir, issue: "FAFF-TEST", prdGoalsRaw: JSON.stringify(["ship booking"]) });
      let out = {}; try { out = JSON.parse(res.out || "{}"); } catch { /* fall through to failing assertions */ }
      t("land: happy path exits 0", res.code === 0);
      t("land: BEFORE land, coverage does not yet count the Accepted-but-unmerged record", beforeCov.covered === false);
      t("land: result carries {landed:true, old_base_sha, new_base_sha, coverage}", out.landed === true && out.old_base_sha === beforeSha && typeof out.new_base_sha === "string" && out.coverage && typeof out.coverage === "object");
      t("land: AFTER land, coverage counts the now-landed record (uncovered → covered)", out.coverage.covered === true);
      t("land: base ref advanced to the landing tip", gitOut(r, ["rev-parse", "main"]) === out.new_base_sha);
      t("land: invoking worktree's own index/working tree reflect the landed record (in-place ff)", fs.readFileSync(path.join(d, "0001-widget.md"), "utf8").includes("Accepted"));
      t("land: a landing record is persisted under --run-dir/--issue", fs.existsSync(path.join(runDir, "FAFF-TEST", "prdr-landing-0001.json")));
      t("land: the persisted record matches the stdout JSON", (() => {
        try { return JSON.parse(fs.readFileSync(path.join(runDir, "FAFF-TEST", "prdr-landing-0001.json"), "utf8")).new_base_sha === out.new_base_sha; } catch { return false; }
      })());
      fs.rmSync(r, { recursive: true, force: true }); fs.rmSync(runDir, { recursive: true, force: true }); }

    // AC #7 — a concurrent base move during the Case-A `update-ref` compare-and-swap aborts the
    // land (no partial advance). Exercised directly against the shared `landBaseFfOnly` (the same
    // helper `land` calls) with a deliberately STALE `baseShaBefore` — the mechanical shape of
    // "base moved between read and advance", independent of any real timing race.
    { const { r, d } = mkRepo(); authorAndAccept(r, d);
      const staleBaseSha = gitOut(r, ["rev-parse", "main"]);
      // Move `main` for real (simulating a peer's concurrent advance) before our own land call.
      git(r, ["checkout", "-q", "main"]); fs.appendFileSync(path.join(r, "README.md"), "peer advanced\n");
      git(r, ["add", "-A"]); git(r, ["commit", "-q", "-m", "a peer's concurrent advance"]);
      const tipSha = gitOut(r, ["rev-parse", "prdr/0001-widget"]);
      const beforeSha = gitOut(r, ["rev-parse", "main"]);
      const adv = landBaseFfOnly({ cwd: r, base: "main", tipSha, baseShaBefore: staleBaseSha, allowInPlace: true });
      t("land (CAS): a concurrent base move aborts the update-ref CAS — refused, not ok", adv.ok === false);
      t("land (CAS): base ref is UNCHANGED by the aborted attempt (no partial advance)", gitOut(r, ["rev-parse", "main"]) === beforeSha);
      fs.rmSync(r, { recursive: true, force: true }); }

    // D6 — `accept` alone (no `land`) never moves coverage: the goal stays uncovered until landed.
    { const { r, d } = mkRepo(); authorAndAccept(r, d, { goal: "reduce no-shows" });
      const cov = computePrdCoverageVerdict({ prdGoals: ["reduce no-shows"], livePrdrs: listPrdrs(d).map((p) => ({ id: p.num, prd_goals: p.prd_goals, prd_goal: p.prd_goal })) });
      t("land: accept alone (base copy absent) never moves coverage — still uncovered", cov.covered === false);
      fs.rmSync(r, { recursive: true, force: true }); }
  }

  let failed = 0;
  for (const [name, ok] of cases) { if (!ok) { process.stderr.write(`prdr --selftest FAIL: ${name}\n`); failed++; } }
  if (failed) { process.stderr.write(`prdr --selftest: ${failed}/${cases.length} failed\n`); return 1; }
  console.log(`prdr --selftest: ok (${cases.length} cases)`);
  return 0;
}


module.exports = { PRDR_FILE_RE, PRDR_PROVENANCES, PRDR_SECTIONS, PRDR_STATUSES, PRDR_SPEC, PRDR_SURFACE, cmdPrdr, landCandidateProblems, landPathAllowed, listPrdrs, listPrdrsAtRef, prdrAccept, prdrDir, prdrGitTier, prdrLand, prdrNextNumber, prdrRenumber, prdrSelftest, prdrTemplate, prdrValidate, setPrdrDodVerdict };
