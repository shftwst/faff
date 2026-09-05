"use strict";
// === region:factory — park-reconsider — FAFF-993: the git-only Unpark contract + autonomous re-entry ===
//
// Two seams share ONE write contract for clearing a git-only park:
//   - the autonomous resume-time reconsider pass (resumeLightsOut), gated on `classifyReEntry`
//     (the cited machine-checkable input demonstrably changed), which writes its OWN live run ledger;
//   - the interactive `/faff-prep <issue>` re-invoke, gated on the human's authored resolution, which
//     may write ONLY the marker + its own prep log (never a different, earlier run's Evidence ledger).
//
// This module owns: the PURE re-entry decision (`classifyReEntry`), the repo-root confinement of the
// cited input (`confine`, symlink-safe realpath containment — the model ported from
// spec-judge-casefile.js), the shared `apply_git_only_unpark` write helper (parameterised by
// ledger-write authority), and the `faff park-reconsider` compute verb (`--selftest`). It reads the
// FAFF-992 park-record schema (`prepcheck.readParkCause`, `park-history.readReconsider/fingerprintFile`)
// and never re-derives it. PURE where it matters: `classifyReEntry`/`confine` do no writes and reach no
// network; the one WRITE is `apply_git_only_unpark`, to a caller-named `.faff/prep/<key>.json` marker
// (Sensor/resume class) and — for the own-live-run authority only — its own run's ledger + events.

const fs = require("node:fs");
const path = require("node:path");
const { readOutcomes } = require("./queue-state");
const { mutateLedgerUnderLock } = require("./heartbeat");
const { runIsHeld } = require("./runcheck");
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");

// The closed set of re-entry reasons `classifyReEntry` returns. Exactly one `reconsider:true` reason
// (`input-changed`); every other is a fail-closed `false`.
const REENTRY_REASONS = new Set([
  "human-park", "no-cited-input", "no-stored-fingerprint", "ref-outside-repo-root",
  "fingerprint-unreadable", "clock-not-advanced", "input-unchanged", "input-changed",
]);

// confine(root, ref) -> ref_in_root : BOOL. Symlink-SAFE repo-root confinement: resolve the ref's REAL
// path (following symlinks; a non-existent leaf resolves through its nearest existing ancestor) and
// re-assert it is strictly under the resolved repo root. The lexical `resumecheck.isUnderRunsRoot`
// model is deliberately NOT used — it never resolves symlinks, so an in-root symlink pointing out of
// the tree passes it and is then dereferenced. Fail-CLOSED: a null/non-string ref, or any resolve
// failure, returns false. The pure `classifyReEntry` stays filesystem-free by taking this boolean.
function realpathSafe(p) {
  // ported from spec-judge-casefile.js: realpath, tolerating a non-existent leaf via path.resolve.
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}
function confine(root, ref) {
  if (typeof root !== "string" || typeof ref !== "string" || ref.length === 0) return false;
  const real = realpathSafe(path.resolve(root, ref));
  const rootReal = realpathSafe(root);
  return real === rootReal || real.startsWith(rootReal + path.sep);
}

// classifyReEntry(cause, observed_fp, ref_in_root, now) -> { reconsider, reason }. PURE, filesystem-free,
// selftest-driven. `cause` is the FAFF-992 ParkCause (marker.park). `observed_fp` is the current
// content fingerprint the impure caller supplied (null when unreadable OR out-of-root). `ref_in_root`
// is the precomputed confine() boolean. `now` is an ISO-8601 instant (injected fixed in selftest).
// FAIL-CLOSED at every gate: only a `machine` park with a stored fingerprint, an in-root ref, a
// readable current fingerprint, elapsed time since the park, and a DIFFERING fingerprint reconsiders.
function classifyReEntry(cause, observed_fp, ref_in_root, now) {
  if (!cause || typeof cause !== "object" || cause.reconsider !== "machine") {
    return { reconsider: false, reason: "human-park" };
  }
  const ci = cause.cited_input;
  if (!ci || typeof ci !== "object") return { reconsider: false, reason: "no-cited-input" };
  if (typeof ci.fingerprint !== "string" || ci.fingerprint.length === 0) {
    return { reconsider: false, reason: "no-stored-fingerprint" };
  }
  if (ref_in_root !== true) return { reconsider: false, reason: "ref-outside-repo-root" };       // fail-closed
  if (observed_fp == null) return { reconsider: false, reason: "fingerprint-unreadable" };        // fail-closed
  const parkedMs = Date.parse(cause.parked_at);
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs) || Number.isNaN(parkedMs) || nowMs <= parkedMs) {
    return { reconsider: false, reason: "clock-not-advanced" };                                   // fail-closed
  }
  if (observed_fp === ci.fingerprint) return { reconsider: false, reason: "input-unchanged" };
  return { reconsider: true, reason: "input-changed" };
}

