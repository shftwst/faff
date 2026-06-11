# Spec — FAFF-60: Tracker as the lights-out control plane

> Spec: faffter-dark-nlspec · 2026-06-10 · interactive · adaptor: faffidavit-spec · confidence: high. Full spec on Linear FAFF-60.

A new gateway shared-rules section that **names**, as one first-class principle, the externalise-everything-to-the-tracker behaviour that faff already exhibits distributed across its skills — plus a granularity rule that resists tracker-flooding, plus one-line pointers from the skills that leave markers. This is a **consolidation**, not green-field: ~90% of the behaviour already ships (see the reference table in §1 and the rationale in §5).

## Preamble

- **Surface:** the faff prose-contract suite — `SKILL.md` files under `skills/`. The change is **entirely prose**: one new gateway shared-rules section in `skills/faff/SKILL.md`, plus a one-line addition to the existing "Load the gateway first" preamble in the skills that leave markers.
- **No code, no CLI, no config, no new file format.** This spec adds **no** new `faff` subcommand, **no** `.faffrc` key, **no** per-step marker subsystem, and **no** new artefact under `.faff/`. If a build agent reaches for any of those, it has misread this spec — the deliverable is a named principle pointing at machinery that already exists.
- **Mechanism is already settled.** The orchestrator lane (`faff-beep-boop`) files tracker markers; the implementor (`faff-graft`) records-and-returns; `faff-jot` stays interactive-only. This spec composes with **Agent Lanes**, it does not revise it.
- **Buildable in well under a day.** One gateway section (~40–60 lines of prose) plus ~4 one-line pointer additions.

## 1. WHY

### The problem

During a lights-out (`/faff-beep-boop`) run, the human is asleep. When they wake, the **only** record of what the factory did must be **legible and steerable from the tracker itself** — not buried in a hidden internal queue, a `.faff/` log they have to go spelunking for, or the agent's evaporated conversation context. The tracker must be the complete record, the observability surface, **and** the control plane: a place the human can read what happened and *change what happens next* by editing tickets.

faff already does almost all of this. The behaviour exists — but it exists **distributed**: park comments live in one skill's prose, resolve-attempt audit comments in another, the run digest in a third, the steer-loop ("re-read human edits each pass") in a fourth. Nobody can point at "the externalise principle" because it isn't named anywhere. **Chosen:** name it once, as a first-class gateway shared-rule peer to **Agent Lanes** and **Always pull fresh**, so the suite has a single referenceable principle and every marker-leaving skill points back at it.

The second, sharper problem: the ticket's own framing ("**every** work step leaves a marker") taken literally is a **tracker-flooding** trap. If every micro-action became a tracker comment, the control plane becomes unreadable noise — the opposite of the legibility goal. **Chosen:** the principle must carry an explicit **granularity rule** that defines *marker-worthy* narrowly (the meaningful transitions, not every action) and **forbids per-micro-step markers**.

### Design principles (faff tenets this serves)

- **Understandable, not unapproachable.** The whole point: the human can always follow what faff did and why, from the tracker. This principle *is* that tenet applied to lights-out runs.
- **Deterministic tools over prose** — respected by **not** inventing new mechanism: the markers are already left by existing deterministic flows; this is the prose that names them.
- **Adoptable, not all-encompassing** — factory work joins the *same* backlog as human work; no parallel hidden queue the human must learn.
- **Configurable, not opinionated** — density is governed by the *existing* dials (`logging`, `appetite`), not a new knob.

### Reference context

| Ref | What it is | Why it matters here |
|---|---|---|
| FAFF-19 | "Human curation is authoritative" — the *obey* half | FAFF-60 is the *externalise* half: the human can't curate what they can't see/steer. The steer-loop (§3) applies FAFF-19 to factory-created tickets. |
| FAFF-35 | Run observability / logs | The tracker-as-record is the human-legible peer of the `.faff/` logs; the granularity rule routes routine progress to logs, transitions to the tracker. |
| FAFF-43 | Audit trail | Resolve-attempt + appetite audit comments are the audit-trail markers this principle names. |
| FAFF-49 | Sentry | Consumer of the externalised record. |
| Gateway **Agent Lanes** (`skills/faff/SKILL.md`) | "implementor records, orchestrator files" | The mechanism half: who writes markers. This principle states *what* is marker-worthy; Agent Lanes states *who* writes it. |
| Gateway **Always pull fresh** | Re-fetch live state every pass | The steer-loop's primary existing implementation. |
| Gateway **Appetite** / **logging knob** | Density dials | The existing levers the granularity rule names — *not* new ones. |

