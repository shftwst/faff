---
name: faff-prep
description: "Turn a vague ticket into something you can actually build — explores the codebase, writes a spec, attaches it to the issue. Trigger for: 'prep ISSUE-XX' / 'prep this' / 'spec this out' / 'what does this ticket need?'."
judgement_seam: reconciliation, prep-architecture-trigger, park-reconsider-classification
---

# Faff — Prep

> **Next step:** `/faff-graft ISSUE-XX` to start building

Turn a vague ticket into something buildable.

Faff-prep is an **orchestrator**: it owns tracker lifecycle and codebase exploration, **always delegates spec production to the `spec` slot** (default `faffter-noon-spec`), gates the result and manages attachment. It never drafts the spec body.

**Methodology lens.** When a `methodology` slot is configured, prep appends a **`## Methodology critique`** block after the spec body (before any chaining gates), per gateway → **The `methodology` slot** (display convention).

## Configuration

**Load the kernel first.** If `faff/references/kernel.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. Do **not** Read `faff/SKILL.md` (the bare-`/faff` routing gateway — a specific-skill entry never needs it). Then Read the lane references prep consumes: `faff/references/tracker.md`, `faff/references/autonomous.md`, `faff/references/methodology.md`, `faff/references/review.md`, `faff/references/park.md`. prep gates on the **fixed spec-readiness contract**; its `spec` slot inherits the gateway ambiently.

### Spec slot (always delegated)

Spec production is **always** delegated to the `spec` slot. The slot defaults to `faffter-noon-spec` (the lite nlspec arc) when `.faff/config.yaml` doesn't set one:

```yaml
slots:
  spec: superpowers:brainstorming   # optional override; unset → faffter-noon-spec
```

Faff-prep passes issue context and explore findings to the configured/default `spec` skill, captures its output and manages tracker attachment. There is no inline spec fallback; the default producer always exists.

**Producer requirements (the slot contract relies on):** the `spec` skill must return a final confidence self-rating (`confidence: high|medium|low`), use the gateway Spec-readiness decision markers, and discharge its own quality bar. For `faffter-noon-spec`, that includes clean-context self-review (its `SKILL.md` → _Self-review before returning_). Prep gates on confidence; downstream `/faff-graft` and `/faff-beep-boop` distinguish closed decisions from open punts by the markers. A producer unable to self-rate is usable interactively, never autonomously; configure one that can (the default does).

## Rendering

All human-facing output, including spec-attach and park **comments** and terminal summaries, passes through the configured `rendering_adaptor` normalise pass **before it is printed or written** (gateway → **Rendering**, Universal-routing rule). Enumerable sets render as lists, never `·`/comma run-on paragraphs. Skill source files and `.faff/` logs are exempt.

## What Prep Produces

A single artifact: the **spec**. It answers two questions:

1. **What to build and why** — design decisions, architecture, interfaces, key technical choices with rationale
2. **How do we know it's done** — acceptance criteria, concrete and testable

The spec is high-level design, not step-by-step code changes, TDD cycles or exact commands. Implementation planning/execution belongs to the implementer (e.g., `superpowers:writing-plans`, `superpowers:subagent-driven-development`, or direct implementation).

**Methodology critique block (rendered only when a `methodology` skill is configured).**

After the main spec body, **request the `issue-critique` output from the configured methodology** by dispatching it as a producer subagent (gateway → **Sibling-skill invocation → Producer dispatch**, resolving the `methodology` dispatch lane; an `engine:<name>` value forks the dispatch to `faff engine call` per that same gateway rule — a named non-zero exit omits the block and surfaces the failure, never a session-model re-dispatch; the named output is defined at gateway → **The `methodology` slot**) — pass the issue + its spec, and render what the lens returns. faff-prep does not impose the critique's shape; the configured methodology decides what it cares about. If the methodology doesn't answer `issue-critique` (e.g. the thematic default), **omit the block**.

For reference, the agile-delivery lens answers `issue-critique` along these axes — right-sized? (principle 4: single 1–3 day unit, or two independent concerns → split; always-ships-together sibling → merge), workstream fit? (principles 1+5: outcome-named and cohesive), deps surfaced? (principle 6: implicit dep with no blocker link), risk profile? (principle 7: novel-integration/external-dep risk → de-risking spike) — each rendered as a full what's-there / why / what-to-do diagnosis when there's something to surface, "No issues" when the check passes. A different methodology returns its own axes.

In autonomous prep (e.g. driven by `/faff-beep-boop`'s prep queue), the critique block is written to the spec but does **not** block confidence-high promotion. It surfaces in the next `/faff-wtf` for the human.

## Spec contract

Every produced or refreshed spec must satisfy the **fixed spec-readiness contract in the gateway** (_Spec readiness (fixed)_): canonical decision markers (`**Chosen:**` / `**Punt:**` / `**Assumes:**`), marker rules, skimmable-not-coded style, confidence and provenance stamp. Pass the contract to the producer and **validate against it before attach via the consumer-fold below**. The retired `spec_adaptor` is replaced by producer-emitted, consumer-parsed conformance. Elsewhere, "_spec contract_" means this gateway contract.

**Validation — the consumer-fold.** faff-prep is the consumer of the producer's `faff-contract:spec-readiness` block. `faff prep attach` runs the fold at stage: it locates the single block, parses it, adds `provenance_present` from the stamp it has just written, and runs the spec-readiness contract, the sole source of contract data. A producer that emitted no block yields `needs-judgement:no-readiness-block`: read the markers and confidence from the spec prose into extraction JSON (`{ confidence, decisions }`, the only surviving LLM seam), write it to a file, and stage again with `--extraction <file>`. Autonomous `invalid` → park; interactive `invalid` → add the missing markers and stage again.

### Stage and attach (`faff prep attach`)

Same-turn attach is a **mechanical guarantee**: `faff prepcheck --hook` blocks session end on a produced-but-not-attached spec, reading the `.faff/prep/<ISSUE>.json` marker that `faff prep attach` writes before any step that can fail. The command also writes the provenance stamp the gateway's _Spec readiness (fixed)_ defines, the retained `build-tier:` line, the retained advisory `admissibility:` line (the `faff admissible --lights-out` result, which never changes the token) and the marker's `spec_sha256`, which graft's `faff spec commit` checks against the posted spec.

- **When.** Stage the instant the `spec` slot returns, before rendering the spec into the conversation, on every attach path: Scenario A, Scenario B refresh or iterate, autonomous Path 1 and Path 2. Stage again before every re-post (a revise round, the retained `spec-review:` line, the methodology critique, a refresh). Stage replaces the stamp and tier lines; it never duplicates them.
- **Stage.** `faff prep attach --issue <ISSUE> --spec <spec-file> --mode interactive|autonomous [--git-only] [--gate-history N] --json`. `--mode` is `autonomous` under the autonomous-mode signal, else `interactive`; `N` is the issue's prior park or needs-human count when prep has it to hand.
- **Confirm.** After `save_comment` returns, `faff prep attach --issue <ISSUE> --confirm --comment-id <returned id> --json`. Confirm re-hashes the staged file and refuses if it changed since stage.
- **Park.** On a by-design park, `faff prep attach --issue <ISSUE> --park --json` records `disposition:"parked"`, so `prepcheck` does not false-block a legitimate non-attach.
- **Promote (interactive).** Before any move to Todo, a human accept included, read `.faff/prep/<ISSUE>.json`: promote only when it reads `attached: true` with an `admissibility` object (otherwise stage, post and confirm again), print its `admissibility`, and when it is refused or names prose scenarios offer revise the scenarios (recommended), promote anyway, or leave in Backlog. The human may promote an inadmissible spec; the retained line records it. Autonomous prep does not act on it.

| Token | Action |
|---|---|
| `ready-to-post` | Post `body_path`'s content byte for byte as the spec comment (never a copy held in context), then confirm with the returned comment id |
| `attached` | Continue (git-only: `.faff/specs/<ISSUE>.md` is written and the marker closed) |
| `invalid` | Interactive: add the missing markers named in `violations` and stage again. Autonomous: park, then the park protocol |
| `needs-judgement:no-readiness-block` | The absent-block fallback above, then stage again with `--extraction` |
| `needs-judgement:git-only-marker-parked` | Run the git-only Unpark contract first; never strip the park by hand |
| `parked` | Park protocol |
| `errored`, or any exit with no parseable token | Interactive: surface the reason. Autonomous: if a marker exists, park and run the park protocol; if none exists (an unreadable spec, or install skew), log the reason to the prep log and return `errored` |

**Stop-hook registration:** the `prepcheck --hook` Stop hook is registered deterministically by **`faff hooks-ensure`** — never hand-edit `settings.json`. On first run, run it (idempotent — a byte-stable no-op when already wired, and it skips the hook if the resolved `faff` can't serve `prepcheck`):

```bash
faff=$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")
"$faff" hooks-ensure
```

## Spec-review gate (approach-critique consumer-fold)

The confidence gate checks internal well-formedness; this gate checks the approach: sound architecture, safety, right-sizing and verifiability. Run it **after** production and confidence rating, **before** promotion to Todo. It **composes** with confidence: both must pass, neither overrides the other.

**Lens selection (the cost-gate, runs first).** Before producer invocation, select lenses and mode. This is **advisory producer-input only**: it never changes the `spec-review-verdict` contract, lens/severity/verdict vocabulary or admission gate. Two halves:

1. **Classify the change-surface (prose, recall-biased).** Derive the surface from the spec's **declared** surface — its WHAT (named files / modules / subsystems), its `**Assumes:**`, and its Reference-context — **reusing the same already-shipped-scan surface-area extraction** the premise-supersede scan already runs (named paths, top-level module/dir names, named subsystems). Do **not** predict the build diff — pre-code diff inference is unreliable and circular. Map the extracted signals to surface tags from this vocabulary: `config`, `auth-security`, `data-schema`, `public-api`, `infra-deploy`, `ui`, `pure-logic`, `architecture-bearing`. Tune toward **recall** (over-include): a false positive costs one wasted lens-pass, a false negative skips a needed review. When the surface is mixed, uncertain, or yields no confident tag, pass **no tags** — the gate fails safe to all four.
2. **Map to a `LensSelection` (deterministic CLI).** Shell `faff spec-review-lenses --tags <comma-joined tags> --level <level> --appetite <faff config get appetite>` (level is one of the four autonomy levels) (level is the runtime autonomy level; appetite from config). It returns `{ lenses, mode, rationale }` on stdout — the **sole** source of the selection (never hand-derive the lens-set). It is **safe-direction / additive-only**: only the `architectural` lens (or `methodology` where no tag adds it) is ever dropped, and only on a confidently-classified surface; **`infosec` + `QA` are sticky** (always fire at L1–L3); an unclassified or unrecognised surface fires **all four** (fail-safe); **L4** fires the full lens set and is never narrowed by appetite; `low`/`medium` appetite widens to all four. **`mode` follows whether an adversarial `spec_review` chain is configured — at every level, not only L4**: pass `--adversarial-configured yes|no` to state it, or omit it and the CLI resolves it from config. A configured adversarial occupant therefore runs per-lens refuters on an L3 drain rather than collapsing to the single-pass checklist its own SKILL says reduces it to the default. **At L4 an unconfigured chain FAILS CLOSED (exit 3) — treat it as needs-human, never as single-pass.** Pass `--level` as `L1`…`L4` exactly: an out-of-enum value is rejected (exit 2), never coerced. Carry the `rationale` into the spec-review log as the audit trail of signals→tags→fired lenses.

**The producer.** Run `faff dispatch prepare-producer spec_review` and follow gateway → **Producer dispatch**. Send the spec, selected lenses and mode, attached `## Methodology critique` if present, and repo architecture context. The reviewer runs only the selected lenses and returns one `faff-contract:spec-review-verdict` block.

