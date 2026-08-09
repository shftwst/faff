// ===========================================================================
// === region:factory — adr — architecture decision records (FAFF-16). Deterministic mechanics over the ===
// repo's configurable append-only ADR log: number / scaffold / list / validate.
// The judgement (is a decision significant? record it?) stays with the human in faff-prep;
// this command owns only the mechanical parts. Append-only: `new` never overwrites.
// FAFF-199 (ADR L4): adds an optional Provenance field (human|loop, default human — the
// harder-to-supersede tier) + the `admit` two-gate action, porting ADR 0022's PRDR pattern onto
// the ADR axis so the loop may supersede its OWN loop-provenance ADRs under a deterministic gate.
// `supersede`/`recordSupersede` stay authority-blind — enforcement lives only in `admit`.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { parseArgs, requireFlags, usageError } = require("./argv");
const ADR_SPEC = { flags: {
  "--json": { arity: 0 }, "--self": { arity: 0 }, "--selftest": { arity: 0 },
  "--actor": { arity: 1 }, "--by": { arity: 1 }, "--challenge": { arity: 1 }, "--date": { arity: 1 },
  "--exclude": { arity: 1 }, "--initiative": { arity: 1 }, "--issue": { arity: 1 },
  "--lineage-supersessions": { arity: 1 }, "--provenance": { arity: 1 }, "--ref-scope": { arity: 1 },
  "--root": { arity: 1 }, "--status": { arity: 1 }, "--supersedes-provenance": { arity: 1 },
  "--thrash-max": { arity: 1 }, "--title": { arity: 1 }, "--to": { arity: 1 },
}, positionals: { min: 0, max: null, name: "verb selector" } };
// FAFF-628 — the declared grammar `faff cli-surface --json` aggregates + the drift-guard's
// flag-layer assertions read. Only the unconditional checks the handler already enforces are
// declared — a conditional/positional-selector check (accept/admit's <selector>, --actor's
// enum) stays ad-hoc in the handler (see FAFF-628 spec §2 OUT OF SCOPE).
const ADR_SURFACE = {
  kind: "subcommand_dispatch",
  spec: ADR_SPEC,
  subcommands: {
    "next-number": { required_flags: [] },
    list: { required_flags: [] },
    "live-decisions": { required_flags: [] },
    validate: { required_flags: [] },
    accept: { required_flags: [] },
    new: { required_flags: ["--title"] },
    supersede: { required_flags: ["--by"] },
    admit: { required_flags: [] },
    renumber: { required_flags: ["--to"] },
  },
};
// FAFF-199: PRDR_ACTORS/PRDR_SUPERSEDES are reused verbatim (aliased) — the actor/supersedes
// vocabularies are identical across the ADR and PRDR admission axes (design principle: share
// enum constants where identical, don't fork a byte-identical enum under a new name).
const { PRDR_ACTORS: ADR_ACTORS, PRDR_SUPERSEDES: ADR_SUPERSEDES, computeAdrAdmission, computeAdrAdmissionVerdict } = require("./contract-defs");
const { schemaCheck } = require("./contract-engine");
const { DEFAULTS, loadConfig, resolveAdrDocsPath } = require("./config");
const { dig, findRoot } = require("./shared-infra");

const ADR_STATUSES = ["Proposed", "Accepted", "Superseded", "Deprecated", "Rejected"];
const ADR_PROVENANCES = ["human", "loop"];
const ADR_FILE_RE = /^(\d{4})-(.+)\.md$/;

function adrDir(root) { return path.join(root, resolveAdrDocsPath(root, loadConfig(root)[0], false)); }

function adrSlug(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "adr";
}

// Match a header field "- **Status:** value" / "- Status: value" (bold optional). Existing
// ADRs carry freeform trailing text (e.g. "Accepted (spike outcome …)"), so the value is the
// whole remainder; callers interpret only its leading token.
function adrField(text, name) {
  // Tolerate every bold/colon arrangement: "- **Status:** v", "- **Status**: v", "- Status: v".
  // Leading "[\s>*-]*" eats list/bold markers; a colon is MANDATORY (so a prose line merely
  // starting with the field word — "Status quo …" — is not mis-read as the field); the value
  // begins at the first non-space/non-asterisk char and runs to end of line.
  const m = text.match(new RegExp(`^[\\s>*-]*${name}[\\s*]*:[\\s*]*([^\\s*].*)$`, "mi"));
  return m ? m[1].trim() : null;
}

function listAdrs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(ADR_FILE_RE);
    if (!m) continue;
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const titleM = text.match(/^#\s*ADR\s+\d+\s*[—\-]\s*(.+)$/mi);
    out.push({
      number: parseInt(m[1], 10), num: m[1], slug: m[2], file: f,
      title: titleM ? titleM[1].trim() : null,
      status: adrField(text, "Status"), date: adrField(text, "Date"),
      // FAFF-199: read-time default — absent Provenance ⇒ "human" (the harder-to-supersede tier;
      // no back-fill of the 66 legacy files). A present-but-bad value (e.g. "robot") passes through
      // unchanged here so adrValidate can flag it; only genuine absence defaults.
      provenance: adrField(text, "Provenance") || "human",
    });
  }
  return out.sort((a, b) => a.number - b.number);
}

function adrNextNumber(dir) {
  const max = listAdrs(dir).reduce((m, a) => Math.max(m, a.number), 0);
  return String(max + 1).padStart(4, "0");
}

// FAFF-197: canonical supersession refs. OLD carries `Status: Superseded by ADR-NNNN`;
// NEW carries `Supersedes: ADR-MMMM`. These extract the referenced number (zero-padded), and
// match ONLY the canonical form — freeform legacy lines ("Supersedes / unblocks: FAFF-77",
// a "Feeds:" line) are not matched, so the existing hand-written ADRs are never flagged.
//
// FAFF-245: parameterised by record `prefix` ("ADR" | "PRDR") so the PRDR record mechanic
// reuses the exact supersession ref-parsers verbatim (no fork). The `adr*` names below are
// thin, behaviour-preserving wrappers; `prdr` calls the core with prefix "PRDR".
function recordSupersededBy(status, prefix) {
  const m = status && status.match(new RegExp(`^Superseded\\s+by\\s+${prefix}[-\\s]?(\\d{1,4})\\b`, "i"));
  return m ? m[1].padStart(4, "0") : null;
}
// ALL canonical `Supersedes: <prefix>-NNNN` refs (a colon must follow "Supersedes" → legacy
// "Supersedes / unblocks: FAFF-77" is not matched). A Set, because one record may consolidate
// several predecessors (multiple Supersedes lines) — returning only the first would false-fail validate.
function recordSupersedesSet(text, prefix) {
  const out = new Set();
  for (const m of text.matchAll(/^[\s>*-]*Supersedes[\s*]*:[\s*]*([^\n]+)$/gim)) {
    const r = m[1].match(new RegExp(`\\b${prefix}[-\\s]?(\\d{1,4})\\b`, "i"));
    if (r) out.add(r[1].padStart(4, "0"));
  }
  return out;
}
function adrSupersededBy(status) { return recordSupersededBy(status, "ADR"); }
function adrSupersedesSet(text) { return recordSupersedesSet(text, "ADR"); }

// FAFF-245: the symmetric supersession back-reference check, parameterised by `prefix`. Both
// `adrValidate` and `prdrValidate` call this — the "reuse the symmetric validator" mandate.
// `records` = listAdrs/listPrdrs output; `texts` = Map(num → file text). Returns problem strings.
function recordSupersessionProblems(records, texts, prefix) {
  const problems = [];
  const byNum = new Map(records.map((a) => [a.num, a]));
  for (const a of records) {
    const supBy = recordSupersededBy(a.status, prefix);   // a: "Superseded by <prefix>-<supBy>"
    if (supBy) {
      if (!byNum.has(supBy)) problems.push(`${a.file}: superseded by missing ${prefix}-${supBy}`);
      else if (!recordSupersedesSet(texts.get(supBy), prefix).has(a.num)) problems.push(`${a.file}: asymmetric supersession — ${prefix}-${supBy} does not record "Supersedes: ${prefix}-${a.num}"`);
    }
    for (const sup of recordSupersedesSet(texts.get(a.num), prefix)) {   // a may supersede several predecessors
      if (!byNum.has(sup)) problems.push(`${a.file}: supersedes missing ${prefix}-${sup}`);
      else if (recordSupersededBy(byNum.get(sup).status, prefix) !== a.num) problems.push(`${a.file}: asymmetric supersession — ${prefix}-${sup} not marked "Superseded by ${prefix}-${a.num}"`);
    }
  }
  return problems;
}

