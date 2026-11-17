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

Checks are pending for this implementation commit: installed adapter lint, cumulative rule inventory against the original a850 baseline, and the existing eleven selected source-wiring assertions. Existing unchanged 320 graft runtime tests and 92 contract tests will be explicitly reused, subject to runtime/test hash equality, without reruns.

No model, calibration, harness, global installation, push or merge is performed. Previous failed experiments remain preserved.
