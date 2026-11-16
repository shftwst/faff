# `eval/` — judgement-eval harness (FAFF-130)

An **offline** probe for faff's LLM-**judgement** surface (`vague` / `dupe` / `stale` / `superseded`
classification, `pick-ordering`, synthesis gloss) — the residue the scripted-driver harness
(`test/helpers/`, FAFF-93/94/95/97) deliberately leaves untested. It measures the load-bearing
unknown ADR 0003 flagged: **judgement flakiness** (does the same fixture get classified differently
run-to-run?), not just accuracy.

## Not part of CI
`eval/` is **excluded from the `node --test` globs** — running it makes real `claude -p` model
calls (cost + the `~/.claude.json` config race). `npm test` / CI run only the deterministic pieces:
`test/eval-grader.test.mjs` (grader + orchestration with a **mock** driver) and
`test/eval-cli-driver.test.mjs` (driver-preset wiring via the **pure** `buildInvocation` seam) —
both import `eval/` modules but spawn **zero** processes.

## Proportionate gate — `--gate` (FAFF-180)

The full frontier reverify is a ~1,980–4,950-run, multi-hour sweep — right for a substantive change, disproportionate for a small prose diff (so it gets waived). `--gate` makes the gate **proportionate** and **safe to run anywhere** via a selectable driver:

```
node eval/run-evals.mjs --gate [--driver smart|local|frontier] [--against PATH]
```

| `--driver` | Runs | Hardness | Use |
|---|---|---|---|
| `local` | scoped smoke kinds × low reps (local model) | **soft** — drift report, **always exits 0**, tolerates an absent/sub-par model | CI default-pin; fast trend signal |
| `frontier` | full sweep (`claude -p`) | **hard** — exits non-zero on a baseline regression | substantive change / re-baseline / human |
| `smart` (**default**) | routes by diff surface + local preflight | inherits its route | "do the right thing" |

**Guarantees (tested in `test/eval-gate.test.mjs`):**
- **Soft = advisory.** `local` and `smart→local` **always exit 0** — a regression is a *warning*, never a build blocker. The hard frontier gate is the only non-zero-on-regression path.
- **No death loop.** The driver is resolved **once**; a cheap local **preflight** probes reachability a single time. Unconfigured/unreachable → soft-skip exit 0 — never re-resolved, retried, or fallen back to frontier.
- **No silent frontier cost in CI.** `smart` *recommends* the frontier hard gate for a substantive diff but **never auto-runs it**; only an explicit `--driver frontier` pays the multi-hour cost. Pin CI to `--gate --driver local` (or `smart`).
- The local lane (`FAFF-129` fidelity, `FAFF-183` full preflight hardening) are **enhancements, not blockers** — the soft gate degrades gracefully without them.

## Pieces
| File | Role |
|---|---|
| `cases/*.json` | `EvalCase` fixtures + human oracles (99 files across 32 kinds) |
| `envelope.mjs` | parse the `faff-eval:judgement` block (fail-loud) — judgement capture stays out of the seam harness |
| `grader.mjs` | two-tier **deterministic** grader: closed-set set-equality, ordering rank-correlation, gloss rubric pass-rate (LLM-judge advisory only) + per-case stability/accuracy aggregation |
| `cli-driver.mjs` | the real `claude -p` driver with per-run `CLAUDE_CONFIG_DIR` isolation — **the only piece that costs money**. One code path, two presets (`frontierDriver` / `localDriver`) over `makeCliDriver`; both load the real skills via `--plugin-dir <repo>/plugin` (FAFF-133); frontier forwards OAuth creds + drops `--bare` (FAFF-138), local keeps `--bare` + env-token auth. Pure `buildInvocation` / `*Opts` / `forwardCredentials` for the tests |
| `run-evals.mjs` | orchestrator: load → drive K reps via an *injectable* driver → grade → escalate wobbly cases → aggregate. Owns the `--driver` selector, `--plugin-dir`/`--no-plugin`, and `--compare` |
| `live-driver.mjs` | **faithful lane** (FAFF-135): a `live` SkillDriver for the FAFF-93 harness — reads a fixture via `runSkill`, prompts a real model with faff-tidy's rubric, records the judgement as DecisionRecord **buckets**. Model is injectable (mock in CI; `makeLiveModel` spawns `claude -p`) |

