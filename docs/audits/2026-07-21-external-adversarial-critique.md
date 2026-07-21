# External adversarial critique — whole-repo deep-dive (2026-07-21)

**Scope and method.** An external review of faff at HEAD `4c3bce0`, requested as: scrutinize implementation, premise, status, decisions, patterns, evolution, and trajectory; be adversarial; propose the path to a complete, useful OSS project. Method: full-history git analysis (599 commits, unshallowed), first-hand reads of the gateway, entrypoint, shared-infra, and the FAFF-323 self-audit, plus five parallel deep audits (CLI implementation, test suite, ADR corpus, prompt architecture, infra/CI/docs). Claims marked **[verified]** were reproduced first-hand in this session; the rest carry file:line evidence from the audits. Doc-staleness is treated as a measured completeness fact, not a style critique, per the request.

---

## 1. Verdict

faff has crossed the line from "clever prompt pack" to a genuinely serious system — arguably the most rigorously self-tested agent-delivery harness in the open. The deterministic core is excellent: 31.2k LOC of dependency-free CLI with a 0.92:1 test ratio, 2,142 passing tests that leave the repo byte-clean, fail-closed engineering that is real rather than aspirational, and a self-audit culture (FAFF-323, FAFF-324) that most funded teams don't have.

Three structural problems now dominate, and none of them is "more features":

1. **The prose tier — the tier that actually drives behavior — is the least-governed part of a governance system.** Skills are ~365k real tokens of instruction whose lints are shallow, whose size caps ratchet *upward* to chase the prose, and whose drift rate is demonstrated (FAFF-323 found 5 defects + 8 drifts three weeks into the contract era; this review found new ones since).
2. **The governance flywheel is aimed at itself.** 80 ADRs, 380 specs, 75 CLI verbs, ~50 coined nouns — and **zero recorded evidence** for the product's central external claim (that it works on projects that are not faff). The build rate is accelerating (CLI: 11.9k → 31.2k LOC in the last three weeks) while the evidence rate is zero.
3. **The public artifact is not consumable.** Installs track main with no release channel, the documented install path is likely mis-spelled, development context lives on a private tracker cited 450+ times inside shipped prompts, and there is no contributor surface at all.

The fix is not to slow down. It is to redirect: freeze new governance surface, spend two weeks on mechanical debt and consumability, then point the whole engine at faff-lab until there are committed results. Detail below.

---

## 2. What faff is now (evolution, measured)

| Phase | Period | Shape |
|---|---|---|
| Prompt pack | Apr 16 – May 30 | 12–30 files, zero JS. "For devs who hate project management but still need to ship." Skills as vibes-with-structure: tidy/prep/workit/beep-boop. |
| Contract era | Jun 1 – Jun 30 | CI (Jun 6), ADRs + contracts (Jun 9–11), CLI + node:test suite (Jun 11), evals (Jun 14). FAFF ticketing, release-please, 465 files by Jul 1. |
| Governance era | Jul 1 – now | L3/L4 architecture, lights-out, sentry, budget, integrity digests, merge fences, PRDR lifecycle, faff-lab scaffolds. 884 files. |

Growth curve of the CLI (LOC at date): 1.7k (Jun 15) → 4.8k (Jun 25) → 11.9k (Jul 1) → 14.6k (Jul 8) → 26.4k (Jul 15) → 31.2k (Jul 20). **The growth rate is accelerating** — ~12k LOC landed in the last two weeks. 352 feats vs 80 fixes; 6 reverts. Sole human author + Claude co-authorship on 67 commits; self-hosted development measured at 17.8B tokens / $16,763 over 40 days (docs/reports/token-usage-breakdown). Public surface: 2 stars, 0 forks, GitHub Issues and Discussions disabled.

This trajectory is the context for everything below: the system is compounding capability faster than it is compounding evidence, users, or consolidation.

---

## 3. Premise critique

**What holds (and is worth defending loudly):**