## 2. OUT OF SCOPE

Each of these is an over-build the ticket's lean scope-decision explicitly excludes. **Chosen** for every line: do not build it.

- **No new CLI subcommand.** No `faff mark`, no `faff marker`, no `faff externalise`. The markers are written through the existing tracker-MCP calls the skills already make.
- **No new `.faffrc` config key.** Density is governed by the existing `logging: full|essential` and `appetite` dials. No `markers:` block, no `marker_granularity:` key.
- **No per-step marker subsystem / "log every micro-action to the tracker" mechanism.** This is the explicit flooding trap; the granularity rule (§3) **rejects** it.
- **No new file format or new `.faff/` artefact.** The run-ledger, `summary.md`, calibration logs, per-issue resume dirs all stay exactly as specified.
- **`faff-jot` does NOT go autonomous.** Its autonomous mode writes to `.faff/intake/`, **never** the tracker. New-work intake stays human-gated. This principle does **not** make jot file tickets unattended.
- **No rebuild of the steer loop.** Always-pull-fresh, wave re-entry + `faff next`, tidy's post-spec comment scan, and prep's stale-refresh already implement re-read-human-edits-each-pass. The principle **names and requires** them; it writes no new fetch/merge mechanism.
- **No re-specification of each existing marker.** The principle cross-references the marker inventory rather than restating each skill's comment format.
- **No change to Agent Lanes, the verdict gate, the park protocol, or the run-ledger invariant.** This principle composes with them; it does not modify them.

## 3. WHAT

### Vocabulary

- **Marker** — a durable, human-legible signal written **to the tracker** (a per-issue comment, a control label, a status move, or the once-per-run digest posted as a tracker status update) that records a meaningful work-step disposition. Distinct from a `.faff/` log entry, which is agent/machine-facing and lives in the repo, not the tracker.
- **Marker-worthy step** — a *meaningful transition or disposition* in the lights-out pipeline, **not** every action. The closed list is in **The granularity rule** below. Routine intra-step progress is **not** marker-worthy.
- **Control plane** — the property that the tracker is not only the *record* but the *steering surface*: a human edit to a ticket (re-prioritise, re-scope, add a comment closing a Punt, change a label, cancel) is read on the next pass and changes what the factory does. The tracker is read-write authority, not a one-way log.
- **Steer loop** — the per-pass cycle: **re-read the ticket's current tracker state + human edits → incorporate them → act**. Already implemented by Always-pull-fresh + wave re-entry + tidy comment-scan + prep stale-refresh.

### The principle statement (the externalise principle)

**Chosen.** During unattended runs the tracker is the **complete human-legible record, control plane, and observability surface** — never a hidden internal queue. Concretely:

1. **Every marker-worthy step leaves a tracker marker.** The meaningful transitions are externalised to the tracker, not held only in agent context or `.faff/` logs.
2. **Factory-created work joins the same backlog as all other work.** Discovered-scope and chain-gap tickets are filed `Backlog` with the same labels/relationships as any other ticket, picked up by the next tidy→prep pass — no special hidden treatment, no parallel queue.
3. **The human can view or alter any ticket, and the next pass incorporates the edit** (the control-plane half — see the steer loop).
4. **Markers are written by the orchestrator lane** (`faff-beep-boop`), per **Agent Lanes** record-and-file; the implementor records-and-returns, the human-via-graft files in interactive runs. `faff-jot` stays interactive-only.

### The granularity rule (THE CRUX)

**Chosen.** "Marker-worthy step" is defined **narrowly** as the meaningful transitions/dispositions that already leave markers — and **only** these:

