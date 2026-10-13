// FAFF-1212: a TrustContext for tests that call the merge-gate grant wrappers on a governed run.
// A local transport against a throwaway git repo whose `main` carries no trust file is enough: the
// trust read answers "absent" and the leg verifies the grant on its own merits.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeTrustContext } from "../../plugin/skills/faff/bin/lib/merge-gate.js";

export function trustRepo(branch = "main") {
  const dir = mkdtempSync(join(tmpdir(), "faff1212-trust-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", branch);
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

// The local-transport context against `repoDir`, reading `baseRef`.
export function localTrustCtx(repoDir, baseRef = "main") {
  return makeTrustContext({ transport: "local", repo_dir: repoDir, base_ref: baseRef });
}
