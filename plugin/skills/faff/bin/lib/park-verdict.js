// ===========================================================================
// === region:factory — park-verdict — FAFF-835: the stale-park validity function. ===
// PURE: decides whether faff-tidy's autonomous case-1 stale-`faff-parked` sweep may
// strip the label from an issue, from four explicit inputs the caller resolved from
// the tracker — the issue `status`, whether it has an open `draft-pr`, the class of
// the most-recent faff `park-comment` (`build`|`nonbuild`|`none`), and a
// `human-takeover` flag — and NOTHING else. It reads no tracker and no system clock,
// so it is fully selftestable, mirroring the `claim-verdict` / `eligible` / `next`
// split: the CLI decides, the agent reads the tracker.
//
// The problem it fixes: case 1's bare "status moved on → strip" assumed `In Progress`
// always means a human took the issue over. But faff's own park-with-draft-PR posture
// leaves a validly-parked build at `In Progress` with the `faff-parked` label still
// load-bearing (it keeps the issue out of the eligible pool). Two faff-park classes
// need protecting: the POST-PR held-in-draft park (caught by an open draft PR — its
// preserved artifact, checked first) and the NO-PR mid-build park (caught by a
// build-class park comment with no human action since).
//
// Fail-safe direction: when the signals cannot cleanly classify an `in-progress`
// issue, return `surface` (leave the label, surface for a human) — never `strip-ok`.
// A false strip re-queues genuinely-blocked work; a false retain only costs a look.
// ===========================================================================


const STATUSES = ["backlog", "todo", "in-progress", "in-review", "done", "cancelled", "archived"];
const DRAFT_PR = ["present", "absent"];
const PARK_COMMENT = ["build", "nonbuild", "none"];

class ParkVerdictError extends Error {}

// Returns { verdict: "protect"|"strip-ok"|"surface"|"n/a" }, or throws a
// ParkVerdictError (message names the offending input) when an input is invalid.
function parkVerdict(status, draftPr, parkComment, humanTakeover) {
  if (!STATUSES.includes(status)) throw new ParkVerdictError(`--status is not one of ${STATUSES.join("|")}: ${status}`);
  if (!DRAFT_PR.includes(draftPr)) throw new ParkVerdictError(`--draft-pr is not one of ${DRAFT_PR.join("|")}: ${draftPr}`);
  if (!PARK_COMMENT.includes(parkComment)) throw new ParkVerdictError(`--park-comment is not one of ${PARK_COMMENT.join("|")}: ${parkComment}`);
  if (typeof humanTakeover !== "boolean") throw new ParkVerdictError(`--human-takeover is not a boolean: ${humanTakeover}`);

  // 1. case 1's "state moved on" trigger does not fire below `In Progress`.
  if (status === "backlog" || status === "todo") return { verdict: "n/a" };
  // 2-3. terminal or under review → the label has genuinely gone stale (unchanged from today).
  if (status === "done" || status === "cancelled" || status === "archived") return { verdict: "strip-ok" };
  if (status === "in-review") return { verdict: "strip-ok" };
  // 4. status === "in-progress" — the disputed case.
  // 5. an open draft PR is the post-PR held-in-draft park's own preserved artifact.
  if (draftPr === "present") return { verdict: "protect" };
  // 6. a build-class park comment marks a no-PR mid-build park.
  if (parkComment === "build") {
    return humanTakeover ? { verdict: "surface" } : { verdict: "protect" };
  }
  // 7. a non-build park a human has since acted on is a classic human takeover.
  if (parkComment === "nonbuild" && humanTakeover) return { verdict: "strip-ok" };
  // 8. anything else is unclassifiable → fail-safe to surface, never strip.
  return { verdict: "surface" };
}

