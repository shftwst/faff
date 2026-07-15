// ===========================================================================
// === region:factory — adr — architecture decision records (FAFF-16). Deterministic mechanics over the ===
// repo's append-only docs/adr/NNNN-title.md Nygard log: number / scaffold / list / validate.
// The judgement (is a decision significant? record it?) stays with the human in faff-prep;
// this command owns only the mechanical parts. Append-only: `new` never overwrites.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { findRoot } = require("./shared-infra");

const ADR_STATUSES = ["Proposed", "Accepted", "Superseded", "Deprecated", "Rejected"];
const ADR_FILE_RE = /^(\d{4})-(.+)\.md$/;

function adrDir(root) { return path.join(root, "docs", "adr"); }

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
//   selector  a docs/adr filename OR a bare number (a duplicated bare number is REJECTED —
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
  // corrupt an unrelated file nor escape docs/adr/ (basename + ADR-shape bound the blast radius to
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

function adrTemplate({ num, title, date, issue, initiative, status }) {
  const lines = [`# ADR ${num} — ${title}`, "", `- **Status:** ${status || "Proposed"}`, `- **Date:** ${date}`];
  if (issue) lines.push(`- **Issue:** ${issue}`);
  if (initiative) lines.push(`- **Initiative:** ${initiative}`);
  lines.push("", "## Context", "", "_TODO: what forces this decision._", "",
             "## Decision", "", "_TODO: the decision, stated forward._", "",
             "## Consequences", "", "_TODO: what this constrains downstream._", "");
  return lines.join("\n");
}

function adrFlag(args, name) { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; }

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
    out.push({ adr: a.num, title: a.title || a.slug || null, decision: adrDecisionBody(text) });
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
  const action = args[0];
  const root = adrFlag(args, "--root") || findRoot();
  const dir = adrDir(root);

  if (action === "next-number") { process.stdout.write(adrNextNumber(dir) + "\n"); return 0; }

  if (action === "list") {
    const adrs = listAdrs(dir);
    if (args.includes("--json")) {
      console.log(JSON.stringify(adrs.map(({ number, num, title, status, date, file }) =>
        ({ number, id: num, title, status, date, file })), null, 2));
    } else if (!adrs.length) {
      console.log(`No ADRs in ${path.relative(root, dir) || dir}.`);
    } else {
      for (const a of adrs) console.log(`${a.num}  ${a.title || a.slug}  [${(a.status || "?").split(/[ (.]/)[0]}]  ${a.date || ""}`.trimEnd());
    }
    return 0;
  }

  if (action === "live-decisions") {
    // FAFF-198: emit `live_adr_decisions` — the seam-input candidate set (non-superseded, exclude-new,
    // each `## Decision` body read). Deterministic plumbing AROUND the LLM seam; never runs the seam.
    const live = adrLiveDecisions(dir, adrFlag(args, "--exclude"));
    console.log(JSON.stringify(live, null, 2));
    return 0;
  }

  if (action === "validate") {
    const problems = adrValidate(dir);
    const advisories = adrAdvisories(dir); // FAFF-342: informational only — never gates the exit code
    if (!problems.length) {
      console.log(`OK — ${listAdrs(dir).length} ADR(s) in ${path.relative(root, dir) || dir} valid.`);
      for (const adv of advisories) console.log(adv);
      return 0;
    }
    for (const p of problems) console.log(`FAIL  ${p}`);
    for (const adv of advisories) console.log(adv);
    return 1;
  }

  if (action === "new") {
    const title = adrFlag(args, "--title");
    if (!title) { process.stderr.write("faff adr new: --title is required\n"); return 2; }
    const date = adrFlag(args, "--date") || new Date().toISOString().slice(0, 10);
    const num = adrNextNumber(dir);
    const file = `${num}-${adrSlug(title)}.md`;
    const full = path.join(dir, file);
    if (fs.existsSync(full)) { process.stderr.write(`faff adr new: ${file} already exists — never overwrite (append-only)\n`); return 1; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, adrTemplate({ num, title, date, issue: adrFlag(args, "--issue"), initiative: adrFlag(args, "--initiative"), status: adrFlag(args, "--status") }));
    process.stdout.write(full + "\n");
    return 0;
  }

  if (action === "supersede") {
    // faff adr supersede <old> --by <new> — link two existing ADRs with the canonical form.
    // The ONE place the CLI edits an existing ADR — and only its Status value + one Supersedes line.
    // FAFF-245: the write is the shared, prefix-parameterised `recordSupersede` (no fork).
    const r = recordSupersede(dir, root, listAdrs(dir), args[1], adrFlag(args, "--by"), "ADR");
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    return r.code;
  }

  if (action === "renumber") {
    // faff adr renumber <selector> --to <target> [--ref-scope f,f...] — FAFF-368: the merge-time
    // collision-repair primitive. Moves ONE ADR to a free number, fixes heading + in-scope back-refs,
    // and re-validates; graft's Step-10 merge guard calls it, never free-hands git mv + heading edits.
    const selector = args[1];
    if (!selector || selector.startsWith("--")) { process.stderr.write("faff adr renumber: <selector> (a docs/adr filename or a bare number) is required\n"); return 2; }
    const to = adrFlag(args, "--to");
    if (!to) { process.stderr.write("faff adr renumber: --to <NNNN|next> is required\n"); return 2; }
    const rsFlag = adrFlag(args, "--ref-scope");
    const refScope = rsFlag ? rsFlag.split(/[,\s]+/).filter(Boolean) : [];
    const r = adrRenumber(dir, selector, to, refScope);
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    return r.code;
  }

  process.stderr.write("faff adr: expected one of: next-number | new | list | live-decisions | validate | supersede | renumber (or --selftest)\n");
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

  fs.rmSync(tmp, { recursive: true, force: true });
  let failed = 0;
  for (const [n, ok] of cases) { console.log(`${ok ? "ok  " : "FAIL"} ${n}`); if (!ok) failed++; }
  console.log(`RESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}


module.exports = { ADR_FILE_RE, ADR_STATUSES, adrAdvisories, adrDecisionBody, adrDir, adrField, adrFlag, adrLiveDecisions, adrNextNumber, adrOfferRoute, adrRenumber, adrSelftest, adrSlug, adrSupersededBy, adrSupersedesSet, adrTemplate, adrValidate, cmdAdr, computeAdrAdvisories, listAdrs, recordSupersede, recordSupersededBy, recordSupersedesSet, recordSupersessionProblems, renumberRefsTo };
