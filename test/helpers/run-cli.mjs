// FAFF-91 — CLI test runner. The base every CLI unit test (FAFF-92) builds on.
//
// Invokes a `faff` subcommand as a child process (the real entrypoint — shebang dispatch,
// arg parsing, exit codes, exactly as CI and users invoke it) and returns the deterministic
// seam: { stdout, stderr, code }. Zero-dependency (node:child_process only); per ADR 0002.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const faffBin = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");

/**
 * Run a faff subcommand and capture its observable output/exit (the deterministic seam).
 * @param {string[]} args  subcommand + args, e.g. ["next", "--status", "todo", "--spec", "high"]
 * @param {{cwd?: string, input?: string, env?: object}} [opts]  cwd defaults to repo root; provision a
 *        fixture dir for config/git-dependent subcommands. input is fed to stdin. env (when supplied)
 *        replaces the child environment — defaults to the parent's process.env.
 * @returns {{stdout: string, stderr: string, code: number|null}}
 */
export function runCli(args, opts = {}) {
  // FAFF-581: NODE_V8_COVERAGE passthrough — the SINGLE spawn seam. When the parent
  // sets NODE_V8_COVERAGE (the CI coverage step; unset for a plain `node --test`),
  // every spawned `bin/faff` child inherits it and dumps its V8 coverage JSON into
  // that dir, which a zero-dependency aggregator (scripts/coverage-aggregate.mjs)
  // rolls up. Do this HERE only — never sprinkle it across the 400+ call sites.
  // Unset → nothing added, behaviour byte-identical to today. A custom env passed by
  // a caller still receives the passthrough unless it deliberately sets its own.
  const baseEnv = opts.env ?? process.env;
  const env = process.env.NODE_V8_COVERAGE && baseEnv.NODE_V8_COVERAGE === undefined
    ? { ...baseEnv, NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }
    : baseEnv;
  const r = spawnSync("node", [faffBin, ...args], {
    cwd: opts.cwd ?? repoRoot,
    input: opts.input,
    env,
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
}

export { repoRoot, faffBin };
