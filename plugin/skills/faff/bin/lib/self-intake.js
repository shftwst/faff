// ===========================================================================
// === region:factory — self-intake — FAFF-539: the mechanical same-repo/team gate on the FAFF-536 ===
// `outward → outward-self-intake` reclassification (ADR-0079). The filing
// chokepoint may only honour that reclassification when THIS primitive confirms
// the discovered item's home is the mandate's own tracking team/repo — replacing
// the prose-only check the adversarial reviewer's ratified `critical` flagged (a
// confabulating agent could assert `outward → self-intake` and bypass the
// containment hard floor).
//
// THE SELF SIDE IS NEVER CALLER-SUPPLIABLE. There is no `--self` flag (rejected
// with usage exit 2 by name): the primitive re-derives the self side from the
// merged committed config via the CLI's own loader — `containment.
// self_hosting_intake` (the lane dial), `tracking.team_key`, `tracking.repo`.
// Config is committed and PR-reviewed, which is what makes the re-derivation
// independent of the agent being gated. This is the ONE deliberate divergence
// from `contain`/`run-outward` purity (args-only): reading config IS the
// hardening. The TARGET side stays caller-supplied (--target; the CLI has no
// tracker), on the FAFF-354 trust boundary: `--record` binds the exact
// target_raw into a run event so `faff audit` recomputes-and-compares post-hoc
// — detective, never preventive.
//
// FAIL-CLOSED EVERYWHERE: lane off, either side unresolvable, or no match →
// not-self (exit 3) and the mechanical `outward-new-root` verdict stands. The
// cost of a false not-self is a surfaced item a human files by hand; a false
// self would silently expand autonomous filing. Exit shape mirrors `contain`:
// 0 = self (reclassification honoured) · 3 = not-self (outward stands) ·
// 2 = usage / malformed --target / config parse failure / --record run dir
// missing or unsafe run-id. `contain.js` stays byte-untouched and repo-blind —
// this is a sibling primitive consulted AFTER an outward verdict, never a floor
// edit. The pure comparator core (decideSelfIntake) lives in shared-infra.js so
// audit (governance) can recompute it (ADR 0042).
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const {
  SELF_INTAKE_REASONS, decideSelfIntake, dig, findRoot, normalizeSelfIntakeTarget,
} = require("./shared-infra");
const { loadConfig } = require("./config");
const { isSafeRunId } = require("./contain");
const { EVENT_PHASES, appendEventRecord, eventViolations } = require("./events");

const SELF_INTAKE_VALUE_FLAGS = new Set(["--target", "--record", "--phase"]);

// Derive the SelfIntakeSelf record from the merged config — the independence
// property. Reads exactly three leaves: containment.self_hosting_intake (registry
// default "false"), tracking.team_key, tracking.repo. Empty-string / absent /
// non-string → null (an empty scalar must never strict-equal anything). The lane
// dial accepts the YAML boolean true OR the string "true" (parseYamlSubset yields
// a boolean for an unquoted scalar; `faff config get` prints both as "true" — the
// same value the chokepoint's cheap early-exit compares against); anything else
// is off. Throws whatever loadConfig throws (base/overlay parse failure, legacy
// name) — the CLI wrapper converts that to a LOUD exit 2, never a silent
// not-self with a wrong reason.
function deriveSelfFromConfig(root) {
  const [data] = loadConfig(root);
  const lane = dig(data, "containment.self_hosting_intake");
  const team = dig(data, "tracking.team_key");
  const repo = dig(data, "tracking.repo");
  // Return the TRIMMED value, not just trim-for-the-emptiness-check: a quoted,
  // whitespace-padded config scalar (`repo: " acme/app"`) survives the YAML parser
  // with its inner padding, and an untrimmed return would strict-=== mismatch a
  // clean target — a silent lane-off-in-effect a human would read as "repo looks
  // right" (the adversarial-review trim-asymmetry finding).
  const clean = (v) => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };
  return {
    team: clean(team),
    repo: clean(repo),
    lane_on: lane === true || lane === "true",
  };
}

