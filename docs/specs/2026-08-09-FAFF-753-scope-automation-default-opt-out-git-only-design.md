# FAFF-753 — Scope automation_default opt-out to git-only; make trackers always opt-in

> Spec: faffter-dark-nlspec · 2026-08-08 · interactive · confidence: high. Full spec on Linear FAFF-753.

This spec addresses **FAFF-753 — "Scope `automation_default` opt-out to git-only; make trackers always opt-in."** It is written for the build agent that will implement the change and for the human reviewers gating it. It touches one pure CLI function (`faff eligible`), one posture-linter check (`faff config check`), the gateway prose that defines automation eligibility, every downstream skill that resolves eligibility (graft, prep, tidy, jot, beep-boop — see the caller census in §4), and two config files.

## 1. WHY — Problem and Principles

**The load-bearing idea:** `opt-out` means two completely different things depending on whether a tracker governs the repo, and today the code conflates them. On a **tracker-bound** repo, the two control labels (`faff-automate` / `faff-automation-hold`) are the intended — and only — way work becomes automatable; `opt-out` short-circuits that by making *every* unlabelled ticket eligible from a single config line, collapsing the "tracker is a safe space" posture. On a **git-only** repo there are no labels at all, so `opt-out` is the *only* lever that can ever turn the autonomous surface on. The fix is to teach the eligibility function that `opt-out` only opens the surface **when there is no tracker** — honoured in git-only, inert under a tracker — so one knob stops having two irreconcilable jobs.

**Problem statement.** Status quo: `automationEligible(labels, default)` returns `default === "opt-out"` for an unlabelled ticket, regardless of whether a tracker is present. Pain: on a tracker repo, `automation_default: opt-out` silently makes the whole backlog auto-eligible, defeating the label-gated safe-space guarantee; but the same line is indispensable in git-only mode. This change scopes `opt-out` to git-only by deriving the git-only-vs-tracker fork from a signal faff already computes, adding **no new config key**.

**Design principles.**

**`faff eligible` stays args-only pure (FAFF-125).** The same labels + same default + same tracker-state must always yield the same decision, testable via `--selftest` with no config or MCP access. The fix therefore adds a new **argument** carrying the tracker signal, resolved by the caller; it must not reach into config or the tracker from inside the function.

**Tracker-vs-git-only has exactly one canonical answer (gateway → Tracker availability resolution).** The whole suite branches on "is a tracker available this session?" through that single rule; eligibility scoping is another instance of that same fork and MUST consume the same answer. A second, divergent notion of "tracker present" invented here would be a bug, not a local override.

**Fail-safe favours the tighter posture.** The shipped default is `opt-in` precisely so a forgotten signal means "left alone." Every ambiguity introduced here (missing argument, garbage value, unknown tracker state) must resolve toward *not* auto-acting — i.e. treat the tracker as present and leave `opt-out` inert — never toward silently opening a surface.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/eligible.js` | JS (Node) | The pure eligibility function + its `--selftest`; single coercion point (L12–17) |
| `plugin/skills/faff/bin/lib/tracker.js` | JS (Node) | `faff tracker probe` / `classifyTracker` — the deterministic tracker-pin read (FAFF-695) |
| `plugin/skills/faff/bin/lib/config.js` | JS (Node) | `automation_default` registry default (L74); `computeConfigCheck` posture linter (L1320) |
| `plugin/skills/faff/SKILL.md` | Markdown | Gateway "Automation eligibility" + "Tracker availability resolution" — the reference prose |
| `plugin/skills/faff-graft/SKILL.md` | Markdown | The literal autonomous eligibility gate (L92–93) that shells `faff eligible` |

**Scope statement.** This sits at the eligibility chokepoint that every autonomous spec/promote/build flows through; it narrows one branch of that decision without touching the label precedence or the chokepoint topology.

## 2. OUT OF SCOPE

- **Live tracker reachability inside `faff eligible`** — excluded because the CLI is MCP-blind by invariant. *Why:* determinism + the FAFF-695 pin/reachability split. *Extension point:* the caller already resolves reachability via the gateway rule and hands the result in as the new argument.
- **Skill-surface "your opt-out is ignored" nudges in jot/tidy/wtf** — beyond the one posture-linter warning this spec adds. *Why:* keeps the change tight; the linter is the deterministic home for the advisory. *Extension point:* the same tracker-pin + `opt-out` condition can be surfaced in those skills' eligibility-context sections later.
- **Auto-migrating existing `.faffrc` files** — no rewrite of anyone's `automation_default`. *Why:* the value's *meaning* changes only on tracker repos, where the old behaviour was the footgun being closed. *Extension point:* `faff config check` reports the now-inert setting rather than mutating it.
- **Changing `faff config get automation_default`'s contract** — it still returns the stored value transparently. *Why:* `config get X` must not return a context-coerced value (see rationale §5). *Extension point:* coercion lives in `faff eligible`, not in `config get`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| tracker-bound repo | A repo where a tracker resolves per the gateway "Tracker availability resolution" rule (pin honoured first, else discovery). Labels are the eligibility control surface. |
| git-only repo | A repo where that rule concludes no tracker. No labels exist; `automation_default` is the sole eligibility lever. |
| tracker-present signal | The boolean the caller passes to `faff eligible` recording which of the two the repo is, this invocation. |

**The eligibility function — new signature.**

```
FUNCTION automationEligible(labels: Set<String>, automationDefault: String, trackerPresent: Bool) -> Bool:
  IF labels has "faff-automation-hold"  -> false     # hard exclude wins, always (unchanged)
  IF labels has "faff-automate"         -> true       # explicit include (unchanged)
  RETURN automationDefault == "opt-out" AND trackerPresent == false   # opt-out opens the surface ONLY in git-only
