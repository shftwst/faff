// FAFF-785 — the hermetic-env preload's own regression test.
//
// Asserts the born-verifiable oracle from the spec's §5 scenarios: with the preload active, a
// spawned child sees no /^FAFF_/ or /^CLAUDE_/ key (bar the EXEMPT FAFF_REQUIRE_DOCKER), while
// unrelated keys (PATH, HOME, TMPDIR, NODE_V8_COVERAGE) survive — and, as the control, that the
// same hostile env DOES leak through without the preload (so the preload is provably the cause).
//
// This test is itself hermetic: it never reads the ambient environment. Each spawn is handed an
// explicit `env` object, so the result depends only on the preload, not on the runner's shell.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const preload = path.join(here, "hermetic-env.mjs");

// A child that prints the faff-relevant slice of its own process.env as JSON.
const CHILD = `console.log(JSON.stringify({
  FAFF_RUN_DIR: process.env.FAFF_RUN_DIR ?? null,
  FAFF_MODEL: process.env.FAFF_MODEL ?? null,
  FAFF_SESSION_ID: process.env.FAFF_SESSION_ID ?? null,
  CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID ?? null,
  FAFF_REQUIRE_DOCKER: process.env.FAFF_REQUIRE_DOCKER ?? null,
  PATH: process.env.PATH ? "present" : null,
  HOME: process.env.HOME ?? null,
  TMPDIR: process.env.TMPDIR ?? null,
  NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE ?? null,
  UNRELATED_VAR: process.env.UNRELATED_VAR ?? null,
}));`;

// A deliberately hostile operator-shell env, plus the keys that must survive.
const HOSTILE_ENV = {
  PATH: process.env.PATH, // the child needs a PATH to exec at all
  HOME: "/home/operator",
  TMPDIR: "/tmp",
  NODE_V8_COVERAGE: "/tmp/cov",
  UNRELATED_VAR: "keep-me",
  FAFF_RUN_DIR: "/tmp/ambient-run",
  FAFF_MODEL: "sonnet",
  FAFF_SESSION_ID: "ambient-sess",
  FAFF_REQUIRE_DOCKER: "1",
  CLAUDE_CODE_SESSION_ID: "ambient-claude",
};

function childEnvWith(args) {
  const r = spawnSync("node", [...args, "-e", CHILD], { encoding: "utf8", env: HOSTILE_ENV });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
}

test("FAFF-785: with the preload, a spawned child sees no FAFF_*/CLAUDE_* key (bar EXEMPT)", () => {
  const seen = childEnvWith(["--import", preload]);
  assert.equal(seen.FAFF_RUN_DIR, null, "FAFF_RUN_DIR must be scrubbed");
  assert.equal(seen.FAFF_MODEL, null, "FAFF_MODEL must be scrubbed");
  assert.equal(seen.FAFF_SESSION_ID, null, "FAFF_SESSION_ID must be scrubbed");
  assert.equal(seen.CLAUDE_CODE_SESSION_ID, null, "CLAUDE_CODE_SESSION_ID must be scrubbed");
});

test("FAFF-785: FAFF_REQUIRE_DOCKER is EXEMPT and survives the scrub (FAFF-274 fail-loud held)", () => {
  const seen = childEnvWith(["--import", preload]);
  assert.equal(seen.FAFF_REQUIRE_DOCKER, "1", "FAFF_REQUIRE_DOCKER must survive (exempt)");
});

test("FAFF-785: the preload deletes nothing else — PATH/HOME/TMPDIR/NODE_V8_COVERAGE/unrelated survive", () => {
  const seen = childEnvWith(["--import", preload]);
  assert.equal(seen.PATH, "present", "PATH must survive");
  assert.equal(seen.HOME, "/home/operator", "HOME must survive");
  assert.equal(seen.TMPDIR, "/tmp", "TMPDIR must survive");
  assert.equal(seen.NODE_V8_COVERAGE, "/tmp/cov", "NODE_V8_COVERAGE must survive (FAFF-581 coverage passthrough)");
  assert.equal(seen.UNRELATED_VAR, "keep-me", "an unrelated env var must survive");
});

test("FAFF-785 (control): without the preload, the same hostile env leaks through", () => {
  const seen = childEnvWith([]);
  assert.equal(seen.FAFF_RUN_DIR, "/tmp/ambient-run", "control: FAFF_RUN_DIR leaks without the preload");
  assert.equal(seen.CLAUDE_CODE_SESSION_ID, "ambient-claude", "control: CLAUDE_* leaks without the preload");
});