// `faff self-intake <mandate> --target <json> [--record <run-id>] [--phase p] [--json]`
// exit 0 self · 3 not-self (fail-closed) · 2 usage/malformed/config-failure.
function cmdSelfIntake(args) {
  if (args.includes("--selftest")) return selfIntakeSelftest();
  const usage = "faff self-intake: usage: faff self-intake <mandate> --target <json> [--record <run-id>] [--phase run|tidy|prep|build|plot] [--json]";

  let mandate = null;
  const flags = {};
  let danglingValueFlag = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--self") {
      // The anti-pattern this ticket closes: a caller-supplied self would re-open
      // the forgeable seam. Rejected BY NAME, never silently absorbed.
      process.stderr.write("faff self-intake: there is no --self flag — the self side is derived from committed config, never caller input (FAFF-539).\n");
      return 2;
    }
    if (SELF_INTAKE_VALUE_FLAGS.has(a)) {
      const nxt = args[i + 1];
      if (nxt === undefined || nxt.startsWith("--")) { danglingValueFlag = a; continue; }
      flags[a] = nxt; i++;
    } else if (a.startsWith("--")) {
      flags[a] = true;
    } else if (mandate === null) {
      mandate = a;
    }
  }
  const asJson = flags["--json"] === true;

  if (danglingValueFlag) { process.stderr.write(`faff self-intake: ${danglingValueFlag} needs a value.\n`); return 2; }
  if (!mandate) { process.stderr.write(`${usage}\n`); return 2; }

  const targetRaw = flags["--target"];
  if (typeof targetRaw !== "string") { process.stderr.write(`${usage}\n`); return 2; }
  let target;
  try {
    target = JSON.parse(targetRaw);
    if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error("not an object");
  } catch (e) {
    process.stderr.write(`faff self-intake: --target is not a valid JSON object: ${e.message}\n`);
    return 2;
  }

  // --record / --phase validation (usage-class, before any verdict is computed) —
  // contain's exact rules: --phase requires --record; run-id passes the traversal
  // guard; the run dir must exist BEFORE any verdict (never a silently-unrecorded
  // verdict; exit 2, not 3 — 3 already means "not-self").
  const recordRunId = flags["--record"];
  const wantRecord = typeof recordRunId === "string";
  const phaseArg = flags["--phase"];
  if (phaseArg !== undefined && !wantRecord) {
    process.stderr.write("faff self-intake: --phase only makes sense alongside --record.\n"); return 2;
  }
  const phase = phaseArg !== undefined ? phaseArg : "run";
  if (wantRecord && !EVENT_PHASES.has(phase)) {
    process.stderr.write(`faff self-intake: --phase must be one of ${[...EVENT_PHASES].join(", ")} (got ${JSON.stringify(phaseArg)}).\n`); return 2;
  }
  if (wantRecord && !isSafeRunId(recordRunId)) {
    process.stderr.write("faff self-intake: --record <run-id> must not contain a path separator, a '..' segment, or a control character.\n"); return 2;
  }

  const root = findRoot();
  let self;
  try {
    self = deriveSelfFromConfig(root);
  } catch (e) {
    // A config parse failure is LOUD exit 2 — never a silent not-self with a
    // wrong reason, and never a fall-through to defaults that could misreport
    // lane-off as the cause. (readBaseConfigStrict already wrote its remedy line.)
    const detail = e && e.legacy ? `legacy config name (${e.legacy.join(", ")}) — rename to .faffrc.yaml` : (e && (e.detail || e.message)) || "unreadable";
    process.stderr.write(`faff self-intake: cannot derive the self side — config resolution failed (${detail}).\n`);
    return 2;
  }

  let recordDir = null;
  if (wantRecord) {
    recordDir = path.join(root, ".faff", "runs", recordRunId);
    if (!fs.existsSync(recordDir) || !fs.statSync(recordDir).isDirectory()) {
      process.stderr.write("faff self-intake: run dir missing — initialise the run first\n");
      return 2;
    }
  }

  const decision = decideSelfIntake(target, self);
  const exit = decision.verdict === "self" ? 0 : 3;

  if (wantRecord) {
    const payload = {
      phase, type: "self-intake-check", issue: mandate,
      data: {
        mandate,
        target_raw: targetRaw, // the EXACT --target string — the audit recompute input
        self: { team: self.team, repo: self.repo, lane_on: self.lane_on }, // the config snapshot used
        verdict: decision.verdict, reason: decision.reason, exit,
      },
    };
    // Defense-in-depth (contain's): assert the internally-constructed payload is a
    // valid RunEvent payload before writing it as durable evidence — a malformed
    // record would undermine the whole point of --record. Fails loud, never writes
    // silently-bad evidence.
    const violations = eventViolations(payload, false);
    if (violations.length) {
      throw new Error(`faff self-intake --record: internal error — constructed an invalid self-intake-check payload: ${violations.join("; ")}`);
    }
    // Recording is load-bearing (FAFF-354/574): lock-budget exhaustion exits 2 with
    // a named message rather than dropping the evidence silently.
    try {
      appendEventRecord(recordDir, recordRunId, payload);
    } catch (e) {
      if (e && e.code === "EVENTS_LOCKED") {
        process.stderr.write(`faff self-intake --record: could not record self-intake-check — ${e.message}\n`);
        return 2;
      }
      throw e;
    }
  }

  if (asJson) {
    console.log(JSON.stringify({
      mandate,
      target: decision.target,
      self: { team: self.team, repo: self.repo, lane_on: self.lane_on },
      verdict: decision.verdict,
      reason: decision.reason,
    }, null, 2));
  } else if (decision.verdict === "self") {
    console.log(`self: ${decision.reason} — reclassification honoured`);
  } else {
    console.log(`not-self: ${decision.reason} — outward stands`);
  }
  return exit;
}