// FAFF-245: the supersede WRITE — the one place the CLI edits an existing record (Status value +
// one idempotent Supersedes line). Parameterised by `prefix` so `adr` and `prdr` share it exactly
// (mirror `adr supersede` verbatim — a pure mechanical linker, NO actor/authority concept). Pure
// except the two fs.writeFileSync; returns { code, out, err } for the caller to surface.
function recordSupersede(dir, root, records, oldTok, newTok, prefix) {
  if (!oldTok || !newTok) return { code: 2, out: "", err: `usage: faff ${prefix.toLowerCase()} supersede <old> --by <new>\n` };
  const rel = path.relative(root, dir) || dir;
  const resolve = (tok) => {
    const d = String(tok).match(/^(\d{1,4})/);
    return d ? records.find((a) => a.num === d[1].padStart(4, "0")) || null : null;
  };
  const oldA = resolve(oldTok), newA = resolve(newTok);
  if (!oldA) return { code: 1, out: "", err: `faff ${prefix.toLowerCase()} supersede: no ${prefix} matching "${oldTok}" in ${rel}\n` };
  if (!newA) return { code: 1, out: "", err: `faff ${prefix.toLowerCase()} supersede: no ${prefix} matching "${newTok}"\n` };
  if (oldA.num === newA.num) return { code: 1, out: "", err: `faff ${prefix.toLowerCase()} supersede: a ${prefix} cannot supersede itself\n` };
  const already = recordSupersededBy(oldA.status, prefix);
  if (already) return { code: 1, out: "", err: `faff ${prefix.toLowerCase()} supersede: ${prefix}-${oldA.num} is already superseded by ${prefix}-${already}\n` };

  // OLD: replace the Status VALUE only (preserve the "- **Status:** " prefix); body untouched.
  const oldPath = path.join(dir, oldA.file);
  const oldText = fs.readFileSync(oldPath, "utf8")
    .replace(/^([\s>*-]*\*{0,2}Status[\s*]*:[\s*]*).*$/mi, `$1Superseded by ${prefix}-${newA.num}`);
  fs.writeFileSync(oldPath, oldText);

  // NEW: add "- **Supersedes:** <prefix>-<old>" once (idempotent), after the Status line.
  const newPath = path.join(dir, newA.file);
  let newText = fs.readFileSync(newPath, "utf8");
  if (!recordSupersedesSet(newText, prefix).has(oldA.num)) {   // idempotent + supports multiple predecessors
    const supLine = `- **Supersedes:** ${prefix}-${oldA.num}`;
    newText = /^[\s>*-]*\*{0,2}Status[\s*]*:/mi.test(newText)
      ? newText.replace(/^([\s>*-]*\*{0,2}Status[\s*]*:.*)$/mi, `$1\n${supLine}`)
      : newText.replace(new RegExp(`^(#\\s*${prefix}.*)$`, "mi"), `$1\n\n${supLine}`);
    fs.writeFileSync(newPath, newText);
  }
  return { code: 0, out: `${oldPath}\n${newPath}\n`, err: "" };
}

// Returns a list of problem strings (empty = valid). Lenient by design so the existing
// hand-written ADRs pass: a field must be PRESENT and Status must START WITH a known word.
function adrValidate(dir) {
  const adrs = listAdrs(dir);
  const problems = [];
  const texts = new Map();
  for (const a of adrs) {
    const text = fs.readFileSync(path.join(dir, a.file), "utf8");
    texts.set(a.num, text);
    const titleM = text.match(/^#\s*ADR\s+(\d+)\s*[—\-]\s*.+$/mi);
    if (!titleM) problems.push(`${a.file}: missing '# ADR NNNN — Title' heading`);
    else if (parseInt(titleM[1], 10) !== a.number) problems.push(`${a.file}: heading number ADR ${titleM[1]} != filename ${a.num}`);
    if (!a.status) problems.push(`${a.file}: missing Status field`);
    else if (!ADR_STATUSES.some((s) => new RegExp(`^${s}`, "i").test(a.status))) problems.push(`${a.file}: Status "${a.status.slice(0, 30)}" must start with one of ${ADR_STATUSES.join("|")}`);
    if (!a.date) problems.push(`${a.file}: missing Date field`);
    // FAFF-199: legacy-lenient — Provenance is NEVER required (unlike PRDR, born with it; the 66
    // existing ADRs carry none and must keep validating clean). `a.provenance` is already
    // read-time-defaulted to "human" by listAdrs, so this only ever fires on a genuinely present,
    // out-of-enum value (e.g. "Provenance: robot").
    if (!ADR_PROVENANCES.some((p) => new RegExp(`^${p}$`, "i").test(a.provenance.trim()))) problems.push(`${a.file}: Provenance "${a.provenance.slice(0, 30)}" must be one of ${ADR_PROVENANCES.join("|")}`);
  }
  // FAFF-368: a duplicate number names EVERY colliding filename (one message per number),
  // so both the CI backstop and the graft merge-guard can identify which files collide
  // without a second scan. `listAdrs` is already read; grouping is free.
  const byNum = new Map();
  for (const a of adrs) { if (!byNum.has(a.num)) byNum.set(a.num, []); byNum.get(a.num).push(a.file); }
  for (const [num, files] of byNum) {
    if (files.length > 1) problems.push(`duplicate ADR number ${num} — ${files.join(", ")}`);
  }
  const seen = new Set(adrs.map((a) => a.number));
  for (let i = 1; i <= adrs.length; i++) {
    if (!seen.has(i)) problems.push(`numbering gap: ADR ${String(i).padStart(4, "0")} missing (expected contiguous 0001..${String(adrs.length).padStart(4, "0")})`);
  }
  // FAFF-197: canonical supersession back-references must resolve + be symmetric, BOTH directions.
  // FAFF-245: shared, prefix-parameterised — `prdrValidate` calls the same helper.
  problems.push(...recordSupersessionProblems(adrs, texts, "ADR"));
  return problems;
}

// FAFF-342 (Part B): advisory-only coherence hint — an Accepted ADR whose body cites a
// still-Proposed ADR as a deciding reference. STRICTLY NOT a `problems` entry: advisories never
// enter the problem list and never change adr validate's exit code (gating Accepted-cites-Proposed
// would break CI on legitimately-in-flight ADRs). Pure: (adrs, texts) -> string[].
// Self-references, citations of Superseded/Rejected ADRs, and unknown refs produce no line;
// a duplicate (accepted, proposed) pair in one body emits at most one line.
function computeAdrAdvisories(adrs, texts) {
  const statusByNum = new Map(adrs.map((a) => [a.num, a.status || ""]));
  const advisories = [];
  for (const a of adrs) {
    if (!/^Accepted/i.test(a.status || "")) continue;
    const text = texts.get(a.num) || "";
    const seen = new Set();
    const re = /\bADR-(\d{4})\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const cited = m[1];
      if (cited === a.num) continue;                              // self-reference
      const st = statusByNum.get(cited);
      if (st === undefined) continue;                             // unknown ref
      if (!/^Proposed/i.test(st)) continue;                       // only a Proposed foundation triggers
      if (seen.has(cited)) continue;                              // de-dup per (accepted, proposed) pair
      seen.add(cited);
      advisories.push(`advisory: ADR-${a.num} (Accepted) cites ADR-${cited} (Proposed)`);
    }
  }
  return advisories;
}

// Thin dir-reading wrapper (mirrors adrValidate's read shape); the pure core is computeAdrAdvisories.
function adrAdvisories(dir) {
  const adrs = listAdrs(dir);
  const texts = new Map();
  for (const a of adrs) texts.set(a.num, fs.readFileSync(path.join(dir, a.file), "utf8"));
  return computeAdrAdvisories(adrs, texts);
}

// FAFF-368: rewrite canonical supersession refs that POINT AT `oldNum` → `newNum`, in one
// file's text. Mirrors the canonical forms `recordSupersededBy`/`recordSupersedesSet` match
// ("Superseded by <prefix>-NNNN" status value; "Supersedes: <prefix>-NNNN") so a freeform
// legacy line ("Supersedes / unblocks: FAFF-77") is never rewritten. Number-tolerant: a ref
// written "ADR-43" or "ADR-0043" both re-point when they resolve to oldNum. Pure string→string.
function renumberRefsTo(text, oldNum, newNum, prefix) {
  const target = parseInt(oldNum, 10);
  const repl = (pre, n, whole) => (parseInt(n, 10) === target ? pre + newNum : whole);
  return text
    .replace(new RegExp(`(\\bSuperseded\\s+by\\s+${prefix}[-\\s]?)(\\d{1,4})\\b`, "gi"), (m, pre, n) => repl(pre, n, m))
    .replace(new RegExp(`(^[\\s>*-]*Supersedes[\\s*]*:[\\s*]*.*?\\b${prefix}[-\\s]?)(\\d{1,4})\\b`, "gim"), (m, pre, n) => repl(pre, n, m));
}

