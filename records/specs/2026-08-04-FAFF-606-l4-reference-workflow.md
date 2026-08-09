# Spec — FAFF-606: L4 CI reference workflow — cron-triggered lights-out with --resume segmentation

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-606.

## 1. WHY — problem and principle

FAFF-643 shipped the **L3** watcher (on the loop, faff-on-faff). This is its **L4** sibling: out of the loop, targeting an **outward product repo**, with correctness held up by adversarial machinery (a second model trying to break the change, a code-blind holdout) rather than by a human reading the morning parks. The shape the ticket names: a cron firing resolves an open run or mints one, drains a segment under a budget/time cap, and the next firing continues the *same run* via `faff lights-out --resume <run-id>` until run-done — evidence committed throughout.

It was parked on containment and is now unblocked: FAFF-646 states the admission criteria, FAFF-655 shipped `faff container-check --gate`, and FAFF-651 documented a cage that actually passes (the "A cage that passes the gate" section of `docs/guide/unattended.md`). This ticket carries the admission gate as acceptance and inherits the worked cage rather than re-deriving it.

## 2. WHAT — design (the load-bearing decisions)

**Chosen: the deliverable is a reference workflow under `operations/ci/` (e.g. `l4-watcher.yml`) plus a companion doc section — the L4 parallel of `l3-watcher.yml`, not a live `.github/workflows/` entry.** Same convention (`job-surface-probe.yml:8-10`): its `runs-on:` names a rig that has to exist first, so a live job would be "a small lie." It shares the L3 watcher's schedule + `workflow_dispatch`, `concurrency` (`cancel-in-progress: false`), `permissions: contents: read`, and the admission-gate first step. It diverges on the drain, the segment-boundary/disposition handling, the pre-gate, outward targeting, and the auth matrix, below.

**Chosen: resolve-newest-run-and-try-resume, else mint — the workflow never tests doneness itself.** `faff lights-out --resume <id>` re-enters an existing ledger only when it self-classifies as re-enterable (`aborted-resumable | escalated | dead-running`) and **refuses** (exit 2) otherwise; the re-enterability authority lives inside resume, not in the workflow. So the workflow does **not** use `faff run-done` to test a run dir — that verb composes signals from CLI flags and never reads a ledger, so it cannot answer "is this run done?". Instead: resolve the newest `.faff/runs/<id>`, attempt `faff lights-out --resume <id>`, and on its exit-2 refusal fall back to `faff lights-out` (mint). Capture the minted run dir from `faff lights-out --json` (`.run_dir`) — the guide's `sed -n 's/^run dir: //p'` idiom is a mismatch (the banner is `Preflight PASS — L4 run minted: <dir>`), and the doc notes it to fix.

**Chosen: the segment boundary is a budget/window escalation (or a timeout hard-kill) — never a graceful clean exit.** This is the correction the mechanism forces, and the reason the ticket's "checkpoint and exit cleanly → resume" framing needs restating: a clean exit sets `owner.status: done`, which classifies as `done-clean` and `--resume` **refuses**. A run is only re-enterable if it stopped in `escalated`, `dead-running`, or `aborted-resumable`. So segmentation is driven by a **per-segment budget/window ceiling that escalates** — set `--until` / `--max` / `budget.window` with at-ceiling `escalate`, so the segment ends in the `escalated` state resume re-enters — with the job `timeout-minutes` hard-kill as the fallback (which leaves `dead-running`, resumable only once the heartbeat ages past its stale window, ~900s default). The `dead-running` path therefore imposes a real constraint the doc must state: **the cron interval must exceed the heartbeat-stale window**, or the next firing sees a live heartbeat, classifies `live-running`, and refuses. The escalation path is the primary, deterministic mechanism; the hard-kill is the safety net.

**Chosen: the final step distinguishes a resumable segment boundary from a terminal run, so the disposition exit means what it should — keying on `exit 0 vs any-nonzero`, not a 0/2 dichotomy.** L3's `faff disposition` last step treats an escalated or incomplete run as needs-attention — but at L4 every non-final segment boundary *is* escalated-or-incomplete by construction, so a bare disposition would turn every firing red. So the final step first runs `faff lights-out --resume <id> --check` (re-enterability plan, no writes), which has **three** exit classes, and the workflow branches on 0-vs-nonzero:

