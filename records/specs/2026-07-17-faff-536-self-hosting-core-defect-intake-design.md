# FAFF-536 — Self-hosting core-defect intake: orchestrator-lane capture now, a classification-not-floor-change lane pending human sanction

> Spec: faffter-dark-nlspec · 2026-07-17 · autonomous · confidence: medium. Full spec on Linear FAFF-536.

Spec for FAFF-536 ("Scope-containment hard floor makes execution-discovered faff-CORE defects near-unfileable when dogfooding"). Audience: the build agent and the human reviewer who must resolve the one governing Punt before the second phase is buildable. This is a **design-tension ticket**: the spec closes what is closable autonomously (orchestrator-lane discovered-scope capture, and the full mechanism design for a self-hosting intake lane) and punts the one thing that is genuinely the human's — whether to sanction the lane at all.

## 1. WHY — Problem and Principles

**Load-bearing model.** faff's containment gate answers one question — is the discovered item's intended parent inside the subtree of the run's *mandate*? — and the hard floor says an `outward` item is never auto-filed at any appetite. In a self-hosting repo (faff building faff), a core defect discovered while building ticket X is almost always outside X's subtree, so *every* core-defect discovery classifies `outward` and falls to human `/faff-jot`. The tension is not that the floor is wrong; it is that "outward" conflates two different things: **spawning new product scope in someone's roadmap** (what the floor exists to prevent) and **recording an observed defect into the same repo's own designated intake bucket** (execution-side bookkeeping). This spec (a) closes the capture gap that made FAFF-531 invisible to the run entirely, and (b) designs — but does not self-sanction — a bounded reclassification for the second case.

**Problem statement.** During run-20260716-152942-beepboop-full, three genuine faff-core defects (FAFF-531/532/533) were discovered by the run but none were auto-filed: two were build-lane discoveries classified `outward-new-root` (surface-only), and one (FAFF-531) was hit by the *orchestrator* lane, which has no discovered-scope capture path at all. The bottom-up "self-extend from doing" tributary is nearly inert for faff-on-faff.

**Design principles.**

**The floor is never edited; classification is.** The hard floor ("outward-new-root is never auto-filed at any appetite including `full`") stays byte-identical in the gateway, beep-boop, and tidy. Any relaxation is expressed as a *new classification* an item can earn before the floor is consulted — a same-repo core-defect that qualifies is not `outward-new-root`; everything that is `outward-new-root` still hits the floor. An implementation that weakens the floor prose or adds an appetite that files outward items is invalid.

**`faff contain` stays pure and repo-blind.** The primitive walks tracker-ancestor ids and knows nothing of repos or teams (region header, `contain.js`). The self-hosting signal is a *wiring-layer* input at the chokepoint, exactly as the project-mandate autonomous ceiling is ("a wiring-layer policy, NOT a primitive gate"). An implementation that teaches `subtreeContains` about repos is invalid.

**ADR-0069 compatibility is argued, not assumed.** ADR-0069 draws the line at EXECUTION-autonomy on faff (in-policy) vs DIRECTION-autonomy (out-of-policy). Filing a Backlog ticket that *records an observed defect* into the repo's own `faff-jot-intake` bucket — deduped, appetite-gated, never promoted past Backlog, never specced or built without the normal human-admitted eligibility gate — is bookkeeping of an observation, not direction-setting: it decides nothing about what faff becomes; the human still shapes, gates, and admits it (or deletes it) exactly as with a hand-jotted note. That is the spec's framing; whether the human *accepts* that framing is the governing Punt below. The relaxation-of-a-safety-floor decision is deliberately not closed here.