// Selftest — drives the pure comparator over the decision table: one row per
// reason, the null-never-matches-null rows, ladder-ordering precedence,
// strict-equality (case-mismatch → not-self), and malformed-input coercion.
// [target, self, wantVerdict, wantReason, label] — no filesystem, no config.
const SELF_ON = { team: "FAFF", repo: "shftwst/faff", lane_on: true };
const SELF_INTAKE_SELFTEST_CASES = [
  // --- one row per SelfIntakeReason ---
  [{ team: "FAFF", repo: "shftwst/faff" }, { team: "FAFF", repo: "shftwst/faff", lane_on: false }, "not-self", "lane-off",
    "lane-off: dial not opted in → not-self, even on a perfect match"],
  [{ team: null, repo: null }, SELF_ON, "not-self", "unresolved-target",
    "unresolved-target: target.team and target.repo both null → not-self"],
  [{ team: "FAFF", repo: "shftwst/faff" }, { team: null, repo: null, lane_on: true }, "not-self", "unresolved-self",
    "unresolved-self: self.team and self.repo both null → not-self"],
  [{ team: "FAFF", repo: "acme/app" }, SELF_ON, "self", "team-match",
    "team-match: non-null strict equality on team → self"],
  [{ team: null, repo: "shftwst/faff" }, SELF_ON, "self", "repo-match",
    "repo-match: non-null strict equality on repo → self"],
  [{ team: "OTHER", repo: "acme/app" }, SELF_ON, "not-self", "mismatch",
    "mismatch: comparisons available, none matched → not-self"],
  // --- null never matches null (the two-null-sides rows) ---
  [{ team: null, repo: "acme/app" }, { team: null, repo: "shftwst/faff", lane_on: true }, "not-self", "mismatch",
    "null-safety: two null teams do NOT team-match — repo comparison decides (mismatch)"],
  [{ team: "OTHER", repo: null }, { team: "FAFF", repo: null, lane_on: true }, "not-self", "mismatch",
    "null-safety: two null repos do NOT repo-match — team comparison decides (mismatch)"],
  [{ team: "FAFF", repo: "shftwst/faff" }, { team: "", repo: "", lane_on: true }, "not-self", "unresolved-self",
    "null-safety: empty-string self fields coerce to null → unresolved-self, never an empty-string match"],
  [{ team: "", repo: "" }, SELF_ON, "not-self", "unresolved-target",
    "null-safety: empty-string target fields coerce to null → unresolved-target"],
  // --- ladder ordering (first-matching rung wins) ---
  [{ team: null, repo: null }, { team: null, repo: null, lane_on: false }, "not-self", "lane-off",
    "ordering: lane-off (rung 2) pre-empts unresolved-target/unresolved-self"],
  [{ team: null, repo: null }, { team: null, repo: null, lane_on: true }, "not-self", "unresolved-target",
    "ordering: unresolved-target (rung 3) pre-empts unresolved-self (rung 4)"],
  [{ team: "FAFF", repo: "shftwst/faff" }, SELF_ON, "self", "team-match",
    "ordering: team-match (rung 5) pre-empts a coincident repo-match (rung 6)"],
  // --- strict equality (case-mismatch fails toward not-self) ---
  [{ team: null, repo: "Shftwst/Faff" }, SELF_ON, "not-self", "mismatch",
    "strict-equality: case-mismatched repo slug → not-self (the safe direction)"],
  [{ team: "faff", repo: null }, SELF_ON, "not-self", "mismatch",
    "strict-equality: case-mismatched team key → not-self"],
  // --- malformed-input coercion (fail-closed by the ladder, never a throw) ---
  ["not-an-object", SELF_ON, "not-self", "unresolved-target",
    "coercion: non-object target coerces to all-null → unresolved-target"],
  [{ team: 42, repo: ["shftwst/faff"] }, SELF_ON, "not-self", "unresolved-target",
    "coercion: wrong-typed target fields coerce to null → unresolved-target"],
  [{ team: "FAFF", repo: 42 }, SELF_ON, "self", "team-match",
    "coercion: one wrong-typed field nulls only that field — the other still compares"],
  [{ team: "FAFF", repo: "shftwst/faff" }, { team: "FAFF", repo: "shftwst/faff", lane_on: "true" }, "not-self", "lane-off",
    "coercion: lane_on as a truthy non-boolean does NOT read as opted-in (strict === true)"],
  [{ team: "FAFF", repo: "shftwst/faff" }, "not-an-object", "not-self", "lane-off",
    "coercion: non-object self coerces to lane_on:false → lane-off"],
];