- **exit 0 — re-enterable, proceed:** a clean segment boundary. The firing **exits 0** (the next firing continues the same run).
- **exit 1 — recoverable / needs-config:** a re-confronted still-over-budget run (a total token/cost overspend, not the per-segment `--until`/`--max`/`window` boundary), a preflight no longer satisfied, or lock contention. Route to `faff disposition --run-dir <id>` — it surfaces the run for a human (a budget raise, a config fix). The lock-contention subclass is transient/retry-worthy rather than truly terminal, and the doc notes that.
- **exit 2 — terminal, not re-enterable:** `done-clean` (the run finished), `unparseable`, a missing ledger, or a parallel `slots.concurrency`. Route to `faff disposition --run-dir <id>` as the authoritative red/green exit (`done-clean` → green; the rest → red). `live-running` also exits 2, but the `concurrency:` block prevents an overlap that could produce it.

So: **exit 0 → the firing is green (more to come); any nonzero → `faff disposition` is the authoritative exit** (green only on a genuinely done-clean run, red on anything needing a human). This closes the exit-1 class the naive 0/2 split would have dropped.

**Chosen: `slots.concurrency` must be sequential (or unset) — a distinct axis from the GitHub `concurrency:` block.** `lights-out --resume` is sequential-executor only in v1: a `parallel` issue-dispatch slot refuses. That is a faff-config property, separate from the workflow-level `concurrency:` block (which serialises *firings* and also avoids a spurious `live-running` refusal from an overlap). The reference documents both requirements — they are not the same thing, and satisfying one does not satisfy the other.

**Chosen: §0a (the run-start PRD/target mandate) runs only at mint; a resume trusts the original verdict — the mandate is fixed for the run's life.** §0a's PLAN/drain/refuse verdict (`faff run-start`) is a run-*start* decision, and `lights-out --resume` re-enters without re-running it. That is correct, not a gap: a PRD edited between firings must not silently re-scope work already in flight. So a **mint** firing runs the cheap pure-CLI pre-gate — `faff prd list --json`, `faff config get tracking.repo`/`tracking.container`, `faff run-outward --target … --self … --json`, `faff run-start --signals '{…, "prd_admissible": true, …}'` (optimistically true; the pre-gate can only be *more* permissive than the real §0a, so it rules firings out, never in) — and proceeds only on `drain`, skipping the expensive agent on a `refuse`/`plan`. A **resume** firing skips the pre-gate entirely and re-validates only what `lights-out --resume` re-fires: the full preflight plus the escalated-budget re-confrontation. The doc states this so a reader does not expect a resume to re-check a drifted target.

**Chosen: the workflow targets an outward product repo — never faff itself — and names a persistent single-runner workspace as an admission criterion.** The self-directed refusal (`run-outward` → `outward:false / self-referential`) is what makes L4 refuse on faff's own repo (ADR-0069), which is why the L3 watcher is the faff-on-faff shape and this one is not. The reference sets an outward placeholder target (`<your-product-repo>`), visibly not faff, so `decideOutward` returns `outward:true`. And because resume reads `.faff/runs/<id>/run-ledger.json` (never reconstructed from events) and `.faff/` is runtime state, not git-tracked, the ledger survives only if **one self-hosted runner keeps a persistent, non-cleaned workspace between firings** — the reference names this as a requirement and makes the mint-fallback **log loudly** when it expected an open run but found no ledger, so a wiped workspace surfaces as a warning rather than a silent new run-id that breaks same-run-id continuity.

