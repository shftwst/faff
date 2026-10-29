// === region:factory — judge-dispositions — FAFF-1406: build spec-review evidence dispositions from the judge's own files ===
// `faff spec-review collate-evidence --from-judge` turns the spec-review judge's `ledger.json` and
// `ruling-<pid>.json` files into the dispositions `applyDispositions` accepts, so prep never types a
// disposition value on the judge path. Proposition p-(i+1) is the i-th objection (zero-based) of the
// latest round at or after the ledger's `window_start`, read with the same `readStandingResidue`
// `spec-judge-evidence --assemble` uses, so its collated key is `<n>#<i>`. `fixed` requires the same
// `correctionApplied` test the admit roll-up uses. Every key the judge did not settle is `open`.
// ===========================================================================
const fs = require("fs");
const path = require("path");
const { readStandingResidue } = require("./spec-judge-evidence");
const { correctionApplied } = require("./spec-judge-casefile");
const { SPEC_JUDGE_OUTCOMES } = require("./contract-defs-review");

// One objection in the collated record (`collateSpecReviewRounds(dir).record`).
type CollatedObjection = { key: string; lens: unknown; severity?: unknown; [k: string]: unknown };
type CollatedRecord = { objections: CollatedObjection[] };
// The latest in-window round, as `readStandingResidue` returns it.
type Residue = { unreadable?: unknown; malformed?: unknown; path?: unknown; why?: unknown; n?: unknown; objections: unknown[] };
type Settled = { disposition: string; rationale?: unknown };
type Disposition = { key: string; lens: unknown; disposition: string; disposition_rationale?: unknown };

// A failure with the exit code the CLI returns: 1 for a disagreement, 2 for an unreadable input.
class JudgeDispositionError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim() !== "";

// `v[k]` for a value of unknown shape, with JavaScript's own semantics: a primitive reads through its
// wrapper, and null or undefined throws the TypeError the plain property read would.
function prop(v: unknown, k: string): unknown {
  if (v === null || v === undefined) throw new TypeError(`Cannot read properties of ${v} (reading '${k}')`);
  return Reflect.get(Object(v), k);
}

// The disposition and rationale for one ruled proposition, per the FAFF-1406 table.
function rulingDisposition(entry: unknown, ruling: unknown, specText: string): Settled {
  const outcome = prop(ruling, "outcome");
  if (outcome === "AFFIRM_SPEC") return { disposition: "refuted", rationale: prop(ruling, "rationale") };
  if (outcome === "UPHOLD_REVIEW" || outcome === "SYNTHESIZE") {
    if (correctionApplied(entry, ruling, specText).applied) {
      const correction = prop(ruling, "correction");
      return { disposition: "fixed", rationale: correction && prop(correction, "summary") };
    }
    return { disposition: "open", rationale: prop(ruling, "rationale") };
  }
  return { disposition: "open", rationale: prop(ruling, "rationale") }; // PRD_BOUNDARY
}

// buildJudgeDispositions({ record, ledger, residue, specText, readRuling }) -> the dispositions array.
//   record   : collateSpecReviewRounds(dir).record
//   ledger   : the parsed ledger.json
//   residue  : readStandingResidue(dir, ledger.window_start)
//   readRuling(pid) -> the parsed ruling, or throws JudgeDispositionError(2) when missing or malformed
// Throws JudgeDispositionError. Pure apart from readRuling.
function buildJudgeDispositions({ record, ledger, residue, specText, readRuling }: {
  record: CollatedRecord; ledger: unknown; residue: Residue | null | undefined; specText: string; readRuling: (pid: unknown) => unknown;
}): Disposition[] {
  const order = ledger && typeof ledger === "object" ? prop(ledger, "order") : undefined;
  const entries = ledger && typeof ledger === "object" ? prop(ledger, "entries") : undefined;
  if (!ledger || typeof ledger !== "object" || !Array.isArray(order) || !entries || typeof entries !== "object") {
    throw new JudgeDispositionError(2, "ledger.json has no order[] or entries{}");
  }
  if (!residue || residue.unreadable) throw new JudgeDispositionError(2, "the spec-review round files could not be read");
  if (residue.malformed) throw new JudgeDispositionError(2, `${residue.path} is malformed (${residue.why})`);
  if (residue.objections.length !== order.length) {
    throw new JudgeDispositionError(1, `ledger and round ${residue.n == null ? "(none in window)" : residue.n} disagree: ${order.length} propositions, ${residue.objections.length} objections`);
  }
  const byKey = new Map(record.objections.map((o) => [o.key, o]));
  const settled = new Map<string, Settled>();
  order.forEach((pid: unknown, i: number) => {
    const entry: unknown = Reflect.get(entries, String(pid)); // the key `entries[pid]` would coerce to
    const key = `${residue.n}#${i}`;
    const item = byKey.get(key);
    if (!entry) throw new JudgeDispositionError(1, `ledger lists ${pid} but has no entry for it`);
    if (!item) throw new JudgeDispositionError(1, `no collated objection ${key} for ${pid}`);
    if (item.lens !== prop(entry, "lens") || item.severity !== prop(entry, "severity")) throw new JudgeDispositionError(1, `${pid} and objection ${key} disagree on lens or severity`);
    if (prop(entry, "resolution") === "parked") { settled.set(key, { disposition: "open" }); return; }
    const ruling = readRuling(pid);
    if (!ruling || typeof ruling !== "object" || !SPEC_JUDGE_OUTCOMES.includes(prop(ruling, "outcome"))) {
      throw new JudgeDispositionError(1, `ruling-${pid}.json outcome is not one of ${SPEC_JUDGE_OUTCOMES.join(", ")}`);
    }
    settled.set(key, rulingDisposition(entry, ruling, specText));
  });
  return record.objections.map((o) => {
    const s = settled.get(o.key) || { disposition: "open" };
    const out: Disposition = { key: o.key, lens: o.lens, disposition: s.disposition };
    if (nonEmpty(s.rationale)) out.disposition_rationale = s.rationale;
    return out;
  });
}

// The impure shell: read the ledger, the residue, the spec and the rulings from disk.
function judgeDispositionsFromDisk({ dir, judgeDir, specPath, record }: { dir: string; judgeDir: string; specPath: string; record: CollatedRecord }): Disposition[] {
  let ledger: unknown;
  try { ledger = JSON.parse(fs.readFileSync(path.join(judgeDir, "ledger.json"), "utf8")); }
  catch { throw new JudgeDispositionError(2, `cannot read ${path.join(judgeDir, "ledger.json")}`); }
  const windowStart = ledger && prop(ledger, "window_start");
  if (typeof windowStart !== "number" || !Number.isInteger(windowStart) || windowStart < 1) throw new JudgeDispositionError(2, "ledger.json has no integer window_start");
  let specText: string;
  try { specText = fs.readFileSync(specPath, "utf8"); } catch { throw new JudgeDispositionError(2, `cannot read --spec ${specPath}`); }
  const readRuling = (pid: unknown): unknown => {
    try { return JSON.parse(fs.readFileSync(path.join(judgeDir, `ruling-${pid}.json`), "utf8")); }
    catch { throw new JudgeDispositionError(2, `ruling-${pid}.json is missing or malformed`); }
  };
  return buildJudgeDispositions({ record, ledger, residue: readStandingResidue(dir, windowStart), specText, readRuling });
}

module.exports = { JudgeDispositionError, rulingDisposition, buildJudgeDispositions, judgeDispositionsFromDisk };
