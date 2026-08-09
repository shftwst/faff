# One-shot control runbook

Operator guide for capturing **frontier one-shot control runs** against the proposed briefs in this directory. This document is faff-side — it is **never** included in what a run sees; a control gets its brief plus the fixed wrapper below, nothing else.

Written 2026-07-19 against a one-day window of Fable access capped at ~40% of a Max20 subscription. The ordering and budget discipline generalise to any scarce frontier-model window.

## Purpose

The faff side of every comparison (orchestrator + build models) uses models that remain available, so a scarce frontier window is spent **only** on capturing one-shot controls — never on faff runs, the gallery, or anything iterative.

## Protocol

A control run is:

- **One prompt**: the brief verbatim, plus the fixed wrapper (identical across all runs), nothing else.
- **No steering**: no follow-ups, no re-prompts. A re-prompted run is not a one-shot; if a run flails, let it die — a failed frontier control is still evidence, recorded as such.
- **Session ends where it ends**: whatever state the repo, deploy, and harness are in is the artifact.

Prefer headless: `claude -p "<brief + wrapper>" --max-turns N` with permissions pre-allowed. This encodes the protocol structurally (one prompt, bounded, unattended) and saves the transcript.

## Before the first run

- **Commit the briefs.** Each control must record the brief version it ran against; an uncommitted brief is unpinnable.
- **Pre-provision every credential** so sessions build instead of onboarding: `fly auth` done, Turso DB + token, R2 bucket + keys, GitHub OAuth app (divvy), Netlify token. The briefs promise availability — make it true first.
- **Fix the wrapper in writing** (protocol statement + economics block below) and reuse it verbatim on every run.
- **Permissions**: the allowlist must cover reads of `~/.claude/projects/` (the economics step) and the deploy/build commands, or an unattended run dies at a prompt.

## Budgeting

There is no native per-session token cap on subscription. Use, in combination:

- **`--max-turns` in headless mode** — the closest native lever. Calibrate N from the first (cheapest) run; give infra briefs roughly double.
- **Live visibility** — `/usage` for position against the 5-hour/weekly limits; a token statusline (claude-hud / ccusage) for per-session burn. Manual kill (Esc) on a runaway is legitimate: an aborted control is a recorded failed control.
- **Hard stop for the day** — a pre-chosen `/usage` mark (here: 40%) ends the exercise regardless of runs remaining.
- **The stop-rule beats the ordering**: fewer clean, fully-captured runs over more ragged ones.

For a true token ceiling, a `PreToolUse` hook can sum cumulative `usage` from the session transcript and block further tool calls past a threshold — real setup effort; only worth it if the cap must be enforced rather than approximated.

## Reasoning effort

Effort is spent on exactly the parts these briefs are decided by — oversell races, outbox atomicity, edge-case reasoning, physics tuning, harness design — so lowering it selectively weakens the control where the comparison lives. A low-effort control is a hobbled control: every headline claim has the shape "even the frontier one-shot missed X", and `effort: low` in the metadata is the receipt a skeptic needs to discount the whole gallery. It also cannot be fixed later — once the frontier window closes, a weak control cannot be re-run at strength.

- **Run controls at high effort** — "the frontier model at its strongest reasonable configuration" is the unimpeachable baseline. Default (medium) is the fallback framing ("as a user gets it out of the box"); low is not defensible.
- **Fund it from run count, not run quality.** This is the stop-rule expressed per-token: three or four high-effort controls in priority order beat six low-effort ones, because weak controls aren't cheaper experiments — they're runs that can't be cited.
- **Hold effort constant across every control and record it in run metadata** — it is part of "harness used" on the gallery card; comparability dies if it varies.
- **The asymmetry is fine, stated openly**: the faff side tunes its config freely because config is faff's product; the control gets the frontier model at full strength because that is the thing being beaten.

## Run order

Calibrate on the cheapest first, then the briefs that best evidence envs/tests/evaluation; the one-shot's home turf last.

| # | Brief | Why here |
|---|-------|----------|
| 1 | gridlet | Cheapest, zero infra risk; calibrates burn rate; the control against "a frontier model one-shots this" |
| 2 | poke | Cleanest infra brief; time-domain scheduler + check-time SSRF is the purest evaluation-discipline showcase |
| 3 | divvy | Crown jewel for envs/tests/evaluation (OAuth, migrations, IDOR probe, money invariants); run once burn rate is known |
| 4 | grocer | Best single async-correctness discriminator (outbox, idempotency, kill-recovery); longest, most flail-prone session |
| 5 | stash | Direct-to-storage architecture AC; evidence overlaps divvy/grocer; R2 setup risk |
| 6 | showhands | Strong brief, smallest *new* evidence increment by this point; first to sacrifice to budget |
| 7 | pumped | The one-shot's home turf; least aligned with the benefits being evidenced; capture if budget survives, skip without guilt |

If the day ends at the top three, the evidence spine for "process, not model choice" already exists.

## Per-run capture (immediately after each run)

- Full transcript (`~/.claude/projects/<slug>/*.jsonl`)
- Token counts by category (see economics report; verify against transcript)
- Model ID (`claude-fable-5`), harness + version
- Brief version (commit hash) the run was given
- Repo snapshot, deployed URL if any, screenshot for the card thumbnail
- Outcome notes: which ACs pass/fail (evaluated later is fine; capture the artifact now)

Provenance line for the gallery: *self-reported from transcript, verified against transcript*.

## Cost

Report **tokens only** in-run; price downstream at published API rates per category (input / output / cache-write / cache-read rates differ). A model does not reliably know its own current pricing — a wrong number frozen into a control artifact is worse than none. State the pricing methodology on the run's card.

## Fixed wrapper — economics block

Append verbatim to every control prompt, after the brief:

```markdown
## Run economics (mandatory final step — do this last, after all other work is complete)

Before ending, produce an economics report for this run and commit it to the repo as
`ECONOMICS.md` with a machine-readable `economics.json` beside it.

1. Locate this session's transcript: the most recently modified `*.jsonl` under
   `~/.claude/projects/` in the directory whose name corresponds to this working
   directory. If you cannot find or read it, state that plainly in ECONOMICS.md and
   report only what you can count directly (turns, tool calls, wall clock). Never
   present an estimated token figure as a measured one.
2. From the transcript, sum the per-message `usage` fields across the whole session:
   `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
   `cache_read_input_tokens`. Report each total separately — do not collapse them
   into one number.
3. Break the totals down two ways:
   - **By phase:** segment the session chronologically by what was actually happening
     (e.g. reading the brief, scaffolding, core implementation, verification harness,
     deployment, debugging/rework), with per-phase token subtotals, wall-clock time,
     and turn counts. Label phases by activity observed in the transcript, not by
     what was planned.
   - **By tool:** per tool (file reads, shell commands, edits, etc.), the number of
     calls and the token weight of their results.
4. Add a **waste analysis**: the segments that consumed the most tokens for the least
   progress (retry loops, failed commands, dead-end approaches), each quantified.
5. Record: total turns, session start/end timestamps, model ID, and harness + version.
6. State in the report that the figures are self-measured from the transcript, that
   this bookkeeping step and the final message are necessarily excluded from their
   own totals, and that the transcript is the authoritative source for verification.

Report tokens only — do not convert to currency; pricing is applied downstream.
```

The by-phase and waste breakdowns are themselves comparison evidence: a faff run's tokens concentrating in spec/tests/verification versus a one-shot's burning in deploy-debug loops is the "process, not model choice" story, quantified per run in the run's own words.
