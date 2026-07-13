# FAFF-258 — Reconcile every delegated/autonomous prep return against attach ground truth

> Spec: faffter-dark-nlspec · 2026-07-10 · autonomous · confidence: high. Full spec on Linear FAFF-258.

This is the design spec for FAFF-258. Audience: the build agent implementing the fix, and the human reviewers gating it. It extends the FAFF-178 same-turn-attach guard from the interactive-only Stop-hook to the delegated/autonomous prep boundary, where a prep flow can emit its terminal token and end before the hook fires.

## 1. WHY — Problem and Principles

**The load-bearing model.** FAFF-178's guard is a *session/turn-end* Stop-hook (`faff prepcheck --hook`) that reads an externalised marker `.faff/prep/<ISSUE>.json` and blocks session-end when a spec was `spec_produced:true` but `attached:false`. That backstop only bites the session whose turn is ending. When beep-boop delegates prep — the prep flow runs to a terminal token and *returns* rather than ending the orchestrator's turn — the hook does not reliably gate that boundary, so a produced-but-unattached spec slips through and the orchestrator silently absorbs the gap. The fix moves the guarantee from "a hook that happens to fire at turn-end" to "the orchestrator mechanically reconciles every prep return against attach ground truth before it records the ledger" — exactly the isolation floor builds already have.

**Problem statement.** Interactive prep is guarded by the prepcheck Stop-hook; delegated/autonomous prep is not. In `run-20260626-220907-beepboop-full`, 3 of 6 prep flows produced a spec but returned without completing the attach chain (stamp → validate → `save_comment` → marker-flip → Todo), leaving a dropped spec the orchestrator has to reconcile by hand. Two needed orchestrator hand-attach, one self-completed only because the hook coincidentally fired. A missed reconciliation is a lost spec.

**Design principles.**

- **Transport-agnostic.** The fix must not depend on *how* prep is delegated. Today beep-boop's prep-queue drain invokes prep via the Skill tool inline (per `faff-beep-boop/SKILL.md`); a whole-prep isolated-subagent dispatch is a separate, unticketed deferred sibling (see OUT OF SCOPE). The reconciliation and the verification primitive must hold whether prep runs inline, under a producer-subagent (FAFF-372), or under a future whole-prep subagent. Motivation is the observed drop, not a specific transport.
- **Ground truth, never the transcript.** Reconciliation reads on-disk artifacts (the attach marker) and the tracker (spec-discovery), never the delegated flow's returned narration — mirroring the build floor's "reconcile the token against `.faff/runs/<run-id>/ISSUE-XX/` + git, never the subagent transcript" rule.
- **Mechanism as braces, prose as belt.** FAFF-178 already proved a prose "attach same-turn" rule fails silently. The primary guard is therefore mechanical (a deterministic CLI verdict the orchestrator pipes); the prep-side "don't return unattached" prose is a secondary belt, never the sole guard.
- **Recovery is idempotent.** A recovery attach must be tracker-idempotent — spec-discovery first, attach only if absent — so a marker-flip that failed *after* a successful `save_comment` never double-posts the spec.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` (`cmdPrepcheck` ~L1447–1708) | Node (CLI) | Hosts the current global/hook prepcheck; the new single-issue mode is added here |
| `plugin/skills/faff/bin/faff` (`cmdRuncheck`, `runIsOwned`/`runIsHeld` ~L1069–1322) | Node (CLI) | The owner-audit + optional-`RUN_DIR`-positional + exit-code shape this mode mirrors |
| `plugin/skills/faff-beep-boop/SKILL.md` (prep-queue drain ~L133–166; build isolation floor ~L430) | Skill prose | Where orchestrator-side prep reconciliation is specified, mirroring the build floor |
| `plugin/skills/faff-prep/SKILL.md` (marker contract ~L75–96; autonomous returns ~L328–419) | Skill prose | Where the return-contract belt is tightened |
| `test/prepcheck.test.mjs`, `test/runcheck-gate.test.mjs` | Node `--test` | The gate-table test template the new mode's coverage follows |

**Scope statement.** This sits at the orchestrator↔prep delegation seam in the L3/L4 autonomous pipeline — the reliability floor that keeps an unattended run from silently losing a produced spec.

## 2. OUT OF SCOPE

- **Whole-prep isolated-subagent dispatch** — designing/building the mechanism that runs the *entire* prep flow (not just its producer, FAFF-372) as an isolated subagent with a `PrepDispatch`/terminal-token contract. That deferred sibling is unticketed; this fix is deliberately independent of it. *Extension point:* when it lands, its terminal-token contract reuses the same `faff prepcheck --issue` verdict and the same orchestrator reconciliation defined here — wire it, do not re-invent it. *(faff-beep-boop/SKILL.md prep-drain prose; the "Prep-producer isolation is a deferred sibling" note.)*
- **Changing the interactive Stop-hook behaviour** — the global `faff prepcheck --hook` scan (owning-session backstop, FAFF-250 owner liveness) is unchanged. The new single-issue mode is additive. *Extension point:* `cmdPrepcheck` argument dispatch in `bin/faff`.
- **The build-side isolation floor** — already shipped; this only imports its *shape* for prep. *Extension point:* n/a.
- **Provenance/actor-attribution hardening** — spoofable-signal concerns (FAFF-373 corrective-integrity) are a different guardrail; this fix trusts its own-run on-disk marker + tracker as ground truth and does not add cryptographic integrity. *Extension point:* `faff corrective-integrity`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Attach marker | `.faff/prep/<ISSUE>.json` — the externalised produced/attached state prep writes (FAFF-178/250) |
| Terminal outcome | The value autonomous prep returns: `refreshed` \| `promoted` \| `promoted-needs-review` \| `ineligible` \| `parked` \| `errored` |
| Attach-expecting outcome | An outcome that asserts a spec was attached: `refreshed` \| `promoted` \| `promoted-needs-review` |
| Reconciliation | The orchestrator's mechanical check of a prep return's claimed outcome against marker + tracker ground truth, before recording the ledger bucket |

**The single-issue prepcheck verdict (new CLI mode).**

```
COMMAND: faff prepcheck --issue <ISSUE> [--run-dir DIR] [--json]

