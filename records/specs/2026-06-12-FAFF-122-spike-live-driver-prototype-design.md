# Spike: live-driver prototype — headless agent drives faff-tidy over a throwaway substrate

> Spec: faffter-dark-nlspec · 2026-06-11 · interactive · confidence: high. Full spec on Linear FAFF-122.

*Budget Punt resolved with the human (2026-06-11): **Lean** — N=5 SDK runs + 2 `claude -p` runs, hard cap ~1.5M tokens (~$25–50), ~half-day wall-clock, stop at first bound; bump later if the flakiness signal is inconclusive. Related-links added to FAFF-93/89/90/88 (not blockers). Spec now fully closed at high confidence.*

Build spec for FAFF-122 — a **time-boxed spike**, not a feature. The "build" is *running an experiment and writing an ADR*; **no driver code is committed**. It de-risks landing-zone **(a)** (a live headless agent implementing `SkillDriver.drive(ctx)`) for the FAFF-93 skill-run harness, by measuring three things and recommending go/no-go.

## 1. WHY — Problem and Principles

**Problem statement.** FAFF-93 (the skill-run harness) has an open punt: *which* live-LLM driver mechanism, and at what cost/fidelity. The decision was set to **spike-first on option (a)** — a live headless agent (Claude Agent SDK or `claude -p`) driving a real skill. This spike runs that prototype against **faff-tidy** and measures: (1) **flakiness** across repeated runs, (2) **token cost** per run, (3) **seam-capture fidelity** — whether the agent's tracker reads/writes and `faff` CLI calls can be routed/captured so a `DecisionRecord` is complete. The numbers decide **go/no-go on (a)** vs falling back to **(b)** record/replay cassette, and **size the eventual live-driver ticket**.

**The substrate does not exist yet (the load-bearing finding).** The named substrate is unbuilt: FAFF-89 (mock-tracker loader, `test/helpers/mock-tracker.mjs`) and FAFF-90 (seeded-repo, `test/helpers/seed-repo.mjs`) are Todo-with-spec-but-no-code; FAFF-93's `SkillDriver` / `ctx.tracker` / `ctx.cli` / `DecisionRecord` seam is design-only (no code anywhere). FAFF-88 (determinism-seams + runner ADR 0002) **is** Done. So a spike that consumed the real substrate would be **blocked behind three unbuilt tickets** — which defeats *spike-first*, since the spike exists to inform exactly those tickets.

> **Note (2026-06-12, at build time):** since this spec was written, FAFF-89 / FAFF-90 / FAFF-93 / FAFF-94 / FAFF-95 / FAFF-97 have all **shipped** — the real substrate (`test/helpers/mock-tracker.mjs`, `test/helpers/seed-repo.mjs`, `test/helpers/skill-harness.mjs`) now exists. The spec's "throwaway substrate" decision stands as written (a spike still wants the thinnest stand-in and must not entangle with production helpers), but the spike may now *reference* the real `DecisionRecord` shape for fidelity comparison. This does not change the deliverable or the budget.

**Design principles** (these would reject an otherwise-valid spike):
- **A spike builds throwaway scaffolding, not the product.** The substrate it runs against must be the thinnest stand-in that makes the three measurements meaningful — never the production FAFF-89/90 loaders (which it must not block on). Throwaway code is discarded; nothing here is a dependency for FAFF-89/90/93.
- **Measure, don't build.** The output is an ADR with numbers + a recommendation. If the spike starts elaborating a reusable driver, it has overrun its remit — stop and record what's known.
- **Time-boxed and budget-capped.** A spike spends real tokens and real wall-clock; both are bounded up front (see §3 budget), and the spike stops at the box even with partial data (partial numbers still inform the decision).
- **Honour the fixed CI policy.** The live path is **local/on-demand only, never CI** (set in FAFF-93). This spike's code never lands in `node --test` / `validate.yml`; the scripted driver remains the sole CI gate.

**Scope statement.** A throwaway de-risking experiment under the *Skill-behaviour harness* project, feeding the FAFF-93 live-driver decision. It touches no shipped code paths.

## 2. OUT OF SCOPE

