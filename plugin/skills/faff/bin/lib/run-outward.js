// ===========================================================================
// === region:factory — run-outward — FAFF-521: the signals.outward producer feeding ===
// `faff run-start`'s rung-2 outward floor (ADR-0069: faff is L3-on-itself; autonomous
// planning is aimed OUTWARD at greenfield/adopter containers only, never at faff's
// own tracking container). This CLI answers exactly one question — "does this run's
// resolved TARGET positively resolve to a non-self container?" — and emits the
// boolean as a report-only payload. It does NOT decide refuse/proceed: that decision
// stays single-homed in `faff run-start` (FAFF-496, ladder rung 2), so a caller feeds
// this CLI's `.outward` straight into `faff run-start --signals '{"outward": ...}'`
// rather than branching locally (the double-gate anti-pattern the spec confirms out).
//
// PURE — no tracker/network/disk beyond args, parity with `faff contain` / `faff
// run-start`. The caller resolves the live TargetRef (explicit > inherited >
// methodology-default, FAFF-40) and the live SelfRef (the repo-slug oracle:
// self.repo := tracking.repo, self.is_self := target.repo == tracking.repo) and
// passes both in; this CLI only decides.
//
// Fail-safe ladder (spec §4, first-matching-check-wins, biased toward self-directed):
//   1. self.is_self === true                              -> outward:false / self-marked
//   2. target.container AND target.repo both null          -> outward:false / unresolved-target
//   3. target.container != null AND == self.container      -> outward:false / self-container
//   4. target.repo != null AND self.repo != null AND equal  -> outward:false / self-referential
//   5. otherwise                                            -> outward:true  / outward-adopter
// Null-safety is structural, not a bolt-on: rung 3 requires target.container != null
// before comparing, so two absent containers never read as a match; an all-null
// SelfRef with a resolved non-self target correctly falls through to outward:true.
// ===========================================================================

const OUTWARD_REASONS = ["outward-adopter", "self-container", "self-marked", "unresolved-target", "self-referential"];

// Coerce a raw TargetRef onto the closed shape. Anything not a plain object
// degrades to all-null/unresolved (fail-safe — an unresolvable target refuses).
function normalizeTargetRef(raw) {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  return {
    container: typeof r.container === "string" ? r.container : null,
    repo: typeof r.repo === "string" ? r.repo : null,
    source: typeof r.source === "string" ? r.source : "unresolved",
  };
}

// Coerce a raw SelfRef onto the closed shape. is_self is STRICT-boolean (=== true);
// anything else (missing, null, string, truthy-non-bool) coerces to false — an
// unmarked/malformed SelfRef never accidentally reads as self-directed via rung 1.
function normalizeSelfRef(raw) {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  return {
    container: typeof r.container === "string" ? r.container : null,
    repo: typeof r.repo === "string" ? r.repo : null,
    is_self: r.is_self === true,
  };
}

// PURE decision core (spec §4) — the whole born-verifiable heart. Never throws;
// malformed JSON is rejected at the CLI boundary (exit 2), not here. Re-implements
// no run-start reason: returns only OutwardReason tokens, never a run-trigger
// {verdict, reason} pair — that derivation stays single-homed in run-start.js.
function decideOutward(targetRaw, selfRaw) {
  const target = normalizeTargetRef(targetRaw);
  const self = normalizeSelfRef(selfRaw);

  if (self.is_self === true) {
    return { target, outward: false, reason: "self-marked" };
  }
  if (target.container === null && target.repo === null) {
    return { target, outward: false, reason: "unresolved-target" };
  }
  if (target.container !== null && target.container === self.container) {
    return { target, outward: false, reason: "self-container" };
  }
  if (target.repo !== null && self.repo !== null && target.repo === self.repo) {
    return { target, outward: false, reason: "self-referential" };
  }
  return { target, outward: true, reason: "outward-adopter" };
}

const { parseArgs, usageError } = require("./argv");
const RUN_OUTWARD_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--target": { arity: 1 }, "--self": { arity: 1 } } };

function cmdRunOutward(args) {
  if (args.includes("--selftest")) return runOutwardSelftest();
  const usage = "faff run-outward: usage: faff run-outward --target <json> [--self <json>] [--json]";
  const { values, errors } = parseArgs(args, RUN_OUTWARD_SPEC);
  if (errors.length) return usageError(errors, usage);
  const getFlag = (f) => (values[f] === undefined ? null : values[f]);
  const asJson = !!values["--json"];

  const targetRaw = getFlag("--target");
  if (targetRaw == null) { process.stderr.write(`${usage}\n`); return 2; }
  let target;
  try {
    target = JSON.parse(targetRaw);
    if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error("not an object");
  } catch (e) {
    process.stderr.write(`faff run-outward: --target is not a valid JSON object: ${e.message}\n`);
    return 2;
  }

  let self = {};
  const selfRaw = getFlag("--self");
  if (selfRaw != null) {
    try {
      self = JSON.parse(selfRaw);
      if (!self || typeof self !== "object" || Array.isArray(self)) throw new Error("not an object");
    } catch (e) {
      process.stderr.write(`faff run-outward: --self is not a valid JSON object: ${e.message}\n`);
      return 2;
    }
  }

  const signal = decideOutward(target, self);
  if (asJson) {
    process.stdout.write(JSON.stringify(signal) + "\n");
  } else {
    process.stdout.write(`outward: ${signal.outward} (${signal.reason})\n`);
  }
  return 0; // report-only (parity with run-start/run-done): the boolean is in the payload
}