```

The only changed line is the last: the unlabelled default now additionally requires *no tracker*. `trackerPresent` is compared `== false` deliberately — **only an explicit git-only signal opens the surface**; any other state (true, or the 2-argument legacy call where it is undefined) leaves `opt-out` inert. Hard-exclude > include > default precedence is untouched.

**`faff eligible` CLI — new flag.**

```
faff eligible [--label L]... [--default opt-in|opt-out] [--tracker present|absent]
```

- `--tracker` arity 1, value `present|absent`. Mirrors `--default`'s no-enum fail-safe coercion: `trackerPresent = (value || "present").toLowerCase() != "absent"`. So `absent` ⇒ git-only; **`present`, omitted, or any garbage ⇒ tracker-present (tighter)**.
- Still prints literal `true`/`false` to stdout and always exits 0.

**`faff config check` — new posture finding.** In `computeConfigCheck`, over the merged doc: if `tracking.tracker` is **non-blank after trim** (pinned, by the *same* normalisation `classifyTracker` applies — `tracker.js` L24, where a whitespace-only value is unpinned) AND `automation_default == "opt-out"`, push one `warn` finding: `automation_default: opt-out is ignored on a tracker-bound repo — it applies only in git-only mode; the two faff-* labels are the control surface here.` Read the pin inline with the already-imported `dig(mergedDoc, "tracking.tracker")` — do **not** `require("./tracker")` (config.js is on tracker.js's require path; importing back would risk a circular-require partial export). The inline read **must replicate `classifyTracker`'s trim + blank-string normalisation** (`tracker.js` L24: a whitespace-only value is *unpinned*), so the warn linter and `faff tracker probe` never disagree on the same config — a whitespace-only `tracking.tracker` must be treated as unpinned here too (no warn).

**Design decision — where the coercion lives.**

| Option | Consequence |
|---|---|
| (a) new `--tracker` arg on `faff eligible`; caller resolves | verdict stays deterministic + args-only pure; caller owns the one tracker resolution it already did |
| (b) coerce inside `faff config get automation_default` | breaks the `config get X` contract — it would stop returning the stored X, returning a context-coerced value instead; also still needs tracker state config get shouldn't own |
| (c) agent-prose coercion in the skills | violates deterministic-tools-over-prose (FAFF-125); re-derived per skill, drifts |

**Chosen:** (a) — the `--tracker` argument. It preserves the pure-function property (the tracker state is just another input), keeps a single coercion point, and leaves `config get` transparent. (decides: architecture)

## 4. HOW — Behavior

**Architecture.** The change is a single new input threaded from the one place that knows tracker-vs-git-only (the caller) into the one place that decides eligibility (`faff eligible`). No new resolution logic is created; the caller reuses the tracker-availability answer it already computed for this invocation.

**Who resolves the signal, and how.** The caller resolves tracker presence via the gateway "Tracker availability resolution" rule and maps its outcome to `--tracker present|absent`. In practice the caller already knows by construction: an autonomous graft/prep/jot acting on a *fetched tracker issue* is definitionally tracker-present; a git-only flow operating on a spec in `.faff/specs/` with no issue fetch is `absent`. The rule's deterministic half is `faff tracker probe` (the pin); its discovery half is the harness step the caller already performs — so no *new* MCP work is added.

```
PROCEDURE resolve_tracker_flag(caller_context):
  1. Apply gateway "Tracker availability resolution": pin (faff tracker probe) honoured first, else discovery.
  2. IF a tracker resolves -> "--tracker present"
  3. ELSE (genuine git-only, discovery found none and none pinned) -> "--tracker absent"
