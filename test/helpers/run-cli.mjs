// FAFF-91 — CLI test runner. The base every CLI unit test (FAFF-92) builds on.
//
// Invokes a `faff` subcommand as a child process (the real entrypoint — shebang dispatch,
// arg parsing, exit codes, exactly as CI and users invoke it) and returns the deterministic
// seam: { stdout, stderr, code }. Zero-dependency (node:child_process only); per ADR 0002.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const faffBin = path.join(repoRoot, "skills", "faff", "bin", "faff");

/**
 * Run a faff subcommand and capture its observable output/exit (the deterministic seam).
 * @param {string[]} args  subcommand + args, e.g. ["next", "--status", "todo", "--spec", "high"]
 * @param {{cwd?: string, input?: string}} [opts]  cwd defaults to repo root; provision a fixture
 *        dir for config/git-dependent subcommands. input is fed to stdin.
 * @returns {{stdout: string, stderr: string, code: number|null}}
 */
export function runCli(args, opts = {}) {
  const r = spawnSync("node", [faffBin, ...args], {
    cwd: opts.cwd ?? repoRoot,
    input: opts.input,
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
}

export { repoRoot, faffBin };
