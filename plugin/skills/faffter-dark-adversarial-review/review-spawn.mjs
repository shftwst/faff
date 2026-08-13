#!/usr/bin/env node
// review-spawn.mjs — bounded, killable single-shot process-group spawner around the
// Phase-2 adversarial-review invocation (FAFF-793).
//
// Inserted at the ONE shell call site in SKILL.md's Backend call section
// (`node "$REVIEW_CALL" --backends-json ...`): the SKILL now invokes
// `node review-spawn.mjs --deadline "$deadline" -- node "$REVIEW_CALL" ...` instead. This
// is a process-lifecycle net ONLY — it does not touch review-call.mjs's transport, retry,
// or fallback-chain logic, and it does not change the review verdict/disposition
// semantics: review-call.mjs's own exit code (0/2/4/5/6/7/8/9/10) passes through
// VERBATIM on the healthy path (this file's `mapOutcomeExit`, imported unchanged from
// killable-spawn.mjs). Only a wrapper-FIRED hard kill (the target still alive at
// --deadline + --grace) synthesises exit 8 — review-call.mjs's OWN existing "deadline
// exceeded" code — so SKILL.md's exit-8 disposition row (pass + skip, logged loudly,
// phase2: skipped-deadline) applies unchanged; no new verdict semantics, no new outcome
// row. The hard-kill firing is still visible: it is logged loudly and distinctly on
// stderr (see killGroup's log calls in killable-spawn.mjs), so a mis-tuned budget or a
// genuine slipped-fence event is diagnosable even though the disposition is identical.
//
// `review-call.mjs` keeps its own internal --deadline (its graceful self-exit 8, well
// inside this wrapper's budget on the healthy path); this wrapper's --deadline (+
// --grace) is the strictly-LATER hard backstop for a target that failed to honour its
// own budget — e.g. a variable-spliced self-backgrounding attempt that slipped the
// FAFF-491/530 foreground fence and reparented a child to init. Backstop, not sandbox: a
// child that deliberately `setsid`s into its own session escapes any process-group
// signal — that class stays the fence's remit (see killable-spawn.mjs's header).
//
// Zero-dependency beyond the sibling killable-spawn.mjs module (node stdlib only).

import { spawn } from "node:child_process";
import { parseArgs, runKillable, mapOutcomeExit, WRAPPER_EXIT, selftest as killableSelftest } from "./killable-spawn.mjs";

function usage() {
  process.stderr.write(
    "usage: review-spawn.mjs --deadline SECONDS [--grace SECONDS] -- <command> [args...]\n" +
    "  --deadline S   total wall-clock budget for the wrapped invocation (pass the SAME value\n" +
    "                 given to review-call.mjs's own --deadline)\n" +
    "  --grace   S    extra margin after --deadline before the hard group-kill (default: 30)\n" +
    "  --             everything after this is the target argv, run unmodified\n",
  );
}

export async function main(argv, { spawnFn = spawn } = {}) {
  if (argv.includes("--selftest")) return killableSelftest();

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`review-spawn: ${parsed.reason}\n`);
    usage();
    return WRAPPER_EXIT.USAGE;
  }

  const outcome = await runKillable(parsed, {
    spawnFn,
    log: (msg) => process.stderr.write(`${msg}\n`),
  });
  return mapOutcomeExit(outcome);
}

if (process.argv[1] && process.argv[1].endsWith("review-spawn.mjs")) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { process.stderr.write(`review-spawn: ${e && e.message}\n`); process.exitCode = WRAPPER_EXIT.SPAWN_FAILED; });
}