**Reviewer pin (the loop-level half — the occupant owns pin capture, prep owns the scratch dir + window governance).** Resolve the per-spec **scratch dir once** at loop entry via `scratch=$("$faff" spec-review-dir --issue <ISSUE-XX> [--run-dir <dir if $FAFF_RUN_DIR set>])` — `<run-dir>/<ISSUE>/spec-review` under a run-dir, else `.faff/spec-review/<ISSUE>` for interactive prep (no `$FAFF_RUN_DIR`). **Every round-record write and every convergence/churn CLI read below uses this resolved `$scratch`** — never a hardcoded `.faff/runs/<run-id>/...` path (that path is undefined for a no-run-dir interactive prep, the pre-existing gap this closes). Pass `$scratch` to the `spec_review` occupant each round as its **pin-dir**: the L4 adversarial occupant resolves its chain through `faff spec-review-pin --resolve --dir $scratch` (pin-first-with-fallback) and captures every round's outcome there via `faff spec-review-pin --capture` (unconditional — see the occupant SKILL).

**Govern the window inside the round call.** Pass the round's servedness to `faff spec-review round` as `--served any` (at least one lens returned exit 0) or `--served none` (none did), with `--occupant adversarial`. The verb runs the window governance itself from `served-<n>.json` and the pin, copies any anomaly or fault into `warnings`, and takes `window_start := n` on a fault or a missing `governance-<n>.json`. Never re-derive the served identity yourself.

A **human unpark** ends the old window and the cap count: before the next review round runs, call `"$faff" spec-review round --open-window --dir $scratch` (it refuses unless the loop last stopped on `park` or `judge`). A whole-chain outage (pin + all fallbacks down) is an ordinary all-backends-down `needs-human` via the occupant's transport floor — there is **no** pin-specific park cause. The default single-pass occupant is never governed: pass `--occupant single-pass` and no `--served`.