// FAFF-368: the merge-time collision-repair primitive. Move ONE ADR file to a free number,
// fix its heading, fix in-`refScope` back-refs to it, and re-validate — atomically enough that
// a failure leaves no half-renamed tree (the rename is applied only AFTER the target slot is
// confirmed free). git-agnostic (pure `fs`, parity with `new`/`supersede`); graft stages the
// rename with `git add -A` so git records it by similarity. Returns { code, out, err }.
//   selector  an ADR filename OR a bare number (a duplicated bare number is REJECTED —
//             ambiguous under exactly the collision this addresses; pass the filename).
//   target    a 1–4 digit number OR the literal "next" (→ adrNextNumber against the tree).
//   refScope  filenames (basenames or repo-relative) within which back-refs to the moved
//             number may be rewritten. The moved file is always in scope for its own heading.
function adrRenumber(dir, selector, target, refScope) {
  const adrs = listAdrs(dir);
  // 1–2. resolve selector → source
  let source = adrs.find((a) => a.file === selector);
  if (!source) {
    if (/^\d{1,4}$/.test(String(selector || ""))) {
      const num = String(selector).padStart(4, "0");
      const matches = adrs.filter((a) => a.num === num);
      if (matches.length > 1) return { code: 1, out: "", err: `faff adr renumber: ambiguous: ${num} is duplicated in the tree — pass a filename\n` };
      if (matches.length === 0) return { code: 1, out: "", err: `faff adr renumber: no ADR ${num}\n` };
      source = matches[0];
    } else {
      return { code: 1, out: "", err: `faff adr renumber: no ADR matching "${selector}"\n` };
    }
  }
  // 3. resolve target
  let newNum;
  if (target === "next") newNum = adrNextNumber(dir);
  else if (/^\d{1,4}$/.test(String(target || ""))) newNum = String(target).padStart(4, "0");
  else return { code: 2, out: "", err: `faff adr renumber: --to must be a 4-digit number or "next"\n` };
  // 3c. never move onto an occupied slot (confirm free BEFORE any rename — no partial move)
  if (adrs.some((a) => a.file !== source.file && a.num === newNum)) return { code: 1, out: "", err: `faff adr renumber: target ADR ${newNum} is occupied\n` };
  // 3d. no-op
  const oldPath = path.join(dir, source.file);
  if (newNum === source.num) return { code: 0, out: `${oldPath} -> ${oldPath}\n`, err: "" };

  const oldNum = source.num;
  const newFile = `${newNum}-${source.slug}.md`;
  const newPath = path.join(dir, newFile);
  // ref-scope: normalise to basenames and keep ONLY real ADR filenames (matching ADR_FILE_RE) —
  // never read/rewrite a non-ADR path handed in, so an arbitrary or traversed entry can neither
  // corrupt an unrelated file nor escape the configured ADR directory (basename + ADR-shape bound the blast radius to
  // this-PR ADRs, upholding the spec's "never touch main's untouched files" invariant). The moved
  // file is always in scope for its own heading/refs.
  const scope = new Set((refScope || []).map((f) => path.basename(String(f).trim())).filter((f) => ADR_FILE_RE.test(f)));
  scope.add(source.file);

  // 5. rewrite source text: heading always; its own canonical self-refs to oldNum (in-scope).
  let srcText = fs.readFileSync(oldPath, "utf8")
    .replace(/^(#\s*ADR\s+)(\d+)(\s*[—\-])/mi, (m, pre, n, post) => (parseInt(n, 10) === parseInt(oldNum, 10) ? `${pre}${newNum}${post}` : m));
  if (scope.has(source.file)) srcText = renumberRefsTo(srcText, oldNum, newNum, "ADR");
  // 6. move: write the new file, then remove the old path (atomic-enough; target confirmed free above).
  fs.writeFileSync(newPath, srcText);
  fs.rmSync(oldPath);
  // 7. rewrite in-scope OTHER files' back-refs that point at the moved number.
  for (const f of scope) {
    if (f === source.file) continue;
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const before = fs.readFileSync(p, "utf8");
    const after = renumberRefsTo(before, oldNum, newNum, "ADR");
    if (after !== before) fs.writeFileSync(p, after);
  }
  // 8–9. re-validate; never claim success on a red tree.
  const problems = adrValidate(dir);
  if (problems.length) return { code: 1, out: "", err: problems.map((p) => `FAIL  ${p}`).join("\n") + "\n" };
  // 10. success
  return { code: 0, out: `${oldPath} -> ${newPath}\n`, err: "" };
}

function adrTemplate({ num, title, date, issue, initiative, status, provenance }) {
  // FAFF-199: mirror prdrTemplate's field order (Status, Provenance, Date) — default "human", the
  // harder-to-supersede tier (fail-safe direction; the loop passes --provenance loop explicitly).
  const lines = [`# ADR ${num} — ${title}`, "", `- **Status:** ${status || "Proposed"}`, `- **Provenance:** ${provenance || "human"}`, `- **Date:** ${date}`];
  if (issue) lines.push(`- **Issue:** ${issue}`);
  if (initiative) lines.push(`- **Initiative:** ${initiative}`);
  lines.push("", "## Context", "", "_TODO: what forces this decision._", "",
             "## Decision", "", "_TODO: the decision, stated forward._", "",
             "## Consequences", "", "_TODO: what this constrains downstream._", "");
  return lines.join("\n");
}

// === FAFF-546: `faff adr accept` + `adrGitTier` — the ADR-axis mirror of FAFF-463's PRDR pair, ===
// deliberately NARROWER than `prdrAccept`: no --actor/--admit-verdict/branch-landing. The verb is
// a plain, authority-blind Status-field edit — the call site (faff-graft Step 10's merge-confidence
// gate) owns the only authority decision that matters (CI-green, review-pass, L4 holdout meets-spec).
// `git` shell-outs are local to this module (mirrors prdr.js's own local git/gitOk/gitOut — no
// shared git helper exists yet; duplicating the same three-liner beats a premature shared module).
const git = (root, a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
const gitOk = (root, a) => git(root, a).status === 0;
const gitOut = (root, a) => { const r = git(root, a); return r.status === 0 ? (r.stdout || "").trim() : null; };

// Git-awareness tier (FAFF-546, mirrors prdrGitTier verbatim in shape): P: FAIL accepted-uncommitted,
// NOTE proposed-uncommitted. `adr.validate_git`: auto (default; degrades to silent outside a git work
// tree) | off. Presence-only elsewhere; tracked-ness is a shape fact, not content. Returns
// { fails: string[], notes: string[] }.
function adrGitTier(dir, root, cfg) {
  const mode = (cfg && cfg["adr.validate_git"]) || DEFAULTS["adr.validate_git"];
  if (mode === "off") return { fails: [], notes: [] };
  if (!gitOk(root, ["rev-parse", "--is-inside-work-tree"])) return { fails: [], notes: [] };
  const fails = [], notes = [];
  for (const a of listAdrs(dir)) {
    const rel = path.relative(root, path.join(dir, a.file)) || a.file;
    const tracked = gitOk(root, ["ls-files", "--error-unmatch", "--", rel]);
    const modified = !!gitOut(root, ["status", "--porcelain", "--", rel]);
    const st = a.status || "";
    if (/^Accepted/i.test(st) && (!tracked || modified)) fails.push(`${a.file}: accepted-uncommitted — Status Accepted but the file is untracked-or-modified vs HEAD`);
    else if (/^Proposed/i.test(st) && !tracked) notes.push(`${a.file}: proposed-uncommitted — a Proposed record not yet tracked (the legitimate authoring state)`);
  }
  return { fails, notes };
}

// `faff adr accept <selector>` — the SOLE writer of `Status: Accepted` on the ADR axis (FAFF-546).
// A plain, mechanical, authority-blind field edit: no git add/commit, no branch, no actor. Reuses
// `recordSupersede`'s exact Status-line regex so there is only one Status-mutation code path.
// Selector resolution mirrors `adrRenumber`'s: exact filename match, else a bare number (a
// duplicated bare number is refused — ambiguous, pass a filename). Idempotent on already-`Accepted`
// (exit 0, no write); refuses (exit 2) on any other current Status (Superseded/Deprecated/Rejected/
// malformed) — accept only ever performs the Proposed → Accepted transition, never overwrites a
// supersession (or any other terminal) marker.
function adrAccept(dir, selector) {
  const adrs = listAdrs(dir);
  let rec = adrs.find((a) => a.file === selector);
  if (!rec) {
    if (/^\d{1,4}$/.test(String(selector || ""))) {
      const num = String(selector).padStart(4, "0");
      const matches = adrs.filter((a) => a.num === num);
      if (matches.length > 1) return { code: 2, out: "", err: `faff adr accept: ambiguous: ${num} is duplicated in the tree — pass a filename\n` };
      if (matches.length === 0) return { code: 2, out: "", err: `faff adr accept: no ADR ${num}\n` };
      rec = matches[0];
    } else {
      return { code: 2, out: "", err: `faff adr accept: no ADR matching "${selector}"\n` };
    }
  }
  const status = rec.status || "";
  const filePath = path.join(dir, rec.file);
  if (/^Accepted/i.test(status)) return { code: 0, out: `${filePath}\n`, err: "" };   // idempotent no-op
  if (!/^Proposed/i.test(status)) {
    return { code: 2, out: "", err: `faff adr accept: ADR-${rec.num} Status is "${(status.split(/[ (.]/)[0] || status || "?")}" — accept only flips Proposed to Accepted, never overwrites a supersession or other terminal marker\n` };
  }
  const text = fs.readFileSync(filePath, "utf8")
    .replace(/^([\s>*-]*\*{0,2}Status[\s*]*:[\s*]*).*$/mi, "$1Accepted");
  fs.writeFileSync(filePath, text);
  return { code: 0, out: `${filePath}\n`, err: "" };
}

// FAFF-198 (ADR L3): deterministic mechanics around the `detect_contradictions` LLM seam.
// These are the plumbing the seam sits inside — input assembly + offer-routing — kept here so
// they are unit-tested (`adr --selftest`) and the seam stays the only non-deterministic step.

// The `## Decision` section body: everything from the "## Decision" heading to the next
// "## " heading (or EOF). Trimmed. Returns "" when the heading is absent (the seam then sees
// empty input for that ADR — never a crash). This is what the seam reads per-ADR.
function adrDecisionBody(text) {
  const m = text.match(/^##\s+Decision\s*$([\s\S]*?)(?=^##\s+)/mi)   // up to the next "## " heading
    || text.match(/^##\s+Decision\s*$([\s\S]*)$/mi);                // …or to EOF when it is last
  return m ? m[1].replace(/^\s+|\s+$/g, "") : "";
}

// Assemble `live_adr_decisions` — the candidate set the new ADR is checked against:
// every LIVE (non-superseded) ADR except the new one, each with its `## Decision` body read.
// Pure read; no write, no seam call. `excludeId` is the just-created ADR's id (zero-padded).
function adrLiveDecisions(dir, excludeId) {
  const exclude = excludeId ? String(excludeId).match(/^(\d{1,4})/)?.[1].padStart(4, "0") : null;
  const out = [];
  for (const a of listAdrs(dir)) {
    if (adrSupersededBy(a.status)) continue;          // skip already-superseded (dead) ADRs
    if (exclude && a.num === exclude) continue;       // exclude the new ADR from its own set
    const text = fs.readFileSync(path.join(dir, a.file), "utf8");
    // FAFF-199: carry provenance in the candidate set too — the L4 caller (graft Step 3b) reads it
    // straight off this same call rather than a second `adr list` round trip.
    out.push({ adr: a.num, title: a.title || a.slug || null, decision: adrDecisionBody(text), provenance: a.provenance });
  }
  return out;
}

// The offer-routing decision table (HOW §4): given the runtime context and a per-ADR seam
// Result, return the action graft takes. PURE — it decides, it does not write. The supersede
// WRITE only ever follows an interactive "supersede" choice; autonomous never returns "supersede".
//   inputs:  { interactive: bool, mode: "off"|"surface"|"offer", contradicts: bool, appetite?: str }
//   returns: { route: "skip-detection"|"no-conflict"|"surface"|"offer"|"record",
//              offer_supersede: bool, auto_supersede: false (always), record_for_wtf: bool,
//              surface_prominently?: bool }
function adrOfferRoute({ interactive, mode, contradicts, appetite }) {
  const base = { offer_supersede: false, auto_supersede: false, record_for_wtf: false };
  if (mode === "off") return { route: "skip-detection", ...base };
  if (!contradicts) return { route: "no-conflict", ...base };
  if (interactive) {
    // surface mode: informational only, no supersede prompt; offer mode: full 3-way.
    if (mode === "surface") return { route: "surface", ...base };
    return { route: "offer", ...base, offer_supersede: true };
  }
  // Autonomous: NEVER auto-supersede at any appetite (hard floor). Record for /faff-wtf and proceed.
  // Appetite grades only how prominently the candidate is surfaced, never whether-to-write.
  const surface_prominently = appetite === "high" || appetite === "full";
  return { route: "record", ...base, record_for_wtf: true, surface_prominently };
}

function cmdAdr(args) {
  if (args.includes("--selftest")) return adrSelftest();
  const parsed = parseArgs(args, ADR_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff adr <new|list|validate|supersede|renumber|live-decisions|next-number|accept> [flags]");
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const action = args[0];
  const root = get("--root") || findRoot();
  const dir = adrDir(root);

  if (action === "next-number") { process.stdout.write(adrNextNumber(dir) + "\n"); return 0; }

  if (action === "list") {
    const adrs = listAdrs(dir);
    if (args.includes("--json")) {
      console.log(JSON.stringify(adrs.map(({ number, num, title, status, date, provenance, file }) =>
        ({ number, id: num, title, status, date, provenance, file })), null, 2));
    } else if (!adrs.length) {
      console.log(`No ADRs in ${path.relative(root, dir) || dir}.`);
    } else {
      for (const a of adrs) console.log(`${a.num}  ${a.title || a.slug}  [${(a.status || "?").split(/[ (.]/)[0]}]  ${a.provenance}  ${a.date || ""}`.trimEnd());
    }
    return 0;
  }

  if (action === "live-decisions") {
    // FAFF-198: emit `live_adr_decisions` — the seam-input candidate set (non-superseded, exclude-new,
    // each `## Decision` body read). Deterministic plumbing AROUND the LLM seam; never runs the seam.
    const live = adrLiveDecisions(dir, get("--exclude"));
    console.log(JSON.stringify(live, null, 2));
    return 0;
  }

  if (action === "validate") {
    const problems = adrValidate(dir);
    const { fails: gitFails, notes: gitNotes } = adrGitTier(dir, root, loadConfig(root)[0]); // FAFF-546: git-awareness tier
    const allProblems = problems.concat(gitFails);
    const advisories = adrAdvisories(dir); // FAFF-342: informational only — never gates the exit code
    if (!allProblems.length) {
      console.log(`OK — ${listAdrs(dir).length} ADR(s) in ${path.relative(root, dir) || dir} valid.`);
      for (const n of gitNotes) console.log(`NOTE  ${n}`);
      for (const adv of advisories) console.log(adv);
      return 0;
    }
    for (const p of allProblems) console.log(`FAIL  ${p}`);
    for (const n of gitNotes) console.log(`NOTE  ${n}`);
    for (const adv of advisories) console.log(adv);
    return 1;
  }

  if (action === "accept") {
    // faff adr accept <selector> [--root <path>] — FAFF-546: the sole writer of `Status: Accepted`
    // on the ADR axis. Deliberately authority-blind (no --actor/--admit-verdict) — see adrAccept.
    const selector = args[1];
    if (!selector || selector.startsWith("--")) { process.stderr.write("faff adr accept: <selector> (an ADR filename or a bare number) is required\n"); return 2; }
    const r = adrAccept(dir, selector);
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    return r.code;
  }

  if (action === "new") {
    const title = get("--title");
    const reqErr = requireFlags(parsed.values, ADR_SURFACE.subcommands.new, "adr", "new");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    // FAFF-199: --provenance human|loop, default "human" (fail-safe: the harder-to-supersede tier;
    // the loop passes --provenance loop explicitly — mirrors `prdr new` ~L165 verbatim).
    const provenance = get("--provenance");
    if (provenance && !ADR_PROVENANCES.includes(provenance)) { process.stderr.write(`faff adr new: --provenance must be one of ${ADR_PROVENANCES.join("|")}\n`); return 2; }
    const date = get("--date") || new Date().toISOString().slice(0, 10);
    const num = adrNextNumber(dir);
    const file = `${num}-${adrSlug(title)}.md`;
    const full = path.join(dir, file);
    if (fs.existsSync(full)) { process.stderr.write(`faff adr new: ${file} already exists — never overwrite (append-only)\n`); return 1; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, adrTemplate({ num, title, date, issue: get("--issue"), initiative: get("--initiative"), status: get("--status"), provenance: provenance || "human" }));
    process.stdout.write(full + "\n");
    return 0;
  }

  if (action === "supersede") {
    // faff adr supersede <old> --by <new> — link two existing ADRs with the canonical form.
    // The ONE place the CLI edits an existing ADR — and only its Status value + one Supersedes line.
    // FAFF-245: the write is the shared, prefix-parameterised `recordSupersede` (no fork).
    const reqErr = requireFlags(parsed.values, ADR_SURFACE.subcommands.supersede, "adr", "supersede");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    const r = recordSupersede(dir, root, listAdrs(dir), args[1], get("--by"), "ADR");
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    return r.code;
  }

  if (action === "admit") {
    // FAFF-199: the two-gate admission gate, ADR 0022's PRDR pattern ported. Pure — no
    // tracker/network call (parity with `faff prdr admit` / `faff next`): the agent maps the
    // move's state onto these closed-vocabulary flags; the verdict is a pure function of them.
    const actor = get("--actor");
    if (!ADR_ACTORS.includes(actor)) { process.stderr.write("faff adr admit: --actor must be loop|human\n"); return 2; }
    const sup = get("--supersedes-provenance");
    if (!ADR_SUPERSEDES.includes(sup)) { process.stderr.write("faff adr admit: --supersedes-provenance must be human|loop|none\n"); return 2; }
    const cfg = loadConfig(root)[0];
    const tmRaw = get("--thrash-max") ?? dig(cfg, "adr.thrash_max") ?? DEFAULTS["adr.thrash_max"];
    const thrashMax = parseInt(tmRaw, 10);
    // thrash_max + lineage are COUNTS — a negative is nonsensical and would breach the ratchet at
    // lineage 0 (lineage >= negative is always true), spuriously rejecting every admit. Reject it.
    if (!Number.isInteger(thrashMax) || thrashMax < 0) { process.stderr.write(`faff adr admit: thrash_max "${tmRaw}" must be a non-negative integer\n`); return 2; }
    const lsRaw = get("--lineage-supersessions");
    const lineageSupersessions = lsRaw != null ? parseInt(lsRaw, 10) : 0;
    if (!Number.isInteger(lineageSupersessions) || lineageSupersessions < 0) { process.stderr.write(`faff adr admit: --lineage-supersessions "${lsRaw}" must be a non-negative integer\n`); return 2; }
    const challengeRaw = get("--challenge");
    if (challengeRaw != null && challengeRaw !== "survived" && challengeRaw !== "overturned") {
      process.stderr.write("faff adr admit: --challenge must be survived|overturned (omit when the drift challenge did not run or did not conclude)\n"); return 2;
    }
    const verdict = computeAdrAdmissionVerdict({
      actor, supersedesProvenance: sup,
      self: args.includes("--self"),
      challenge: challengeRaw || undefined,
      lineageSupersessions, thrashMax,
    });
    // Belt-and-braces: the produced verdict must itself conform to the adr-admission contract schema.
    const schemaErr = schemaCheck(verdict, "adr-admission");
    if (schemaErr) { process.stderr.write(`faff adr admit: ${schemaErr}\n`); return 2; }
    process.stdout.write(JSON.stringify(verdict) + "\n");
    return 0;   // report-only (parity with `faff next` / `prdr admit`): the disposition is in the payload, never the exit code
  }

  if (action === "renumber") {
    // faff adr renumber <selector> --to <target> [--ref-scope f,f...] — FAFF-368: the merge-time
    // collision-repair primitive. Moves ONE ADR to a free number, fixes heading + in-scope back-refs,
    // and re-validates; graft's Step-10 merge guard calls it, never free-hands git mv + heading edits.
    const selector = args[1];
    if (!selector || selector.startsWith("--")) { process.stderr.write("faff adr renumber: <selector> (an ADR filename or a bare number) is required\n"); return 2; }
    const reqErr = requireFlags(parsed.values, ADR_SURFACE.subcommands.renumber, "adr", "renumber");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    const to = get("--to");
    const rsFlag = get("--ref-scope");
    const refScope = rsFlag ? rsFlag.split(/[,\s]+/).filter(Boolean) : [];
    const r = adrRenumber(dir, selector, to, refScope);
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    return r.code;
  }

  process.stderr.write("faff adr: expected one of: next-number | new | list | live-decisions | validate | supersede | admit | renumber | accept (or --selftest)\n");
  return 2;
}

function adrSelftest() {
  const os = require("node:os");
  const cases = [];
  const t = (name, ok) => cases.push([name, !!ok]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-adr-"));
  const dir = path.join(tmp, "docs", "adr");
  fs.mkdirSync(dir, { recursive: true });
  const mk = (n, slug, body) => fs.writeFileSync(path.join(dir, `${n}-${slug}.md`),
    body != null ? body : `# ADR ${n} — ${slug}\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\nx\n`);

  {
    const configuredRoot = path.join(tmp, "configured");
    const configuredDir = path.join(configuredRoot, "records", "adr");
    fs.mkdirSync(configuredDir, { recursive: true });
    fs.writeFileSync(path.join(configuredRoot, ".faffrc.yaml"), "tracking:\n  adr_docs_path: records/adr/\n");
    fs.writeFileSync(path.join(configuredDir, "0001-configured.md"), "# ADR 0001 — configured\n\n- **Status:** Accepted\n- **Date:** 2026-08-09\n\n## Context\nx\n");
    t("configured ADR path is the command's record source",
      path.normalize(adrDir(configuredRoot)) === path.normalize(configuredDir) && listAdrs(adrDir(configuredRoot)).length === 1);
  }

  t("next-number on empty → 0001", adrNextNumber(dir) === "0001");
  mk("0001", "alpha"); mk("0002", "beta");
  t("next-number after 0001,0002 → 0003", adrNextNumber(dir) === "0003");
  t("validate clean tree → no problems", adrValidate(dir).length === 0);
  t("list parses 2 ADRs", listAdrs(dir).length === 2);
  t("next-number points at a free slot (append-only)", listAdrs(dir).every((a) => a.num !== adrNextNumber(dir)));
  mk("0004", "delta");
  t("validate detects numbering gap (missing 0003)", adrValidate(dir).some((p) => /0003/.test(p)));
  mk("0003", "gamma", `# ADR 0003 — gamma\n\n- **Date:** 2026-06-21\n\n## Context\n`);
  t("validate detects missing Status", adrValidate(dir).some((p) => /Status/i.test(p)));
  mk("0005", "mismatch", `# ADR 0009 — mismatch\n\n- **Status:** Proposed\n- **Date:** 2026-06-21\n`);
  t("validate detects heading/filename number mismatch", adrValidate(dir).some((p) => /!= filename/i.test(p)));
  t("slug kebabs a title", adrSlug("Events not RPC!") === "events-not-rpc");
  t("template carries Nygard sections + Status/Date", (() => {
    const tpl = adrTemplate({ num: "0007", title: "T", date: "2026-06-21", issue: "FAFF-16" });
    return /# ADR 0007 — T/.test(tpl) && /\*\*Status:\*\* Proposed/.test(tpl) && /## Context/.test(tpl) && /## Decision/.test(tpl) && /## Consequences/.test(tpl) && /\*\*Issue:\*\* FAFF-16/.test(tpl);
  })());

  // FAFF-199 — Provenance field: template default + explicit, legacy-lenient validate (absent
  // never flagged, out-of-enum always flagged), listAdrs read-time default.
  t("template defaults Provenance to human", /\*\*Provenance:\*\* human/.test(adrTemplate({ num: "0008", title: "T", date: "2026-06-21" })));
  t("template carries an explicit loop Provenance", /\*\*Provenance:\*\* loop/.test(adrTemplate({ num: "0008", title: "T", date: "2026-06-21", provenance: "loop" })));
  t("validate: legacy ADR with NO Provenance field is never flagged", adrValidate(dir).every((p) => !/Provenance/.test(p)));   // `dir` above carries zero Provenance lines
  t("listAdrs: absent Provenance read-time-defaults to human", listAdrs(dir).every((a) => a.provenance === "human"));
  {
    const pdir = path.join(tmp, "prov", "docs", "adr");
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, "0001-loopy.md"), `# ADR 0001 — loopy\n\n- **Status:** Accepted\n- **Provenance:** loop\n- **Date:** 2026-07-16\n\n## Context\nx\n`);
    fs.writeFileSync(path.join(pdir, "0002-legacy.md"), `# ADR 0002 — legacy\n\n- **Status:** Accepted\n- **Date:** 2026-07-16\n\n## Context\nx\n`);
    fs.writeFileSync(path.join(pdir, "0003-bad.md"), `# ADR 0003 — bad\n\n- **Status:** Accepted\n- **Provenance:** robot\n- **Date:** 2026-07-16\n\n## Context\nx\n`);
    const plist = listAdrs(pdir);
    t("listAdrs: explicit loop Provenance read back", plist.find((a) => a.num === "0001").provenance === "loop");
    t("listAdrs: absent Provenance defaults to human (not null)", plist.find((a) => a.num === "0002").provenance === "human");
    const pprob = adrValidate(pdir);
    t("validate: out-of-enum Provenance IS flagged", pprob.some((p) => /Provenance .* must be one of/.test(p) && /0003-bad\.md/.test(p)));
    t("validate: absent/valid Provenance entries are NOT flagged for it", !pprob.some((p) => /0001-loopy.*Provenance|0002-legacy.*Provenance/.test(p)));
  }

  // FAFF-199 — `faff adr admit`: the two-gate admission matrix (mirrors the PRDR admit selftest
  // block verbatim in shape — computeAdrAdmissionVerdict is imported directly, no fs needed).
  {
    const adm = (o) => computeAdrAdmissionVerdict({ actor: "loop", supersedesProvenance: "loop", thrashMax: 3, challenge: "survived", ...o });
    t("admit: loop→loop, challenge survived, gates pass → admit", adm({}).disposition === "admit");
    t("admit: loop→human → propose-only (needs ratification)", adm({ supersedesProvenance: "human" }).disposition === "propose-only");
    t("admit: human→human → admit (human is the encloser)", adm({ actor: "human", supersedesProvenance: "human" }).disposition === "admit");
    t("admit: inner-loop self-supersede → reject (by-level)", (() => { const v = adm({ self: true }); return v.disposition === "reject" && v.authority.by_level === "violation"; })());
    t("admit: challenge absent → reject, never a pass (missing skeptic)", (() => { const v = adm({ challenge: undefined }); return v.disposition === "reject" && v.challenge.ran === false && v.challenge.outcome === "absent"; })());
    t("admit: challenge overturned → reject", (() => { const v = adm({ challenge: "overturned" }); return v.disposition === "reject" && v.challenge.outcome === "overturned"; })());
    t("admit: ratchet breach (lineage ≥ thrash_max) → reject + breached", (() => { const v = adm({ lineageSupersessions: 3 }); return v.disposition === "reject" && v.ratchet.breached === true; })());
    t("admit: under thrash_max → not breached", adm({ lineageSupersessions: 2 }).ratchet.breached === false);
    t("admit: hard violation beats propose-only (loop→human + self → reject)", adm({ supersedesProvenance: "human", self: true }).disposition === "reject");
    t("admit: hard violation beats propose-only (loop→human + challenge absent → reject)", adm({ supersedesProvenance: "human", challenge: undefined }).disposition === "reject");
    t("admit: every produced verdict is contract-conformant", [
      adm({}),                                              // admit
      adm({ supersedesProvenance: "human" }),                // propose-only
      adm({ self: true }),                                   // reject (by-level)
    ].every((v) => computeAdrAdmission(v).contractData.conformant === true));
  }

  // FAFF-342 (Part B) — Accepted-cites-Proposed advisory: informational, never a `problems` entry.
  {
    const adv = path.join(tmp, "adv", "docs", "adr");
    fs.mkdirSync(adv, { recursive: true });
    const w = (n, slug, status, body) => fs.writeFileSync(path.join(adv, `${n}-${slug}.md`),
      `# ADR ${n} — ${slug}\n\n- **Status:** ${status}\n- **Date:** 2026-07-15\n\n## Context\n${body || "x"}\n`);
    w("0001", "proposed-foundation", "Proposed", "base");
    w("0002", "accepted-cites-proposed", "Accepted", "founded on ADR-0001; also cites ADR-0001 again");
    w("0003", "superseded-ref", "Accepted", "cites ADR-0004 which is superseded");
    w("0004", "dead", "Superseded", "gone");
    w("0005", "self-and-accepted", "Accepted", "cites ADR-0005 (self) and ADR-0002 (accepted)");
    const advs = adrAdvisories(adv);
    t("advisory: fires for Accepted-cites-Proposed", advs.some((l) => /ADR-0002 \(Accepted\) cites ADR-0001 \(Proposed\)/.test(l)));
    t("advisory: de-dups a pair cited twice (one line for 0002→0001)", advs.filter((l) => /ADR-0002 .* ADR-0001/.test(l)).length === 1);
    t("advisory: a citation of a Superseded ADR produces no line", !advs.some((l) => /ADR-0004/.test(l)));
    t("advisory: self-reference produces no line", !advs.some((l) => /ADR-0005 \(Accepted\) cites ADR-0005/.test(l)));
    t("advisory: a citation of an Accepted ADR produces no line", !advs.some((l) => /cites ADR-0002/.test(l)));
    t("advisory: NEVER enters the problems list / never changes exit (validate stays clean)", adrValidate(adv).length === 0 && advs.length >= 1);
  }

  // FAFF-197 — supersession canonical-ref parsing + back-reference validation
  t("parse Superseded-by ref", adrSupersededBy("Superseded by ADR-0002") === "0002");
  t("parse Supersedes field", adrSupersedesSet("- **Supersedes:** ADR-0001\n").has("0001"));
  t("parse multiple Supersedes refs", (() => { const s = adrSupersedesSet("- **Supersedes:** ADR-0001\n- **Supersedes:** ADR-0003\n"); return s.has("0001") && s.has("0003") && s.size === 2; })());
  t("legacy freeform 'Supersedes / unblocks:' is NOT a canonical Supersedes ref", adrSupersedesSet("- **Supersedes / unblocks:** FAFF-77\n").size === 0);
  const sdir = path.join(tmp, "sup", "docs", "adr");
  fs.mkdirSync(sdir, { recursive: true });
  const smk = (n, body) => fs.writeFileSync(path.join(sdir, `${n}-x.md`), body);
  smk("0001", `# ADR 0001 — x\n\n- **Status:** Superseded by ADR-0002\n- **Date:** 2026-06-21\n\n## Context\n`);
  smk("0002", `# ADR 0002 — x\n\n- **Status:** Accepted\n- **Supersedes:** ADR-0001\n- **Date:** 2026-06-21\n\n## Context\n`);
  t("symmetric supersession validates clean", adrValidate(sdir).length === 0);
  smk("0002", `# ADR 0002 — x\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\n`);   // drop the mirror
  t("validate detects asymmetric supersession", adrValidate(sdir).some((p) => /asymmetric/i.test(p)));
  smk("0001", `# ADR 0001 — x\n\n- **Status:** Superseded by ADR-0099\n- **Date:** 2026-06-21\n\n## Context\n`);   // dangling
  t("validate detects dangling supersession", adrValidate(sdir).some((p) => /missing ADR-0099/i.test(p)));
  const ldir = path.join(tmp, "leg", "docs", "adr");
  fs.mkdirSync(ldir, { recursive: true });
  fs.writeFileSync(path.join(ldir, "0001-x.md"), `# ADR 0001 — x\n\n- **Status:** Accepted\n- **Supersedes / unblocks:** FAFF-77\n- **Date:** 2026-06-21\n\n## Context\n`);
  t("legacy freeform ADR passes (canonical check skipped where absent)", adrValidate(ldir).length === 0);
  // one ADR superseding TWO predecessors validates clean (the multiple-Supersedes case)
  const mdir = path.join(tmp, "multi", "docs", "adr");
  fs.mkdirSync(mdir, { recursive: true });
  const mmk = (n, body) => fs.writeFileSync(path.join(mdir, `${n}-x.md`), body);
  mmk("0001", `# ADR 0001 — x\n\n- **Status:** Superseded by ADR-0003\n- **Date:** 2026-06-21\n\n## Context\n`);
  mmk("0002", `# ADR 0002 — x\n\n- **Status:** Superseded by ADR-0003\n- **Date:** 2026-06-21\n\n## Context\n`);
  mmk("0003", `# ADR 0003 — x\n\n- **Status:** Accepted\n- **Supersedes:** ADR-0001\n- **Supersedes:** ADR-0002\n- **Date:** 2026-06-21\n\n## Context\n`);
  t("one ADR superseding two predecessors validates clean", adrValidate(mdir).length === 0);

  // FAFF-198 (ADR L3) — `## Decision` body extraction, live-decisions input assembly, offer-routing.
  t("decision body extracted up to next heading", adrDecisionBody(
    "# ADR 0001 — x\n\n## Context\nc\n\n## Decision\nuse events not RPC\n\n## Consequences\nq\n") === "use events not RPC");
  t("decision body extracted when Decision is last section", adrDecisionBody(
    "## Context\nc\n\n## Decision\nuse X\n") === "use X");
  t("decision body empty string when heading absent", adrDecisionBody("# ADR 0001 — x\n\n## Context\nc\n") === "");
  // live-decisions: non-superseded filter + exclude-new + decision body read
  const l3dir = path.join(tmp, "l3", "docs", "adr");
  fs.mkdirSync(l3dir, { recursive: true });
  const l3mk = (n, status, dec) => fs.writeFileSync(path.join(l3dir, `${n}-x.md`),
    `# ADR ${n} — x\n\n- **Status:** ${status}\n- **Date:** 2026-06-21\n\n## Context\nc\n\n## Decision\n${dec}\n\n## Consequences\nq\n`);
  l3mk("0001", "Accepted", "use RPC everywhere");
  l3mk("0002", "Superseded by ADR-0003", "old approach");
  l3mk("0003", "Accepted", "use events");
  l3mk("0004", "Proposed", "a proposed thing");
  const live = adrLiveDecisions(l3dir, "0004");   // 0004 is "the new ADR" → excluded; 0002 superseded → excluded
  t("live-decisions excludes superseded + the new ADR", live.length === 2 && live.every((d) => d.adr !== "0002" && d.adr !== "0004"));
  t("live-decisions reads each ## Decision body", live.find((d) => d.adr === "0001").decision === "use RPC everywhere");
  t("live-decisions keeps Proposed (non-superseded) when not the new one", adrLiveDecisions(l3dir, "0001").some((d) => d.adr === "0004"));
  // offer-routing decision table — interactive × autonomous × adr.mode × contradicts
  const route = (o) => adrOfferRoute(o);
  t("route: adr.mode=off → skip-detection", route({ interactive: true, mode: "off", contradicts: true }).route === "skip-detection");
  t("route: no contradiction → no-conflict, no write", (() => { const r = route({ interactive: true, mode: "offer", contradicts: false }); return r.route === "no-conflict" && !r.offer_supersede && !r.auto_supersede; })());
  t("route: interactive offer → full offer (supersede prompt)", (() => { const r = route({ interactive: true, mode: "offer", contradicts: true }); return r.route === "offer" && r.offer_supersede && !r.auto_supersede; })());
  t("route: interactive surface → surface only, no supersede prompt", (() => { const r = route({ interactive: true, mode: "surface", contradicts: true }); return r.route === "surface" && !r.offer_supersede; })());
  t("route: autonomous → record for wtf, NEVER auto-supersede", (() => { const r = route({ interactive: false, mode: "offer", contradicts: true, appetite: "medium" }); return r.route === "record" && r.record_for_wtf && r.auto_supersede === false; })());
  t("route: autonomous at FULL appetite still never auto-supersedes (hard floor)", route({ interactive: false, mode: "offer", contradicts: true, appetite: "full" }).auto_supersede === false);
  t("route: appetite grades autonomous surfacing prominence only", (() => {
    const lo = route({ interactive: false, mode: "offer", contradicts: true, appetite: "low" });
    const hi = route({ interactive: false, mode: "offer", contradicts: true, appetite: "high" });
    return lo.surface_prominently === false && hi.surface_prominently === true; })());

  // FAFF-368 — `adr renumber`: happy path, occupied-target refusal, ambiguous-bare-number refusal,
  // ref-scope-bounded back-ref rewrite (symmetric supersession), out-of-scope byte-invariance, no-op.
  const rndir = path.join(tmp, "renum", "docs", "adr");
  fs.mkdirSync(rndir, { recursive: true });
  const rnmk = (n, slug, body) => fs.writeFileSync(path.join(rndir, `${n}-${slug}.md`),
    body != null ? body : `# ADR ${n} — ${slug}\n\n- **Status:** Proposed\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  // happy path: two 0003s (peer + mine); renumber mine → next (0004), validate clean, peer byte-unchanged.
  rnmk("0001", "a"); rnmk("0002", "b"); rnmk("0003", "peer"); rnmk("0003", "mine");
  const peerBefore = fs.readFileSync(path.join(rndir, "0003-peer.md"), "utf8");
  const rn1 = adrRenumber(rndir, "0003-mine.md", "next", []);
  t("renumber: happy path exits 0 with '<old> -> <new>'", rn1.code === 0 && /0003-mine\.md -> .*0004-mine\.md/.test(rn1.out));
  t("renumber: moved file now at 0004, heading updated", fs.existsSync(path.join(rndir, "0004-mine.md")) && !fs.existsSync(path.join(rndir, "0003-mine.md")) && /# ADR 0004 —/.test(fs.readFileSync(path.join(rndir, "0004-mine.md"), "utf8")));
  t("renumber: post-move tree validates clean", adrValidate(rndir).length === 0);
  t("renumber: the peer 0003 file is byte-unchanged", fs.readFileSync(path.join(rndir, "0003-peer.md"), "utf8") === peerBefore);
  // occupied-target refusal (no partial rename): move 0004 → 0001 (occupied).
  const rn2 = adrRenumber(rndir, "0004-mine.md", "0001", []);
  t("renumber: occupied target exits 1, names the slot", rn2.code === 1 && /target ADR 0001 is occupied/.test(rn2.err));
  t("renumber: occupied-target left tree unchanged (no partial move)", fs.existsSync(path.join(rndir, "0004-mine.md")) && !fs.existsSync(path.join(rndir, "0001-mine.md")));
  // ambiguous bare-number refusal.
  rnmk("0002", "dup2");   // reintroduce a duplicate 0002
  const rn3 = adrRenumber(rndir, "0002", "next", []);
  t("renumber: ambiguous bare number exits 1, asks for a filename", rn3.code === 1 && /ambiguous.*pass a filename/i.test(rn3.err));
  fs.rmSync(path.join(rndir, "0002-dup2.md"));
  // ref-scope-bounded back-ref rewrite (supersession sub-case): the incoming 0003-new supersedes the
  // existing 0001-old and collides with a peer 0003-peer; renumber 0003-new→next, in-scope back-ref follows,
  // symmetric re-validates clean (the peer at 0003 keeps the tree contiguous — the realistic collision shape).
  const sdir2 = path.join(tmp, "renum-sup", "docs", "adr");
  fs.mkdirSync(sdir2, { recursive: true });
  const smk2 = (n, slug, body) => fs.writeFileSync(path.join(sdir2, `${n}-${slug}.md`), body);
  smk2("0001", "old", `# ADR 0001 — old\n\n- **Status:** Superseded by ADR-0003\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  smk2("0002", "mid", `# ADR 0002 — mid\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  smk2("0003", "peer", `# ADR 0003 — peer\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  smk2("0003", "new", `# ADR 0003 — new\n\n- **Status:** Accepted\n- **Supersedes:** ADR-0001\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  const rn4 = adrRenumber(sdir2, "0003-new.md", "next", ["0003-new.md", "0001-old.md"]);
  t("renumber: supersession sub-case exits 0", rn4.code === 0);
  t("renumber: in-scope back-ref re-pointed to the new number", /Superseded by ADR-0004/.test(fs.readFileSync(path.join(sdir2, "0001-old.md"), "utf8")));
  t("renumber: supersession re-validates symmetric (clean)", adrValidate(sdir2).length === 0);
  // out-of-scope back-ref stays byte-identical when it still resolves — clean collision + a peer occupying
  // the vacated slot keeps the tree contiguous; the out-of-scope "Supersedes" is never touched.
  const odir = path.join(tmp, "renum-oos", "docs", "adr");
  fs.mkdirSync(odir, { recursive: true });
  const omk = (n, slug, body) => fs.writeFileSync(path.join(odir, `${n}-${slug}.md`), body);
  omk("0001", "peer", `# ADR 0001 — peer\n\n- **Status:** Superseded by ADR-0002\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  omk("0002", "other", `# ADR 0002 — other\n\n- **Status:** Accepted\n- **Supersedes:** ADR-0001\n- **Date:** 2026-06-21\n\n## Context\nx\n`);   // out-of-scope; its ref points at 0001-peer
  omk("0001", "mine", `# ADR 0001 — mine\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\nx\n`);   // the incoming collision at 0001
  const otherBefore = fs.readFileSync(path.join(odir, "0002-other.md"), "utf8");
  const rn5 = adrRenumber(odir, "0001-mine.md", "next", ["0001-mine.md"]);
  t("renumber: clean collision exits 0 (peer keeps tree contiguous)", rn5.code === 0);
  t("renumber: out-of-scope file is byte-identical (never rewritten)", fs.readFileSync(path.join(odir, "0002-other.md"), "utf8") === otherBefore);
  // AND a renumber that WOULD leave a dangling/asymmetric out-of-scope ref fails the step-6 re-validate → exit 1.
  const adir = path.join(tmp, "renum-asym", "docs", "adr");
  fs.mkdirSync(adir, { recursive: true });
  const amk = (n, slug, body) => fs.writeFileSync(path.join(adir, `${n}-${slug}.md`), body);
  amk("0001", "a", `# ADR 0001 — a\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  amk("0002", "peer", `# ADR 0002 — peer\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  amk("0002", "mine", `# ADR 0002 — mine\n\n- **Status:** Superseded by ADR-0003\n- **Date:** 2026-06-21\n\n## Context\nx\n`);   // incoming collision at 0002
  amk("0003", "other", `# ADR 0003 — other\n\n- **Status:** Accepted\n- **Supersedes:** ADR-0002\n- **Date:** 2026-06-21\n\n## Context\nx\n`);   // out-of-scope; symmetric with 0002-mine PRE-move
  const rn6 = adrRenumber(adir, "0002-mine.md", "next", ["0002-mine.md"]);   // moves 0002-mine→0004, out-of-scope 0003-other left pointing at 0002-peer → asymmetric
  t("renumber: an asymmetric out-of-scope ref makes re-validate red → exit 1 (never a silent green)", rn6.code === 1 && /FAIL/.test(rn6.err));
  // no-op: renumber to the same number exits 0.
  const ndir = path.join(tmp, "renum-noop", "docs", "adr");
  fs.mkdirSync(ndir, { recursive: true });
  fs.writeFileSync(path.join(ndir, "0001-a.md"), `# ADR 0001 — a\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  t("renumber: to the same number is a no-op exit 0", adrRenumber(ndir, "0001-a.md", "0001", []).code === 0);
  // sharpened duplicate message names every colliding file.
  const ddir = path.join(tmp, "dupmsg", "docs", "adr");
  fs.mkdirSync(ddir, { recursive: true });
  fs.writeFileSync(path.join(ddir, "0043-foo.md"), `# ADR 0043 — foo\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  fs.writeFileSync(path.join(ddir, "0043-bar.md"), `# ADR 0043 — bar\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\nx\n`);
  t("validate: duplicate message names every colliding file", adrValidate(ddir).some((p) => /duplicate ADR number 0043 —/.test(p) && /0043-foo\.md/.test(p) && /0043-bar\.md/.test(p)));

  // === FAFF-546 — `faff adr accept` + `adrGitTier`: the ADR-axis mirror of FAFF-463's PRDR pair ===
  {
    const acdir = path.join(tmp, "accept", "docs", "adr");
    fs.mkdirSync(acdir, { recursive: true });
    const acmk = (n, slug, status) => fs.writeFileSync(path.join(acdir, `${n}-${slug}.md`),
      `# ADR ${n} — ${slug}\n\n- **Status:** ${status}\n- **Date:** 2026-07-19\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n`);
    const statusOf = (n, slug) => (fs.readFileSync(path.join(acdir, `${n}-${slug}.md`), "utf8").match(/^[\s>*-]*\*{0,2}Status[\s*]*:[\s*]*(\S+)/mi) || [])[1];

    acmk("0001", "smoke", "Proposed");
    { const r = adrAccept(acdir, "0001-smoke.md");
      t("accept: Proposed → Accepted exits 0", r.code === 0 && /0001-smoke\.md$/.test(r.out.trim()));
      t("accept: Status field actually flipped, formatting preserved", statusOf("0001", "smoke") === "Accepted");
      t("accept: other fields/sections untouched", /## Context\nx\n\n## Decision\ny\n\n## Consequences\nz/.test(fs.readFileSync(path.join(acdir, "0001-smoke.md"), "utf8"))); }

    { const before = fs.readFileSync(path.join(acdir, "0001-smoke.md"), "utf8");
      const r = adrAccept(acdir, "0001-smoke.md");
      t("accept: already-Accepted is an idempotent no-op, exit 0", r.code === 0);
      t("accept: idempotent no-op leaves the file byte-unchanged", fs.readFileSync(path.join(acdir, "0001-smoke.md"), "utf8") === before); }

    acmk("0002", "superseded", "Superseded by ADR-0099");
    { const r = adrAccept(acdir, "0002-superseded.md");
      t("accept: refuses a Superseded ADR (exit 2), never overwrites the marker", r.code === 2 && /Superseded/.test(r.err) && statusOf("0002", "superseded").startsWith("Superseded")); }

    acmk("0003", "dup", "Proposed"); acmk("0003", "dup2", "Proposed");
    { const r = adrAccept(acdir, "0003");
      t("accept: ambiguous bare number refuses (exit 2), asks for a filename", r.code === 2 && /ambiguous/i.test(r.err)); }
    fs.rmSync(path.join(acdir, "0003-dup2.md"));
    { const r = adrAccept(acdir, "0003");
      t("accept: unambiguous bare number resolves and flips (exit 0)", r.code === 0 && statusOf("0003", "dup") === "Accepted"); }

    { const r = adrAccept(acdir, "no-such-file.md");
      t("accept: unknown selector refuses (exit 2)", r.code === 2 && /no ADR matching/.test(r.err)); }
    { const r = adrAccept(acdir, "9999");
      t("accept: unknown bare number refuses (exit 2)", r.code === 2 && /no ADR 9999/.test(r.err)); }

    // adrGitTier — real git repo fixture (mirrors prdrGitTier's selftest fixture)
    const mkRepo = () => {
      const r = fs.mkdtempSync(path.join(os.tmpdir(), "faff-adr-git-"));
      git(r, ["init", "-q"]); git(r, ["config", "user.email", "t@t"]); git(r, ["config", "user.name", "t"]);
      git(r, ["commit", "-q", "--allow-empty", "-m", "init"]); git(r, ["checkout", "-q", "-B", "main"]);
      const d = path.join(r, "docs", "adr"); fs.mkdirSync(d, { recursive: true });
      return { r, d };
    };
    const gseed = (d, num, status) => fs.writeFileSync(path.join(d, `${num}-smoke.md`),
      `# ADR ${num} — smoke\n\n- **Status:** ${status}\n- **Date:** 2026-07-19\n\n## Context\nx\n`);

    { const { r, d } = mkRepo(); gseed(d, "0001", "Accepted"); const gt = adrGitTier(d, r, {});
      t("git-tier: Accepted + untracked → FAIL accepted-uncommitted", gt.fails.some((f) => /accepted-uncommitted/.test(f)) && gt.notes.length === 0);
      fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); gseed(d, "0001", "Proposed"); const gt = adrGitTier(d, r, {});
      t("git-tier: Proposed + untracked → NOTE proposed-uncommitted (no FAIL)", gt.notes.some((n) => /proposed-uncommitted/.test(n)) && gt.fails.length === 0);
      fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); gseed(d, "0001", "Accepted");
      git(r, ["add", "-A"]); git(r, ["commit", "-q", "-m", "commit the accepted ADR"]);
      const gt = adrGitTier(d, r, {});
      t("git-tier: Accepted + committed/clean → no FAIL, no NOTE", gt.fails.length === 0 && gt.notes.length === 0);
      fs.rmSync(r, { recursive: true, force: true }); }
    { const { r, d } = mkRepo(); gseed(d, "0001", "Accepted"); const gt = adrGitTier(d, r, { "adr.validate_git": "off" });
      t("git-tier: validate_git=off → silent (no FAIL)", gt.fails.length === 0 && gt.notes.length === 0);
      fs.rmSync(r, { recursive: true, force: true }); }
    { const noGit = fs.mkdtempSync(path.join(os.tmpdir(), "faff-adr-nogit-")); const d = path.join(noGit, "docs", "adr"); fs.mkdirSync(d, { recursive: true }); gseed(d, "0001", "Accepted");
      t("git-tier: non-git tree → degrades silent (no FAIL)", adrGitTier(d, noGit, {}).fails.length === 0);
      fs.rmSync(noGit, { recursive: true, force: true }); }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  let failed = 0;
  for (const [n, ok] of cases) { console.log(`${ok ? "ok  " : "FAIL"} ${n}`); if (!ok) failed++; }
  console.log(`RESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}


module.exports = { ADR_FILE_RE, ADR_PROVENANCES, ADR_STATUSES, ADR_SPEC, ADR_SURFACE, adrAccept, adrAdvisories, adrDecisionBody, adrDir, adrField, adrGitTier, adrLiveDecisions, adrNextNumber, adrOfferRoute, adrRenumber, adrSelftest, adrSlug, adrSupersededBy, adrSupersedesSet, adrTemplate, adrValidate, cmdAdr, computeAdrAdvisories, listAdrs, recordSupersede, recordSupersededBy, recordSupersedesSet, recordSupersessionProblems, renumberRefsTo };
