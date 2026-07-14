// ===========================================================================
// === region:factory — project-next — FAFF-248/259: the container (project | parent-issue) ===
// state-coherence + DoD-gated-Done transition predicate. PURE: the caller (the
// /faff-tidy orchestrator-lane sweep) maps a container's live status CATEGORY +
// its child-issue rollup into flags; the CLI returns the legal forward-only
// transition. It NEVER reads or writes the tracker (parity with
// `next`/`contain`/`eligible`). Forward-only + monotonic: an `advance` is
// emitted ONLY when the desired category ranks STRICTLY ABOVE the current one —
// a container is never moved backward (status-monotonicity floor, mirroring
// issue-claim one level down).
//
// Scope (v1.1) — four children-derived, reversible, state-coherence transitions:
//   project      → started   when a first child starts;
//   parent-issue → started   when any child is in progress;
//   project      → completed when ALL children are done AND the project has NO
//                            DoD/release-gate (--has-dod absent);
//   project      → completed when ALL children are done AND the project HAS a
//                            DoD AND its release gate is satisfied (--has-dod
//                            --dod-met — FAFF-259). All-children-done with an
//                            unmet/unverified gate holds the project open — the
//                            DoD only ever TIGHTENS Done, never loosens it
//                            (ADR: DoD release gate only tightens a container's
//                            Done). `--dod-met` without `--has-dod` is a
//                            malformed rollup (a gate result for a gate-less
//                            project is a caller bug) → error, exit 2.
// Parent-issue → Done remains out of scope: a parent often carries its own work
// beyond its children, so all-children-done is not sufficient to call it done.
// ===========================================================================


const PN_CATEGORIES = ["planned", "started", "completed", "cancelled"];
const PN_KINDS = ["project", "issue"];
const PN_RANK = { planned: 0, started: 1, completed: 2 }; // cancelled is terminal, unranked

// PURE predicate. Returns { kind, current, desired, action: "advance"|"noop", reason }
// or { error } for a malformed rollup (mapped to a usage exit by the caller).
function projectNext({ current, kind, total, active, done, hasDod, dodMet }) {
  // 0. --dod-met without --has-dod is a malformed rollup (a gate result for a gate-less
  // project is a caller bug) — checked first, ahead of every other validation.
  if (dodMet && !hasDod) return { error: "--dod-met requires --has-dod (a gate result for a gate-less project is a caller bug)" };
  if (!PN_CATEGORIES.includes(current)) return { error: `unknown --current '${current}' (expect ${PN_CATEGORIES.join("|")})` };
  if (!PN_KINDS.includes(kind)) return { error: `unknown --kind '${kind}' (expect ${PN_KINDS.join("|")})` };
  for (const [name, v] of [["--total", total], ["--active", active], ["--done", done]]) {
    if (!Number.isInteger(v) || v < 0) return { error: `${name} must be a non-negative integer` };
  }
  if (active + done > total) return { error: `--active + --done (${active}+${done}) cannot exceed --total (${total})` };

  const noop = (reason) => ({ kind, current, desired: current, action: "noop", reason });
  const advance = (desired, reason) => ({ kind, current, desired, action: "advance", reason });

  // 1. Terminal — never auto-revert out of a completed/cancelled container.
  if (current === "completed" || current === "cancelled") return noop("terminal — never auto-revert");
  // 2. Nothing to derive from.
  if (total === 0) return noop("no children — nothing to derive");

  const allDone = done === total;                          // total > 0 here
  const startedSignal = active > 0 || (done > 0 && done < total);

  // 3. All children done → Done coherence (project + no DoD, or project + DoD-gated), forward-only.
  if (allDone) {
    if (kind === "project" && !hasDod) {
      // forward-only guard: advance to completed only when it ranks above current.
      if (PN_RANK.completed > PN_RANK[current]) return advance("completed", "all children done — state-coherence (no DoD)");
      return noop("already completed");                    // defensive — completed is handled at step 1
    }
    if (kind === "project" && hasDod && dodMet) {
      // forward-only guard: advance to completed only when it ranks above current.
      if (PN_RANK.completed > PN_RANK[current]) return advance("completed", "all children done and release gate passed (DoD-gated Done)");
      return noop("already completed");                    // defensive — completed is handled at step 1
    }
    if (kind === "project") return noop("all-children-done: release gate not passed — held open (DoD authoritative)"); // hasDod, !dodMet
    return noop("all-children-done: parent-issue Done is out of scope");                                   // kind === issue
  }

  // 4. First child started → In Progress, forward-only (only from planned).
  if (current === "planned" && startedSignal) return advance("started", "first child started");

  return noop("no transition");
}