**Ratified-scope assembly (per round, the design lenses' deferral input).** At the **start of every review round**, immediately before `faff inflightcheck --open --key <ISSUE-XX> --describe spec-review`, gather the resolutions below and run `faff prep-context` once. Never prepare only at loop entry: a human ratification after round one must reach round two. Invoke even when no container resolves or the resolution set is empty.

The command rereads `docs/decisions.md` for settled precedents and ratified tradeoffs. The supplied run's ledger contributes the optional PRD container, which gates only PRD non-goals. Missing/unreadable ledger retains the no-container fallback; log any returned warning. The command uses the same `spec-review-dir` scratch path resolved above, assembles fresh context, then folds resolutions with the existing inert renderer. It writes `$scratch/ratified-scope.md` for the occupant to append to **all four lenses' `--context`**.

**Ratified tracker-resolution fold (prep-time visibility only).** Human-settled Punt/Assumes resolutions posted as `## Decisions-register intent` comments reach the lenses as inert DATA. `docs/decisions.md` remains the durable record that `faff-graft` Step 4c materialises under human PR review; prep never writes it.

**Gather (path (a) only — marker-gated).** Reusing the enumerate-intent subroutine's fetch (a same-turn `list-comments` reuse, never a second round-trip), enumerate the issue's post-spec `## Decisions-register intent` comments, and for each: pipe its body to `faff decisions intent-status --file -` and **keep only `live`** (drop `superseded` / `not-intent`); **drop any whose author id equals the run automation identity** (the actor prep posts under — defence-in-depth beside the marker gate); take `topic` from the intent's heading topic and `resolved` from its `Chosen:` line. Build a `RatifiedTrackerResolution[]` — `{ topic, resolved, comment_id, author, ts, marker: "intent-live" }` — deduped by topic (latest `ts` wins) — as `$resolutions_json`. A free-form Resolution carrying **no** `## Decisions-register intent` marker is **not** gathered in v1 (the shared-token false-positive surface; see the security Punt in the spec). Git-only mode has no thread → the set is empty → the fold is a no-op.

Pass the gathered array (or `[]`) as stdin; supply `--run-dir` only when `$FAFF_RUN_DIR` is set, with the same run directory used to resolve `$scratch`. Here `$issue` is the issue ID and `$repo_root` the repository root:

```bash
set --
[ -n "${FAFF_RUN_DIR:-}" ] && set -- --run-dir "$FAFF_RUN_DIR"
printf '%s' "${resolutions_json:-[]}" | "$faff" prep-context --issue "$issue" --root "$repo_root" \
  "$@" --resolutions-file -
```

The command collapses newlines and scrubs secrets/directive sentences from tracker values. It synthesises the heading and provenance when only resolutions exist; an empty set adds no fold. Malformed/oversize fold input adds no fold and fails.

- **Exit 0, `status: ready`**: use the freshly written `file`; append **every** returned `warnings` line to the prep round audit log. Missing a per-honourable-entry no-expiry warning is an audit defect even if no objection is demoted.
- **Exit 3, `status: absent`**: legitimate empty assembly and resolution set; stale context was removed. Dispatch without the file, with no deferral.
- **Exit 2, any other exit, or missing/malformed result**: route this round to `needs-human`; **do not dispatch or use an earlier file**. Log returned warnings and diagnostic, or stderr when no JSON is returned. Source-read failure removes stale context and skips the fold; a failed read is never an empty set.

**Turn-survival (in-flight marker).** The `spec_review` dispatch is an Agent-tool Producer dispatch, the arm an unattended drain can strand by backgrounding it and ending the turn. Before invoking it, write a per-dispatch **in-flight marker** — `faff inflightcheck --open --key <ISSUE-XX> --describe spec-review` — and clear it the instant the producer's tool result is consumed — `faff inflightcheck --close --key <ISSUE-XX>`. Pass `run_in_background: false` where the harness supports foreground; a harness with no foreground option (interactive Claude Code) is safe because it tracks the child across turn-end and re-invokes the parent (gateway → **Producer dispatch**). Where the stranding premise holds (headless `claude -p` / a live run dir), **never end a turn** with the spec-review dispatch still in flight: a review that cannot finish this turn takes its held outcome and records it, rather than ending the turn on a progress report. The `faff inflightcheck` Stop hook refuses turn-end on a still-open own marker only where that premise holds, and emits a non-blocking note where the harness re-invokes the parent — the mechanical backstop for this arm. The spec-review fan-out is itself a subprocess spawn `inflightcheck`'s per-dispatch enumeration cannot see (especially on a retry), so the **`faff turncheck`** state-based Stop hook is the backstop that catches a non-terminal turn-end the marker misses — it refuses turn-end whenever the run is still `owner.status:"running"` with a clean queue and nothing in flight.

**Record and route the round (one call).** The instant the occupant returns, save its whole output to a file and run:

```bash
"$faff" spec-review round --issue <ISSUE-XX> --dir "$scratch" --verdict-file "$out" --mode <interactive|autonomous> \
  --occupant <adversarial|single-pass> [--served any|none] [--run-dir "$FAFF_RUN_DIR"] --json
```

`--occupant` is the lens selection's `mode`. The verb governs the window, locates the single `faff-contract:spec-review-verdict` block, writes `round-<n>.json` before piping it to the contract, routes a `reject-approach`, checks churn against the previous round in the window, counts the appetite cap from disk and applies the convergence yield, in that order. It returns one `action` and writes it to `decision-<n>.json`. Copy every `warnings` line into `prep.md`. **Anti-pattern:** running `spec-review route`, `spec-review-churn` or `spec-review-convergence` beside it and acting on their output; the verb already ran them in the order the gate needs. Route on `action`:

| `action` | Autonomous | Interactive |
|---|---|---|
| `approve` | Write `retain` beside `confidence:`, then the confidence gate (both gates must pass) | Same |
| `fix-and-rerun` | Apply the lensed fixes in place, re-rate, re-review | Same, surfacing the objections |
| `park` | Park protocol with `cause`, plus the carried design-lens block when `carried_design_objections` is non-empty | Surface `cause` with `summary` and `cap`; the human decides |
| `judge` | _Spec-review judge_ below | Never returned |
| `re-slice` | _L4 autonomous re-slice_ below | Never returned |
| `retry-outage`, `hold-outage` | _Spec-review-outage disposition_ below | Never returned |
| `surface-outage` | Never returned | Surface the outage; the human chooses retry or park |

### Ratify a design-lens objection in place (interactive only)

Interactive **ratify** lets a present human keep a decision instead of revising or parking on the cap ceiling. Offer it **only** for a `major`/`minor` design-lens objection naming a specific already-`**Chosen:**` decision **and** passing the scope test below, and **only** in interactive mode. The human, never the producer, settles that call.

**The decision-vs-implementation scope test (runs before the offer fires).** An objection's `spec_anchor` names a section, not a decision, so naming a `**Chosen:**` line is necessary but not sufficient. Classify from the objection's own `claim`: does it argue against *the choice*, or against *a mechanism or detail of carrying the choice out*? Only a **decision-level** objection is ratifiable. One that is ambiguous between the two, or mixes both, is **not** offered ratify — it routes through `revise`/park exactly as an unclassifiable objection does today, because ratifying it risks silently suppressing the implementation half the design lenses promise to keep critiquing at full severity. These worked examples calibrate the test's two ends and its fail-safe middle; they do not replace it:

| Classification | Example claim | Ratifiable |
|---|---|---|
| Decision-level | "Postgres is the wrong store for this — use the file-based register instead" (attacks the choice itself) | yes |
| Implementation-level | "The chosen Postgres migration has no rollback path" (accepts the choice, attacks its execution) | no |
| Ambiguous / mixed | "Postgres is fine, but this schema will lock the table under load" (decision-adjacent implementation critique) | no — fail-safe |

This is LLM classification, not deterministic parsing like the `spec_anchor` heading-slug rule. **Ambiguous resolves to no ratify, never the reverse**: keep the non-`critical` objection in the loop rather than ship an unexamined defect. The occupant's `eval/in-spec-ratification/` fixtures cover implementation-level and ambiguous cases.

```
PROCEDURE surface_design_lens_objection(objection, decision_line):
  1. severity == "critical" -> present as today (revise or park), no ratify
     offer; the severity floor is unconditional.
  2. ELSE IF the scope test cannot cleanly classify it as decision-level
     (ambiguous, or mixing decision and implementation) -> as today, no offer.
  3. ELSE (major | minor, cleanly decision-level), interactive only -> present
     three choices, not two: revise (loop the producer), park/needs-human (on
     the cap ceiling), ratify ("keep <decision_line> as chosen; it is settled").
  4. ON an explicit human "ratify" reply (never inferred from silence, never
     from the agent's own read of the conversation):
     a. append "(ratified: human)" to decision_line's Chosen marker, within
        the re-attach this round already performs;
     b. log the neutralised, capped quote of the reply into the tracker
        comment that re-attach already posts — never bare "tag added";
     c. run the Decisions-register capture step's tradeoff-shaped offer;
     d. drop this objection from the round's must-fix set; when every
        objection of the round was ratified, run `faff spec-review round
        --mark-ratified <n> --comment-id <re-attach comment id> --dir $scratch
        --mode interactive` so the round consumes no cap iteration;
     e. continue the round for any other unresolved objections as today.
  5. Autonomous mode: never fires (no human to answer); an autonomous
     revise/reject-approach proceeds exactly as today.
```

**Audit the utterance, not just its result.** The tracker comment the re-attach already posts carries the human's own words beside the resulting tag, so the tag's provenance is checkable against the thread rather than resting on trust in prep's mechanical-edit claim. The quote is **neutralised before it is written, never raw**: run it through the same structural-neutralisation transform `faff ratified-scope --fold-resolutions` applies to tracker values (newline collapse, secret-shaped-value redaction, imperative-sentence scrub — the identical function, reused, never reimplemented), then extract the shortest sentence that states the decision — never the full multi-paragraph turn — and hard-cap it at **200 characters**, truncating with `…` if that sentence is longer. The reconcile step's in-context judgement re-reads this quote later, so it must land there as inert, bounded DATA.

**The tag survives the loop, and an autonomous refresh, by carry-forward.** A `revise` re-invocation uses the current spec, including every `(ratified: human)` tag verbatim, as its base; never request a scratch redraft mid-loop. An **autonomous stale-refresh** preserves inherited tags: "never added on an autonomous dispatch" forbids new tags, not existing ones. Both are scoped revisions; neither rule governs a later separate prep session's full redraft.

**Anti-pattern:** offering ratify for a methodology-lens objection. A methodology `reject-approach` is a scope/sizing call routed to `/faff-plot`, never a loop-in-place revision — there is no single named `**Chosen:**` line to ratify against.

**Anti-pattern:** offering ratify on the strength of `spec_anchor` alone. It names the attacked *section*, not whether the attack is decision- or implementation-level; an implementation objection anchored to the same section as its decision would pass a naive "names a Chosen line" test and must not be ratifiable.

**Carried design-lens objections (plot-destined `reject-approach` with design-lens objections).** The park record (L1–L3) or the re-slice handoff log (L4) — whichever this pass took — additionally lists the CLI's `carried_design_objections` verbatim, one `{lens, severity}` per line, under a labelled "Carried design-lens objections" block. No second store: the round record `round` writes already persists the full verdict verbatim, so this is the human/plot-readable copy, not a new write path. A re-sliced epic re-enters through plot's normal create path and is re-prepped from scratch — its own spec-review gate run is what re-raises a design-lens objection that still applies; the carried block is the audit trail proving it wasn't silently dropped, not a live constraint plot consumes (plot has no objection-intake seam — out of scope here).

**L4 autonomous re-slice (plot-destined `reject-approach`, L4 only).** `round` returns `re-slice` only for an autonomous run whose run-ledger `level` is exactly `"L4"` (a whitelist); every other level parks. **At L4, ticket size is decidable by the agents and is never a park reason on its own** — a too-big slice is re-sliced and building continues; L4 parking stays reserved for a genuine risk or a genuinely-undecidable call (the can't-reduce escalation below is that carve-out, not a size park).

1. **Resolve the re-slice target** — the parent slice being prepped plus its container, inherited as the `TargetRef` anchor `/faff-plot --autonomous` itself resolves explicit-over-inherited (`faff-plot/SKILL.md` → Ignition). No resolvable target → **park** (can't re-slice with no anchor), exactly as the L1–L3 row.
2. **Invoke `/faff-plot --autonomous`** against that anchor via the Skill tool (gateway → **Sibling-skill invocation**). It self-mints its own L4 run-ledger, runs the outward-only guard, and drives the topology-write envelope + loop caps unchanged (`faff-plot/SKILL.md` → Ignition / The gate→verdict seam) — prep mints **no** ledger and writes **no** tracker structure itself (lane preserved).
3. **Terminate prep for this parent slice** with the `re-slice-handoff` return (see **Return values**) — log `{parent, objecting lens(es), target}`. Do **not** re-spec the parent in place; it is superseded by its own re-sliced epics.
4. **The re-sliced epics land in Backlog** (plot's normal create path) and **re-enter this run's wave loop** — the run converges rather than stopping; this step only hands off into the wave loop's own drain, never a second arm cycle of its own.

**Plot refuse.** If `/faff-plot --autonomous` ignition refuses (self-directed / no-target / inadmissible — its own closed `refuse` verdict), record that reason and **park** the parent slice per the shared protocol instead of returning `re-slice-handoff` — scope is never lost, and there is no retry.

**Can't-reduce escalation, not a size park.** If the re-slice does not converge — `round`'s churn check trips across the re-prepped children — that is a genuine can't-decide, escalated via the existing `needs-human` / churn park causes below, never reframed as "too big."

**Spec-review judge (the would-be-park interceptor, L3–L4).** At the would-be-park point above — a non-converging (`converging: false`), churning (`churn: true`), or plateaued reviewer that has reached the appetite ceiling `N` — a blinded, two-phase, per-proposition **judge** adjudicates each standing objection before the loop parks, and admission is a deterministic roll-up of its rulings. Its closed per-proposition vocabulary is the fixed `faff contract spec-judge-verdict` (see `faff contract spec-judge-verdict --describe` for the outcomes). The judge is **terminal**: there is no keep-going outcome, so a would-be-park pass resolves in one go and runs no further round. It is the last thing tried before a human; it consumes the deterministic layers' outputs as evidence and re-derives no layer output. It is **off by default when a human is present** (advisory behind a config flag) and runs at the autonomous levels **L3–L4** only — `round` returns `judge` only for an autonomous run whose `level` is exactly `L3` or `L4`. **Bypassing the judge, park directly, unchanged:** a config-fault/contract-malformed `needs-human` (a broken backend is not a review result), and an explicit operator hard cap / run-budget ceiling.

1. Run `"$faff" spec-judge-evidence --assemble --sequence --dir "$scratch" --window-start "$window_start" --spec <spec-file> --issue <ISSUE-XX> [--container <c>]`. On exit 2 or `park:true`, park the issue and stop. Keep the default `$scratch/judge` ledger private.
2. Select one configured judge (`faff adversarial-backends --consumer spec_judge`) at least as strong as the refuters. Repeatedly run `"$faff" spec-judge-evidence --step --dir "$scratch" --window-start "$window_start" --spec <spec-file> --backend '<provider>|<model>|<host>'` with the same selection. Without a qualified judge, omit `--backend` to park one proposition per step. The command excludes refuters and binds both calls to the current proposition and evidence. On exit 2, park the issue and stop.
3. On `apply-correction`, apply the returned correction even for a minor proposition, then step again to verify it. If the edit cannot be applied, repeat the step with `--park <pid>`. On `retry`, `continue` or `parked`, step again. On `done`, run the admit roll-up.

**Deterministic admit roll-up (the judge never asserts admission).** After every proposition has a `ruling-<pid>.json` or a `parked` marker and every correction is applied, shell `"$faff" spec-judge-evidence --admit --level <level> --out $scratch/judge --spec <spec-file> --dir $scratch --window-start $window_start [--run-dir $FAFF_RUN_DIR]` and route on the emitted `AdmitResult`. It resolves each blocking `UPHOLD_REVIEW`/`SYNTHESIZE` only when the correction-applied check passes, vetoes over the top on the arithmetic floors (a null/degraded floor input fails **closed**), runs the L4-ratification gate (its half of the two-part L4-final gate — the merge-time `governance-check` against the protected-branch anchor is the other half), and emits the effective `level`. A missing `ruling-<pid>.json` for a listed non-parked proposition, or a malformed `ledger.json`, is fail-loud (exit 2) → **park**. Route on the emitted `level`, a pure function of `admit` × effective-level:

| AdmitResult | L4 (effective) | L3 (effective) |
|---|---|---|
| `admit: true` | promote-final — retain `spec-review: accept (judge, L4-final)` | promote-provisional — retain `spec-review: accept (judge, L3-provisional)`; log the ledger + rulings; a later human comment classified as a challenge re-parks/reverts via **Live-thread reconciliation** |
| `admit: false` (a blocking proposition unresolved/parked, a floor vetoed, or `prd_boundary[]` non-empty) | park (`faff-parked`) | park (`faff-parked`) |

`PRD_BOUNDARY` routes to a human at **both** levels (it is in `prd_boundary[]`, so `admit` is false). `promote-final`/`promote-provisional` satisfy **only the spec-review half** — they stand in for a refuter `approve`, and the unchanged confidence gate still runs (retained `high` promotes; `medium` routes `needs-decision-first`; `low` never reached review). The judge feeds no confidence value and overrides it nowhere. Terminality is by construction — with no keep-going outcome the review loop never re-enters after a would-be-park judge pass, so no new `round-<n>.json` is written and the round counter does not advance.

**Advisory in-ticket discrimination smoke (non-gating).** Optionally run the built judge over the committed defect/taste case pair (`plugin/skills/faffter-dark-spec-review/eval/spec-judge-discrimination/`) once and log the observed rulings against the pinned oracles (defect NOT `AFFIRM_SPEC`, taste `AFFIRM_SPEC`) as an advisory signal; a transport outage retries (bounded) and an exhausted outage records a skip. A single stochastic sample cannot certify the judge, so neither a mismatch nor a skip gates the build — the gating calibrated-corpus eval is a sibling ticket's.

**Spec-review-outage disposition (`unavailable` verdict).** The occupant's transport floor surfaces `unavailable` for a **swing-capable** outage of two kinds — `infra-configured` (a network transient: host unreachable / a 429 chain) **and `model-transient`** (a non-truncated *parser* residual fault — the backend served a shape-valid but off-grammar body, so the config demonstrably worked and a re-run is likely to clear it). Both route here; only a genuine `config-fault` stays `needs-human` (a human config fix the retry loop can't ride out — and a *parser* residual fault is no longer one of those). This means *the reviewer was down (or served off-grammar)*, not *the spec is suspect* — port the shipped build-side shape (a retry-later hold, fail-closed chain-exhaustion, an in-band `unavailable` verdict) to this altitude. The hold store below records which swing-`kind` triggered the hold as an additive, **provenance-only** field (read by no gate — both kinds route identically; a legacy hold lacking it reads as `infra-configured`, `outage_holds` unchanged): it is the seam a future divergent retry ceiling for `model-transient` keys off without re-plumbing the store, and that divergent gate is out of scope here.

In autonomous mode `round` counts this round's `unavailable` dispatches from disk: `retry-outage` while the count is within `prep.spec_review_outage_retry_limit`, then `hold-outage`. Retry entirely in-turn, re-dispatching only `outaged_lenses` and passing each re-dispatch's output to `round` (the turn never ends between attempts; `faff turncheck` backstops it). On `hold-outage` only:

```bash
"$faff" spec-review hold --issue <ISSUE-XX> --cause outage --mode autonomous --kind <infra-configured|model-transient> \
  --lenses <outaged_lenses, comma-joined> --dir "$scratch" --json
```

| `action` | Do |
|---|---|
| `hold` | Apply `label_ops`, post `comment` verbatim, leave status Backlog (spec attached, not promoted, not parked) and return `token` |
| `park` | Apply `label_ops`, then the park protocol with `cause` |
| `surface` | Surface the outage (interactive) |

Exit 4 means the resume-store issue lock is busy: retry once, and treat a second exit 4 as `errored` (interactive: surface it; autonomous: return `errored`, which the run treats as a park). Handle any other non-zero `round` or `hold` exit the same way. **Anti-pattern:** re-producing the spec on resume — see _Resume at the review gate_ below.

**Resume at the review gate (Scenario B, autonomous).** An issue carrying `faff-awaiting-spec-review` whose `faff spec-review hold --read` reports `store.state` `valid` is picked up by the prep queue via `faff next`'s `--awaiting-spec-review` arm (gateway → **Next-step transition**) — status stays Backlog, so it re-enters through the ordinary existing-spec path (Scenario B), not a new one. On finding the label + store: **skip spec re-production and the already-shipped/premise gate entirely** (the spec is durable on the tracker; only the review is re-run) — re-enter the spec-review gate directly (re-run the occupant fresh, same lens selection as any other pass). A conclusive resumed verdict routes exactly per the table above, then runs `faff spec-review hold --clear` and applies its `label_ops`; a repeat outage reaches `hold-outage` again, whose counter increments across drains and parks at the hold limit. **Label present but the store missing/invalid is not a special case** — it is not a resumable hold, so this whole short-circuit does not apply; Scenario B proceeds through its ordinary existing-spec flow (freshness checks, then ultimately the same spec-review gate any pass would run) exactly as if the label were absent.

**Retain the verdict on the spec.** On `action: approve`, write the returned `retain` line (`spec-review: approve`) alongside the `confidence:` line (durable provenance, exactly as the confidence rating is retained). Build-admission consumes this **retained** verdict rather than re-reviewing; staleness is caught by the existing **Live-thread reconciliation** (gateway) every verdict consumer already applies — wire the retained verdict *through* that reconciliation, not around it.

**Persist + carry the spec-review evidence (audit-only; gates nothing).** At this same terminal seam (a refuter `approve` or the judge's `accept (judge, …)`), persist the review's evidence so graft Step 9b can anchor it. Every `round-<n>.json` in `$scratch` with empty objections → post nothing. Else `faff spec-review collate-evidence --dir $scratch > collated.json` lists every objection of every round under a key `<n>#<i>`. Build `dispositions.json` mechanically, one `{key, lens, disposition, disposition_rationale?}` entry per key: refuter revise loop cleared by an approve → `fixed`; human accept → each objection's outcome and reason as this log records them. Never synthesise rationale the review did not produce. Then run `faff spec-review collate-evidence --dir $scratch --dispositions dispositions.json --comment > comment.md`. On the judge path, build no file: run `faff spec-review collate-evidence --dir $scratch --from-judge --spec <spec-file> --comment > comment.md` with the spec file passed to `--admit`, before any edit except a re-stage. Post `comment.md` byte for byte as a new tracker comment (git-only: append it to the committed spec). Never edit, summarise or rebuild the block: graft refuses one whose sha256 line no longer matches. That `--comment` call also writes `spec-review-verdict.json`; log any stderr `warning:` line or non-zero exit in `prep.md` and continue, never block promotion.

**Spec-review turn-budget hand-back (`turn-budget` hold).** The healthy-slow twin of the outage disposition above: a slow-but-healthy fan-out (all backends up, merely slow) must not die inside the prep subagent's turn. Wrap the single `fan-out.mjs` call in an orchestrator-level wall-clock `timeout $("$faff" config get prep.spec_review_turn_budget_secs)` (default 300, set below the harness turn ceiling with headroom for the hand-back write). One bounded in-turn re-attempt, then hand back. Never relaunch the fan-out until the turn dies (the incident behaviour), and never coerce a deadline-fired fan-out toward `approve` or `needs-human`: the spec is fine and no backend is down, so the honest state is "not yet reviewed", which is a hold, not a verdict.

When the deadline fires with no verdict and no outage, interactive prep surfaces it and never auto-holds. Autonomous prep runs `"$faff" spec-review hold --issue <ISSUE-XX> --cause turn-budget --mode autonomous --dir "$scratch" --json` and acts on it by the outage table above (`token` is `spec-review-pending`). The two hold counters are independent, and a hand-back writes no round record and no verdict. Resume is the ordinary Scenario B path above.

**Modes.** Verdict computation is identical interactive vs autonomous; only who acts on the routing differs. Autonomous prep applies `revise` fixes / prep-destined re-plans within appetite and parks on `needs-human` or an L1–L3 plot-destined reject; interactive prep surfaces the verdict + objections to the human at the same point. A plot-destined `reject-approach` is human-interactive at **L1–L3, in both modes** (it surfaces for `/faff-plot`, never auto-re-slices); **L4 is the sole exception** — see _L4 autonomous re-slice_ above. `unavailable` follows the same split (see _Spec-review-outage disposition_ above): autonomous prep runs the in-turn retry and, on the ceiling, holds (or escalates to `needs-human` past the hold limit) with no human touch; interactive prep never auto-holds — it surfaces the outage and lets the human choose retry or park.

**Degraded methodology signal.** When no `## Methodology critique` block is attached (no methodology slot configured), the reviewer's methodology lens degrades to no-signal and emits no methodology objection — it never recomputes value/scope. prep passes whatever critique block it wrote (or none); it does not synthesise one for the reviewer.

**Park causes** are the `cause` strings `faff spec-review round` and `faff spec-review hold` return (among them `spec-review churn detected — new objecting lens(es) since round N: <lenses>` and `spec-review loop cap reached — <verdict>`), plus `spec-review reject-approach (methodology at major or above) — L4 plot ignition refused: <reason>` (the L4 plot-refuse arm above) and `spec-review judge park-needs-human — <upheld objections>` (the judge's park ruling, including a weighed accept the blocker / major-infosec accept-bar coerced). The L4 `re-slice-handoff` return (above) is **not** a park cause — it is a distinct terminal outcome (see **Return values**); neither is the `spec-review-held` outage-hold return — a hold is not a park (see _Spec-review-outage disposition_ above).

## Spec quality bar (owned by the producer)

The **producer** owns fresh-spec clean-context review: a fresh-context subagent checks every claim against the codebase before trust. The default producer's _Self-review before returning_ (`faffter-noon-spec/SKILL.md`) runs for every fresh spec regardless of size, uses `blocker`/`major`/`minor`, and forbids self-rated `high` with ≥1 blocker or ≥3 major. Prep trusts the returned self-rating and markers, applies its own gates and never repeats that review.

What prep still owns around the producer's output:

- **Marker validation** via the consumer-fold (`faff prep attach` stage, see _Spec contract_) before attach (autonomous failure → park; interactive → add the missing marker).
- **Logging.** Append the producer's returned review findings + resolutions to the prep log (`.faff/logs/YYYY-MM-DD/HHMMSS-prep-ISSUE-XX.md` or `.faff/runs/<run-id>/ISSUE-XX/prep.md`) alongside prep's own decisions. A missing review record from the producer is a process failure — prep notes it. The narrative `HHMMSS-prep-ISSUE-XX.md` write is subject to the gateway logging gate (skip the narrative write when `logging: essential`); the `runs/<run-id>/ISSUE-XX/prep.md` resume artifact is hard floor and written regardless.
- **The confidence gate** (`high` → promote; `medium` → attach + retain; `low` → park), applied to whatever rating the producer returns.

**Refresh exemption.** On the stale-refresh path (Path 1 in autonomous), prep refreshes an already-vetted spec itself rather than re-invoking the producer — a scoped, annotated change, not a whole-cloth redraft — so the producer's self-review does not re-fire. If a refresh would require a whole-cloth redraft, prep re-invokes the producer (which self-reviews) instead — and because a redraft is fresh spec production, the conditional **Architecture proposal step** (below) runs first, exactly as on the fresh-spec paths (the superseded spec's own proposal block is what is being redrafted, so it does not count as the trigger's existing sibling proposal).

## Architecture proposal step (shared subroutine — conditional)

Invoke this subroutine in interactive **Scenario A**, between explore Step 1 and spec dispatch Step 2, and autonomous **Path 2 (fresh-spec)** immediately before production. Decide whether architecture is needed; its proposal must reach downstream spec-review architectural and holdout env consumers **from the spec**, never out-of-band.

1. **Trigger test (prose judgement, precision-biased).** Fire **only** when the issue + explore findings show **new-runnable-surface work** — a new runnable system, or a material change to the deployment shape (new service / app / deployable / datastore / runtime surface) — with **no established architecture to inherit**, **and** no current proposal already exists for the same system (a sibling spec in the same project already carrying a proposal block counts as existing — never dispatch a second proposer for one system). **Uncertain → do not fire**: skip, and prep proceeds exactly as today. This is deliberately the opposite bias from spec-review lens selection (recall-biased): a spurious proposal injects unfounded architecture prose into a spec, while a missed fire costs nothing beyond the status quo and is caught fail-closed by the downstream holdout gates.
2. **On fire**, run `faff dispatch prepare-producer architecture` (add `--in-context` when prep is a subagent). Follow gateway → **Producer dispatch** with the issue/brief and explore findings. The occupant reads the infra profile.
3. **Fold the result.** Locate the returned `faff-contract:architecture-proposal` block and pipe it to `faff contract architecture-proposal`:
   - **exit 0** → pass the block + the producer's `## ADR promotion intent` section to the spec producer as input, with the instruction that the spec body carries the block **verbatim** — it must survive onto the attached spec, because downstream readers depend on it.
   - **exit non-zero / no block** → **degrade**: proceed to spec production with no proposal and surface the failure loudly in prep's output. **Never park solely for this** — the proposal is an enrichment of spec production, not a gate; the gates that depend on its consequences (env-handle, holdout-verdict) already fail closed. In interactive mode a contract exit 1 may be retried once at the operator's discretion; autonomous mode never retries — degrade and continue.

## Decisions-register capture step (shared subroutine)

Invoke immediately after human Punt/Assumes closure at Scenario A Step 3's `resolve` branch and Scenario B Step 2a's **Resolution** classification. Prep captures intent; graft materialises it. This is not the gateway resolve-attempt consumption step.

1. **Offer.** After the human's resolution is folded into the spec, ask: *"Capture this as a decisions-register precedent? (y/n)"*
2. **On yes:** draft the proposed entry — topic (the punt's short phrasing), `Chosen:`, `Rationale:`, `Scope:`, and suggested `Matches:` keys (the topic phrasing plus any close variants the human used) — and record it as a tracker comment headed `## Decisions-register intent`. Prep writes **no** repo files here — it stays tracker-only, exactly like `## ADR promotion intent`.
   - **If a build follows** (the resolve gate re-presents and the human confirms build, or Scenario B's `build`), `/faff-graft` reads the intent comment and materialises it into `docs/decisions.md` on the feature branch (Step 4c) — ratified by the human's PR review.
   - **If no build follows** (a pure interactive resolve with no immediate `/faff-graft` invocation), surface the drafted entry text in the reply so the human can add it to `docs/decisions.md` and commit it directly.
3. **On no:** continue — no comment, no draft.

**A second trigger — ratifying a design-lens objection in place (no punt involved).** Immediately after the Spec-review gate's ratify path appends the `(ratified: human)` tag (see _Ratify a design-lens objection in place_ above), run this same offer: *"Capture this as a ratified tradeoff for ISSUE-XX, so this issue's own spec-review defers to it? (y/n)"*. The original Punt/Assumes-closure trigger above is unchanged and keeps drafting the precedent shape; this trigger drafts the **tradeoff shape** instead:

```
Chosen:       <the decision, verbatim from the spec>
Rationale:    <why, folded from the objection + the human's reply>
Scope:        <what this decision covers>
Source-issue: <ISSUE-XX>
Ratified-by:  human
Date:         <today>
```

No `Matches:` field: `faff decisions match` skips tradeoffs. Follow the existing offer: a subsequent build has `/faff-graft` Step 4c materialise the comment in `docs/decisions.md`; without a build, surface the draft for human commit. On no: continue with no comment or draft. Step 4c appends the intent fields; lexical `Ratified-by:` yields `kind: "ratified_tradeoff"`, validated by its existing `faff decisions validate` call.

**The autonomous resolve-attempt path (gateway) never runs this offer and never writes the register** — capture is human-confirmed only, at these two interactive sites, so every entry is human-authored by construction.

## Decisions-register reconcile step (shared subroutine)

Run at each finalisation seam below, **after** finalising the spec (re-attached / reattached / replaced) and **before** its next-step offer. A revision may invalidate captured intent; reconcile it here. This is not the sole guard: `faff-graft` Step 4c re-checks at materialisation, including paths that skip this pass (e.g. mid-build respec), as its Step 4b/3b ADR-promotion guard does for ADR intent.

1. **Enumerate.** Fetch every `## Decisions-register intent` comment on the issue (a single tracker list-comments call; reuse a same-turn comment fetch — e.g. Scenario B Step 2a's — instead of a second round-trip). For each, pipe the comment body to `faff decisions intent-status --file -` and **skip** any it reports `superseded` (nothing to re-check) or `not-intent` (not a register intent).
2. **Re-check each live intent** (in-context LLM judgement, the sole judgement step here — mirrors the ADR `detect_contradictions` seam): does the just-finalised spec still support this intent's `topic`/`Chosen`/`Scope`?
   - **Still supported** → leave live, no write.
   - **Obsoleted / contradicted** → edit the comment in place (tracker `save_comment` on its id) to append `> Superseded <today> (<ISSUE-XX>): <one-line reason>` — **never delete** the comment. Record the supersession: interactive surfaces it to the human in the same turn ("Superseded a stale decisions-register intent: `<topic>` — `<reason>`"); autonomous Path 1 annotates the refreshed spec's own annotation block with the same one-liner.
3. **Never park solely for this.** A superseded intent is surfaced, not build-blocking — autonomous mode marks it and continues, the same "enrichment, not a gate" posture as the capture step and the Architecture proposal step. A `faff decisions intent-status` failure (unreadable comment, non-0/1/2 exit) fails safe to **leave the intent live and surface the failure** — never guess a status, never supersede on a read error.

**Finalisation seams** (run this subroutine at each, immediately before the seam's own next step, each wired inline at its own site below): Scenario A Step 3's `resolve` branch, Scenario B's `iterate` exit, `## Re-prepping`, and the autonomous mirror's Path 1 stale-refresh.

## Prep Gate

`/faff-graft` requires a spec to exist on the issue before implementation can start. That's the only gate — one artifact.

## Artifact Lifecycle

### Phase 1: Prep (issue tracker only)

During prep, the spec lives **only on the issue tracker** as a comment; commit nothing to the repo. This allows:
- No noisy commits, PRs, or CI runs for planning work
- The spec can be revised and replaced freely
- If the session crashes, the spec is preserved on the issue
- Attached **as soon as it's produced**, not batched

### Phase 2: Build (committed to repo)

When `/faff-graft` starts implementation, it pulls the spec from the issue and commits it to the feature branch as the first commit:
- Spec → `<spec-docs-path>/YYYY-MM-DD-<issue>-<name>-design.md` — `<spec-docs-path>` is the configured **Spec docs path** (default `docs/specs/`; see the gateway's **Spec docs location**)

It ships with the PR alongside the code it describes.

### Phase 3: Merged (living documentation)

After the PR merges, the spec lives in the repo as a record of what was built and why.

### Delegated skill output handling

When a delegated spec skill produces output, it may write files to its default location. Faff-prep:
1. Lets the skill write to its default location
2. Reads the produced file content
3. Attaches the content to the issue as a comment
4. Deletes the local file (it lives on the issue tracker until implementation)

This keeps the delegated skill unchanged — it doesn't need to know about faff.

## Scenarios

### Opening: state the issue outline (both scenarios)

Before Step 1 of **either** scenario and any exploration narration, prep's **first output** is a skimmable issue outline of ~3 lines:

- the **synthesis gloss** — the plain-English one-liner for the issue (defined in the sibling gateway → **Rendering → `rendering_adaptor`** (synthesis gloss); not redefined here);
- the issue's current **status**;
- a one-line **what it's about**.

Do **not** include an acceptance-criteria count here; fresh prep has not explored yet. Route through the configured `rendering_adaptor` (see **Rendering**). **Interactive:** show it first. **Autonomous:** open `.faff/.../prep.md` with it instead of printing to a human. Scenario B's fuller **Step 3: Brief the user** still follows freshness checks.

### Scenario A: Fresh prep (no existing spec)

Resolve tracker availability first **per gateway → Tracker availability resolution** (honour a `tracking.tracker` pin via `faff tracker probe`, discover the connector before concluding git-only, resolve the mode once for this prep) — so a deferred-tool harness doesn't read a connected tracker as absent and mis-route discovery to the git-only store. Then apply the shared **Spec discovery** rule (the sibling `faff/references/tracker.md`) — check tracker comments, the main description, committed `docs/` paths, and (git-only mode) the `.faff/specs/` store. Only if **all** come up empty, run the full prep workflow:

**Step 1: Explore (subagent)**

The explore subagent's dispatch resolves the `prep_explore` dispatch lane (gateway → **Sibling-skill invocation → Producer dispatch**); so does the clean-context verify subagent.

- Read the issue (title, description, ACs, dependencies, labels). Skip if cancelled or archived.
- Explore the codebase: what exists, current architecture, files/modules involved
- Check blocked-by issues: are they done? What did they produce?
- Surface ambiguities in the current issue description

**Step 1b: Architecture proposal (conditional).** Run the shared **Architecture proposal step** (above) on the issue + explore findings. On most issues the trigger does not fire and prep proceeds exactly as today; when it fires, the validated proposal block becomes spec-producer input carried verbatim into the spec.

**Step 1c: Premise scan.** Run the shared **already-shipped scan + premise-superseded gate** subroutine (below), substituting the issue + Step 1 explore findings for "the candidate spec" as the surface-area source — no spec exists yet at this point. Route on the gate's outcome:

- **Premise still holds** — proceed to Step 2 with no prompt and no gate (the common path stays frictionless); carry forward any related-but-not-superseding findings so the produced spec still gets its `## Already shipped against this surface` section.
- **Substantially delivered** — surface the matched surface area and at least one cited Done ticket ID, then apply the **Interactive park resolution (surface, don't settle)** rule: require an explicit human choice of **scrap** (on confirm, close the issue as superseded, citing the Done tickets — never auto-close), **narrow** (continue to Step 2 on the reduced scope), or **proceed** (continue to Step 2 unchanged).
- **Partially delivered** — surface the finding + cited Done IDs with a narrow-to-the-delta recommendation, offering the same scrap / narrow / proceed choice.

Carry the findings into the Step-2 spec on narrow or proceed. Use the same shared scan as autonomous Path 1 / Path 2, never a second scan; this interactive site requires human confirmation instead of auto-parking.

**Step 2: Spec** (delegated to the `spec` slot)

Run `faff dispatch prepare-producer spec` and follow gateway → **Producer dispatch** with the issue context and explore findings. The producer self-reviews in context when it is a subagent. Its tool result contains the spec, review findings and `confidence:` rating. Attach the content as an issue comment and clean up the producer's local file, if any.

**Stage the spec the instant the producer returns**, before rendering (_Stage and attach_ above, `--mode interactive`). Fix an `invalid` spec's missing markers and stage again. Log the producer's returned review findings + resolutions to the prep log.

**→ Immediately attach the spec:** post `body_path` as a comment on the issue, then confirm (_Stage and attach_ above).

**→ Run the Spec-review gate** (the approach-critique consumer-fold above) on the attached spec, **after** confidence rating and **before** promotion. Surface the verdict + any lensed objections to the user (canonical semantics: `faff contract spec-review-verdict --describe`); the approving verdict proceeds to the steps below, the fixable-in-place verdict or a prep-destined reject-approach loops in place (bounded by the gate's cap), a plot-destined reject-approach surfaces the slice for `/faff-plot`, and the human-judgement verdict (or a contract failure) parks. Only an `approve` — composed with the confidence gate — promotes:
- If the spec surfaced that the issue should be split, recommend the split
- If there are open questions, note them and leave the issue in backlog
- If clean (spec-review `approve` + confidence gate), **move the issue to Todo** — it's prepped and ready to be picked up

**ADR promotion.** After attach, run this non-blocking tail step. Prep writes **no** repo files; `/faff-graft` materialises the ADR on its feature branch so it ships with the code:

1. Resolve `mode := faff config get adr.mode` (default `offer`). If `off` → skip.
2. **Candidates** = the spec's `**Chosen:**` decisions that are *architecturally significant* — cross-slice and durable (constrains future slices), not local. v1 does **not** auto-classify; surface only decisions the spec already frames as significant. If none → skip.
3. **Interactive:** `surface` → list the candidates (one line each) and stop. `offer` → a human-gated y/n per candidate; keep the confirmed set.
4. **Autonomous (appetite-gated** — gateway → **Appetite for destruction**, the same dial that gates discovered/chain-gap auto-create): `low`/`medium` → surface only (list in the prep log, promote nothing); `high`/`full` → record every significant candidate (the ADR ships in the PR, so it is reviewable + revertible — not a side-effect outside the PR flow).
5. **Record** the confirmed promotions as a tracker comment headed `## ADR promotion intent`, listing each decision (its title + the spec section it came from). `/faff-graft` reads this and materialises the ADRs on the feature branch via `faff adr new`. Prep writes nothing to the configured ADR directory.

This is the L3 "offer + write-on-confirm" rung (the write deferred to graft); L4 (require-before-admit) is a separate rung, not implemented here.

**Step 3: Chain to build**

The next step offered here aligns with `faff next` (gateway → **Next-step transition**) on the freshly-attached spec's state — a `high` spec on a Todo issue returns `graft` (offer build), a retained `medium` returns `needs-human` (flag, don't offer auto-build). Consult it rather than re-deriving the mapping; the gate below stays the human decision (`faff next` reports, it never gates).

Then the build gate — a separate yes/no, confidence-aware. This is a surviving OFFER gate at the prep→graft boundary (gateway → **Interactive next-step offer**) — a real decision, kept as-is:

> **`confidence: high`:** "Prepped and moved to Todo. Start building now via `/faff-graft`? (y/n)"
> **`confidence: medium`:** "Prepped at medium confidence (N open punt(s) / thin rationale: …). Moved to Todo but flagged for review. Resolve the open items now, or build anyway? (resolve/build/leave)"
> **`confidence: low`:** "Prepped at low confidence — explore couldn't resolve [the core question]. Resolve it together now, or park for later? (resolve/park)"

On `high` confirm (or `medium` → `build`), invoke the `faff-graft` skill via the Skill tool (resolve per gateway → **Sibling-skill invocation**) on `ISSUE-XX` in the same conversation — **only on this standalone affirmative; the build decision is never bundled into the spec-resolution choice** (gateway → **Chaining pattern**). On `medium` → `resolve` (or `low` → `resolve`), walk the open punts/unknowns with the user and re-attach, run the **Decisions-register capture step** (above) on each closed punt, then run the **Decisions-register reconcile step** (above) against the just-re-attached spec, then **re-present this standalone build gate** — resolving a punt is not itself build consent. On `medium` → `leave`, stop — the spec stays on the tracker at its retained `medium` rating, which `/faff-wtf` surfaces as `needs-decision-first` (no park label needed; it's attached-pending-review, not parked). On `low` → `park`, **apply the shared Park / Unpark protocol** (gateway): tag `faff-parked` via the op (`faff label add <issue> faff-parked`), run `faff prep attach --issue <ISSUE> --park`, and log the cause, so `/faff-wtf`'s _Parked work_ section resurfaces it for the manual user. Interactive parks must carry the label just like autonomous ones — otherwise a hand-parked spec silently disappears.

**When the open item is an architecture / scope / taste call rather than a fact,** "walk the open punts/unknowns with the user" above is where the gateway's **Interactive park resolution (surface, don't settle)** rule applies: surface the punt and a recommendation, let the human author the `**Chosen:**`; the correctness carve-out lets prep close a fact-not-taste punt directly.

### Scenario B: Resume (existing spec found)

The ticket already has a spec from a previous prep session. Apply the shared **Spec discovery** rule (the sibling `faff/references/tracker.md`) — check tracker comments, the main description, and committed `docs/` paths. Any hit counts.

**Step 1: Restore working state** — pull the spec from whichever source had it. If multiple sources exist, use the most recently modified one and note the others in the log. **Note the spec comment's timestamp** — you'll use it in the next step.

**Step 2a: Scan comments since the spec for substantive thread changes.** Fetch the issue's comments (whichever tracker MCP is configured) **newest-first with an explicit `limit`** sized to the post-spec window rather than the default 50 (gateway → **Lean tracker reads**), and look at every comment posted **after** the spec comment. Categorise each:
- **Challenge** — questions, pushback, or new constraints that contradict or undermine a decision in the spec ("this won't work because…", "we now need to support X", "Y was deprecated since you wrote this").
- **Resolution** — decisions or answers that close out a Punt/Assumes/TBD marker in the spec, or otherwise commit to a direction the spec left open. Once folded into the spec, run the **Decisions-register capture step** (above) on it.
- **Context** — substantive information that doesn't challenge or resolve but is worth knowing while building: a relevant link, a related discovery, a constraint to watch out for, a stakeholder note. Doesn't force re-prep but **must be surfaced** to the user (interactive) or carried into the spec annotations (autonomous refresh) so it doesn't get lost.
- **Noise** — status pings, "+1", "any update?", unrelated chatter. Ignore.

If any challenge or resolution exists, the spec is **out of date** even if the codebase hasn't moved — the conversation has. Treat this exactly like a stale-spec finding: the spec must be re-prepped (or refreshed) to incorporate the comment thread before any build can proceed. Context-only comments do not force re-prep but should be appended to the spec as an annotation block (and shown in the brief). Log each challenge / resolution / context entry with its commenter, timestamp, and a one-line summary. If folding a challenge in means closing an architecture / scope / taste decision the spec left open, that's the gateway's **Interactive park resolution (surface, don't settle)** rule again: surface the call + a recommendation, the human authors the `**Chosen:**` — the correctness carve-out covers only fact-not-taste closes (a genuine bug, a rule already written down).

**Step 2b: Validate freshness against the codebase** — read the spec against the current code state. Check: have dependencies shipped since this was scoped? Has the codebase changed in ways that affect the spec? Are the technical decisions still valid? If stale: flag what changed and why it needs updating.

**Step 3: Brief the user** — present a concise summary:
- What this ticket is about
- The proposed design approach (from the spec)
- Key technical decisions already made
- **Comment-thread state since the spec** — list any challenges, resolutions, and context items found in Step 2a (or "none" if clean). Context items are surfaced too so the user sees them; they don't block build by themselves.
- Artifact state: fresh / fresh-with-context / stale-by-codebase / stale-by-discussion / both, and why
- Estimated scope/complexity

If Step 2a surfaced challenges or resolutions, the default action is **iterate** — the user shouldn't be offered `build` until the spec absorbs the thread. Context-only threads do not force iterate; the user can still pick `build` knowing the context.

Then offer a three-way choice (not passive text) — a surviving OFFER gate, per gateway → **Interactive next-step offer**:

> "What next? (iterate / build / park)"

- **iterate** — revise the spec (loop back to Step 2 of Scenario A); once the revised spec is produced and re-attached, run the **Decisions-register reconcile step** (above) before returning to this offer — a revision can change the design out from under an already-captured intent, regardless of which confidence branch the revision lands in. **Carry-check:** when Step 2a found no challenge or resolution, save the spec restored at Step 1 as `$scratch/refresh-before.md`, the revised spec as `$scratch/refresh-after.md`, and run the same `faff spec-review carry-check` gate Path 1 runs (above) — exit 0 tells the user "review carried forward: paths only" and lists the path moves; any other exit runs the Spec-review gate as today
- **build** — invoke the `faff-graft` skill via the Skill tool on `ISSUE-XX` (only if spec is fresh)
- **park** — stop here; apply the shared Park / Unpark protocol (tag `faff-parked`, log the cause) so `/faff-wtf`'s _Parked work_ section resurfaces it. The spec stays on the issue.

### Scenario C: Starting an issue (deferred to graft)

When the user says "I'm working on ISSUE-XX" or picks an issue from the catch-up, use `/faff-graft` instead. Graft enforces the prep gate and handles worktree creation and status transitions.

## Re-prepping

At any point, the user (or `/faff-graft` mid-build) can say "reprep this" or "update the spec":

- Produce the revised spec → replace on the issue immediately
- Run the **Decisions-register reconcile step** (above) against the just-replaced spec — a reprep can obsolete an already-captured intent exactly like an iterate revision
- Add a note: "Revised on [date] — [brief reason]"
- If the issue was already in Todo, it stays in Todo
- If revising closes an architecture / scope / taste decision — including unparking a `needs-human` — the gateway's **Interactive park resolution (surface, don't settle)** rule governs: surface the call and a recommendation, let the human author the `**Chosen:**`. The correctness carve-out still lets prep close a fact-not-taste item (a genuine bug, a rule already written down) itself. **Git-only unpark:** when a re-invoke on a `disposition:"parked"` git-only marker is gated open by the human's authored `**Chosen:**` closing the cited cause (or an explicit unpark), run the kernel's **git-only Unpark contract** — clear the marker's `disposition`/`park` and log the `park-reconsidered` record to this prep log (`via:"interactive-reprep"`), the inverse of the inline park write; recompute the cited config-file fingerprint and warn if it is byte-identical to park time. Write **only** the marker + this log — never an earlier dispatched run's ledger/events (Evidence class): read that run (via the marker's `owner.run_dir`) only to branch, and **refuse** — park left standing — if it is still live or its ledger is malformed. No authored resolution ⇒ the park honestly stands.

## Where Artifacts Live

| Phase | Location | Purpose |
|-------|----------|---------|
| Prep | Issue tracker (comments) | Persistent, survives across sessions. Source of truth until build begins. |
| Build | Feature branch, under the configured **Spec docs path** (default `docs/specs/`) | Committed by `/faff-graft` as first commit. Ships with the PR. |
| Merged | Main branch, under the configured **Spec docs path** (default `docs/specs/`) | Living documentation of design intent. |

The spec is **never** committed during prep. It only enters the repo when building begins.

## Tracker-less (git-only) mode

When no tracker MCP is available (gateway → Configuration), there is no issue to comment on — so prep can't attach the spec the usual way. **Everywhere this skill says "attach the spec as a tracker comment", stage with `--git-only` instead: it writes `.faff/specs/<issue-id>.md`** (the git-only spec store, gateway → **Spec discovery** location 4). It's gitignored, so the spec stays out of the repo until `/faff-graft` commits it to the feature branch — preserving "the spec ships with the PR" (above). Do **not** delete it after writing.

Everything else is unchanged: the producer still runs, marker validation and the confidence gate still apply, and the prep log still records the outcome. The tracker-state moves become no-ops — there's no Todo column to move to and the `faff label add` op's tracker write is a no-op with no tracker MCP, so a `low`-confidence park is recorded in the prep log only (and the spec is simply left in `.faff/specs/` for a human or a later pass). The chain-to-build gate is unchanged: on confirm, `/faff-graft` reads the spec from `.faff/specs/`. **Git-only unpark** is the inverse: since there is no `faff-parked` label, clearing a git-only park is the **git-only Unpark contract** above — the interactive re-invoke clears the marker + logs the record here once the human authors a resolution; an autonomous lights-out resume clears a park whose cited input demonstrably changed and re-enters it through the spec-review-resume hold (`.faff/resume/<issue>/spec-review-hold.json`, whose presence is the git-only awaiting-spec-review signal). A `reconsider:"human"` park is never auto-re-opened.

## Autonomous Mode

When invoked autonomously (by `/faff-beep-boop` during a prep queue drain, or by `/faff-graft` mid-build for respec), follow the shared autonomous contract (see the sibling `faff/references/autonomous.md`) and these specifics:

**Automation-eligibility gate (runs first).** Before either path, check the shared **Automation eligibility** rule (gateway). If the issue is **not automation-eligible** — compute `faff eligible` from its labels (the sole `faff-automate` signal) — **skip it entirely**: do not run the already-shipped scan, do not spec, refresh, or promote. The labels passed to `faff eligible` here are the issue's **at-the-gate read** — prep fetches the issue fresh at entry, and that fetch is the gate's label source (gateway → **Re-ground before gate**); if a refresh path spans turns, re-read the labels before this gate rather than reusing the entry snapshot, so a human making the issue eligible between turns is honoured. Return the `ineligible` disposition (below). A not-eligible issue is **not** `parked` (it was never attempted and never enters the run-ledger); it is silently excluded from the run. Never add `faff-automate`.

Two allowed auto-spec paths. Both invoke the shared subroutine documented immediately below at the points named in their respective sections.

### Shared subroutine: already-shipped scan + premise-superseded gate

Both autonomous paths and interactive Scenario A Step 1c invoke this shared scan at their documented boundaries. Test whether Done siblings in the same project supersede the premise. Callers supply the surface (produced spec autonomously, issue + explore findings interactively) and disposition (auto-park autonomously, human-confirm interactively).

**1. Already-shipped scan.** Four steps:

1. **Extract surface-area signals** from the candidate spec and the issue: named file paths, top-level module / directory names, named subsystems (e.g. *"audit workflow"*, *"prompt substrate"*, *"HMAC envelope"*). Heuristic — false positives cost a few tokens, false negatives miss matches.
2. **Query Done tickets in the same project (and initiative when one is named).** Use whichever tracker MCP is configured (per gateway auto-detect, no hardcoded tool names). Filter to Done / Completed / Closed. Match on the surface-area signals from step 1, plus name proximity to the candidate spec's title or subsystem labels.
3. **Pull a one-line summary of each match** — title plus the first line of description or the most recent significant comment.
4. **Emit findings under a new section** `## Already shipped against this surface` in the candidate spec. If no matches, omit the section.

Surface-area extraction is heuristic. Tune toward **recall** — false positives cost human review time but do not produce wrong parks; false negatives miss real overlaps and let prep elaborate stale-premise specs. When surface-area signals miss, fall back to querying Done tickets in the same initiative by name.

**2. Premise-superseded gate.** After the scan emits findings, prep evaluates: *given the `## Already shipped against this surface` findings, is the spec's stated motivation still load-bearing?* Three outcomes:

- **Substantially delivered** — significant portion of the premise is already covered by Done tickets. → **Park** with cause `premise-superseded`. The park comment **must** cite at least one Done ticket ID and the matched surface area or subsystem name. Without that evidence the cause is invalid and prep must not use it (it degrades into a forbidden capacity excuse per gateway → Autonomous Mode Contract).
- **Partially delivered** — some of the premise is covered, but a real delta remains. → **Narrow** the spec to that delta, calling out what's already done (in the `## Already shipped against this surface` section) so the implementer doesn't redo it. The narrow is then handled **per the calling path**: a fresh-spec caller (Path 2) re-invokes the producer on the narrowed scope, so its clean-context self-review fires on the narrowed spec; a stale-refresh caller (Path 1) refreshes the already-vetted spec in place, so the self-review is **exempted** (a scoped reduction, not a whole-cloth redraft, matching the producer's own _Self-review before returning_ → _When NOT to run_ narrowing exemption). If the narrowing crosses architectural lines (the remaining delta needs a different module structure than the original spec assumed), **park** under the architectural-change rule instead of reattaching. Either way the cited Done tickets are the audit trail; continue the rest of the path on the narrowed scope.
- **Premise still holds** — no substantial coverage by Done work. → **Proceed** unchanged. The `## Already shipped against this surface` section may still appear with related-but-not-superseding findings as reader context.

Prep judges substantial / partial / no coverage, backed by cited Done tickets and matched surface area for review.

**Orthogonal to the existing confidence gate.** Run this before Path 2's final confidence + marker validation (`confidence: high / medium / low`). Both must pass before attach: premise validity and spec well-formedness are separate checks.

**Park-protocol compatibility.** `premise-superseded` parks apply the standard `faff-parked` label per the shared park protocol below. Downstream surfacers (`/faff-wtf`, `/faff-beep-boop`) carry the cause string transparently — no special handling there.

### Path 1 — Stale-refresh (existing spec on the ticket)

**Always run the post-spec comment scan first** (Scenario B Step 2a in the interactive flow): fetch all comments after the spec, classify each as challenge / resolution / context / noise. Treat any challenge or resolution as a freshness trigger equivalent to codebase drift. Context-only threads are not a freshness trigger on their own, but **must be carried into the refreshed spec as an annotation block** so the information survives — never silently drop them. (This scan is prep's discharge of the steer-loop re-read in gateway → **Human curation is authoritative** assertion 2: a human's mid-flight comment is authoritative control input, folded in before re-rating, never silently overridden.)

**Then run the shared already-shipped scan + premise-superseded gate** (above): **Park** (substantially delivered) exits Path 1 immediately, citing Done ticket IDs in the park comment; **Proceed** (premise holds) continues unchanged; **Narrow** (partially delivered) is handled per the subroutine — for Path 1 that means refreshing in place with the self-review exempted. Continue Path 1 on the narrowed scope.

If an existing spec is present and:
- The original design decisions still hold against the current codebase **and** against any post-spec challenges/resolutions
- Changes are limited to shipped blockers, minor drift, context comments to fold in as annotations, or comment-thread resolutions that close out an existing Punt/Assumes — none of which invalidate the approach

→ produce a refreshed spec with changes annotated (cite each post-spec comment that drove a change or was folded in as context), **stage it again** (_Stage and attach_ above, `--mode autonomous`; stage re-stamps and validates every decision section's canonical marker), then run the **carry-check gate** below to decide whether the Spec-review gate actually needs to re-run.

**Carry-check gate — keep the prior review when the refresh is paths-only.** Runs only when Step 2a's comment scan (above) found no challenge and no resolution — a challenge or resolution always re-reviews, per the gateway's human-curation rule.

- **The call.** Save the spec text read at the top of this path to `$scratch/refresh-before.md` and the just-produced refreshed spec to `$scratch/refresh-after.md` (`$scratch` from `faff spec-review-dir`), then run `faff spec-review carry-check --before $scratch/refresh-before.md --after $scratch/refresh-after.md --root <repo root>` (`docs/guide/cli.md`). Log the printed JSON line.
- **Exit 0 (carry).** Keep the retained `spec-review:` line unchanged, run no lens, write no round record. Post a `## Spec-review evidence` comment: the line `refresh: paths only, review carried forward`, one bullet per `path_moves` entry, then — only when it passes `faff contract spec-review-verdict` and its digest matches — the newest earlier evidence comment's fenced block and `sha256:` line copied verbatim (git-only: write the same under the spec's own `## Spec-review evidence` heading). When that block was copied, save the comment as `$scratch/carry-comment.md` and run `faff spec-review write-evidence --dir $scratch --file $scratch/carry-comment.md` (non-zero exit: log it, never block); when none was, run nothing.
- **Exit 1 or 2 (no carry).** **Re-run the Spec-review gate** on the refreshed spec exactly as today (a substantive refresh can change the approach, so the retained verdict is re-earned — route per that section; a non-`approve` parks/loops rather than silently reattaching).
- **The refresh note.** When the refresh only fixes paths, write exactly `> Revised on <today>: paths refreshed` as its note; any other annotation is content and forces the gate.
- **Either way**, run the **Decisions-register reconcile step** (above) against the refreshed spec, then reattach to the issue and keep it where it is (Todo stays Todo).

If refreshing the spec would require changing an architectural decision, a core interface, or the overall approach — including when a post-spec comment **challenges** a core decision — → **park** (not a safe auto-refresh; the conversation needs human resolution).

If the refreshed spec fails marker validation → **park** with cause "spec contract violated — missing Chosen/Decision/Punt markers".

### Path 2 — Fresh-spec (no existing spec)

Always delegated to the `spec` slot (default `faffter-noon-spec`) — autonomous never parks merely because no `spec` override is configured; the default producer always exists.

**Step 0 — architecture proposal (conditional).** Run the shared **Architecture proposal step** (above) on the issue + explore findings, immediately before spec production. The autonomous path is the one that feeds the holdout consumers, so this invocation is load-bearing — a fired trigger's validated proposal block becomes spec-producer input carried verbatim into the spec; a failed dispatch/fold degrades loud and never parks.

**Step 1 — produce the spec.** Invoke the `spec` slot, passing the _spec contract_ in the instructions. The producer runs its own clean-context self-review and returns the spec body, the review findings + resolutions, and a `confidence:` self-rating at the end of its output. (Both rules live in `faffter-noon-spec/SKILL.md` → _Self-review before returning_.)

**Step 2 — run the shared already-shipped scan + premise-superseded gate** (above) on the just-produced spec: **Park** (substantially delivered) exits Path 2 immediately, citing Done ticket IDs in the park comment; **Proceed** (premise holds) continues to Step 3; **Narrow** (partially delivered) is handled per the subroutine — for Path 2 that means re-invoking the producer on the narrowed scope (its self-review fires). Continue to Step 3.

**Step 3 — validate and gate the spec.** **Stage the spec the instant the producer returned**, before any rendering (_Stage and attach_ above, `--mode autonomous`). (Confirm after each successful attach below; on either `park` outcome, `--park`.) The producer already ran its clean-context self-review and returned a `confidence:` self-rating in Step 1 — prep does **not** re-review; it trusts the producer's rating and logs the returned review findings. The rating means:

- `high` — every non-trivial decision has a `**Chosen:**` marker with rationale, no `**Punt:**` escalates a genuine product/architecture question, the ACs are concrete and testable, and the self-review surfaced no `blocker` / fewer than 3 `major`.
- `medium` — mostly clean but 1–2 substantive `**Punt:**` markers, thin rationale a human would want to weigh in on, or a self-review that forced a downgrade.
- `low` — multiple `**Punt:**` markers, intent the explore couldn't pin down, or a self-review `blocker` that needed architectural reframing.

**Run the Spec-review gate** (the approach-critique consumer-fold above) on the attached spec, **after** the confidence rating and **before** promotion — invoke `slots.spec_review` and route on `faff spec-review round`'s `action` (canonical semantics: `faff contract spec-review-verdict --describe`): the fixable-in-place verdict or a prep-destined reject-approach loop in place (bounded by the gate's cap), a plot-destined reject-approach parks for `/faff-plot`, and the human-judgement verdict or a contract failure (exit 1/2) parks. Only an `approve` verdict (retained as `spec-review: approve` on the spec) clears this gate; it then composes with the confidence gate below — **both** must pass to promote.

Apply the gate to the producer's output:

- `confidence: high`, marker validation passes, **and** spec-review `approve` → attach to issue (rating + verdict retained on the spec), move to Todo, return `promoted`
- `confidence: high` **but** marker validation fails → **park** with cause "spec contract violated — missing Chosen/Decision/Punt markers"
- `confidence: medium` → attach to issue **with the `confidence: medium` line retained**, move to Todo, return `promoted-needs-review`. Do **not** strip the rating — it is the re-spec signal: the routing verdict for a retained `medium` is `needs-decision-first` (gateway), so an autonomous run gives it a resolve-attempt and otherwise surfaces it in `/faff-wtf` rather than auto-building. The spec is visible on the tracker for a human to read, resolve the open punts, and bump to `high`.
- `confidence: low` → **park** with cause "low confidence — explore could not resolve core questions"

### Park protocol

Follow the shared park protocol (see the sibling `faff/references/park.md`). Use the existing `.faff/logs/YYYY-MM-DD/HHMMSS-prep-ISSUE-XX.md` log and the prep marker park outcome above.

### Return values

Return to caller one of:
- `refreshed` — spec updated, issue stays in Todo
- `promoted` — fresh high-confidence spec attached, issue moved to Todo (build-eligible)
- `promoted-needs-review` — medium-confidence spec attached (rating retained) and moved to Todo; visible for human triage but **not** build-admitted — its routing verdict is `needs-decision-first`
- `re-slice-handoff` — **L4 only**: a plot-destined `reject-approach` (see **Spec-review gate**) invoked `/faff-plot --autonomous` to re-slice this parent slice instead of parking (see **Spec-review gate** → _L4 autonomous re-slice_). The re-sliced epics land in Backlog and re-enter this run's wave loop. Not `parked` (no `faff-parked` label, no human handoff — the run keeps converging), not attached, not promoted.
- `spec-review-held` — **autonomous only**: a swing-capable spec-review outage (`unavailable` verdict) survived the in-turn retry ceiling with the hold limit not yet exhausted — see **Spec-review gate** → _Spec-review-outage disposition_. `.faff/resume/<issue>/spec-review-hold.json` written, `faff-awaiting-spec-review` applied, status stays Backlog (spec attached, not promoted). Not `parked` (no `faff-parked`, no `park_records` entry, no human handoff — the next drain auto-resumes at review); the caller (beep-boop's prep-queue reconcile) appends the id to the `spec_review_outage_pending` annotation array — never a ledger-outcome bucket, since a prep-queue issue is never `admitted` in the first place (unlike the build-side `retry-later`/`review_outage_pending`, whose ids *are* admitted).
- `spec-review-pending` — **autonomous only**: a slow-but-healthy spec-review fan-out exceeded `prep.spec_review_turn_budget_secs` with the turn-budget hold limit not yet exhausted — see **Spec-review gate** → _Spec-review turn-budget hand-back_. Same shape as `spec-review-held` (a hold, not a park: `.faff/resume/<issue>/spec-review-hold.json` with `cause: "turn-budget"` written, `faff-awaiting-spec-review` applied, status stays Backlog, the next drain auto-resumes at review), surfaced honestly as slow-not-outage: the caller appends the id to the `spec_review_turn_budget_pending` annotation array, never a ledger-outcome bucket.
- `ineligible` — the issue is **not automation-eligible** (no `faff-automate`); skipped without speccing or promotion (see **Automation-eligibility gate** above). Not `parked`, not attempted, not in the run-ledger; silently excluded. No `faff-parked` label is applied and the eligibility label is left untouched.
- `parked` — see park cause in log (low confidence, contract violation, or architectural change needed)
- `errored` — something went wrong (MCP failure, unexpected state); treated as park for purposes of the run

**Self-verify before an attach-expecting return (the belt; the caller's ground-truth reconciliation is the braces regardless).** Before `refreshed` / `promoted` / `promoted-needs-review`, run `faff prepcheck --issue <ISSUE> --json`. If `state != "attached"`, do not return success: retry attach **once** (stage → post → confirm), then re-check. Still not `attached` → return `errored`. The attach check is a precondition of the *return value*, not only turn completion.

## Notes

- When a `methodology` slot is configured, prep appends a `## Methodology critique` block to every prepped spec (invoking the methodology for issue-level findings). In autonomous prep the critique is written but does not block confidence-high promotion.