**Capture is cheaper than filing and requires no sanction.** Recording what the orchestrator hit (a JSON entry in the run dir) expands no scope and creates nothing in the tracker; it merely makes the existing surface-only path reachable for orchestrator-lane discoveries. It ships regardless of the Punt.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/contain.js` | JS | The pure containment primitive + `--record` detective control; unchanged by this spec |
| `plugin/skills/faff/bin/lib/run-outward.js` | JS | SelfRef precedent: `self.is_self := target.repo == tracking.repo` — the existing repo-slug self-comparison shape (solves a different problem; borrowed as structure only) |
| `plugin/skills/faff-beep-boop/SKILL.md` (§ Containment at the filing chokepoint) | prose | `autonomous_file_check` — the single chokepoint both create paths call; where the new classification slots in |
| `plugin/skills/faff/SKILL.md` (Appetite hard floor, ~line 706/734) | prose | The floor rows this spec must leave intact |
| `plugin/skills/faff-graft/SKILL.md` (§ Discovered scope, ~line 411) | prose | The implementor-lane capture whose entry shape the orchestrator lane mirrors |
| `plugin/skills/faff/bin/lib/intake-provenance.js` | JS | `INTAKE_VIA` closed set (`jot`\|`backfill`\|`fast_track`) + `initiated` audit field |
| `records/adr/0069-*.md` | ADR | The self-hosting posture the lane must be argued against |

**Scope statement.** This sits in the scope-containment family (FAFF-217/219/220/221/222/354) as its self-hosting adjunct: one new capture site in the orchestrator lane, and one designed-but-gated classification at the existing chokepoint.

## 2. OUT OF SCOPE

- **Auto-promotion of intake-filed defects** — a self-intake ticket lands in `Backlog` with no `faff-automate` label; making it eligible for autonomous build stays the human's tracker-UI act (FAFF-218 tracker-owned labels). Extension point: none needed — the existing eligibility gate already covers it.
- **Cross-repo / adopter-repo outward relaxation** — an item whose target is a *different* repo/team is the exact case the floor exists for; no mechanism here touches it. Extension point: the classification predicate in `autonomous_file_check` (HOW step 2) is where any future policy would be argued — via its own ADR.
- **Verifying `--ancestry` truthfulness** — the FAFF-354 trust boundary (agent-sourced ancestry, detective-not-preventive `--record`) is unchanged; the self-hosting signal below inherits the same boundary. Extension point: `faff audit` recompute-and-compare.
- **Auto-revert / reopen on post-merge failures** — graft's seam (b), unrelated. Extension point: `faff-graft` Step 10.
- **A new appetite dial or level** — self-intake filings ride the existing Execution-discovered row. Extension point: the gateway appetite table, only if a future ADR demands separate gating.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| mandate | The container the run was dispatched to deliver; the subtree root for containment |
| outward-new-root | Existing classification: intended parent outside the mandate subtree → surface-only, hard floor |
| self-intake | New classification (this spec): an outward item that qualifies for the self-hosting core-defect lane → fileable to the intake bucket, appetite-gated |
| intake bucket | The repo's own designated landing zone for autonomous defect records: `Backlog` status + `faff-jot-intake` label (+ `faff-chain-gap-fill` is NOT applied — this is not a chain gap) |
| orchestrator lane | beep-boop/tidy/prep steps executed by the orchestrator itself, as distinct from the graft/implementor lane |

**Config surface (new key).**

```
containment:
  self_hosting_intake: false   # boolean; default false (lane off — today's behaviour byte-identical)
```

Read via `faff config get containment.self_hosting_intake` through the default-aware registry (FAFF-182 shape; dotted keys are established — `tracking.repo` is a registry key — and the new key gets its own registry entry with baked default `false`, as `intake_gate` and `logging` have). Absent key ⇒ `false` ⇒ the entire self-intake branch is dead code at runtime.

**DiscoveredScopeEntry (extended, both lanes).** The existing entry shape gains one containment token and one source value; existing fields unchanged:

```
RECORD DiscoveredScopeEntry:
  title: String
  description: String
  relationship: "none" | "blocks" | "blocked-by" | ...   # as today
  source: <existing graft source values, e.g. "post-merge"> | "orchestrator"   # + "orchestrator" (new); existing values unchanged
  source_ref: String            # for orchestrator lane: the step/command that hit the defect
  confidence: "concrete" | "vague"
  containment: null | "contained" | "outward-new-root" | "outward-self-intake"   # + last token (new)
