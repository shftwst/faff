# FAFF-722 — Thread an explicit `--effort` through the eval driver

> Spec: faffter-dark-nlspec · 2026-08-04 · confidence: high (effort threaded parallel to model; frontier-only; recorded in stamp/meta). Full spec on Linear FAFF-722.

Give the frontier eval driver an `--effort <level>` option that flows to the spawned `claude -p`, threaded exactly parallel to the existing `--model` plumbing. Purpose: pin a sweep's reasoning effort (reproducible baselines) and enable the "is opus-5 tamable at higher effort?" experiment. When no effort is set, every existing caller and every written baseline is byte-for-byte unchanged.

## What to build & why

### The plumbing — one option threaded parallel to `model`

Effort follows the exact path `model` already takes: `buildInvocation` → `frontierOpts` → `resolveDriver` → the `updateBaseline` stamp/meta. Nothing new-shaped is introduced; a second scalar rides the existing rails.

- **Chosen:** `buildInvocation` (`eval/cli-driver.mjs`) destructures `effort = null` from `opts` and appends `...(effort ? ["--effort", effort] : [])` to the args array, sitting next to the existing `...(model ? ["--model", model] : [])`. When `effort` is null the argv is **byte-for-byte** today's. — the smallest possible change at the single point that builds the spawn argv; it's pure and already unit-tested, so the new branch is trivially testable with zero I/O.
- **Chosen:** `frontierOpts` gains an `effort = null` parameter and returns it in its opts object, so the value reaches `makeCliDriver` → `buildInvocation` unchanged. `localOpts` is **not** given effort. — effort is a frontier-lane concept (`claude -p` reasoning effort); the local/ollama lane has no equivalent, mirroring how `--model` resolution already differs per lane (`resolveEvalModel` for frontier vs a raw `--model`/env for local).
- **Chosen:** `resolveDriver` (`eval/run-evals.mjs`) reads `--effort` from argv, validates it (below), and passes it into the frontier preset construction (`frontierDriver({ …, effort })`). The local branch ignores `--effort` (warn if supplied, parallel to the existing `--base-url is ignored for --driver frontier` warning). — `resolveDriver` is already the one place that assembles the driver from argv, so effort is threaded where model/bin/pluginDir already are.

### Vocabulary & fail-loud

