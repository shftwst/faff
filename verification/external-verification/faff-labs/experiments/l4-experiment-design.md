# faff L4 vs one-shot — experiment design, north-star, and plan

*2026-08-03. Supersedes the rubric draft. Grounded on all 9 `faff-lab*-experiment-*-one-shot` controls (surveyed read-only). The study asks whether the faff L4 harness lets a cheap model produce equal-or-better product **and** a better-qualified build than a bare one-shot — and what that costs.*

*Controls are **linked, not copied** — pinned at their surveyed commits in [`results/controls.manifest.json`](results/controls.manifest.json); the scoring rig fetches each at its SHA. Results land under `results/` (see its README).*

---

## 1. Reasoning — what we're actually testing (sharpened by the data)

The starting hypothesis was "faff L4 buys back model cost with structure." The survey **reframes it**, because of one dominant finding:

> **All nine one-shots worked.** Every bare fable-5 run delivered a working, deployed, harness-verified app — 15/15 to 94/94 on their own adversarial harnesses, live on Fly/Netlify, with real error handling and CI. These are **strong controls, not straw men.**

So the naive claim — "faff makes a cheap model *succeed*" — is **already answered yes** by the controls, for this class of PRD (well-specified, medium-complexity, single-service-ish, acceptance-shaped). A one-shot with the cheapest model clears "it runs and passes its tests."

That kills the weak framing and sharpens the real one. faff L4's value on these PRDs is **not** "makes it work" — it's:

1. **Qualification** — the artifacts a one-shot skips: unit tests, ADRs, an explicit spec/PRD-decomposition, a monotone release ladder, traceability. (Universally absent in the controls; see §3.)
2. **Independent trust** — a one-shot *marks its own homework*: each control built its **own** harness and self-certified. faff adds an **independent** adversarial review (a different model trying to break it) and a **code-blind holdout** (judging against a spec it never saw). The decisive question: **does faff's independent layer catch real defects the one-shot shipped and its self-harness missed?** If yes, that's the "safe to stop watching" argument in hard evidence.
3. **The cheaper-than-frontier angle** — the controls already used the *cheapest* model, so L4 can't "go cheaper than the one-shot." The real prize is cross-vendor: **does faff-L4 + cheap-Anthropic match or beat a frontier one-shot (GPT-5.6-sol) bare?** If structure lets a cheap model beat an expensive one's raw output, that's the headline (§8).

**Honest counter-pressure to hold throughout:** faff L4 is *multi-subagent* (decompose → per-ticket graft → adversarial review → holdout). Every control was **single-agent, zero subagents, ~20–50 min**. L4 will almost certainly cost **more** raw tokens/time. So "cheaper" is at risk — the claim must become "the qualification + trust premium is worth the cost premium, **and/or** lets you trust a cheaper model than you otherwise would," not "faff is cheaper." Measure the premium honestly (§5.A.4).

---

## 2. North-star — what a decisive result looks like

**The headline we'd want to earn, strongest first:**

- **A+ (the dream):** faff-L4 + cheap model ≥ a *frontier cross-vendor one-shot* on PRD-AC pass rate, **and** strictly exceeds every arm on qualified-build, **and** its independent layer caught ≥1 real defect the one-shot shipped — at a cost premium you'd pay. → *"Structure beats model tier: a cheap model in faff out-qualifies a frontier model bare."*
- **A (strong):** faff-L4 + cheap model matches the cheap one-shot on correctness, strictly exceeds it on qualified-build (tests/ADRs/decomposition/release-ladder), and caught a real defect — at a stated, tolerable premium. → *"faff turns a working prototype into a trustworthy, well-qualified build."*
- **B (qualified):** matches correctness + adds qualification, but the cost premium is large and no independent-catch materialised. → *"faff buys artifacts and discipline, not trust or savings — worth it only where the paperwork matters."*
- **Null / anti (must be reportable):** L4 ties-or-loses on both correctness and qualification, or thrashes/parks (the opus-5 failure mode — a weak builder the harness *amplifies* rather than tames). → *"On this PRD class, the one-shot is good enough; faff's overhead isn't earning out."* Honest, publishable, and load-bearing for where faff should and shouldn't be pointed.

**The decisive frontier the current 9 can't reach:** every control *succeeded*, so none of these PRDs separates "one-shot fails, decomposition succeeds." The cleanest A+ evidence needs **harder PRDs** where a one-shot breaks and L4's decomposition carries it — a future commission (§8).

**Presentation (the results framing).** Per experiment: a **scorecard** — control vs each L4 arm across the four mechanical axes + the blind judged score, with the cost premium stated. Aggregate the 9 into a **headline table** (win/tie/loss per axis, median cost premium, independent-catch count). This is faff-lab-gallery-shaped: *itself* a faff-produced artifact making faff's case with evidence, not assertion. A null column is a feature, not a failure.

---

## 3. The control set (what we have)

