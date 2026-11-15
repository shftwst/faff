# Pre-release baseline

Captured on 14 November 2026 before the outstanding work lands. Source commit: `f767bdd1c0a78f6259c335742c1567a074f512a0`; tree: `19f6b889c270200d0c786f2d19b1f095c758901b`. The isolated checkout remains at `/Users/shftwst/.codex/worktrees/a713/faff`.

This is the pre-release reference. The released commit needs a separate baseline before migration begins. Production source, skill prose, installed skills and defaults were unchanged. No release, commit, push, paid model call or live tracker write was performed. Development dependencies were installed only in the isolated checkout to exercise compiler checks.

## Recorded readings

| Measure | Baseline | Meaning |
|---|---:|---|
| Skill bodies and references | 32 skills + 9 references | Complete structural inventory, with contiguous block hashes |
| Total source size | 1,371,305 bytes | Across those 41 files |
| Total estimated tokens | 339,730 | `ceil(JS string length / 4)` per file; not provider tokenisation or a per-turn prefix |
| Graft declared cold load | 107,499 estimated tokens | Entry plus its declared references, loaded once |
| Beep-boop declared cold load | 100,246 estimated tokens | Same accounting |
| Prep declared cold load | 79,544 estimated tokens | Same accounting |
| Plugin-cache discovery | 32 skills | All bodies match the pinned source |
| Global-link discovery | 31 skills | All bodies match; `faffter-noon-env-code-interface` absent |
| Description-value estimates | 2,584 + 2,480 tokens | Filesystem metadata only; excludes names, wrappers and runtime truncation |
| Historical usage | 843 unique requests in 19 transcripts | Recomputed from local August evidence; usage records retained without transcript content |
| Historical cache reads | 155,078,239 tokens | Provider usage fields, not a static estimate |
| Historical cache writes | 4,241,578 tokens | All write buckets reconcile |
| Historical cost model | $132.913 | Existing repository rates and rounding; not current pricing or an invoice |
| Historical replay | 128 records, 16 actual runs, 40 graded decisions | Reproduces from saved inputs and the pinned V5 authority map |

Entry-load estimates exclude system instructions, tools, catalogue metadata, delegated skill bodies, dynamic output and conversation history. Duplicate discovery entries do not prove that bodies are loaded twice.

The source defaults still select noon occupants. The repository configuration selects dark occupants for spec, spec review, code review, methodology and concurrency. Both are recorded separately in [configuration.json](configuration.json); the worktree inherits the operator's local overlay. Full configuration contents were not copied.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Committed unit suite | 8,376 passed, 35 skipped, 0 failed; 187.36 seconds | [unit-suite.json](unit-suite.json), full TAP log |
| Compiler-dependent follow-up | 61 passed, 0 skipped, 0 failed; resolves 21 skipped tests above | [supplemental-checks.json](supplemental-checks.json) |
| Remaining skips | 14 test cases and 3 whole suites | Docker, privileged host, absent private capture or live caching backend |
| TypeScript check with `--noEmit` | Passed | Supplemental checks |
| Skill validation | Passed | [checks.json](checks.json) |
| Region boundary check | Passed | Checks |
| CLI test-coverage registration check | Passed | Checks |
| Historical replay reproduction | Passed | [logs/replay-reproduce.txt](logs/replay-reproduce.txt) |
| Source and reading verification | 1,759 source files, all 41 skill files and all 6,793 blocks match; usage and cost models reproduce | [readings-verification.json](readings-verification.json) |

The unit run used Linux arm64, Node 22.23.4, four workers and no coverage instrumentation. CI uses Node 20 in four shards. Docker was intentionally unreachable for the unit lane. Fixture commit signing was disabled only in child-process environment variables. No global Git setting changed. TAP includes three skipped suite records in addition to the 35 skipped test cases; the recorded identities distinguish them.

The initial capture attempt could not find local historical transcripts inside the clean worktree. Its partial outputs and failure are preserved under `attempts/01-missing-historical-evidence/`. The successful capture reads those inputs from the original workspace and records their hashes separately from the pinned source.

## Local CLI timing reference

Twenty fresh-process samples per command followed three warmups, after the unit suite completed. Filesystem caches were warm. Full samples, output hashes and host load are in [cli-timing.json](cli-timing.json).

| Operation | Median | p95 |
|---|---:|---:|
| Resolve configured review slot | 31.66 ms | 37.38 ms |
| Check region boundaries | 90.16 ms | 94.26 ms |
| Analyse historical replay | 36.56 ms | 37.38 ms |

These timings include Node startup. They do not measure model latency, end-to-end work or migration savings. Repeat on the same host under comparable load before interpreting a difference.

## Limits on parity and cost claims

Only `eligible`, `next` and `run-done` have graded historical observations. Six decision kernels have none. The analyser labels fourteen `next` mismatches as wasteful, but the earlier adversarial review found possible later claim or peer vetoes and timing gaps. Those labels are not proof of fourteen avoidable operations. The original replay manifest lists thirty runs; the retained records contain sixteen. Both manifests are preserved.

Historical prefix reductions are counterfactuals using the same requests, workload and repository price model. For example, replacing an assumed 66,153-token fixed prefix with 30,000 or 8,300 tokens models 11.805% or 18.891% lower total cost. No replacement implementation was run, and these figures do not estimate the effect of changing to dark defaults.

There is no new controlled model-run baseline here. Repeated behavioural traces, actual prompt tokenisation, current billed cost and model latency still need controlled capture before a prose migration can pass. The pinned old source remains available for later runs. [comment-rules.md](comment-rules.md) freezes the current comment requirements and ambiguities without pretending they are observed behaviour. The draft parity comparator's known coverage and unsafe-number gaps remain unresolved.

## Evidence and reuse

| Artifact | Contents |
|---|---|
| [capture.json](capture.json) | Commit, environment, tool binding, archive hash and evidence provenance |
| `source.tar.gz`, [source-files.json](source-files.json), `git-tree.txt` | Committed source archive, individual hashes and complete Git tree |
| [inventory.json](inventory.json), [entry-loads.json](entry-loads.json) | Complete prose structure and declared cold loads |
| [installed-discovery.json](installed-discovery.json) | Installed paths, resolution and body equality |
| [historical-cost.json](historical-cost.json), `historical-usage.jsonl` | Source hashes, usage accounting and reproducible historical cost scenarios |
| [selected-local-usage.json](selected-local-usage.json) | Five earlier Codex session counters, hashes and reset counts; not a representative current-release sample |
| `replay/` | Replay inputs, original and generated manifests, result and authority map |
| [release-comparison.md](release-comparison.md) | Required comparisons after release and before migration |
| `capture.mjs`, `cli-timing.mjs`, `check-readings.mjs` | Reusable capture and reading checks |
| `SEAL.json`, `verify.py` | File-integrity manifest and verifier |

Run `python3 verification/baselines/skill-determinism/pre-release-f767bdd1/verify.py` from the repository to verify the sealed files. The seal detects changes against the saved manifest; it is not a cryptographic signature or independent behavioural attestation. Write subsequent baselines into new directories.
