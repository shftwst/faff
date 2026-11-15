# Review evidence

All paths are relative to the repository root unless stated otherwise. These are derived readings and test outputs, not new eval baselines. Source hashes and HEAD are recorded in `provenance.json`.

Run from the repository root:

```bash
node verification/audits/2026-11-14-skill-determinism/astra-review-data/review-probes.mjs
node verification/audits/2026-11-14-skill-determinism/astra-review-data/local-readings.mjs
node --test test/control-parity.test.mjs test/skill-audit.test.mjs
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false node --test test/shadow-fidelity.test.mjs
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false node --test test/graft-admit-replay.test.mjs test/prep-attach.test.mjs test/spec-review-hold.test.mjs
```

`review-probes.mjs` reads the shipped skills, October capture and August transcripts. It writes only this evidence directory. It independently counts source bytes and load declarations, audits request IDs/buckets, replays the current fidelity code, and constructs deliberately invalid comparator/replay inputs. Mutation-probe results are method limitations, not findings about the unmodified October records.

`local-readings.mjs` reads the installed skill directories, the three previously selected September runner event files and the five previously selected local Codex sessions. It retains only hashes, skill metadata and aggregate usage/capture readings. It does not change the runner pull or installations and does not independently establish that the five sessions are representative or newest.

The first boundary test run hit one host SSH commit-signing failure. `boundary-tests.txt` retains it; `boundary-tests-signing-disabled.txt` records the passing rerun. Signing was disabled only through the child process environment. No Git configuration was changed.

| Evidence | Purpose |
|---|---|
| `independent-census.json` | Source sizes, hashes and cold-entry declarations |
| `historical-accounting.json` | Historical request deduplication, cache-bucket reconciliation and modelled sensitivities |
| `october-replay-analysis.json` | Actual run counts, joins, duplicate markers, input-to-marker gaps, source line numbers and method-only mutations |
| `comparator-probes.json` | Empty semantic evidence, both-missing expected coverage and unsafe-integer collision |
| `installed-reading.json` | Installed entries, description-value estimates and source equality |
| `september-replay.json` | Zero graded denominator despite non-null replay |
| `local-usage-recheck.json` | Selected session hash/cumulative counter reproduction, without transcript content |
| `*-tests*.txt` | Bounded local test results, including the original environmental failure |
