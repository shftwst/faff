# Implemented skill source batch

Status: implemented source with model qualification outstanding. This branch does not update or claim acceptance under the historical savings ledger.

Branch: `feat/skill-diet-source-batch`. Base: `a523734da3865a10e24239a606663b050a90cbc9`. Worktree: `/var/tmp/faff-skill-diet-source-batch`. The original `skill-diet-12h` worktree and historical measurement paths remain unchanged.

| Runtime source | Before bytes | Applied bytes | Bytes removed | Estimated tokens removed |
|---|---:|---:|---:|---:|
| plugin/skills/faff-graft/SKILL.md | 178777 | 152209 | 26568 | 6526 |
| plugin/skills/faff-prep/SKILL.md | 104335 | 93904 | 10431 | 2572 |
| plugin/skills/faff/references/kernel.md | 84072 | 70812 | 13260 | 3253 |

Total source reduction: 50,259 bytes and 12,351 estimated tokens. Token estimates use the per-file ceiling of UTF-16 character count divided by four; these are source estimates, not provider usage.

Graft combines the exact gates/evidence V2 and merge-confidence V3 drafts with `git merge-file` against their identical common baseline. The changed base-line ranges do not overlap; both merge orders produce identical bytes and their byte reductions add exactly. Prep is the exact orchestration V3 draft plus the supplied two-regex quoted-scratch test patch. Kernel is the exact core-contracts V4 draft. Only the three matching prose byte allowances are lowered; line caps are unchanged.

The three reviewed private rule-inventory designs are copied exactly. No other runtime source or private source edits are copied. Candidate hashes, merge proof and source measurements are in `SOURCE-BATCH-inputs.json` and `SOURCE-BATCH-measurement.json`.

Checks ran once against implementation commit `21d419c9975dd0f0391195fc1ca9df06d4850ac6`:

| Check | Result | Evidence |
|---|---|---|
| source-wiring | 11 passed, 0 failed | [source-batch-source-wiring-20261117T125959Z.txt](deterministic-checks/source-batch-source-wiring-20261117T125959Z.txt) |
| adapter-lint | Pass | [source-batch-adapter-lint-20261117T125959Z.txt](deterministic-checks/source-batch-adapter-lint-20261117T125959Z.txt) |
| rule-inventory | 817 deleted blocks covered, 0 uncovered, 0 row errors | [source-batch-rule-inventory-20261117T125959Z.txt](deterministic-checks/source-batch-rule-inventory-20261117T125959Z.txt) |

Exact commands, timestamps, environment overrides and log hashes are in `SOURCE-BATCH-checks.json`. The existing 320 graft command tests and 92 contract tests are reused without reruns. All selected test/fixture bytes and runtime/build object listings match their recorded private commits; bindings and the scope limit are in `SOURCE-BATCH-reused-checks.json`. The two approved test-regex changes are limited to accepting quoted `$scratch`. Only the eleven source-wiring tests are fresh tests for this combined source.

Applied runtime SHA-256 hashes:

- `plugin/skills/faff-graft/SKILL.md`: `e9fe81f2280379cc2a918ce287a1ac8e27773e10573fa967e1d12f7c843b3369`
- `plugin/skills/faff-prep/SKILL.md`: `8d886cfeeeea3042a47e583001b07b34739bfbbefd81c391e8b36b8e22b8f95d`
- `plugin/skills/faff/references/kernel.md`: `d2dca7702a6d68745133d80f3ddcf32ed6230a8f54f04007d1fbdb2746f8e6e9`

Reviewed draft SHA-256 hashes:

- `verification/experiments/2026-11-16-skill-diet/candidates/graft-gates-evidence-v2.md`: `c28c7fe2bdba534ab27639408e2baf1b3dcc6205aade1a75ba5c8656fdf9d9a2`
- `verification/experiments/2026-11-16-skill-diet/candidates/graft-merge-confidence-v3-draft.md`: `24718864aa951816ff7e916917f78a271be52c0f46ba58cd17a20b481733b989`
- `verification/experiments/2026-11-16-skill-diet/candidates/prep-review-orchestration-v3-draft.md`: `8d886cfeeeea3042a47e583001b07b34739bfbbefd81c391e8b36b8e22b8f95d`
- `verification/experiments/2026-11-16-skill-diet/candidates/kernel-core-contracts-v4-draft.md`: `d2dca7702a6d68745133d80f3ddcf32ed6230a8f54f04007d1fbdb2746f8e6e9`

No model, calibration, harness, global installation, push or merge is performed. Previous failed experiments remain preserved.
