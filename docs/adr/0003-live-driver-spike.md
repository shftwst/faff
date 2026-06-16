# ADR 0003 — Live-driver spike: headless agent drives faff-tidy over the test substrate

- **Status:** Accepted (spike outcome — **cheap-probe** variant; partial data, see Budget)
- **Date:** 2026-06-12
- **Issue:** FAFF-122 (spike — live-driver prototype)
- **Project:** Skill-behaviour harness
- **Feeds:** FAFF-93 (skill-run harness — its live-driver punt)
- **Lanes resolved:** lanes 2 (judgement-on-frontier) & 3 (local-LLM) were resolved in ADR 0004 (see its 2026-06-15 addendum for the per-surface lane scope).

> This ADR records the outcome of a **reduced probe**, not the full Lean budget the FAFF-122 spec sized (5 SDK + 2 `claude -p` runs). At the operator's direction it ran **3 `claude -p` runs** over a throwaway substrate for **~$0.81 total** — a directional signal, with an explicit costed follow-up (below) for the parts the probe deliberately did not cover.

## Context

FAFF-93 (the skill-run harness) left a punt open: *which* live-LLM driver mechanism, at what cost and fidelity. The direction was set to **spike-first on option (a)** — a live headless agent (Claude Agent SDK or `claude -p`) implementing `SkillDriver.drive(ctx)` and driving a real skill — measuring three things to decide **go/no-go on (a)** vs **(b)** a record/replay cassette, and to size the eventual live-driver ticket:

1. **Flakiness** — does the same input yield the same *decisions* across runs?
2. **Token cost** — per run.
3. **Seam-capture fidelity** — do the agent's tracker reads/writes and `faff` CLI calls route through interceptable ports, so the `DecisionRecord` is complete?

Since the FAFF-122 spec was written, the real substrate shipped (FAFF-89/90 loaders, FAFF-93 harness, FAFF-94/95/97 tests). The probe still used a **throwaway** inline substrate per the spec (a spike must not entangle production helpers), driving **faff-tidy** — the rich-decision candidate.

## What was run

- **Mechanism:** `claude -p` (headless), `--output-format json|stream-json`, `--permission-mode bypassPermissions`, `--allowedTools Bash`, run from an isolated `/tmp` working dir (no faff plugin skills, no Linear MCP — only the throwaway ports).
- **Throwaway substrate (`/tmp`, not committed):** a 7-issue mock tracker (`tracker.json`) exercising tidy's buckets — ready-to-promote, on-hold-unblessed, parked-with-blocker-now-Done, externally-blocked, needs-prep — plus two **logging ports**: `./bin/tracker` (the only sanctioned tracker access) and `./bin/faff` (a logging wrapper over the real CLI). Every routed call appends to a seam log.
- **Driving brief:** a **scoped faff-tidy decision kernel** — list issues → read spec confidence → `faff eligible` → `faff next` (with `--not-eligible`/`--parked`/`--blocked`) → bucket → propose mutations. **Not** the full 47KB `faff-tidy/SKILL.md` (a deliberate cost-saving for the probe; see Caveats).
- **Oracle:** the deterministic ground truth from the real `faff next`/`eligible` — `ready=[ISS-1]`, `on_hold=[ISS-2]`, `needs_prep=[ISS-6]`, `blocked=[ISS-4]`, `park_clear=[ISS-3]`; mutations `setStatus ISS-1→Todo`, `removeLabel faff-parked ISS-3`.
- **Runs:** 3 × `claude -p` (run 3 captured with `stream-json` to scrape every tool call). The **SDK tool-interception path was not run** — `@anthropic-ai/claude-agent-sdk` is not installed in this environment.

## Measurements

### 1. Flakiness — 0% (decisions), over 3 runs

| | Run 1 | Run 2 | Run 3 | vs oracle |
|---|---|---|---|---|
| buckets | exact | exact | exact | ✅ match |
| verdicts (5 issues) | exact | exact | exact | ✅ match |
| mutations | exact | exact | exact | ✅ match |

Bucket/verdict/mutation sets were **byte-identical across all three runs and equal to the deterministic oracle.** The determinism is *explained*: the agent routed every routing decision through `faff next`/`faff eligible` (deterministic CLI) rather than judging in its head — exactly the architecture's bet (ADR 0002: assert at deterministic seams). **Path** variance existed (16 vs 19 vs 16 seam calls; run 2 made a redundant `faff eligible` repeat) but did **not** change any decision.

### 2. Token cost — ~$0.25/run (scoped kernel)

| Run | cost (USD) | fresh input | output | cache read | cache creation | total tokens | turns |
|---|---|---|---|---|---|---|---|
| 1 | 0.261 | 9,266 | 2,303 | 126,660 | 14,840 | 153,069 | 5 |
| 2 | 0.253 | 9,447 | 2,339 | 132,512 | 12,714 | 157,012 | 6 |
| 3 | 0.241 | 9,447 | 2,165 | 129,620 | 11,731 | 152,963 | 4 |

