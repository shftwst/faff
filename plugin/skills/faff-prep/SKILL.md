---
name: faff-prep
description: "Turn a vague ticket into something you can actually build — explores the codebase, writes a spec, attaches it to the issue. Trigger for: 'prep ISSUE-XX' / 'prep this' / 'spec this out' / 'what does this ticket need?'."
judgement_seam: reconciliation, prep-architecture-trigger
---

# Faff — Prep

> **Next step:** `/faff-graft ISSUE-XX` to start building

Turn a vague ticket into something buildable. Prep does the thinking so you can just code.

Faff-prep is an **orchestrator** — it owns the issue tracker lifecycle and codebase exploration, but **always delegates spec production to the `spec` slot** (default `faffter-noon-spec`). It never drafts the spec body itself; its job is to explore, invoke the producer, gate on the result, and manage attachment.

**Methodology lens.** When a `methodology` slot is configured, prep appends a **`## Methodology critique`** block after the spec body (before any chaining gates), per gateway → **The `methodology` slot** (display convention).

## Configuration

**Load the gateway first.** If `faff/SKILL.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. prep gates on the **fixed spec-readiness contract**; its `spec` slot inherits the gateway ambiently.

### Spec slot (always delegated)

Spec production is **always** delegated to the `spec` slot. The slot defaults to `faffter-noon-spec` (the lite nlspec arc) when `.faffrc` doesn't set one:

```yaml
slots:
  spec: superpowers:brainstorming   # optional override; unset → faffter-noon-spec
```

Faff-prep invokes the configured/default `spec` skill with the issue context and explore findings, captures its output, and manages the issue tracker attachment. It does **not** carry a fallback copy of the spec arc — the default producer always exists, so there is no "inline" path to fall through to.

**Producer requirements (the slot contract relies on):** the `spec` skill must (a) return a confidence self-rating (`confidence: high|medium|low`) at the end of its output, (b) produce decisions using the canonical markers defined in the gateway Spec-readiness contract, and (c) discharge its own quality bar — for `faffter-noon-spec` that's the clean-context self-review before it returns (see its `SKILL.md` → _Self-review before returning_). Faff-prep gates on the returned confidence rating; the markers let downstream sub-skills (`/faff-graft`, `/faff-beep-boop`) tell closed decisions from open punts without re-litigating them. A `spec` skill that genuinely can't self-rate is usable interactively but cannot be driven autonomously — configure a producer that can (the default does).

## Rendering

All human-facing output this skill emits — the spec-attach **comment** and the park **comment**, plus any terminal summaries — passes through the configured `rendering_adaptor` normalise pass **before it is printed or written** (gateway → **Rendering**, Universal-routing rule). In particular, enumerable sets render as lists, never `·`/comma run-on paragraphs (the prose-skimmability rule), so descriptions and comments are as skimmable as terminal output. Carve-outs (skill source files, `.faff/` logs) are exempt.

## What Prep Produces

A single artifact: the **spec**. It answers two questions:

1. **What to build and why** — design decisions, architecture, interfaces, key technical choices with rationale
2. **How do we know it's done** — acceptance criteria, concrete and testable

The spec is a high-level design document. It does **not** contain implementation-level details like step-by-step code changes, TDD cycles, or exact commands. Those belong to the implementation phase, where the implementer can feed the spec into their own planning/execution workflow (e.g., `superpowers:writing-plans`, `superpowers:subagent-driven-development`, or direct implementation).

**Methodology critique block (rendered only when a `methodology` skill is configured).**

After the main spec body, **request the `issue-critique` output from the configured methodology** by dispatching it as a producer subagent (gateway → **Sibling-skill invocation → Producer dispatch**, resolving `models.methodology`; the named output is defined at gateway → **The `methodology` slot**) — pass the issue + its spec, and render what the lens returns. faff-prep does not impose the critique's shape; the configured methodology decides what it cares about. If the methodology doesn't answer `issue-critique` (e.g. the thematic default), **omit the block**.

For reference, the agile-delivery lens answers `issue-critique` along these axes — right-sized? (principle 4: single 1–3 day unit, or two independent concerns → split; always-ships-together sibling → merge), workstream fit? (principles 1+5: outcome-named and cohesive), deps surfaced? (principle 6: implicit dep with no blocker link), risk profile? (principle 7: novel-integration/external-dep risk → de-risking spike) — each rendered as a full what's-there / why / what-to-do diagnosis when there's something to surface, "No issues" when the check passes. A different methodology returns its own axes.

In autonomous prep (e.g. driven by `/faff-beep-boop`'s prep queue), the critique block is written to the spec but does **not** block confidence-high promotion. It surfaces in the next `/faff-wtf` for the human.

## Spec contract

Every spec faff-prep attaches (freshly produced by the `spec` slot, or refreshed) must satisfy the **fixed spec-readiness contract in the gateway** (_Spec readiness (fixed)_): the canonical decision markers (`**Chosen:**` / `**Punt:**` / `**Assumes:**`), the marker rules, the skimmable-not-coded writing style, the confidence line, and the provenance stamp. faff-prep passes this contract to the producer and **validates against it before attach via the consumer-fold below** (the `spec_adaptor` slot was retired — conformance is now producer-emitted + consumer-parsed). References to "_spec contract_" elsewhere in this skill mean the gateway spec-readiness contract.

**Validation — the consumer-fold (FAFF-109).** faff-prep is the consumer of the producer's `faff-contract:spec-readiness` block. Before attach it: (1) locates the single fenced `faff-contract:spec-readiness` block the producer emitted, (2) `JSON.parse`s its body (`{ confidence, decisions }`), (3) adds `provenance_present` itself by regex-detecting the `> Spec:` stamp it populated (see _Provenance stamp_ — structural detection, not the LLM seam), (4) pipes the resulting extraction JSON to `faff contract spec-readiness` — the **sole source of contract data**. The script's exit maps to the signal: `0 → pass`, `1 → fail` (violations name the missing marker / provenance), `2 → fail-loud` (malformed extraction). On a producer that emitted **no** block, prep reads the markers/confidence from the spec prose into the same extraction JSON (the absent-block fallback — the only surviving LLM seam). Autonomous `fail` → park; interactive `fail` → add the missing marker before attach.

### Provenance stamp (populate at attach)

The **gateway Spec-readiness contract** defines the **provenance stamp** — its format and placement (_Spec readiness (fixed)_; not duplicated here). **prep populates its values _and_ detects it** (the consumer owns stamp-detection — prep writes the stamp after the producer returns, so it has the regex and timing to set `provenance_present`). At every spec-attach point — and **before** validation and attach — write the stamp line into the spec body, directly under the H1 title:

- `producer := faff config get slots.spec` (the CLI applies the `faffter-noon-spec` default — FAFF-182)
- `date := today` (ISO `YYYY-MM-DD`)
- `mode := autonomous` when running under the autonomous-mode signal (gateway → **Autonomous Mode Contract**), else `interactive`

Resolve `producer` **via the `faff config get` CLI only** — never hand-read the rc file. Insert the blockquote line per the gateway format directly beneath the `# …` heading (no `adaptor:` field — dropped with the slot). The stamp's `confidence:` token **echoes** the producer's standalone trailing `confidence:` line — it does not replace it; that line stays authoritative for validation and the gate. On a **refresh**, re-stamp with a fresh `date` and the currently-resolved `producer`.

