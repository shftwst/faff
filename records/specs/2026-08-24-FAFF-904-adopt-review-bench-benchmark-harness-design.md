# Spec: adopt review-bench as the in-repo review benchmark harness (FAFF-904)

> Spec: faffter-dark-nlspec · 2026-08-24 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-904.
> Revised 2026-08-24 — folded in the round-1 spec-review objections (QA verifiability, the `requests/`-staleness guard, the byte-identity clarification, and a semantic code-review-lens check) and recorded that the P1 fixtures are non-sensitive test content. Spec-review round-1 verdict was reject-approach; the infosec disclosure major is moot (the P1 source is a throwaway test repo), and the operator accepted the revised spec rather than re-running the backend gate.

This spec covers moving the `review-bench` kit into the faff repository at `eval/review-bench/` as the standard harness for benchmarking faff's two review paths (spec-review and code-review) across models and backends, and for holding the raw material a later fine-tuning effort will draw on. It is written for the build agent doing the move and for the human reviewers who will decide, from the kit's numbers, whether a local model can serve as an L4 reviewer. The kit itself already exists and works in the sibling repository `faff-p1-link-shortener-l4/review-bench`; this ticket is a relocation plus the guardrails that keep it honest once it lives beside the prompts it measures.

## 1. WHY — problem and principles

**The model this turns on: review-bench sends faff's exact review payloads to an endpoint and reports whether the model served, how fast, and whether the output is the findings shape faff's aggregator can score.** That is the whole mechanism. Each request file is a ready-to-send payload (a lens brief as the system message, fenced code context then the spec or diff as the user message); the runner wraps it in either the ollama `/api/chat` body or the OpenAI-compatible `/v1/chat/completions` body at call time, so one request set measures both transports. Nothing about a model's fitness as an L4 reviewer is asserted by the kit; it produces the numbers a human reads to decide.

**Problem statement.** Deciding whether a local model can stand in as an L4 reviewer is currently a judgement with no shared instrument: there is no repeatable way in this repo to point at an endpoint and get back "serves / fast enough / parseable / reasoning-behaved" on faff's real prompts. The review-bench kit answers exactly those questions but lives in a sibling application repo where it is neither discoverable nor version-tracked against the prompts it mirrors. This ticket brings the kit into the faff repository so the instrument sits with the thing it measures.

**Design principles.**

**The kit stays zero-dependency and copyable.** The stated value of review-bench is that you can copy the whole directory to any machine with node and run it, no install. That property governs the packaging: no `package.json`, no npm dependency, no symlink out of the directory, nothing that assumes the surrounding repo is present at run time. An implementation that couples the kit to the faff CLI or the repo layout is rejected even if it is tidier.

**The benchmark must keep measuring what faff actually sends.** The kit carries copies of faff's real lens prompts. Once those copies live in the same repository as their canonical sources, they can drift so the benchmark silently measures a stale prompt. A move that leaves the copies un-guarded against that drift is not done, because the resulting numbers would answer a question about a prompt faff no longer sends.