// Cases: [[status, draft_pr, park_comment, human_takeover], want_verdict]. The table
// exercises every branch of the predicate, keyed to the spec's DoD boundary rows.
const PARK_VERDICT_CASES = [
  [["backlog", "absent", "none", false], "n/a"],            // below In Progress ⇒ n/a
  [["todo", "present", "build", true], "n/a"],              // todo short-circuits before any signal
  [["done", "present", "build", false], "strip-ok"],       // terminal ⇒ strip-ok
  [["cancelled", "absent", "none", false], "strip-ok"],    // terminal ⇒ strip-ok
  [["archived", "absent", "none", false], "strip-ok"],     // terminal ⇒ strip-ok
  [["in-review", "present", "build", false], "strip-ok"],  // under review ⇒ strip-ok (label is noise)
  [["in-progress", "present", "none", false], "protect"],  // draft PR present ⇒ protect (post-PR held-in-draft)
  [["in-progress", "present", "nonbuild", true], "protect"], // draft PR dominates the park-comment branch
  [["in-progress", "absent", "build", false], "protect"],  // no-PR mid-build park, no human action ⇒ protect
  [["in-progress", "absent", "build", true], "surface"],   // faff park then a human acted ⇒ ambiguous ⇒ surface
  [["in-progress", "absent", "nonbuild", true], "strip-ok"], // classic human takeover of a pre-build park
  [["in-progress", "absent", "nonbuild", false], "surface"], // nonbuild, no human action ⇒ cannot classify ⇒ surface
  [["in-progress", "absent", "none", false], "surface"],   // no park comment at In Progress ⇒ surface
  [["in-progress", "absent", "none", true], "surface"],    // none + human action, no draft PR ⇒ still surface (fail-safe)
];

function runParkVerdictCases() {
  let fail = 0;
  for (const [[status, draftPr, parkComment, human], want] of PARK_VERDICT_CASES) {
    let got;
    try { got = parkVerdict(status, draftPr, parkComment, human).verdict; }
    catch (e) { got = `ERROR(${e.message})`; }
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} status=${status} draft-pr=${draftPr} park-comment=${parkComment} human=${human} → ${got} (want ${want})`);
  }
  return fail;
}

function parkVerdictSelftest() {
  const fail = runParkVerdictCases();
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${PARK_VERDICT_CASES.length} cases, ${fail} failed) — no tracker, no system clock consulted`);
  return fail ? 1 : 0;
}

const { parseArgs, usageError } = require("./argv");
const { captureDecision } = require("./decision-capture");

const PARK_VERDICT_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--status": { arity: 1 },
    "--draft-pr": { arity: 1 },
    "--park-comment": { arity: 1 },
    "--human-takeover": { arity: 1 },
  },
};
const PARK_VERDICT_USAGE = "usage: faff park-verdict --status <backlog|todo|in-progress|in-review|done|cancelled|archived> --draft-pr <present|absent> --park-comment <build|nonbuild|none> --human-takeover <true|false> [--selftest]";

function cmdParkVerdict(args) {
  if (args.includes("--selftest")) return parkVerdictSelftest();
  const { values, errors } = parseArgs(args, PARK_VERDICT_SPEC);
  if (errors.length) return usageError(errors, PARK_VERDICT_USAGE);
  const missing = ["--status", "--draft-pr", "--park-comment", "--human-takeover"].filter((f) => values[f] === undefined);
  if (missing.length) return usageError([{ code: "missing-flag", detail: `missing required flag(s): ${missing.join(", ")}` }], PARK_VERDICT_USAGE);
  const htRaw = values["--human-takeover"];
  if (htRaw !== "true" && htRaw !== "false") {
    return usageError([{ code: "invalid-input", detail: `--human-takeover is not true|false: ${htRaw}` }], PARK_VERDICT_USAGE);
  }
  try {
    const humanTakeover = htRaw === "true";
    const out = parkVerdict(values["--status"], values["--draft-pr"], values["--park-comment"], humanTakeover);
    console.log(JSON.stringify(out));
    // FAFF-956: deterministic in-kernel decision-capture — best-effort, flag-guarded,
    // authority-inert. normalised_inputs uses the registry's canonical positional keys.
    captureDecision({
      kernel: "park-verdict",
      normalised_inputs: { status: values["--status"], draftPr: values["--draft-pr"], parkComment: values["--park-comment"], humanTakeover },
      verdict: out,
      issue: process.env.FAFF_DECISION_ISSUE || "",
    });
    return 0;
  } catch (e) {
    if (e instanceof ParkVerdictError) return usageError([{ code: "invalid-input", detail: e.message }], PARK_VERDICT_USAGE);
    throw e;
  }
}


module.exports = { PARK_VERDICT_CASES, ParkVerdictError, parkVerdict, cmdParkVerdict, parkVerdictSelftest, runParkVerdictCases };
