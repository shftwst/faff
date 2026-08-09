# FAFF-332 spike result — can a dispatched build subagent be resumed live (SendMessage) in the autonomous dispatch path?

**Spike ticket:** FAFF-332 · **Timebox:** half-day · **Deliverable:** this doc + a tracker comment · **No production change.**

**Recommendation: NO-GO** — record the FAFF-329/FAFF-402 checkpoint + cold-re-dispatch path as the terminal answer. Do not wire `SendMessage` live-resume into either concurrency executor.

## Evidence tiers used below

To keep "probe ground truth, not documentation" honest, every claim below is tagged:

- **[live-probed]** — observed directly, today, in this spike's own session, with the real `Agent`/`SendMessage` tools.
- **[artifact]** — corroborated by an on-disk artifact from this repo's real run history (`events.jsonl`, `graft.md`), independently re-read during this spike.
- **[reported]** — asserted in the dispatching orchestrator's task brief for this build, describing an incident earlier in this same beep-boop run (`run-20260712-043209-beepboop-full`, FAFF-324). Consistent with, but not fully independently verified against, on-disk artifacts (see Probe A).
- **[shipped-doc]** — cited from a shipped, non-probe SKILL.md that is itself the executor's contract, not this spike's output.

## question_1_context_retention

**Answer: retained, fully and correctly, in both dispatch variants tested.**

Two live probes (nonce + scratch-worktree recall) were run this session, matching the spec's Probe B/C protocol exactly.

**Probe B (foreground dispatch, `run_in_background: false`)** [live-probed]:
1. Dispatched a trivial `general-purpose` subagent with a secret nonce (`faff332-b-6d823fbf5077`) and instructed it to create a scratch git worktree (`git worktree add …/wt-b -b probe332-b-… origin/main`) and reply with only the word `"done"` — never repeating the nonce or the path.
2. The dispatch **returned synchronously** (blocking, 7.2s) with the completed reply `"done"` **and** an `agentId` (`a0f26031b346fb4e7`) in the tool result, with instructions to use `SendMessage` to continue it.
3. `SendMessage` to that `agentId` asked it to recall the nonce and confirm the worktree from memory (not by guessing off `git worktree list` alone).
4. The resumed agent's reply correctly recalled **both**: the exact nonce, and the exact path/branch/commit of the worktree it had created — verified by its own follow-up `git worktree list` call, matching what it recalled creating.

**Probe C (background dispatch, `run_in_background: true`)** [live-probed]: identical protocol, different nonce (`faff332-c-ad9e08b92347`). The initial dispatch returned an async dispatch confirmation (not a completed reply) plus an `agentId`; the agent finished the setup ~8.7s later, delivered as a `task-notification`. `SendMessage` to the same `agentId` again correctly recalled both the nonce and the worktree path/branch/commit, this time after ~70s of the resumed agent's own tool use (list worktrees, search for `SendMessage`, attempt to reply).

**Both probes' scratch worktrees were confirmed intact and unmodified by the resume itself, then cleaned up** (`git worktree remove --force` + `git branch -D`) — verified via `git worktree list` showing no probe artifacts remain.

**Conclusion:** the harness's context-retention promise is real for this workload shape (a single nonce + one shell command). This directly falsifies a *blanket* "resume never works" hypothesis — the primitive functions correctly for a lightweight probe.

## question_2_blocked_dispatcher

**Answer: "live-resume mid-flight" is impossible by construction. The only resume window is after the dispatching Agent call returns — i.e., against an agent the harness already considers *completed*, never a still-running one.**

