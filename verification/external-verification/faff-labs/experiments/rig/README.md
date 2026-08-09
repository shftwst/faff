# Scoring rig — faff-L4 vs one-shot

The mechanical half of every scorecard for the [L4 study](../l4-experiment-design.md). It reads a
control's pinned source and its committed economics and turns them into two numbers you can't argue
with: how much of the qualified-build gap set the control left open, and what its run cost. Judgement
lives elsewhere (design §5.B) — this rig only measures things you can run, not things you have to opine on.

Zero dependencies: Node builtins only (`fs`, `path`, `os`, `child_process`), same house style as `eval/*.mjs`.

## Link, never copy

The rig never vendors a control. It resolves a control by name to `repo@SHA` from
[`../results/controls.manifest.json`](../results/controls.manifest.json) and fetches it at that exact
commit into a per-SHA cache under the OS temp dir (`$TMPDIR/faff-l4-rig-cache/<name>-<sha>`), reusing
the checkout on the next run. Pin a SHA, freeze the state; the comparison re-computes identically later
without a monorepo. Needs `git` on PATH and read access to the control repos (public as they're released;
`gh`-authenticated read until then).

## v1 subcommands

```
node score.mjs gaps <control>   # language-relative qualified-build gap set
node score.mjs cost <control>   # priced $ per token type from the run's economics
node score.mjs baseline         # gaps + cost over all 9 controls -> ../results/controls-baseline.md
```

### `gaps` — qualified-build gap set (design §3, §5.A.2)

Scored **relative to each control's own baseline and language**, not a fixed checklist — a Go or Java
build is typed by the language, so "typed interfaces" is marked `n/a`, never counted as a gap it could
fill. Seven signals, each reporting `present` / `absent` / `n/a` with its evidence:

- `unit_tests` — real tests (JS `*.test.js`/`*.spec.js` or a genuine runner in `package.json`, not the
  `exit 1` stub; Go `*_test.go` with `func Test…`; Java `*Test.java` / `src/test`), with a count.
- `adrs` — any `records/adr/`, `**/adr/`, or `ADR-*.md` decision records.
- `spec_decomposition` — a distinct decomposition/spec artifact beyond the PRD plus a release log
  (the PRD, SUMMARY, prompt and RELEASES files don't count).
- `typed_interfaces` — **language-aware**: Go/Java = `n/a (typed language)`; JS = TypeScript or a
  schema-validation lib (zod/joi/ajv/…), absent = gap.
- `ci` — a `.github/workflows/*.yml`.
- `release_ladder` — ≥3 releases in a `RELEASES.md`/`CHANGELOG`, or ≥3 real tags.
- `error_handling` — coarse: try/catch (or Go `err != nil`) guards plus a spread of HTTP statuses.

`gap_set` is the list of **absent** signals — the discriminators that control's L4 arm has to fill.

```
$ node score.mjs gaps quorum
{ "control": "quorum", "lang": "go",
  "gaps": { "unit_tests": { "status": "present", "evidence": "5 go test func(s) …" },
            "typed_interfaces": { "status": "n/a (typed language)", … }, … },
  "gap_set": [ "adrs", "spec_decomposition", "release_ladder" ] }
```

### `cost` — priced $ per token type (design §5.A.4)

Reads the control's committed `economics.json`, pulls the per-token-type counts
(`input` / `output` / `cache_write` / `cache_read`) and the run's model, and prices them against
[`pricing.json`](pricing.json) — `counts × rate ÷ 1e6`, summed. Output-tokens are reported alongside as
the effort proxy. The economics shapes vary across controls (totals under `totals` or `usage_totals`;
model under `session.model_id`, `session.model`, or a top-level `model`), so both are resolved from a set
of candidate locations rather than assumed; an unrecognised shape says so instead of guessing.

`pricing.json` ships with **every rate `null`** — fill it from the live advertised API rate card and set
`dated` at scoring time (design says: don't invent rates). Until then, `cost` reports the token counts and
output-tokens but `priced_usd: null` with an `unpriced — fill pricing.json` note:

```
$ node score.mjs cost stall
{ "control": "stall", "model": "claude-fable-5",
  "tokens": { "input": 478, "output": 410918, "cache_write": 632074, "cache_read": 30082526 },
  "priced_usd": null, "output_tokens": 410918,
  "note": "unpriced — fill pricing.json rates for claude-fable-5: … (dated: null)" }
```

### `baseline`

Runs `gaps` + `cost` over all 9 controls and writes a mechanically-generated table to
[`../results/controls-baseline.md`](../results/controls-baseline.md) (with the `pricing.json` date in its
header). Re-run it rather than hand-editing — and re-run it whole, since it re-fetches every control.

## Stubbed for Phase 2

Two axes complete the scorecard but can only run once an L4 arm exists to compare against — and **there
are no L4 builds yet** (they're gated on the CI-runner cage, design §7). They're commented signatures at
the bottom of `score.mjs`, not half-built code:

- `harness-run <control> <build-dir>` — run the control's **own** committed harness against an L4 build
  for the PRD-AC pass rate X/N (design §5.A.1). The control built the oracle, so this stays judge-free.
- `scorecard <control> <l4-build>` — assemble the full per-experiment scorecard: control vs the L4 arm
  across all four mechanical axes plus a slot for the blind judged score (design §2).

When the runner lands, the treatment runs have a scoresheet waiting.
