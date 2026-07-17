// ===========================================================================
// === region:governance — resume — FAFF-527: L4 run re-entry pure cores. ===
//
// `faff lights-out --resume <run-id>` continues an EXISTING run-id's ledger under a
// fresh session — never a new mint. Re-entry is a *reconstruction* problem, not a
// checkpoint/restore one: the run-ledger + per-issue artifacts + forge ground truth
// together are a durable, reconstructable record; this module holds the deterministic
// cores over that record (the impure shell in lights-out.js gathers the evidence):
//
//   classifyReEnterable  — is this ledger re-enterable, and in which state?
//   reconstructResumePlan — per-issue: skip / continue / redispatch / park (pure)
//   applyResumeToLedger  — the additive ledger mutation a re-entry writes
//   renderResumeBanner   — the human banner + the run-resume event shape
//
// Design stance (single-sourced with the house rules): fail closed on every ledger-vs-
// forge divergence (park the issue, never guess), never re-ship or double-merge (skip is
// granted ONLY on a reconcile-proven merge), the ledger is continued not copied (same
// run_id / seq stream), and any coarse rebuild is announced, never silent.
// ===========================================================================

const { isEscalateStopReason } = require("./disposition");
const { reconcileShipped } = require("./reconcile");

// The re-enterable states + the refusal states (spec §3 ENUM). A run is admitted for
// resume iff it classifies to one of RE_ENTERABLE; the refusals exit 2, ledger untouched.
const RE_ENTERABLE_STATES = ["aborted-resumable", "escalated", "dead-running"];
const RESUME_REFUSAL_STATES = ["live-running", "done-clean", "unparseable"];

// Ledger outcomes that are terminal-and-NOT-shipped: a resume never resurrects them
// (they keep as-is) and never re-dispatches them. `shipped` is handled separately
// (reconcile-proven skip vs divergence park).
const TERMINAL_NON_SHIPPED = new Set(["pr-open", "parked", "errored", "routed-out", "unreached-budget", "claimed-by-peer"]);

// PURE: classify a run's re-enterability from its ledger + a resolved liveness bit.
// `held` is the caller's runIsHeld verdict AFTER overlaying the heartbeat file (a fresh
// effective heartbeat ⇒ held:true ⇒ a live second driver ⇒ REFUSE). Precedence:
//   1. an abort marker (ledger.abort OR owner.status aborted-resumable) → aborted-resumable
//   2. an escalate-class stop_reason → escalated (even if the owner still reads running:
//      the escalation is the anchor, not the liveness)
//   3. owner.status running → held ⇒ live-running REFUSE, stale ⇒ dead-running
//   4. otherwise → done-clean REFUSE
// Returns { reEnterable, state, refuseReason? }.
function classifyReEnterable(ledger, opts) {
  const held = !!(opts && opts.held);
  const owner = (ledger && ledger.owner) || null;
  const abortMarker = !!(ledger && ledger.abort && typeof ledger.abort === "object");
  const ownerAborted = !!(owner && owner.status === "aborted-resumable");
  if (abortMarker || ownerAborted) return { reEnterable: true, state: "aborted-resumable" };
  if (isEscalateStopReason(ledger && ledger.stop_reason)) return { reEnterable: true, state: "escalated" };
  if (owner && owner.status === "running") {
    if (held) {
      return { reEnterable: false, state: "live-running",
        refuseReason: "the run's owner is running with a fresh heartbeat — a second driver would race it; refusing (resume only a dead/aborted/escalated run)" };
    }
    return { reEnterable: true, state: "dead-running" };
  }
  return { reEnterable: false, state: "done-clean",
    refuseReason: "the run is not in a re-enterable state (no abort marker, no escalate-class stop_reason, not a stale-heartbeat running run) — nothing to resume (see `faff disposition`)" };
}