## Two measurement lanes
- **Black-box** (`cli-driver.mjs` + `run-evals.mjs`) — spawn `claude -p` over a self-contained prompt (rubric inlined, FAFF-134), grade the envelope. Coarse, fast, model-sweep-friendly.
- **Faithful / structured** (`live-driver.mjs` + the FAFF-93 harness) — drive the real skill seams against a fixture with a live model, recording structured decisions you can assert with `decision-assert`. Slot the live model into `runSkill` exactly where `scriptedDriver` sits:
  ```js
  import { runSkill } from "../test/helpers/skill-harness.mjs";
  import { liveDriver, makeLiveModel } from "./live-driver.mjs";
  import { localOpts } from "./cli-driver.mjs"; // or frontierOpts
  // real-model smoke (FAFF-131-class — needs a live claude -p; local ≈ minutes/rep):
  // baseUrl/model/apiKey come from your environment (FAFF_EVAL_LOCAL_BASE_URL / FAFF_EVAL_LOCAL_MODEL /
  // FAFF_EVAL_LOCAL_API_KEY), set in your shell or .faffrc.local.yaml — never a repo-embedded host or key.
  // baseUrl and apiKey are REQUIRED: unset → localOpts throws (no localhost default, no placeholder key — see "Drivers" below).
  const model = makeLiveModel(localOpts({ baseUrl: process.env.FAFF_EVAL_LOCAL_BASE_URL, model: process.env.FAFF_EVAL_LOCAL_MODEL, apiKey: process.env.FAFF_EVAL_LOCAL_API_KEY }));
  const rec = await runSkill({ skill: "faff-tidy", tracker, repo, driver: liveDriver({ model }) });
  // rec.buckets.dupe / .vague / … are the model's judgement, captured at the harness seams.
  ```

## Evaluating a new model (FAFF-1484)

`run-model-eval.mjs` scores one model across three lanes, rolls the kinds up by skill and role, and stores a compact result under `eval/results/<model>/<date>/`.

```sh
# a local model: URL, model and key all come from configuration
export FAFF_EVAL_LOCAL_BASE_URL=https://<your-gateway> FAFF_EVAL_LOCAL_MODEL=<model> FAFF_EVAL_LOCAL_API_KEY=<key>
node eval/run-model-eval.mjs --driver local --tier quick

# an Anthropic model (claude -p, OAuth); the format lane needs ANTHROPIC_API_KEY and is skipped without it
node eval/run-model-eval.mjs --driver frontier --model claude-opus-5-5 --effort medium --tier full

# a killed run resumes from its per-kind checkpoints
node eval/run-model-eval.mjs --driver local --tier quick --resume
```

| lane | what it measures | how |
|---|---|---|
| `blackbox` | the judgement sweep over `eval/cases/` | `run-evals.mjs`'s driver, one kind at a time, at the tier's reps with no escalation |
| `live` | `reconciliation`, `verdict-build`, `finding-identity`, `holdout-live` | `run-live-evals.mjs`'s adapters; the local lane builds its model from the same URL, model and key. `holdout-live` needs docker and is skipped, with the reason recorded, without it |
| `format` | spec, architecture, routing and ADR producer output through faff's real parsers (`readinessBlocks`, `faff contract ...`, `faff adr extract-intent`) | `format-check.mjs`; one Messages API request per sample with a unique request id, because a gateway can answer an identical request from a cache |

Select lanes with `--lanes blackbox,live,format` and kinds with `--kinds dupe,vague`. `--tier` picks the rep counts in `model-eval-plan.json`: `quick` is 5 reps per case (3 for `refutation-spec`, which runs several lens prompts per rep), `full` is 20 (5 for `refutation-spec`). The reference baseline was captured at 20 reps with escalation, so a quick result is a coarse signal; the result marks any skill with a kind under 10 reps per case.

