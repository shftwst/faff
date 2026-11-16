# Workflow execution qualification

This is the completion gate added at the operator's request after the bounded
decision probes. Freeze each fixture and its oracle before collecting model
execution traces. Original and reduced policies use the same production runtime,
tool schemas, fixture state and model. Preserve failures and incomplete attempts.

## Gateway entry boundary

`gateway.json` defines five independent cases: decline, decline with existing
housekeeping data, unattended missing config, an existing decline stub, and
accept followed by the original request. Each case has a private disposable Git
workspace. The `run_faff` port executes the real pinned CLI there, without a root
override. Attempts to change the executable or escape the workspace are recorded
and refused. The offer port records the actual question and returns the fixture
human's predetermined reply.

Skill dispatch is recorded at the gateway boundary. Downstream skills are
explicit stubs: the onboard stub creates its fixture config and housekeeping
through the real CLI, while other skills acknowledge dispatch. This comparison
qualifies the changed gateway boundary, not full prep/map/onboard/beep-boop runs.

The independent oracle specifies required prompts, dispatches and ordered
mutations. Reference final states come from the existing decline sequence using
the same pinned CLI. Every model attempt records raw operations, results and
before/after file snapshots. Wrong arguments, missing or reordered effects,
unrequested writes, errors and state differences fail. The grader's tests include
autonomous config mutation, reordered setup and an attempted workspace escape.

Predeclared normalisation covers independent-case interleaving, the own-plugin
namespace alias, optional JSON output flags and fixture paths. Additional config
path reads remain visible and are reported separately; they never hide an extra
mutation, prompt or dispatch. No source-byte or provider-cost saving is inferred
from a shorter trace.

Run five fresh Claude samples per arm, alternating order by pair, after a
programmatic recorder preflight. Require every case to pass its oracle and
compare normalised effect/dispatch traces and final states across the arms.
Classify any extra reads explicitly. No rejected or forbidden attempt may be
waived by a later successful retry. An incomplete sample is not a pass.

The interactive worker retains Bash/file capabilities beyond the fixture ports.
Only the public task and bridge invocations are authorised by its test prompt.
Raw worker screens and all bridge exchanges are retained; this is not a claim of
security isolation or provider-metered accounting.

## Adversarial-review boundary

Next, exercise real backend resolution, review-spawn/review-call execution,
checkpoint writes and emitted verdict parsing against controlled provider
responses and outages. Compare original/reduced prompt actions and gate outcomes.
Freeze that fixture and oracle before model runs. The existing eight artifact
cases cover review judgement separately; fixed provider responses will test
workflow handling rather than pretending to measure a second model's judgement.