// PURE: reconstruct the per-issue resume plan (spec §4 step 4). `evidenceByIssue` is a
// map { issue -> { reconcile, resumeStore, awaitingReview, buildComplete, branchExists,
// wipCommit } } the impure shell gathered:
//   reconcile      — for a shipped issue: the reconcileShipped divergence object, or null
//                    (proven merged). Absent ⇒ the shell computes it here from recorded/
//                    observed if those are present, else fail-closed to a divergence.
//   resumeStore    — a `.faff/resume/<issue>/` store exists (FAFF-403 review hold)
//   awaitingReview — the issue carries the faff-awaiting-review label
//   buildComplete  — a build-progress.json with build.status complete
//   branchExists   — the recorded pushed branch resolves on the forge
//   wipCommit      — the ledger.abort.wip_commit names this issue (informational)
// Returns the ResumePlan record.
function reconstructResumePlan(ledger, evidenceByIssue) {
  const admitted = Array.isArray(ledger && ledger.admitted) ? ledger.admitted : [];
  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object" && !Array.isArray(ledger.outcomes)) ? ledger.outcomes : {};
  const ev = evidenceByIssue || {};
  const plan = { skip: [], continue_review: [], continue_from_push: [], redispatch: [], park: [], terminal: [], drain_remainder: true };

  for (const issue of admitted) {
    const outcome = outcomes[issue];
    const e = ev[issue] || {};
    if (outcome === "shipped") {
      // Skip is granted ONLY on a reconcile-proven merge; every divergence parks the
      // issue (excluded from dispatch) while the rest of the run resumes — never re-merge.
      const divergence = resolveShippedDivergence(issue, e);
      if (divergence == null) plan.skip.push(issue);
      else plan.park.push({ issue, divergence });
      continue;
    }
    if (TERMINAL_NON_SHIPPED.has(outcome)) { plan.terminal.push(issue); continue; }
    // No terminal outcome recorded: the issue was in flight when the run died.
    if (e.resumeStore || e.awaitingReview) { plan.continue_review.push(issue); continue; }
    if (e.buildComplete) {
      if (e.branchExists) plan.continue_from_push.push(issue);
      else plan.park.push({ issue, divergence: { class: "recorded-branch-missing", issue, detail: "build-complete checkpoint names a pushed branch that no longer resolves on the forge" } });
      continue;
    }
    // Admitted, no checkpoint → coarse rebuild (announced; the pre-push granularity gap).
    plan.redispatch.push(issue);
  }
  return plan;
}

// PURE helper: a shipped issue's divergence, fail-closed. Prefer a pre-computed
// `reconcile` verdict; else derive it from recorded/observed via reconcileShipped; a
// shipped claim with neither is `claimed-shipped-unmerged` (unprovable ⇒ divergence).
function resolveShippedDivergence(issue, e) {
  if (e && Object.prototype.hasOwnProperty.call(e, "reconcile")) return e.reconcile; // null = proven merged
  if (e && (e.recorded !== undefined || e.observed !== undefined)) {
    return reconcileShipped({ issue, recorded: e.recorded ?? null, observed: e.observed ?? {} });
  }
  return { class: "claimed-shipped-unmerged", issue, detail: "shipped claim with no merge evidence available at resume" };
}

// PURE: the additive ledger mutation a re-entry writes (spec §4 step 5). Returns a NEW
// ledger object (never mutates the input):
//   - old owner → owner_history (append-only)
//   - new owner { status:running, epoch: prior+1 (absent⇒0), session_id, pid, started_at,
//                 last_heartbeat } — the owner-epoch write fence anchor
//   - ledger.abort (if any) → abort_history; abort deleted
//   - stop_reason cleared (it described the PRIOR epoch; history keeps it)
//   - resume[] append { epoch, resumed_at, session_id, prior_state, plan_summary }
//   - budget.sessions (when supplied) replaces the block's sessions array
function applyResumeToLedger(ledger, ctx) {
  const src = ledger && typeof ledger === "object" ? ledger : {};
  const nowIso = ctx.nowIso;
  const priorOwner = src.owner || null;
  const priorEpoch = Number((priorOwner && priorOwner.epoch) || 0);
  const epoch = priorEpoch + 1;

  const next = { ...src };
  // owner history (append-only)
  next.owner_history = Array.isArray(src.owner_history) ? src.owner_history.slice() : [];
  if (priorOwner) next.owner_history.push(priorOwner);
  // new owner block (the epoch fence token)
  next.owner = {
    status: "running",
    epoch,
    session_id: ctx.sessionId ?? null,
    pid: ctx.pid ?? null,
    started_at: nowIso,
    last_heartbeat: nowIso,
  };
  // abort → abort_history, then clear
  next.abort_history = Array.isArray(src.abort_history) ? src.abort_history.slice() : [];
  if (src.abort && typeof src.abort === "object") next.abort_history.push(src.abort);
  delete next.abort;
  // clear the prior epoch's stop_reason (history retains it via owner_history + events)
  delete next.stop_reason;
  // resume ledger entry (append-only)
  const plan = ctx.plan || {};
  next.resume = Array.isArray(src.resume) ? src.resume.slice() : [];
  next.resume.push({
    epoch,
    resumed_at: nowIso,
    session_id: ctx.sessionId ?? null,
    prior_state: ctx.priorState,
    plan_summary: {
      skipped_shipped: (plan.skip || []).slice(),
      redispatched: (plan.redispatch || []).slice(),
      rebuilt_coarse: (plan.redispatch || []).slice(),
      parked_divergent: (plan.park || []).map((p) => p.issue),
    },
  });
  // budget session-accumulation (shape (a)) — replace the block's sessions when supplied
  if (ctx.budgetSessions !== undefined) {
    next.budget = { ...(src.budget && typeof src.budget === "object" ? src.budget : {}), sessions: ctx.budgetSessions };
  }
  return { ledger: next, epoch };
}

