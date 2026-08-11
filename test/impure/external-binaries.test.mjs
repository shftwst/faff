// FAFF-762 — impure macOS lane exercise §3 row 7: every external binary
// `setup-worktree.sh`'s direct-mode path touches must resolve on PATH. Cheap, high-value
// guard against a macos-latest runner image drifting a util out from under the flagship
// exercise; failing loud here is far cheaper than debugging a cryptic "command not found"
// mid-way through the setup-worktree.sh spawn tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// The exact 17-binary checklist setup-worktree-direct.test.mjs's jq-absence test builds its
// sandbox PATH from — direct mode never touches jq, so jq is deliberately excluded here too.
const REQUIRED_BINARIES = [
  "bash", "git", "node", "env", "sh",
  "basename", "dirname", "tr", "date", "mkdir", "cp", "cat", "grep",
  "rm", "head", "find", "sed", "uname",
];

for (const bin of REQUIRED_BINARIES) {
  test(`external binary resolves on PATH: ${bin}`, () => {
    const r = spawnSync("bash", ["-c", `command -v ${bin}`], { encoding: "utf8" });
    assert.equal(r.status, 0, `${bin} did not resolve on PATH (setup-worktree.sh direct mode needs it)`);
    assert.ok(r.stdout.trim().length > 0, `${bin} resolved to an empty path`);
  });
}