- **Deterministic floors under LLM judgement** is the correct architecture, and faff implements it honestly: closed verdict enums with fail-safe coercion (malformed → `needs-human`, never `pass`), a mechanical merge interlock that "never accepts a caller-supplied CI verdict" (ADR-0043), write-abstention as human-authority encoding. This is increasingly the consensus direction; faff got there early and got the details right.
- **The tracker as control plane** is a real differentiator. Ledgers + park protocol + run reconciliation give a morning-legible record; "the morning view is the tracker, not a wall of logs" is a genuine product insight.
- **The concern boundary** (ADR-0010/0017: faff asserts infra preconditions, never implements sandboxes) is the best negative decision in the corpus — it deleted a multi-month falsely-scoped item and keeps the project buildable by one person.
- **The honesty infrastructure** — the mechanical-vs-model-compliance table, ADRs that falsify their own headline claims (0034's amendment), refutation-log spikes — is rarer and more valuable than any individual guardrail. It is the project's real moat.

**Where the premise is weaker than the pitch:**

- **The enforcement reality at rung 0 is "loud, not strong," and the pitch outruns it.** By the corpus's own record: all four Sentry trip predicates are forgeable at rung 0 including via the sanctioned `faff heartbeat` verb (FAFF-324); the evaluator's code-blindness is "a context convention, not a wall" (l3-l4 doc:34); the build lane can `fs.writeFileSync` the ledger directly; ADR-0073 defers the one mechanically honest isolation (read-only mounts / per-lane processes) for subscription-economics reasons. The internal documents are honest about this; the README's "what keeps it honest" framing is softer. The safety story today is *detective + interlock at the merge seam*, not *preventive isolation* — which is defensible and even sufficient for the L1–L3 product, but it should be sold as what it is: a flight recorder plus interlocks, not a cage.
- **A single same-file contradiction states the maturity problem exactly:** the gateway's levels table labels L4 "(preview)" at `plugin/skills/faff/SKILL.md:21` while line 26 opens "L4 · out of the loop. Lights-out, **and shipped**" **[verified]**. Whichever is true, the always-loaded prompt asserts both.
- **Token economics is an unpriced product tax.** Every verb invocation force-loads the gateway: ~78k real tokens measured (2.82 chars/token calibrated against an actual tokenizer read; the chars/4 census under-counts by ~40%). A `/faff-beep-boop` entry costs ~125k tokens of prompt before any tracker data. The whole skill corpus is ~365k real tokens. For a system whose L4 governor is a spend ceiling, its own prompt overhead is the least-examined line item — and it grows with every incident-response clause added to the Autonomous Mode Contract.
- **Platform coupling is deep and already bit once.** faff is coupled to Claude Code's skill/hook/plugin semantics and to current-model compliance patterns (the banned-rationalisation lists are shaped by specific observed model behavior). The corpus's own audit logged harness drift (TodoWrite → task tools, FAFF-323 O4). There is no stated compatibility posture: which harness versions, which models, what breaks.
- **The addressable user of the full system is currently ≈1.** Fifty coined nouns (gate, lane, slot, floor ×5 species, rung ×3 unrelated ladders, dial, fence, cage, leash, appetite…), 75 CLI verbs, 30 skills. The L1–L3 on-ramp is adoptable; L4 is a research program. Nothing wrong with that mix — but the packaging currently presents them as one product, and the conceptual surface is at the edge of what fits in one head or one context window (FAFF-323 needed a frontier model holding *everything* to find the seams).

---

## 4. The central structural risk: prose is the least-governed tier

The FAFF-323 audit named the correctness model precisely: "faff's correctness rests on prose↔mechanism agreement." The mechanism side is superbly governed (registry↔docs lint, regions require-graph lint, selftests, golden contracts). The prose side — which is where behavior actually lives — is governed by lints that defer to the prose they should bound:

- **Size caps ratchet the wrong way.** Charter: gateway cap 1000, "ratchet down as prose is leaned" (docs/skill-authoring.md:26). Code: cap **1120** (validate-adapters.js:39), gateway at 1112; a fresh beep-boop override of 700 with the file at 699 — one line under its own just-minted cap.
- **The paragraph lint is vacuous for the house style.** `isProseLine` exempts lines starting with `-`/`*` — and the house style is bold-lead mega-bullets. Measured single-line paragraphs of 408, 351, 267, and 220 words all pass a green lint (gateway:906, :1104, :604, :79). The First-run section alone (gateway:79) is a ~450-word single bullet of nested conditionals.
- **~200 prose anchors, zero mechanical validation.** `lint-refs` covers `docs/guide/` ticket-refs only; nothing checks that "gateway → X" targets exist. Live breakage already: the gateway's own "Autonomous Mode Contract → Calibration log" points at a sibling, not a child (:588 vs :767); three refs target bold paragraphs that aren't headings; `## Routing` appears twice (:55, :1108) making that anchor ambiguous; ~30 `§N` refs from other files into beep-boop's internal step numbering will strand silently on any renumber.
- **The charter's own ref-ban is violated 487 times.** docs/skill-authoring.md bans FAFF-NN/ADR refs in prompts; shipped skills carry 450 FAFF-refs + 37 ADR-refs (beep-boop 74, graft 64, gateway 59). These are pointers into a **private Linear board** — dead weight for every adopter's context window and meaningless to every outside reader.
- **Contract drift recurs in shipped defaults.** `faffter-noon-review:110` teaches "the contract's three verdicts" and its emitted template lists `pass|fail|needs-human`; the gateway fixes **four** states including `unavailable` (gateway:956–960) **[verified]**. This is precisely the drift class the conformance apparatus exists to stop, passing its lint.
- **The failure-response pattern is monotonic prose growth.** Each observed model failure adds a banned-phrase clause (155 "never"s in the gateway; ~16-item banned-rationalisation lists). Nothing prunes. More prose → bigger load → weaker mid-session recall → more failures → more prose. This loop is the #1 trajectory risk, and the current lints cannot arrest it because they are calibrated to whatever the prose currently is.

**Pattern-level fix (more valuable than any single repair):** invert the direction of authority. Rules the CLI already enforces mechanically should *leave* the prompt (a one-line pointer + the invocation suffices — the enforcement no longer needs prose backup); prose-only disciplines should be the *scarce, budgeted* residue. Split the gateway into (a) an always-loaded kernel — routing, hard floors, resolver, ~150–200 lines — and (b) on-demand reference sections loaded by the specific verbs that need them. Then make the caps ratchet down mechanically (fail CI if the kernel grows without a paired shrink), fix `isProseLine` to count bold-lead bullets, and lint the anchor web (heading-existence check is a ~50-line addition to validate-adapters).

---

## 5. Implementation (CLI): strengths and verified defects

**Strengths worth preserving** (all evidenced): pure-core/impure-shell with injectable clocks/env/fs at every gate (`runcheckHookDecision`, `reconcileCore`, `decideFloor`); the zero-dependency stance actually held (no package.json anywhere, argv-array `spawnSync` only, one deliberate `shell:true` for repo-declared gate commands); fail-closed engineering with teeth (unknown CI conclusion → fail; egress re-derived at check time so a config lie still refuses; own-fault ≠ empty in `resolveLedgerOrFault`); real concurrency work at the hottest seams (per-call-unique tmp + rename heartbeats, owner-epoch fences, `--match-head-commit` pins, compare-and-swap `update-ref`); and a self-enforcing architecture (ADR-0052's layering checked by `faff regions check` over the real require graph; the monolith→module split proven byte-identical).

**Defects, ranked:**

1. **`events.jsonl` seq mint is an unlocked read-modify-write whose single-writer assumption the architecture has outgrown.** `appendEventRecord` counts lines then appends (events.js:161–168) under a "single-writer in slice 1" header — but the parallel executor, per-member heartbeats (built *because* N writers share a run), `contain --record`, lights-out, and sentry checkpoints all append now. Two concurrent appends both mint seq=N, corrupting "the authoritative monotonic order" consumed by sentry's thrash evaluators and economics. Bonus: every append re-reads the whole log — O(N²) per run.
2. **Ledger writes race: the epoch fence is check-then-write with no CAS, and `atomicWriteLedger` uses a fixed `target + ".tmp"` path** (heartbeat.js:165) — thirty lines below the comment explaining exactly why fixed tmp names crash under two writers (the reason the heartbeat writer uses pid+random). The failure mode the file documents is live in its own sibling function.
3. **Unknown flags are silently accepted and value-flags swallow the next token — in a CLI whose flags flip gate verdicts.** `faff next --status done --spec high --bogus-flag-xyz` → exit 0 **[verified]**; `--run-dir --json` binds the string `"--json"` as the run-dir. The `get(flag) = args[indexOf+1]` pattern is copy-pasted 26 times. A typo'd `--recover` or `--not-eligible` is a silent no-op. This is a fail-open input surface in an otherwise fanatically fail-closed system, and it is one shared argv module away from fixed.
4. **The lenient base-config parse silently degrades governance ceilings.** `parseYamlSubset` never throws; a malformed base `.faffrc.yaml` reads as `{}` and budget/sentry ceilings fall back to defaults without a peep (budget.js:64–84; shared-infra.js:483–485 documents the back-compat as load-bearing). The overlay got strict parsing (FAFF-387) for exactly this failure class; the base kept the hole.
5. **`process.exit(2)` inside a library function** (`readGovernanceConfig`, budget.js:80) — the one live violation of the handlers-return-codes convention; kills importers (tests import budget exports) and bypasses central error policy.
6. **A raw NUL byte (0x00) is embedded in lib/effects.js line 64** (`${e.issue}\x00${e.step}` written as a literal byte) — grep classifies one of the 66 modules as binary and refuses line output **[verified]**. Silently defeats the greppability that ADR-0052 spent a refactor buying. One-character fix.
7. **Windows is broken in undocumented, inconsistent ways**: three different home-dir resolutions (`USERPROFILE` handled in budget.js:320; bare `HOME || ""` in gates.js/hooks-ensure.js; a literal `"~"` fallback in lights-out.js:118 that mints a relative directory named tilde), POSIX `sleep` spawn in env.js:658, and an extensionless shebang binary. No stated POSIX-only posture anywhere.
8. **TOCTOU crash on the hottest path**: `latestRunDir` stats candidates with no try/catch (shared-infra.js:145) inside the Stop-hook that runs at every session turn-end; a concurrently deleted run dir throws through `runcheck`. Ten lines below, `sortRunDirsByMtimeDesc` catches the identical race — the discipline exists, applied inconsistently.
9. **Entrypoint docs are triplicated; one copy is linted.** Header comment (27/75 commands, stale-by-construction), the USAGE string (lines up to 5,070 chars; an unknown subcommand dumps ~40KB to stderr), and cli.md (the only linted surface).
10. **Confirmed rot**: dead exports (`BUDGET_DIMENSIONS`, `RE_ENTERABLE_STATES`, `selectiveStage`), a hardcoded model price table in the spend governor that will silently age (budget.js:117+), IPv4-only private-range classification in `deriveEgress` (fails safe, but incomplete).

---

## 6. Tests: rigorous core, two governance holes

The deterministic layer is the best part of the repo: 118 files / 28,648 LOC / 2,142 tests, all passing in ~3 minutes, spawning the real entrypoint over real git repos in mkdtemp dirs with constructed determinism (`DETERMINISM_ENV`), leaving `git status` byte-clean. The seam-record harness (one seq-ordered seamLog; mutations recorded as *attempts* against a frozen tracker model; matchers with their own falsifiability meta-tests) is genuinely novel test architecture. Anti-rot meta-tests (docker-required arming so skips can't masquerade as passes; a test pinning that live evals stay *out* of CI) show unusual self-awareness.

The holes:

1. **No enforced per-subcommand coverage gate — and it has already failed.** `worktree-prune` — the one module that deletes worktree state, written in response to a real 2026-06-12 clobber — has zero CI execution: not in the 61 hand-enumerated selftest steps, not covered by the governance-region sweep (it's factory-region), zero test-file references. Its selftest passes when run by hand; it is wired to nothing. Meanwhile `cli-coverage.test.mjs` is 63 lines of four spot-checks whose name advertises a gate that doesn't exist, and the real fail-closed coverage checker sits unreferenced in `scripts/verify-split-parity.mjs`.
2. **The LLM-judgement surface has zero blocking regression signal.** Deliberate (ADR-0004, cost) — but compounded by: the local eval gate "ALWAYS exits 0 even on a baseline regression," the size gate's `--enforce` commented out, and the frontier baseline self-declared PROVISIONAL since 2026-06-16 covering 14 of 27 kinds. A prompt edit that halves classification accuracy merges green today.
3. Lesser: scripted-driver skill tests assert their own scripts (their comments admit it — the ~600 LOC re-verify plumbing already covered elsewhere); lights-out post-admission tests run a test-owned copy of the ledger mint (drift mirrors stale composition); 61 CI selftest steps are hand-enumerated with no drift guard — generate them from the registry instead; no coverage measurement exists, and the spawn-heavy architecture makes it harder to retrofit the longer it waits.

---

## 7. Decision architecture: real discipline, worrying tempo

The corpus is consumed, not ornamental — 1,108 downstream ADR citations, specs binding to ADRs, refutation-log spikes. The best entries are exceptional: ADR-0010/0017 (concern boundary), ADR-0004 (measure before architecting, with the eval found wrong three ways), ADR-0043/0075 (merge floor), ADR-0069 (no self-PRD; "the empty state is load-bearing"), and the FAFF-324 re-examination that falsified ADR-0034's own "un-subvertable by construction" headline with eight demonstrated forgery vectors and committed regression tests. That last artifact is the single strongest credibility signal in the repo.

The adversarial reading:

- **The record is largely retrospective, and now self-authored.** ADR-0080 admits ADRs are "born describing a fact that already happened"; authoring is a producer slot inside the delivery loop; statuses rotted until a bulk 18-ADR acceptance sweep (FAFF-342), then rotted again (29 Proposed now); and 0077/0078/0080 are `Provenance: loop` — the machine authors and accepts its own governance record, with the holdout standing in for human corroboration. "Accepted" has quietly become "the PR that already shipped passed its gates."
- **Floors move too fast to be floors.** ADR-0071 recorded a container-confirm floor preserved "so no future reader re-proposes it without reopening deliberately"; ADR-0072 reopened it **the same day**, with the compensating control (FAFF-496's outward pre-filter) explicitly not yet built. 0015→0055 fully superseded in 15 days; 0061 amended in 4; the 0048/0059 pricing divergence knowingly shipped and reversed within days. Each instance is defensible; the tempo, in aggregate, prices every future "deliberately preserved floor" at near zero.
- **Numbering/bookkeeping fragility under parallel authorship** is on the record: one renumber collision, one forward-cite to a stale number, one ADR opening with a mis-cite correction of its own originating ticket.
- **~50 load-bearing coined nouns** with real overloads (rung means three unrelated ladders; floor has five species). Most map 1:1 to a mechanical artifact — the defense is real — but the decode cost is now a genuine adoption barrier and an in-context recall burden.

---

## 8. Status: proven vs promissory

**Proven, in anger:** the L1–L3 loop on faff itself — 442 PRs through its own machinery, nine tickets shipped and reconciled clean in a day (ADR-0069's record), the FAFF-323 probe battery, working release automation, the merge interlock in daily use.

**Promissory, currently without evidence:**

- **External verification: 100% scaffolding, 0% results.** Six rungs designed, eight experiment PRDs written, a one-shot control runbook (Jul 19) — and zero scored outcomes recorded anywhere. The harness needed three repair tickets before first use because earlier runbooks referenced CLI verbs that didn't exist (FAFF-507/512) and scaffolded configs the L4 preflight itself refused (FAFF-513) — the system hallucinating its own interface, i.e., the exact drift class it polices elsewhere, caught only when someone finally tried to *use* the thing.
- **Evals: excellent mechanism, absent evidence.** Seam-registry coverage gating in CI is genuinely good; but baselines are PROVISIONAL/near-uniform-1.00 since Jun 16, 13/27 kinds have no baseline, `triage-results.json` (orphaned at repo root) records 23/24 sampled cases needing regen or human judgment, and the runbook hardcodes a private Tailscale host.
- **L4: shipped as a preflight, not as an outcome.** The holdout lane "has not yet completed a real end-to-end run" (gateway:37); evaluator code-blindness is attested, not enforced; and the gateway calls L4 both "(preview)" and "shipped" in the same table.
- **governance-check on its own repo: decorative by admission** — `on-missing: pass`, the artifact path `.faff/` wholesale-gitignored, required-check status "a documented human toggle."

**Consumability status:** installs track main (72 unreleased commits currently ship under the "0.11.0" label **[verified]**); README's bare `/faff-onboard` spelling contradicts the project's own note that plugin-loaded skills are namespaced (`/faff:faff-tidy`, eval/README.md:80); Node is required and stated nowhere; the committed dogfood `.faffrc.yaml` carries a time-bound "FABLE-WEEK" 3B-token budget override marked "revert after the Fable week" **[verified]**; no CONTRIBUTING/SECURITY/issue templates; Issues and Discussions disabled — the public repo is an artifact of a private process.

---

## 9. Trajectory: the flywheel problem

The last 30 days, summarized: CLI 11.9k → 31.2k LOC; ~2 ADRs/day; 15 follow-on tickets minted by one self-audit; skills corpus at ~365k tokens and rising; meanwhile faff-lab produced scaffolds (three needing repair before first use) and zero recorded runs. The system's own gates are being outrun by its own throughput: caps re-based to fit the prose, statuses bulk-flipped, floors reopened same-day, coverage steps hand-enumerated and already missing a destructive module.

The compounding logic that justifies all this governance — "a defect in faff compounds into everything faff builds" (ADR-0069) — applies with equal force to the *governance itself*: every new verb, noun, dial, and clause is new surface that must stay coherent, and FAFF-323 demonstrated that coherence is already a frontier-context-window problem. On the current trajectory, the drift-detection cost grows faster than the drift-prevention capacity.

The honest question the trajectory poses: **what is the next unit of work that would change an outside observer's belief?** It is not a 76th verb. It is a committed faff-lab result — including, and especially, a failed one.

---

## 10. The path to a complete, useful OSS project

### P0 — redirect (the decision, not a task)

1. **Freeze new governance surface** (new nouns, verbs, dials, contracts) until faff-lab P1–P3 have committed, scored results under `docs/external-verification/results/`. Exception: fixes to defects listed here. The freeze is itself faff-shaped: make it an ADR with a mechanical trip (e.g., CI advisory on COMMANDS-registry growth).
2. **Run the external-verification program now, and publish failures.** P1 end-to-end this week; the one-shot control comparison; first-failure-rung records. Failed runs are the most credible content an early OSS project can publish — and they generate the right backlog (the FAFF-507/512/513 class) instead of the speculative one.

### P1 — mechanical debt (≈ days, kills whole failure classes)

3. **One shared argv module**: declared flags per command, unknown-flag → exit 2, value-flag arity checked. Retires 26 copy-pasted parsers and defect #3.
4. **Concurrency debt now that N-writer is real**: seq mint via O(1) tail-read or per-writer event files merged on read; CAS (or lockfile) on ledger writes; unique tmp names in `atomicWriteLedger`; try/catch the `latestRunDir` stat. These are the mechanical floor the whole premise stands on — they must be beyond reproach.
5. **Strict-or-loud base config parse** (warn on non-map/unparseable base at minimum — the governance ceilings must never degrade silently); fix the NUL byte; return-not-exit in budget.js; state the POSIX/Node≥20 posture in README (or fix Windows, but stating is cheaper and honest).
6. **Coverage governance**: generate the CI selftest steps from the COMMANDS registry (never hand-enumerate 61 steps); add the per-subcommand test-presence gate (the pattern exists in `verify-split-parity.mjs`); wire `worktree-prune`; turn on `NODE_V8_COVERAGE` before the suite doubles again.

### P2 — make it consumable (≈ a week)

7. **A release channel**: point the marketplace at tagged releases (or a release branch advanced by release-please); verify one clean-machine install and transcribe the *actual* command spellings into README; prerequisites block.
8. **De-privatize the context**: enable GitHub Issues (mirror or migrate the active Linear subset); execute the charter's own ref-free sweep of the skills (450 refs — this is simultaneously a token diet); make commit messages self-contained going forward. An OSS project whose every artifact keys to a private board is unreviewable and uncontributable by construction.
9. **CONTRIBUTING.md + SECURITY.md + the dev-install path** (clone → link-skills.sh → node --test) promoted from a script header to a doc. Thirty lines buys a contribution surface; the mechanized checks mean external PRs are cheap to accept.
10. **The gateway diet** (§4's pattern fix): kernel + on-demand reference; downward-ratcheting caps; honest paragraph lint; anchor lint. Success metric: `/faff-wtf` entry cost under 20k tokens without behavior change.

### P3 — positioning (think-work, then packaging)

11. **Split the product story in two**: a stable core (L1–L3: methodology + spec-driven build + tracker control plane — adoptable today, modest claims, the honest trust table as its centerpiece) and a clearly-flagged lab tier (L4, sentry, holdout, integrity) versioned and documented as research. Possibly literally two plugins. The current single package makes the adoptable part carry the research program's complexity tax.
12. **Reframe the safety pitch to match the enforcement reality**: interlocks + flight recorder + detective controls at rung 0, preventive isolation as the documented ladder above it. The internal honesty already exists; promote it to the front page. It will also age better as models improve — the durable value here is the *control plane and audit trail*, not the cage.
13. **Publish the numbers you already have**: the token-usage report ($16.7k/17.8B/40 days), a one-page "what one L3 night costs," and the first faff-lab results. Cost-and-evidence transparency is the differentiator available to exactly nobody else in this space right now.

---

## Appendix — consolidated defect shortlist

| # | Defect | Where | Class |
|---|---|---|---|
| 1 | events.jsonl seq race + O(N²) append | events.js:146–168 | concurrency |
| 2 | Ledger fence no-CAS + fixed tmp path | heartbeat.js:165,174–215 | concurrency |
| 3 | Silent unknown flags; 26 copied parsers | lib-wide | input validation |
| 4 | Lenient base-config parse degrades ceilings | shared-infra.js:237–353; budget.js:64–84 | fail-open |
| 5 | `process.exit(2)` in lib | budget.js:80 | convention |
| 6 | Raw NUL byte → grep-invisible module | effects.js:64 | hygiene |
| 7 | Windows path/`sleep`/shebang breakage, undocumented | budget.js:320; gates.js:496; lights-out.js:118; env.js:658 | portability |
| 8 | latestRunDir TOCTOU crash in Stop-hook path | shared-infra.js:145 | robustness |
| 9 | `worktree-prune` destructive + zero CI execution | validate.yml; regions.js:262 | test governance |
| 10 | Review verdict arity drift (3 vs 4) in shipped default | faffter-noon-review:110,126 vs gateway:956 | prose↔contract |
| 11 | Gateway L4 "(preview)" vs "shipped" same table | faff/SKILL.md:21,26 | prose↔prose |
| 12 | Size caps ratchet upward; paragraph lint vacuous; anchors unlinted | validate-adapters.js:39,56–60 | lint governance |
| 13 | 450 private-tracker refs in shipped prompts vs charter ban | skills corpus | consumability |
| 14 | No release channel; 72 unreleased commits as "0.11.0" | marketplace.json; tags | distribution |
| 15 | Install spelling likely wrong (bare vs namespaced) + no prerequisites | README:35–48 vs eval/README.md:80 | onboarding |
| 16 | Eval baseline PROVISIONAL, 13/27 kinds uncovered; private tailnet host in runbook | eval/baselines; eval/README.md | evidence |
| 17 | External verification: zero recorded results | docs/external-verification | evidence |
| 18 | governance-check decorative on own repo | governance.yml:2–10,35; .gitignore | dogfood |
| 19 | Committed dogfood config carries time-bound budget override | .faffrc.yaml:25–34 | hygiene |
| 20 | triage-results.json orphaned at root; broken `design/` link | root; external-verification/README.md:5 | hygiene |