READS: .faff/prep/<ISSUE>.json  (only this file — not the global scan)

VERDICT ENUM (state):
  attached   # spec_produced:true AND attached:true
  parked     # disposition:"parked"  (attach not expected — a by-design non-attach)
  open       # spec_produced:true AND attached:false AND no park disposition  → the FAFF-258 drop
  missing    # no marker file for this issue
  malformed  # marker present but unparseable / missing required keys

JSON payload (with --json):
  { issue, state, spec_produced, attached, disposition,
    owner: {session_id?, run_dir?, pid?}, ts,
    owner_matches_run: bool|null }   # null when --run-dir omitted or owner.run_dir absent

EXIT MAP (mirrors `runcheck RUN_DIR` report discipline — 0 clean / non-zero attention):
  0  → attached | parked           (terminal-consistent; safe to record the matching bucket)
  1  → open                        (produced-but-unattached — orchestrator must recover)
  2  → missing | malformed         (indeterminate — orchestrator disambiguates via returned outcome + tracker)
```

**Design decision — exit-coded report, not a hook payload.** The global hook mode blocks via a stdout `{decision:"block"}` payload with a constant exit 0 (a Stop-hook contract). The single-issue mode is an *orchestrator-consumed report*, so it uses exit codes like `runcheck RUN_DIR` does. **Chosen:** add single-issue mode as an exit-coded report path in `cmdPrepcheck`, gated on `--issue`; leave `--hook` untouched.

**Design decision — where the fix lives.** The ticket asks: beep-boop prose, faff-prep contract, or a new mechanical guard? **Chosen:** all three, layered — (a) the new `faff prepcheck --issue` primitive is the mechanical ground-truth read; (b) beep-boop's prep-drain gains a mandatory reconciliation step that pipes it (primary guard, mirroring the build floor); (c) faff-prep's autonomous return-contract gains a self-verify belt. Rationale: FAFF-178 showed prose-only fails silently, so the mechanism (a+b) is load-bearing; (c) is defence-in-depth, cheap, and catches the drop one step earlier.

**Design decision — is orchestrator-side reconciliation mandatory regardless?** The ticket's open question. **Chosen:** yes, mandatory and unconditional. It is the build floor's invariant applied to prep: no prep return is trusted into the ledger without a ground-truth check. Making it conditional would reintroduce exactly the silent-absorb gap.

## 4. HOW — Behaviour

### 4a. The single-issue primitive (`bin/faff`)

Behaviour summary: read one issue's marker and classify it into the five-state verdict with the exit map above — a pure marker reader, no tracker call (the pure-function CLI invariant; the tracker read lives in the orchestrator).

```
PROCEDURE prepcheck_issue(issue, run_dir?):
  1. path := .faff/prep/<issue>.json   (respect --root like the global mode)
  2. IF not exists(path): return state=missing, exit 2
  3. m := parse(path);  IF parse fails OR missing {spec_produced}: return state=malformed, exit 2
  4. owner_matches_run := (run_dir AND m.owner.run_dir) ? (run_dir == m.owner.run_dir) : null
  5. IF m.disposition == "parked":            return state=parked,   exit 0
  6. IF m.spec_produced AND m.attached==true:  return state=attached, exit 0
  7. IF m.spec_produced AND m.attached!=true:  return state=open,     exit 1
  8. ELSE (spec_produced not true):            return state=missing,  exit 2  # produced nothing yet
