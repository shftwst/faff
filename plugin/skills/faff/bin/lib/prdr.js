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
const { adrField, adrFlag, adrSlug, recordSupersede, recordSupersededBy, recordSupersessionProblems } = require("./adr");
const { DEFAULTS, loadConfig, resolvePrdrDocsPath } = require("./config");
const { PRDR_ACTORS, PRDR_SUPERSEDES, PRDR_YAGNI_PROPOSAL_VERDICTS, computePrdCoverage, computePrdCoverageVerdict, computePrdrAdmission, computePrdrAdmissionVerdict, computePrdrYagni, computePrdrYagniVerdict } = require("./contract-defs");
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

function cmdPrdr(args) {
  if (args.includes("--selftest")) return prdrSelftest();
  const action = args[0];
  const root = adrFlag(args, "--root") || findRoot();
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
    const container = adrFlag(args, "--container");
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
    if (!problems.length) { console.log(`OK — ${listPrdrs(dir).length} PRDR(s) in ${path.relative(root, dir) || dir} valid.`); return 0; }
    for (const p of problems) console.log(`FAIL  ${p}`);
    return 1;
  }

  if (action === "new") {
    const title = (args[1] && !args[1].startsWith("--")) ? args[1] : null;
    const container = adrFlag(args, "--container");
    const prdGoal = adrFlag(args, "--prd-goal");
    if (!title) { process.stderr.write("faff prdr new: <title> is required\n"); return 2; }
    if (!container) { process.stderr.write("faff prdr new: --container is required\n"); return 2; }
    if (!prdGoal) { process.stderr.write("faff prdr new: --prd-goal is required\n"); return 2; }
    const provenance = adrFlag(args, "--provenance");
    if (provenance && !PRDR_PROVENANCES.includes(provenance)) { process.stderr.write(`faff prdr new: --provenance must be one of ${PRDR_PROVENANCES.join("|")}\n`); return 2; }
    const date = adrFlag(args, "--date") || new Date().toISOString().slice(0, 10);
    const num = prdrNextNumber(dir);
    const file = `${num}-${adrSlug(title)}.md`;
    const full = path.join(dir, file);
    if (fs.existsSync(full)) { process.stderr.write(`faff prdr new: ${file} already exists — never overwrite (append-only)\n`); return 1; }
    fs.mkdirSync(dir, { recursive: true });
    // provenance default = human (fail-safe: the harder-to-supersede tier; the loop passes --provenance loop).
    fs.writeFileSync(full, prdrTemplate({ num, title, date, container, prdGoal, provenance: provenance || "human", status: adrFlag(args, "--status") }));
    process.stdout.write(full + "\n");   // stdout = path ONLY (parity with `adr new`/`prd new`)
    return 0;
  }

  if (action === "supersede") {
    // Pure mechanical linker — the SHARED writer, prefix "PRDR" (mirror `adr supersede` exactly;
    // NO actor/authority concept — that is FAFF-255's gate, P1).
    const r = recordSupersede(dir, root, listPrdrs(dir), args[1], adrFlag(args, "--by"), "PRDR");
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    return r.code;
  }

  if (action === "admit") {
    // The two-gate admission gate (FAFF-255). Pure — no tracker/network call (parity with `faff next`):
    // the agent maps the move's state onto these closed-vocabulary flags. <prdr> is accepted for the
    // human-readable echo / lineage label; the verdict itself is a pure function of the flags.
    const actor = adrFlag(args, "--actor");
    if (!PRDR_ACTORS.includes(actor)) { process.stderr.write("faff prdr admit: --actor must be loop|human\n"); return 2; }
    const sup = adrFlag(args, "--supersedes-provenance");
    if (!PRDR_SUPERSEDES.includes(sup)) { process.stderr.write("faff prdr admit: --supersedes-provenance must be human|loop|none\n"); return 2; }
    const cfg = loadConfig(root)[0];
    const tmRaw = adrFlag(args, "--thrash-max") ?? dig(cfg, "prdr.thrash_max") ?? DEFAULTS["prdr.thrash_max"];
    const thrashMax = parseInt(tmRaw, 10);
    // thrash_max + lineage are COUNTS — a negative is nonsensical and would breach the ratchet at
    // lineage 0 (lineage >= negative is always true), spuriously rejecting every admit. Reject it.
    if (!Number.isInteger(thrashMax) || thrashMax < 0) { process.stderr.write(`faff prdr admit: thrash_max "${tmRaw}" must be a non-negative integer\n`); return 2; }
    const lsRaw = adrFlag(args, "--lineage-supersessions");
    const lineageSupersessions = lsRaw != null ? parseInt(lsRaw, 10) : 0;
    if (!Number.isInteger(lineageSupersessions) || lineageSupersessions < 0) { process.stderr.write(`faff prdr admit: --lineage-supersessions "${lsRaw}" must be a non-negative integer\n`); return 2; }
    let upper = null, lower = null;
    const upRaw = adrFlag(args, "--upper");
    if (upRaw != null) { try { upper = JSON.parse(upRaw); } catch (e) { process.stderr.write(`faff prdr admit: --upper is not valid JSON: ${e.message}\n`); return 2; } }
    const loRaw = adrFlag(args, "--lower");
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
    const prdGoal = adrFlag(args, "--prd-goal");
    let prdGoals = [];
    const goalsRaw = adrFlag(args, "--prd-goals");
    if (goalsRaw != null) {
      try { prdGoals = JSON.parse(goalsRaw); } catch (e) { process.stderr.write(`faff prdr yagni: --prd-goals is not valid JSON: ${e.message}\n`); return 2; }
      if (!Array.isArray(prdGoals)) { process.stderr.write("faff prdr yagni: --prd-goals must be a JSON array of strings\n"); return 2; }
    }
    const proposalVerdict = adrFlag(args, "--proposal");
    if (proposalVerdict != null && !PRDR_YAGNI_PROPOSAL_VERDICTS.includes(proposalVerdict)) {
      process.stderr.write("faff prdr yagni: --proposal must be admit|reject\n"); return 2;
    }
    const challenge = adrFlag(args, "--challenge");
    if (challenge != null && challenge !== "survived" && challenge !== "overturned") {
      process.stderr.write("faff prdr yagni: --challenge must be survived|overturned (omit when Phase 2 did not conclude)\n"); return 2;
    }
    const verdict = computePrdrYagniVerdict({
      prdGoal, prdGoals,
      proposalVerdict, proposalReason: adrFlag(args, "--proposal-reason"),
      servesGoal: args.includes("--serves-goal"), withinScope: args.includes("--within-scope"),
      challenge, challengeReason: adrFlag(args, "--challenge-reason"),
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
    const goalsRaw = adrFlag(args, "--prd-goals");
    if (goalsRaw != null) {
      try { prdGoals = JSON.parse(goalsRaw); } catch (e) { process.stderr.write(`faff prdr coverage: --prd-goals is not valid JSON: ${e.message}\n`); return 2; }
      if (!Array.isArray(prdGoals)) { process.stderr.write("faff prdr coverage: --prd-goals must be a JSON array of strings\n"); return 2; }
    }
    // livePrdrs: the live (non-superseded) PRDR set — each { id, prd_goal, dod_verdict? }. Either pass it
    // directly via --live-prdrs (pure; e.g. from `prdr list --live --json`), or omit it to let the
    // producer read the live PRDRs from docs/prdr itself (the static coverage convenience).
    let livePrdrs = null;
    const liveRaw = adrFlag(args, "--live-prdrs");
    if (liveRaw != null) {
      try { livePrdrs = JSON.parse(liveRaw); } catch (e) { process.stderr.write(`faff prdr coverage: --live-prdrs is not valid JSON: ${e.message}\n`); return 2; }
      if (!Array.isArray(livePrdrs)) { process.stderr.write("faff prdr coverage: --live-prdrs must be a JSON array of objects\n"); return 2; }
    } else {
      // Read live PRDRs from docs/prdr (no network — filesystem only, still pure of side effects).
      let prdrs = listPrdrs(dir).filter((p) => !recordSupersededBy(p.status, "PRDR"));
      const container = adrFlag(args, "--container");
      if (container) prdrs = prdrs.filter((p) => p.container && adrSlug(p.container) === adrSlug(container));
      livePrdrs = prdrs.map((p) => ({ id: p.num, prd_goal: p.prd_goal }));
    }
    // --dod-verdicts: optional FAFF-34 verdict map { "<prdr-id>": "met"|... }, merged onto livePrdrs by id.
    // Absent ⇒ every DoD unverified ⇒ conservatively not-met (the unbuilt-evaluator default).
    const dvRaw = adrFlag(args, "--dod-verdicts");
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

  process.stderr.write("faff prdr: expected one of: path | new | list | supersede | validate | admit | yagni | coverage (or --selftest)\n");
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

  let failed = 0;
  for (const [name, ok] of cases) { if (!ok) { process.stderr.write(`prdr --selftest FAIL: ${name}\n`); failed++; } }
  if (failed) { process.stderr.write(`prdr --selftest: ${failed}/${cases.length} failed\n`); return 1; }
  console.log(`prdr --selftest: ok (${cases.length} cases)`);
  return 0;
}


module.exports = { PRDR_FILE_RE, PRDR_PROVENANCES, PRDR_SECTIONS, PRDR_STATUSES, cmdPrdr, listPrdrs, prdrDir, prdrNextNumber, prdrSelftest, prdrTemplate, prdrValidate };
