// ===========================================================================
// === region:factory — prd — product requirements documents (FAFF-252; ADR 0016). The PRODUCT-axis ===
// counterpart to `adr`: a durable docs/prd/<container-slug>.md per container,
// structurally mirroring the adr CLI. ONE PRD per container, slug-keyed (no
// global number — supersession is the PRDR's job, FAFF-245). Lean / format-
// flexible: validate checks PRESENCE, never section shape. The CLI writes the
// file + emits the container-link line; the CALLER commits + applies the link
// (orchestrator-agnostic, exactly like `adr new`). Reuses adrField.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { acceptanceSection, classifyAcceptanceCriteria } = require("./admissibility");
const { adrField } = require("./adr");
const { parseArgs, requireFlags, usageError } = require("./argv");
const PRD_SPEC = { flags: {
  "--json": { arity: 0 }, "--selftest": { arity: 0 }, "--strict": { arity: 0 },
  "--date": { arity: 1 }, "--root": { arity: 1 }, "--status": { arity: 1 }, "--url": { arity: 1 },
}, positionals: { min: 0, max: null, name: "verb container" } };
// FAFF-628 — the declared, machine-readable command grammar `faff cli-surface --json`
// aggregates. subcommands' required_flags are migrated from the ad-hoc checks below —
// `requireFlags` is the shared enforcer BOTH this handler and the drift-guard read from.
const PRD_SURFACE = {
  kind: "subcommand_dispatch",
  spec: PRD_SPEC,
  subcommands: {
    path: { required_flags: [] },
    new: { required_flags: [] },
    link: { required_flags: ["--url"] },
    list: { required_flags: [] },
    validate: { required_flags: [] },
  },
};
const { loadConfig, resolvePrdDocsPath } = require("./config");
const { findRoot } = require("./shared-infra");

const PRD_STATUSES = ["Draft", "Active", "Frozen", "Stale"];
const PRD_FILE_RE = /^(.+)\.md$/;

function prdDir(root) { return path.join(root, resolvePrdDocsPath(root, loadConfig(root)[0], false)); }

function prdSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "prd";
}