```

Reuse the existing marker-read helpers (`readPrepMarkers`/`isPrepMarkerOpen` shape) rather than a second parser. Add a `PREPCHECK_ISSUE_SELFTEST_CASES` table (pure, filesystem-free) beside the existing prepcheck selftest tables, and wire `--issue` into `cmdPrepcheck`'s dispatch and the USAGE string.

### 4b. Orchestrator reconciliation (`faff-beep-boop/SKILL.md`, prep-drain)

Behaviour summary: after each prep return, before recording the ledger bucket, reconcile the *claimed* outcome against ground truth; on mismatch, recover idempotently or re-dispatch (bounded), never record a false bucket.

```
PROCEDURE reconcile_prep_return(issue, returned_outcome, returned_artifact?):
  1. v := `faff prepcheck --issue <issue> --run-dir <run_dir> --json`   # marker ground truth
  2. attach_expecting := returned_outcome in {refreshed, promoted, promoted-needs-review}

  3. IF attach_expecting:
       a. IF v.state == attached:
            spec_present := tracker_spec_discovery(issue)   # authoritative confirm (spec-discovery rule)
            IF spec_present: record bucket(returned_outcome); DONE
            ELSE: treat as MISMATCH (marker says attached but no spec on tracker) → step 4
       b. ELSE (v.state in {open, missing, malformed}):  → MISMATCH → step 4

  4. ON MISMATCH (recovery, idempotent, bounded — appetite:high permits autonomous recovery):
       a. spec_present := tracker_spec_discovery(issue)
          IF spec_present:                       # save_comment landed; only marker-flip/Todo lost
             ensure Todo; flip marker attached:true; record bucket(returned_outcome); DONE
       b. ELSE IF returned_artifact carries a usable spec body:
             complete attach from it: stamp → validate → save_comment → flip marker → Todo;
             record bucket(returned_outcome); DONE
       c. ELSE (no recoverable artifact):
             re-dispatch prep for <issue> ONCE (recovery_attempts cap = 1);
             on the retry, re-run reconcile_prep_return;
             IF still unresolved after the cap: record outcome=errored, park per protocol; DONE

  5. IF NOT attach_expecting (parked | ineligible | errored):
       # no attach expected; verify the marker does not contradict a claimed non-attach
       IF returned_outcome==parked: expect v.state in {parked, open, missing}  → record parked
       IF returned_outcome in {ineligible, errored}: expect v.state==missing (nothing produced) → record as returned
       A marker state that contradicts (e.g. parked-return but state==attached) is benign over-delivery:
         record the returned bucket and note it in the run log.
```

**Reconciliation reads ground truth only** — `faff prepcheck --issue` (on-disk marker) plus `tracker_spec_discovery` (the shared Spec-discovery rule: tracker comments / description / committed docs). It never parses the delegated flow's narration; the only thing consumed from the return is the structured `{outcome, artifact}` token.

### 4c. Prep-side self-verify belt (`faff-prep/SKILL.md`, autonomous returns)

Behaviour summary: before autonomous/delegated prep emits an attach-expecting terminal outcome, it self-checks the marker; if not `attached`, it must not claim success.

```
PROCEDURE before_autonomous_return(issue, intended_outcome):
  IF intended_outcome in {refreshed, promoted, promoted-needs-review}:
     v := `faff prepcheck --issue <issue> --json`
     IF v.state != attached:
        # the attach chain did not complete — do not emit a false success
        attempt the attach once more inline (stamp→validate→save_comment→flip);
        re-check; IF still != attached: downgrade the return to `errored`
                  so the orchestrator's reconciliation recovers rather than trusting the claim.