**Roll-up.** `skill-roles.json` labels each skill `producer` (the model authors the artefact), `reviewer` or `judge` (an independent pass that should normally run on a different model). The stored table compares only kinds the reference also measured, and lists registered kinds the run did not cover under "Not measured". `faff-graft` and `faff-beep-boop` have no judgement kind, so they have no row; scoring them needs an end-to-end task eval.

**Rebuild from raw captures.** A sweep that was killed writes no summary. `--from-captures` rebuilds a result from the per-rep JSONL files:

```sh
node eval/run-model-eval.mjs --from-captures .faff/eval-runs/RUN_A .faff/eval-runs/RUN_B \
  --model-id <model> --driver local --ignore-kinds refutation-spec --merge-result <other>/result.json
```

`--ignore-kinds` applies to the first capture, for a kind measured again in a later one.

A stored result records the model id, driver, effort, tier, commit and rep counts. It never records the gateway URL or the key.

## Drivers — frontier vs local (FAFF-132)
Two presets of the **same** `claude -p` invocation; the orchestrator/grader are driver-agnostic.

- **frontier** (default) — `claude -p` against the Anthropic API.
- **local** — the same `claude -p` path redirected at a gateway that speaks the **Anthropic Messages API** (no proxy, no new transport): `ANTHROPIC_BASE_URL=<gateway URL>`, `ANTHROPIC_AUTH_TOKEN=<API key>`, `ANTHROPIC_API_KEY=""`, plus `--model`. The URL, model and key are all **required** and come from configuration: `--base-url` / `FAFF_EVAL_LOCAL_BASE_URL`, `--model` / `FAFF_EVAL_LOCAL_MODEL`, and `FAFF_EVAL_LOCAL_API_KEY` (or `LOCAL_API_KEY`). There is **no `localhost` default** and no placeholder key. Local models need ≥64k context.

