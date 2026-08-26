# review-bench — benchmark local endpoints against real spec-review lenses

A self-contained kit for benchmarking a local LLM endpoint against **real faff adversarial spec-review
prompts** — the exact 4-lens (architectural / infosec / methodology / QA) payloads faff sends, over a
real ~40 KB product spec with its code context (~15.8 K-token prompts). Copy this whole directory to any
machine with **node** (no npm install, zero dependencies) and point it at an endpoint.

It answers the questions that actually decide whether a local model can serve as an L4 reviewer:
- Does it **serve** and respond over the transport (ollama `/api/chat` or OpenAI `/v1/chat/completions`)?
- How fast — prompt-eval tok/s, generation tok/s, total, and (streaming) time-to-first-byte?
- Does it return **parseable, findings-shaped** output (`### <severity>: …`) the aggregator can score,
  or empty / malformed?
- Does its **reasoning leak** into a separate channel and eat the output budget (the failure mode that
  makes some reasoning models unusable on large prompts)?

## Layout

```
review-bench/
  run-bench.mjs         # the runner (zero-dep node) — one endpoint, any test kind
  full-bench.mjs        # runs the WHOLE battery for one model -> FULL-SUMMARY.md
  build-requests.mjs           # regenerates the spec-review requests/ from lenses+spec+context
  build-requests-bracketed.mjs # regenerates requests-bracketed/ (see "Third payload shape" below)
  lenses/ spec/ context/ requests/                # SPEC-REVIEW suite, plain: 4 lenses over a real spec
  requests-shared-prefix/                         # SPEC-REVIEW, FAFF-903 cacheable reorder (system<->user)
  requests-bracketed/                             # SPEC-REVIEW, bracketed shared-prefix (see below)
  code-review/          # CODE-REVIEW (graft) suite: 1 review lens over a real git diff
    lens/ diff/ context/ requests/  +  build-requests-code.mjs
  results/              # output lands here (one dir per run; full-bench nests per test)
```

Two review types, matching faff's two review slots:
- **spec-review** (`requests/`) — 4 independent refute lenses (architectural / infosec / methodology / QA)
  over the ~40 KB mint spec + its code context. This is faff's `spec_review` slot.
- **code-review / graft** (`code-review/requests/`) — a single 5-category adversarial review lens over a
  real ~39 KB git **diff** (the shipped skeleton) + the files it touches. This is faff's `review` slot,
  run at graft time. Point the runner at it with `--requests-dir code-review/requests`.

Each `requests/*.json` is a ready-to-send payload: `system` (the lens brief) + `user` (context files
fenced, then the spec or diff). The runner wraps it in the ollama or OpenAI body shape at call time, so
the **same request set benchmarks both transports**.

**No tool calls.** Faff reviews are single-shot chat completions — system + user -> findings text; no
`tools`/function-calling is sent, so the model can't call tools mid-review. (The only tool is harness-side:
faff runs `node --check` on syntax claims itself.) This kit sends plain completions to match.

## Usage

```
node run-bench.mjs --provider <ollama|openai> --host <URL> --model <NAME> [options]
```

**ollama** (native `/api/chat`, keyless; `think:false` disables reasoning):
```
node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx
```

**OpenAI-compatible** server (needs `/v1` in the host, a bearer key, the exact served id):
```
OMLX_API_KEY=sk-... node run-bench.mjs --provider openai --host http://HOST:8001/v1 \
    --model Qwen3.8-27B-4bit --key-env OMLX_API_KEY
```

**Cohere "North" reasoning models** — their reasoning switch is native, not the Qwen kwarg, so add
`--cohere` to also send `thinking:{type:"disabled"}`:
```
node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model North-Mini-Code-1.0-6bit \
    --key-env OMLX_API_KEY --cohere
```

**Compare reasoning on vs off, one lens, streaming (measures TTFB):**
```
node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx --lens qa --reasoning on --stream
node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx --lens qa --reasoning off --stream
```

### Modes: single · fan-out · repeat (cache test)

```
# SINGLE lens (fast iteration on one prompt)
node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx --lens qa

# FAN-OUT: all 4 lenses at once, like faff's fan-out.mjs. Reveals GPU serialization —
# on a single-GPU server the per-lens totals include queue wait and the panel ~= sum;
# on a truly parallel backend the panel ~= the slowest single lens.
node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx --concurrent

# CACHE TEST: same request re-sent 3x. Iterations 2+ should hit the server's prompt cache,
# so prompt-eval collapses and total_s drops. The summary prints the per-iteration series
# and the warm speedup. Use one lens to isolate it:
node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx --lens qa --repeat 3

# combine: fan-out, twice (e.g. cold panel then warm panel)
node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx --concurrent --repeat 2
```