- Per run ≈ **$0.24–0.26**, **~153–157K total tokens** (sum of all four token classes), dominated by **cache reads** (~127–132K); fresh input ~9.3K, output ~2.2K, cache creation ~12–15K.
- **Total probe spend ≈ $0.81** (3 runs + a failed first attempt + ping), vs the **$25–50** Lean cap. The cheap probe came in at **~2–3%** of the Lean budget.
- **Cost-reporting nuance.** `total_cost_usd` is the **API-list-price equivalent**, not necessarily cash spent. This environment authenticates via a **Claude subscription** (credentials file, no `ANTHROPIC_API_KEY`), so the real consumption was **subscription quota, not dollars** — the figures above are an upper-bound proxy. A subscription/headless run may also draw a **different rate-limit pool** than interactive use; confirm via `/status` before sizing a larger run on quota.

### 3. Seam-capture fidelity — 100% of decision-relevant seams, transcript-confirmed

- Every run logged a **complete routed path**: tracker list + per-issue comment reads through `./bin/tracker`, and all 5 `faff eligible` + 5 `faff next` verdicts through `./bin/faff` — with the correct flags (`--parked` for the parked issue, `--blocked` for the externally-blocked one, `--not-eligible` for the unblessed one).
- **Run 3's full tool-call transcript (`stream-json`) shows zero port bypass** — no direct `tracker.json` read, no hand-guessed verdict. Every decision the agent emitted has a corresponding captured seam.
- For faff-tidy's **deterministic kernel**, a live `claude -p` driver with logging ports produces a **complete `DecisionRecord`**.

### Infra finding (unprompted, load-bearing)

The **first run crashed instantly** on a corrupted `~/.claude.json` — the nested `claude -p` raced the **parent** Claude Code session writing the **shared global config**. It auto-recovered (backup + restore) and the retry succeeded, but a live driver invoked *from inside* a faff session shares mutable global state with its orchestrator. **A live driver must isolate config** (e.g. a per-run `CLAUDE_CONFIG_DIR`) or runs will intermittently die on this race.

## Caveats (what the probe did NOT measure)