```

**Orchestrator-lane capture site (new).** `.faff/runs/<run-id>/orchestrator/discovered-scope.json` — same array-of-entries file format as the per-issue implementor files. Written by the orchestrator (beep-boop, and tidy/prep when running inside a full-pipeline run) whenever a faff-tooling defect is hit *by the orchestrator itself* (a CLI command misbehaving, a config round-trip failing, a skill-prose contradiction blocking a step) and the run can continue or park around it. Outside a run (standalone tidy with no run-id): `.faff/logs/YYYY-MM-DD/HHMMSS-<skill>-discovered-scope.json`, mirroring graft's outside-beep-boop fallback.

**Provenance stamp (self-intake filings, phase 2 only).** `faff intake-record <new> --via jot --initiated autonomous` — identical to the chain-gap auto-fill stamp. No new `INTAKE_VIA` value: the closed set stays closed; the distinguishing durable signal is the `faff-jot-intake` label plus the `containment: "outward-self-intake"` token in the run's discovered-scope record and the containment-check RunEvent trail. (Rationale in §6 — provenance-stamp decision.)

**Design decisions** (rationale collected in §6):

- **Chosen:** Sanction the self-hosting intake lane — the lane is sanctioned; phase 2 builds. The load-bearing guardrails hold: config opt-in (`containment.self_hosting_intake`, default off) AND the same-repo/team structural check, deduped, appetite-gated, expressed as the NEW `outward-self-intake` classification that leaves the appetite hard floor and `contain.js` byte-identical. A sanctioning ADR — framed per ADR-0069 as execution-side bookkeeping (auto-recording a discovered defect), not direction-setting — is authored at build time (graft Step 4b) BEFORE the lane's code lands; that ADR authoring is a DoD item, not a spec blocker. Resolved by human decision 2026-07-17 (sanction phase 2 — build both phases).
- **Chosen:** If sanctioned, the relaxation is a **new classification (`outward-self-intake`) computed at the chokepoint**, never an edit to the floor or to `contain.js` — the primitive's verdict stays `outward`; the wiring layer reclassifies before the floor is consulted.
- **Chosen:** The self-hosting signal is **config opt-in AND structural check**: `containment.self_hosting_intake: true` in `.faffrc` (explicit, default off) *and* the candidate targets the same tracker team as the mandate (both resolve to the configured `tracking` team/repo — the run-outward SelfRef comparator shape). Neither alone suffices.
- **Chosen:** Destination and gating: intake-bucket filing (`Backlog` + `faff-jot-intake`), deduped against open `faff-jot-intake` and `faff-chain-gap-fill` tickets by title/subsystem match, gated by the **existing Execution-discovered appetite row** (`low` surface-only; `medium` methodology-gated; `high`/`full` file), stamped `--via jot --initiated autonomous`.
- **Chosen:** **Orchestrator-lane capture ships unconditionally** (phase 1): write-site + entry shape above, consumed by beep-boop's existing file-discovered-scope step exactly as implementor-lane entries are. It composes with the lane but requires neither the lane nor the Punt's resolution.
- **Assumes:** `tracking.repo` and the tracker team are configured in `.faffrc` (true for this repo: `shftwst/faff`, team Faff) — the structural half of the self-hosting check has nothing to compare without them; validate with `faff config get tracking.repo` before building phase 2.
- **Assumes:** `faff-jot-intake` exists in the `faff labels` manifest as a machine-writable (non-`tracker_owned`) label — verified true today (gateway ~line 816); validate with `faff labels --names` before relying on it.

## 4. HOW — Behavior

### Phase 1 — orchestrator-lane discovered-scope capture (unconditional)

Plain-English summary: give the orchestrator the same "write it down, file-or-surface later" memory the implementor already has, so an orchestrator-hit defect (the FAFF-531 class) at minimum reaches the run summary and `/faff-wtf` §4 instead of vanishing.

```
PROCEDURE orchestrator_capture(run_id, step_ref, defect):
  1. Compose a DiscoveredScopeEntry:
     source: "orchestrator", source_ref: step_ref (the command/step that hit it),
     confidence: "concrete" only when the failing command + observed-vs-expected are both nameable,
     else "vague"; containment: null (assigned later at the chokepoint, same as build entries)
  2. Append to .faff/runs/<run-id>/orchestrator/discovered-scope.json
     (create dir/file on first entry; standalone-skill fallback path per WHAT)
  3. Continue the interrupted step (capture never parks, retries, or fixes —
     the existing park/retry logic is untouched; capture is a side-record)
