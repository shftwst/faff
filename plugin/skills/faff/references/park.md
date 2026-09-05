# Faff gateway reference — park lane

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Interactive park resolution (surface, don't settle)

**Resolve-attempt before park** (above) is the autonomous boundary: an unattended run parks a `needs-decision-first` / `gap-blocked` / `circular-blocked` verdict and never self-resolves it. The **interactive** path (L1/L2, human at the keyboard) needs the equivalent stated — nothing else stops a "helpful" pass from investigating a `needs-human` park, deciding the call itself, and writing a settled resolution: it looks like progress but is the AI-makes-the-call outcome the park exists to prevent, harder to notice because it arrives wrapped in the analysis the human asked for. Mirrors *Resolve-attempt before park* and applies **Human curation is authoritative**: the human's call is authoritative; the agent's job is to inform it, not make it.

1. **Surface, don't settle.** Resolving a `needs-human` park interactively requires the **human's actual judgment** on any architecture / scope / taste decision the park names. The agent **surfaces** the decision and may offer a **recommendation**; it does **not** author a settled `**Chosen:**` / Resolution on the human's behalf. More subagent analysis does not discharge this — the judgment, not the investigation, is reserved for the human. Analysis and recommendation are welcome; only *authorship of the verdict* transfers.
2. **Correctness carve-out.** An agent **may** close a park whose fix is a **matter of fact, not taste** — a genuine bug, a falsified measurement, a rule already written down — because there is a *right answer*, not a *choice*. Architecture / scope / taste are **never** in this carve-out. **In doubt → treat as taste and surface it.**
3. **Verify subagent findings against the source.** A finding is checked against the authoritative source before it is acted on; a summary that contradicts its cited source loses to the source (an investigator once claimed a decision record mandated a behaviour the cited ticket's own text called deliberately otherwise — the source won).

**Symmetry, not licence.** The autonomous rule *parks* a needs-human call; this one *surfaces* it — both refuse to let the agent settle it, but this is the mirror, not a restatement, and is never licence for mid-run prompts on an **autonomous** run (stays forbidden by the **no-prompt invariant**, **Autonomous Mode Contract**). `faff-tidy` and `faff-prep` point back here rather than restating it.

### Park protocol (shared)

Every faff skill that can park work follows the same protocol:

1. **Preserve WIP and flip the PR to draft, only when they already exist.** Commit WIP with a clear message when a branch/worktree exists for this unit of work, and flip an existing PR to draft. A pre-build park — e.g. a `needs-decision-first` whose resolve-attempt fails before any build started — has neither, so both steps are skipped rather than manufacturing a branch, worktree, or PR.
2. Post a comment on the tracker issue: cause, what was attempted, what is needed from a human. The reason line follows **the short comment rule** below — a short, dedicated line naming the unresolved decision and its owner, never the fuller run-summary decision paragraph. Tag the issue `faff-parked` (or the tracker's equivalent label) so `/faff-wtf` can surface it — via `faff label add <issue> faff-parked` and its descriptor's write (**Control-label provisioning**).
3. **Append one record to the in-run park-record accumulator** — `{ issue_id, root_cause_class, timestamp, reconsider, cited_input }` — using the `routing_adaptor`'s already-assigned root-cause class, never re-derived here; a failed `needs-decision-first` resolve-attempt uses `punt-not-closed`. The same park-time classification also assigns `reconsider ∈ {machine, human}` and, for a `machine` cause, captures `cited_input` — see **Reconsider classification and the park-versus-hold boundary** below. Both the `faff-parks` record and the git-only prep marker's `park` sub-object carry these fields; the existing `faff-parks` readers round-trip them opaquely (the counting reader keys only on the original three). See **the accumulator and render boundary** below for ownership and dedup.
4. Write to `.faff/logs/…` with the full context, then return control to the caller (beep-boop or interactive invoker). **Interactive mode — the recovery offer (per gateway → *Interactive next-step offer*):** the terminal line names the exact re-invoke command per park cause — spec-level → `/faff-prep <issue>`, build-level → `/faff-graft <issue>` (resume from the draft PR), structural (`gap-blocked`/`circular-blocked`) → resolve the gap/cycle and the next `/faff-tidy` re-routes it — plus the later route "or see it again anytime via `/faff-wtf` → Parked work." **Autonomous mode:** emit **no** offer (the no-prompt invariant); just return control.

**The accumulator and render boundary (single shared locus).** The run **orchestrator** (`faff-beep-boop`) owns one ordered `park_records` array for the run; a park-capable sub-skill (or a build lane under a `concurrency` dispatch cut) returns its park fact to the orchestrator rather than editing `summary.md` directly — no worker concurrently edits the summary. A completed Park-protocol invocation (steps 2 + 3 above both succeeded) contributes **exactly one** record; a retry of the same completed transition, or backstop reconciliation rediscovering it, deduplicates against the existing record rather than appending a second one. Zero parks render a valid empty `[]`; multiple parks retain occurrence order, and the same issue/class may recur only when each occurrence is a genuinely distinct completed park transition. At run-end summary rendering — never mid-run, never from a worker — the orchestrator serialises the complete accumulator exactly once as one fenced `` ```faff-parks `` block (`JSON.stringify(park_records, null, 2)`; `[]` when empty) — the same wire shape `faff park-history` parses back (`extractParksBlock`). **The short comment rule (same locus):** the tracker comment's reason line names the unresolved decision and its owner in one line — never the fuller run-summary decision paragraph; supporting detail may follow it. Canonical shape for a failed `needs-decision-first` resolve-attempt: **Park reason:** unresolved Punt — `<short decision topic>` (`decides: <owner>`) — the topic derived from the spec's `**Punt:**` line, excluding the run summary's recovery/process prose. `gap-blocked` / `circular-blocked` parks use the equivalent one-line shape for their own cause — the rule is shared, not Punt-special-cased.

### Reconsider classification and the park-versus-hold boundary (FAFF-992)

A park is a promise a human will make a call. Some parks name a genuine human call (scope, taste, architecture); others were forced by a machine-fixable condition and only look like human calls. FAFF-992 classifies each park at park time so a later autonomous pass (FAFF-993) can recover the machine ones — and prevents a recoverable transient from ever becoming a park.

**The reconsider axis is orthogonal to the closed five root-cause classes.** `root_cause_class` stays closed at five (it drives repeat-park counting). The machine-versus-human distinction is a separate `reconsider` field plus a `cited_input` reference — **never** a sixth root-cause class.

**Assign `reconsider` in the same classification step that assigns `root_cause_class`:**

- **`human`** — a scope, taste, or architecture judgement call, or **any** cause the classifier cannot positively prove machine-checkable. **In doubt → `human`.** A legacy record with no `reconsider` field, and a `disposition:"parked"` marker with no `park` sub-object, both read `human` (fail-safe).
- **`machine`** — **only** when the classifier can prove the cause machine-checkable **and** name the single external config file it cited. Record `cited_input { kind:"config-file", ref:<repo-root-relative path>, keys?:[…], fingerprint:<content hash captured NOW> }` via the shared `fingerprintFile` helper (`park-history.js`, recomputed at reconsider time by FAFF-993). **Downgrade to `human` at write time** any cause that is not a single fingerprintable repo-root file: a `backend`, multi-file, or environment-variable cause is recorded `reconsider:"human"`, `cited_input:null`. The schema carries the `backend` enum value so a record can *name* a backend cause, but the write side never mints a machine backend park. This classification is grader-gated (`park-reconsider-classification`, `eval/`); the gate fails if any scope/taste/architecture park is marked `machine`.

**The park-versus-hold boundary (prevention).** A machine cause partitions by regime:

```
             machine cause
                  |
      +-----------+-----------+
      |                       |
 in-turn-recoverable    elapsed-input-change
 (transient blip)       (config edit)
      |                       |
   HOLD                    PARK, reconsider = "machine"
   (faff-awaiting-           cited_input + fingerprint
    spec-review; FAFF-900)   (FAFF-993 reconsiders later)
   never a park
```

A machine cause a **bounded in-turn retry can clear this turn** (a transient backend blip) routes to the existing `faff-awaiting-spec-review` hold (FAFF-900, Done, #771) and **never a park** — it never reaches the park record. Only an **elapsed-input-change** cause (a config-fault that needs an external edit over elapsed operator time, with no in-turn signal to ride out) stays a park, recorded `reconsider:"machine"` with its cited input. A human-judgment cause is unaffected by this boundary and parks `reconsider:"human"`. This keeps a `machine` park record meaning exactly one thing — a cause that needs elapsed external change — which is the only thing FAFF-993's autonomous seam is licensed to reconsider.