1. **Scoped kernel, not the full skill.** The brief was tidy's deterministic eligibility→verdict→bucket kernel — **not** the LLM-judgement surface (`vague`/`dupe`/`stale`/`superseded` classification, `pick-ordering`, free-text synthesis). The 0% flakiness is *partly because the kernel routes around judgement into deterministic CLI*. **The flakiness that actually matters is unmeasured.** A full-skill run over a substrate that forces judgement calls is required before trusting the determinism number.
2. **No SDK path.** Only `claude -p` transcript/port-capture ran; the **Agent SDK tool-interception** path (the spec's primary, 5-run path) was not run, so the SDK-vs-scrape fidelity comparison is open.
3. **N=3, not statistical.** A directional signal, not a distribution.

## Decision

**Provisional GO on option (a)'s feasibility** — a live headless `claude -p` driver with logging ports is **cheap (~$0.25/run), reproducible, and 100%-faithful at the seam level** for a skill's deterministic kernel. Option (b) (record/replay cassette) is **not needed to make a live run capturable** — the port-interception approach already captures a complete record.

**But the go/no-go that matters is deferred, with evidence.** The probe shows the *plumbing* works; it does **not** show that the live driver adds value over what already exists, because:

- The deterministic kernel it exercised is **already covered** by the shipped scripted-driver tests (FAFF-94/97) and the CLI selftests/goldens.
- The genuinely **untested** surface is the **LLM judgement** — and a live driver's value there is *catching judgement drift*, which the probe did not exercise.

This sharpens the open **live-driver vs judgement-evals** fork (raised 2026-06-12): the cheapest tool for the untested judgement surface may be **targeted offline judgement evals**, not a full live-driver integration. The live driver earns its place only if the follow-up run shows real, catchable judgement *flakiness* a live integration is uniquely positioned to guard.

A **third lane** falls out of the probe's own finding: because the kernel's determinism is **CLI-bound** (not model-judgement-bound), the driver model only needs to be a competent **tool-router** for the deterministic kernel — a bar a **non-frontier local model** may clear, giving a near-free, CI-friendly regression harness for skill *plumbing* with no subscription-pool draw. It is **orthogonal** to judgement evals (which must run against the shipped frontier model), not a replacement (see follow-up 4).

## Live-driver ticket — size / shape estimate

- **Mechanism:** `claude -p` + **logging ports** (not the SDK) is the lighter, sufficient capture path for the seam-level `DecisionRecord`. Small build: wrap the real `ctx.tracker`/`ctx.cli` as logging shims; bind a headless run to them.
- **Must-haves the probe surfaced:** per-run **config isolation** (`CLAUDE_CONFIG_DIR`); `stream-json` transcript capture as the fidelity cross-check; an oracle-diff harness (already trivial — reuse `faff next`).
- **CI policy (unchanged):** local/on-demand only, never CI — the scripted driver stays the sole `node --test` gate (fixed in FAFF-93).
- **Rough size:** ~1 small ticket for the `claude -p` live driver itself (the ports + isolation + capture), **gated behind** the judgement-eval decision below.

## Costed follow-up (before committing to a full live driver)

1. **Full-skill judgement run** (~$5–15): drive the **real** faff-tidy SKILL.md over a substrate that forces `vague`/`dupe`/`stale`/`ordering` calls, ≥5 runs, to measure flakiness on the surface that matters. *This is the load-bearing number.*
2. **SDK-path comparison** (~$5–10): install `@anthropic-ai/claude-agent-sdk`, run the tool-interception path, measure the fidelity gap vs `claude -p` scrape.
3. **Judgement-eval spike** (parallel, cheaper): scope an offline eval suite for the judgement residue and compare its cost/coverage against the live driver, to settle the live-driver-vs-evals fork directly.
4. **Local-LLM seam-regression harness** (cheapest; spike-supported): the probe's key finding — the kernel's determinism comes from routing through `faff next`/`eligible`, not model judgement — means a **non-frontier local model** (e.g. via Ollama tool-calling) may be a good-enough tool-router for the *deterministic kernel*, yielding a **near-free, CI-friendly** plumbing-regression harness with no subscription-pool draw. Scope: a ~1–2h probe of a local model's **tool-call reliability** on this same kernel. **Caveat:** a model that flubs tool calls would surface *its* incompetence as false skill-flakiness — measure tool-call fidelity first. **Not** a substitute for judgement evals (those need the shipped frontier model).

Total to a confident go/no-go: well within one Lean budget (~$25–50). The cheap probe spent ~$0.81 (subscription quota, API-equivalent) to de-risk the plumbing and **re-frame the real question** from "does the live driver work" (yes) to "does it earn its place over evals — and could a local model cover the plumbing for free" (open).

---

## Addendum — routing live-driver frontier baseline measured (FAFF-160, 2026-06-16)

The "frontier live-driver" lane this ADR left open now has its **first measured baseline** on the **routing** surface (the live-driver input-assembly path FAFF-158 added: `routingLiveDriver` → `buildRoutingPrompt` → `runSkill` → the `routing` grade). FAFF-159 measured the routing kind's **black-box** lane (`cases/routing-*.json` via `run-evals.mjs`); this addendum records the **live-driver lane** counterpart — the new code path PR #92 added, previously exercised in CI only by a mock model.

**Runner.** `eval/run-live-evals.mjs` (the shared live-lane runner FAFF-163 introduced) now carries a `routing` adapter in its open `LIVE_KINDS` registry (one additive append — the FAFF-163 reconciliation adapter is untouched). Routing cases are read straight from `eval/cases/routing-*.json` (`loadCases()`), not duplicated into `cases-live/` — the black-box and live lanes share the one oracle. `driveRoutingCase` (in `eval/live-driver.mjs`, verbatim-symmetric with `driveReconciliationCase`) binds each case's fixture into `routingLiveDriver` and drives it through the real FAFF-93 harness. A mock-model unit test (`node --test`, zero spawn) guards the wiring.

**Measurement (human-supervised).** `node eval/run-live-evals.mjs --kind routing --reps 20` — 6 cases × 20 reps = 120 real `claude -p` reps, config-isolated per rep (FAFF-138: per-rep `CLAUDE_CONFIG_DIR` + forwarded OAuth credentials). Parent `~/.claude.json` untouched across the sweep (verified).

| verdict (case) | accuracy | stability | reps | escalated |
|---|---|---|---|---|
| fire-and-forget (routing-001) | 1.00 | 1.00 | 20 | no |
| likely-fire (routing-002) | 1.00 | 1.00 | 20 | no |
| needs-decision-first (routing-003) | 1.00 | 1.00 | 20 | no |
| gap-blocked (routing-004) | 1.00 | 1.00 | 20 | no |
| circular-blocked (routing-005) | 1.00 | 1.00 | 20 | no |
| repeat-parked (routing-006) | 1.00 | 1.00 | 20 | no |

**per_kind routing: accuracy 1.00 · stability 1.00** (0 escalated, 0 errored). The full record (per-case raw rep JSON + standing-baseline table) lives gitignored under `eval/report/` (`routing-live-baseline.json`, `routing-live-standing-baseline.md`).

**Finding (informs the open "earns its place" gate).** The routing live-driver input-assembly path shows **no measurable judgement drift** over the black-box lane on these six cases — perfect frontier accuracy and stability at K=20, matching FAFF-159's black-box baseline for the same six verdicts. On the routing surface specifically, the live-driver lane does not yet surface catchable flakiness a live integration would be uniquely positioned to guard; the load-bearing flakiness question remains the *prep/reconciliation* and *tidy multi-bucket* surfaces.

**Cred-forwarding fix (shipped with FAFF-160).** The runner's `main()` originally built the frontier model via `makeLiveModel({ bin, pluginDir })` — missing `forwardCreds`, so the per-rep `CLAUDE_CONFIG_DIR` isolation stripped the OAuth credential and every rep landed "Not logged in" (the same auth blocker FAFF-163's reconciliation sweep hit). Fixed to `makeLiveModel(frontierOpts({ bin, pluginDir }))` — the proven `cli-driver.frontierDriver` path — which forwards `.credentials.json` into the isolated dir. This unblocks the live-lane runner for both routing and the latent reconciliation sweep. Every number above traces to a real rep; nothing was fabricated.