```

**The graft call-site (the literal handoff, L92–93).** After reading `default`, graft passes the resolved flag:

```
default=$("$faff" config get automation_default)
verdict=$("$faff" eligible --label "$L1" ... --default "$default" --tracker "$TRACKERFLAG")
```

`$TRACKERFLAG` is `present` on the autonomous tracker-issue path (graft fetched the issue from a tracker) and `absent` on the git-only build path (spec read from `.faff/specs/`). Read STDOUT, never `$?`.

**The full caller census (every site that resolves `faff eligible` must thread `--tracker`).** The gateway names three eligibility chokepoints — **prep, tidy, graft** (`SKILL.md` L401–407: "each chokepoint computes eligibility … via `faff eligible`") — plus `faff-beep-boop`'s queue-side filter (a non-load-bearing efficiency early-exit, same gateway section). Each computes eligibility and must pass the tracker signal; the earlier "tidy is untouched" reading was wrong — tidy resolves `faff eligible` to decide whether to hand `faff next` a `--not-eligible` flag, so it needs `--tracker` like the rest.

| Site | How it uses `faff eligible` | Change |
|---|---|---|
| `faff-graft` L92–93 | literal shell handoff (`--default $(config get …)` → `faff eligible`) | pass `--tracker` (`present` on the tracker-issue path, `absent` on the git-only `.faff/specs/` build path); read STDOUT, never `$?` |
| `faff-prep` L332 | prose eligibility gate | reference the tracker-scoped resolution + pass `--tracker` |
| `faff-tidy` (§4a / `faff next` feed) | resolves `faff eligible` to derive `--not-eligible` for `faff next` | pass `--tracker` when resolving eligibility |
| `faff-jot` L114/L120 | prose shaping-menu eligibility resolve | reference the tracker-scoped resolution + pass `--tracker` |
| `faff-beep-boop` (queue-side filter) | prose re-ground reads feeding `faff next` / `faff eligible` | reference the tracker-scoped resolution + pass `--tracker` |

The build agent must **grep-census `faff eligible` across `plugin/skills` and thread `--tracker` at every resolution** — the DoD makes this an explicit checklist item, because a missed site silently defaults to `--tracker present` and drops that lane's git-only `opt-out` lever (the fail-safe direction, but still a bug for a git-only user of that lane). Only `graft`'s autonomous gate is a mechanical hard-stop; the other sites are prose-level enforcement (the same shape as every other eligibility-chokepoint rule today), so the wiring has no dedicated automated test beyond the pure-function selftest — a known, accepted verification gap recorded here rather than papered over.

**The `--tracker` default when omitted — fail-safe direction.**

**Chosen:** omitted ⇒ `present` (opt-out inert). The dangerous outcome this whole change removes is `opt-out` silently opening a tracker; the absent-argument default must not reintroduce exactly that. A not-yet-updated caller therefore gets the *tighter* behaviour (surface stays off), which matches the shipped `opt-in` fail-safe. The only cost is a hypothetical git-only caller that forgets the flag and loses its opt-out lever — the correct "stay off" direction. Graft, the sole real caller, always passes the flag explicitly. (decides: architecture)

**Silent-coerce vs warn.**

**Chosen:** the mechanical gate (`faff eligible`, `faff config get`) stays **silent** — no stderr noise in the deterministic path — and the advisory lives in `faff config check` as one `warn` finding (see §3). This matches `intake_gate`'s warn-not-block posture (guidance, never a block) while keeping the pure tools quiet. The linter can only see the *pinned* case (it is MCP-blind), which is acceptable and reinforces the pin-your-tracker recommendation below. (decides: product)

**Anti-pattern:** re-reading the tracker state inside `automationEligible`. Why: it would break args-only purity and duplicate the gateway rule the caller already applied.

**Anti-pattern:** `require("./tracker")` from config.js for the new check. Why: config.js is on tracker.js's dependency path; use the already-imported `dig` on the pin key instead.

**Failure modes.**

- **The failure:** the caller mis-resolves an unpinned-but-real tracker as git-only, so `opt-out` stays live and the whole tracker is auto-eligible — the exact hole this closes, reappearing via a wrong signal. *How you'd know:* on a tracker repo running `opt-out`, unlabelled tickets get auto-picked-up; `faff tracker probe` returns `unpinned` there. *What it means:* the gateway rule's discovery half must run before concluding `absent`; and pinning `tracking.tracker` removes the reliance on discovery entirely (why faff's own repo is pinned below).
- **The failure:** faff's own `.faffrc.yaml` uses Linear but does **not** pin `tracking.tracker`, so `faff tracker probe` returns `unpinned` — the deterministic half of the rule would classify the harness's own repo git-only. *How you'd know:* `faff tracker probe` in this repo prints `unpinned` despite the Linear header comment. *What it means:* pin it (below); this is a real gap for any tracker repo that relies on autodetection under `opt-out`.

**The "tracker configured" signal — the load-bearing decision.**

**Chosen:** the signal is the **caller's gateway-rule tracker-availability resolution** (pin honoured first, else discovery), passed as `--tracker present|absent` — *not* the raw `tracking.tracker` pin alone, and *not* mere `tracking:`-block presence. Rationale: (1) It is the one canonical tracker-vs-git-only answer the whole suite already computes, so eligibility agrees with every other tracker/git-only branch by construction. (2) The raw pin alone is insufficient — faff's own tracker-bound repo is *unpinned*, so keying on the pin would silently reopen the whole tracker under `opt-out` for exactly the repos discovery handles correctly. (3) `tracking:`-block presence is rejected because `tracking.repo` / `spec_docs_path` also appear in git-only configs, so it false-positives (a git-only repo with `spec_docs_path` would lose its `opt-out` lever) and is coarser than the canonical rule. (decides: architecture)

**Chosen (consequence for unpinned tracker repos):** also pin `tracking.tracker: linear` in faff's own `.faffrc.yaml`. Not because eligibility needs it (discovery covers it) but because the pin is the *deterministic* half of the rule this guard leans on — pinning removes faff's own repo's dependence on live discovery for a security-relevant gate, enables the `config check` advisory to fire on tracker repos, and models the posture adopters should copy (pin your tracker so the deterministic path carries the guard). (decides: architecture)

**Chosen (dependency posture — the guard leans on the landed pin, not the unlanded discovery half):** scope FAFF-753's *guarantee* to the deterministic pin path (`faff tracker probe`, FAFF-695 — landed) and **relate to FAFF-483, do not block on it.** The gateway rule has two halves: pin-honouring (landed) and unpinned-discovery via the harness-abstraction resolve-connector (FAFF-483 — a large foundational `Todo` epic, verified unlanded: no `resolve-connector` reference exists in the tree). FAFF-753 must not gate on that epic, because the change is **monotonically safe**: on an *unpinned* real-tracker repo under a deferred-tool harness the caller may resolve `--tracker absent` and leave `opt-out` live — but that is *exactly today's behaviour* (opt-out already reopens the whole tracker there), so the change is strictly no-worse on that path and strictly-better on every pinned path. Item 5 pins faff's own repo, so the guard is fully deterministic for faff itself; the `config check` advisory + docs push adopters to pin. When FAFF-483's resolve-connector lands, the unpinned path closes for free with no change here. Add a `relatedTo FAFF-483` link (not `blockedBy`) so the sequencing is visible without falsely gating. (decides: architecture)

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a git-only repo with automation_default: opt-out
When faff eligible runs for an unlabelled ticket with --tracker absent
Then it prints true (opt-out is the only lever and still works)
```

