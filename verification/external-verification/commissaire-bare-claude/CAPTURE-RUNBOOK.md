# Operator runbook: publish the attested bare Claude Code capture (FAFF-1018)

This runbook is the human-in-the-loop half of FAFF-1018. The code slice (`--attested-by`) ships
gated in the same PR; this procedure is what an **operator** runs to produce the one real,
signed capture that FAFF-829 bullet 1 needs. It is deliberately not CI-gated: the machine checks the
Stop-shape, the equal `session_id_sha256`, and the block-then-allow ordering; the operator is the
residual human oracle that the two Stop firings came from two real Claude Code turns.

## 0. Preconditions

- `claude` on PATH (`command -v claude`).
- A full SuperDomestique checkout at the pinned driver revision
  `fd1e9788a44860ee8804bdb775e33fb5dfd3f057`, supplied below as `COMMISSAIRE_ROOT`. The scaffolder
  refuses a revision mismatch at preflight, so a wrong checkout fails loudly.
- Run every step from **outside** any SuperDomestique checkout for the capture directory itself.

Set once:

```sh
COMMISSAIRE_ROOT=/path/to/checkout-at-fd1e9788
VE=$COMMISSAIRE_ROOT/verification/external-verification
```

## 1. Spike first (the crux measurement, records the branch)

The verifier's `claude-code-observed` branch has never run against a real session. Measure two
facts before capturing, and record the answer in the capture's notes:

1. Does headless `claude -p --output-format json` fire the Stop hook with the full stdin shape the
   wrapper needs (`session_id`, `transcript_path`, `cwd`, `stop_hook_active`), a real transcript
   file, and a cwd that resolves to the SUT root?
2. Does one real turn fire `hooks.Stop` exactly once?

```sh
SUT=$(mktemp -d)
SUT_ROOT=$SUT COMMISSAIRE_ROOT=$COMMISSAIRE_ROOT bash "$VE/scaffold-commissaire-bare-claude.sh"
node "$SUT/scripts/verify-commissaire.mjs" prepare
RUN_ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).run_id)' "$SUT/.faff/active-run.json")
( cd "$SUT" && claude -p --output-format json "make a trivial no-op edit, then stop" )
# inspect the observations this ONE turn produced:
grep -F "$RUN_ID" "$SUT/.faff/hook-observations.jsonl"
```

Read the result:
- **How many** observations did the one turn produce? (the verifier hard-requires exactly two for
  the run across both turns.)
- Is `source` `claude-code-observed`, or did it fall back to `ci-fixture`? If `ci-fixture`, which of
  `transcript_existed` / `cwd_matched` / the Stop shape failed?

**Branch on the outcome:**
- **A — full Stop shape AND exactly one Stop per turn** -> the scripted two-turn capture is viable
  (`claude -p ... ` then `claude -p --resume <session_id> ...`, reusing one `session_id` so both
  observations hash equal).
- **B — the shape is incomplete OR Stop fires unpredictably** -> drive two real turns in one
  **interactive** Claude Code session on the SUT, which holds one `session_id` throughout.

## 2. Capture the two real turns

Scaffold a **fresh** SUT (never reuse the spike's), then drive exactly two real turns per the branch
the spike selected. Turn 1 must leave the run incomplete (the blocked Stop); turn 2 completes it (the
silent allow). Do not run the `ci` phase — that is the fixture path.

## 3. Guard: exactly block-then-allow, or discard

Before running `verify`, confirm the run produced exactly two observations in order:

```sh
grep -F "$RUN_ID" "$SUT/.faff/hook-observations.jsonl"
# EXACTLY two lines, result "block" then "allow"  -> proceed
# anything else                                    -> DISCARD and re-capture from a fresh SUT
```

**Never hand-edit `hook-observations.jsonl`.** The file is the machine's record of what actually
happened; trimming it to two entries to satisfy the gate is exactly the forgery the bounded claim
already admits a hostile operator could commit, and doing it yourself destroys the honesty of the
attestation. Discard and re-capture instead.

## 4. Sign and verify (outside the session)

Run `verify` **outside** the Claude session, signing with your own name:

```sh
node "$SUT/scripts/verify-commissaire.mjs" verify \
  --capture "$VE/results/$(date +%F)-commissaire-bare-claude" \
  --attested-by "Your Name"
```

`verify` runs the existing step-3 checks unchanged (exactly two observations, block then allow,
`claude-code-observed`, equal `session_id_sha256`), writes `attested_by` into `demo-result.json`
(excluded from the `members[]` re-hash — the field rests on you, not on a digest), and substitutes
the signed attested line into the published README. An empty, over-120-char, or newline/control-char
name is rejected (exit 2) with no capture written. With no `--attested-by` on a real TTY, `verify`
prompts for the name.

## 5. Replay clean, then commit the capture

```sh
COMMISSAIRE_ROOT=$COMMISSAIRE_ROOT sh "$VE/results/$(date +%F)-commissaire-bare-claude/replay.sh"
# audit verify: pass · effects check: no escape · bundle verify: CLEAN
```

Commit the dated `results/<date>-commissaire-bare-claude/` directory to **this PR's branch**. The PR
merges once the capture is present and its `replay.sh` runs clean locally. The code slice around it
is fully gated; the capture itself is operator-attested, by design.
