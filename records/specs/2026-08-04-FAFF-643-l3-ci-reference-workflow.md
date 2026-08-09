# Spec — FAFF-643: L3 CI reference workflow — a tracker-driven autonomous watcher

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-643.

## 1. WHY — problem and principle

The configuration most solo adopters actually want is a watcher that wakes on a schedule and chews through newly-automation-eligible tickets, with the **tracker as the control plane** — crank `faff-automate` up on the board, the next firing picks it up. FAFF-606 specifies that as the **L4** shape, and it cannot run against the faff repo itself (two independent gates refuse: beep-boop §0a returns `refuse / self-directed` because the target is faff's own repo, and the lights-out preflight refuses on `dial-coherence:adversarial-spec-review`). An **L3** run has neither problem — §0a is skipped entirely at L3 by the ADR-0069 guard, which is exactly what lets faff's own nightly self-drain work today.

So the L3 watcher is both the thing that runs on faff itself (dogfooding by construction) and the reference artifact an adopter copies. This ticket produces that reference workflow.

Two things now make it buildable that were not before. FAFF-646 (merged) states the admission criteria for a run on a CI runner, and FAFF-655 (merged) shipped `faff container-check --gate` — the composite verdict a workflow gates on (exit 0 iff *contained* AND *no host engine socket reachable*, exit 1 otherwise). At L3 a non-contained result otherwise only *warns*; as written, an L3 watcher would drain a queue unattended on a bare host behind a warning nobody reads — the exact blast radius ADR-0010 exists to bound, absent from the mode that runs unattended longest. This ticket carries the gate adoption as acceptance rather than inheriting the gap.

## 2. WHAT — design (the load-bearing decisions)

**Chosen: the deliverable is a reference workflow committed under `operations/ci/`, plus a companion doc — not a live `.github/workflows/` entry.** The repo already holds the convention explicitly (`job-surface-probe.yml:8-10`): "a committed job whose label matches nothing is a small lie in the repository" — only hosted runners are declared in `.github/workflows/`, and a self-hosted job is added only once there is a host to point it at. An L3 watcher needs a self-hosted runner (the FAFF-609 rig), which does not exist yet, and a subscription-seat secret. So the reference workflow lives under `operations/ci/` where a `runs-on: [self-hosted, …]` line is a **documented example an adopter copies**, not a dead label in faff's own live CI. Live faff-on-faff activation (moving it into `.github/workflows/`) is a one-line operator step, gated on the FAFF-609 rig and its auth secret existing — called out in the companion doc, not done here.

**Chosen: segment-per-firing — each scheduled firing is its own short, complete L3 run (settles open question 1).** L3 has no `lights-out --resume` (a run-level re-entry is an L4-only verb), so "two consecutive firings continue one run" has no L3 implementation and this workflow does not invent one. Each firing runs a plain `/faff-beep-boop`, drains what it can within the job, and its ledger closes; the next firing re-queries the tracker fresh. Giving L3 its own run-level re-entry path was considered and rejected — it duplicates the L4 verb for no gain, and the real backstops below already prevent lost work.

What actually carries across firings — stated precisely, because it is easy to overclaim:

- **Committed work survives.** graft pushes the feature branch to `origin` at build-complete (Step 8b), so any issue that reached a pushed branch keeps its work regardless of the firing that ends. A build killed *mid-build* (the job time cap hitting before build-complete) writes no checkpoint and simply **rebuilds from scratch** on a later firing — no committed loss, but not a resume.
- **The `.faff/resume/<ISSUE>/` store is narrower than "resume".** It is specifically the review-provider-outage cross-run handoff (FAFF-403), populated only when an issue is held with `faff-awaiting-review`; the build-complete checkpoint itself lives in the per-firing `$run_dir`, which is fresh each firing and does not persist. So the store carries a review-outage hold to the next firing, not a general mid-build continuation.
- **claim-before-admit prevents a re-queue collision.** An issue already `In Progress`/`In Review` is skipped as `claimed-by-peer` on the next firing, so nothing double-drains.

One honest limitation this creates: an issue that reached build-complete + pushed but was then killed *at the review step without* a provider outage gets no `.faff/resume/` entry and its tracker status stays `In Progress` (the Step 5 claim is never reverted). The next firing skips it as `claimed-by-peer` — so it is neither resumed nor re-queued until a human (the L3 morning park-review) picks it up. This is acceptable at L3 (no committed work is lost, and the human is on the loop by definition), and the companion doc names it rather than leaving it to be discovered.

**Chosen: `faff container-check --gate` is the first job step, and it hard-fails the job before any agent starts.** This is the FAFF-646/FAFF-655 adoption. The step runs before checkout-of-work / before any `/faff-beep-boop` invocation; on exit 1 (not admitted — not contained, or a host engine socket reachable) the job fails immediately, so **no tracker claim is taken and no ledger is minted on a rig that isn't admitted**. The admission decision is the gate's exit code, not a judgement about which cage was chosen — consistent with ADR-0095. The workflow's comments state plainly that any cage passing `--gate` works here (claude-box, a devcontainer, a Kubernetes runner pod, an Actions `container:` with the socket dealt with) — no product is named as required; a named example is visibly an example. The one worked, passing rig is FAFF-651's deliverable, which this workflow references rather than embeds.

**Chosen: workflow-level `concurrency` serialises firings; claim-before-admit makes any residual overlap safe.** A `concurrency: { group: <workflow>-<repo>, cancel-in-progress: false }` block (the `deploy-docs.yml:15-17` pattern) prevents two firings running at once — `cancel-in-progress: false` so a firing already draining is never killed mid-build, the next simply waits. faff provides no cross-run drain lock, but it does not need one for correctness: beep-boop's **claim-before-admit** (FAFF-82) re-reads each issue's live tracker status before admitting it, so even if two firings overlapped, the second gets `claimed-by-peer` and does not double-drain. The `concurrency` block is the efficiency guard; claim-before-admit is the correctness guard. Both are stated; the workflow relies on the CLI mechanism, not on prose discipline.

**Chosen: `faff disposition` is the final, exit-propagating step; the within-firing window governor needs no cross-firing wiring (settles open question 2).** The last step runs `faff disposition` (exit 0 clean / exit 1 needs-attention / exit 2 malformed ledger / exit 3 no run dir), so a firing that parked, errored, or hit a budget/window ceiling exits non-zero and surfaces on the board. The FAFF-594 5-hour window governor is a **per-run** control: beep-boop already consults `faff budget check` at every checkpoint against the run-ledger's window anchor (anchored at first draw), and a window breach yields the `parked-window` outcome, which `faff disposition` treats as needs-attention. Because each firing is its own run (the segment-per-firing decision above), the window governs spend *within* a firing and needs no cross-firing consult — there is no shared ledger to carry a window anchor between firings at L3, and inventing one would reintroduce the run-level-resume machinery this spec rejected. Cron cadence is therefore a documented operator knob (a conservative default, e.g. hourly), not a value this workflow computes; the `concurrency` guard makes an over-eager cadence safe rather than harmful.

**Chosen: auth is a subscription seat via a long-lived env token — the CI path — documented inline, secret from the environment only.** ADR-0092 sanctions headless subscription-seat use and names the CI path as a long-lived token in an env var (Claude Max) / `codex login` seat (Codex); the reference workflow documents this in its own comments and sources the secret from a GitHub Actions secret / env var, never a committed rc (ADR-0067). The solo-dev path (self-hosted runner + subscription seat) is the "your laptop is the factory" model FAFF-609 documents; the workflow references it rather than restating the rig setup.

**Chosen: evidence lands via graft's existing anchor emission — no new mechanism here.** faff-graft Step 10 already emits run-dir evidence to `.faff/anchors/<run>/<issue>/` (the committed carve-out `!.faff/anchors/`) and the `governance-check` Action consumes it. A beep-boop-built PR from this workflow inherits that path unchanged; this ticket adds no evidence convention (that is FAFF-596's now-terminal scope) and simply relies on the emitter already in the build path.

