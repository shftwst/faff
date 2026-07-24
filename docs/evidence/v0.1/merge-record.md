# merge-record.json

**Purpose.** The per-issue tail artifact recording the mechanical merge itself — PR
number, head sha, whether it merged, and the corrective-artifact trust posture
(`integrity`, FAFF-325/FAFF-373 — the pid-1 corrective-mount declaration, unrelated to
the FAFF-568 chain-anchor `integrity` leg documented in `v0.2/anchor-integrity.md`;
the shared field name is a coincidence worth flagging so a reader doesn't conflate the
two) at merge time. This is the artifact a post-merge auditor reads to confirm what
actually landed, and the pin `faff post-merge-check` re-verifies against.

**Location & lifecycle.** `<run-dir>/<issue>/merge-record.json`, written once by `faff
merge-gate` at the moment it executes the merge (the sole sanctioned `gh pr merge` path
— `faff-graft` never calls `gh pr merge` directly). Not mutated afterward.

**Producer(s).** `faff merge-gate --execute`.

**Consumer(s).** `faff post-merge-check` (re-reads the pinned `head_sha` to run a
post-merge regression check against an ephemeral detached worktree at that sha — FAFF-397),
human auditors.

**Schema.** [`schema/merge-record.schema.json`](schema/merge-record.schema.json).

**Integrity.** A single write, at the merge chokepoint — the same tool that performs the
merge writes this record, so there is no window where a merge lands without a matching
record. `pr: 0` is the git-only null-coerced sentinel (FAFF-526, no PR in that mode) —
any real PR merge carries a positive PR number. `integrity` is one of `asserted` /
`unasserted` / `violated` — the plain trust-posture value `writeMergeRecord` persists
(defaulting to `unasserted` when the caller omits it). It feeds, but is distinct from,
`decideFloor`'s level-graded gate states (`unasserted-ok` at L1–L3, `unasserted-refuse`
at L4 defence-in-depth — see `bin/lib/merge-gate.js`).

**Fail direction.** No consumer treats a missing `merge-record.json` as "not yet merged"
without corroboration — `faff post-merge-check` fails loud (exit 2, the unprovable
verdict) rather than silently skipping when the sha it expected to pin is unresolvable.

**Example.** [`schema/examples/merge-record.example.json`](schema/examples/merge-record.example.json),
hand-carried from a real merged issue (`.faff/runs/run-20260724-125424-beepboop-full/FAFF-634/merge-record.json`),
carrying `"integrity": "unasserted"` — the corrective-mount trust default at this run's
autonomy level, not a chain-anchor verdict.