function projectNextSelftest() {
  const C = (current, kind, total, active, done, x = {}) => ({ current, kind, total, active, done, hasDod: !!x.hasDod, dodMet: !!x.dodMet });
  // [input, wantAction, wantDesired]
  const cases = [
    [C("planned", "project", 3, 1, 0), "advance", "started"],                  // first child started (project)
    [C("planned", "issue", 2, 1, 0), "advance", "started"],                    // parent issue → In Progress (child active)
    [C("planned", "project", 3, 0, 1), "advance", "started"],                  // some done, not all → underway
    [C("started", "project", 3, 2, 0), "noop", "started"],                     // already started → idempotent
    [C("planned", "project", 2, 0, 2), "advance", "completed"],                // all done, project, no DoD (planned→completed)
    [C("started", "project", 2, 0, 2), "advance", "completed"],                // all done, project, no DoD (started→completed)
    [C("started", "project", 2, 0, 2, { hasDod: true }), "noop", "started"],   // all done, has DoD, gate unmet → held open
    [C("planned", "project", 2, 0, 2, { hasDod: true }), "noop", "planned"],   // all done, has DoD, planned, gate unmet → still held open
    [C("started", "project", 2, 0, 2, { hasDod: true, dodMet: true }), "advance", "completed"], // NEW: all done, has DoD, gate MET → DoD-gated Done
    [C("planned", "project", 2, 0, 2, { hasDod: true, dodMet: true }), "advance", "completed"], // NEW: all done, has DoD, gate MET, planned→completed
    [C("started", "issue", 2, 0, 2), "noop", "started"],                       // all done, parent-issue → out of scope
    [C("planned", "issue", 2, 0, 2), "noop", "planned"],                       // all done, parent-issue planned → out of scope (no Done)
    [C("completed", "project", 3, 0, 3), "noop", "completed"],                 // terminal → never revert
    [C("cancelled", "project", 3, 1, 0), "noop", "cancelled"],                 // terminal cancelled → never revert
    [C("planned", "project", 0, 0, 0), "noop", "planned"],                     // empty → nothing to derive
    [C("planned", "project", 3, 0, 0), "noop", "planned"],                     // planned, no started signal → noop
    [C("started", "project", 3, 0, 0), "noop", "started"],                     // started, no signal yet → no transition
  ];
  let fail = 0;
  for (const [inp, wantAction, wantDesired] of cases) {
    const r = projectNext(inp);
    const ok = !r.error && r.action === wantAction && r.desired === wantDesired;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(inp)} → ${r.error ? "ERR " + r.error : r.action + "/" + r.desired} (want ${wantAction}/${wantDesired})`);
  }
  // Reason-string pins for the two NEW DoD-gated transitions (exact strings matter — logged/rendered verbatim).
  console.log("\n-- DoD-gated Done: exact reason strings --");
  {
    const rMet = projectNext(C("started", "project", 2, 0, 2, { hasDod: true, dodMet: true }));
    const wantMet = "all children done and release gate passed (DoD-gated Done)";
    const okMet = rMet.reason === wantMet;
    if (!okMet) fail++;
    console.log(`${okMet ? "ok  " : "FAIL"} gate-met reason === ${JSON.stringify(wantMet)} (got ${JSON.stringify(rMet.reason)})`);

    const rUnmet = projectNext(C("started", "project", 2, 0, 2, { hasDod: true }));
    const wantUnmet = "all-children-done: release gate not passed — held open (DoD authoritative)";
    const okUnmet = rUnmet.reason === wantUnmet;
    if (!okUnmet) fail++;
    console.log(`${okUnmet ? "ok  " : "FAIL"} gate-unmet reason === ${JSON.stringify(wantUnmet)} (got ${JSON.stringify(rUnmet.reason)})`);
  }
  // Malformed rollups → error (mapped to usage exit 2 by the caller).
  console.log("\n-- malformed rollups → error --");
  for (const bad of [
    { current: "started", kind: "project", total: 1, active: 2, done: 0, hasDod: false, dodMet: false }, // active>total
    { current: "started", kind: "project", total: 2, active: 0, done: 3, hasDod: false, dodMet: false }, // active+done>total
    { current: "nope", kind: "project", total: 1, active: 0, done: 0, hasDod: false, dodMet: false },     // bad category
    { current: "started", kind: "epic", total: 1, active: 0, done: 0, hasDod: false, dodMet: false },     // bad kind
    { current: "started", kind: "project", total: -1, active: 0, done: 0, hasDod: false, dodMet: false }, // negative
    { current: "started", kind: "project", total: 2, active: 0, done: 2, hasDod: false, dodMet: true },   // NEW: --dod-met without --has-dod
  ]) {
    const r = projectNext(bad);
    const ok = !!r.error;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(bad)} → ${r.error ? "error" : r.action} (want error)`);
  }
  // Monotonicity invariant: across a grid, no advance ever ranks desired ≤ current. dodMet iterates
  // alongside hasDod so the grid exercises all four (hasDod, dodMet) combinations at every cell.
  console.log("\n-- monotonicity: advance ⇒ rank(desired) > rank(current) over the grid (dodMet ∈ {false,true}) --");
  let monoFail = 0;
  for (const cur of PN_CATEGORIES) {
    for (const kind of PN_KINDS) {
      for (const [t, a, d] of [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [2, 0, 2], [3, 0, 1], [3, 1, 2], [1, 0, 1], [4, 2, 1]]) {
        for (const hasDod of [false, true]) {
          for (const dodMet of [false, true]) {
            const r = projectNext({ current: cur, kind, total: t, active: a, done: d, hasDod, dodMet });
            if (r.error) continue;
            if (r.action === "advance" && !(PN_RANK[r.desired] > PN_RANK[r.current])) {
              monoFail++; console.log(`FAIL backward/equal advance ${JSON.stringify(r)}`);
            }
          }
        }
      }
    }
  }
  console.log(monoFail ? `FAIL ${monoFail} backward advance(s)` : "ok  no backward advance across the grid");
  fail += monoFail;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${cases.length} transition cases + reason pins + malformed + monotonicity grid, ${fail} failed)`);
  return fail ? 1 : 0;
}

function cmdProjectNext(args) {
  if (args.includes("--selftest")) return projectNextSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const num = (f) => { const v = get(f); return v === null ? 0 : Number(v); }; // non-int/negative → error in projectNext
  const state = {
    current: (get("--current") || "").toLowerCase(),
    kind: (get("--kind") || "project").toLowerCase(),
    total: num("--total"),
    active: num("--active"),
    done: num("--done"),
    hasDod: args.includes("--has-dod"),
    dodMet: args.includes("--dod-met"),
  };
  const r = projectNext(state);
  if (r.error) { process.stderr.write(`faff project-next: ${r.error}\n`); return 2; }
  console.log(JSON.stringify(r));
  return 0;
}


module.exports = { PN_CATEGORIES, PN_KINDS, PN_RANK, cmdProjectNext, projectNext, projectNextSelftest };