- **Building the real `SkillDriver` interface / `DecisionRecord` contract.** — *Why:* that's FAFF-93. The spike may sketch a *throwaway* shape to run the experiment, discarded after. *Extension point:* FAFF-93.
- **Building FAFF-89 / FAFF-90 loaders.** — *Why:* the spike uses a minimal inline stand-in. *Extension points:* FAFF-89, FAFF-90.
- **Committing any driver code or wiring it into CI.** — *Why:* the deliverable is an ADR; the live path is non-CI by fixed policy. *Extension point:* the eventual live-driver ticket this spike sizes.
- **Driving any skill other than faff-tidy.** — *Why:* faff-tidy is the chosen rich-decision candidate (also FAFF-94's target). One skill is enough to measure the mechanism.

## 3. WHAT — the experiment

**Vocabulary.**

| Term | Definition |
|---|---|
| Throwaway substrate | A minimal, inline stand-in: a tiny hand-built mock tracker (a handful of issues/labels/blockers/comments) + a real temp git repo with a few seeded commits — enough for faff-tidy to produce real decisions. **Not** FAFF-89/90. Discarded with the spike. |
| Seam | A point where the skill reads/writes the tracker or invokes the `faff` CLI — what a `DecisionRecord` must capture. |
| Seam-capture fidelity | Of the tracker reads/writes + CLI calls the run actually made, the fraction the driver captured through an interceptable port (vs. ones that escaped capture). |
| Flakiness | Variance in faff-tidy's *decisions* (bucket membership, ordering, verdicts, mutations) across repeated runs over the **same** fixed substrate. |

**Decision — substrate: throwaway minimal vs the real FAFF-89/90 loaders.**
- Option A: use the real FAFF-89/90 substrate. Rejected — both are unbuilt, so the spike would block behind them and FAFF-93, defeating spike-first.
- Option B: a minimal inline throwaway substrate built within the spike.
- **Chosen:** B — the thinnest mock-tracker + temp-git stand-in that lets faff-tidy produce real decisions. The spike is therefore **runnable now and not blocked-by FAFF-89/90/93**; it informs their build rather than waiting on it.

**Decision — agent mechanism + seam-capture approach.**
- **Chosen:** prototype with the **Claude Agent SDK's tool-interception** as the primary seam — wrap the tracker + `faff` CLI as intercepted tools so calls are captured structurally. Additionally try **`claude -p` with transcript-scrape** as the comparison path. *Which one captures seams faithfully is part of what the spike measures* — run both, report the fidelity gap. (This directly answers the ticket's "SDK tool-interception vs transcript scrape" open question with data.)

**Decision — what to measure and how.**
- **Chosen:** drive faff-tidy over the fixed throwaway substrate and record, per run:
  - **Flakiness** — diff the decision set (buckets / ordering / verdicts / mutations) across the runs; report whether identical inputs yield identical decisions, and characterise any drift.
  - **Token cost** — input+output tokens per run (mean + spread), from the SDK/CLI usage report.
  - **Seam-capture fidelity** — count tracker/CLI operations the skill made vs operations the driver captured; report the missed-seam classes (e.g. a read the agent did "in its head", a CLI call not routed through the port).

**Decision — spike budget (resolved).**
- **Chosen — Lean:** **5 SDK runs + 2 `claude -p` runs**, hard cap **~1.5M tokens (~$25–50)**, **~half-day** wall-clock, **stop at whichever bound hits first**. 5 SDK runs is the floor for a coarse flakiness read; 2 `claude -p` runs give the fidelity comparison. If the flakiness signal is inconclusive at the cap, the ADR records that and recommends a follow-up larger run rather than silently overspending.