```

This is the belt: it turns the FAFF-178 same-turn-attach prose into a mechanically self-checked precondition of the *return value*, not just of the turn-end. The orchestrator's reconciliation (4b) remains the braces regardless.

**Edge cases and error handling.**

- **Marker-flip crash after `save_comment` succeeded** → `v.state==open` but the spec IS on the tracker. Recovery step 4a's spec-discovery finds it → flip marker + record, **no double-post**. (Retryable: yes, idempotently.)
- **`save_comment` genuinely failed** → no spec on tracker, `v.state==open` → recover from returned artifact (4b) or re-dispatch once (4c). (Retryable via the bounded cap.)
- **Marker missing + `promoted` claimed** → hard mismatch (produced nothing but claims success) → recovery: no artifact + no tracker spec → re-dispatch once → errored+park. (Terminal on cap.)
- **Foreign-owned marker** (`owner_matches_run==false`) → another run owns this issue's prep; the orchestrator does not act on it — treat as indeterminate and re-dispatch under its own run only if the issue is genuinely admitted to *this* run (an issue is admitted to exactly one run, so this should not arise; surface loudly if it does). (Terminal: surface, do not silently record.)
- **Recovery cap exceeded** → `errored` + `faff-parked` per the shared park protocol; the run-ledger records `errored`, never a phantom `promoted`.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the tracker spec-discovery read is itself flaky (MCP 5xx), so recovery step 4a can't confirm a landed spec and re-attaches → duplicate spec comment. **How you'd know:** two `> Spec:` provenance-stamped comments on one issue in a run. **What it means:** narrow — make spec-discovery in recovery treat an MCP error as "unknown, do not attach", falling to bounded re-dispatch rather than a blind re-attach (already the safe default in 4b step 4a: attach only on a *confirmed-absent* spec).
- **The failure:** `owner_matches_run` gives false confidence because both `--run-dir` and `owner.run_dir` are absent (unowned legacy marker) → `null`, and the orchestrator acts on a marker it doesn't own. **How you'd know:** a reconciliation touches an issue not in this run's `admitted` set. **What it means:** proceed — gate recovery on `issue ∈ this run's admitted` (the orchestrator already holds that set in the ledger), independent of marker ownership.

**Anti-pattern:** parsing the prep flow's returned prose to decide whether the attach happened. Why: it re-imports the "trust the subagent's self-report" failure the build floor already forbids — reconcile against marker + tracker only.

**Anti-pattern:** making reconciliation conditional (e.g. "only when the return looks suspicious"). Why: the drop is silent by construction; an unconditional check is the whole point.

## 5. Scenarios — born-verifiable main objectives

```
Given a delegated prep flow that produced a spec but returned `promoted` with attached:false on the marker (no spec on the tracker)
When the orchestrator reconciles the return before recording the ledger
Then it does NOT record `promoted`; it recovers the attach (or re-dispatches within the cap) and only records `promoted` once the spec is on the tracker and the marker is attached:true
```

```
Given a marker whose save_comment landed but whose flip crashed (state==open, spec already on the tracker)
When the orchestrator runs recovery
Then spec-discovery finds the existing spec, the marker is flipped to attached:true, the bucket is recorded, and NO second spec comment is posted
```

```
Given `faff prepcheck --issue FAFF-XX` against markers in each of the five states
When the CLI runs
Then it returns state ∈ {attached,parked,open,missing,malformed} with exit ∈ {0,0,1,2,2} respectively, and (with --json) a payload carrying spec_produced/attached/disposition/owner
```

```
Given autonomous prep about to return `promoted` while its marker is attached:false
When the self-verify belt runs before return
Then prep either completes the attach and returns `promoted`, or downgrades its return to `errored` — it never emits `promoted` on an unattached marker
```

## 6. Design Decision Rationale

**Where should the fix live?** Options: (i) beep-boop prose only; (ii) faff-prep contract only; (iii) a new mechanical guard only. Layered (i)+(ii)+(iii) chosen. Prose-only (i/ii) repeats FAFF-178's silent-failure; guard-only (iii) has no consumer wiring. **Chosen:** the primitive is the ground-truth read, beep-boop reconciliation is the mandatory braces, prep self-verify is the belt.

**Report shape for the primitive.** Options: reuse the hook stdout-payload style, or exit-coded like `runcheck RUN_DIR`. **Chosen:** exit-coded report — it is orchestrator-consumed, not a Stop-hook, so exit codes are the natural machine interface and match the existing single-run runcheck precedent.

**Recovery vs park on mismatch.** Options: always park on mismatch; or attempt bounded idempotent recovery first. **Chosen:** bounded idempotent recovery (cap 1) then park — appetite is `high`, recovery is reviewable (the spec ships in the PR / lands on the tracker), and re-dispatch is cheap; an unrecoverable mismatch still parks fail-safe.

**Recovery idempotency source.** Options: trust the marker; or re-confirm via tracker spec-discovery before any re-attach. **Chosen:** tracker spec-discovery first — the marker can lie in the crash-after-save_comment case, and a blind re-attach double-posts. (Mirrors the Linear-502 "re-query before retry" lesson.)

## Already shipped against this surface

Prior Done work on the prep-attach / prepcheck / subagent-isolation surface. None supersedes this ticket's premise — each is a component the fix builds on, not a delivery of the orchestrator-side prep-return reconciliation FAFF-258 asks for.