- **Chosen:** the accepted levels are faff's existing effort vocabulary — `low | medium | high | xhigh | max` — matching the `.faffrc` `effort:` map. An off-vocabulary value **throws** (non-zero exit, message naming the legal set) rather than being forwarded to `claude -p`. — reusing the established effort vocabulary keeps the eval flag consistent with the config lanes; the fail-loud-on-bad-input stance mirrors the existing `resolveLocalParams` hard errors (`--driver local requires --base-url…`) rather than silently passing junk to the spawned CLI.
- **Assumes:** `claude -p` accepts an `--effort <level>` flag taking those values. This session has invoked `claude -p --effort <level>`, so the flag exists; its **exact** spelling and accepted set are confirmed against the installed CLI during build (the ticket's second open question). If the real flag differs, the vocabulary constant and the arg name are the only two things that move.

### Recording effort (reproducibility)

- **Chosen:** when effort is set, it is recorded in `updateBaseline`'s progress `stamp` (line ~405: `{ driver, model, base_reps, started_at }` gains `effort`) and the written baseline `meta` (line ~483: `{ captured_at, driver, model, base_reps, source }` gains `effort`). It is included **only when set** (conditional spread), so a no-effort run writes a byte-identical `meta`/stamp to today's. — eval numbers are effort-specific exactly as they are model-specific, so a baseline must record the effort it was produced at; gating the field on "set" preserves the byte-for-byte-when-unset guarantee (existing baselines and their `--resume` stamp comparison are untouched).
- **Chosen:** the `--resume` stamp-guard compares `effort` alongside `driver`/`model`/`base_reps` (line ~422) — a resume with a different effort refuses to blend, same as a different model does. When neither the stored nor the current stamp carries effort, the comparison is unaffected (both absent). — a baseline half-built at one effort and resumed at another would silently mix populations, the exact failure the existing stamp-guard exists to prevent.
- **Chosen:** the same effort record + guard applies to the **scoped** `--kind` path, not just the full sweep. FAFF-714 gave a scoped run its own progress file (`frontier-scoped-progress.json`) with its own checkpoint/fold logic; the effort is written into that scoped stamp and compared on a `--kind … --resume` exactly as for the full-sweep stamp. — effort is a per-population property, so a scoped re-baseline resumed at a different effort must refuse to blend for the same reason the full sweep does; the stamp-comparison logic is shared, so this is coverage, not new mechanism.

### Out of scope

- **Punt:** a `.faffrc` `effort.eval` config lane (parallel to `models.eval`). The ticket's first open question. Note this would **reverse an existing deliberate boundary**: `config.js` (`EFFORT_LANE_VOCAB` region, ~line 335) already excludes `eval` from the effort-lane system on purpose (FAFF-416), and `test/effort-config.test.mjs` asserts `effort.eval` has no lane. So a config lane isn't a neutral add — it undoes a decision, and belongs in its own ticket where that reversal is argued, not smuggled in here. v1 ships the per-run `--effort` flag only; the flag is the minimal thing that unblocks the experiment and the reproducibility record.
- **Punt:** applying effort to the `local`/ollama lane. Ollama has no Claude reasoning-effort knob; `--effort` stays frontier-only.

## Acceptance criteria

1. `buildInvocation({ model, effort }, prompt, cfgDir)` includes `--effort <level>` in `args` when `effort` is set, in the position adjacent to `--model`; omits it entirely when `effort` is null/absent (existing no-effort callers produce a byte-identical argv). — unit test, pure, no spawn.
2. `frontierOpts({ effort })` returns `effort` in its opts; `frontierOpts()` with no effort returns opts whose `buildInvocation` argv is byte-identical to today's. — unit test.
3. `node eval/run-evals.mjs --driver frontier --model <m> --effort high …` reaches the per-rep `claude -p` spawn with `--effort high` in argv (asserted via the injectable driver/`resolveDriver` path, no paid reps).
4. An off-vocabulary `--effort <bad>` fails loud: non-zero exit, stderr names the legal set (`low|medium|high|xhigh|max`), and `claude -p` is **never** spawned with the bad value. — unit test.
5. When effort is set, the written baseline `meta` and the progress `stamp` carry the resolved `effort`; when unset, both are byte-identical to today's output. — test over the meta/stamp construction.
6. A `--resume` whose stored stamp effort differs from the current run's throws the same "refusing to blend" error the driver/model/base_reps mismatch already throws; a both-absent comparison still resumes. — unit test mirroring the existing `test/eval-resume.test.mjs` stamp-guard case.
7. A scoped `--kind … --resume` whose stored **scoped** stamp (`frontier-scoped-progress.json`, FAFF-714) effort differs from the current run throws "refusing to blend"; a set-effort scoped run records the effort in that scoped stamp. — unit test in the scoped-resume family (`test/eval-resume.test.mjs` already exercises the `--kind --resume` path).
8. `--driver local … --effort <x>` warns that effort is ignored for the local lane (parallel to the existing `--base-url` ignored-for-frontier warning) and does not pass `--effort` to the local spawn.
9. Full suite green (`faff gates run`).

## Reference context

- `eval/cli-driver.mjs` — `buildInvocation` (~1087, the sole argv builder), `frontierOpts`/`localOpts` (~1140/1149), `makeCliDriver` (~1101, passes opts straight to `buildInvocation`).
- `eval/run-evals.mjs` — `resolveDriver` (~564, assembles the driver from argv), `updateBaseline` stamp (~405) + meta (~483), the `--resume` stamp-guard (~422), `resolveLocalParams` (~517, the fail-loud precedent).
- Existing driver-invocation tests are the pattern to mirror for the pure argv assertions; `test/eval-resume.test.mjs` for the stamp-guard case.

confidence: high

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    {"marker": "Chosen", "topic": "buildInvocation appends --effort next to --model, omit when null"},
    {"marker": "Chosen", "topic": "frontierOpts gains effort param; localOpts does not (frontier-only)"},
    {"marker": "Chosen", "topic": "resolveDriver reads/validates --effort and threads it into the frontier preset"},
    {"marker": "Chosen", "topic": "vocabulary low|medium|high|xhigh|max; off-vocab throws (fail loud)"},
    {"marker": "Chosen", "topic": "record effort in stamp + baseline meta only when set (byte-for-byte when unset)"},
    {"marker": "Chosen", "topic": "resume stamp-guard compares effort alongside driver/model/base_reps"},
    {"marker": "Punt", "topic": "a .faffrc effort.eval config lane — deferred to a follow-up"},
    {"marker": "Punt", "topic": "effort on the local/ollama lane — out of scope, no equivalent knob"},
    {"marker": "Assumes", "topic": "claude -p accepts --effort <level>; exact spelling/values confirmed at build"}
  ]
}
```