// The metadata header region — everything before the first "## " section. The **PRD:** link line
// lives here; scoping link-detection to the header avoids a false match on a body line that
// happens to start "PRD:" (the `adrField`/hasLink regexes are otherwise document-wide).
function prdHeader(text) { return text.split(/^##\s+/m)[0]; }

function listPrds(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(PRD_FILE_RE);
    if (!m) continue;
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const titleM = text.match(/^#\s*PRD\s*[—\-]\s*(.+)$/mi);
    out.push({
      slug: m[1], file: f,
      title: titleM ? titleM[1].trim() : null,
      container: adrField(text, "Container"),
      status: adrField(text, "Status"),
      date: adrField(text, "Date"),
      mode: adrField(text, "Mode"),
      url: adrField(prdHeader(text), "PRD") || null,   // linked-mode files carry the **PRD:** header line as the url
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

function prdTemplate({ container, date, status }) {
  const lines = [`# PRD — ${container}`, "",
    `- **Container:** ${container}`,
    `- **Status:** ${status || "Draft"}`,
    `- **Date:** ${date}`,
    `- **Mode:** authored`, "",
    "## Problem / objective", "", "_TODO: the user-facing problem + the outcome this delivers (what & why, never how)._", "",
    "## Goals & success metrics", "", "_TODO._", "",
    "## Non-goals", "", "_TODO._", "",
    "## Users", "", "_TODO._", "",
    "## Requirements", "", "_TODO: MoSCoW or P0/P1/P2; lean._", "",
    "## Acceptance criteria", "",
    "_TODO: replace the italic examples with the real release/done conditions. Each criterion is EITHER a Given/When/Then scenario (behavioural) OR a single MUST/comparator assertion (non-functional) — never loose prose. `faff prd validate --strict`, and any Frozen PRD, rejects loose prose. Examples:_", "",
    "_- Given <a precondition>, When <the action runs>, Then <the observable outcome>_",
    "_- The <metric> MUST be < <threshold>_", "",
    "## Open questions", "", "_TODO._", ""];
  return lines.join("\n");
}

// --- Born-verifiable done-criteria form-check (FAFF-254) -------------------
// Makes a PRD's `## Acceptance criteria` machine-checkable IN FORM — the L4
// termination contract's first half. REUSES FAFF-253's `prd-readiness` contract
// surface (the admit-this-run? verdict); it does NOT define a second contract.
// This deterministic form-check is the forward interface the run-start gate /
// evaluator (FAFF-34) consume for the `stop_conditions_verifiable` signal.
//
// It checks FORM + PRESENCE, never semantic verifiability — a string validator
// can confirm a criterion is *shaped* as a scenario/assertion; it cannot judge
// whether the predicate is truly checkable (the evaluator's/human's job). Reuses
// FAFF-10's two forms: behavioural → Given-When-Then; non-functional →
// MUST/comparator assertion. Anything else is loose prose (not born-verifiable).

// A relational comparator token (< > <= >= ≤ ≥, or a bare relational `=`).
function prdStatusIsFrozen(status) { return !!status && /^\s*frozen/i.test(status); }

// Strict (born-verifiable) form-check over ONE PRD's text. Missing section /
// placeholder-only / any prose criterion → a violation. Targets ONLY acceptance
// criteria — `## Requirements` (the open feature set) is never form-checked.
function prdStrictCheck(prdText) {
  const section = acceptanceSection(prdText);
  if (section === null) return ["no '## Acceptance criteria' section"];
  const criteria = classifyAcceptanceCriteria(section);
  if (criteria.length === 0) return ["acceptance criteria are placeholder-only — no born-verifiable criterion"];
  const out = [];
  for (const c of criteria) {
    if (c.kind === "prose") {
      out.push(`criterion not born-verifiable (loose prose, not a Given/When/Then scenario or MUST/comparator assertion): ${c.text.replace(/\s+/g, " ").slice(0, 60)}`);
    }
  }
  return out;
}

// Lenient validate (mirrors adrValidate's philosophy): metadata PRESENT + Status in enum +
// a non-empty body — either >=1 "## " section (authored) OR a "**PRD:**" link line (linked).
// NEVER checks WHICH sections (format-flexible). Flags a url+body collision (both a link line
// and "## " sections — linked and authored are mutually exclusive).
//
// FAFF-254: the born-verifiable strict form-check layers on top — run for EVERY PRD when
// `--strict`, and ALWAYS for a `Frozen`-status PRD (the freeze precondition: a frozen PRD must
// have well-formed born-verifiable stop-conditions). Draft/Active/Stale stay lenient unless --strict.
function prdValidate(dir, opts) {
  const strict = !!(opts && opts.strict);
  const prds = listPrds(dir);
  const problems = [];
  for (const p of prds) {
    const text = fs.readFileSync(path.join(dir, p.file), "utf8");
    if (!p.container) problems.push(`${p.file}: missing Container field`);
    if (!p.status) problems.push(`${p.file}: missing Status field`);
    else if (!PRD_STATUSES.some((s) => new RegExp(`^${s}`, "i").test(p.status))) problems.push(`${p.file}: Status "${p.status.slice(0, 30)}" must start with one of ${PRD_STATUSES.join("|")}`);
    if (!p.date) problems.push(`${p.file}: missing Date field`);
    const sections = (text.match(/^##\s+\S/gmi) || []).length;
    const hasLink = /^[\s>*-]*\*{0,2}PRD[\s*]*:/mi.test(prdHeader(text));
    if (!hasLink && sections === 0) problems.push(`${p.file}: no body — needs >=1 "## " section or a **PRD:** link line`);
    if (hasLink && sections > 0) problems.push(`${p.file}: both a **PRD:** link line and "## " body sections — linked and authored are mutually exclusive`);
    // Born-verifiable form-check: every PRD under --strict; always for Frozen (the freeze precondition).
    // Skip linked-mode PRDs (no authored body to form-check).
    if ((strict || prdStatusIsFrozen(p.status)) && !hasLink) {
      for (const v of prdStrictCheck(text)) problems.push(`${p.file}: ${v}`);
    }
  }
  return problems;
}

function cmdPrd(args) {
  if (args.includes("--selftest")) return prdSelftest();
  const parsed = parseArgs(args, PRD_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff prd <path|new|...> [container] [--status S] [--url U] [--date D] [--strict] [--json] [--root DIR]");
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const action = args[0];
  const root = get("--root") || findRoot();
  const dir = prdDir(root);
  const container = (args[1] && !args[1].startsWith("--")) ? args[1] : null;

  if (action === "path") {
    if (!container) { process.stderr.write("faff prd path: <container> is required\n"); return 2; }
    process.stdout.write(path.join(dir, prdSlug(container) + ".md") + "\n");
    return 0;
  }

  if (action === "list") {
    const prds = listPrds(dir);
    if (args.includes("--json")) {
      console.log(JSON.stringify(prds.map(({ slug, container, status, date, mode, url, file }) =>
        ({ slug, container, status, date, mode, url, file })), null, 2));
    } else if (!prds.length) {
      console.log(`No PRDs in ${path.relative(root, dir) || dir}.`);
    } else {
      for (const p of prds) console.log(`${p.slug}  ${p.title || ""}  [${(p.status || "?").split(/[ (.]/)[0]}]  ${p.mode || "?"}  ${p.url || p.date || ""}`.trimEnd());
    }
    return 0;
  }

  if (action === "validate") {
    const strict = args.includes("--strict");
    const problems = prdValidate(dir, { strict });
    if (!problems.length) { console.log(`OK — ${listPrds(dir).length} PRD(s) in ${path.relative(root, dir) || dir} valid${strict ? " (strict: born-verifiable)" : ""}.`); return 0; }
    for (const p of problems) console.log(`FAIL  ${p}`);
    return 1;
  }

  if (action === "new") {
    if (!container) { process.stderr.write("faff prd new: <container> is required\n"); return 2; }
    const date = get("--date") || new Date().toISOString().slice(0, 10);
    const file = `${prdSlug(container)}.md`;
    const full = path.join(dir, file);
    if (fs.existsSync(full)) { process.stderr.write(`faff prd new: ${file} already exists — never overwrite (edit in place)\n`); return 1; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, prdTemplate({ container, date, status: get("--status") }));
    process.stdout.write(full + "\n");   // stdout = the path only (parity with `adr new` — safe to `p=$(faff prd new …)`)
    // Hint the container-link line on STDERR so a caller parsing stdout gets a clean path (degrade-not-fail).
    process.stderr.write(`**PRD:** ${path.relative(root, full)}\n`);
    return 0;
  }

  if (action === "link") {
    if (!container) { process.stderr.write("faff prd link: <container> is required\n"); return 2; }
    const reqErr = requireFlags(parsed.values, PRD_SURFACE.subcommands.link, "prd", "link");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    const url = get("--url");
    // The CLI makes NO tracker call — it emits the line; the orchestrator applies it (degrade-not-fail).
    process.stdout.write(`**PRD:** ${url}\n`);
    return 0;
  }

  process.stderr.write("faff prd: expected one of: path | new | link | list | validate [--strict] (or --selftest)\n");
  return 2;
}

function prdSelftest() {
  const os = require("node:os");
  const cases = [];
  const t = (name, ok) => cases.push([name, !!ok]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-prd-"));
  const dir = path.join(tmp, "docs", "prd");
  fs.mkdirSync(dir, { recursive: true });

  t("slug kebabs + trims", prdSlug("My Project — Foo!") === "my-project-foo");
  t("slug fallback", prdSlug("***") === "prd");
  t("resolver default docs/prd", resolvePrdDocsPath(tmp, {}, false) === "docs/prd");
  t("resolver honours config", resolvePrdDocsPath(tmp, { tracking: { prd_docs_path: "x/y/" } }, false) === "x/y");

  // new: a valid template, listed + parsed
  fs.writeFileSync(path.join(dir, prdSlug("Alpha Project") + ".md"),
    prdTemplate({ container: "Alpha Project", date: "2026-06-26", status: "Draft" }));
  const list1 = listPrds(dir);
  t("new file listed", list1.length === 1 && list1[0].slug === "alpha-project");
  t("template metadata parsed", list1[0].container === "Alpha Project" && list1[0].status === "Draft" && list1[0].mode === "authored");
  t("validate clean", prdValidate(dir).length === 0);

  // missing Status flagged
  fs.writeFileSync(path.join(dir, "beta.md"), "# PRD — Beta\n\n- **Container:** Beta\n- **Date:** 2026-06-26\n\n## Problem\nx\n");
  t("missing Status flagged", prdValidate(dir).some((p) => /^beta\.md: missing Status/.test(p)));
  fs.unlinkSync(path.join(dir, "beta.md"));

  // no-body flagged
  fs.writeFileSync(path.join(dir, "gamma.md"), "# PRD — Gamma\n\n- **Container:** Gamma\n- **Status:** Draft\n- **Date:** 2026-06-26\n");
  t("no-body flagged", prdValidate(dir).some((p) => /^gamma\.md: no body/.test(p)));
  fs.unlinkSync(path.join(dir, "gamma.md"));

  // url+body collision flagged
  fs.writeFileSync(path.join(dir, "delta.md"), "# PRD — Delta\n\n- **Container:** Delta\n- **Status:** Draft\n- **Date:** 2026-06-26\n- **PRD:** https://x/y\n\n## Problem\nx\n");
  t("collision flagged", prdValidate(dir).some((p) => /^delta\.md: both/.test(p)));
  fs.unlinkSync(path.join(dir, "delta.md"));

  // linked-as-file (PRD line, no sections) is valid; url parsed
  fs.writeFileSync(path.join(dir, "epsilon.md"), "# PRD — Epsilon\n\n- **Container:** Epsilon\n- **Status:** Active\n- **Date:** 2026-06-26\n- **Mode:** linked\n- **PRD:** https://x/y\n");
  t("linked file valid", !prdValidate(dir).some((p) => /^epsilon/.test(p)));
  t("linked url parsed", listPrds(dir).find((p) => p.slug === "epsilon").url === "https://x/y");
  fs.unlinkSync(path.join(dir, "epsilon.md"));

  // --- FAFF-254: born-verifiable form-check -------------------------------
  // Classifier (pure): scenario by Then, assertion by MUST/comparator, else prose.
  const cls = (s) => classifyAcceptanceCriteria(s).map((c) => c.kind);
  t("classify scenario by Then", cls("- Given a queue, When a job lands, Then it is picked up")[0] === "scenario");
  t("classify assertion by MUST", cls("- The API MUST return JSON")[0] === "assertion");
  t("classify assertion by comparator", cls("- Response p99 < 200ms")[0] === "assertion");
  t("classify loose prose", cls("- the feature should work well")[0] === "prose");
  t("placeholder + blanks stripped", classifyAcceptanceCriteria("\n_TODO._\n").length === 0);
  t("two criteria split", cls("- Given x, When y, Then z\n- The p99 MUST be < 200ms").join(",") === "scenario,assertion");
  t("multiline GWT block is one scenario", cls("Given x\nWhen y\nThen z").join(",") === "scenario");
  t("capitalised-Then only — lowercase prose 'then' stays prose", cls("- run it and then it works")[0] === "prose");

  // Section extraction: case-insensitive prefix; null when absent.
  t("acceptanceSection prefix-matches variant heading",
    acceptanceSection("## Acceptance Criteria (release)\n- The x MUST be y\n").trim() === "- The x MUST be y");
  t("acceptanceSection stops at next section",
    acceptanceSection("## Acceptance criteria\n- a MUST b\n\n## Open questions\n- The x MUST be y\n").includes("a MUST b") &&
    !acceptanceSection("## Acceptance criteria\n- a MUST b\n\n## Open questions\n- The x MUST be y\n").includes("Open"));
  t("acceptanceSection null when absent", acceptanceSection("## Problem\nx\n") === null);

  // strictCheck + dispatch: placeholder-only fails; born-verifiable passes; prose fails; Requirements ignored.
  const bvCriteria = "## Acceptance criteria\n\n- Given a run, When the PRD is admissible, Then the run starts\n- The p99 latency MUST be < 200ms\n";
  const prosey = "## Acceptance criteria\n\n- the dashboard should look nice\n";
  const mkPrd = (status, body) => `# PRD — Z\n\n- **Container:** Z\n- **Status:** ${status}\n- **Date:** 2026-06-26\n- **Mode:** authored\n\n${body}`;

  // fresh template: Draft passes lenient, FAILs --strict (placeholder-only)
  fs.writeFileSync(path.join(dir, "tmpl.md"), prdTemplate({ container: "Tmpl", date: "2026-06-26", status: "Draft" }));
  t("template lenient-valid", !prdValidate(dir).some((p) => /^tmpl\.md/.test(p)));
  t("template fails --strict (placeholder-only)", prdValidate(dir, { strict: true }).some((p) => /^tmpl\.md:.*placeholder-only/.test(p)));
  fs.unlinkSync(path.join(dir, "tmpl.md"));

  fs.writeFileSync(path.join(dir, "bv.md"), mkPrd("Draft", bvCriteria + "\n## Requirements\n\n- anything goes here, totally loose prose\n"));
  t("born-verifiable passes --strict (Requirements ignored)", !prdValidate(dir, { strict: true }).some((p) => /^bv\.md/.test(p)));
  fs.unlinkSync(path.join(dir, "bv.md"));

  fs.writeFileSync(path.join(dir, "prose.md"), mkPrd("Draft", prosey));
  t("prose Draft passes lenient", !prdValidate(dir).some((p) => /^prose\.md/.test(p)));
  t("prose fails --strict", prdValidate(dir, { strict: true }).some((p) => /^prose\.md:.*not born-verifiable/.test(p)));
  fs.unlinkSync(path.join(dir, "prose.md"));

  // Frozen freeze precondition: lenient (no --strict) FAILs a Frozen prose PRD; born-verifiable Frozen passes.
  fs.writeFileSync(path.join(dir, "frozen-bad.md"), mkPrd("Frozen", prosey));
  t("Frozen prose fails lenient validate (freeze precondition)", prdValidate(dir).some((p) => /^frozen-bad\.md:.*not born-verifiable/.test(p)));
  fs.unlinkSync(path.join(dir, "frozen-bad.md"));

  fs.writeFileSync(path.join(dir, "frozen-ok.md"), mkPrd("Frozen", bvCriteria));
  t("Frozen born-verifiable passes lenient validate", !prdValidate(dir).some((p) => /^frozen-ok\.md/.test(p)));
  fs.unlinkSync(path.join(dir, "frozen-ok.md"));

  // missing section under --strict
  fs.writeFileSync(path.join(dir, "nosec.md"), mkPrd("Draft", "## Problem\nx\n"));
  t("missing acceptance-criteria section fails --strict", prdValidate(dir, { strict: true }).some((p) => /^nosec\.md:.*no '## Acceptance criteria'/.test(p)));
  fs.unlinkSync(path.join(dir, "nosec.md"));

  fs.rmSync(tmp, { recursive: true, force: true });

  let failed = 0;
  for (const [name, ok] of cases) { if (!ok) { process.stderr.write(`prd --selftest FAIL: ${name}\n`); failed++; } }
  if (failed) { process.stderr.write(`prd --selftest: ${failed}/${cases.length} failed\n`); return 1; }
  console.log(`prd --selftest: ok (${cases.length} cases)`);
  return 0;
}


module.exports = { PRD_FILE_RE, PRD_STATUSES, PRD_SPEC, PRD_SURFACE, cmdPrd, listPrds, prdDir, prdHeader, prdSelftest, prdSlug, prdStatusIsFrozen, prdStrictCheck, prdTemplate, prdValidate };