// PURE: the run-resume event record (spec §3). Continues the caller-supplied seq; the
// shell writes it to events.jsonl. Top-level epoch/prior_state/skipped_shipped/
// rebuilt_coarse are tolerated by eventViolations (unknown top-level keys pass; only the
// envelope + type/phase are validated), and `run-resume` is a registered event type.
function runResumeEvent(runId, seq, nowIso, priorState, plan) {
  return {
    schema: 1, run_id: runId, seq, ts: nowIso, phase: "run", type: "run-resume",
    epoch: plan.epoch,
    prior_state: priorState,
    skipped_shipped: (plan.skip || []).slice(),
    rebuilt_coarse: (plan.redispatch || []).slice(),
  };
}

// PURE: the human-facing re-entry banner. Names the epoch, the prior state, every plan
// bucket, and (when present) the surfaced-but-never-applied Sentry wip_commit.
function renderResumeBanner(runId, priorState, epoch, plan, wipCommit) {
  const L = [];
  L.push(`══ L4 RE-ENTRY — ${runId} ══`);
  L.push(`  epoch ${epoch} · prior state: ${priorState}`);
  L.push(`  skip (proven shipped):        ${plan.skip.length ? plan.skip.join(", ") : "—"}`);
  L.push(`  continue @ review:            ${plan.continue_review.length ? plan.continue_review.join(", ") : "—"}`);
  L.push(`  continue @ pushed-branch:     ${plan.continue_from_push.length ? plan.continue_from_push.join(", ") : "—"}`);
  L.push(`  re-dispatch (coarse rebuild): ${plan.redispatch.length ? plan.redispatch.join(", ") : "—"}`);
  L.push(`  park (divergent, needs-human):${plan.park.length ? " " + plan.park.map((p) => `${p.issue} [${p.divergence && p.divergence.class}]`).join(", ") : " —"}`);
  if (plan.terminal && plan.terminal.length) L.push(`  terminal (kept, not touched): ${plan.terminal.join(", ")}`);
  if (plan.redispatch.length) L.push(`  ⚠ coarse rebuild: ${plan.redispatch.length} in-flight issue(s) died pre-push and re-dispatch from scratch (unpushed WIP is not recoverable — never durable).`);
  if (wipCommit) L.push(`  ⓘ Sentry wip_commit ${wipCommit} is surfaced only — never auto-applied to any worktree.`);
  L.push(`  drain_remainder: ${plan.drain_remainder} — after the admitted set settles, admitting continues from the queue under this run.`);
  return L.join("\n");
}

