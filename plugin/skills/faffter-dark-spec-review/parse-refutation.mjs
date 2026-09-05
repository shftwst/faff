#!/usr/bin/env node
// FAFF-938 — deterministic parser for the spec-review refuter objection triple.
//
// Each spec-review lens's refuter runs as an independent `review-call.mjs` pass and returns
// markdown prose: a `### [severity]` block per objection, carrying `- claim:` / `- evidence:` /
// `- predicted_consequence:` / `- spec_anchor:` bullets (FAFF-935/FAFF-943). Nothing previously
// converted that prose into the `objections[]` JSON `aggregate.mjs` rolls up — the occupant's own
// prose told an LLM to hand-build the JSON, and a lens that omitted or malformed a triple field on
// a GATING objection was silently dropped at three downstream points. This module closes that seam:
// a deterministic, zero-dependency parser that extracts the triple and fails loud (non-zero exit,
// never a silent drop) when a gating objection is missing a required field.
//
// Input model — the TRANSPORT's post-normalisation exit-0 stdout, never the raw `refute-*.md`
// prompt output: by the time `review-call.mjs` exits 0, it has already (a) normalised every clean
// refutation to the single canonical token `### observation: no findings` (`normaliseCleanRefutation`
// -> `CANONICAL_NO_FINDINGS`), and (b) downgraded any mechanically-disproved gating section to a
// non-gating `[auto-refuted]` observation (`refuteFindings`). Both the grammar below and this
// module's test fixtures are pinned to those post-normalisation wire bytes.
//
// Self-contained by design (see the spec's Design Decision Rationale): this module owns its own
// small section/bullet grammar rather than importing `review-call.mjs`'s `splitFindings` — no
// cross-skill runtime import, no transport touch. A fixture test pinned to the transport's actual
// exit-0 stdout is what keeps the two grammars honest if they ever drift.
//
// Pure functions carry no I/O and are unit-tested directly; the CLI is a thin stdin->stdout wrapper,
// the same shape as the sibling `aggregate.mjs`.

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The transport's canonical clean-refutation token (review-call.mjs's CANONICAL_NO_FINDINGS,
// duplicated here rather than imported — self-contained by design). A clean refutation crosses the
// exit-0 wire as exactly this single non-gating observation section; there is no
// "No <lens> objection." form on the wire, only pre-normalisation.
export const CANONICAL_NO_FINDINGS = "### observation: no findings";

// Section boundary: a `### ` heading (excludes `####`+ — an h4+ inside a finding body is not a new
// finding boundary). Mirrors review-call.mjs's HEADING_LINE_RE.
const HEADING_LINE_RE = /^###\s(?!#)/;
// Severity classification from the heading line. Mirrors review-call.mjs's SEVERITY_HEADING_RE so
// the two grammars agree on what counts as a recognised severity word.
const SEVERITY_HEADING_RE = /^###\s*\[?(critical|major|minor|observation)\]?\s*[:—-]\s*(.*)$/i;
const GATING_SEVERITIES = new Set(["critical", "major", "minor"]);

// A triple/anchor bullet: "- <key>: <value>". Case-insensitive key, same closed vocabulary the
// refuter prompts emit.
const BULLET_RE = /^-\s*(claim|evidence|predicted_consequence|spec_anchor)\s*:\s*(.*)$/i;
// A heading line of any level — stops a bullet-value continuation from swallowing past a section
// boundary. Bodies are already sliced to one section, so this is a defensive guard only.
const ANY_HEADING_RE = /^#{2,}\s(?!#)/;

// PURE: split content on `### ` heading lines into an ordered list of sections. Each section spans
// from its heading to (exclusive) the next `### ` heading or EOF.
function splitSections(content) {
  const lines = String(content == null ? "" : content).split("\n");
  const idxs = [];
  for (let i = 0; i < lines.length; i++) if (HEADING_LINE_RE.test(lines[i])) idxs.push(i);
  const sections = [];
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i];
    const end = i + 1 < idxs.length ? idxs[i + 1] : lines.length;
    const heading = lines[start];
    const body = lines.slice(start + 1, end).join("\n");
    const m = heading.match(SEVERITY_HEADING_RE);
    const severity = m ? m[1].toLowerCase() : null;
    const title = m ? m[2].trim() : heading.replace(/^###\s*/, "").trim();
    sections.push({ heading: heading.trim(), severity, title, body });
  }
  return sections;
}