```
Given any repo where the ticket carries faff-automation-hold (also faff-automate)
When faff eligible runs with either --tracker value
Then it prints false — hard-exclude > include > default is unchanged by the tracker signal
```

```
Given a tracker-pinned repo with automation_default: opt-out
When faff config check runs
Then it emits one warn finding that opt-out is ignored on a tracker-bound repo
```

- The `faff eligible` verdict is a pure function of `(labels, default, trackerPresent)` — identical inputs give identical output under `--selftest`, no config/MCP access.

## 5. DESIGN DECISION RATIONALE

**Where does the tracker-scoping coercion live?** Options weighed in §3. **Chosen:** a new `--tracker` argument on `faff eligible` — preserves args-only purity, single coercion point, leaves `config get` transparent. Rejected (b) config-get coercion (breaks the transparent-getter contract) and (c) prose coercion (non-deterministic, drifts).

**What is the exact "tracker configured" signal?** **Chosen:** the caller's gateway-rule resolution passed as `--tracker present|absent`. Rejected the raw pin (faff's own tracker repo is unpinned → would reopen the tracker) and `tracking:`-block presence (false-positives on git-only repos with `repo`/`spec_docs_path`). Full rationale in HOW.

**What does an omitted `--tracker` mean?** **Chosen:** `present` (opt-out inert) — the tighter, fail-safe direction consistent with the shipped `opt-in` default; a forgotten signal must not reopen a surface.