## Skills loaded into the run (FAFF-133)
The per-rep `CLAUDE_CONFIG_DIR` is isolated (so the nested `claude -p` can't clobber the parent `~/.claude.json` — ADR 0003), but an *empty* config dir also means **no faff skills** — so the spawned `claude` improvises a vanilla-model judgement instead of running the shipped faff-tidy prose. Both presets therefore default to **`--bare --plugin-dir <repo>/plugin`**:

- `--plugin-dir` loads the repo's **own** plugin (skills as shipped in the commit under test, namespaced `/faff:faff-tidy`) — the only way to load a local plugin; project `.claude/skills` is **not** auto-loaded in `-p`, and no settings.json key exists for it.
- `--plugin-dir <path>` overrides the dir; `--no-plugin` disables it for a **vanilla skill-less baseline**.

This supersedes FAFF-132's "frontier is byte-identical to FAFF-130" note — that preserved the skill-less behaviour; both presets now load the same shipped skills so frontier and local measure the same prose.

### Auth & isolation (FAFF-138)
The isolated `CLAUDE_CONFIG_DIR` (ADR 0003) also strips the OAuth credential file (`.credentials.json`), so a **frontier** `claude -p` lands *"Not logged in"*. The local lane dodged this — the env-token auth. The fix, per lane:

- **frontier** — `forwardCreds: true` copies *only* `.credentials.json` into the per-rep `cfgDir` (mutable state stays isolated). And it runs **without `--bare`** — `--bare` only honours *env*-token auth, so it'd ignore the forwarded OAuth file. Isolation instead comes from the fresh `CLAUDE_CONFIG_DIR` + a **clean spawn cwd** (no project `CLAUDE.md`/hooks pulled in); `--plugin-dir` alone still loads the skills.
- **local** — `forwardCreds: false` (**security:** never copy the real Anthropic credential to the local gateway) and keeps `--bare` (env-token auth works under it).

Smoke (frontier, `dupe-001`, 1 rep): `accuracy 1.00 · stability 1.00 · format 1.00`, ~3.7 s — Opus is far faster than the local 27B.

**FAFF-134 — the prompt carries the real rubric.** Loading the plugin alone didn't change the measurement: the prompt never invoked the skill, so the model *improvised* the rubric (the smoke scored `dupe` 1.00 skill-less). The eval prompt now prepends faff-tidy's **actual classification rubric, read verbatim from `<pluginDir>/skills/faff-tidy/SKILL.md`** (section "1. The mess" — dupe / vague / spec-health stale/superseded), via `loadTidyJudgementProse` (fail-loud if the section anchors move). So the **eval/ black-box** measures the *shipped* criteria, kept in sync with what ships. `--no-plugin` loads no rubric → the **improvise baseline** (the control). The faithful *structured* lane — driving the real skill seams via the FAFF-93 harness — is the live-driver (FAFF-135).

**FAFF-140 — also inject the synthesis-gloss contract.** FAFF-134 carried only the *classification* section, so a `gloss` case had no criteria and the model improvised a health-summary (scored 0.00). `loadSynthesisGlossProse` now extracts the **synthesis-gloss contract** verbatim from `faffidavit-rendering/SKILL.md` (`## Synthesis — the issue-gloss contract`), and `loadJudgementCriteria` combines classification + synthesis into the prompt — so the model writes a real one-line synthesis (gloss smoke went 0.00→0.80; the residual is the keyword-brittle oracle). Also re-authored `stale-001`, which was a *premise-wrong* case (= superseded) mislabeled `stale` — now a genuine refresh-not-cancel stale case (0.00→1.00).

## Running it (FAFF-131, human-supervised)
> ⚠ Needs a real `claude -p` + (for frontier) a budget. 99 cases × K=20 base ≈ 1,980 reps, escalating toward 4,950 on wobbly cases.
```sh
# frontier (Anthropic API)
node eval/run-evals.mjs --only dupe-001 --reps 2          # smoke: validate CLAUDE_CONFIG_DIR isolation first
node eval/run-evals.mjs                                   # full run → eval/report/latest.json

# local — export the URL, model and key first, e.g.
#   export FAFF_EVAL_LOCAL_BASE_URL=https://<your-gateway>
#   export FAFF_EVAL_LOCAL_MODEL=<your-local-model>
#   export FAFF_EVAL_LOCAL_API_KEY=<your-api-key>      # or LOCAL_API_KEY
node eval/run-evals.mjs --driver local \
  --only dupe-001 --reps 2                                # smoke: validate reachability + envelope parse first
node eval/run-evals.mjs --driver local

# frontier vs local, same cases, one table → eval/report/compare.json
node eval/run-evals.mjs --compare
```
(`--base-url`/`--model` may instead come from `FAFF_EVAL_LOCAL_BASE_URL` / `FAFF_EVAL_LOCAL_MODEL`; the key is read from the environment only, never from a flag.)

FAFF-131 then fills `records/adr/0004-*.md` (FAFF-130 shipped the **scaffold**) with the measured
per-kind accuracy + flakiness + $/case cost + the gloss judge↔human delta — now tabulable
**frontier vs local** — and the fork recommendation (evals-only / live-driver / both).

## Raw judgement capture (FAFF-320)
A full sweep (`node eval/run-evals.mjs`, and `--update-baseline`) streams **every rep's raw judgement**
to a durable append-only JSONL as each rep completes — *before* the next rep runs — so a `SIGKILL`
mid-sweep loses at most the in-flight rep, and calibration (FAFF-319) reads captured data instead of
re-running a multi-hour sweep. The path is printed at sweep start:
```
.faff/eval-runs/<run-id>/judgements.jsonl        # run-id = YYYYMMDD-HHMMSS (gitignored, durable-local)
```
One JSONL line per completed rep (a `JudgementRecord`): `run_id, ts, case_id, kind, rep, status`
(`"graded"|"errored"`), `raw_text` (the model output, capped to `RAW_CAP` = 16 KB with `raw_truncated`),
`raw_truncated, envelope` (the parsed judgement, `null` on parse failure), `graded, score, signature,
oracle`. **Advisory-only** — never a gate/oracle/`per_kind` input (ADR-0004); the run's pass/fail is
byte-identical with capture on vs off. Errored reps are captured too (an envelope-parse failure keeps
the bounded failing `raw_text` — the highest-value capture for fixing a broken contract).

Inspect model-**predicted vs oracle** per case straight from the log (the documented `jq` recipe — the
same one recorded in the operator-local `.faff/calibration/README.md`):
```sh
jq -c 'select(.case_id=="confidence-001") | {rep, predicted: .envelope, graded, oracle}' \
  .faff/eval-runs/<run-id>/judgements.jsonl
```
`per_kind` accuracy/stability is **derivable** from the captured `score`/`signature` grouped by `kind`
(the source material FAFF-318's resume/checkpoint consumes). Retention: bounded per-rep by the
16 KB `raw_text` cap; no auto-pruning in v1 (a multi-hour sweep is still many MB — prune old
`.faff/eval-runs/` dirs by hand).

## Re-baseline runbook (FAFF-319) — the operator sweep

After a calibration pass edits oracles (see `eval/calibration/oracle-triage.json`), 16 of the 32 kinds in
`eval/cases/` still contribute **nothing** to the regression gate — `eval/baselines/frontier.json`'s
`per_kind` block only holds rows for 16 — until a real sweep writes the rest in. That sweep is
**operator-owned, run by hand in a plain terminal** — it is not automation-eligible and no agent session
may run it. Follow these six points exactly.

1. **Never run it nested under `claude -p`.** ADR-0004: a sweep launched inside an agent session shares
   the parent's Anthropic quota (a token race that starves both) and its `~/.claude.json` (a config
   race that corrupts auth). Small `--only … --reps 3` probes use the *same* nested mechanism, so they
   are excluded too. Run the whole thing from a shell you opened yourself.

2. **The command, and which model it uses.**
   ```sh
   node eval/run-evals.mjs --update-baseline eval/baselines/frontier.json    # full suite, frontier driver
   ```
   `--update-baseline` takes the baseline path as its argument — omit it and the flag is a no-op, control
   falls through to a plain sweep, and you pay for a multi-hour run that writes `eval/report/latest.json`
   and no baseline at all.

   The model resolves `--model` flag **>** `faff config get eval.model` **>** the baked-in
   `claude-sonnet-4-6`. In this repo `eval.model` is set (`.faffrc.yaml`) and currently returns
   `claude-opus-5-5`, so that is what a plain run gets — the `claude-sonnet-4-6` fallback is a safety net
   for a repo with no `eval.model` configured, not the expected outcome here. The run prints the
   resolved model at start (`[run-evals] frontier model: …`); confirm it matches what you intended
   before letting it spend. The committed `eval/baselines/frontier.json` records its model and effort in
   `meta` (`claude-opus-5-5`, `medium`, captured 2026-10-05). The eval model moved there from
   `claude-opus-4-8` once the judgement skills were calibrated for it
   (`records/spikes/2026-10-03-opus-5-5-pragmatism/results.md`). Keep `eval.model` and `eval.effort`
   matching that `meta` unless you deliberately want a different lineage, because nothing in the
   harness warns you when they diverge; re-baseline whenever you change either.

   **Reasoning effort: `eval.effort` and `--effort <level>` (frontier lane; the `local` lane takes the flag only).** The effort resolves
   `--effort` flag **>** `faff config get eval.effort` **>** no flag (ADR-0133). In this repo
   `eval.effort` is pinned to `medium`, so a plain run passes `--effort medium`; `inherit` (the default
   when unset) passes no flag and runs at `claude -p`'s built-in default, which has changed between model
   versions. Pass `--effort low|medium|high|xhigh|max` to override for one run, or `--effort inherit` to
   run at the CLI default despite the pin. An off-vocabulary value fails loud, from the flag or the config,
   and is never forwarded to `claude -p`. The resolved effort is printed at start (`… · effort: <level>`)
   and recorded in the baseline `meta` and the resume stamp, so it joins the `--resume` stamp-guard (a
   resume at a different effort refuses to blend, exactly as a different `--model` does). Like
   `eval.model`, `eval.effort` is part of a baseline's lineage: change it only together with a
   re-baseline. Both live in their own `eval:` block because eval is not a dispatch lane; the
   old `models.eval` / `effort.eval` keys fail loud. On the `local` lane only an explicit `--effort` flag is forwarded to `claude -p`; the pinned `eval.effort` is not, because it belongs to the frontier baseline. The gateway decides whether the level changes anything.

3. **Never pass `--only` with `--update-baseline`.** The advice is unchanged; the reason below replaces
   an older one that FAFF-318 fixed. `--only` narrows the run to a subset of kinds, which does two things
   you don't want for a re-baseline: it produces a **partial** baseline (kinds outside the subset are
   carried over from the prior baseline rather than dropped — `foldInAndWriteBaseline` overlays swept
   kinds onto what's there and prints a `⚠ PARTIAL baseline` warning naming what's still missing), and it
   never checkpoints, so a `--only` run can't be resumed with point 5's `--resume`. A full re-baseline is
   the default. (Use `--only`/`--reps` for read-only smoke probes, never with `--update-baseline`.)

   **The one sanctioned narrowing is `--kind` (FAFF-712), for an oracle-only change.** When a change
   moves the *scoring* of a couple of kinds without touching any case id (correcting an oracle, like
   FAFF-615, or editing a fixture's text in place, like FAFF-1243), `--resume` can't help — it decides
   staleness by case-id changes and would skip exactly the kinds you want re-run — and a full sweep
   re-measures ~27 unchanged kinds to fix two rows. Instead
   scope the sweep to the affected kinds; it folds their fresh rows into the existing baseline and leaves
   every other row byte-identical:
   ```sh
   node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json --kind refutation-spec,grouping
   ```
   `--kind` is rejected with `--only` (both narrow), fails loud on an unknown kind, and — since FAFF-714 —
   **checkpoints per kind to its own `eval/report/frontier-scoped-progress.json`** (distinct from the
   full-sweep file, so the two never clobber each other). So if a scoped sweep dies partway, re-run it
   with `--resume` and it skips the kinds that already finished:
   ```sh
   node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json --kind refutation-spec,grouping --resume
   ```
   Resume granularity is per-kind (a kind checkpoints only when all its cases finish), same as the full
   sweep — a mid-kind interruption re-runs that whole kind.

4. **What it costs (derived, not guessed).** At the current **99** live case files × **20** base reps
   ≈ **1,980** frontier reps; wobbly cases escalate toward **50** reps each, so the worst case is
   ≈ **4,950** reps — a **multi-hour**, real-dollars sweep. Budget for it; don't start it on a laptop
   about to sleep. If `test/eval-readme-freshness.test.mjs` is failing, the corpus has changed since
   this was written — trust the test's numbers over this paragraph and update it.

5. **`--resume` exists — and the plain command destroys what it needs before you'd notice.** If a sweep
   dies partway, do **not** just re-run point 2's command. `--update-baseline` writes a per-kind
   checkpoint to `eval/report/frontier-sweep-progress.json` as each kind finishes, but a bare (no-flag)
   run **truncates that file back to empty before running a single rep** — the plain command silently
   forfeits the resume it just enabled. Reach for `--resume` instead:
   ```sh
   node eval/run-evals.mjs --update-baseline eval/baselines/frontier.json --resume
   ```
   `--resume` reads the checkpoint, skips whichever kinds it already recorded as complete, and runs only
   what's missing. It only works if the resumed run's driver, model, and `--reps` match the run it's
   continuing — a mismatch throws rather than silently blending two different sweeps. And per point 3,
   `--only` never writes a checkpoint at all, so a `--only` run is never resumable regardless. Every
   completed rep is also streamed to `judgements.jsonl` (see *Raw judgement capture*) independent of the
   checkpoint, so a run you can't resume still leaves its judgement data behind for inspection — you just
   pay to regenerate the baseline rows.

6. **What it leaves behind.** On success it rewrites `eval/baselines/frontier.json` (`per_kind` for every
   kind in the run + a fresh `meta`, preserving the policy block), leaves the full
   `.faff/eval-runs/<run-id>/judgements.jsonl` capture, and leaves
   `eval/report/frontier-sweep-progress.json` (the per-kind checkpoint point 5 reads on `--resume`;
   `eval/report/` is gitignored, so this file is durable-local, not committed). **Keep the judgements
   capture** — the follow-up ticket that resolves the triage's `needs-evidence` and
   `suspected-genuine-miss` entries reads it to decide whether a low score is an oracle defect or a
   genuine skill miss; do not prune the run dir until that ticket closes.