**Mirror the `eval/` precedent, do not reinvent it.** The `eval/` harness is the near-exact structural precedent in this repo: a zero-dependency node harness that commits its fixtures and baselines, gitignores its real-model run output (`eval/report/`), and is excluded from CI because real model calls cost money and need a configured backend CI cannot guarantee. review-bench is the same class of thing and follows the same conventions rather than establishing new ones.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/` (`eval/README.md`, `eval/run-evals.mjs`) | node (`.mjs`) | The structural precedent: zero-dep harness, committed fixtures + baselines, gitignored `eval/report/`, excluded from CI. review-bench lands as a sibling under `eval/` and copies these conventions. |
| `plugin/skills/faffter-dark-spec-review/refute-architectural.md` and the three sibling `refute-*.md` | Markdown prompt | Canonical sources of the four spec-review lenses. The kit's `lenses/refute-*.md` are byte-identical copies of these (verified at spec time). |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Markdown prompt | Canonical source of the graft-time adversarial code review (the second-opinion five categories). The kit's `code-review/lens/review-lens.md` is the benchmark-shaped rendering of those categories. |
| `test/eval-readme-freshness.test.mjs` | node (`.mjs`) test | Precedent for a committed, zero-spawn `node:test` that guards the eval kit against drift. The lens-parity guard in sub-decision B follows this pattern directly. |
| `faff-p1-link-shortener-l4/review-bench/` | node (`.mjs`) + fixtures | The source kit being moved, roughly 1 MB on disk. |

**Scope statement.** review-bench sits under `eval/` as a second, operator-run harness: `eval/` measures faff's judgement seam (classification, ordering, gloss), review-bench measures faff's review seam (spec-review and code-review) across models and transports.

## 2. Out of scope

- **Automating the model-selection or fine-tuning decision.** — The kit produces numbers; a human reads them and decides whether a local model serves as an L4 reviewer. Building any auto-selection or auto-routing on top of the kit's output is excluded. **Why excluded:** this is a human-judgement call by design, and the related outcome-based routing work is tracked separately in FAFF-452 (outcome-based routing). **Extension point:** a future ticket consuming the kit's `FULL-SUMMARY.md` / `summary.json` output; nothing in this ticket writes a decision.
- **A dedicated fine-tuning capture pipeline.** — Building a purpose-built format or exporter for reviewer input/output pairs is deferred (see the decision in section 6, "Fine-tuning data capture"). **Why excluded:** the kit's existing artefacts already persist the raw material, and a bespoke format should be designed against a concrete fine-tuning plan, not speculatively. **Extension point:** a follow-up ticket that reads `requests/*.json` (the prompts) and `results/<run>/<lens>.content.md` plus `summary.json` (the responses), and shapes them into whatever the training run wants.
- **The fan-out reorder work (FAFF-903).** — FAFF-903 is the ticket that uses review-bench's shared-context cacheable-prefix request set (the kit's `requests-shared-prefix/` directory) to test a reordered fan-out. **Why excluded:** that is a separate experiment run on this kit, not part of landing it. **Extension point:** FAFF-903 runs against the `requests-shared-prefix/` set this ticket lands; landing the kit unblocks it.
- **Wiring the kit as a `faff bench` CLI subcommand.** — Rejected on purpose (see the decision in section 6, "Home and packaging"). **Why excluded:** a subcommand couples the kit to the CLI and undercuts the copy-and-run portability the ticket calls the point. **Extension point:** none intended; if a CLI entry point is ever wanted, it would wrap the kit, not absorb it.

## 3. WHAT — vocabulary, layout, and the request payload

**Vocabulary.**

| Term | Definition |
|---|---|
| spec-review suite | The four independent refute lenses (architectural, infosec, methodology, QA) run over the real roughly 40 KB product spec plus its code context. Matches faff's `spec_review` slot. Lives at the kit root (`lenses/`, `spec/`, `context/`, `requests/`). |
| code-review suite | One five-category adversarial review lens run over a real roughly 39 KB git diff plus the files it touches. Matches faff's `review` slot at graft time. Lives under `code-review/`. |
| lens | A system-message brief that tells the model what to look for. Four for spec-review, one for code-review. |
| request payload | A single `requests/<lens>.json` file: a transport-agnostic `{ lens, system, user, context_paths, meta }` object the runner wraps in an ollama or OpenAI body at call time. |
| findings-shaped | Output that carries `### <severity>:` headings (`critical` / `major` / `minor` / `observation`) the aggregator can score. The other shapes (`clean-pass`, `EMPTY`, `NOT-shaped`) are the failure signals the kit reports. |
| reasoning-eaten-budget | The failure mode where a reasoning model fills `reasoning_content` until it hits `num_predict` and emits empty `content` — the reason some reasoning models are unusable on large prompts. The runner flags it. |

**Landing layout.** The kit lands verbatim in structure at `eval/review-bench/`:

```
eval/review-bench/
  run-bench.mjs            # the runner (zero-dep node) — one endpoint, any test kind
  full-bench.mjs           # whole battery for one model -> FULL-SUMMARY.md
  build-requests.mjs       # regenerates spec-review requests/ from lenses/ + spec/ + context/
  lenses/                  # 4 refute lens briefs (copies of the canonical refute-*.md)
  spec/                    # the ~40 KB product spec fixture (gk-20260819-weudrt.md)
  context/                 # the spec's code context (repo paths flattened with __)
  requests/                # generated spec-review payloads (see sub-decision A)
  requests-shared-prefix/  # shared-cacheable-prefix variant (used by FAFF-903)
  code-review/
    lens/                  # the 5-category review lens (review-lens.md)
    diff/                  # the ~39 KB git diff fixture (skeleton.diff)
    context/               # the diff's touched files
    requests/              # generated code-review payloads
    build-requests-code.mjs
  README.md                # thorough harness-internal README (the eval/README.md precedent)
  # results/ is NOT committed — gitignored run output (see section 4)
```

**Request payload shape.** Unchanged from the source kit; recorded here so the build agent does not restructure it:

```
RECORD RequestPayload:            # one per requests/<lens>.json
  lens: String                    # e.g. "architectural", "QA", "code-review"
  system: String                  # the lens brief, verbatim
  user: String                    # context files each fenced <file path="…">, then the spec or diff
  context_paths: List<String>     # reconstructed original repo paths of the context files
  meta: RECORD                    # spec/brief name, system_bytes, user_bytes, approx_prompt_tokens
```

The runner reads a payload, wraps `system` + `user` in the selected transport's request body, sends a single-shot chat completion (no `tools` / function-calling, matching faff's real single-shot reviews), and records timing, token counts, output shape, severity spread, and any separate-channel reasoning bytes.

## 4. HOW — the move, the guardrails, and what CI does with it

The work is a relocation plus three guardrails: gitignore the run output, keep the kit out of CI, and guard the lens copies against drift. None of it changes the kit's runtime behaviour.

**Move the kit.** Copy the whole `faff-p1-link-shortener-l4/review-bench/` tree to `eval/review-bench/`, preserving structure, minus `results/` (a gitignored artefact, see below). Before committing the fixtures, run a secret-and-host scan over `spec/`, `context/`, `code-review/diff/`, and `code-review/context/` and confirm nothing real leaks. At spec time this scan was run: the only hits are psql variable placeholders (`:'migrator_pw'`, `:'app_pw'` in `db/init/10-roles.sh`) and deliberate test-fixture strings in the diff that assert a password is *not* leaked; there are no real secrets, keys, tailnet hosts, or private IPs. The build agent re-runs the scan on the actual moved files and records the result.

**On repository visibility.** The faff repository is public (Apache-2.0), so a committed fixture is world-readable. This is acceptable here because the P1 link-shortener is throwaway test material from a disposable test repository: its spec, diff, and flattened code context carry no sensitive design, no real credentials, and no production data. The secret-and-host scan above is the floor; the design content itself is non-sensitive by provenance. If a future fixture is drawn from a real or sensitive application rather than a throwaway, that fixture must be sanitised or synthesised before commit, because the realism argument does not override a genuine disclosure. For the P1 fixture, there is nothing to disclose.

**Gitignore the run output.** Add a `.gitignore` entry for the kit's `results/` directory, exactly mirroring the existing `eval/report/` entry:

```
# review-bench real-model run output (FAFF-904) — same class as eval/report/
eval/review-bench/results/
```

The generators and fixtures are committed; only `results/` is the unambiguous gitignored artefact.

**Keep it out of CI.** The kit must not run in CI, for the same reason `eval/` does not: its `.mjs` scripts make real model calls that cost money and need a configured backend. Two things keep it out:

- **The `node --test` runner already excludes it by location.** CI runs `node --import ./test/hermetic-env.mjs --test` (see `.github/workflows/validate.yml`), which discovers tests under node's default globs (`test/` plus `*.test.mjs` siblings). The kit lives under `eval/`, not `test/`, and none of its scripts are named `*.test.mjs`, so the runner never picks them up. This is the same mechanism that excludes `eval/`; do not name any committed kit script `*.test.mjs`.
- **The one committed test that DOES run in CI (the lens-parity guard below) lives under `test/`, is zero-spawn, and makes no model calls** — so it is safe in CI. It reads files and compares bytes; it never invokes the runner.

**Anti-pattern:** adding a `package.json` or an npm dependency to make the kit "properly installable." Why: it breaks the copy-and-run-anywhere property that is the kit's reason to exist, and there is no dependency to install.

**Anti-pattern:** wiring the kit's scripts into any CI job or the `node --test` set. Why: real model calls in CI cost money and depend on a backend CI cannot guarantee; this is the exact reason `eval/` is excluded.

### Sub-decision A: commit the generated `requests/`

The `requests/` and `requests-shared-prefix/` directories (roughly 272 KB each) are generated by `build-requests.mjs` from `lenses/` + `spec/` + `context/`, and `code-review/requests/` is generated by `code-review/build-requests-code.mjs`.

**Chosen: commit the generated `requests/`, `requests-shared-prefix/`, and `code-review/requests/` alongside the generators and fixtures.** The kit's stated value is copy-and-run with no build step; committing the payloads means a fresh clone (or a copy of the directory to another machine) runs immediately with no `node build-requests.mjs` first. The tree cost is about 550 KB total across the three request sets, well under the roughly 1 MB the kit already occupies and comfortably under the spec and diff fixtures it is derived from. The generators are committed regardless, so a payload can always be regenerated after a fixture edit; committing the current output just removes a mandatory build step from the common path. The parity guard in sub-decision B keeps the committed payloads' embedded lens text honest, so a stale committed payload is caught the same way a stale lens copy is (see below). The competing option, gitignoring `requests/` and regenerating on demand, buys a leaner tree at the cost of the very build step the copyability principle is trying to avoid; the tree saving does not justify surrendering the principle.

### Sub-decision B: guard the lens copies against drift

Moving the kit in-repo puts a second copy of the four spec-review lens briefs and the code-review lens beside their canonical sources in the same repository. The kit's `lenses/refute-*.md` are byte-identical copies of `plugin/skills/faffter-dark-spec-review/refute-*.md` (verified at spec time). The copies can drift silently, so the benchmark would stop measuring what faff sends. Copyability forbids a symlink, because the directory must stay self-contained when copied off the repo.

**Chosen: a committed zero-spawn parity test at `test/review-bench-lens-parity.test.mjs` that guards three things — the four spec-review lens copies are byte-identical to their canonical `faffter-dark-spec-review/refute-*.md` sources; the lens text embedded in the committed `requests/` matches those same copies; and the code-review lens carries the five canonical review categories in order.** This follows the `test/eval-readme-freshness.test.mjs` precedent: a `node:test` that reads files and compares them, spawns nothing, makes no model calls, and therefore runs safely in the normal CI `node --test` pass. It is a build-time guard that cannot be forgotten, unlike a documented manual refresh step, and it costs nothing per CI run because it is pure file I/O.

**The refresh is a one-line copy, not a re-baseline (answering the "false invariant" objection).** When a canonical lens is edited, the parity test fails and names the drifted file. Clearing it is a single `cp plugin/skills/faffter-dark-spec-review/refute-<lens>.md eval/review-bench/lenses/refute-<lens>.md` (then regenerate the affected `requests/` with `node build-requests.mjs`), which the test's own failure message spells out. This is deliberately not a death-loop against improving the canonical prompt: the byte-identity assertion guards the *prompt copy*, which a `cp` refreshes in seconds; it does not touch the `results/` numbers, so it never forces the multi-hour, real-dollar re-baseline (re-running the benchmark against models is a separate, operator-chosen act done only when fresh numbers are wanted). Making the drift loud at the moment of the canonical edit is the desired behaviour, and the fix is trivial.

**The committed `requests/` are guarded, not silently stale (answering the "zero-dependency contradiction" objection).** Because `requests/` embed the lens text, a committed payload could otherwise drift from the canonical lens even while `lenses/` stays in sync. The parity test closes this by asserting each committed `requests/<lens>.json` `system` field equals the corresponding kit `lenses/refute-<lens>.md` (which byte-identity in turn ties to canonical). So a stale committed payload fails CI exactly as a stale lens copy does, and the "measures what faff actually sends" claim is enforced end to end, not just on the loose lens files. The kit's copyability is preserved: the payloads are still committed and run with no build step; the guard only fails when a refresh was skipped.

The code-review lens gets a **semantic** parity check rather than a byte-identical one, because its `code-review/lens/review-lens.md` is a legitimate rendering of `faffter-dark-adversarial-review/SKILL.md`'s second-opinion five categories (Specification gaming, Implicit assumptions, Failure mode blindness, Security surface, Concurrency and ordering) with the `### <severity>:` output contract appended, not a verbatim slice. The parity test asserts those five category names are present and in order, so a canonical change that adds, drops, or reorders a category fails CI and names the divergence; a pure wording tweak inside a category does not, which is correct for a rendering. The build agent also adds a top-of-file comment in `review-lens.md` naming `faffter-dark-adversarial-review/SKILL.md` as its canonical source, and the README documents the re-derive step.

**Anti-pattern:** symlinking the kit's `lenses/` at the canonical files to avoid the copy. Why: it breaks self-containment; the moment the directory is copied off the repo the symlink dangles, defeating the copyability the kit exists for.

**Failure modes.**

- **The failure:** the fixtures were sanitised or truncated during the move, so the prompt sizes no longer match what faff sends (roughly 15.8 K-token prompts), and the timing and shape numbers describe a smaller prompt than reality. **How you'd know:** the `meta.approx_prompt_tokens` in the committed `requests/*.json` no longer matches the source kit's values, or the spec fixture is materially smaller than roughly 40 KB and the diff smaller than roughly 39 KB. **What it means:** narrow — re-move the fixtures verbatim; realism at real prompt sizes is the point (decision in section 6, "Fixtures").
- **The failure:** the lens copies drift and the benchmark measures a stale prompt, so a model that looks calibrated on the kit's lens no longer matches what faff sends. **How you'd know:** the parity test in sub-decision B fails — on a spec-review lens (byte-identity), on a stale `requests/` payload (embedded-`system` mismatch), or on the code-review lens (a category added, dropped, or reordered). **What it means:** proceed after the one-line `cp` refresh the failure message names (and regenerate the affected `requests/`); the guard exists precisely to make this loud rather than silent.
- **The failure:** the kit's `.mjs` scripts get discovered by CI's `node --test` because one was named `*.test.mjs` or moved under `test/`, and CI starts trying to make model calls. **How you'd know:** a CI run attempts a network call to a model endpoint, or the `node --test` count jumps by the kit's script count. **What it means:** abandon that naming — the only committed test the kit contributes is the zero-spawn parity guard under `test/`; every runner script stays under `eval/review-bench/` and is never named `*.test.mjs`.

## 5. Scenarios

Given a fresh clone of the faff repo
When an operator copies `eval/review-bench/` to a machine with node and no npm install, and runs `node run-bench.mjs --provider ollama --host <URL> --model <NAME>`
Then the run starts with no build step and no dependency install, because the request payloads are committed (sub-decision A) and the kit has no `package.json`.

Given the committed kit at `eval/review-bench/`
When `node --check` is run over every `.mjs` file in the kit
Then all pass, and no `package.json` or npm dependency exists anywhere under `eval/review-bench/`.

Given the canonical spec-review lenses at `plugin/skills/faffter-dark-spec-review/refute-*.md`
When one canonical lens is edited without refreshing the kit's copy under `eval/review-bench/lenses/`
Then the parity test `test/review-bench-lens-parity.test.mjs` fails in the normal CI `node --test` pass, naming the drifted file, and no model call is made by that test.

```
Given the kit's four spec-review lens copies as committed
When the parity test compares each `eval/review-bench/lenses/refute-<lens>.md` to its canonical `plugin/skills/faffter-dark-spec-review/refute-<lens>.md`
Then every pair is byte-identical, for all four of architectural, infosec, methodology, and QA.
```

- The kit contributes exactly one file to the CI `node --test` set: the zero-spawn lens-parity test under `test/`. No runner or generator script under `eval/review-bench/` is discovered by `node --test`.
- The committed `results/` directory MUST NOT be present; `git status` on a fresh run shows the kit's produced `results/` as ignored, matching the `eval/report/` treatment.

## 6. Design decision rationale

**Home and packaging: where does the kit live, and is it a CLI subcommand?**
Options: (a) a standalone copyable directory under `eval/review-bench/`; (b) a `faff bench` CLI subcommand under `plugin/skills/faff/bin/`.
Option (b) makes the kit discoverable through `faff --help` but couples it to the CLI's CommonJS dispatch and the `faff lint-cli-doc` gate, and it undercuts the copy-and-run portability the ticket calls the point (a subcommand cannot be copied to another machine without the CLI). Option (a) mirrors the `eval/` precedent exactly: a zero-dep node harness with committed fixtures and gitignored results, sitting under `eval/` as a second operator-run harness.
**Chosen:** land the kit at `eval/review-bench/` as a standalone copyable directory, not a `faff bench` subcommand — it preserves the portability the kit exists for and follows the established `eval/` precedent rather than inventing CLI coupling.

**Fixtures: check in the real P1 fixtures, or synthesise smaller ones?**
Options: (a) commit the real roughly 40 KB spec, its code context, the roughly 39 KB diff and touched files as-is, after a secret-and-host scan; (b) shrink or synthesise fixtures to trim the tree.
Realism at real prompt sizes (roughly 15.8 K-token prompts) is what makes the timing and output-shape numbers decision-grade; a synthetic small fixture would report timings and reasoning-budget behaviour that do not hold at the sizes faff actually sends, which is the exact failure the kit exists to catch.
**Chosen:** commit the real P1 link-shortener fixtures as-is after a quick secrets-and-host scan (run at spec time, clean: only psql placeholders and deliberate no-leak test strings), no other sanitisation — real sizes are the point. The public-repo disclosure question was weighed and does not bite here: the P1 source is a throwaway test repository with no sensitive design or data (see section 4, "On repository visibility"). This exemption is specific to a throwaway-test-origin fixture; a fixture drawn from a real or sensitive application must be sanitised or synthesised first.

**CI posture: run the kit in CI, or operator-only?**
Options: (a) exclude from CI, gitignore `results/`, mirror the `eval/` exclusion; (b) run some subset in CI.
Real model calls cost money and need a configured local backend CI cannot guarantee; this is the recorded reason `eval/` is excluded from the `node --test` globs.
**Chosen:** operator-run only — exclude the kit's runner scripts from CI (by keeping them out of `test/` and unnamed as `*.test.mjs`), gitignore `results/`, exactly mirroring the `eval/` precedent. The single exception is the zero-spawn lens-parity test, which makes no model calls and belongs under `test/` in the normal CI pass.

**Fine-tuning data capture: build a capture pipeline now, or defer?**
Options: (a) build a dedicated reviewer input/output capture format in this ticket; (b) defer, and note where the raw material already lives.
The kit's existing artefacts already persist the raw material: prompts in `requests/*.json`, responses in `results/<run>/<lens>.content.md` and `summary.json` / `summary.md`. A bespoke capture format should be shaped against a concrete fine-tuning plan, not built speculatively ahead of one.
**Chosen:** defer the dedicated capture format to a follow-up ticket; do not build a capture pipeline here. The README records that the raw material for fine-tuning already lives in the committed `requests/*.json` (inputs) and the produced `results/<run>/<lens>.content.md` plus `summary.json` (outputs), so the follow-up has a defined starting point.

**Generated requests: commit or regenerate?** Covered in sub-decision A above. **Chosen:** commit them, to preserve the no-build-step copyability; generators stay committed for regeneration after a fixture edit.

**Lens-drift mitigation.** Covered in sub-decision B above. **Chosen:** a committed zero-spawn parity test guarding the four byte-identical spec-review lens copies and the lens text embedded in the committed `requests/`, plus a semantic category-order check (and an in-file source comment) for the code-review lens, which is a legitimate rendering rather than a verbatim copy.

## 7. Open questions and assumptions

**Open questions.** None. Every decision above is closed with a `**Chosen:**` marker.

**Assumptions.** None external. The kit, the canonical lens files, the `eval/` precedent, the `.gitignore` idiom, and the `node --test` CI invocation were all verified against the repository at spec time. The source kit lives at `faff-p1-link-shortener-l4/review-bench/` as a sibling of the faff repository; the build agent confirms that path resolves before starting the move, and if the sibling repo is not checked out beside faff, the move cannot proceed and the ticket parks for the operator to provide it.

## 8. DONE — definition of done

### From WHY
- [ ] The kit is present at `eval/review-bench/` with the runner (`run-bench.mjs`, `full-bench.mjs`), both generators (`build-requests.mjs`, `code-review/build-requests-code.mjs`), the fixtures (`spec/`, `context/`, `code-review/diff/`, `code-review/context/`), both suites' lenses (`lenses/`, `code-review/lens/`), and a README.
- [ ] The kit contains no `package.json` and no npm dependency anywhere under `eval/review-bench/`.

### From WHAT (layout and payload)
- [ ] The landing layout matches the structure in section 3 (spec-review suite at the root, code-review suite under `code-review/`).
- [ ] Each `requests/<lens>.json` is a `{ lens, system, user, context_paths, meta }` payload as shipped by the source kit, unrestructured.

### From HOW (the move)
- [ ] `node --check` passes on every `.mjs` file under `eval/review-bench/`.
- [ ] The P1 fixtures are committed as-is and were secret-and-host scanned on the actual moved files, with the scan result recorded (clean, or the leak fixed before commit).

### From HOW (gitignore)
- [ ] A `.gitignore` entry ignores `eval/review-bench/results/`, mirroring the `eval/report/` entry; a fresh run shows `results/` as ignored in `git status`.

### From HOW (CI exclusion)
- [ ] No script under `eval/review-bench/` is named `*.test.mjs`, and none lives under `test/`, so CI's `node --test` never discovers the runner or generators. Verifiable: `find eval/review-bench -name '*.test.mjs'` returns nothing.
- [ ] No CI job invokes the kit's runner or generators. Verifiable: a grep of `.github/workflows/*.yml` for `review-bench` returns no matches.

### From HOW (sub-decision A)
- [ ] `requests/`, `requests-shared-prefix/`, and `code-review/requests/` are committed, so the kit runs with no build step; the generators are also committed.

### From HOW (sub-decision B — lens drift)
- [ ] `test/review-bench-lens-parity.test.mjs` exists and is zero-spawn — verifiable: a grep of its own source for `child_process|node:child_process|spawn|fetch|node:http|node:https` returns no matches, so it cannot make a model call or spawn a process.
- [ ] It asserts each of the four `eval/review-bench/lenses/refute-*.md` is byte-identical to its `plugin/skills/faffter-dark-spec-review/refute-*.md` source, failing with a message that names the drifted file and the exact `cp` refresh command.
- [ ] It asserts each committed `eval/review-bench/requests/<lens>.json` `system` field equals the corresponding kit `lenses/refute-<lens>.md`, so a stale committed payload fails CI just as a stale lens copy does.
- [ ] It asserts `eval/review-bench/code-review/lens/review-lens.md` contains the five canonical review categories from `faffter-dark-adversarial-review/SKILL.md` (Specification gaming, Implicit assumptions, Failure mode blindness, Security surface, Concurrency and ordering) in order; that file carries a top-of-file comment naming its canonical source, and the README documents the re-derive step.

### From WHAT (README)
- [ ] The README documents endpoint setup for both transports (ollama `/api/chat` and OpenAI-compatible `/v1/chat/completions`) including reasoning on/off, and how to read `FULL-SUMMARY.md` (serves / parseable / calibrated / reasoning-disable honoured / fan-out serialisation / cache speedup / TTFB).
- [ ] The README records that fine-tuning raw material already lives in `requests/*.json` (inputs) and `results/<run>/<lens>.content.md` plus `summary.json` (outputs), and that a dedicated capture format is deferred to a follow-up.

**Integration smoke test.** The one path that proves the plumbing is connected, run by the operator against a reachable endpoint:

```
PROCEDURE smoke:
  1. From a fresh clone, copy eval/review-bench/ to a scratch dir with node, no npm install.
  2. Run: node run-bench.mjs --provider ollama --host <URL> --model <NAME> --lens qa
  3. Confirm the run completes without a build step and writes results/<run>/summary.md
     with a shape column ("findings-shaped" / "clean-pass" / "EMPTY" / "NOT-shaped").
  4. Separately, in the repo, run: node --import ./test/hermetic-env.mjs --test test/review-bench-lens-parity.test.mjs
     Confirm it passes (all four lens copies byte-identical) and spawns no process.
```

If step 3 produces a `summary.md` and step 4 passes with zero spawns, the kit is landed, runnable, and guarded.

confidence: high
build-tier: complex
spec-review: approve — operator-accepted after a round-1 reject-approach; the QA and architectural design objections are folded into this revision, the infosec disclosure major is moot (non-sensitive throwaway test fixtures), and the backend gate was not re-run per operator decision.