**Chosen: containment is the same admission gate + worked cage, with `faff lights-out --check` as the demonstrable preflight leg.** The first job step is `faff container-check --gate` (fail-closed before any mint/claim), identical to the L3 watcher, referencing the "A cage that passes the gate" section (claude-box the example; ARC pod / devcontainer / sysbox / socket-free-host `container:` the alternatives; the socket trap; the bounded-nested-engine `faff env` path). The reference also includes a `faff lights-out --check` step (full preflight, mints nothing) as the **demonstrable** "preflight clears, no bypass" leg of the containment acceptance — the testable half — while the full end-to-end drain (and the code-blind holdout lane, which still ships as preview) is deferred to the operator. The preflight's dial-coherence legs are operator config: adversarial `slots.spec_review` in `.faffrc.local.yaml` (`gates.fallback` defaults `fail-closed`, so only the spec_review dial needs setting); the doc names this L4 prerequisite.

**Chosen: auth is documented inline as a two-column matrix; evidence and disposition are inherited unchanged.** Auth (ADR-0092): the **solo path** is a self-hosted runner + a subscription seat as a long-lived env-var token (the CI path) from a secret; the **team path** is a hosted runner + a metered API key via `api_key_env`. Secrets always from the environment, never a committed rc (ADR-0067); seats per-operator, never pooled; faff consumes the seat, never implements login (exact seat-handle wiring is FAFF-481). Evidence lands via graft's existing `.faff/anchors/<run>/<issue>/` emitter (the FAFF-596 scope, now shipped) — no new mechanism. The L4-relevant disposition outcomes the doc names: `budget-escalated`, `non-convergence`, `product-incomplete` (run escalations), `parked-window` (the FAFF-594 window breach — which at L4 **spans firings**, because `--resume` re-enters the same ledger and the 5-hour window anchor persists in it, unlike L3's per-firing fresh window), and `pr-open-for-human` from the L4-only holdout.

**Assumes:** the operator provides the outward product repo + tracker config, the self-hosted rig with a persistent single-runner workspace (FAFF-609), the subscription-seat/API-key secret (FAFF-481 wiring), sequential `slots.concurrency`, and the `.faffrc.local.yaml` adversarial `spec_review` dial; the passing cage is FAFF-651's; live activation (promoting to the product repo's `.github/workflows/`) is the operator's step. `--gate`, `l3-watcher.yml`, and the worked-cage doc are on `main`. This ticket produces the reference workflow + companion doc and demonstrates the preflight via `--check`, not a live end-to-end L4 run.

## 3. HOW — acceptance

- A reference workflow under `operations/ci/` (`l4-watcher.yml`): `on: schedule` + `workflow_dispatch`, `concurrency` (`cancel-in-progress: false`), `permissions: contents: read`, outward placeholder target.
- **Resume segmentation:** each firing resolves the newest `.faff/runs/<id>`, attempts `faff lights-out --resume <id>`, and on its exit-2 refusal mints with `faff lights-out --json` (run dir from `.run_dir`). Two consecutive firings continue the **same run-id**; the final firing reaches run-done. The `--json` capture is used (the `sed` idiom noted as a mismatch to fix).
- **Segment boundary is escalation, not clean exit:** the reference sets a per-segment budget/window ceiling that escalates (leaving `escalated`, which resume re-enters), with `timeout-minutes` hard-kill (`dead-running`) as the fallback and the **cron-interval > heartbeat-stale-window** constraint stated for that path.
- **Final-step reconciliation:** `faff lights-out --resume <id> --check` decides — exit 0 (re-enterable) → the firing exits 0 (more to come); **any nonzero** (exit 1 recoverable/needs-config incl. still-over-budget, or exit 2 terminal) → `faff disposition --run-dir <id>` is the authoritative exit. The 0-vs-nonzero split (not 0-vs-2) is explicit so the exit-1 class is not dropped.
- **Admission gate first**, fail-closed (`faff container-check --gate`), before any mint/claim; references the worked-cage section. A `faff lights-out --check` step demonstrates the preflight clears with no bypass.
- **§0a fixed at mint:** a mint firing runs the pure-CLI pre-gate and proceeds only on `drain`; a resume firing skips it and trusts the original verdict — documented, with the reason.
- **Outward targeting:** the reference targets a non-faff placeholder repo; the self-directed refusal is explained. A **persistent single-runner workspace** is named as a requirement; the mint-fallback logs loudly on a missing expected-open ledger.
- **`slots.concurrency` sequential** named as a requirement distinct from the GH `concurrency:` block.
- **Auth matrix** inline: solo (self-hosted + subscription seat / long-lived env token) vs team (hosted + `api_key_env`); env-only, never committed, never pooled.
- **Disposition** L4 outcomes named (`budget-escalated`, `non-convergence`, `product-incomplete`, `parked-window` spanning firings, `pr-open-for-human`).
- Companion doc section in `docs/guide/unattended.md` near the L4 lights-out section. No product mandated; no live `.github/workflows/` job; `docs/guide/` ref-free (`faff lint-refs` passes); `node --test` green; YAML parses.