**Git-only mode.** The stamp is written into `.faff/specs/<issue-id>.md` (where the spec body lives in tracker-less mode). When no tracker resolves, drop the stamp's trailing "Full spec on …" sentence per the gateway git-only rule.

This runs on **all** attach paths: Scenario A fresh-spec (Step 2), Scenario B refresh/iterate, and both autonomous paths (Path 1 stale-refresh re-stamps with fresh date + current config; Path 2 fresh-spec stamps the just-produced spec).

### Attach-state marker (write at produce time — FAFF-178)

Same-turn attach is a **mechanical guarantee**, not prose discipline — it has silently failed twice (a spec rendered to the user, the turn felt done, and the ticket stayed Backlog with no spec). The guard is `faff prepcheck`, the Stop-hook sibling of `runcheck`: it reads an externalised attach-state marker prep writes and **blocks session-end on any produced-but-not-attached spec**. prep's only job is to keep that marker honest:

- **At produce time — the instant the `spec` slot returns, and _before_ rendering the spec into the conversation** — write the marker `.faff/prep/<ISSUE-XX>.json`, stamping `owner` from the environment at that moment:

  ```json
  { "issue": "FAFF-XX", "spec_produced": true, "attached": false, "mode": "tracker|git-only", "ts": "<ISO-8601>",
    "owner": { "session_id": "<$FAFF_SESSION_ID>", "run_dir": "<$FAFF_RUN_DIR>", "pid": <process.pid> } }
  ```

  The write-before-render ordering is the pin: a render-and-pause leaves `attached:false` for the hook to catch. (Hard floor — written in **both** interactive and autonomous modes, regardless of `logging: essential`, since the hook must find it.)
  - **`owner` (FAFF-250)** lets `prepcheck --hook` tell its own markers from a parallel run's, exactly as the run-ledger owner stamp does for `runcheck`. Stamp `session_id` from `$FAFF_SESSION_ID` and `run_dir` from `$FAFF_RUN_DIR` (the autonomous path sets both; an interactive prep typically has `session_id` only and no `run_dir`), and `pid` from `process.pid` — **`pid` is recorded for forensics only, never consulted in the hook decision** (FAFF-233). Omit a field whose env var is unset rather than writing an empty string; an absent `owner` is tolerated as legacy/unowned (no migration). The `owner` is written **once** at produce time and never refreshed — liveness comes from the run ledger or the marker's file mtime, never a heartbeat field on the marker (which would re-import the FAFF-234 staleness confound).
- **On a successful attach** — immediately after `save_comment` (tracker) or the `.faff/specs/<issue-id>.md` write (git-only) — flip the marker to `attached: true`.
- **On a by-design park** (a `low`-confidence spec that is parked, not attached) — record `"disposition": "parked"` on the marker so `prepcheck` does not false-block a legitimate non-attach.