- **Spec-attach / promote** — `faff-prep` attaches the spec as a comment (with provenance stamp); promotion to Todo.
- **Park** — park comment + `faff-parked` label (any skill, via the shared park protocol).
- **Resolve-attempt-proceed** — the audit-trail comment when autonomous mode infers an answer and proceeds.
- **Appetite-override** — the `(appetite: high)` audit comment when an appetite-influenced decision ships.
- **Discovered-scope / chain-gap filing** — the `Backlog` + `faff-chain-gap-fill` ticket with its provenance line (`faff-beep-boop` step 10; `faff-tidy` chain-gaps).
- **Terminal disposition** — *shipped* (PR + auto-merge status move), *routed-out* (verdict gate), *errored*; surfaced via the **run-summary digest** and the per-issue mechanisms below.
- **The once-per-run run-summary digest** — posted to the tracker as a status update / project comment. One digest per run, not per step.

**Per-micro-step markers are FORBIDDEN.** A tracker comment per file edited, per test run, per intra-build decision, per CI poll — these **flood** the tracker and destroy the legibility the principle exists to protect. Routine intra-step progress lives in **`.faff/` logs + the run digest**, never as a tracker comment.

**The density levers are the EXISTING ones — name them, do not add new ones:**

- **`logging: full|essential`** — governs the narrative `.faff/` log verbosity; the machine/hard-floor and the marker set are unaffected.
- **The appetite dial** — gates whether discovered-scope / chain-gap items auto-*create* (and thus whether a filing marker appears at all).
- **The vague/concrete distinction** — `vague` discovered-scope is **never filed** (it surfaces in the digest only); only `concrete` items become tickets.
- **The run-summary digest** — the once-per-run rollup that carries everything not worth a per-issue comment.

### The steer loop

**Chosen.** Every pass re-reads the ticket's current tracker state + human edits **before** acting and incorporates them. The principle **names and requires** this; it points at the existing implementations and builds nothing:

- **Always pull fresh** — re-fetch live tracker state every invocation; never act on a stale snapshot.
- **Wave re-entry + `faff next`** — each wave re-queries Backlog+Todo and consults `faff next` per newly-unblocked item.
- **tidy post-spec comment scan** — challenges/resolutions/context comments fold into the spec.
- **prep autonomous stale-refresh** — re-checks post-spec comments and refreshes before any build.

This is **FAFF-19's "human curation is authoritative" applied to factory-created tickets**: a human edit to *any* ticket — including one the factory created — is authoritative on the next pass.

## 4. HOW

### 4a. Add the gateway shared-rules section

**Chosen.** Insert a new `###`-level section in `skills/faff/SKILL.md` under `## Shared Rules`, positioned as a peer immediately after **Agent Lanes** / alongside **Always pull fresh** (so the "who writes markers" lane context is adjacent). Proposed heading and body per the gateway insertion in this PR.

**Assumes:** the section is prose-only and load-bearing nowhere mechanically — `faff validate-adapters` and `runcheck` are unaffected (it adds no contract a CLI checks). Verified: neither CLI parses gateway shared-rules prose.

### 4b. Add the one-line pointers

**Chosen.** Mirror the existing **"Untrusted-input no-execute rule"** pointer pattern: each skill that leaves markers already carries a **"Load the gateway first"** preamble enumerating the shared rules it inherits. Add **"Tracker as the lights-out control plane"** to that enumeration in each — a one-line addition, not a new paragraph. Skills to update (all confirmed to carry the preamble): `faff-beep-boop`, `faff-graft`, `faff-prep`, `faff-tidy`.

**Chosen:** `faff-jot` does **not** get the marker-filing pointer (it never writes tracker markers autonomously). **Punt:** whether jot's preamble is touched at all — see Open Questions.

### 4c. The legibility gap-closure audit

**Chosen: add nothing — the gap is already closed.** The digest + PR/status IS the marker for shipped/routed-out/errored/unreached. Adding a per-issue tracker comment for these would **duplicate** what the PR, the status move, and the digest already convey — which §3's granularity rule and the no-duplication guidance both forbid. The one disposition that genuinely needs a *per-issue* tracker artefact (park) already has one. **Chosen: no per-issue marker is added for any terminal disposition.** No real gap exists.

## 5. DESIGN DECISION RATIONALE