**Decision — deliverable shape + location.**
- **Chosen:** a short **ADR-style write-up at `records/adr/0003-live-driver-spike.md`** (the dir already holds 0001/0002) carrying: the three measurements, a **go/no-go recommendation on (a) vs (b)**, and a **size/shape estimate for the live-driver ticket** (what FAFF-93's live path would cost to build, and which seams need which capture approach). No driver code is committed; any throwaway prototype lives only in the spike's working dir / branch and is not merged.

## 4. HOW — running it

```
1. Build the throwaway substrate (inline, in the spike's working branch — not test/helpers):
   - mock tracker: ~5-10 issues with labels / blockers / comments that exercise tidy's
     buckets (a dupe, a vague one, a stale-blocker, a ready-to-promote, an On-hold).
   - temp git repo: a few seeded commits / a .faff/ dir so tidy's git-grounding has real state.
2. Wrap the seams as intercepted tools (throwaway):
   - tracker port (list/get/save issue+comment) and the `faff` CLI invocation, each logged to
     a DecisionRecord-shaped capture so "what the run did" is inspectable.
3. Pre-flight: confirm a live Claude headless path runs (one-shot `claude -p "hi"` / SDK ping).
   If it can't, stop and write the ADR as "environment blocked" — do not fake numbers.
4. SDK path: throwaway drive(ctx) runs faff-tidy headless via the Agent SDK, tools bound to the
   intercepted ports. Run 5× over the SAME substrate.
5. claude -p path: run faff-tidy headless via `claude -p`, capture seams by transcript scrape. Run 2×.
6. Record per run: decision set (buckets/ordering/verdicts/mutations), token usage, captured-vs-
   actual seam counts. Tear down the temp repo each run. Stop at ~1.5M tokens / half-day if first.
7. Analyse: flakiness (decision diff across runs), cost (mean+spread), fidelity (per approach,
   missed-seam classes). Write records/adr/0003 with numbers + go/no-go + live-driver sizing.
8. Discard the throwaway driver/substrate (do not merge code); only the ADR lands.
```

- **Anti-pattern:** hardening the throwaway driver into something reusable. Why: that's FAFF-93's build, and it would blow the time-box; the spike's job is numbers, not a driver.
- **Anti-pattern:** wiring any of this into `validate.yml` / `node --test`. Why: the live path is non-CI by fixed policy.

**Edge cases:**
- **Live auth/API unavailable** → step-3 pre-flight catches it; the spike's finding is "environment blocked" (go/no-go then needs a runnable environment), not faked data.
- **Seam escapes capture** (agent reads/decides without routing through a port) → that *is* a finding — it bounds (a)'s fidelity and feeds the recommendation; capture the class, don't paper over it.
- **Budget/time-box hit with partial data** → write the ADR with what was measured + an explicit "insufficient data on X" note + a follow-up-run recommendation; partial numbers still move the decision.

## 5. DESIGN DECISION RATIONALE

**Why throwaway over the real substrate?** The spike exists to de-risk FAFF-93 (and size the work that FAFF-89/90 feed). Blocking it on those tickets inverts the dependency — you'd build the substrate before knowing whether the live mechanism is even viable. A minimal stand-in answers flakiness/cost/fidelity without them.

**Why run both SDK and `claude -p`?** The seam-capture question *is* SDK-tool-interception vs transcript-scrape. The only honest way to answer it is to try both and measure the fidelity gap — that comparison is a primary spike output, not a pre-decided choice.

**Why Lean over a bigger run?** De-risking wants a *signal*, not statistical rigour: 5 runs distinguishes "deterministic enough" from "wildly flaky", and 2 `claude -p` runs expose the fidelity gap. The cap forbids silent overspend; if the signal is borderline, the ADR recommends a costed follow-up rather than the spike unilaterally spending more.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the budget was resolved to Lean (§3).

**Assumptions:**
- **Assumes:** a live Claude headless path (Agent SDK or `claude -p`) is runnable with auth in the spike environment. *Validation:* the step-3 pre-flight one-shot; if it fails, the spike's finding is "environment blocked," surfaced for the human.
- **Assumes:** faff-tidy can be driven headless against an injected tracker+CLI without code changes to the skill. *Validation:* the throwaway `drive(ctx)` binds tidy's tracker/CLI seams via the intercepted ports; if tidy reads a seam the throwaway can't inject, record it as a fidelity finding (it's exactly what the spike measures).
- **Assumes:** ADR 0002's "assert at deterministic seams" framing is the capture target (buckets/ordering/verdicts/mutations). *Validation:* `records/adr/0002-skill-test-architecture.md` (present).

## 7. DONE — Definition of Done

### The deliverable (a spike is done when the ADR exists)
- [ ] `records/adr/0003-live-driver-spike.md` exists with: **flakiness**, **token cost**, and **seam-capture fidelity** numbers from real runs over the throwaway substrate.
- [ ] It includes a **go/no-go recommendation on (a)** (live headless agent) vs **(b)** (record/replay cassette), grounded in the numbers.
- [ ] It includes a **size/shape estimate for the live-driver ticket** (build cost + which seams need which capture approach — SDK tool-interception vs transcript-scrape, with the measured fidelity gap).

### Method / guardrails
- [ ] Both the **Agent SDK tool-interception** path (5 runs) and the **`claude -p` transcript-scrape** path (2 runs) were run and compared (or, if one couldn't run, that's recorded as a finding with the reason).
- [ ] The run used a **throwaway inline substrate**, not FAFF-89/90; **no driver code is committed** and nothing was added to `validate.yml` / `node --test`.
- [ ] The spike stopped at its **budget/time-box** (~1.5M tokens / ~half-day); partial data (if any) is written up with an explicit gap note + follow-up recommendation.
- [ ] The spike's branch/working dir is discarded (only the ADR merges).

confidence: high

## Methodology critique

> Lens: `faffter-dark-methodology-agile-delivery` · `issue-critique`

- **Right-sized? (principle 4)** — Yes. A time-boxed spike is one coherent unit; the throwaway-substrate + Lean-budget choices keep it tight (~half-day). The deliverable is a single ADR; the §4 anti-pattern guards against the throwaway driver hardening into FAFF-93's build.
- **Workstream fit? (principles 1 + 5)** — Good — already in *Skill-behaviour harness* (it feeds FAFF-93). No change.
- **Deps surfaced? (principle 6)** — **Done:** related-links added to FAFF-93 (resolves its live-driver punt + sizes its build), FAFF-89 / FAFF-90 (the substrate the spike stands in for), FAFF-88 (sibling spike, Done). Deliberately **not** `blockedBy` — blocking would invert spike-first, which is the whole point.
- **Risk profile? (principle 7)** — This *is* the de-risking spike, so risk is the point. Its own viability hinges on a **live Claude headless path being runnable (auth/API)** — now a hard step-3 pre-flight that yields "environment blocked" rather than faked numbers. Token spend is bounded by the Lean cap (~1.5M / ~$25–50, stop at first bound).

*Surfaced for the human; not blocking. Auto-actions none.*
