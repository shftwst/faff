# Operator runbook: publish the attested bare Claude Code capture (FAFF-1018)

This runbook is the human-in-the-loop half of FAFF-1018. The code slice (`--attested-by`) ships
gated in the same PR; this procedure is what an **operator** runs to produce the one real,
signed capture that FAFF-829 bullet 1 needs. It is deliberately not CI-gated: the machine checks the
Stop-shape, the equal `session_id_sha256`, and the block-then-allow ordering; the operator is the
residual human oracle that the two Stop firings came from two real Claude Code turns.


## 0. Preconditions

On the machine you will run this from:

- `claude` on PATH (`command -v claude`).
- Node 20 or newer, and `git` (preflight check 1 refuses anything older).
- A full SuperDomestique checkout whose **HEAD** is the pinned driver revision
  `ec676cfc468de9d7ca140cb0c08ec3b8ef1b196d`, supplied below as `COMMISSAIRE_ROOT`.

The pin is enforced by the **verifier**, not the scaffolder. `scaffold-commissaire-bare-claude.sh`
only requires `COMMISSAIRE_ROOT` to be set; it substitutes the pin into the copied verifier and
exits 0 against any checkout. The refusal comes at the first `prepare`, where preflight checks that
`COMMISSAIRE_REVISION` equals the driver's HEAD (check 3), equals the pin (check 4), has the FAFF-828
commit as an ancestor (check 5), and carries `plugin/skills/faff/bin/commissaire` and
`plugin/skills/faff/bin/lib/bundle-seal-core.js` at that revision (check 6). So a wrong checkout
fails loudly, one step later than you might expect.

The SUT (the scaffolded bare consumer repo) must satisfy four separate preflight rules. They are not
about your working directory, which is never inspected: the verifier derives the SUT root from its
own script path, so you can run every command from anywhere.

- The SUT directory must not exist, or must be empty, when you scaffold (the scaffolder exits 2).
- `COMMISSAIRE_ROOT` must resolve outside the SUT (check 2). Never scaffold the SUT inside the
  checkout.
- The SUT must hold no factory surface: no `.faffrc`, `.faffrc.yaml`, `.faffrc.yml`,
  `.claude/skills`, `.agents/skills`, or `plugin/skills` (check 9). The scaffolder creates none of
  these, so this only fires if you add one.
- The SUT must have no configured git remote (check 10), and nothing under `.faff/` or
  `protected-output.txt` may be tracked or staged (check 11). The scaffolder's `.gitignore` and
  remote-less `git init` satisfy both.

Set once, and keep this environment for every command below:

```sh
COMMISSAIRE_ROOT=/path/to/checkout-at-ec676cfc
COMMISSAIRE_REVISION=$(git -C "$COMMISSAIRE_ROOT" rev-parse HEAD)
VE=$COMMISSAIRE_ROOT/verification/external-verification
export COMMISSAIRE_ROOT COMMISSAIRE_REVISION
```

`COMMISSAIRE_REVISION` is required, not optional: every phase calls preflight, and preflight exits 2
with `COMMISSAIRE_REVISION is required` when it is unset. Deriving it from `rev-parse HEAD` as above
means check 3 passes by construction and check 4 is the one that catches a wrong checkout, naming
both SHAs in its message.

## 1. Spike first (does a real Stop firing carry the full shape?)

The verifier's `claude-code-observed` branch has never run against a real session. One fact decides
how you capture, and it goes in the capture's notes.

Does a Stop firing from a real `claude` turn hand the wrapper all four stdin fields (`session_id`,
`transcript_path`, `cwd`, `stop_hook_active`), with a `transcript_path` that exists on disk and a
`cwd` whose realpath equals the SUT root? All of that must hold for `commissaire-stop-hook.mjs` to
label the observation `claude-code-observed`; any part missing falls back to `ci-fixture`, which is
the fixture path and cannot carry the capture.