**Assumes:** the FAFF-609 rig doc, a registered self-hosted runner, the subscription-seat secret, and the seat-handle config wiring (FAFF-481, deferred by ADR-0092 decision 4) are the operator's to provide for live activation; the one worked passing cage is FAFF-651's deliverable; live faff-on-faff dogfooding (promoting the reference into `.github/workflows/`) is a documented operator step gated on those, not done in this ticket. Because no admissible cage exists in faff's own CI today (ADR-0095 records that the hosted-container shape fails the no-host-socket criterion by socket bind-mount, and both direct shapes fail the containment criterion with no markers), this ticket produces the reference workflow YAML + companion doc, not a live committed evidence bundle — and ADR-0095's Consequences explicitly frame FAFF-643 as a downstream example measured against the criteria, not the normative answer. `--gate` is on `main` (FAFF-655, PR #530).

## 3. HOW — acceptance

- A reference workflow committed under `operations/ci/` (e.g. `operations/ci/l3-watcher.yml`) that: runs on a schedule (`on: schedule` + `workflow_dispatch` for manual firing), invokes `/faff-beep-boop` at L3 (plain invocation, no `faff lights-out`), and targets this repo.
- The **first** job step is `faff container-check --gate`; on exit 1 the job fails before any agent starts, before any tracker claim or ledger mint. The step's comment states any cage passing the gate is acceptable and names an example as an example (product-neutral, per ADR-0095 / FAFF-651).
- A `concurrency:` block with `cancel-in-progress: false` serialises firings; a comment names claim-before-admit as the correctness backstop.
- The **final** step is `faff disposition`, exit-propagating — the job exits non-zero iff anything parked / errored / needs attention (including `parked-window`).
- Auth documented inline as a subscription seat via a long-lived env-var token (the CI path, ADR-0092), sourced from a secret, never committed.
- Segment-per-firing is documented (each firing is its own L3 run; committed work survives via the pushed branch, a mid-build kill rebuilds, and `.faff/resume/<ISSUE>/` is the review-outage handoff only — not a general resume); the absence of run-level `--resume` at L3, and the review-step-kill stranding limitation, are stated rather than worked around.
- A companion doc (under `docs/guide/` or alongside in `operations/ci/`) explains the workflow, the live-activation step (promote to `.github/workflows/` once the FAFF-609 rig + secret exist), and the product-neutral cage posture.
- **No dead label in live CI:** nothing with a `self-hosted` `runs-on` is committed to `.github/workflows/` in this ticket (the convention at `job-surface-probe.yml:8-10`).
- No change to faff CLI behaviour; `node --test` stays green. If a docs/workflow lint exists (e.g. actionlint over `operations/ci/`), the reference workflow passes it.

### Scenarios

```
Given the reference workflow firing on a rig that faff container-check --gate refuses (host socket reachable)
When the scheduled job runs
Then the gate step exits 1 and the job fails before /faff-beep-boop starts — no claim taken, no ledger minted.
```

```
Given the reference workflow firing on an admitted rig with at least one automation-eligible ticket
When the scheduled job runs
Then /faff-beep-boop drains the eligible queue, evidence anchors land on any PR it opens,
And faff disposition exits non-zero iff anything parked or needs attention.
```

```
Given two scheduled firings overlapping
When the second starts while the first is still draining
Then the concurrency block makes it wait (cancel-in-progress: false), and claim-before-admit ensures neither double-drains the same ticket.
```

```
Given a firing whose build of one issue is killed by the job time cap before build-complete
When the next firing runs
Then that issue rebuilds from scratch (no pushed branch yet, so no committed work is lost), and the run itself does not continue — segment-per-firing.
```

## 4. DONE — definition of done

- [ ] `operations/ci/<name>.yml` reference workflow: `on: schedule` + `workflow_dispatch`, L3 `/faff-beep-boop`, this repo.
- [ ] First step `faff container-check --gate` hard-fails the job on exit 1 before any agent / claim / mint; comment states product-neutral cage posture with an example-as-example.
- [ ] `concurrency:` block (`cancel-in-progress: false`); comment names claim-before-admit as the correctness backstop.
- [ ] Final step `faff disposition`, exit-propagating (non-zero iff parked/errored/needs-attention, incl. `parked-window`).
- [ ] Auth documented inline: subscription seat via long-lived env-var token (CI path, ADR-0092), secret from env, never committed.
- [ ] Segment-per-firing documented; no run-level `--resume` claimed at L3; the honest carry-across (pushed branches survive, mid-build kill rebuilds, `.faff/resume/` is the review-outage handoff only) and the review-step-kill stranding limitation both stated.
- [ ] Companion doc: what it is, live-activation step (promote to `.github/workflows/` once FAFF-609 rig + secret exist), product-neutral cage posture, and the segment-per-firing carry-across + review-step-kill stranding limitation.
- [ ] No `self-hosted` `runs-on` committed to `.github/workflows/` in this ticket.
- [ ] `node --test` green; reference workflow passes any operations/ci lint that exists.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