// Selftest — one row per OutwardReason plus the two explicit null-safety rows the
// spec calls out, plus an ordering-precedence check (rung 1 pre-empts everything).
// Mirrors the run-start/contain selftest shape: per-case ok/FAIL + a RESULT line.
function runOutwardSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };
  const hit = (target, self, outward, reason) => {
    const r = decideOutward(target, self);
    return r.outward === outward && r.reason === reason;
  };

  // --- one row per OutwardReason ---
  ok("outward-adopter: target positively resolves to a non-self container",
    hit({ container: "ADOPT-1", repo: "acme/app", source: "explicit" }, { container: null, repo: "shftwst/faff", is_self: false }, true, "outward-adopter"));
  ok("self-container: target.container == self.container (both non-null)",
    hit({ container: "FAFF", repo: null, source: "inherited" }, { container: "FAFF", repo: "shftwst/faff", is_self: false }, false, "self-container"));
  ok("self-marked: self.is_self asserted true (repo-slug match, caller-computed)",
    hit({ container: "ADOPT-1", repo: "acme/app", source: "explicit" }, { container: null, repo: "shftwst/faff", is_self: true }, false, "self-marked"));
  ok("unresolved-target: target.container and target.repo both null (fail-safe)",
    hit({ container: null, repo: null, source: "unresolved" }, { container: null, repo: "shftwst/faff", is_self: false }, false, "unresolved-target"));
  ok("self-referential: target.repo == self.repo (both non-null)",
    hit({ container: null, repo: "shftwst/faff", source: "methodology-default" }, { container: null, repo: "shftwst/faff", is_self: false }, false, "self-referential"));

  // --- null-safety rows (explicitly called out in the spec) ---
  ok("null-safety: two null containers do NOT match as self-container",
    hit({ container: null, repo: "acme/app", source: "explicit" }, { container: null, repo: "shftwst/faff", is_self: false }, true, "outward-adopter"));
  ok("null-safety: all-null self with a resolved non-self target => outward",
    hit({ container: "ADOPT-1", repo: "acme/app", source: "explicit" }, { container: null, repo: null, is_self: false }, true, "outward-adopter"));

  // --- ordering: rung 1 (self-marked) pre-empts every other rung ---
  ok("ordering: self-marked wins over an otherwise-outward-resolving target",
    hit({ container: "ADOPT-1", repo: "acme/app", source: "explicit" }, { container: "ADOPT-1", repo: "acme/app", is_self: true }, false, "self-marked"));
  ok("ordering: self-marked wins over an unresolved target",
    hit({ container: null, repo: null, source: "unresolved" }, { container: null, repo: null, is_self: true }, false, "self-marked"));
  // self-container (rung 3) pre-empts self-referential (rung 4) when both would fire
  ok("ordering: self-container (rung 3) wins over a coincident self-referential match",
    hit({ container: "FAFF", repo: "shftwst/faff", source: "inherited" }, { container: "FAFF", repo: "shftwst/faff", is_self: false }, false, "self-container"));

  // --- fail-safe: malformed/non-object inputs coerce to all-null, never throw ---
  ok("fail-safe: non-object target coerces to unresolved-target",
    hit("not-an-object", { container: null, repo: "shftwst/faff", is_self: false }, false, "unresolved-target"));
  ok("fail-safe: non-object self coerces to is_self:false, non-null-container comparisons safe",
    hit({ container: "ADOPT-1", repo: "acme/app", source: "explicit" }, "not-an-object", true, "outward-adopter"));
  ok("fail-safe: self.is_self as a truthy non-boolean does NOT read as self-marked",
    hit({ container: "ADOPT-1", repo: "acme/app", source: "explicit" }, { container: null, repo: null, is_self: "yes" }, true, "outward-adopter"));

  // --- shape: every produced reason is in the closed enum ---
  ok("shape: every produced reason is in the closed OutwardReason enum", (() => {
    const cases = [
      [{ container: "ADOPT-1", repo: "acme/app" }, { is_self: false }],
      [{ container: "FAFF", repo: null }, { container: "FAFF", is_self: false }],
      [{}, { is_self: true }],
      [{ container: null, repo: null }, {}],
      [{ container: null, repo: "shftwst/faff" }, { repo: "shftwst/faff" }],
    ];
    return cases.every(([t, s]) => OUTWARD_REASONS.includes(decideOutward(t, s).reason));
  })());

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { OUTWARD_REASONS, cmdRunOutward, decideOutward, normalizeSelfRef, normalizeTargetRef, runOutwardSelftest };