You do **not** need to measure how many times Stop fires per turn. Claude Code re-fires Stop on every
`decision: block` until an internal cap, so one real turn can drive the wrapper roughly ten times for
the same decision, and the hook already folds that to **at most one observation per (run_id,
result)**. Duplicate firings are a solved problem, not a measurement.

```sh
SUT=$(mktemp -d)
SUT_ROOT=$SUT bash "$VE/scaffold-commissaire-bare-claude.sh"
node "$SUT/scripts/verify-commissaire.mjs" prepare
RUN_ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).run_id)' "$SUT/.faff/active-run.json")
( cd "$SUT" && claude -p --output-format json "make a trivial no-op edit, then stop" )
grep -F "$RUN_ID" "$SUT/.faff/hook-observations.jsonl"
```

Read the result:

- Expect **one** line, `"result":"block"`, whatever Claude Code's continuation loop did. Two or more
  lines for one turn means the fold is not holding and the spike itself is the finding; stop and
  report it rather than capturing.
- Is `source` `claude-code-observed`, or did it fall back to `ci-fixture`? On a fallback, the
  observation records `transcript_existed` and `cwd_matched` only on the observed path, so diagnose
  by hand: does the `transcript_path` Claude Code reported exist, and does its `cwd` realpath to
  `$SUT`?

Also note the session-identity constraint the branch below turns on. The hook hashes
`sha256(run_id + session_id)`, and `verify` requires both observations to carry the **equal** hash,
so both turns must run inside **one** Claude Code session.

**Branch on the outcome:**

- **A, the shape is complete** and `claude -p --output-format json` reports a `session_id` you can
  resume. The scripted two-turn capture is viable.
- **B, the shape is incomplete, or no resumable `session_id` is reported.** Drive both turns in one
  **interactive** Claude Code session, which holds one `session_id` throughout.

Discard the spike SUT. It has a used run pointer and a block observation, and `prepare` refuses a
live pointer.

## 2. Capture the two real turns

Scaffold a **fresh** SUT, never the spike's. The run has five phases and they interleave with the
turns in exactly one order:

```
prepare  ->  turn 1  ->  complete  ->  turn 2  ->  verify
```

`prepare` and `complete` are not thin checks. `prepare` mints the L2 ledger, admits the producer,
and drives the no-evidence refusal and the pre-declaration deny. `complete` requires exactly one
prior validated Stop block at ordinal 1, then declares the effect, takes the grant, writes
`protected-output.txt`, concludes, and seals the bundle. The pointer state machine is what makes the
turns differ: every firing before `complete` blocks, every firing after it allows. Turn 1 therefore
leaves the run incomplete (the blocked Stop) and turn 2 completes it (the silent allow).

Do not run the `ci` phase. That is the fixture path and publishes nothing.

**Branch A, scripted:**

```sh
SUT=$(mktemp -d)
SUT_ROOT=$SUT bash "$VE/scaffold-commissaire-bare-claude.sh"
node "$SUT/scripts/verify-commissaire.mjs" prepare
RUN_ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).run_id)' "$SUT/.faff/active-run.json")

# turn 1
SESSION=$( cd "$SUT" && claude -p --output-format json "make a trivial no-op edit, then stop" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).session_id))' )

# complete (outside the session)
node "$SUT/scripts/verify-commissaire.mjs" complete

# turn 2
( cd "$SUT" && claude -p --resume "$SESSION" --output-format json "say done, then stop" )
```

**Branch B, interactive:** scaffold and `prepare` as above, then open the session and keep it open.

```sh
SUT=$(mktemp -d)
SUT_ROOT=$SUT bash "$VE/scaffold-commissaire-bare-claude.sh"
node "$SUT/scripts/verify-commissaire.mjs" prepare
RUN_ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).run_id)' "$SUT/.faff/active-run.json")

# turn 1, and turn 2 later, in ONE session
cd "$SUT" && claude
```

Inside that session, take turn 1 (any trivial prompt, then let it stop). Then, in a **second
terminal**, re-export `COMMISSAIRE_ROOT` and `COMMISSAIRE_REVISION` per section 0, set `SUT` to the
same directory, and run:

```sh
# complete (outside the session)
node "$SUT/scripts/verify-commissaire.mjs" complete
```

Return to the still-open session and take **turn 2**. One session throughout is what keeps the two
`session_id_sha256` values equal.

## 3. Guard: exactly block-then-allow, or discard

Before running `verify`, confirm the run produced exactly two observations in order:

```sh
grep -F "$RUN_ID" "$SUT/.faff/hook-observations.jsonl"
# EXACTLY two lines, result "block" then "allow"  -> proceed
# anything else                                    -> DISCARD and re-capture from a fresh SUT
```

Both lines must also carry the same `source`. `verify` refuses mixed sources, and a capture where
turn 1 observed and turn 2 fell back is not salvageable.

**Never hand-edit `hook-observations.jsonl`.** The file is the machine's record of what actually
happened; trimming it to two entries to satisfy the gate is exactly the forgery the bounded claim
already admits a hostile operator could commit, and doing it yourself destroys the honesty of the
attestation. Discard and re-capture instead.

## 4. Sign and verify (outside the session)

Run `verify` **outside** the Claude session, on a real terminal. With no `--attested-by`, it prompts
for your name on stderr, so nothing pasteable here carries a name:

```sh
node "$SUT/scripts/verify-commissaire.mjs" verify \
  --capture "$VE/results/$(date +%F)-commissaire-bare-claude"
```

`verify` runs the existing step-3 checks unchanged (exactly two observations, block then allow,
equal `source`, equal `session_id_sha256` on the observed path), writes `attested_by` into
`demo-result.json` (excluded from the `members[]` re-hash, so the field rests on you, not on a
digest), and substitutes the signed attested line into the published README.

The name is resolved and validated **before** any capture directory is created, so an invalid name
exits 2 with nothing written. Rejected: empty or whitespace-only, longer than 120 characters, or
containing any newline or control character. A present-but-blank `--attested-by` is an error too,
never a quiet fall back to the prompt.

**The one failure mode that does not announce itself.** Off a TTY with no `--attested-by`, the name
resolves to `null` and `verify` does **not** fail. It proceeds, omits `attested_by` from
`demo-result.json`, and publishes a README reading `Not operator-attested (ci-fixture run); source:
ci-fixture`. That line is hard-coded and does not reflect the run's real source, so an observed,
genuinely-captured run can publish a README that contradicts its own `demo-result.json`, with every
machine check green. Such a capture is worthless for FAFF-829 bullet 1, which needs the attestation.
Check the field before you commit anything:

```sh
node -e 'const d=require("fs").readFileSync(process.argv[1],"utf8");const j=JSON.parse(d);console.log(j.source, JSON.stringify(j.attested_by))' \
  "$VE/results/$(date +%F)-commissaire-bare-claude/demo-result.json"
# expect: claude-code-observed "<your name>"
```

If you must sign non-interactively, set the name in a variable first and pass it. An unset variable
expands empty and exits 2 with nothing written, which is the safe failure:

```sh
ATTESTED_BY='<the operator who ran and inspected the two turns>'
node "$SUT/scripts/verify-commissaire.mjs" verify \
  --capture "$VE/results/$(date +%F)-commissaire-bare-claude" \
  --attested-by "$ATTESTED_BY"
```

## 5. Replay clean, then commit the capture

```sh
COMMISSAIRE_ROOT=$COMMISSAIRE_ROOT sh "$VE/results/$(date +%F)-commissaire-bare-claude/replay.sh"
```

`replay.sh` copies the capture to a temp directory outside any checkout, runs the three
public-material replays there, prints one line each, and exits 0 only when all three held:

```
audit verify: pass
effects check: any_escape=false
bundle verify: CLEAN
```

Check the exit status, not just the lines. A replay that cannot parse a verdict prints `ERR` and
exits 1.

Commit the dated `results/<date>-commissaire-bare-claude/` directory to **this PR's branch**. The PR
merges once the capture is present and its `replay.sh` runs clean locally. The code slice around it
is fully gated; the capture itself is operator-attested, by design.