| Done ticket | What it shipped | Why it does not supersede |
|---|---|---|
| FAFF-178 | The `prepcheck` Stop-hook + attach marker (interactive same-turn attach) | Session/turn-end-scoped only — the exact gap FAFF-258 names for the delegated boundary |
| FAFF-250 | prepcheck owner-liveness (self/foreign marker, FAFF-233 parity) | Owner stamping the fix reuses, but adds no orchestrator-side reconciliation |
| FAFF-192 | `faff hooks-ensure` deterministic hook registration | Registers the hook; unrelated to return reconciliation |
| FAFF-230 | Corrected the "no inline prep" over-statement; named prep-subagent isolation as a deferred sibling | Confirms the whole-prep-subagent mechanism is still deferred/unticketed (this fix is independent of it) |
| FAFF-372 | Dispatch L2 slot *producers* as subagents | Isolated the producer only; its OUT-OF-SCOPE explicitly defers autonomous prep dispatch and adds no reconciliation |
| FAFF-226 | Nested-subagent dispatch spike (validated single-level nesting) | Feasibility precedent, no attach-reconciliation code |

## 7. Open Questions and Assumptions

**Open Questions.** None blocking. (The whole-prep-subagent dispatch mechanism is explicitly deferred, not an open question for this slice — see OUT OF SCOPE.)

**Assumptions.**

- **Assumes:** `.faff/prep/<ISSUE>.json` remains the single attach-state marker location and schema (FAFF-178/250). *Validation:* confirm `readPrepMarkers` still reads that path and the marker shape in `faff-prep/SKILL.md` before building the single-issue reader.
- **Assumes:** the orchestrator holds the run's `admitted` set in the run-ledger and can gate recovery on `issue ∈ admitted`. *Validation:* confirm the ledger schema exposes `admitted` (it does — `faff-beep-boop/SKILL.md` ledger schema).
- **Assumes:** the shared Spec-discovery rule (tracker comments / description / committed docs) is callable by the orchestrator for the recovery confirm. *Validation:* it is the same rule prep uses in Scenario A/B; reuse it.

## 8. DONE — Definition of Done

### From WHY
- [ ] A delegated/autonomous prep return that claims an attach-expecting outcome while its marker is `attached:false` cannot land that bucket in the run-ledger unreconciled (the FAFF-258 drop is closed).

### From WHAT (CLI)
- [ ] `faff prepcheck --issue <ISSUE> [--run-dir DIR] [--json]` exists, reads only `.faff/prep/<ISSUE>.json`, and returns the five-state verdict with exit map 0/0/1/2/2 for attached/parked/open/missing/malformed.
- [ ] `--json` payload carries `{issue, state, spec_produced, attached, disposition, owner, ts, owner_matches_run}`.
- [ ] The global `faff prepcheck --hook` behaviour is byte-unchanged (additive `--issue` dispatch only).
- [ ] USAGE string and a filesystem-free `PREPCHECK_ISSUE_SELFTEST_CASES` table are added; `test/prepcheck.test.mjs` covers all five states end-to-end against fixture roots.

### From HOW (orchestrator reconciliation)
- [ ] beep-boop's prep-drain reconciles every prep return against `faff prepcheck --issue` + tracker spec-discovery before recording the ledger bucket, unconditionally.
- [ ] On mismatch it recovers idempotently (spec-discovery-first, attach only if absent) or re-dispatches once (cap 1), then records `errored`+park if still unresolved — never a phantom success bucket.
- [ ] Recovery is gated on `issue ∈ this run's admitted` set, independent of marker ownership.

### From HOW (prep self-verify belt)
- [ ] Autonomous/delegated prep self-checks `faff prepcheck --issue` before an attach-expecting return; if not `attached` it retries the attach once then downgrades the return to `errored` rather than claiming success.

### From HOW (edge cases)
- [ ] Marker-flip-after-save_comment-crash is recovered without double-posting the spec (spec-discovery finds the existing comment, flips the marker only).
- [ ] An MCP error during recovery spec-discovery is treated as "unknown → do not attach" (falls to bounded re-dispatch), never a blind re-attach.

**Integration smoke test.**

```
1. Seed .faff/prep/FAFF-TEST.json = {spec_produced:true, attached:false} (no tracker spec)
2. Run `faff prepcheck --issue FAFF-TEST --json`  → assert state==open, exit 1
3. Flip marker attached:true; re-run → assert state==attached, exit 0
4. (prose/orchestrator path is verified in test via the reconciliation table, since it drives tracker MCP)
```

confidence: high