### Scenarios

```
Given a firing that minted a run and hit its per-segment budget ceiling (escalated), and a later firing
When the later firing resolves the newest run and attempts lights-out --resume <id>
Then it re-enters the same run-id (escalated is re-enterable), continues the drain, and a final firing reaches run-done with evidence anchored.
```

```
Given a mint firing whose target resolves to faff itself (or no target)
When the pure-CLI pre-gate runs (prd list + run-outward + run-start)
Then it returns refuse (self-directed / no-target) and the firing exits before any agent or mint — no LLM spend.
```

```
Given a non-final segment boundary (the run is escalated / dead-running)
When the final step runs lights-out --resume <id> --check
Then it reports re-enterable (exit 0) and the firing exits 0 — a green "more to come", not a red "needs a human".
```

```
Given a resume firing continuing an open run
When it re-enters the ledger
Then §0a does not re-run (mandate fixed at mint), lights-out --resume re-validates the preflight + escalated-budget ceiling, and the 5-hour window anchor persists across the firing.
```

## 4. DONE — definition of done

- [ ] `operations/ci/l4-watcher.yml`: schedule + `workflow_dispatch`, `concurrency` (`cancel-in-progress: false`), `permissions: contents: read`, outward placeholder target.
- [ ] Resolve-newest-and-try-resume, else mint: attempt `lights-out --resume <id>` (self-classifies; exit 2 → mint with `lights-out --json`, run dir from `.run_dir`). No `faff run-done` doneness test. `sed` idiom noted as a mismatch.
- [ ] Segment boundary is escalation (per-segment budget/window ceiling → `escalated`), with `timeout-minutes` hard-kill (`dead-running`) as fallback and the cron-interval > heartbeat-stale constraint stated.
- [ ] Final step: `lights-out --resume <id> --check` → exit 0 (re-enterable) exits the firing 0; **any nonzero** (exit 1 recoverable incl. still-over-budget, or exit 2 terminal) → `faff disposition --run-dir <id>` propagates the exit. The exit-1 class is handled, not dropped.
- [ ] Admission gate `faff container-check --gate` first, fail-closed; references the worked-cage section; a `lights-out --check` step demonstrates the preflight clears with no bypass.
- [ ] §0a fixed at mint; mint firing runs the pure-CLI pre-gate (`prd list` + `run-outward` + `run-start`), proceeds only on `drain`; resume skips §0a — documented with the reason.
- [ ] Outward targeting: non-faff placeholder; self-directed refusal explained. Persistent single-runner workspace named as a requirement; mint-fallback logs loudly on a missing expected ledger.
- [ ] `slots.concurrency` sequential named as a requirement distinct from the GH `concurrency:` block.
- [ ] Auth matrix inline: solo (self-hosted + subscription seat / long-lived env token) vs team (hosted + `api_key_env`); env-only, never committed, never pooled (ADR-0092 / ADR-0067).
- [ ] Final `if: always()` disposition wiring; L4 outcomes named (`budget-escalated`, `non-convergence`, `product-incomplete`, `parked-window` spanning firings, `pr-open-for-human`).
- [ ] Companion doc section; no product mandated; no live `.github/workflows/` job; `docs/guide/` ref-free (`faff lint-refs` passes); `node --test` green; YAML parses.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
