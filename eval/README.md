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

The full frontier reverify is a ~1,580–3,950-run, multi-hour sweep — right for a substantive change, disproportionate for a small prose diff (so it gets waived). `--gate` makes the gate **proportionate** and **safe to run anywhere** via a selectable driver:

```
node eval/run-evals.mjs --gate [--driver smart|local|frontier] [--against PATH]
```

| `--driver` | Runs | Hardness | Use |
|---|---|---|---|
| `local` | scoped smoke kinds × low reps (ollama) | **soft** — drift report, **always exits 0**, tolerates an absent/sub-par model | CI default-pin; fast trend signal |
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
| `cases/*.json` | `EvalCase` fixtures + human oracles (79 files across 29 kinds) |
| `envelope.mjs` | parse the `faff-eval:judgement` block (fail-loud) — judgement capture stays out of the seam harness |
| `grader.mjs` | two-tier **deterministic** grader: closed-set set-equality, ordering rank-correlation, gloss rubric pass-rate (LLM-judge advisory only) + per-case stability/accuracy aggregation |
| `cli-driver.mjs` | the real `claude -p` driver with per-run `CLAUDE_CONFIG_DIR` isolation — **the only piece that costs money**. One code path, two presets (`frontierDriver` / `localDriver`) over `makeCliDriver`; both load the real skills via `--plugin-dir <repo>/plugin` (FAFF-133); frontier forwards OAuth creds + drops `--bare` (FAFF-138), local keeps `--bare` + env-token auth. Pure `buildInvocation` / `*Opts` / `forwardCredentials` for the tests |
| `run-evals.mjs` | orchestrator: load → drive K reps via an *injectable* driver → grade → escalate wobbly cases → aggregate. Owns the `--driver` selector, `--plugin-dir`/`--no-plugin`, and `--compare` |
| `live-driver.mjs` | **faithful lane** (FAFF-135): a `live` SkillDriver for the FAFF-93 harness — reads a fixture via `runSkill`, prompts a real model with faff-tidy's rubric, records the judgement as DecisionRecord **buckets**. Model is injectable (mock in CI; `makeLiveModel` spawns `claude -p`) |
| `ollama-model.mjs` | **fast local lane** (FAFF-136, path B): `makeOllamaModel` — a direct ollama `/api/chat` completion (no agent loop, ~seconds/rep) as the `liveDriver` model fn. Pure `buildOllamaRequest`/`parseOllamaResponse`; `post` injectable (mock in CI, zero network) |

## Two measurement lanes
- **Black-box** (`cli-driver.mjs` + `run-evals.mjs`) — spawn `claude -p` over a self-contained prompt (rubric inlined, FAFF-134), grade the envelope. Coarse, fast, model-sweep-friendly.
- **Faithful / structured** (`live-driver.mjs` + the FAFF-93 harness) — drive the real skill seams against a fixture with a live model, recording structured decisions you can assert with `decision-assert`. Slot the live model into `runSkill` exactly where `scriptedDriver` sits:
  ```js
  import { runSkill } from "../test/helpers/skill-harness.mjs";
  import { liveDriver, makeLiveModel } from "./live-driver.mjs";
  import { localOpts } from "./cli-driver.mjs"; // or frontierOpts
  // real-model smoke (FAFF-131-class — needs a live claude -p; local ≈ minutes/rep):
  // baseUrl/model come from your environment (FAFF_EVAL_LOCAL_BASE_URL / FAFF_EVAL_LOCAL_MODEL),
  // set in your shell or .faffrc.local.yaml — never a repo-embedded host.
  // Both are REQUIRED: unset → localOpts throws (there is no localhost default — see "Drivers" below).
  const model = makeLiveModel(localOpts({ baseUrl: process.env.FAFF_EVAL_LOCAL_BASE_URL, model: process.env.FAFF_EVAL_LOCAL_MODEL }));
  const rec = await runSkill({ skill: "faff-tidy", tracker, repo, driver: liveDriver({ model }) });
  // rec.buckets.dupe / .vague / … are the model's judgement, captured at the harness seams.
  ```
  **Fast local lane — direct ollama `/api/chat` (FAFF-136, path B).** The agentic `claude -p` model above is ~26 min/rep on a local 27B; a *direct* completion (no agent loop) drops that to ~minutes-or-less — measures model+prompt judgement (less faithful, but isolates flakiness cleanly) and makes a local sweep viable. Same `liveDriver` seam, different model fn:
  ```js
  import { makeOllamaModel } from "./ollama-model.mjs";
  const model = makeOllamaModel({
    // baseUrl/model from FAFF_EVAL_LOCAL_BASE_URL / FAFF_EVAL_LOCAL_MODEL (env / .faffrc.local.yaml).
    // Both REQUIRED: unset → an undefined baseUrl errors in the driver; there is no localhost default.
    baseUrl: process.env.FAFF_EVAL_LOCAL_BASE_URL, model: process.env.FAFF_EVAL_LOCAL_MODEL,
    think: false,                  // FAFF-137: qwen3.6 is a reasoning model — disable the think-block
    options: { num_predict: 2000 } // SAFETY ceiling only (see below) — NOT a conciseness lever
  });
  const rec = await runSkill({ skill: "faff-tidy", tracker, repo, driver: liveDriver({ model }) });
  ```
  **Generation, not transport, is the local cost** — qwen3.6 at ~13 tok/s, and even with `think:false` it can ramble *in the content* (one smoke ran 12s/379 chars, another 4min/10k chars). Conciseness is forced by the **prompt**, not the cap: `EVAL_MODE_INSTRUCTION` says *output ONLY the single fenced block — no reasoning/preamble/prose* (FAFF-137), so the model writes less by intent with the answer intact. **`options.num_predict` truncates — it does not force-fit:** it's a hard stop, the model has no idea the budget exists, and a reasoning model answers *last*, so a tight cap can clip the envelope away → an **errored rep**. Set it **generous** (≥ the longest normal answer, e.g. 2000) as a runaway backstop only. If a model still mis-tags its block as ` ```json `, `parseJudgementEnvelope` recovers the last fenced JSON with a matching `case_id` and flags it `format: "noncompliant"` — judgement isn't lost, and **format adherence is a measured per-model metric** (`format_adherence` in the headline). The A/B choice (agentic-faithful vs direct-fast) per lane is FAFF-131 / ADR-0004's call.

