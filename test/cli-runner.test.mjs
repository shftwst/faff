// FAFF-91 — the runner proves itself: runCli round-trips a deterministic subcommand,
// asserting the structured seam (verdict token + exit code), never the reason prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./helpers/run-cli.mjs";

test("runCli: success case — faff next round-trips with exit 0 + expected verdict token", () => {
  const { stdout, code } = runCli(["next", "--status", "todo", "--spec", "high"]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).next, "graft"); // structured token, not the reason string
});

test("runCli: failure case — an unknown subcommand returns a non-zero code", () => {
  const { code } = runCli(["zzz-not-a-subcommand"]);
  assert.notEqual(code, 0);
});