// PURE: extract the triple/anchor bullets from a section body. A value runs from after the bullet's
// colon up to (but not including) the next recognised bullet or any heading line, then trimmed — so
// a naturally wrapped multi-line value is captured deterministically without a greedy match. A
// non-bullet, non-heading line encountered before any bullet has been seen is discarded (narrative
// lead-in, not a field). A repeated key: last one wins.
function parseBullets(body) {
  const lines = String(body == null ? "" : body).split("\n");
  const fields = {};
  let key = null;
  let buf = [];
  const flush = () => {
    if (key) fields[key] = buf.join("\n").trim();
    key = null;
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(BULLET_RE);
    if (m) {
      flush();
      key = m[1].toLowerCase();
      buf = [m[2]];
      continue;
    }
    if (ANY_HEADING_RE.test(line)) {
      flush();
      continue;
    }
    if (key) buf.push(line);
  }
  flush();
  return fields;
}

// PURE: the harness-authored header line is `## Adversarial findings — <provider>/<model> (chain[<i>],
// host: <source>)`, unconditionally prepended by the transport (ensureHeader). Read `provider/model`
// verbatim from it — scanning the PREAMBLE only (before the first `### ` finding heading), mirroring
// review-call.mjs's own preamble-scoped header search (findHeaderLineIdx) so a finding body that
// happens to quote a header-shaped line is never mistaken for the document's own provenance line.
const HEADER_RE = /^##\s*Adversarial findings\s*(?:—|-{1,2})\s*(\S+)/i;
function headerModel(content) {
  const lines = String(content == null ? "" : content).split("\n");
  for (const line of lines) {
    if (HEADING_LINE_RE.test(line)) break; // preamble ends at the first finding heading
    const m = line.match(HEADER_RE);
    if (m) return m[1];
  }
  return undefined;
}

// PURE: parseRefutation(content, lens) -> { ok: true, entry: RefutationEntry }
//                                        | { ok: false, fault: ParseFault }
//
// RefutationEntry: { lens, outcome: "refuted"|"clear", objections: [Objection], model?: string }
// Objection:       { severity, claim, evidence, predicted_consequence, spec_anchor? }  (gating)
//                   { severity, claim?, evidence?, predicted_consequence?, spec_anchor? }  (observation)
// ParseFault:       { lens, severity, title, missing_field: "claim"|null, reason? }  (FAFF-990: only `claim` gates)
export function parseRefutation(content, lens) {
  const text = String(content == null ? "" : content);
  const sections = splitSections(text);
  const model = headerModel(text);

  // Defensive fail-loud: the transport's shape-gate (validateFindingsShape) guarantees >=1 section
  // with a recognised severity before exit 0, so this should be unreachable — but a parser that
  // silently treated "no sections at all" as a clean pass would reintroduce exactly the silent-drop
  // failure mode this ticket removes.
  if (sections.length === 0) {
    return {
      ok: false,
      fault: { lens, severity: "unknown", title: "(none)", missing_field: null, reason: "no ### finding section found in input" },
    };
  }

  // Clean refutation: the transport's canonical single-observation token, and nothing else. On the
  // exit-0 wire a clean lens is EXACTLY this one section — no gating section coexists with it.
  const gatingCount = sections.filter((s) => GATING_SEVERITIES.has(s.severity)).length;
  if (gatingCount === 0 && sections.length === 1 && sections[0].heading === CANONICAL_NO_FINDINGS) {
    const entry = { lens, outcome: "clear", objections: [] };
    if (model) entry.model = model;
    return { ok: true, entry };
  }

  const objections = [];
  for (const s of sections) {
    if (s.severity == null) {
      // Should be unreachable (see the shape-gate note above) — fail loud rather than guess.
      return {
        ok: false,
        fault: { lens, severity: "unknown", title: s.title, missing_field: null, reason: `section heading names no known severity: ${JSON.stringify(s.heading)}` },
      };
    }
    const fields = parseBullets(s.body);
    const gating = GATING_SEVERITIES.has(s.severity);
    if (gating) {
      // FAFF-990: `claim` is the ONLY identifying field a gating objection must carry. `evidence`
      // and `predicted_consequence` are enrichment — carried when present+non-empty (below), omitted
      // otherwise, NEVER a fault. A backend that truncated mid-objection (spending its token budget
      // before finishing the triple) still served a usable claim; voiding the whole lens over a
      // clipped enrichment field mis-attributed a per-response model transient to config-fault/park.
      // A gating section with no non-empty `claim` is the one residual fault (missing_field:"claim").
      const claim = fields.claim;
      if (typeof claim !== "string" || claim.trim() === "") {
        return { ok: false, fault: { lens, severity: s.severity, title: s.title, missing_field: "claim" } };
      }
    }
    // Carry whatever triple/anchor fields are present as non-empty strings — `claim` is required (and
    // therefore guaranteed present) on a gating section; `evidence`/`predicted_consequence` are
    // enrichment, omitted when absent (never sentinel-filled), best-effort/unchecked on an observation.
    const obj = { severity: s.severity };
    for (const field of ["claim", "evidence", "predicted_consequence"]) {
      if (typeof fields[field] === "string" && fields[field].trim() !== "") obj[field] = fields[field].trim();
    }
    if (typeof fields.spec_anchor === "string" && fields.spec_anchor.trim() !== "") obj.spec_anchor = fields.spec_anchor.trim();
    objections.push(obj);
  }

  const outcome = objections.some((o) => GATING_SEVERITIES.has(o.severity)) ? "refuted" : "clear";
  const entry = { lens, outcome, objections };
  if (model) entry.model = model;
  return { ok: true, entry };
}