// In-memory selftest of the pure cores over synthetic fixtures — the classification
// table, the reconstruction buckets (skip-shipped / no-double-merge park / redispatch /
// continue paths), the ledger-apply additions, and the event/banner shape.
function resumeSelftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`resume --selftest FAIL: ${label}\n`); failed++; } };

  // --- classifyReEnterable ---
  check("abort marker → aborted-resumable",
    classifyReEnterable({ abort: { status: "aborted-resumable" }, owner: { status: "aborted-resumable" } }, { held: false }).state === "aborted-resumable");
  check("owner aborted-resumable (no abort entry) → aborted-resumable",
    classifyReEnterable({ owner: { status: "aborted-resumable" } }, {}).state === "aborted-resumable");
  check("escalate-class stop_reason → escalated",
    classifyReEnterable({ owner: { status: "running" }, stop_reason: "budget-escalated(tokens)" }, { held: true }).state === "escalated");
  check("product-incomplete stop_reason → escalated",
    classifyReEnterable({ stop_reason: "product-incomplete" }, {}).state === "escalated");
  const dead = classifyReEnterable({ owner: { status: "running" } }, { held: false });
  check("running + stale heartbeat → dead-running (re-enterable)", dead.state === "dead-running" && dead.reEnterable === true);
  const live = classifyReEnterable({ owner: { status: "running" } }, { held: true });
  check("running + fresh heartbeat → live-running REFUSE", live.state === "live-running" && live.reEnterable === false);
  const done = classifyReEnterable({ owner: { status: "done" }, admitted: ["A"], outcomes: { A: "shipped" } }, {});
  check("terminal owner, all shipped → done-clean REFUSE", done.state === "done-clean" && done.reEnterable === false);

  // --- reconstructResumePlan: skip-shipped (proven) + no-double-merge (divergence parks) ---
  const led = { admitted: ["A", "B", "C", "D", "E", "F"], outcomes: { A: "shipped", B: "shipped", C: "parked" } };
  const ev = {
    A: { reconcile: null },                                                   // proven merged → skip
    B: { reconcile: { class: "phantom-merge", issue: "B", detail: "x" } },     // divergence → park
    // C terminal-non-shipped → kept
    D: { resumeStore: true },                                                  // review hold → continue_review
    E: { buildComplete: true, branchExists: true },                            // pushed → continue_from_push
    F: { buildComplete: true, branchExists: false },                           // branch gone → park
  };
  const plan = reconstructResumePlan(led, ev);
  check("shipped+proven → skip", plan.skip.length === 1 && plan.skip[0] === "A");
  check("shipped+divergence → park (no double-merge)", plan.park.some((p) => p.issue === "B" && p.divergence.class === "phantom-merge"));
  check("terminal-non-shipped kept, not dispatched", plan.terminal.includes("C") && !plan.redispatch.includes("C") && !plan.skip.includes("C"));
  check("review-hold → continue_review", plan.continue_review.includes("D"));
  check("pushed-branch present → continue_from_push", plan.continue_from_push.includes("E"));
  check("pushed-branch missing → park (recorded-branch-missing)", plan.park.some((p) => p.issue === "F" && p.divergence.class === "recorded-branch-missing"));
  check("drain_remainder true", plan.drain_remainder === true);

  // admitted-no-checkpoint → coarse redispatch; shipped-no-evidence → fail-closed park
  const led2 = { admitted: ["G", "H"], outcomes: { H: "shipped" } };
  const plan2 = reconstructResumePlan(led2, { G: {} });
  check("admitted, no checkpoint → redispatch (coarse)", plan2.redispatch.includes("G"));
  check("shipped, no evidence → fail-closed park", plan2.park.some((p) => p.issue === "H" && p.divergence.class === "claimed-shipped-unmerged"));

  // reconcile derived from recorded/observed (sha match vs phantom)
  const plan3 = reconstructResumePlan({ admitted: ["S"], outcomes: { S: "shipped" } },
    { S: { recorded: { pr: 1, head_sha: "abc", merged: true }, observed: { pr_merged: true, merged_head_sha: "abc" } } });
  check("shipped, recorded/observed sha match → skip", plan3.skip.includes("S"));
  const plan4 = reconstructResumePlan({ admitted: ["S"], outcomes: { S: "shipped" } },
    { S: { recorded: { pr: 1, head_sha: "abc", merged: true }, observed: { pr_merged: true, merged_head_sha: "def" } } });
  check("shipped, recorded/observed sha mismatch → phantom-merge park", plan4.park.some((p) => p.divergence.class === "phantom-merge"));

  // --- applyResumeToLedger: additive, epoch++, abort→history, stop_reason cleared ---
  const before = {
    run_id: "R", admitted: ["A"], outcomes: { A: "shipped" },
    owner: { status: "aborted-resumable", session_id: "old-sid", epoch: 0, started_at: "t0" },
    abort: { status: "aborted-resumable", signal: "budget-breach", wip_commit: "deadbee" },
    stop_reason: "sentry-abort",
    budget: { envelope: { ceilings: {} }, tokens_at_start_by_model_class: { m: { input: 1, output: 0, cache_write: 0, cache_read: 0 } } },
  };
  const beforeSnapshot = JSON.stringify(before);
  const { ledger: after, epoch } = applyResumeToLedger(before, {
    nowIso: "t1", sessionId: "new-sid", pid: 42, priorState: "aborted-resumable", plan,
    budgetSessions: [{ session_id: "old-sid", baseline_by_model_class: {}, closed_delta_by_model_class: { m: { input: 5, output: 0, cache_write: 0, cache_read: 0 } }, closed_at: "t1", close_source: "transcript" }, { session_id: "new-sid", baseline_by_model_class: {}, closed_delta_by_model_class: null, closed_at: null, close_source: null }],
  });
  check("input ledger not mutated (pure)", JSON.stringify(before) === beforeSnapshot);
  check("epoch incremented 0→1", epoch === 1 && after.owner.epoch === 1);
  check("new owner stamps resuming session + running", after.owner.session_id === "new-sid" && after.owner.status === "running" && after.owner.pid === 42);
  check("old owner pushed to owner_history", after.owner_history.length === 1 && after.owner_history[0].session_id === "old-sid");
  check("abort moved to abort_history + cleared", after.abort === undefined && after.abort_history.length === 1 && after.abort_history[0].wip_commit === "deadbee");
  check("stop_reason cleared", after.stop_reason === undefined);
  check("resume entry appended with plan_summary", after.resume.length === 1 && after.resume[0].epoch === 1 && after.resume[0].prior_state === "aborted-resumable" && after.resume[0].plan_summary.skipped_shipped[0] === "A");
  check("budget.sessions written, envelope retained", Array.isArray(after.budget.sessions) && after.budget.sessions.length === 2 && after.budget.envelope != null);

  // second resume appends (epoch 1→2, history grows) — repeated re-entry, no cap
  const { ledger: after2, epoch: e2 } = applyResumeToLedger(after, { nowIso: "t2", sessionId: "sid3", pid: 7, priorState: "dead-running", plan });
  check("repeated resume: epoch 1→2, owner_history grows, resume[] appends",
    e2 === 2 && after2.owner.epoch === 2 && after2.owner_history.length === 2 && after2.resume.length === 2);

  // pre-527 ledger (no epoch anywhere) resumes to epoch 1 (default-0 convention)
  const { epoch: e0 } = applyResumeToLedger({ run_id: "R2", admitted: [], outcomes: {}, owner: { status: "running", session_id: "s" } }, { nowIso: "t", sessionId: "n", pid: 1, priorState: "dead-running", plan: reconstructResumePlan({ admitted: [] }, {}) });
  check("pre-527 ledger (no epoch) → epoch 1", e0 === 1);

  // --- runResumeEvent + banner shape ---
  const evt = runResumeEvent("R", 3, "t1", "aborted-resumable", { epoch: 1, skip: ["A"], redispatch: ["G"] });
  check("run-resume event carries epoch/prior_state/skipped_shipped/rebuilt_coarse + continues seq",
    evt.type === "run-resume" && evt.seq === 3 && evt.epoch === 1 && evt.prior_state === "aborted-resumable" && evt.skipped_shipped[0] === "A" && evt.rebuilt_coarse[0] === "G");
  const banner = renderResumeBanner("R", "aborted-resumable", 1, plan, "deadbee");
  check("banner names run, epoch, coarse-rebuild warning, and wip_commit surface-only",
    banner.includes("RE-ENTRY — R") && banner.includes("epoch 1") && banner.includes("coarse rebuild") && banner.includes("deadbee") && banner.includes("never auto-applied"));

  if (failed) return 1;
  console.log("resume --selftest: ok");
  return 0;
}

module.exports = {
  RE_ENTERABLE_STATES, RESUME_REFUSAL_STATES, TERMINAL_NON_SHIPPED,
  applyResumeToLedger, classifyReEnterable, reconstructResumePlan, renderResumeBanner,
  resolveShippedDivergence, resumeSelftest, runResumeEvent,
};