```

Consumption: beep-boop's file-discovered-scope step (the FAFF-221 chokepoint walkthrough, steps 1–6) additionally reads `orchestrator/discovered-scope.json` alongside the per-`<ISSUE>` files. The **mandate for orchestrator entries is the run's dispatch container** — the same containment question, asked with the run-level mandate instead of a per-issue one; with the self-intake lane unbuilt they will classify `outward` and take today's surface-only branch (step 6): run-summary section, `/faff-wtf` §4, and a comment on… no mandate *issue* exists for orchestrator entries, so the comment target is the run summary only (skip the per-issue comment; the summary + wtf are the sanctioned surfaces). `vague` entries surface-only, as everywhere.

**Edge cases.**
- Duplicate hits of the same defect within one run (the orchestrator retries a failing command): dedupe on append by (title, source_ref) — one entry per distinct defect per run.
- Run dir absent (capture attempted before run init): fall back to the standalone `.faff/logs/...` path; never throw away the entry, never fail the step over bookkeeping.
- Malformed existing JSON in the capture file: on an unparseable file at append time, move it aside to `discovered-scope.json.malformed-<ts>` (evidence preserved, never silently overwritten) and start a fresh file; surface the move in the run summary. Capture must never block the run; evidence must never be silently destroyed.

### Phase 2 — the self-intake classification (sanctioned 2026-07-17; builds in this ticket, gated only on the build-time sanctioning ADR)

Plain-English summary: at the single filing chokepoint, after `faff contain` says `outward`, ask two more questions — is the lane switched on, and is this the same repo's own backlog? — and only if both hold, treat the item as fileable-to-intake instead of surface-only. The floor is consulted after classification and still catches everything else.

```
PROCEDURE autonomous_file_check(mandate, candidate, run_id, phase):   # delta only
  ...existing steps 1-4 unchanged (fetch ancestry fresh, faff contain --record)...
  5. outward (exit 3):
     a. IF config containment.self_hosting_intake != true → outward-new-root branch (today's step 5, unchanged)
     b. IF candidate's intended home is NOT the mandate's own tracker team/repo
        (compare both against the configured tracking team — the SelfRef comparator shape;
         fail-closed: any unresolvable side → NOT self)             → outward-new-root branch
     c. IF candidate.confidence != "concrete"                        → surface-only (vague never files)
     d. ELSE classify containment: "outward-self-intake":
        i.   dedup against open faff-jot-intake + faff-chain-gap-fill tickets (title/subsystem);
             dup → record + surface, create nothing
        ii.  appetite gate: existing Execution-discovered row (low → surface-only;
             medium → file only with opinionated methodology; high/full → file)
        iii. file: status Backlog, label faff-jot-intake (faff label add), NO faff-automate,
             description = entry description + "discovered during <run-id>/<source_ref>" provenance
             line + back-link to the mandate; relationship link only when the entry names one
        iv.  stamp: faff intake-record <new> --via jot --initiated autonomous
        v.   record the containment-check RunEvent as today (--record already ran in step 2-4);
             append the classification outcome to the run's discovered-scope record
```

**Behavioural invariants (both phases).**
- The hard-floor prose in gateway/beep-boop/tidy is edited only to *name the new classification's existence and its gate* (one sentence each, pointing at the chokepoint procedure) — the "outward-new-root is never auto-filed at any appetite" sentence itself is not weakened, reworded, or conditionalised.
- `contain.js` and `subtreeContains` are byte-identical (their selftests pass unchanged).
- With `self_hosting_intake` absent/false, every path is byte-identical to today — provable by running the existing chokepoint flow against the same inputs.

**Failure modes.**
- **The lane files junk** (concrete-looking non-defects accumulate in Backlog). How you'd know: `faff-jot-intake` tickets the human deletes/cancels rather than shapes — watch the ratio over the first few runs. What it means: tighten the `concrete` bar or the dedup, or (the named valid outcome) switch the lane back off; the config default-off makes retreat a one-line revert.
- **The self-check is confabulable** (agent-supplied ancestry/team data games rung b). How you'd know: `faff audit` recompute-and-compare over the recorded RunEvents (FAFF-354 — the detective control already binds the payload). What it means: same trust boundary as all of containment; acceptable by prior decision, not new exposure.
- **Orchestrator capture produces noise, not signal** (every transient hiccup becomes an entry). How you'd know: run summaries whose discovered-scope section dwarfs the shipped section. What it means: narrow the capture trigger to reproducible command failures; capture volume is observable per-run from day one.

**Anti-pattern:** implementing the self-intake lane behind the config key *before* the Punt is resolved, on the theory that default-off is harmless. Why: shipping the mechanism is itself the decision-shaped act ADR-0069 reserves for the human; dead code that relaxes a floor invites a silent flip. The lane's code lands only with the sanctioning ADR.

**Anti-pattern:** routing self-intake filings through `--via fast-track`. Why: the hard-floor bullet explicitly forbids a fast-track self-call converting an outward item; fast-track is the human-override lane and must stay legible as such.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a full beep-boop run in progress
When the orchestrator hits a reproducible faff CLI defect during a pipeline step
  (e.g. a config round-trip command exits non-zero with wrong behaviour)
Then an entry {source: "orchestrator", confidence: "concrete", source_ref: <the step>}
  exists in .faff/runs/<run-id>/orchestrator/discovered-scope.json
  and the interrupted step's own park/retry behaviour is unchanged
```

```
Given orchestrator-lane entries captured in a run, with the self-intake lane unbuilt (or off)
When beep-boop's file-discovered-scope step runs
Then each concrete orchestrator entry is containment-checked against the run's dispatch
  container, classifies outward, is NOT filed, and appears in the run summary's
  discovered-scope section (and /faff-wtf §4) with containment: "outward-new-root"
```

Phase 2 (sanctioned; builds in this ticket, gated on the build-time ADR):

```
Given self_hosting_intake: true, appetite high, and a concrete build-discovered defect
  whose intended home is the same tracker team as the mandate, with no matching open
  faff-jot-intake/faff-chain-gap-fill ticket
When autonomous_file_check runs
Then a Backlog ticket is created with label faff-jot-intake, no faff-automate,
  provenance --via jot --initiated autonomous, and the run record shows
  containment: "outward-self-intake"
```

```
Given self_hosting_intake: true
When a concrete outward item targets a DIFFERENT repo/team than the mandate's tracking config
Then it classifies outward-new-root and is never filed at any appetite (the floor holds)
```

- The `contain` selftest suite passes byte-identical after any phase — `subtreeContains` gains no repo concept.

## 6. Design decision rationale

**D1 — Sanction the lane at all?** Options: (a) relax — same-repo core defects auto-file to the intake bucket; (b) keep surface-only — phase 1 alone, humans jot from the surfaced list. Pro (a): the FAFF-531/532/533 evidence — real defects the run could only wave at; the filing is arguably execution-side bookkeeping under ADR-0069 (records an observation; decides nothing; the human still gates everything downstream). Pro (b): the floor's value is its *unconditionality* — every carve-out is precedent for the next; ADR-0069's whole posture is that faff-on-faff errs toward the human; phase 1 alone already fixes the invisibility (the sharpest pain), leaving only a copy-paste-into-jot cost. This is a safety-floor relaxation on the self-hosting substrate — the class of call the operator has explicitly reserved (ADR-0069: "reversible by conscious act, never by default"). **Chosen:** relax the floor via the self-intake classification — sanctioned by human decision 2026-07-17 (build both phases); the sanctioning ADR is authored at build time (graft Step 4b) before phase-2 code lands.

**D2 — Floor edit vs new classification.** Options: (a) add an appetite level / floor exception for outward filings; (b) a new classification computed before the floor applies. (b) keeps the floor sentence unconditioned and auditable, keeps `contain.js` pure, and localises the change to the one chokepoint both create paths already share. **Chosen:** (b) — `outward-self-intake` at the chokepoint; the floor and the primitive are untouched.

**D3 — Self-hosting signal.** Options: (a) infer from `tracking.repo == git remote`; (b) explicit config opt-in only; (c) both — opt-in key AND structural same-team comparison. (a) alone flips the lane on for every adopter's own repo silently; (b) alone lets an opted-in repo file to a *different* team. (c) is fail-closed on either side and reuses the run-outward SelfRef comparator shape (`tracking.repo` as the self oracle). **Chosen:** (c) — `containment.self_hosting_intake: true` (default false) AND same-tracker-team structural check, each fail-closed.

**D4 — Provenance stamp.** Options: (a) new `INTAKE_VIA` value (`self-intake`); (b) reuse `--via jot --initiated autonomous` + the `faff-jot-intake` label + the `outward-self-intake` run record. (a) is the semantically sharpest but expands a closed, schema-versioned set (read-side grandfathering, validator changes) for a signal the label + RunEvent trail already carry durably; chain-gap auto-fill set the precedent for (b). **Chosen:** (b); revisit (a) only if audit queries ever need the via alone to distinguish the lane.

**D5 — Build orchestrator capture unconditionally?** Options: (a) gate it on D1 too; (b) ship it now. Capture writes only run-local JSON, creates nothing in the tracker, and is exactly the "record" half of the record-and-file lane split graft already lives under — no floor, appetite, or ADR-0069 surface. **Chosen:** (b) — phase 1 ships regardless of D1's outcome.

## 7. Open questions and assumptions

**Open questions.**
- **D1 (the governing decision) — RESOLVED 2026-07-17:** the self-intake lane is sanctioned; both phases build in this ticket. The floor argument held — same-repo core-defect records reclassify as intake-bucket bookkeeping (execution-side under ADR-0069), never new roots. Sole remaining build-time artifact: author the sanctioning ADR (graft Step 4b) before phase-2 code lands, then build phase 2 per HOW.

**Assumptions.**
- `tracking.repo` + tracker team configured — validate: `faff config get tracking.repo` returns `shftwst/faff` (non-empty) before phase 2.
- `faff-jot-intake` is a machine-writable manifest label — validate: `faff labels --names` includes it and its manifest row carries no `tracker_owned: true`.

## 8. DONE — Definition of Done

### Phase 1 — unconditional (from HOW: orchestrator capture)
- [ ] Orchestrator-hit reproducible defects append a `DiscoveredScopeEntry` with `source: "orchestrator"` to `.faff/runs/<run-id>/orchestrator/discovered-scope.json` (standalone fallback: `.faff/logs/YYYY-MM-DD/HHMMSS-<skill>-discovered-scope.json`)
- [ ] Capture never alters step outcomes: the interrupted step's park/retry behaviour is unchanged, and a missing run dir or malformed capture file never fails the step (malformed file moved aside to `.malformed-<ts>`, surfaced in summary)
- [ ] Duplicate (title, source_ref) pairs within one run append once
- [ ] beep-boop's file-discovered-scope step reads orchestrator entries alongside per-issue files; each concrete entry is containment-checked against the run's dispatch container with `--record <run-id>`, and (self-intake lane absent) surfaces as `outward-new-root` in the run summary + `/faff-wtf` §4, with no per-issue mandate comment attempted
- [ ] graft's implementor-lane capture and entry shape are unchanged except the widened `source`/`containment` enums; existing entries remain valid

### Phase 2 — self-intake lane, sanctioned 2026-07-17 (builds in this ticket); gated only on the build-time sanctioning ADR (from WHAT + HOW)
- [ ] `containment.self_hosting_intake` resolves through the default-aware config registry; absent/false ⇒ chokepoint behaviour byte-identical to today
- [ ] With lane on: a concrete outward item passes to `outward-self-intake` only when the same-tracker-team structural check also holds; either side unresolvable ⇒ `outward-new-root` (fail-closed)
- [ ] Self-intake filing: `Backlog` + `faff-jot-intake`, no `faff-automate`, dedup against open `faff-jot-intake`/`faff-chain-gap-fill` tickets, existing Execution-discovered appetite row gates it, stamp `faff intake-record <new> --via jot --initiated autonomous`
- [ ] Cross-repo/team outward items are never filed at any appetite (floor scenario passes)
- [ ] `contain.js` selftests pass byte-identical; `subtreeContains` signature and semantics unchanged
- [ ] Hard-floor prose in gateway/beep-boop/tidy names the classification + its gate in one sentence each without weakening the "never auto-filed" sentence
- [ ] The sanctioning ADR exists and is referenced from the chokepoint prose
- [ ] A sanctioning ADR (per ADR-0069's execution-vs-direction line) is authored on the feature branch before any phase-2 lane code merges.

### Integration smoke test
```
1. Start a beep-boop run; inject a failing faff CLI call in an orchestrator step
2. Assert orchestrator/discovered-scope.json contains one concrete entry, run continues
3. Run the file-discovered-scope step; assert the entry surfaces as outward-new-root
   in summary.md and creates nothing in the tracker
4. (Phase 2 only) flip self_hosting_intake: true, re-run step 3 at appetite high;
   assert one Backlog ticket with faff-jot-intake, provenance stamped, dedup on re-run
```

confidence: high
spec-review: approve