**Should faff's own `.faffrc.yaml` pin the tracker?** **Chosen:** yes, `tracking.tracker: linear` — makes the deterministic half of the rule carry the guard for the harness's own repo and models the adopter posture. At the time of writing faff's repo uses Linear via autodetection with no pin.

**Silent-coerce or warn on inert opt-out?** **Chosen:** silent mechanical gate + one `faff config check` warn finding, matching `intake_gate`'s warn-not-block posture.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — all decisions above are closed.

**Assumptions.**

- **Assumes:** the gateway "Tracker availability resolution" rule (`plugin/skills/faff/SKILL.md`) is the authoritative tracker-vs-git-only source callers already apply. Its pin half (FAFF-695) is landed and is the half this guard leans on; the unpinned-discovery half (FAFF-483 resolve-connector) is verified unlanded and is handled by the dependency-posture **Chosen** above (relate, not block; guarantee scoped to the pin). No `blockedBy` link — a `relatedTo FAFF-483` link instead. *Validate:* none outstanding; the block-vs-relate call is closed.
- **Assumes:** the caller census in §4 (graft literal handoff; prep / tidy / jot / beep-boop prose eligibility resolutions) is complete. *Validate:* `grep -rn "faff eligible" plugin/skills` at build time and confirm every resolution threads `--tracker` — this is the DoD census item, the load-bearing check against a silently-missed lane.

## 7. DONE — Definition of Done

### From WHY
- [ ] On a tracker-bound repo, `automation_default: opt-out` no longer makes unlabelled tickets automation-eligible.
- [ ] On a git-only repo, `automation_default: opt-out` still makes unlabelled tickets automation-eligible.

### From WHAT (function + CLI)
- [ ] `automationEligible(labels, default, trackerPresent)` returns `default === "opt-out" && trackerPresent === false` for the unlabelled case; hold/automate precedence unchanged.
- [ ] `faff eligible` accepts `--tracker present|absent` (arity 1); `absent` ⇒ git-only, `present`/omitted/garbage ⇒ tracker-present; still prints `true`/`false`, exits 0.
- [ ] `ELIGIBLE_USAGE` and the region comment (L2–9) updated to describe the tracker term.
- [ ] `faff config check` emits one `warn` when `tracking.tracker` is pinned (non-blank after trim, matching `classifyTracker`) and `automation_default == "opt-out"`, via inline `dig` (no `require("./tracker")`).

### From HOW (behaviour + call-sites)
- [ ] **Caller census closed:** `grep -rn "faff eligible" plugin/skills`, and every eligibility resolution threads `--tracker` — `faff-graft` L92–93 (literal, `present` on the tracker-issue path / `absent` on the git-only `.faff/specs/` path), `faff-prep` L332, `faff-tidy` (its `faff next --not-eligible` feed), `faff-jot` L114/L120, and `faff-beep-boop`'s queue-side filter. No lane left defaulting to `present` unintentionally.
- [ ] `relatedTo FAFF-483` link added to the ticket (not `blockedBy`); the guarantee is scoped to the landed pin path.
- [ ] Gateway "Automation eligibility": pure-function signature (L387), fenced pseudo-code (L389–393), Precedence line (L395), Migration para (L417), Git-only para (L419), and the `.faffrc` schema comment (L177) all state the tracker/git-only split.
- [ ] `.faffrc.example.yaml` (L168–174) `automation_default` comment restates `opt-out` as git-only-only.
- [ ] faff's own `.faffrc.yaml` pins `tracking.tracker: linear` and the L19 comment is consistent.