`prepcheck` trusts this marker exactly as `runcheck` trusts the run-ledger — it never calls the tracker (the pure-function CLI invariant). This runs on the same **all** attach paths as the provenance stamp above. **Stop-hook registration:** the `prepcheck --hook` Stop hook is registered deterministically by **`faff hooks-ensure`** (FAFF-192) — never hand-edit `settings.json`. On first run, run it (idempotent — a byte-stable no-op when already wired, and it skips the hook if the resolved `faff` can't serve `prepcheck`):

```bash
faff=$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")
"$faff" hooks-ensure
```

## Spec-review gate (approach-critique consumer-fold)

The confidence gate above asks *is the spec internally well-formed?*. This gate asks the orthogonal question *is the approach itself any good?* — sound architecture, safe, right-sized, verifiable. It is the judgement layer of the spec stage: catch a wrong approach while it is still just a spec, before any code exists. It runs **after** the spec is produced and confidence-rated and **before** the issue promotes to Todo, and it **composes** with the confidence gate — both must pass to admit (an `approve` verdict does **not** override a weak `confidence` rating, and a `confidence: high` does not override a non-`approve` verdict).

**Lens selection (the cost-gate, runs first — FAFF-268).** Before invoking the producer, choose *which* of the four lenses fire and *how deep* (mode), so review cost is proportionate to the change rather than a flat four-lens (adversarial-at-L4) pass on every spec. This step is **advisory producer-input only** — it never touches the `spec-review-verdict` contract, introduces no new lens/severity/verdict, and gates nothing itself. Two halves:

1. **Classify the change-surface (prose, recall-biased).** Derive the surface from the spec's **declared** surface — its WHAT (named files / modules / subsystems), its `**Assumes:**`, and its Reference-context — **reusing the same already-shipped-scan surface-area extraction** the premise-supersede scan already runs (named paths, top-level module/dir names, named subsystems). Do **not** predict the build diff — pre-code diff inference is unreliable and circular. Map the extracted signals to surface tags from this vocabulary: `config`, `auth-security`, `data-schema`, `public-api`, `infra-deploy`, `ui`, `pure-logic`, `architecture-bearing`. Tune toward **recall** (over-include): a false positive costs one wasted lens-pass, a false negative skips a needed review. When the surface is mixed, uncertain, or yields no confident tag, pass **no tags** — the gate fails safe to all four.
2. **Map to a `LensSelection` (deterministic CLI).** Shell `faff spec-review-lenses --tags <comma-joined tags> --level <L1|L2|L3|L4> --appetite <faff config get appetite>` (level is the runtime autonomy level; appetite from config). It returns `{ lenses, mode, rationale }` on stdout — the **sole** source of the selection (never hand-derive the lens-set). It is **safe-direction / additive-only**: only the `architectural` lens (or `methodology` where no tag adds it) is ever dropped, and only on a confidently-classified surface; **`infosec` + `QA` are sticky** (always fire at L1–L3); an unclassified or unrecognised surface fires **all four** (fail-safe); **L4** is pinned to the full **adversarial** set and never narrowed by appetite; `low`/`medium` appetite widens to all four. Carry the `rationale` into the spec-review log as the audit trail of signals→tags→fired lenses.

**The producer.** The reviewer is the `spec_review` slot (default `faffter-noon-spec-review`). Resolve it via `faff config get slots.spec_review` and **dispatch it as a producer subagent** per gateway → **Sibling-skill invocation → Producer dispatch** (resolving `models.spec_review`); a non-default occupant is validated before first use per gateway → **Slot conformance validation**. Pass it: the spec body, **the selected lens-set + mode from the lens-selection step above**, the attached `## Methodology critique` block (when present), and repo architecture context. It fires only the selected lenses (the `single-pass` L1–L3 checklist, or the `adversarial` L4 per-lens refuters) and emits exactly one `faff-contract:spec-review-verdict` block — its reasoning is its own (see `faffter-noon-spec-review/SKILL.md`); prep owns only the sequencing around the result.

**The consumer-fold.** prep is the consumer of that block (the same producer-emits / consumer-parses shape as `spec-readiness`): (1) locate the single fenced `faff-contract:spec-review-verdict` block, (2) `JSON.parse` its body (`{ verdict, objections }`), (3) pipe it to `faff contract spec-review-verdict` — the **sole source of contract data**. The script's exit maps to the action:

- **No block located, or its body does not `JSON.parse`** → treat as `needs-human` (producer breakage — a reviewer that can't emit a founded verdict), **park**. Never admit. (There is **no** silent-admit fallback here — unlike `spec-readiness`, where an absent block falls back to reading the spec's own markers, a *review verdict* has no prose to recover it from, so an absent/garbled block fails safe to `needs-human`, mirroring the contract's "malformed → never `approve`" coercion.)
- **exit 2** (fail-loud — malformed extraction) → treat as `needs-human` (producer breakage), **park**. Never admit.
- **exit 1** (violations — contract not satisfied) → treat as `needs-human`, **park**. Never admit.
- **exit 0** (conformant) → route on the verdict below.

**Routing on a conformant verdict:**

| Verdict | Action |
|---|---|
| `approve` | Continue to the confidence gate + promote (both gates must still pass). |
| `revise` | Apply the lensed fixes to the spec **in place**, re-rate, and re-review (bounded loop below). |
| `reject-approach` | Route **by the objecting lens** (table below). |
| `needs-human` | **Park** and surface the lensed objections for `/faff-wtf`. |

**`reject-approach` routes by the objecting lens** — a deterministic function of the verdict's `objections: [{lens, severity}]`, no second inference layer:

| Objecting lens | Routes to | Action |
|---|---|---|
| `architectural` / `infosec` / `QA` | **prep** | the design is flawed within the right scope → re-explore + re-spec in place (bounded loop below). |
| `methodology` | **plot** | the scope / increment is wrong → **park** and surface the slice for human-interactive `/faff-plot` to re-slice (no autonomous plot re-entry seam exists). |
| **multiple lenses object** | the **higher altitude — `plot` wins** | park and surface for `/faff-plot`; no point re-speccing a slice about to be re-sliced. |

**Loop cap.** The prep↔review loop (a `revise` re-spec, or a design-lens `reject-approach` re-plan) is capped at **2 iterations**. On a third unresolved `revise`/`reject-approach`, downgrade to `needs-human` and **park** — the human is the tie-breaker against an irreconcilable producer↔reviewer disagreement.

**Retain the verdict on the spec.** On `approve`, write a retained `spec-review: approve` line alongside the `confidence:` line (durable provenance, exactly as the confidence rating is retained). Build-admission consumes this **retained** verdict rather than re-reviewing; staleness is caught by the existing **Live-thread reconciliation** (gateway) every verdict consumer already applies — wire the retained verdict *through* that reconciliation, not around it.

**Modes.** Verdict computation is identical interactive vs autonomous; only who acts on the routing differs. Autonomous prep applies `revise` fixes / design-lens re-plans within appetite and parks on `needs-human` or a methodology-lens reject; interactive prep surfaces the verdict + objections to the human at the same point. A methodology-lens `reject-approach` is human-interactive in **both** modes (it surfaces for `/faff-plot`, never auto-re-slices).

**Degraded methodology signal.** When no `## Methodology critique` block is attached (no methodology slot configured), the reviewer's methodology lens degrades to no-signal and emits no methodology objection — it never recomputes value/scope. prep passes whatever critique block it wrote (or none); it does not synthesise one for the reviewer.

**Park causes** (folded into the standard `parked` return + park protocol): `spec-review needs-human — <lensed objections>`, `spec-review reject-approach (methodology/scope) — needs /faff-plot re-slice`, `spec-review loop cap reached — <verdict>`, `spec-review contract not satisfied (exit <n>)`.

## Spec quality bar (owned by the producer)

The clean-context review of a freshly drafted spec — dispatching a fresh-context subagent to verify every claim against the codebase before the spec is trusted — is the **producer's** responsibility, not prep's. The gateway makes a delegated `spec` skill responsible for its own quality bar; the default producer discharges it via its own _Self-review before returning_ step (see `faffter-noon-spec/SKILL.md`), which runs for every fresh spec regardless of size, applies the same `blocker`/`major`/`minor` severities, and enforces the self-rating downgrade rule (≥1 blocker or ≥3 major → can't self-rate `high`). prep does not re-run that review — it trusts the producer's self-rating and the markers, then applies its own gates below.

What prep still owns around the producer's output:

- **Marker validation** via the consumer-fold (`faff contract spec-readiness`, see _Spec contract_) before attach (autonomous failure → park; interactive → add the missing marker).
- **Logging.** Append the producer's returned review findings + resolutions to the prep log (`.faff/logs/YYYY-MM-DD/HHMMSS-prep-ISSUE-XX.md` or `.faff/runs/<run-id>/ISSUE-XX/prep.md`) alongside prep's own decisions. A missing review record from the producer is a process failure — prep notes it. The narrative `HHMMSS-prep-ISSUE-XX.md` write is subject to the gateway logging gate (skip the narrative write when `logging: essential`); the `runs/<run-id>/ISSUE-XX/prep.md` resume artifact is hard floor and written regardless.
- **The confidence gate** (`high` → promote; `medium` → attach + retain; `low` → park), applied to whatever rating the producer returns.

**Refresh exemption.** On the stale-refresh path (Path 1 in autonomous), prep refreshes an already-vetted spec itself rather than re-invoking the producer — a scoped, annotated change, not a whole-cloth redraft — so the producer's self-review does not re-fire. If a refresh would require a whole-cloth redraft, prep re-invokes the producer (which self-reviews) instead — and because a redraft is fresh spec production, the conditional **Architecture proposal step** (below) runs first, exactly as on the fresh-spec paths (the superseded spec's own proposal block is what is being redrafted, so it does not count as the trigger's existing sibling proposal).

## Architecture proposal step (shared subroutine — conditional)

Both spec-producing flows invoke this subroutine at the point named in their sections: interactive **Scenario A**, between Step 1 (explore) and Step 2 (spec dispatch); autonomous **Path 2 (fresh-spec)**, immediately before its spec-production step. It asks: *does this work need an architecture decided at all?* — and when it does, produces the proposal the spec will carry to every downstream consumer (the spec-review architectural lens and the holdout env step both read it **from the spec**, never out-of-band).

1. **Trigger test (prose judgement, precision-biased).** Fire **only** when the issue + explore findings show **new-runnable-surface work** — a new runnable system, or a material change to the deployment shape (new service / app / deployable / datastore / runtime surface) — with **no established architecture to inherit**, **and** no current proposal already exists for the same system (a sibling spec in the same project already carrying a proposal block counts as existing — never dispatch a second proposer for one system). **Uncertain → do not fire**: skip, and prep proceeds exactly as today. This is deliberately the opposite bias from spec-review lens selection (recall-biased): a spurious proposal injects unfounded architecture prose into a spec, while a missed fire costs nothing beyond the status quo and is caught fail-closed by the downstream holdout gates.
2. **On fire — dispatch the producer.** Resolve `faff config get slots.architecture`; validate a non-default occupant per the slot-conformance rule (gateway → **Slot conformance validation**); dispatch it with the issue/brief + explore findings, using the same transport as the adjacent spec-producer dispatch (gateway → **Sibling-skill invocation → Producer dispatch**, resolving `models.architecture` when prep is top-level; in-context when prep is itself a subagent — single-level nesting). The occupant reads the infra profile itself.
3. **Fold the result.** Locate the returned `faff-contract:architecture-proposal` block and pipe it to `faff contract architecture-proposal`:
   - **exit 0** → pass the block + the producer's `## ADR promotion intent` section to the spec producer as input, with the instruction that the spec body carries the block **verbatim** — it must survive onto the attached spec, because downstream readers depend on it.
   - **exit non-zero / no block** → **degrade**: proceed to spec production with no proposal and surface the failure loudly in prep's output. **Never park solely for this** — the proposal is an enrichment of spec production, not a gate; the gates that depend on its consequences (env-handle, holdout-verdict) already fail closed. In interactive mode a contract exit 1 may be retried once at the operator's discretion; autonomous mode never retries — degrade and continue.

## Prep Gate

`/faff-graft` requires a spec to exist on the issue before implementation can start. That's the only gate — one artifact.

## Artifact Lifecycle

### Phase 1: Prep (issue tracker only)

During prep, the spec lives **only on the issue tracker** as a comment. Nothing is committed to the repo. This means:
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

Before Step 1 of **either** scenario — and before any exploration narration — prep's **first output** is a short, skimmable outline of the issue, so a reader who isn't already holding the ticket in their head can follow what's being prepped. Keep it to ~3 lines:

- the **synthesis gloss** — the plain-English one-liner for the issue (defined in the sibling gateway → **Rendering → `rendering_adaptor`** (synthesis gloss); not redefined here);
- the issue's current **status**;
- a one-line **what it's about**.

Do **not** include an acceptance-criteria count here — fresh prep hasn't explored yet, so the ACs aren't known at the opening. This outline routes through the configured `rendering_adaptor` like all other prep output (see **Rendering** above), so it renders skimmably for free. **Interactive:** it is the first thing shown to the user. **Autonomous:** prep never prints to a human, so the outline opens the prep log (`.faff/.../prep.md`) instead of a chat message. This is the quick orient-the-reader opener; Scenario B's fuller **Step 3: Brief the user** still runs after its freshness checks.

### Scenario A: Fresh prep (no existing spec)

**Automation eligibility (interactive).** If the issue is **not automation-eligible** (gateway → **Automation eligibility**) — it lacks `faff-automate` under the opt-in default, or carries `faff-automation-hold` — warn — "this ticket isn't automation-eligible; proceeding interactively, eligibility is unchanged until you set it" — then continue normally. Interactive prep is never *blocked* by eligibility (only autonomous prep skips not-eligible issues). Prep never **auto**-changes eligibility labels; in interactive mode it **offers to crank it up on explicit confirm** once the spec is attached — see Step 3's *Held-ticket lift gate*. (Autonomous prep never cranks up: a not-eligible issue returns `ineligible` and is skipped.)

Apply the shared **Spec discovery** rule first (the sibling `faff/SKILL.md`) — check tracker comments, the main description, committed `docs/` paths, and (git-only mode) the `.faff/specs/` store. Only if **all** come up empty, run the full prep workflow:

**Step 1: Explore (subagent)**

The explore subagent's dispatch resolves the per-lane model (FAFF-315): `faff config get models.prep_explore` — a resolved Agent-token is passed as the Agent-tool `model` parameter; `inherit` (the default) means omit the parameter (today's dispatch). An invalid token fails loud at the CLI (exit 2 naming the legal set) — fix the config, never dispatch on a silent fallback. The same resolution applies to any other subagent prep dispatches (e.g. the producer's clean-context verify subagent).

- Read the issue (title, description, ACs, dependencies, labels). Skip if cancelled or archived.
- Explore the codebase: what exists, current architecture, files/modules involved
- Check blocked-by issues: are they done? What did they produce?
- Surface ambiguities in the current issue description

**Step 1b: Architecture proposal (conditional).** Run the shared **Architecture proposal step** (above) on the issue + explore findings. On most issues the trigger does not fire and prep proceeds exactly as today; when it fires, the validated proposal block becomes spec-producer input carried verbatim into the spec.

**Step 2: Spec** (delegated to the `spec` slot)

**Dispatch the configured/default `spec` slot** (default `faffter-noon-spec`) **as a producer subagent** (gateway → **Sibling-skill invocation → Producer dispatch**, resolving `models.spec`) with the issue context and explore findings. The producer runs its own clean-context self-review (in-context when it is itself a subagent — single-level nesting) and returns the spec body, that review's findings, and a `confidence:` self-rating as its **tool result**. Read its returned output, attach the content to the issue as a comment, and clean up any local file the producer wrote.

**Write the attach-state marker the instant the producer returns** (`attached:false`, before rendering — see _Attach-state marker (write at produce time)_ above), then **write the provenance stamp under the H1** (see _Provenance stamp (populate at attach)_ above; `mode := interactive` here), then run the marker validation from the _spec contract_ before attaching. In interactive mode, fix missing markers inline. In autonomous mode, a validation failure means **park** (record `disposition:"parked"` on the attach-state marker). Log the producer's returned review findings + resolutions to the prep log.

**→ Immediately attach spec to the issue as a comment** — then flip the attach-state marker to `attached:true`.

**→ Run the Spec-review gate** (the approach-critique consumer-fold above) on the attached spec, **after** confidence rating and **before** promotion. Surface the verdict + any lensed objections to the user; `approve` proceeds to the steps below, `revise`/design-lens `reject-approach` loop in place (cap 2), a methodology-lens `reject-approach` surfaces the slice for `/faff-plot`, and `needs-human` (or a contract failure) parks. Only an `approve` — composed with the confidence gate — promotes:
- If the spec surfaced that the issue should be split, recommend the split
- If there are open questions, note them and leave the issue in backlog
- If clean (spec-review `approve` + confidence gate), **move the issue to Todo** — it's prepped and ready to be picked up

**ADR promotion (FAFF-16).** After the spec is attached, run the ADR promotion step — a tail step that never blocks prep and writes **no** repo files (prep stays tracker-only; the ADR is materialised later by `/faff-graft`, which owns the feature branch, so it ships in the PR with the code):

1. Resolve `mode := faff config get adr.mode` (default `offer`). If `off` → skip.
2. **Candidates** = the spec's `**Chosen:**` decisions that are *architecturally significant* — cross-slice and durable (constrains future slices), not local. v1 does **not** auto-classify; surface only decisions the spec already frames as significant. If none → skip.
3. **Interactive:** `surface` → list the candidates (one line each) and stop. `offer` → a human-gated y/n per candidate; keep the confirmed set.
4. **Autonomous (appetite-gated** — gateway → **Appetite for destruction**, the same dial that gates discovered/chain-gap auto-create): `low`/`medium` → surface only (list in the prep log, promote nothing); `high`/`full` → record every significant candidate (the ADR ships in the PR, so it is reviewable + revertible — not a side-effect outside the PR flow).
5. **Record** the confirmed promotions as a tracker comment headed `## ADR promotion intent`, listing each decision (its title + the spec section it came from). `/faff-graft` reads this and materialises the ADRs on the feature branch via `faff adr new`. Prep writes nothing under `docs/adr/`.

This is the L3 "offer + write-on-confirm" rung (the write deferred to graft); L4 (require-before-admit) is FAFF-9's.

**Step 3: Chain to build**

**Crank-up gate (only when the ticket is not automation-eligible).** Before the build gate, present a **standalone** decision of its own — *"FAFF-XX isn't automation-eligible. Make it automatable now (add `faff-automate`), or leave it? (crank up / keep)"*. This is the natural moment to ask: the spec is freshly attached, so "should this now be automatable?" is answerable. On **crank up** → this is **advisory (FAFF-218)**: the eligibility labels are tracker-owned (the faff CLI refuses to write them), so **tell the human to add `faff-automate` to the ticket in the tracker** (one click on the board) — never run `faff label` for it — log the advice per the shared **Unpark protocol** shape, then continue to the build gate. **If the ticket is not-eligible because it carries `faff-automation-hold`** (a hard stop), say so — cranking up won't override it; removing the hold is the human's tracker toggle too. On **keep** → leave eligibility unchanged and continue. **Never fold this into the build gate** (gateway → **Chaining pattern**: a dedicated decision, not bundled into another choice), and **never auto-crank-up** — eligibility stays human-gated (gateway → **Automation eligibility → Release / crank-up**). If the ticket is already eligible, skip this gate. *(Crank-up-only: cranking down an eligible ticket is `/faff-jot` crank up/crank down and `/faff-tidy`'s job, not prep's.)*

The next step offered here aligns with `faff next` (gateway → **Next-step transition**) on the freshly-attached spec's state — a `high` spec on a Todo issue returns `graft` (offer build), a retained `medium` returns `needs-human` (flag, don't offer auto-build). Consult it rather than re-deriving the mapping; the gate below stays the human decision (`faff next` reports, it never gates).

Then the build gate — a separate yes/no, confidence-aware:

> **`confidence: high`:** "Prepped and moved to Todo. Start building now via `/faff-graft`? (y/n)"
> **`confidence: medium`:** "Prepped at medium confidence (N open punt(s) / thin rationale: …). Moved to Todo but flagged for review. Resolve the open items now, or build anyway? (resolve/build/leave)"
> **`confidence: low`:** "Prepped at low confidence — explore couldn't resolve [the core question]. Resolve it together now, or park for later? (resolve/park)"

On `high` confirm (or `medium` → `build`), invoke the `faff-graft` skill via the Skill tool (resolve per gateway → **Sibling-skill invocation**) on `ISSUE-XX` in the same conversation — **only on this standalone affirmative; the build decision is never bundled into the spec-resolution choice** (gateway → **Chaining pattern**). On `medium` → `resolve` (or `low` → `resolve`), walk the open punts/unknowns with the user and re-attach, then **re-present this standalone build gate** — resolving a punt is not itself build consent. On `medium` → `leave`, stop — the spec stays on the tracker at its retained `medium` rating, which `/faff-wtf` surfaces as `needs-decision-first` (no park label needed; it's attached-pending-review, not parked). On `low` → `park`, **apply the shared Park / Unpark protocol** (gateway): tag `faff-parked` via the op (`faff label add <issue> faff-parked`), record `disposition:"parked"` on the attach-state marker (so `prepcheck` doesn't false-block a by-design non-attach), and log the cause, so `/faff-wtf`'s _Parked work_ section resurfaces it for the manual user. Interactive parks must carry the label just like autonomous ones — otherwise a hand-parked spec silently disappears.

### Scenario B: Resume (existing spec found)

The ticket already has a spec from a previous prep session. Apply the shared **Spec discovery** rule (the sibling `faff/SKILL.md`) — check tracker comments, the main description, and committed `docs/` paths. Any hit counts.

**Step 1: Restore working state** — pull the spec from whichever source had it. If multiple sources exist, use the most recently modified one and note the others in the log. **Note the spec comment's timestamp** — you'll use it in the next step.

**Step 2a: Scan comments since the spec for substantive thread changes.** Fetch all comments on the issue (whichever tracker MCP is configured) and look at every comment posted **after** the spec comment. Categorise each:
- **Challenge** — questions, pushback, or new constraints that contradict or undermine a decision in the spec ("this won't work because…", "we now need to support X", "Y was deprecated since you wrote this").
- **Resolution** — decisions or answers that close out a Punt/Assumes/TBD marker in the spec, or otherwise commit to a direction the spec left open.
- **Context** — substantive information that doesn't challenge or resolve but is worth knowing while building: a relevant link, a related discovery, a constraint to watch out for, a stakeholder note. Doesn't force re-prep but **must be surfaced** to the user (interactive) or carried into the spec annotations (autonomous refresh) so it doesn't get lost.
- **Noise** — status pings, "+1", "any update?", unrelated chatter. Ignore.

If any challenge or resolution exists, the spec is **out of date** even if the codebase hasn't moved — the conversation has. Treat this exactly like a stale-spec finding: the spec must be re-prepped (or refreshed) to incorporate the comment thread before any build can proceed. Context-only comments do not force re-prep but should be appended to the spec as an annotation block (and shown in the brief). Log each challenge / resolution / context entry with its commenter, timestamp, and a one-line summary.

**Step 2b: Validate freshness against the codebase** — read the spec against the current code state. Check: have dependencies shipped since this was scoped? Has the codebase changed in ways that affect the spec? Are the technical decisions still valid? If stale: flag what changed and why it needs updating.

**Step 3: Brief the user** — present a concise summary:
- What this ticket is about
- The proposed design approach (from the spec)
- Key technical decisions already made
- **Comment-thread state since the spec** — list any challenges, resolutions, and context items found in Step 2a (or "none" if clean). Context items are surfaced too so the user sees them; they don't block build by themselves.
- Artifact state: fresh / fresh-with-context / stale-by-codebase / stale-by-discussion / both, and why
- Estimated scope/complexity

If Step 2a surfaced challenges or resolutions, the default action is **iterate** — the user shouldn't be offered `build` until the spec absorbs the thread. Context-only threads do not force iterate; the user can still pick `build` knowing the context.

Then offer a three-way choice (not passive text):

> "What next? (iterate / build / park)"

- **iterate** — revise the spec (loop back to Step 2 of Scenario A)
- **build** — invoke the `faff-graft` skill via the Skill tool on `ISSUE-XX` (only if spec is fresh)
- **park** — stop here; apply the shared Park / Unpark protocol (tag `faff-parked`, log the cause) so `/faff-wtf`'s _Parked work_ section resurfaces it. The spec stays on the issue.

### Scenario C: Starting an issue (deferred to graft)

When the user says "I'm working on ISSUE-XX" or picks an issue from the catch-up, use `/faff-graft` instead. Graft enforces the prep gate and handles worktree creation and status transitions.

## Re-prepping

At any point, the user (or `/faff-graft` mid-build) can say "reprep this" or "update the spec":

- Produce the revised spec → replace on the issue immediately
- Add a note: "Revised on [date] — [brief reason]"
- If the issue was already in Todo, it stays in Todo

## Where Artifacts Live

| Phase | Location | Purpose |
|-------|----------|---------|
| Prep | Issue tracker (comments) | Persistent, survives across sessions. Source of truth until build begins. |
| Build | Feature branch, under the configured **Spec docs path** (default `docs/specs/`) | Committed by `/faff-graft` as first commit. Ships with the PR. |
| Merged | Main branch, under the configured **Spec docs path** (default `docs/specs/`) | Living documentation of design intent. |

The spec is **never** committed during prep. It only enters the repo when building begins.

## Tracker-less (git-only) mode

When no tracker MCP is available (gateway → Configuration), there is no issue to comment on — so prep can't attach the spec the usual way. **Everywhere this skill says "attach the spec as a tracker comment", write it instead to `.faff/specs/<issue-id>.md`** (the git-only spec store, gateway → **Spec discovery** location 4). It's gitignored, so the spec stays out of the repo until `/faff-graft` commits it to the feature branch — preserving "the spec ships with the PR" (above). Do **not** delete it after writing.

Everything else is unchanged: the producer still runs, marker validation and the confidence gate still apply, and the prep log still records the outcome. The tracker-state moves become no-ops — there's no Todo column to move to and the `faff label add` op's tracker write is a no-op with no tracker MCP, so a `low`-confidence park is recorded in the prep log only (and the spec is simply left in `.faff/specs/` for a human or a later pass). The chain-to-build gate is unchanged: on confirm, `/faff-graft` reads the spec from `.faff/specs/`.

## Autonomous Mode

When invoked autonomously (by `/faff-beep-boop` during a prep queue drain, or by `/faff-graft` mid-build for respec), follow the shared autonomous contract (see the sibling `faff/SKILL.md`) and these specifics:

**Automation-eligibility gate (runs first).** Before either path, check the shared **Automation eligibility** rule (gateway). If the issue is **not automation-eligible** — compute `faff eligible` from its labels (`faff-automate` / `faff-automation-hold`) + `automation_default` — **skip it entirely**: do not run the already-shipped scan, do not spec, refresh, or promote. The labels passed to `faff eligible` here are the issue's **at-the-gate read** — prep fetches the issue fresh at entry, and that fetch is the gate's label source (gateway → **Re-ground before gate**); if a refresh path spans turns, re-read the labels before this gate rather than reusing the entry snapshot, so a human cranking the issue up between turns is honoured. Return the `ineligible` disposition (below). A not-eligible issue is **not** `parked` (it was never attempted and never enters the run-ledger); `/faff-beep-boop` surfaces it in the On-hold bucket, not Parked. Never add `faff-automate` or remove `faff-automation-hold`.

Two allowed auto-spec paths. Both invoke the shared subroutine documented immediately below at the points named in their respective sections.

### Shared subroutine: already-shipped scan + premise-superseded gate

Both autonomous paths invoke this subroutine at the explicit step boundary documented in their sections. The subroutine asks: *given Done sibling tickets in the same project, is this spec's premise still load-bearing?* The answer routes the spec down park / narrow / proceed.

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

The substantial / partial / not-at-all judgement is the prep agent's call, backed by the explicit audit trail (the cited Done tickets and matched surface area) so a reviewer can check the call.

**Orthogonal to the existing confidence gate.** This gate fires *before* the confidence + marker validation gate at the end of Path 2 below (the `confidence: high / medium / low` bullets). Both gates must pass for the spec to attach. They evaluate different signals at different points — the premise gate asks "is the spec's motivation still load-bearing?", the confidence gate asks "is the spec internally well-formed?". Neither subsumes the other.

**Park-protocol compatibility.** `premise-superseded` parks apply the standard `faff-parked` label per the shared park protocol below. Downstream surfacers (`/faff-wtf`, `/faff-beep-boop`) carry the cause string transparently — no special handling there.

### Path 1 — Stale-refresh (existing spec on the ticket)

**Always run the post-spec comment scan first** (Scenario B Step 2a in the interactive flow): fetch all comments after the spec, classify each as challenge / resolution / context / noise. Treat any challenge or resolution as a freshness trigger equivalent to codebase drift. Context-only threads are not a freshness trigger on their own, but **must be carried into the refreshed spec as an annotation block** so the information survives — never silently drop them. (This scan is prep's discharge of the steer-loop re-read in gateway → **Human curation is authoritative** assertion 2: a human's mid-flight comment is authoritative control input, folded in before re-rating, never silently overridden.)

**Then run the shared already-shipped scan + premise-superseded gate** (above): **Park** (substantially delivered) exits Path 1 immediately, citing Done ticket IDs in the park comment; **Proceed** (premise holds) continues unchanged; **Narrow** (partially delivered) is handled per the subroutine — for Path 1 that means refreshing in place with the self-review exempted. Continue Path 1 on the narrowed scope.

If an existing spec is present and:
- The original design decisions still hold against the current codebase **and** against any post-spec challenges/resolutions
- Changes are limited to shipped blockers, minor drift, context comments to fold in as annotations, or comment-thread resolutions that close out an existing Punt/Assumes — none of which invalidate the approach

→ produce a refreshed spec with changes annotated (cite each post-spec comment that drove a change or was folded in as context), **re-stamp the provenance line** (fresh `date` + currently-resolved `producer`/`adaptor`, `mode := autonomous`; see _Provenance stamp (populate at attach)_), **validate per the _spec contract_** (every decision section has a canonical marker), **re-run the Spec-review gate** on the refreshed spec (a substantive refresh can change the approach, so the retained verdict is re-earned — route per that section; a non-`approve` parks/loops rather than silently reattaching), then reattach to the issue and keep it where it is (Todo stays Todo).

If refreshing the spec would require changing an architectural decision, a core interface, or the overall approach — including when a post-spec comment **challenges** a core decision — → **park** (not a safe auto-refresh; the conversation needs human resolution).

If the refreshed spec fails marker validation → **park** with cause "spec contract violated — missing Chosen/Decision/Punt markers".

### Path 2 — Fresh-spec (no existing spec)

Always delegated to the `spec` slot (default `faffter-noon-spec`) — autonomous never parks merely because no `spec` override is configured; the default producer always exists.

**Step 0 — architecture proposal (conditional).** Run the shared **Architecture proposal step** (above) on the issue + explore findings, immediately before spec production. The autonomous path is the one that feeds the holdout consumers, so this invocation is load-bearing — a fired trigger's validated proposal block becomes spec-producer input carried verbatim into the spec; a failed dispatch/fold degrades loud and never parks.

**Step 1 — produce the spec.** Invoke the `spec` slot, passing the _spec contract_ in the instructions. The producer runs its own clean-context self-review and returns the spec body, the review findings + resolutions, and a `confidence:` self-rating at the end of its output. (The self-review and the self-rating downgrade rule live in the producer — see `faffter-noon-spec/SKILL.md` → _Self-review before returning_.)

**Step 2 — run the shared already-shipped scan + premise-superseded gate** (above) on the just-produced spec: **Park** (substantially delivered) exits Path 2 immediately, citing Done ticket IDs in the park comment; **Proceed** (premise holds) continues to Step 3; **Narrow** (partially delivered) is handled per the subroutine — for Path 2 that means re-invoking the producer on the narrowed scope (its self-review fires). Continue to Step 3.

**Step 3 — validate and gate the spec.** **Write the attach-state marker the instant the producer returned** (`attached:false`, before any rendering — see _Attach-state marker (write at produce time)_ above), then **write the provenance stamp under the H1** (`mode := autonomous`; see _Provenance stamp (populate at attach)_ above), then run marker validation per the _spec contract_. (Flip the marker to `attached:true` on each successful attach below; on either `park` outcome record `disposition:"parked"`.) The producer already ran its clean-context self-review and returned a `confidence:` self-rating in Step 1 — prep does **not** re-review; it trusts the producer's rating (the producer is responsible for its own quality bar) and logs the returned review findings. The rating means:

- `high` — every non-trivial decision has a `**Chosen:**` marker with rationale, no `**Punt:**` escalates a genuine product/architecture question, the ACs are concrete and testable, and the self-review surfaced no `blocker` / fewer than 3 `major`.
- `medium` — mostly clean but 1–2 substantive `**Punt:**` markers, thin rationale a human would want to weigh in on, or a self-review that forced a downgrade.
- `low` — multiple `**Punt:**` markers, intent the explore couldn't pin down, or a self-review `blocker` that needed architectural reframing.

**Run the Spec-review gate** (the approach-critique consumer-fold above) on the attached spec, **after** the confidence rating and **before** promotion — invoke `slots.spec_review`, parse its `faff-contract:spec-review-verdict` block, pipe it to `faff contract spec-review-verdict`, and route on the verdict: `revise` / design-lens `reject-approach` loop in place (cap 2 iterations), a methodology-lens (or multi-lens) `reject-approach` parks for `/faff-plot`, and `needs-human` or a contract failure (exit 1/2) parks. Only an `approve` verdict (retained as `spec-review: approve` on the spec) clears this gate; it then composes with the confidence gate below — **both** must pass to promote.

Apply the gate to the producer's output:

- `confidence: high`, marker validation passes, **and** spec-review `approve` → attach to issue (rating + verdict retained on the spec), move to Todo, return `promoted`
- `confidence: high` **but** marker validation fails → **park** with cause "spec contract violated — missing Chosen/Decision/Punt markers"
- `confidence: medium` → attach to issue **with the `confidence: medium` line retained**, move to Todo, return `promoted-needs-review`. Do **not** strip the rating — it is the re-spec signal: the routing verdict for a retained `medium` is `needs-decision-first` (gateway), so an autonomous run gives it a resolve-attempt and otherwise surfaces it in `/faff-wtf` rather than auto-building. The spec is visible on the tracker for a human to read, resolve the open punts, and bump to `high`.
- `confidence: low` → **park** with cause "low confidence — explore could not resolve core questions"

### Park protocol

Follow the shared park protocol (see the sibling `faff/SKILL.md`):
- Post a tracker comment with cause (e.g. "low-confidence fresh-spec", "architectural change required in refresh")
- Tag the issue `faff-parked` via `faff label add <issue> faff-parked` and its descriptor's write (gateway → **Control-label provisioning**)
- Log to `.faff/logs/YYYY-MM-DD/HHMMSS-prep-ISSUE-XX.md` with the full reasoning

### Return values

Return to caller one of:
- `refreshed` — spec updated, issue stays in Todo
- `promoted` — fresh high-confidence spec attached, issue moved to Todo (build-eligible)
- `promoted-needs-review` — medium-confidence spec attached (rating retained) and moved to Todo; visible for human triage but **not** build-admitted — its routing verdict is `needs-decision-first`
- `ineligible` — the issue is **not automation-eligible** (no `faff-automate` under the opt-in default, or it carries `faff-automation-hold`); skipped without speccing or promotion (see **Automation-eligibility gate** above). Not `parked`, not attempted, not in the run-ledger; surfaced in the On-hold bucket. No `faff-parked` label is applied and the eligibility labels are left untouched.
- `parked` — see park cause in log (low confidence, contract violation, or architectural change needed)
- `errored` — something went wrong (MCP failure, unexpected state); treated as park for purposes of the run

## Notes

- When a `methodology` slot is configured, prep appends a `## Methodology critique` block to every prepped spec (invoking the methodology for issue-level findings). In autonomous prep the critique is written but does not block confidence-high promotion.
