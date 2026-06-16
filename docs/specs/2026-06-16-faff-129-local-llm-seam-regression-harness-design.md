# Spec — FAFF-129: Local-LLM seam-regression harness (spike)

Buildable spec for **FAFF-129**, a time-boxed (~1–2h) spike. Audience: the build agent running the probe, and the human reviewer deciding the go/no-go on a local-model plumbing-regression harness. It produces a **measurement + a go/no-go finding** (an ADR 0003 addendum), not production CI wiring.

> Spec: faffter-dark-nlspec · 2026-06-16 · interactive · confidence: high. Full spec on Linear FAFF-129.
>
> **Revised 2026-06-16 (during build)** — the driver-path decision changed from agentic `claude -p` to a native `/api/chat` agentic tool-loop with `think:false`, on evidence gathered in the build (the `claude -p` → ollama `/v1/messages` transport cannot disable a reasoning model's thinking, making it impractically slow; see §3/§6). Purpose sharpened to the confirmed use case: **feasibility of an occasional cheap CI smoke check** that guards the kernel's seam-plumbing during the upcoming lean prose refactor — the *authoritative* post-refactor reverify stays a frontier apples-to-apples run; this lane is only the cheap canary.

## 1. WHY — Problem and Principles

**Problem statement.** faff-tidy's deterministic decision kernel (list issues → `faff eligible`/`faff next` → bucket) is regression-tested only by scripted-driver tests and CLI selftests; there is no *live-driver* plumbing check that a real agent still routes the kernel faithfully, and the frontier live-driver (ADR 0003) costs subscription quota per run. ADR 0003's load-bearing finding — the kernel's determinism is **CLI-bound**, not model-judgement-bound — implies the driving model only needs to be a competent **tool-router**, a bar a free local model (Ollama) might clear. This spike probes whether one local model clears it, so we can decide whether a near-free, on-demand local plumbing-regression harness is worth building.

**Design principles.**

- **Tool-call fidelity is measured first, and gates the rest.** A model that flubs tool calls (malformed flags, wrong subcommand, hallucinated CLI, bypassed ports) surfaces *its own* incompetence as false skill-flakiness. Decision-fidelity numbers are only trustworthy once tool-call fidelity is shown to be high. This ordering is non-negotiable — it is the issue's primary guardrail.
- **This probes plumbing, never judgement.** The kernel deliberately routes around the LLM-judgement surface (`vague`/`dupe`/`stale`/`ordering`/synthesis). This spike must **not** be read or sold as a judgement-eval; those run against the shipped frontier model (ADR 0004) and are out of scope here.
- **A spike does not entangle production helpers.** Following ADR 0003, the substrate and probe runner are throwaway/scratch, not committed harness code. The deliverable is a finding, not a shipped feature.
- **The mechanism is the agentic tool-loop, not a single-shot judgement prompt.** The point is the model *issuing* tool calls. A single-shot "output a JSON verdict" prompt (the shipped black-box / direct `/api/chat` path) exercises no tool-calling and would measure the wrong thing.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `docs/adr/0003-live-driver-spike.md` | Markdown | The frontier kernel probe this re-runs locally; its oracle, substrate shape, and 0%-flakiness baseline are the comparison point. The finding lands as an addendum here. |
| `eval/cli-driver.mjs` (`localOpts`) / `eval/ollama-model.mjs` | Node (ESM) | Prior art for reaching the local model: `localOpts` documents the `claude -p` Anthropic-API env-redirect (the path the build rejected — see §3), and `ollama-model.mjs` the native `/api/chat` + `think:false` knobs the probe actually uses. Both confirm host/model are caller-supplied (no localhost default). |
| `plugin/skills/faff/bin/faff` (`eligible`, `next`) | Node (CLI) | The deterministic kernel under test; also the oracle (`faff next`/`faff eligible` give ground truth). Both carry `--selftest`. |
| `eval/ollama-model.mjs` | Node (ESM) | Source of the host/model/`think` knobs — all **caller-supplied** (host `studio.longhair-escalator.ts.net:11434` and model `qwen3.6:27b-mlx` live in fixtures; `think:false` defaults in `makeDirectOllamaDriver`, not the low-level request builder). Confirms "no localhost default". |

**Scope statement.** This sits at ADR 0003's third open lane (costed follow-up #4 — the local-LLM kernel harness), one of three lanes alongside the frontier live-driver and the judgement-evals; it feeds the FAFF-93 live-driver go/no-go.

## 2. OUT OF SCOPE

- **Production / committed harness code.** *Why excluded:* spike — a finding, not a feature; ADR 0003 keeps the probe throwaway. *Extension point:* a follow-up ticket wires a local `kernel` lane into `eval/run-live-evals.mjs`'s `LIVE_KINDS` registry if the probe says GO.
- **CI gating.** *Why excluded:* the issue forbids CI-gating "until proven"; one spike does not prove it. *Extension point:* the scripted driver stays the sole `node --test` gate; a future ticket sets a CI threshold once a baseline exists.
- **Judgement-surface fidelity (`vague`/`dupe`/`stale`/`superseded`/`ordering`/synthesis).** *Why excluded:* not the kernel; must run against the frontier model. *Extension point:* ADR 0004 / FAFF-130 judgement-eval suite.
- **A multi-model sweep.** *Why excluded:* the issue scopes "one local model"; a sweep is a separate cost. *Extension point:* a follow-up runs the same probe across candidate local models if the first model fails the bar.
- **The exact numeric CI-gating threshold.** *Why excluded:* this spike sets only the directional go/no-go for the *next ticket*, not a gate value. *Extension point:* the harness-wiring follow-up calibrates a gating threshold against a real baseline.
- **SDK tool-interception path.** *Why excluded:* ADR 0003 follow-up #2, orthogonal to local-model feasibility. *Extension point:* its own costed follow-up.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Kernel | faff-tidy's deterministic decision pipeline: list issues → per-issue `faff eligible` → `faff next` (with `--not-eligible`/`--parked`/`--blocked`) → bucket → propose mutations. No in-head judgement. |
| Seam | A decision-relevant call routed through a logging port (`./bin/tracker` read, `./bin/faff` verdict). |
| Tool-call fidelity | Fraction of the seam calls the model issues that are **well-formed** (correct subcommand + flags) **and routed** through the ports (no bypass, no hand-guessed verdict). The primary metric. |
| Decision fidelity | Whether the model's emitted buckets/verdicts/mutations equal the deterministic oracle, and whether they are identical across reps (the ADR 0003 flakiness comparison). The secondary metric. |
| Flub | A malformed/incorrect/hallucinated tool call, a bypassed port, or a decision emitted with no corresponding captured seam. |
| Oracle | Ground truth from the real `faff next`/`faff eligible` over the substrate (ADR 0003's published values). |

**Probe configuration (the knobs the build agent sets).**

```
RECORD ProbeConfig:
  base_url:   URL       # REQUIRED, no default — ollama host over Tailscale
                        # (studio.longhair-escalator.ts.net:11434)
  model:      String    # qwen3.6:27b-mlx
  think:      Bool      # default false (FAFF-137 speed); see HOW edge case
  reps:       Int       # 3–5 (spike, directional — NOT the production K=20)
  transport:  Native    # native /api/chat agentic tool-loop (revised — see §3). POSTs directly to
                        #   base_url/api/chat with think:false, tools=[bash]. No claude binary, no
                        #   ANTHROPIC_* env, no credential — so no config-isolation is needed.
```

**Per-rep capture shape (what the probe records).**

```
RECORD RepResult:
  rep_index:        Int
  seam_log:         List<SeamCall>     # appended by ./bin/tracker + ./bin/faff wrappers
  transcript:       JSON               # the /api/chat message list + every issued bash command (fidelity cross-check)
  decisions:        BucketSet          # { ready, on_hold, needs_prep, blocked, park_clear }
  mutations:        List<Mutation>     # { setStatus, removeLabel, ... }
  toolcall_flubs:   List<Flub>         # malformed/bypassed/hallucinated calls
  wall_seconds:     Number

RECORD SeamCall:
  port:    "tracker" | "faff"
  argv:    List<String>                # the exact subcommand + flags issued
  wellformed: Bool                     # recognised subcommand + valid flags for this kernel
```

**Design decision — driver path.** Candidates: (a) agentic `claude -p` with the ollama env-redirect (model issues real `./bin/faff` Bash calls); (b) the shipped single-shot black-box path (`buildEvalPrompt` → JSON envelope); (c) a native `/api/chat` *agentic tool-loop* exposing a generic `bash` tool, so the model still issues `./bin/faff` calls but over a transport that supports `think:false`. (b) is single-shot — no tool-loop, measures the wrong thing. (a) and (c) are behaviourally identical from the seam's view (the model issues the same `./bin/*` Bash calls); they differ only in transport. **Chosen (revised during build):** (c) — native `/api/chat` agentic tool-loop with `think:false`. **Why not (a):** `claude -p` can only reach ollama via the Anthropic `/v1/messages` endpoint, which carries no thinking toggle; `qwen3.6:27b-mlx` then thinks on every turn (measured ~30s/turn, vs ~2–6s with `think:false`), and a trivial prompt timed out at 240s — impractical for the cheap/repeatable CI-smoke-check use case this serves. The native loop keeps the exact agent behaviour (Bash → `./bin/faff`, same seam capture and fidelity metric) while letting thinking be disabled. **Trade-off recorded:** `think:false` is Qwen3's *trained non-thinking mode* (genuinely less deliberation, not hidden tokens); adequate here because the kernel offloads all judgement to the deterministic CLI — confirmed empirically (kernel sub-task determinations correct under `think:false`).

**Design decision — substrate.** **Chosen:** reconstruct ADR 0003's 7-issue throwaway substrate in a scratch dir (mock `tracker.json`; the `./bin/tracker` + `./bin/faff` logging-port wrappers; the published oracle `ready=[ISS-1]`, `on_hold=[ISS-2]`, `needs_prep=[ISS-6]`, `blocked=[ISS-4]`, `park_clear=[ISS-3]`; mutations `setStatus ISS-1→Todo`, `removeLabel faff-parked ISS-3`). Reusing the exact substrate + oracle makes the local result directly comparable to the frontier 0%-flakiness baseline. Not committed (spike rule).

**Design decision — rep count.** **Chosen:** 3–5 reps. ADR 0003's directional probe used N=3; a spike sizes the signal, not a distribution. The production K=20 sweep is for a shipped baseline, not this go/no-go.

**Design decision — model & reasoning mode.** **Chosen:** single model `qwen3.6:27b-mlx`, `think:false` by default; a multi-model sweep is out of scope. If `think:false` visibly degrades multi-step tool routing, one `think:true` diagnostic rep is permitted (cheap, local/free) and recorded — see HOW edge cases.

**Design decision — deliverable.** **Chosen:** an **addendum to `docs/adr/0003-live-driver-spike.md`** (mirroring the FAFF-160 routing-baseline addendum precedent), recording the measurement, the go/no-go, and the observed failure modes; plus a conditional costed-follow-up ticket recommendation. No production code committed.

## 4. HOW — Behavior

**Architecture.** Reconstruct ADR 0003's probe, but drive it with a native `/api/chat` agentic tool-loop (revised — see §3) instead of `claude -p`. The substrate is a scratch dir with a mock tracker and two logging-port wrappers; the kernel brief instructs the agent to drive the kernel by *calling those ports*; a small loop POSTs to `base_url/api/chat` with `think:false` and a single generic `bash` tool, feeding each tool result back until the model emits its final answer — so the model issues the same `./bin/tracker` / `./bin/faff` Bash calls a `claude -p` agent would; the probe records the seam log + every issued bash command; a tiny diff compares the final answer against the oracle and across reps.

**Behaviour summary — one rep.** Spawn the ollama-redirected agent over the substrate brief; it should issue tracker reads + `faff eligible`/`faff next` calls through the ports and emit buckets+mutations; the probe captures every seam, flags flubs, and records the decisions.

```
PROCEDURE run_probe(cfg):
  1. Validate preconditions (Assumptions §7): ollama host reachable + serving model;
     faff next/eligible selftests pass; one agentic smoke rep proves the /api/chat tool-loop
     drives the kernel (issues ≥1 well-formed ./bin/faff call through the port).
     IF the model cannot sustain a tool-loop at all:
        record it as a NO-GO finding (mechanism blocker) and STOP — this is a valid outcome.
  2. Materialise the ADR-0003 substrate in a scratch dir (tracker.json + ./bin/tracker +
     ./bin/faff logging wrappers over the real CLI + the kernel brief).
  3. FOR rep in 1..cfg.reps:
     a. POST to base_url/api/chat with think:false, messages=[kernel brief], tools=[bash];
        each bash tool_call runs in the scratch cwd (SEAM_LOG set) and its stdout is fed back;
        loop until the model returns a final answer with no tool_calls.
     b. Capture: the seam log (./bin ports), every issued bash command, the /api/chat message
        list, the final buckets+mutations, turns, wall time.
     c. Compute toolcall_flubs by cross-checking issued bash commands vs the seam log
        (every decision must trace to a captured well-formed ./bin/faff seam; flag malformed
        flags, wrong/hallucinated subcommands, and port bypasses — e.g. reading tracker.json direct).
  4. AGGREGATE:
     - tool_call_fidelity = wellformed_routed_seams / total_decision_relevant_seams (across reps)
     - decision_fidelity  = (buckets,verdicts,mutations) == oracle, AND identical across reps
  5. Apply the go bar (below) → write the ADR-0003 addendum.
```

**The go bar.**

```
PROCEDURE go_no_go(tool_call_fidelity, decision_fidelity, flubs):
  GO        IF tool_call_fidelity is high (≈≥0.95 well-formed+routed)
               AND decision_fidelity matches the oracle on every rep (no false flakiness)
            → recommend a follow-up to wire an on-demand local kernel-regression lane.
  NO-GO     IF flubs are frequent enough that decisions are unreliable
               (malformed flags, bypassed ports, hallucinated CLIs)
            → local model is not a competent tool-router for this kernel; record failure modes.
  PARTIAL   IF routing is faithful but with recoverable retries / occasional flubs
            → record with caveats; a larger/different local model is the natural follow-up.
```

The ≈0.95 figure is the author's directional bar for *this go/no-go*, not a CI gate (CI thresholds are §2 out-of-scope).

**Edge cases and error handling.**

- **Ollama host unreachable / model not pulled** → terminal for the run; the build agent reports the blocker (do not fabricate numbers). This is the §7 assumption's failure.
- **`claude -p` transport can't disable thinking (the resolved mechanism finding)** → `claude -p` reaches ollama only via `/v1/messages`, which has no thinking toggle, so a reasoning model thinks every turn (impractically slow). This is *why* the driver path was revised to the native `/api/chat` loop (§3). If even the native loop couldn't sustain a tool-loop, that would be a terminal **NO-GO finding** (record it, don't fail silently) — but it does sustain one.
- **`think:false` degrades multi-step routing** → permitted fallback: one `think:true` diagnostic rep; record whether reasoning-on changes tool-call fidelity, noting the wall-time cost.
- **Path variance without decision change** → expected and acceptable: ADR 0003 saw 16 vs 19 seam calls (a redundant `faff eligible`) with identical decisions. Count it as fidelity-neutral, not a flub.
- **Per-rep config-dir race on `~/.claude.json`** → moot on the native `/api/chat` path: the loop never spawns `claude` and never touches `~/.claude.json` or any credential, so the FAFF-138 race the ADR-0003 `claude -p` probe hit simply does not arise.

**Anti-pattern:** running the shipped single-shot black-box driver (`buildEvalPrompt` → JSON envelope) or the direct `/api/chat` path and calling it a tool-routing result. Why: neither issues tool calls, so tool-call fidelity — the whole point — is unmeasured.

**Anti-pattern:** sending any real Anthropic credential to the ollama host. Why: it would ship a credential to a third-party endpoint. The native `/api/chat` path needs no auth token at all, so it carries none — the strongest form of this guard.

**Anti-pattern:** comparing local decision fidelity to the oracle while tool-call fidelity is low. Why: low fidelity manufactures false flakiness — the guardrail's exact failure mode.

## 5. SCENARIOS

```
Given the ollama host is reachable and serving qwen3.6:27b-mlx, and the ADR-0003 substrate is materialised
When the native /api/chat agentic tool-loop (think:false) drives the kernel for N reps
Then every decision-relevant call is cross-checked against the seam log and a tool_call_fidelity
     fraction (well-formed + port-routed) is produced before any decision-fidelity number is reported
```

```
Given tool_call_fidelity is high (≈≥0.95)
When the emitted buckets/verdicts/mutations are diffed against the ADR-0003 oracle and across reps
Then a GO/NO-GO/PARTIAL verdict is recorded with the supporting numbers and observed failure modes
```

```
Given the local model cannot sustain an agentic tool-loop (or the claude -p transport proves impractical)
When the smoke rep / connectivity probe reveals it
Then the run records this as a NO-GO / mechanism finding (not a crash, not fabricated numbers)
```

Non-functional assertions:
- The probe sends **no** Anthropic credential to the ollama host (the native `/api/chat` path uses none).
- The parent `~/.claude.json` is untouched (the native loop never spawns `claude`; config-isolation is moot).
- No production harness code is committed; the substrate/runner are scratch.

## 6. DESIGN DECISION RATIONALE

**Which driver path exercises tool-call fidelity?** Options: agentic `claude -p` (ollama redirect) / single-shot black-box envelope / native `/api/chat` agentic tool-loop. The single-shot envelope has no tool-loop. `claude -p` and the native loop both make the model issue `./bin/faff` Bash calls (faithful seam capture), but `claude -p`'s `/v1/messages` transport can't disable the reasoning model's thinking (impractically slow). **Chosen (revised during build):** native `/api/chat` agentic tool-loop with `think:false` — same agent behaviour, a transport where thinking can be turned off, which the cheap/repeatable CI-smoke-check use case requires.

**Reuse ADR 0003's substrate or author a new one?** A new fixture loses direct comparability to the frontier 0% baseline; reuse keeps the oracle identical. **Chosen:** reconstruct the ADR 0003 7-issue throwaway substrate + oracle (uncommitted scratch).

**How many reps?** K=20 is a production baseline cost; N=3 was ADR 0003's directional probe. **Chosen:** 3–5 reps — a spike sizes the signal.

**One model or a sweep?** The issue scopes "one local model"; a sweep multiplies cost. **Chosen:** single `qwen3.6:27b-mlx`, `think:false`, with a `think:true` diagnostic rep only if routing degrades.

**Where does the finding land?** A standalone doc fragments the lane history; ADR 0003 already collects lane baselines via addenda (FAFF-160). **Chosen:** an ADR 0003 addendum + conditional follow-up ticket.

*Temporal anchor (resolved in build):* ollama's Anthropic `/v1/messages` emulation (what `claude -p` uses) carries **no thinking toggle**, so a reasoning model thinks every turn — impractical. ollama's **native `/api/chat`** does honour `think:false` and multi-turn tool-calling, so the native loop is the viable transport; the smoke rep confirmed it (1.00 fidelity).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. (No `**Punt:**` items — the spike's uncertainties are the *subject* of the probe, captured as measurements and assumptions, not unresolved spec decisions.)

**Assumptions.**

- **Assumes:** the ollama host `http://studio.longhair-escalator.ts.net:11434` (Tailscale) is reachable and has `qwen3.6:27b-mlx` pulled. *Validate:* `curl -s $base_url/api/tags` lists the model before any rep; if not, report the blocker and stop.
- **Assumes (resolved in build):** the local model can sustain an **agentic tool-loop**. Originally framed around `claude -p`; the build found that transport impractical for a reasoning model and used the native `/api/chat` loop instead (§3), which the smoke rep confirmed sustains a tool-loop (issues real `./bin/faff` calls through the port). A future model that couldn't would be the NO-GO mechanism finding (HOW step 1).
- **Assumes:** the real `faff` CLI (`bin/faff eligible` / `next`) is on PATH or resolvable in the scratch dir to back the `./bin/faff` logging wrapper and to generate the oracle. *Validate:* `faff next --selftest` and `faff eligible --selftest` pass before the run.

## 8. DONE — Definition of Done

### From WHY
- [ ] Tool-call fidelity is computed and reported **before** any decision-fidelity number (guardrail order honoured).
- [ ] The write-up is explicitly framed as a plumbing/kernel result, not a judgement-eval.
- [ ] No production harness code is committed (substrate + runner are scratch).

### From WHAT (config & capture)
- [ ] The probe POSTs to the native `/api/chat` with `base_url` supplied (no localhost default), `think:false`, and a single `bash` tool — no credential sent to the host.
- [ ] Each rep captures the seam log, the `/api/chat` message list + issued bash commands, emitted buckets+mutations, flubs, and wall time.

### From HOW (behaviour)
- [ ] Preconditions (§7) are validated first; an unreachable host or a model that can't sustain a tool-loop produces a recorded finding, not fabricated numbers.
- [ ] The ADR 0003 7-issue substrate + logging ports + published oracle are reconstructed faithfully.
- [ ] 3–5 reps run via the native `/api/chat` agentic tool-loop (`think:false`); no config-isolation needed (no `claude` spawn).
- [ ] `tool_call_fidelity` and `decision_fidelity` are aggregated and the GO/NO-GO/PARTIAL bar is applied.
- [ ] A GO/NO-GO/PARTIAL verdict + observed failure modes are written as an addendum to `docs/adr/0003-live-driver-spike.md`.

### From HOW (edge cases)
- [ ] Path variance with unchanged decisions is counted fidelity-neutral, not a flub.
- [ ] If `think:false` degrades routing, a `think:true` diagnostic rep is run and its effect recorded.
- [ ] The parent `~/.claude.json` is verified unchanged after the sweep.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. curl -s $base_url/api/tags | grep qwen3.6:27b-mlx           # host + model present
  2. materialise substrate; faff next --selftest                 # oracle backing works
  3. one agentic rep: native /api/chat tool-loop (think:false, tools=[bash]) over <kernel-brief>,
       model qwen3.6:27b-mlx, cwd = scratch dir
  4. ASSERT the seam log contains ≥1 well-formed ./bin/faff call routed through the port
     # if yes → the mechanism works, proceed to the full N-rep sweep
     # if no  → record the NO-GO mechanism finding and stop
```

confidence: high