Notes: `--concurrent` and `--repeat` compose. Verdict bodies are saved from the **first** iteration only
(later iterations are for timing); every iteration's numbers land in `summary.md`/`summary.json`, and with
`--repeat > 1` a **cache warming** section reports `total_s` per iteration and the warm speedup per lens.

### Options

| flag | default | meaning |
|---|---|---|
| `--provider` | (req) | `ollama` or `openai` |
| `--host` | (req) | ollama: `http://h:11434` · openai: `http://h:8001/v1` (include `/v1`) |
| `--model` | (req) | served model id (openai id must match `/v1/models` **exactly**) |
| `--key-env VAR` | — | openai: env var holding the bearer token |
| `--lens` | `all` | `all` or one of `architectural`/`infosec`/`methodology`/`qa` |
| `--concurrent` | off | fan-out: fire the selected lenses concurrently (alias `--fanout`); default is sequential |
| `--repeat N` | `1` | run the selected set N times (for the prompt-cache warming test) |
| `--reasoning` | `off` | `off`\|`on`\|`low`\|`medium`\|`high` — disable, enable, or set effort. A level sets openai `reasoning_effort` and (with `--cohere`) the Cohere `token_budget`. ollama has no levels (on/level all map to `think:true`). |
| `--token-budget N` | — | Cohere: explicit thinking `token_budget` (overrides the level default: low 1024 / medium 8192 / high 31000) |
| `--cohere` | off | openai: use Cohere's native switch — `thinking:{type:"disabled"}` when off, `{type:"enabled", token_budget}` when on/level |
| `--requests-dir DIR` | `./requests` | which suite to benchmark. Use `code-review/requests` for the graft/code review. |
| `--num-predict` | `2000` | output token cap (faff's default) |
| `--temperature` | `0.2` | sampling temperature |
| `--stream` | off | measure time-to-first-byte (else non-streaming, cleaner timing) |
| `--timeout-ms` | `1200000` | per-request timeout (20 min) |
| `--out DIR` | auto | results dir (default `results/<provider>-<model>-r<off|on>-<ts>`) |

### Reasoning: off / on / level

```
node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx --lens qa --reasoning off
node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx --lens qa --reasoning on
# graded effort (openai reasoning_effort; Cohere token_budget with --cohere):
node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model Qwen3.8-27B-4bit --key-env OMLX_API_KEY --lens qa --reasoning high
```

`off` disables the think phase; `on` enables it at the server default; `low`/`medium`/`high` set an
effort level. Watch the `out` / `reasoning` columns: more effort usually means more tokens and slower
generation. For a reasoning model, compare `off` vs a level to see the quality/latency trade.

## Code-review (graft) suite

The same runner, pointed at the graft/code-review request (one 5-category adversarial review lens over a
real ~39 KB git diff + the files it touches):

```
node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx \
    --requests-dir code-review/requests --lens code-review
```

All the same options apply (`--reasoning`, `--repeat`, `--stream`, etc.). Regenerate the request with a
different diff via `code-review/build-requests-code.mjs` (drop a new `diff/*.diff` + its touched files in
`code-review/context/`).

## Full benchmark — one model at a time

`full-bench.mjs` runs the **whole battery** for one model (sequential panel, fan-out, cache warming,
streaming TTFB, reasoning on/off), nests each under one results dir, and writes a consolidated
`FULL-SUMMARY.md` with the headline verdict (serves? parseable? calibrated? reasoning-disable works?
fan-out serialization ratio? cache speedup? TTFB?). Configure the endpoint once, then repeat per model.

```
# spec-review battery
node full-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx
OMLX_API_KEY=... node full-bench.mjs --provider openai --host http://HOST:8001/v1 --model Qwen3.8-27B-4bit --key-env OMLX_API_KEY

# code-review (graft) battery — point it at that suite
node full-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx --requests-dir code-review/requests --single code-review

# quick pass (fan-out + cache only), Cohere model
OMLX_API_KEY=... node full-bench.mjs --provider openai --host http://HOST:8001/v1 --model North-Mini-Code-1.0-6bit --key-env OMLX_API_KEY --cohere --quick
```

A full spec-review battery on a 27B model is ~45-55 min (the panels dominate); `--quick` is much faster.
Options: `--single LENS` (lens for the single-lens tests, default `qa`), `--repeat N` (cache iterations),
`--quick`, `--label TEXT`, plus the endpoint flags passed straight through to `run-bench.mjs`.

## Reading the output

Per lens the runner prints (and saves to `results/<run>/summary.md` + `.json`):

- **total / ttfb** — wall time; TTFB only with `--stream`. On a cold ollama qwen, first byte ≈ prompt-eval
  time (~230 s on this prompt) because ollama emits nothing until prompt-eval finishes.
- **in / out tok**, **pe tps** (prompt-eval tok/s), **gen tps** (generation tok/s), **cached** (prompt
  tokens served from cache, openai only).
  - **ollama** reports exact per-phase durations, so pe/gen tps are precise on any run.
  - **OpenAI-compatible servers (OMLX / vLLM / …) only report token counts**, not a prompt-eval vs
    generation time split. To get pe/gen tps from them, **add `--stream`**: time-to-first-token ≈
    prompt-eval time, the remainder is generation, so the runner derives `pe = in / ttfb` and
    `gen = out / (total − ttfb)` (shown with a leading `~` = estimated). This is only meaningful on a
    **cold** prompt — on a warm cache hit `ttfb → 0` and the derived pe tps is nonsense (the `cached`
    count tells you it was a hit). So: benchmark pe/gen tps with `--stream` on a **fresh** prompt (a lens
    you haven't sent yet, or the first `--repeat` iteration). `summary.json` also carries the server's own
    `server_total_s` (`usage.total_time`) when present.
- **shape** — `findings-shaped` (has `### <severity>:`), `clean-pass` (`No <lens> objection.`), `EMPTY`,
  or `NOT-shaped`. Only `findings-shaped` / `clean-pass` are usable by faff's aggregator.
- **severities** — the `[major,minor,…]` it raised (calibration signal — a model that stamps everything
  `critical` cannot pass a spec; one with a real spread is calibrated).
- **reasoning** — bytes in a separate `reasoning_content` channel. **`⚠ reasoning-eaten-budget`** flags the
  failure mode where `content` is EMPTY but `reasoning_content` is large: the model reasoned until it hit
  `num_predict` and never emitted findings. Raise `--num-predict` or disable reasoning to fix — and if
  `--reasoning off` doesn't shrink `reasoning_content`, the server is ignoring the disable switch.

Raw verdicts are saved as `results/<run>/<lens>.content.md`; any reasoning trace as `<lens>.reasoning.txt`.

## What we found (reference, on the studio host)

- **Qwen3.8-27B** (ollama `qwen3.8:27b-mlx` @ :11434 and openai `Qwen3.8-27B-4bit` @ :8001/v1): serves,
  parseable, calibrated (major/minor/observation spread). `--reasoning off` genuinely disables thinking.
  A cold 4-lens panel is ~18-20 min on one GPU (lenses serialise).
- **North-Mini-Code** (Cohere "North"): **unusable at :8001**. It ignores `enable_thinking:false` *and*
  the native `thinking:{type:"disabled"}` on that MLX server, keeps reasoning unbounded, and exhausts
  `num_predict` on the real prompt → EMPTY content (the `⚠ reasoning-eaten-budget` case). Fine only on
  trivial prompts. Cohere disables reasoning with `thinking:{type:"disabled"}` (default enabled,
  unlimited) — honoured only by Cohere's own API, not by a generic MLX OpenAI server that drops the param.

## Third payload shape: bracketed shared-prefix (`requests-bracketed/`)

`requests-shared-prefix/` (FAFF-903) moved the shared context+spec block to the front of the prompt
so the four spec-review lenses share a cacheable prefix, but that also puts the lens instruction and
the output-format contract at the very start of `system`, ahead of the 15K tokens of content it
governs. `requests-bracketed/` keeps the caching win and brackets the instruction so it is
unmistakable at both ends: stated once before the context, then restated as the last thing the model
reads before it starts generating.

Generated by `build-requests-bracketed.mjs`, same `{lens, system, user, meta}` shape as the other two:

- `system`: a short priming line, then the same shared context+spec block used by
  `requests-shared-prefix/`. The priming line is byte-identical across all four lenses, so `system` as
  a whole stays one stable, cacheable prefix; only `user` varies per lens.
- `user`: the per-lens brief (the text `requests/`'s `system` carries), then a closing one-line
  output-format directive that names the lens and restates the `### <severity>: <title>` contract,
  placed last so it is the final thing the model reads before generating.

`build-requests-bracketed.mjs` checks its own caching invariant: it hashes `system` across the four
written payloads and exits non-zero if they are not byte-identical.

**Three-way comparison**, same lens or full fan-out, against each variant in turn:

```
node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model NAME --key-env KEY --requests-dir requests --lens qa
node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model NAME --key-env KEY --requests-dir requests-shared-prefix --lens qa
node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model NAME --key-env KEY --requests-dir requests-bracketed --lens qa

node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model NAME --key-env KEY --requests-dir requests --concurrent
node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model NAME --key-env KEY --requests-dir requests-shared-prefix --concurrent
node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model NAME --key-env KEY --requests-dir requests-bracketed --concurrent
```

Regenerate with `node build-requests-bracketed.mjs` after editing `lenses/`, `spec/`, or `context/`. It
shares its context/spec assembly (`CONTEXT_ORDER`, `SPEC_FILE`) with `build-requests.mjs`; keep the two
in step by hand if either changes.

**Caveat: test bracketing on a backend whose reasoning-off switch actually works.** A reasoning model
that ignores `--reasoning off` will empty out on any of the three variants, so an empty result there
says nothing about bracketing. On `openrouter-deepseek-v4-flash` (`deepseek/deepseek-v4-flash-0731` via
OpenRouter) both `requests/` and `requests-shared-prefix/` returned EMPTY content under `--reasoning
off`: the model reasoned inline in the content stream, burned roughly 8300 tokens of `reasoning_len`
(8381 on `requests/`, 8295 on `requests-shared-prefix/`), hit the `num_predict` cap (`finish: length`),
and never emitted a `### <severity>:` finding (evidence: `results/DIAG-plain-deepseek/` and
`results/DIAG-sharedprefix-deepseek/`). That is a reasoning-disable failure, not a payload-shape
failure, and it would reproduce on `requests-bracketed/` too regardless of where the instruction sits.
Measure bracketing's effect on a non-reasoning model, or on a backend where reasoning-off is honoured,
for example spark (`unsloth/Qwen3.8-27B-NVFP4`), whose off run shows `reasoning_len: 0` (see
`cases/faff-906/README.md`, "Diagnosis: why spark-qwen degrades on this payload").

## Adding more specs / regenerating

`requests/` is generated by `build-requests.mjs` from `lenses/` + `spec/` + `context/`. To benchmark a
different spec: drop its `.md` in `spec/`, its referenced code files in `context/` (flatten the repo path
with `__`, e.g. `api/internal/db/connect.go` → `api__internal__db__connect.go`), edit the `SPEC_FILE` and
`CONTEXT_ORDER` at the top of `build-requests.mjs`, and re-run `node build-requests.mjs`. The lens briefs
in `lenses/` are faff's real refuter prompts and normally stay as-is.

## In-repo home, drift guards, and fine-tuning material (FAFF-904)

This kit now lives in the faff repo at `eval/review-bench/`, a sibling of the `eval/`
judgement-eval harness. Like `eval/`, it is **operator-run, not CI**: its `.mjs` scripts make
real model calls that cost money and need a configured backend, so nothing under
`eval/review-bench/` is named `*.test.mjs` and no CI job invokes the runner. Run output lands
in `results/`, which is gitignored (the same treatment as `eval/report/`). The kit stays
zero-dependency and copyable: copy the whole `eval/review-bench/` directory to any machine with
node and run it, no install. The generators (`build-requests.mjs`,
`code-review/build-requests-code.mjs`) and the generated `requests/` payloads are both
committed, so a fresh clone runs with no build step.

### Lens-drift guards

The kit carries copies of faff's real review prompts, which now live in the same repo as their
canonical sources and could drift silently. The committed test
`test/review-bench-lens-parity.test.mjs` (a zero-spawn `node:test` in the normal CI pass)
guards three things:

- the four `lenses/refute-*.md` are byte-identical to their canonical
  `plugin/skills/faffter-dark-spec-review/refute-*.md` sources;
- the committed `requests/` and `requests-shared-prefix/` (and `code-review/requests/`) payloads
  embed the current lens text, so a stale payload fails CI the same way a stale lens copy does;
- `code-review/lens/review-lens.md` carries the canonical five review categories in order.

When a canonical spec-review lens changes, refresh the copy with a one-line
`cp plugin/skills/faffter-dark-spec-review/refute-<lens>.md eval/review-bench/lenses/refute-<lens>.md`
(the test failure message names it), then regenerate the payloads with
`node eval/review-bench/build-requests.mjs`. This is a copy refresh, not a re-baseline: it does
not touch the `results/` numbers, so it never forces a re-run against models.

**Code-review lens.** `code-review/lens/review-lens.md` is a benchmark-shaped *rendering* of the
adversarial second-opinion five categories in
`plugin/skills/faffter-dark-adversarial-review/SKILL.md` (Specification gaming, Implicit
assumptions, Failure mode blindness, Security surface, Concurrency and ordering), with the
`### <severity>:` output contract appended, so it is not a verbatim copy. It carries a
canonical source named here. When those five categories change in the canonical
skill, re-derive `review-lens.md` and regenerate its payload with
`node eval/review-bench/code-review/build-requests-code.mjs`; the parity test's category-order
check flags the divergence.

### Fine-tuning material

Capturing reviewer input/output pairs for fine-tuning a local reviewer is **deferred to a
follow-up ticket** (this ticket only lands the kit). The raw material already exists in the
kit's own artefacts, so a later capture step has a defined starting point:

- **inputs (prompts):** the committed `requests/*.json` (each `{ lens, system, user, ... }`
  payload is the exact prompt sent);
- **outputs (responses):** per run, `results/<run>/<lens>.content.md` (the verbatim verdict) plus
  `results/<run>/summary.json` (timings, output shape, severities, reasoning bytes).