## Drivers — frontier vs local (FAFF-132)
Two presets of the **same** `claude -p` invocation; the orchestrator/grader are driver-agnostic.

- **frontier** (default) — `claude -p` against the Anthropic API.
- **local** — the same `claude -p` path with ollama's **native Anthropic Messages API** redirect (no proxy, no new transport): `ANTHROPIC_BASE_URL=<ollama host>`, `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=""`, plus `--model`. The base URL is **required** (`--base-url` / `FAFF_EVAL_LOCAL_BASE_URL`) — there is **no `localhost` default**, because ollama here is served over **Tailscale**. (Ollama's `ollama launch claude --model <m>` wrapper is an alternative but assumes localhost; the env-var path is what reaches the tailnet host. See docs.ollama.com/integrations/claude-code; local models need ≥64k context.)

## Skills loaded into the run (FAFF-133)
The per-rep `CLAUDE_CONFIG_DIR` is isolated (so the nested `claude -p` can't clobber the parent `~/.claude.json` — ADR 0003), but an *empty* config dir also means **no faff skills** — so the spawned `claude` improvises a vanilla-model judgement instead of running the shipped faff-tidy prose. Both presets therefore default to **`--bare --plugin-dir <repo>/plugin`**:

- `--plugin-dir` loads the repo's **own** plugin (skills as shipped in the commit under test, namespaced `/faff:faff-tidy`) — the only way to load a local plugin; project `.claude/skills` is **not** auto-loaded in `-p`, and no settings.json key exists for it.
- `--plugin-dir <path>` overrides the dir; `--no-plugin` disables it for a **vanilla skill-less baseline**.

This supersedes FAFF-132's "frontier is byte-identical to FAFF-130" note — that preserved the skill-less behaviour; both presets now load the same shipped skills so frontier and local measure the same prose.

### Auth & isolation (FAFF-138)
The isolated `CLAUDE_CONFIG_DIR` (ADR 0003) also strips the OAuth credential file (`.credentials.json`), so a **frontier** `claude -p` lands *"Not logged in"*. The local lane dodged this — `ANTHROPIC_AUTH_TOKEN=ollama` is env auth. The fix, per lane:

- **frontier** — `forwardCreds: true` copies *only* `.credentials.json` into the per-rep `cfgDir` (mutable state stays isolated). And it runs **without `--bare`** — `--bare` only honours *env*-token auth, so it'd ignore the forwarded OAuth file. Isolation instead comes from the fresh `CLAUDE_CONFIG_DIR` + a **clean spawn cwd** (no project `CLAUDE.md`/hooks pulled in); `--plugin-dir` alone still loads the skills.
- **local** — `forwardCreds: false` (**security:** never copy the real Anthropic credential to the ollama host) and keeps `--bare` (env-token auth works under it).

Smoke (frontier, `dupe-001`, 1 rep): `accuracy 1.00 · stability 1.00 · format 1.00`, ~3.7 s — Opus is far faster than the local 27B.

**FAFF-134 — the prompt carries the real rubric.** Loading the plugin alone didn't change the measurement: the prompt never invoked the skill, so the model *improvised* the rubric (the smoke scored `dupe` 1.00 skill-less). The eval prompt now prepends faff-tidy's **actual classification rubric, read verbatim from `<pluginDir>/skills/faff-tidy/SKILL.md`** (section "1. The mess" — dupe / vague / spec-health stale/superseded), via `loadTidyJudgementProse` (fail-loud if the section anchors move). So the **eval/ black-box** measures the *shipped* criteria, kept in sync with what ships. `--no-plugin` loads no rubric → the **improvise baseline** (the control). The faithful *structured* lane — driving the real skill seams via the FAFF-93 harness — is the live-driver (FAFF-135).

**FAFF-140 — also inject the synthesis-gloss contract.** FAFF-134 carried only the *classification* section, so a `gloss` case had no criteria and the model improvised a health-summary (scored 0.00). `loadSynthesisGlossProse` now extracts the **synthesis-gloss contract** verbatim from `faffidavit-rendering/SKILL.md` (`## Synthesis — the issue-gloss contract`), and `loadJudgementCriteria` combines classification + synthesis into the prompt — so the model writes a real one-line synthesis (gloss smoke went 0.00→0.80; the residual is the keyword-brittle oracle). Also re-authored `stale-001`, which was a *premise-wrong* case (= superseded) mislabeled `stale` — now a genuine refresh-not-cancel stale case (0.00→1.00).

## Running it (FAFF-131, human-supervised)
> ⚠ Needs a real `claude -p` + (for frontier) a budget. 79 cases × K=20 base ≈ 1,580 reps, escalating toward 3,950 on wobbly cases.
```sh
# frontier (Anthropic API)
node eval/run-evals.mjs --only dupe-001 --reps 2          # smoke: validate CLAUDE_CONFIG_DIR isolation first
node eval/run-evals.mjs                                   # full run → eval/report/latest.json

# local (ollama over Tailscale) — export the two env vars first, e.g.
#   export FAFF_EVAL_LOCAL_BASE_URL=http://<your-ollama-host>:11434
#   export FAFF_EVAL_LOCAL_MODEL=<your-local-model>
node eval/run-evals.mjs --driver local \
  --only dupe-001 --reps 2                                # smoke: validate reachability + envelope parse first
node eval/run-evals.mjs --driver local

# frontier vs local, same cases, one table → eval/report/compare.json
node eval/run-evals.mjs --compare
```
(`--base-url`/`--model` may instead come from `FAFF_EVAL_LOCAL_BASE_URL` / `FAFF_EVAL_LOCAL_MODEL`.)

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

After a calibration pass edits oracles (see `eval/calibration/oracle-triage.json`), 13 of the 29 kinds in
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

   The model resolves `--model` flag **>** `faff config get models.eval` **>** the baked-in
   `claude-sonnet-4-6`. In this repo `models.eval` is set (`.faffrc.yaml`) and currently returns
   `claude-opus-4-8`, so that is what a plain run gets — the `claude-sonnet-4-6` fallback is a safety net
   for a repo with no `models.eval` configured, not the expected outcome here. The run prints the
   resolved model at start (`[run-evals] frontier model: …`); confirm it matches what you intended
   before letting it spend. Note the committed `eval/baselines/frontier.json`'s `meta` block predates
   the FAFF-315 pinning and carries no `model` key. `models.eval` was pinned back to `claude-opus-4-8`
   (PR #509) so this sweep matches ADR-0089's recorded production sweep, which also ran on
   `claude-opus-4-8`; keep it there unless you deliberately want a different lineage, because nothing in
   the harness warns you when the model changes between sweeps.

   **Reasoning effort — `--effort <level>` (FAFF-722, frontier lane only).** By default no `--effort` is
   passed, so a sweep runs at `claude -p`'s built-in default effort (both a model comparison and a
   re-baseline stay at that same unstated default — fair, but not pinned). Pass `--effort low|medium|high|xhigh|max`
   to pin the reasoning effort for the run; an off-vocabulary value fails loud (it is never forwarded to
   `claude -p`). When set, the effort is printed at start (`… · effort: <level>`) and recorded in the
   baseline `meta` and the resume stamp — so it joins the `--resume` stamp-guard (a resume at a different
   effort refuses to blend, exactly as a different `--model` does). `--effort` is ignored (with a warning)
   on the `local`/`ollama-direct` lanes — reasoning effort is a frontier `claude -p` knob. There is
   deliberately **no** `.faffrc` `effort.eval` config lane (FAFF-416 excludes eval); effort is per-run only.

3. **Never pass `--only` with `--update-baseline`.** The advice is unchanged; the reason below replaces
   an older one that FAFF-318 fixed. `--only` narrows the run to a subset of kinds, which does two things
   you don't want for a re-baseline: it produces a **partial** baseline (kinds outside the subset are
   carried over from the prior baseline rather than dropped — `foldInAndWriteBaseline` overlays swept
   kinds onto what's there and prints a `⚠ PARTIAL baseline` warning naming what's still missing), and it
   never checkpoints, so a `--only` run can't be resumed with point 5's `--resume`. A full re-baseline is
   the default. (Use `--only`/`--reps` for read-only smoke probes, never with `--update-baseline`.)

   **The one sanctioned narrowing is `--kind` (FAFF-712), for an oracle-only change.** When a change
   moves the *scoring* of a couple of kinds without touching any case id (correcting an oracle, like
   FAFF-615), `--resume` can't help — it decides staleness by case-id changes and would skip exactly the
   kinds you want re-run — and a full sweep re-measures ~27 unchanged kinds to fix two rows. Instead
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

4. **What it costs (derived, not guessed).** At the current **79** live case files × **20** base reps
   ≈ **1,580** frontier reps; wobbly cases escalate toward **50** reps each, so the worst case is
   ≈ **3,950** reps — a **multi-hour**, real-dollars sweep. Budget for it; don't start it on a laptop
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
