// ===========================================================================
// === region:factory — prdr — product requirements DECISION records (FAFF-245; design/prdrs.md). The ===
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
  "--live": { arity: 0 }, "--new-capability": { arity: 0 }, "--no-branch": { arity: 0 }, "--self": { arity: 0 },
  "--selftest": { arity: 0 }, "--serves-goal": { arity: 0 }, "--within-scope": { arity: 0 },
  "--actor": { arity: 1 }, "--admit-verdict": { arity: 1 }, "--by": { arity: 1 }, "--challenge": { arity: 1 },
  "--challenge-reason": { arity: 1 }, "--container": { arity: 1 }, "--date": { arity: 1 }, "--dod-verdicts": { arity: 1 },
  "--lineage-supersessions": { arity: 1 }, "--live-prdrs": { arity: 1 }, "--lower": { arity: 1 },
  "--prd-goal": { arity: 1 }, "--prd-goals": { arity: 1 }, "--proposal": { arity: 1 }, "--proposal-reason": { arity: 1 },
  "--provenance": { arity: 1 }, "--ref-scope": { arity: 1 }, "--root": { arity: 1 }, "--status": { arity: 1 },
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
    new: { required_flags: ["--container", "--prd-goal"] },
    supersede: { required_flags: ["--by"] },
    admit: { required_flags: [] },
    yagni: { required_flags: [] },
    coverage: { required_flags: [] },
    distance: { required_flags: [] },
  },
};
const { DEFAULTS, loadConfig, resolvePrdrDocsPath } = require("./config");
const { PRDR_ACTORS, PRDR_SUPERSEDES, PRDR_YAGNI_PROPOSAL_VERDICTS, computePrdCoverage, computePrdCoverageVerdict, computePrdDistance, contractPrdDistance, computePrdrAdmission, computePrdrAdmissionVerdict, computePrdrYagni, computePrdrYagniVerdict } = require("./contract-defs");
const { schemaCheck } = require("./contract-engine");
const { dig, findRoot } = require("./shared-infra");

const PRDR_STATUSES = ["Proposed", "Accepted", "Rejected", "Superseded"];
const PRDR_PROVENANCES = ["human", "loop"];
const PRDR_SECTIONS = ["Context", "Decision", "Scope", "Definition of done"];
const PRDR_FILE_RE = /^(\d{4})-(.+)\.md$/;

function prdrDir(root) { return path.join(root, resolvePrdrDocsPath(root, loadConfig(root)[0], false)); }

function listPrdrs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(PRDR_FILE_RE);
    if (!m) continue;
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const titleM = text.match(/^#\s*PRDR\s+\d+\s*[—\-]\s*(.+)$/mi);
    out.push({
      number: parseInt(m[1], 10), num: m[1], slug: m[2], file: f,
      title: titleM ? titleM[1].trim() : null,
      container: adrField(text, "Container"),
      prd_goal: adrField(text, "PRD-goal"),
      status: adrField(text, "Status"),
      provenance: adrField(text, "Provenance"),
      date: adrField(text, "Date"),
    });
  }
  return out.sort((a, b) => a.number - b.number);
}

function prdrNextNumber(dir) {
  const max = listPrdrs(dir).reduce((m, a) => Math.max(m, a.number), 0);
  return String(max + 1).padStart(4, "0");
}

function prdrTemplate({ num, title, date, container, prdGoal, provenance, status }) {
  const lines = [`# PRDR ${num} — ${title}`, "",
    `- **Status:** ${status || "Proposed"}`,
    `- **Provenance:** ${provenance || "human"}`,
    `- **Date:** ${date}`,
    `- **Container:** ${container}`,
    `- **PRD-goal:** ${prdGoal}`, "",
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
    if (!a.prd_goal) problems.push(`${a.file}: missing PRD-goal field`);
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
  fs.writeFileSync(filePath, orig.replace(/^([\s>*-]*\*{0,2}Status[\s*]*:[\s*]*).*$/mi, "$1Accepted"));
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
      console.log(JSON.stringify(prdrs.map(({ number, num, title, container, prd_goal, status, provenance, date, file }) =>
        ({ number, id: num, title, container, prd_goal, status, provenance, date, file })), null, 2));
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
    const reqErr = requireFlags(parsed.values, PRDR_SURFACE.subcommands.new, "prdr", "new");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    const provenance = get("--provenance");
    if (provenance && !PRDR_PROVENANCES.includes(provenance)) { process.stderr.write(`faff prdr new: --provenance must be one of ${PRDR_PROVENANCES.join("|")}\n`); return 2; }
    const date = get("--date") || new Date().toISOString().slice(0, 10);
    const num = prdrNextNumber(dir);
    const file = `${num}-${adrSlug(title)}.md`;
    const full = path.join(dir, file);
    if (fs.existsSync(full)) { process.stderr.write(`faff prdr new: ${file} already exists — never overwrite (append-only)\n`); return 1; }
    fs.mkdirSync(dir, { recursive: true });
    // provenance default = human (fail-safe: the harder-to-supersede tier; the loop passes --provenance loop).
    fs.writeFileSync(full, prdrTemplate({ num, title, date, container, prdGoal, provenance: provenance || "human", status: get("--status") }));
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
    const verdict = computePrdrYagniVerdict({
      prdGoal, prdGoals,
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
      livePrdrs = prdrs.map((p) => ({ id: p.num, prd_goal: p.prd_goal }));
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
      livePrdrs = prdrs.map((p) => ({ id: p.num, prd_goal: p.prd_goal, container: p.container }));
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

  process.stderr.write("faff prdr: expected one of: path | new | list | supersede | validate | admit | yagni | coverage | distance (or --selftest)\n");
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

  let failed = 0;
  for (const [name, ok] of cases) { if (!ok) { process.stderr.write(`prdr --selftest FAIL: ${name}\n`); failed++; } }
  if (failed) { process.stderr.write(`prdr --selftest: ${failed}/${cases.length} failed\n`); return 1; }
  console.log(`prdr --selftest: ok (${cases.length} cases)`);
  return 0;
}


module.exports = { PRDR_FILE_RE, PRDR_PROVENANCES, PRDR_SECTIONS, PRDR_STATUSES, PRDR_SPEC, PRDR_SURFACE, cmdPrdr, listPrdrs, prdrAccept, prdrDir, prdrGitTier, prdrNextNumber, prdrRenumber, prdrSelftest, prdrTemplate, prdrValidate };