- **Why a single gateway section, not per-skill rules.** **Chosen.** The behaviour is suite-wide and cross-cutting; a per-skill copy would drift. Naming it once + pointing back mirrors **Untrusted input** and **Always pull fresh**.
- **Why name-don't-build.** **Chosen.** The inventory audit confirms every marker, the steer loop, the same-backlog property, and the density controls already exist. Building new mechanism would be redundant and would risk *adding* the flooding the ticket warns against.
- **Why the granularity rule rejects per-micro-step markers.** **Chosen.** "Every step leaves a marker" taken literally is the flooding anti-pattern that makes the control plane unreadable.
- **Why reuse the existing density dials.** **Chosen.** `logging` and `appetite` already govern verbosity and auto-create; a new `markers:` knob would violate "configurable, not opinionated".
- **Why orchestrator-files / jot-interactive-only.** **Chosen.** Already fixed by Agent Lanes and jot's autonomous section; stating it here makes the principle *compose*.
- **Why no gap-closure marker.** **Chosen.** The digest + PR + status already make every terminal disposition legible; a per-issue comment would duplicate, and §3 forbids duplication.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

### Punts

- **Punt:** whether `faff-jot`'s "Load the gateway first" preamble is touched at all. Jot writes no tracker markers autonomously, so it arguably needs no pointer; but a one-line "(jot is interactive-only and exempt)" note could pre-empt a future reader assuming the principle makes jot file tickets. *Recommendation:* **skip jot** — the principle's own lane clause already states jot is interactive-only. A judgement call, not a blocker; either choice ships a correct spec.

### Assumes

- **Assumes:** the gateway already carries the "shared rules are named once and pointed at, not restated" convention (verified — Untrusted input, Always pull fresh, Spec discovery, Worktree policy all work this way).
- **Assumes:** the "Load the gateway first" preamble exists in `faff-beep-boop`, `faff-graft`, `faff-prep`, `faff-tidy` and enumerates inherited shared rules (verified).
- **Assumes:** the run-summary digest is already posted to the tracker as a status update / project comment (verified — `faff-beep-boop` Reporting), so terminal-disposition legibility needs no new marker.
- **Assumes:** no `faff` CLI (`validate-adapters`, `runcheck`) parses gateway shared-rules prose, so a new prose section breaks no mechanical check (verified).

## 7. DONE

1. **Gateway section exists.** `skills/faff/SKILL.md` contains a new shared-rules section titled "Tracker as the lights-out control plane", positioned as a peer to **Agent Lanes** / **Always pull fresh**.
2. **Externalise principle stated** — the tracker is the complete record + control plane + observability surface; marker-worthy steps leave tracker markers; factory work joins the same backlog (no hidden queue).
3. **Granularity rule stated and rejects per-micro-step markers** — defines marker-worthy as the meaningful transitions (the listed set), explicitly forbids per-file/per-test/per-CI-poll markers, and routes routine progress to `.faff/` logs + the digest.
4. **Density levers named are the existing ones** — `logging`, `appetite`, vague/concrete, run digest. **No new `markers:`/`marker_granularity:` config key appears anywhere.**
5. **Steer loop stated and points at existing implementations** — Always-pull-fresh, wave re-entry + `faff next`, tidy comment-scan, prep stale-refresh; tied to FAFF-19. No new fetch/merge mechanism defined.
6. **Lane composition stated** — orchestrator files, implementor records-and-returns, jot interactive-only; references Agent Lanes rather than restating it.
7. **Pointers added** — the "Load the gateway first" preamble in `faff-beep-boop`, `faff-graft`, `faff-prep`, `faff-tidy` enumerates the new principle (one line each), mirroring the Untrusted-input pointer pattern.
8. **No gap-closure marker added** — no per-issue tracker comment introduced for shipped/routed-out/errored/unreached; the audit conclusion (digest+PR+status suffices) recorded in the section or its rationale.
9. **No new mechanism (the hard-constraint check).** The diff adds **no** new `faff` CLI subcommand, **no** `.faffrc` key, **no** new `.faff/` artefact or file format, and **no** per-step marker subsystem. The entire change is prose: one gateway section + ~4 one-line preamble additions.
10. **Suite still coherent** — `faff validate-adapters` passes unchanged; no existing shared rule (Agent Lanes, Appetite, park protocol, run-ledger invariant) is modified.

confidence: high

*Attached by faff-prep (interactive, 2026-06-10). Spec produced by faffter-dark-nlspec, validated against faffidavit-spec (markers_valid, no violations). Self-rated `confidence: high`.*