// The park-reconsidered unpark record shape (shared by both seams; the autonomous seam appends it as a
// run-scoped events.jsonl event, the interactive seam writes it to the prep log).
function parkReconsideredRecord(key, cause, via, ledger_cleared, ledger_note, prev_fp, new_fp) {
  return {
    type: "park-reconsidered",
    data: {
      issue: key,
      cause_class: (cause && typeof cause.cause_class === "string") ? cause.cause_class : null,
      via,                                   // "resume-reconsider" | "interactive-reprep"
      ledger_cleared: !!ledger_cleared,
      ledger_note: ledger_note || null,      // absent-run | earlier-run-terminal | earlier-run-live-deferred
      cited_input_ref: (cause && cause.cited_input && typeof cause.cited_input.ref === "string") ? cause.cited_input.ref : null,
      prev_fingerprint: prev_fp || null,
      new_fingerprint: new_fp || null,       // null on an interactive resolution with no fingerprintable cited input
    },
  };
}

// Rewrite .faff/prep/<key>.json: remove disposition "parked" and drop the `park` sub-object. Returns
// true on a rewrite, false when the marker is unreadable/absent (nothing to clear). NEVER a bare
// disposition strip on its own — only the ledger-settled callers below invoke it.
function clearParkMarker(root, key) {
  const markerPath = path.join(root, ".faff", "prep", `${key}.json`);
  let m;
  try { m = JSON.parse(fs.readFileSync(markerPath, "utf8")); }
  catch { return false; }
  if (!m || typeof m !== "object") return false;
  delete m.park;
  if (m.disposition === "parked") delete m.disposition;
  fs.writeFileSync(markerPath, JSON.stringify(m, null, 2) + "\n");
  return true;
}

// apply_git_only_unpark — the ONE shared Unpark contract, parameterised by ledger-write authority.
//   ledger_authority "own-live-run"     (AUTONOMOUS): trusted side of its OWN run's cut. Clear the
//     `parked` outcome via mutateLedgerUnderLock FIRST, then the marker; refuse (no strip) on
//     LEDGER_LOCKED / yield / parse-throw. A committed clear that finds the outcome already moved is an
//     idempotent no-op, still unparked:true.
//   ledger_authority "cross-run-readonly" (INTERACTIVE): NEVER writes the earlier run's Evidence
//     ledger. Refuse on a present-but-malformed earlier ledger and on a still-live (held) earlier run;
//     clear the marker ALONE when the earlier run is absent/rotated/terminal (no live surfacer reads
//     `parked` for a run not being drained).
// The event record is RETURNED (`event`) for the seam to append to events.jsonl (autonomous) or the
// prep log (interactive) — the seam owns the write authority for its own artifact.
function apply_git_only_unpark(root, marker, key, cause, via, prev_fp, new_fp, ledger_authority, nowMs) {
  const run_dir = (marker && marker.owner && typeof marker.owner.run_dir === "string") ? marker.owner.run_dir : null;
  const probe = readOutcomes(run_dir);          // { outcomes, malformed } — READ, both authorities

  // BRANCH R (present-but-unparseable ledger) -> REFUSE, both authorities.
  if (probe.malformed) {
    return { unparked: false, reason: "earlier-run-ledger-malformed; surfaced, park left standing" };
  }

  let ledger_cleared = false;
  let ledger_note = null;

  if (ledger_authority === "own-live-run") {
    if (run_dir && fs.existsSync(path.join(run_dir, "run-ledger.json"))) {
      let res;
      try {
        res = mutateLedgerUnderLock(run_dir, (fresh) => {
          if (!fresh || !fresh.outcomes || fresh.outcomes[key] !== "parked") return null; // already moved => idempotent no-op
          const next = { ...fresh, outcomes: { ...fresh.outcomes } };
          delete next.outcomes[key];
          return next;
        });
      } catch (e) {
        return { unparked: false, reason: `own-run-ledger-busy-or-corrupt (${(e && e.code) || e}); retry, park left standing` };
      }
      if (res && res.yielded) {
        return { unparked: false, reason: "own-run-ledger-yielded; a newer resume owns it, park left standing" };
      }
      ledger_cleared = true; ledger_note = null;
    } else {
      ledger_cleared = false; ledger_note = "absent-run"; // own run always present in practice; defensive
    }
  } else if (ledger_authority === "cross-run-readonly") {
    if (!run_dir || !fs.existsSync(path.join(run_dir, "run-ledger.json"))) {
      ledger_cleared = false; ledger_note = "absent-run";          // marker-alone is complete
    } else {
      let heldEarlier = false;
      try {
        const led = JSON.parse(fs.readFileSync(path.join(run_dir, "run-ledger.json"), "utf8"));
        heldEarlier = runIsHeld(led, typeof nowMs === "number" ? nowMs : Date.parse(new Date(0).toISOString()) + 0);
      } catch { /* unreadable already caught by probe.malformed above */ }
      if (heldEarlier) {
        return { unparked: false, reason: "earlier-run-live; its own resume-reconsider clears this, or stop/resume it" };
      }
      ledger_cleared = false; ledger_note = "earlier-run-terminal"; // historical ledger; marker is the live surfacer
    }
  } else {
    return { unparked: false, reason: `unknown ledger authority ${ledger_authority}` };
  }

  // Only AFTER the ledger step settled: clear the marker (Sensor/resume class; both authorities may write it).
  clearParkMarker(root, key);
  const event = parkReconsideredRecord(key, cause, via, ledger_cleared, ledger_note, prev_fp, new_fp);
  return { unparked: true, ledger_cleared, ledger_note, event };
}