function selfIntakeSelftest() {
  let fail = 0;
  for (const [target, self, wantVerdict, wantReason, label] of SELF_INTAKE_SELFTEST_CASES) {
    const got = decideSelfIntake(target, self);
    const ok = got.verdict === wantVerdict && got.reason === wantReason;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} → ${got.verdict}/${got.reason}${ok ? "" : ` (want ${wantVerdict}/${wantReason})`}`);
  }
  // shape: every produced reason is in the closed enum, and every enum member is hit.
  const produced = new Set(SELF_INTAKE_SELFTEST_CASES.map(([t, s]) => decideSelfIntake(t, s).reason));
  const enumOk = [...produced].every((r) => SELF_INTAKE_REASONS.includes(r))
    && SELF_INTAKE_REASONS.every((r) => produced.has(r));
  if (!enumOk) fail++;
  console.log(`${enumOk ? "ok  " : "FAIL"} shape: produced reasons ≡ the closed six-token enum`);
  // normalize: the target normalizer is what the CLI/audit surface — pin its coercions.
  const norm = normalizeSelfIntakeTarget({ team: "", repo: 7 });
  const normOk = norm.team === null && norm.repo === null;
  if (!normOk) fail++;
  console.log(`${normOk ? "ok  " : "FAIL"} normalize: empty-string and non-string target fields → null`);
  const total = SELF_INTAKE_SELFTEST_CASES.length + 2;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { SELF_INTAKE_SELFTEST_CASES, cmdSelfIntake, deriveSelfFromConfig, selfIntakeSelftest };