// ---- CLI ------------------------------------------------------------------------------------
// `parse-refutation.mjs --lens <lens> [--truncated]` reads one refuter's raw exit-0 stdout on stdin.
//   exit 0      -> the RefutationEntry JSON on stdout (objections may be degraded — claim-only).
//   exit 1      -> a RESIDUAL parse fault (a gating section with no usable `claim`) WITHOUT --truncated:
//                  `{lens, outcome:"unavailable", kind:"config-fault", objections:[]}` on stdout, a human
//                  diagnostic on stderr. The transport floor routes config-fault -> needs-human (park).
//   exit 3      -> the same residual fault WITH --truncated (the served response carried a truncation
//                  signal): `{lens, outcome:"unavailable", kind:"infra-configured", objections:[]}` on
//                  stdout. `infra-configured` is swing-capable -> the `unavailable` verdict + a
//                  resumable `faff-awaiting-spec-review` hold (FAFF-900), never a park.
//   exit 2      -> usage (missing --lens, unreadable stdin) — a real fault, empty stdout.
// FAFF-990: the config-fault-vs-availability decision is deterministic, so the parser NAMES the `kind`
// on stdout (chosen from --truncated) and the occupant records that stdout verbatim — the exit code and
// the stdout `kind` are one decision surfaced twice, both code-emitted and both fixture-testable. The
// occupant performs no exit-to-kind judgement of its own.
function faultMessage(f, truncated) {
  const parts = [`lens=${f.lens}`, `severity=${f.severity}`, `title=${JSON.stringify(f.title)}`];
  if (f.missing_field) parts.push(`missing_field=${f.missing_field}`);
  if (f.reason) parts.push(`reason=${f.reason}`);
  parts.push(`truncated=${!!truncated}`);
  return `parse-refutation: parse fault — ${parts.join(" ")}`;
}

function main(argv) {
  const args = argv.slice(2);
  const li = args.indexOf("--lens");
  const lens = li !== -1 ? args[li + 1] : undefined;
  const truncated = args.includes("--truncated");   // FAFF-990: a transport property, applied at the CLI seam
  if (!lens) {
    process.stderr.write("parse-refutation: --lens <lens> is required\n");
    return 2;
  }
  let content;
  try {
    content = readFileSync(0, "utf8");
  } catch (e) {
    process.stderr.write(`parse-refutation: cannot read stdin — ${e.message}\n`);
    return 2;
  }
  const result = parseRefutation(content, lens);
  if (!result.ok) {
    // Residual fault: emit the machine record on STDOUT (the occupant records it verbatim) and the
    // human diagnostic on STDERR (the audit trail). `kind`/exit are the same decision, keyed on --truncated.
    const kind = truncated ? "infra-configured" : "config-fault";
    process.stdout.write(JSON.stringify({ lens, outcome: "unavailable", kind, objections: [] }) + "\n");
    process.stderr.write(faultMessage(result.fault, truncated) + "\n");
    return truncated ? 3 : 1;
  }
  process.stdout.write(JSON.stringify(result.entry) + "\n");
  return 0;
}

// Run as CLI only when invoked directly (not when imported by the test). Canonicalise argv[1]
// through realpathSync before comparing so a symlinked install path (FAFF-813) still matches —
// mirrors aggregate.mjs's entrypoint_href exactly.
export function entrypoint_href(argv1) {
  if (!argv1) return null;
  try {
    return pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return pathToFileURL(argv1).href;
  }
}

if (import.meta.url === entrypoint_href(process.argv[1])) {
  process.exit(main(process.argv));
}