// --- selftest: the PURE core over the full fail-closed reason table (injected fixed NOW) ------------
const FIXED_NOW = "2026-09-05T12:00:00Z";
const BEFORE = "2026-09-01T00:00:00Z"; // parked_at strictly before FIXED_NOW
const AFTER = "2026-09-09T00:00:00Z";  // parked_at strictly after FIXED_NOW (clock not advanced)
const CI = (over) => ({ kind: "config-file", ref: ".faffrc.yaml", keys: ["k"], fingerprint: over });
const machine = (parked_at, fp) => ({ reconsider: "machine", cause_class: "other", parked_at, cited_input: CI(fp) });

// [name, cause, observed_fp, ref_in_root, want.reconsider, want.reason]
const PARK_RECONSIDER_SELFTEST_CASES = [
  ["human park is never reconsidered", { reconsider: "human", cause_class: "punt-not-closed", parked_at: BEFORE, cited_input: null }, "sha256:x", true, false, "human-park"],
  ["legacy record (no reconsider) reads human", { cause_class: "other", parked_at: BEFORE }, "sha256:x", true, false, "human-park"],
  ["machine with no cited input", { reconsider: "machine", cause_class: "other", parked_at: BEFORE, cited_input: null }, "sha256:x", true, false, "no-cited-input"],
  ["machine with empty stored fingerprint", machine(BEFORE, ""), "sha256:x", true, false, "no-stored-fingerprint"],
  ["ref outside repo root fails closed", machine(BEFORE, "sha256:a"), "sha256:b", false, false, "ref-outside-repo-root"],
  ["unreadable current fingerprint fails closed", machine(BEFORE, "sha256:a"), null, true, false, "fingerprint-unreadable"],
  ["clock not advanced (parked in the future) fails closed", machine(AFTER, "sha256:a"), "sha256:b", true, false, "clock-not-advanced"],
  ["input unchanged stays parked", machine(BEFORE, "sha256:a"), "sha256:a", true, false, "input-unchanged"],
  ["input changed -> reconsider", machine(BEFORE, "sha256:a"), "sha256:b", true, true, "input-changed"],
];

function parkReconsiderSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };
  for (const [name, cause, observed_fp, ref_in_root, wantReconsider, wantReason] of PARK_RECONSIDER_SELFTEST_CASES) {
    const got = classifyReEntry(cause, observed_fp, ref_in_root, FIXED_NOW);
    ok(`${name} -> {${got.reconsider}, ${got.reason}}`, got.reconsider === wantReconsider && got.reason === wantReason && REENTRY_REASONS.has(got.reason));
  }
  // confine() is symlink-safe + fail-closed
  ok("confine: null/empty ref -> false", confine("/tmp", null) === false && confine("/tmp", "") === false);
  ok("confine: an in-root relative path -> true", confine(process.cwd(), "package.json") === true || confine(process.cwd(), "AGENTS.md") === true || confine(process.cwd(), ".") === true);
  ok("confine: a parent-escape lexical path -> false", confine(process.cwd(), "../../../etc") === false);
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (park-reconsider, ${fail} failed)`);
  return fail ? 1 : 0;
}

const PARK_RECONSIDER_SPEC = { flags: { "--selftest": { arity: 0 } }, positionals: { min: 0, max: 0, name: "(none)" } };
const USAGE = "usage: faff park-reconsider --selftest";

// The compute verb — a pure decision/selftest surface with NO operator-invocable unpark side effect
// (the seams call apply_git_only_unpark directly), mirroring the other --selftest-bearing compute verbs.
function cmdParkReconsider(args) {
  if (args.includes("--selftest")) return parkReconsiderSelftest();
  const { errors } = parseArgs(args, PARK_RECONSIDER_SPEC);
  if (errors.length) return usageError(errors, USAGE);
  return usageError([{ code: "mode", detail: "--selftest is required" }], USAGE);
}

module.exports = {
  REENTRY_REASONS, PARK_RECONSIDER_SELFTEST_CASES, PARK_RECONSIDER_SPEC, USAGE,
  apply_git_only_unpark, classifyReEntry, clearParkMarker, cmdParkReconsider, confine,
  parkReconsiderSelftest, parkReconsideredRecord,
};