### From SCENARIOS (selftest)
- [ ] `ELIGIBLE_CASES` restructured to `[[labels, default, trackerPresent], want]` and the runner passes the third arg; log line includes the tracker state.
- [ ] New cases cover the matrix: `(opt-out, present) → false`, `(opt-out, absent) → true`, `(opt-in, present/absent) → false`, `(garbage, absent) → false`, hold-wins and automate-wins under both tracker values, and the legacy `(opt-out, undefined) → false` fail-safe. `--selftest` passes.
- [ ] `config defaults --selftest` still passes (no registry key added/removed).
- [ ] A `config check` selftest case covers the pinned + opt-out warn, **and** a whitespace-only `tracking.tracker` case asserting no warn (the trim/blank normalisation matches `classifyTracker`).

**Integration smoke test.**

```
1. In a repo with tracking.tracker pinned + automation_default: opt-out:
   faff eligible --tracker present               # expect: false
   faff eligible --tracker absent                # expect: true
   faff config check                             # expect: warn finding re: inert opt-out
2. faff eligible --label faff-automate --default opt-in --tracker present   # expect: true (include unaffected)
3. node .../eligible.js --selftest ; node .../config.js config defaults --selftest   # expect: PASS
```

**Build/merge consideration (not a spec blocker).** This tightens autonomous posture by removing a whole-tracker `opt-out` escape, so it is a prose-driven posture change and is **eval-sweep-gated before merge** (per the repo's "eval sweep gates posture changes" convention). Make the eval-sweep gate an explicit merge-checklist item, not a prose "likely." The spec itself is complete; the gating is a merge-time step, not a spec gap.

confidence: high

spec-review: pending

> Revised 2026-08-08 (spec-review iteration 1 → revise): completed the caller census (added tidy / jot / beep-boop alongside graft; corrected the "tidy untouched" claim), resolved the FAFF-483 dependency as relate-not-block with the guarantee scoped to the landed pin path, added the config-check trim/blank normalisation requirement, and recorded the caller-wiring verification gap.

## Methodology critique

**Right-sized?** — Sits inside one 1–3 day unit and holds together. The five spec items converge on a single outcome (scope `automation_default: opt-out` to git-only), and the core is a small change: a boolean predicate gains a third argument, wired at one real call site (faff-graft L92–93), with the rest being selftest/prose/config updates that must ship in lockstep with the behaviour or the docs lie. Two items look nominally independent — the `faff config check` warn finding and pinning `tracking.tracker: linear` in faff's own `.faffrc.yaml`. Neither earns a split: the warn finding is the advisory half of the same posture change (opt-out + pinned tracker), and the rc pin is a one-line fix bundled precisely so faff's own repo can exercise the new git-only-vs-tracker branch (its Linear repo currently probes unpinned). Splitting either would fragment the picture for sub-day tickets. No merge candidate. No action.

**Workstream fit?** — No issues. The ticket lands project-less in Backlog, the correct default landing for newly captured work, not a misplacement. The scope is cohesive around one outcome with no "while-we're-at-it" riders. If a standing autonomous-posture/safety outcome home emerges later it could be rehomed, but conservative bias says leave it loose now and it reads as correctly loose.

**Deps surfaced?** — One implicit dependency to verify. The caller resolves the tracker signal via the gateway "Tracker availability resolution" rule (pin-then-discovery). That rule shipped under FAFF-695, and the resolve-connector step lives in FAFF-483 — so if both are fully landed this is a dependency on existing infrastructure and needs no blocker link. But the graft caller path (L92–93) is load-bearing on that resolution actually being callable at the real call site; if the resolve-connector step in FAFF-483 is not yet live on the path faff-graft takes, that is a real prerequisite with no blocker link today. What to do: confirm the resolution rule is reachable from the faff-graft caller as shipped; if it depends on unlanded FAFF-483 work, add the `blockedBy` link so sequencing stays honest.

**Risk profile?** — No de-risking spike needed, but record the gate rather than leaving it a "likely." The change carries no novel-integration or external-dep risk — it's a pure-function signature change plus one caller. The genuine risk is behavioural: it tightens autonomous posture by removing a whole-tracker opt-out escape, exactly the class held behind the eval sweep before merge. Two things already de-risk it well: the fail-safe default (omitted/garbage ⇒ `present` ⇒ opt-out inert) fails toward the safer, less-autonomous branch, which is the right direction; and the change is small and observable. What to do: make the eval-sweep gate explicit on the ticket (a declared merge gate / checklist item) instead of a prose "likely eval-sweep-gated," so the posture-tightening isn't merged ahead of the sweep by default.