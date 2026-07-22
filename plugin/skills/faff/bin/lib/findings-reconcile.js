// ===========================================================================
// === region:factory — findings-reconcile — FAFF-569: resolved-elsewhere correlation ===
// A finding-ticket (a bug captured from an autonomous run's findings log)
// frequently gets fixed under a DIFFERENT ticket number — a split child, a
// re-scoped slice, or an independently-filed fix — and nothing walks back from
// the merged fix to notice the finding is now stale, so it sits open (often
// Urgent) poisoning every wtf/map/next read. This module is the DETERMINISTIC
// half of tidy's resolved-elsewhere structural diagnostic: given the agent-
// fetched finding-tickets + a fix corpus on stdin, it computes the two
// mechanical correlations — findings-log ANCHOR CO-REFERENCE and TRACKER/
// CITATION RELATION to a merged fix — and emits evidence-bearing candidates.
// It does NOT compute symptom similarity (that recall layer is genuine LLM
// judgement tidy adds on top, weak-only) and it NEVER dispositions: surface,
// never close (FAFF-569 spec — the disposition itself is the settled FAFF-565
// convention, applied by a human). PURE: no tracker, no network, no writes —
// parity with `faff next` / `faff contain` / `faff queue-state`.
// ===========================================================================

// --- The anchor grammar (FAFF-569 spec §3) ---------------------------------
// A finding-ticket is identified by a findings-log path in its description;
// its anchor is the (log_path, finding_id) pair. The path is an OPAQUE
// IDENTITY KEY — it may live in a different repo and `.faff/logs/` is
// gitignored, so it is matched as a string, never read as a file. The
// finding-id is optional (a ticket may cite a log with no F-id).
const LOG_PATH_RE = /[^\s`"'()\[\]<>]+-findings\.md/g;
const FINDING_ID_RE = /\bfinding\s+F(\d+)\b/i;

// extractAnchor(text) -> { log_path, finding_id } | null. First findings-log
// path wins (a description citing two logs is unheard of; first-cited is the
// durable convention). finding_id normalises to "F<n>".
function extractAnchor(text) {
  if (typeof text !== "string" || text === "") return null;
  LOG_PATH_RE.lastIndex = 0;
  const pathMatch = LOG_PATH_RE.exec(text);
  if (!pathMatch) return null;
  const idMatch = FINDING_ID_RE.exec(text);
  return { log_path: pathMatch[0], finding_id: idMatch ? `F${idMatch[1]}` : null };
}

// --- Terminal-status check (name-based, gateway "What counts as cancelled" ---
// --- + Done-category fallback) — the CLI is pure (no tracker categories in ---
// --- hand), so a live status STRING is classified by name. Unrecognisable  ---
// --- statuses stay non-terminal: over-surfacing a candidate costs a human  ---
// --- glance; under-surfacing hides a stale finding (the bug this exists    ---
// --- for). The caller feeds LIVE statuses (Always-pull-fresh).             ---
const TERMINAL_STATUS_NAMES = new Set([
  "done", "completed", "complete", "closed", "shipped",
  "cancelled", "canceled", "duplicate", "won't fix", "wont fix", "won't do", "wont do",
]);

function isTerminalStatus(status) {
  return typeof status === "string" && TERMINAL_STATUS_NAMES.has(status.trim().toLowerCase());
}

// --- Input validation (fail-loud: exit 2 on malformed, NEVER a silent ------
// --- empty result — a garbled payload must not read as "no candidates") ----
function validateInput(input) {
  const errs = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return ["input is not a JSON object"];
  }
  if (!Array.isArray(input.finding_tickets)) errs.push("finding_tickets is not an array");
  if (!Array.isArray(input.fix_corpus)) errs.push("fix_corpus is not an array");
  if (errs.length) return errs;
  input.finding_tickets.forEach((ft, i) => {
    if (!ft || typeof ft !== "object" || typeof ft.id !== "string" || ft.id === "") {
      errs.push(`finding_tickets[${i}]: missing/invalid string id`);
    }
  });
  input.fix_corpus.forEach((fx, i) => {
    if (!fx || typeof fx !== "object") { errs.push(`fix_corpus[${i}]: not an object`); return; }
    if (typeof fx.ref !== "string" || fx.ref === "") errs.push(`fix_corpus[${i}]: missing/invalid string ref`);
    if (typeof fx.merged !== "boolean") errs.push(`fix_corpus[${i}]: missing/invalid boolean merged`);
  });
  return errs;
}

// --- The pure correlation core (FAFF-569 spec §4) — exercised directly by ---
// --- --selftest. Evidence kinds emitted here are the two DETERMINISTIC ones ---
// --- only; `symptom-similarity` is appended later by tidy (weak-only) and ---
// --- never computed here. ---------------------------------------------------
//
// Self-reference guard (applied FIRST, pinned by the spec's FAFF-552 scenario):
// a fix shipped under the finding-ticket's OWN number is the ticket being
// worked normally, not "resolved elsewhere" — such a FixRecord is excluded
// wholesale before either correlation runs. Consequence: the spec pseudocode's
// `fx.source_ticket == ft.id` arm of the tracker-relation branch is
// unreachable post-guard (the guard supersedes it by design); the relation
// match is therefore cited_ticket_ids only.
function correlate(findingTickets, fixCorpus) {
  const candidates = [];
  for (const ft of findingTickets) {
    if (isTerminalStatus(ft.status)) continue; // terminal finding: never a candidate
    // anchor: honour a supplied anchor object / explicit null; derive from
    // symptom_text via the grammar only when the field is absent — so the
    // caller may pre-extract or delegate, and both paths meet the same grammar.
    const anchor = ft.anchor !== undefined ? ft.anchor : extractAnchor(ft.symptom_text || "");
    const anchorEvidence = [];
    const relationEvidence = [];
    for (const fx of fixCorpus) {
      if (fx.source_ticket === ft.id || fx.ref === ft.id) continue; // self-reference guard
      const fxAnchors = Array.isArray(fx.anchors) ? fx.anchors : [];
      const fxCited = Array.isArray(fx.cited_ticket_ids) ? fx.cited_ticket_ids : [];
      const fxText = typeof fx.text === "string" ? fx.text : "";
      // (a) anchor co-reference — shared log path; tighten on finding-id when
      // both sides carry one (log-path-only still counts).
      if (anchor && anchor.log_path && fxAnchors.includes(anchor.log_path)) {
        const idMatch =
          anchor.finding_id == null ||
          fxAnchors.includes(anchor.finding_id) ||
          new RegExp(`\\b${anchor.finding_id}\\b`, "i").test(fxText);
        if (idMatch) {
          anchorEvidence.push({
            kind: "anchor-coref", fix_ref: fx.ref,
            detail: anchor.finding_id ? `${anchor.log_path} (${anchor.finding_id})` : anchor.log_path,
            merged: fx.merged,
          });
        }
      }
      // (b) tracker/citation relation — the fix names the finding-ticket's id.
      if (fxCited.includes(ft.id)) {
        relationEvidence.push({ kind: "tracker-relation", fix_ref: fx.ref, detail: `cites ${ft.id}`, merged: fx.merged });
      }
    }
    const evidence = [...anchorEvidence, ...relationEvidence]; // deterministic-first ordering within the CLI's own kinds
    if (evidence.length === 0) continue;
    const strength = evidence.some((e) => e.merged === true) ? "strong" : "weak";
    candidates.push({ finding: ft.id, evidence, strength });
  }
  return candidates;
}

// --- CLI shell: stdin JSON in, candidates JSON out --------------------------
function readStdin() {
  const fs = require("node:fs");
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function cmdFindingsReconcile(args) {
  if (args.includes("--selftest")) return findingsReconcileSelftest();
  const raw = readStdin();
  let input;
  try { input = JSON.parse(raw); } catch (e) {
    process.stderr.write(`faff findings-reconcile: stdin is not valid JSON: ${e.message}\n`);
    return 2;
  }
  const errs = validateInput(input);
  if (errs.length) {
    process.stderr.write(`faff findings-reconcile: malformed input:\n${errs.map((x) => `  - ${x}`).join("\n")}\n`);
    return 2;
  }
  const candidates = correlate(input.finding_tickets, input.fix_corpus);
  console.log(JSON.stringify({ candidates }));
  return 0; // report-only (parity with next/queue-state): the verdict is in the payload
}

// --- Selftest: the pure fixture table (no FS/tracker) -----------------------
function findingsReconcileSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };
  const LOG = ".faff/logs/2026-07-18/225751-beep-boop-findings.md";

  // --- anchor grammar ---
  ok("anchor: extracts log path + finding id (case-insensitive)",
    (() => { const a = extractAnchor(`Full writeup: ${LOG} (Finding F3) in the SUT repo.`); return a && a.log_path === LOG && a.finding_id === "F3"; })());
  ok("anchor: log path with no finding id -> finding_id null",
    (() => { const a = extractAnchor(`see ${LOG} for details`); return a && a.log_path === LOG && a.finding_id === null; })());
  ok("anchor: no findings-log path -> null (not anchor-identifiable)",
    extractAnchor("an ordinary bug description with no log citation") === null);
  ok("anchor: backtick-quoted path is captured without the backticks",
    (() => { const a = extractAnchor(`writeup: \`${LOG}\` (finding F1)`); return a && a.log_path === LOG; })());

  // --- the known-incident smoke (spec scenario 1): FAFF-551 vs the 3-way split ---
  const ft551 = { id: "FAFF-551", status: "Todo", symptom_text: `git-only orchestrator gap. Full writeup: ${LOG} (finding F2).` };
  const split = [
    { ref: "FAFF-556", merged: true, source_ticket: "FAFF-556", anchors: [], cited_ticket_ids: ["FAFF-551"], text: "Split of FAFF-551 (slice 1 of 3)" },
    { ref: "FAFF-557", merged: true, source_ticket: "FAFF-557", anchors: [], cited_ticket_ids: ["FAFF-551"], text: "Split of FAFF-551 (slice 2 of 3)" },
    { ref: "FAFF-559", merged: true, source_ticket: "FAFF-559", anchors: [], cited_ticket_ids: ["FAFF-551"], text: "Split of FAFF-551 (slice 3 of 3)" },
  ];
  ok("known incident: one strong candidate carrying all three merged fixes",
    (() => { const c = correlate([ft551], split); return c.length === 1 && c[0].finding === "FAFF-551" && c[0].strength === "strong" && c[0].evidence.length === 3 && c[0].evidence.every((e) => e.kind === "tracker-relation" && e.merged); })());

  // --- anchor co-reference (log-path + finding-id tighten) ---
  const fxAnchor = { ref: "FAFF-900", merged: true, source_ticket: "FAFF-900", anchors: [LOG], cited_ticket_ids: [], text: "resolves finding F2 from the run log" };
  ok("anchor-coref: shared log path + matching finding id in fix text -> strong",
    (() => { const c = correlate([ft551], [fxAnchor]); return c.length === 1 && c[0].evidence[0].kind === "anchor-coref" && c[0].strength === "strong"; })());
  ok("anchor-coref: shared log path but a DIFFERENT finding id in play -> no match when ids conflict",
    (() => { const fx = { ...fxAnchor, text: "resolves finding F9 only" }; const c = correlate([ft551], [fx]); return c.length === 0; })());
  ok("anchor-coref: finding with log path but NO id matches on path alone",
    (() => { const ft = { id: "FAFF-800", status: "Backlog", symptom_text: `see ${LOG}` }; const c = correlate([ft], [{ ...fxAnchor, text: "" }]); return c.length === 1 && c[0].evidence[0].kind === "anchor-coref"; })());

  // --- self-reference guard (spec scenario 2) ---
  ok("self-reference: a fix under the finding's own number is never evidence",
    (() => { const ft = { id: "FAFF-552", status: "Todo", symptom_text: `writeup ${LOG} (finding F3)` };
      const own = { ref: "PR#440", merged: true, source_ticket: "FAFF-552", anchors: [LOG], cited_ticket_ids: ["FAFF-552"], text: "fix(FAFF-552) finding F3" };
      return correlate([ft], [own]).length === 0; })());
  ok("self-reference: fx.ref equal to the finding id is likewise excluded",
    (() => { const ft = { id: "FAFF-552", status: "Todo", symptom_text: "no anchor" };
      const own = { ref: "FAFF-552", merged: true, source_ticket: null, anchors: [], cited_ticket_ids: ["FAFF-552"], text: "" };
      return correlate([ft], [own]).length === 0; })());

  // --- unmerged-fix downgrade ---
  ok("unmerged fix citing the finding -> surfaced but weak, never strong",
    (() => { const c = correlate([ft551], [{ ...split[0], merged: false }]); return c.length === 1 && c[0].strength === "weak"; })());
  ok("one merged among unmerged evidence -> strong (any merged deterministic evidence suffices)",
    (() => { const c = correlate([ft551], [{ ...split[0], merged: false }, split[1]]); return c.length === 1 && c[0].strength === "strong"; })());

  // --- terminal filter ---
  ok("terminal finding (Done) is never a candidate",
    (() => { const ft = { ...ft551, status: "Done" }; return correlate([ft], split).length === 0; })());
  ok("terminal filter is name-based + case-insensitive (Cancelled, Duplicate)",
    correlate([{ ...ft551, status: "cancelled" }, { ...ft551, id: "FAFF-802", status: "Duplicate" }], split).length === 0);
  ok("unrecognised status stays non-terminal (fail toward surfacing)",
    (() => { const ft = { ...ft551, status: "Weird Custom State" }; return correlate([ft], split).length === 1; })());

  // --- supplied-anchor precedence + explicit null ---
  ok("a supplied anchor object is honoured over grammar extraction",
    (() => { const ft = { id: "FAFF-803", status: "Todo", anchor: { log_path: LOG, finding_id: null }, symptom_text: "no path here" };
      const c = correlate([ft], [{ ...fxAnchor, cited_ticket_ids: [] }]); return c.length === 1; })());
  ok("anchor explicitly null -> symptom-only ticket, no anchor correlation",
    (() => { const ft = { id: "FAFF-804", status: "Todo", anchor: null, symptom_text: `see ${LOG}` };
      const c = correlate([ft], [{ ...fxAnchor, cited_ticket_ids: [] }]); return c.length === 0; })());

  // --- evidence ordering + multi-fix collapse ---
  ok("evidence orders anchor-coref before tracker-relation",
    (() => { const ft = { id: "FAFF-805", status: "Todo", symptom_text: `see ${LOG} (finding F2)` };
      const both = { ref: "FAFF-901", merged: true, source_ticket: "FAFF-901", anchors: [LOG], cited_ticket_ids: ["FAFF-805"], text: "finding F2" };
      const c = correlate([ft], [both]); return c.length === 1 && c[0].evidence[0].kind === "anchor-coref" && c[0].evidence[1].kind === "tracker-relation"; })());
  ok("multiple fixes collapse into ONE candidate per finding",
    (() => { const c = correlate([ft551], split); return c.length === 1; })());

  // --- input validation (exit-2 class) ---
  ok("validate: non-object input rejected", validateInput([1, 2]).length > 0);
  ok("validate: missing arrays rejected", validateInput({}).length === 2);
  ok("validate: ft without id / fx without ref+merged rejected",
    validateInput({ finding_tickets: [{}], fix_corpus: [{ ref: "", merged: "yes" }] }).length >= 3);
  ok("validate: minimal well-formed input passes",
    validateInput({ finding_tickets: [{ id: "A-1", status: "Todo" }], fix_corpus: [{ ref: "A-2", merged: true }] }).length === 0);

  // --- purity: no tracker/network access anywhere in this module ---
  const fs = require("node:fs");
  const src = fs.readFileSync(__filename, "utf8");
  ok("purity: module never requires an http/https/net module", !/require\(["'](?:http|https|net)["']\)/.test(src));

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  cmdFindingsReconcile,
  correlate,
  extractAnchor,
  findingsReconcileSelftest,
  isTerminalStatus,
  validateInput,
};