Every PRD is **acceptance-shaped** (13–21 numbered/GWT criteria) **and mandates a verification harness** — so each experiment ships a **reusable, judge-free correctness oracle** (run the control's own harness against the L4 build on the same PRD). That is the single biggest methodological gift here.

| exp | domain | stack | src LOC | control's own tests | economics (out / cache-read / build-min) | outcome |
|---|---|---|---|---|---|---|
| stall | P2P marketplace | Node/Express/SQLite | ~1,891 | harness only (authz + zero-sum ledger, ~858 LOC) | 411k / 30M / ~47 | 4 releases, 49/49 |
| plinth | headless CMS | Node/Fastify/SQLite | ~1,240 | harness only (40 checks, restart-resume) | 295k / 36M / ~44 | 4 releases, 40/40 |
| sealed | ZK encrypted file-drop | Node + Web Crypto | ~1,470 | harness only (17-check MITM + DB/S3 scan) | 68k / 4.9M / ~21 | 17/17 |
| showhands | live audience polling | Node/Express/ws | ~720 | harness only (15-check concurrency+restart) | 151k / 12.9M / ~10 | 15/15 |
| quorum | 3-node replicated KV | **Go**/raft | ~1,909 | **5 `go test`** + fault harness (real kills/partitions, Porcupine) | 301k / 44.7M / ~49 | linearizable, green |
| grocer | event-driven orders/inventory | **Java**/Spring/Rabbit | ~1,434 | harness only (15-check Python; **no JUnit**) | 130k / 12.9M / ~60 | 15/15 |
| divvy | expense splitter | Node/Express/SQLite | ~748 | **unit tests** (money+settlement) + property/authz harness | 227k / 11.8M / ~21 | 13,548 + 25/25 |
| poke | uptime monitor | Node/scheduler | ~917 | harness only (52 asserts, SIGKILL+SSRF) | 73k / 4.3M / ~19 | 52/52 |
| gridlet | spreadsheet engine | Node/zero-dep ESM | ~1,122 | harness only (94 corpus cases, order-permuted) | 93k / 5.7M / ~27 (effort:high) | 94/94 |

*(all fable-5, Claude Code 2.1.215, claude-box, **0 subagents**. Wall-clock excludes external GitHub Actions outages that inflated some raw durations.)*

**The qualified-build gaps — but they're language-relative, which the rubric must respect:**

- **Universal (all 9, the cleanest discriminators):** no **ADRs / decision records**, no **spec/PRD-decomposition** artifact.
- **Mostly (7/9):** no **monotone release ladder** (only stall + plinth shipped incremental releases; the rest were single-shot commits), no **unit tests** (exceptions: **divvy** has real node:test units; **quorum** has 5 `go test`).
- **Language-gated:** no **typed interfaces** applies only to the 7 JS builds — **quorum (Go)** and **grocer (Java)** are typed *by language*, and quorum even ships real unit tests. So an L4 rebuild of quorum/grocer **cannot claim "typed" or "tested" as its delta** — its win must come from ADRs, decomposition, release discipline, and independent verification rigor.

⇒ **Score qualified-build relative to each control's own baseline, not a fixed checklist.** A per-experiment "gap set" (computed above) is the target the L4 arm must fill.

---

## 4. The comparison (arms)

- **A — control:** bare cheap model (fable-5) one-shot. *Built.*
- **B — treatment (money shot):** faff L4, **same PRD, same model (fable-5)**. Isolates the harness — *same model, +faff*.
- **C — model axis:** faff L4, other cheap models. Gated on the **opus-5 characterisation** (running tonight) to pick viable builders — a flip-flopping builder is a bad arm.
- **D — cross-vendor (future, §8):** frontier one-shot (GPT-5.6-sol) as a *control* arm, to test whether cheap+faff beats frontier+bare.

Keep the confound honest: **B-vs-A varies only the harness; C varies the model; never blur them.**

---

## 5. Scoring rubric

### A. Mechanical / judge-free (run it, don't judge it)
1. **PRD-AC pass rate** — run the **control's own committed harness** against the L4 build (same PRD ⇒ same oracle). X/N ACs per arm. Neutral: the control built the oracle, not a judge. *(Fairness caveat in §9.)*
2. **Qualified-build delta** — fill-rate of each control's **per-experiment gap set** (§3): ADRs, spec-decomposition, release ladder, unit tests, typed interfaces (JS only) — present/absent/count, scored against *that* control's baseline.
3. **Independent-catch** — the trust axis: does faff's adversarial review + code-blind holdout **find a real defect in the control** that the control's self-harness missed? Count and severity. *(This is the sharpest single number — it's what "marks its own homework" vs "independently checked" reduces to.)*
4. **Economics premium** — **primary metric: priced $**, computed from each run's per-token-type counts (input / output / cache-creation / cache-read) × **today's advertised, stable API rate** for that type, per model. Subscription/Max pricing is not quantifiable, so the advertised API rate card is the reproducible stand-in — pinned, dated, in [`results/pricing.json`](results/pricing.json) so the comparison re-computes identically later. **Report output-tokens alongside as the model-effort proxy** (cache-read is informational — it's an artifact of the harness's context strategy, not effort). Also carry wall-clock + **subagent count** (0 for every control; L4 will be many). Expect L4 > control in raw $; the question is the multiple and whether the qualification/trust delta earns it — and whether it lets you trust a cheaper model than you otherwise would.
5. **Deployability** — deploys + passes its harness against the live instance (every control did).

### B. Judged / panel (only "is the code *actually better*")
Blind head-to-head on PRD-intent fidelity beyond the ACs, clarity, structure, maintainability, foot-guns. **Unlabelled arms, cross-vendor panel, judge-built-no-arm** (§6). Agreement = signal; disagreement = your tie-break.

---

## 6. Who scores, and how

**Principle: the judge built none of the arms, and is blind.** LLM-as-judge self-preference bias is real.
- **fable → never a judge** (built the control).
- **opus → second voice only, and not if it built the arm** (same-family affinity partly cancels in the delta; style-recognition still tilts).
- **GPT-5.6-sol (cross-vendor) → the neutral anchor**; make it a **panel** with a second cross-vendor (Gemini).
- **Non-negotiables:** blind (unlabelled), consistent (same judge+rubric both arms), and §5.A stays judge-free.
- *The inventory/survey work is descriptive, not judgment — bias doesn't bite there; any model does it.*

---

## 7. Plan (sequence + dependencies)

- **Phase 0 — survey (DONE).** 9 controls inventoried; per-experiment gap sets + AC counts + economics baselines captured (§3).
- **Phase 1 — settle + build the rig (doc + code, no cage needed).** Resolve the open questions (§9). Build the **scoring rig**: a script that, given a control repo + an L4 build, runs the control's harness against both, computes the qualified-build gap-fill, and diffs economics. This is reusable faff-lab tooling and it's the mechanical half of every scorecard.
- **Phase 2 — L4 treatment runs (GATED on the CI-runner cage).** Each L4 arm is a real `faff lights-out` run on a PRD → needs container isolation the preflight demands, which is exactly FAFF-646/651. **This experiment is downstream of the CI-runner workstream — not parallel to it.** Also gated on the opus-5 char (which cheap models are viable builders for arm C).
- **Phase 3 — score + publish.** Run the rig, run the blind panel (Phase B), assemble per-experiment scorecards → the aggregate gallery table. Null results included.

**Critical-path insight:** Phases 0–1 are doable now (read-only + tooling, no cage, no judgment-automation). Phase 2 is blocked on the cage. So the useful pre-cage work is: the scoring rig + the settled rubric — so the moment the runner lands, the treatment runs have a scoresheet waiting.

---

## 8. Cross-vendor — the future angle

The framing that turns this from "faff adds paperwork" into "structure beats model tier":

1. **GPT-5.6-sol as control arm D** — a frontier one-shot from the same PRDs. The PRDs already exist, so it's nearly free. Enables the **A+ headline**: *faff-L4 + cheap-Anthropic vs frontier-cross-vendor bare*. If the cheap-in-faff arm matches/beats the frontier one-shot on qualified-build, that's the strongest possible statement of the thesis.
2. **Cross-vendor judge panel** — GPT-5.6-sol + Gemini as the blind §B judges (neutral to both Anthropic arms), with your human tie-break on disagreement.
3. **Harder-PRD frontier (the decisive extension)** — the current 9 all succeeded as one-shots, so they can't show "one-shot fails, decomposition wins." Commission a few **deliberately harder** PRDs (more services, cross-cutting invariants, larger surface) where a bare one-shot is expected to break — that's where L4's decomposition + adversarial layer should *decisively* separate, and where the "safe to stop watching" claim earns its strongest evidence.
4. **Model-tier ladder** — once the rig exists, sweeping arm C across the cheap-model tier (fable-5 → whatever the opus-5 char clears) against the fixed control set gives a *price/quality curve for building-in-faff* — directly informs which model to pin for `models.build`.

---

## 9. Decisions (settled 2026-08-03) + remaining question

1. **Cost denominator — SETTLED: priced $ at today's advertised API rates, per token type**, per model, from each run's own token-type counts; output-tokens reported alongside as the effort proxy; cache-read informational. Subscription pricing is non-quantifiable, so the advertised API rate card is the stable, reproducible basis — pinned + dated in `results/pricing.json` (fill from the live rate card at scoring time; do not invent rates). See §5.A.4.
2. **Harness fairness — SETTLED: spot-audit** each control's self-built harness for self-flattering gaps; re-derive a neutral harness only where an audit finds one. (Both deep-dived controls — stall, plinth — read as genuinely adversarial, so a full re-derive is likely unnecessary.)
3. **Arm B's model — remaining confirm:** fable-5 specifically for the clean B-vs-A (isolates the harness), then arm C for the model axis. Assumed unless you say otherwise.