- [shipped-doc] `faffter-noon-concurrency-sequential/SKILL.md` states the dispatch contract explicitly: builds are launched with **`run_in_background: false`** and the orchestrator **blocks awaiting its terminal token before starting the next** — "The foreground pin is load-bearing, not decorative: background is the tool default, so an omitted posture ends the orchestrator's turn instead of blocking — an idle unattended parent then gets reaped, killing the in-flight build." While that call is outstanding, the dispatcher runs **no other tool**, `SendMessage` included — this is a structural property of a single-threaded, one-tool-call-at-a-time execution model, not a bug to work around.
- [live-probed] Corroborated directly by this spike's own probes: both `SendMessage` calls above only became possible **after** the respective `Agent` dispatch had already returned a result (Probe B: a completed reply; Probe C: a "still running in background" acknowledgement with a resumable `agentId`). There was no tool available to reach into a still-blocking foreground call.
- [artifact] The real FAFF-324 stall this run experienced (`events.jsonl`, `seq:20`→`seq:21`) matches this exactly: the *first* `build-start` for FAFF-324 (`12:23:30Z`) is followed 44 minutes later by a **second** `build-start` event carrying `"resume":"at-review","reason":"prior subagent stalled backgrounding review-call.mjs; adversarial chain outage"` — i.e. the prior subagent's dispatching `Agent` call had already **returned** (turn ended, no terminal token) by the time recovery happened. The stalled agent was a completed agent from the harness's perspective, exactly as the spec's Probe A step 2 predicted.

**Conclusion:** the real question this spike answers is never "resume while blocked" (impossible) — it's "does post-return continuation work, and can its output reach the executor as a usable terminal token." Question 1 answers the first half (yes). Question 4 below answers the second half.

## question_3_executor_composition

**Answer: composes with neither executor today without inventing new machinery, and the sequential executor's own contract makes that new machinery pointless for terminal-token purposes.**

- [shipped-doc] **Sequential executor:** one `Agent` call, blocking, one terminal token per unit — no polling loop, no notification consumption exists in this design today. Wiring live-resume in would require replacing the simple blocking call with a *new* poll/notification-consuming loop, because — per both live probes above — `SendMessage`-resume of a **completed** agent runs asynchronously regardless of the original dispatch mode: Probe B's resume message ("`had no active task; resumed from transcript in the background with your message. You'll be notified when it finishes.`") and Probe C's resume message ("`was stopped (completed); resumed it in the background with your message.`") are effectively identical wording, even though Probe B was originally dispatched foreground and Probe C background. **Resume always drops to background.** There is no way to get a synchronous reply out of `SendMessage`.
- [shipped-doc] **Parallel executor** (`faffter-dark-concurrency-parallel/SKILL.md`) already runs N builds backgrounded and already needed to solve "wait for backgrounded work without ending the turn" — but it solves it by a **foreground poll loop over on-disk state** (the run-ledger `outcomes` + per-issue `.faff/runs/<run-id>/ISSUE-XX/` artifacts), explicitly **not** by consuming agent notifications or parsing transcripts. The machinery a live-resume path would need (a foreground wait loop that doesn't end the turn) already exists in this executor — but it's pointed at disk/git ground truth, not at `SendMessage`.
- [shipped-doc] **The decisive blocker:** the sequential executor's own contract states — "**Reconcile, then record.** Read the unit's `.faff/runs/<run-id>/ISSUE-XX/` artifacts + git ground truth (PR / CI / merge state) and write the terminal outcome to the run ledger yourself — the token is the subagent's *claim*; disk + git are the *truth* on any disagreement... **Never parse the subagent's free-text transcript for the outcome.**" Even in a world where `SendMessage`-resume worked flawlessly and synchronously, the orchestrator is contractually forbidden from trusting the resumed agent's reply as the terminal token — it must independently reconcile against git/disk regardless. A resumed agent's recovered context can inform *its own* next actions, but it can never *replace* the ground-truth read the executor already performs for the cold-re-dispatch path.

**Conclusion:** `agentId` capture could technically be added at the dispatch point in either executor, but doing so buys nothing at the reconciliation step — the terminal-token consumption path is, and per the shipped contract must remain, disk/git reconciliation either way.

## question_4_marginal_win

**Answer: the saving is real but small (skip a fresh-subagent boot); the coupling and reliability cost is high and, per this run's own incident, has already manifested as a worse outcome once. Immaterial against the coupling cost.**

**What the checkpoint path (FAFF-329/402) already gives for free**, per `faff-graft/SKILL.md` Steps 3, 8b, 9: a re-dispatched subagent re-attaches to the pushed branch + `build-progress.json` + `review-progress.json` checkpoints, **skipping** the expensive build and any completed review phase(s) — it re-runs only the cheap gate-ladder re-confirm (Step 7.5, itself a no-op reconciliation against an already-passing state) and whatever review phase was genuinely incomplete. What it still pays: the fresh-subagent skill/spec re-read and worktree recreation from the pushed branch — a real but bounded cost.

**What live-resume would additionally skip:** exactly that fresh-subagent boot — nothing else, since (per question 3) the terminal token still has to come from disk/git reconciliation either way, and the resumed agent still has to re-verify its own state on wake (both probes' resumed agents re-ran `git worktree list` from scratch to *confirm* their memory rather than trusting it blindly — a sensible instinct that erodes much of the "no re-verification cost" appeal).

**What it costs, beyond the new poll/notification machinery in question 3:**

- **Reliability, demonstrated by this run's own incident** [reported, partially corroborated — artifact confirms the stall + eventual cold-re-dispatch-to-completion; the specific resume-attempt-then-re-stall detail below is the dispatching orchestrator's own account of what happened earlier in this run, not independently re-derived from `events.jsonl` by this spike]: during this same beep-boop run, a build subagent building FAFF-324 stalled at the slow adversarial-review step (backgrounded `review-call.mjs`, turn ended with no terminal token) — matching the `events.jsonl` reason string verbatim. The orchestrator reports it used `SendMessage` to resume that subagent; the resume mechanically succeeded (reported message pattern: "resumed from transcript in the background" — **this spike's own Probe B/C independently reproduced byte-for-byte-similar resume wording**, lending real credibility to the report), but the *resumed* agent reportedly re-entered the same background-and-yield pattern and stalled again, with its detached `review-call.mjs` children reparenting to init and becoming unkillable. The clean recovery was the shipped cold-re-dispatch (FAFF-329/402 checkpoint path) — confirmed directly by the `events.jsonl` second `build-start` event and the eventual `shipped` outcome recorded in the run ledger for FAFF-324.
- **This spike's own probes did not reproduce a re-stall** — both nonce/worktree probes resumed and completed cleanly and quickly. That is itself informative, not reassuring: it shows resume works for a *trivial* workload but says nothing about reliability under the *actual* recovery scenario (a heavy, long-running, background-process-laden review call) where the real incident happened. The one time this run needed live-resume for a real stall, it reportedly made the situation *worse* before the deterministic checkpoint path recovered it.
- **No versioned contract.** `SendMessage`/resume semantics are unversioned harness prose, not a faff-owned interface — a working probe today is not a guarantee against silent behavioural drift.

**Marginal-win estimate:** qualitative, per the spec's own allowance ("a reasoned qualitative estimate is acceptable evidence for a spike") — no stalled-run token/latency ledger was at hand beyond the FAFF-324 incident itself, which shows the *opposite* of a win: the live-resume attempt (reported) added a wasted round-trip and orphaned processes on top of the eventual cold re-dispatch, rather than avoiding it.

## Recommendation

**Recommendation: NO-GO**

Applying the spec's decision rule directly:

- Continuation works post-return, in both dispatch variants — ✅ (would support GO in isolation).
- Context is genuinely retained — ✅ (would support GO in isolation).
- **The resumed agent's output can serve as a terminal token — ✗.** Resume is background-only regardless of dispatch mode, so consuming it requires new poll/notification machinery in both executors; and even with that machinery, the sequential executor's shipped contract *forbids* trusting the resumed agent's transcript as the terminal token — reconciliation must still hit disk/git ground truth, identically to the cold-re-dispatch path.
- **The estimated saving is immaterial next to the coupling cost — ✗.** The only thing live-resume would skip beyond the checkpoint path is the fresh-subagent boot; against that, it adds a new harness-coupled poll primitive to both executors, and this run's own incident is a real (if partially self-reported) data point that resuming a heavy stalled workload made recovery *slower*, not faster, versus the deterministic checkpoint path that ultimately shipped it.

Any one NO-GO condition is sufficient per the decision rule; two are met here. **The FAFF-329/FAFF-402 checkpoint + cold-re-dispatch path is recorded as the terminal answer.** No follow-up wiring ticket is filed. This spike's own probe worktrees/branches were all cleaned up (`git worktree remove --force`, `git branch -D`); no probe artifact remains under `~/.faff/worktrees` or in this repo's branch list.
