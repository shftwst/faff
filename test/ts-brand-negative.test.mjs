// FAFF-1170 — S2: the brand flows across the production edge. A standalone fixture passes a raw,
// UN-MINTED string to producer-auth's branded admission API (the mint/admission path — the real
// enforced edge, not deriveKey and not a selftest literal); `tsc --noEmit` MUST fail with TS2345.
// The assertion is on the error CODE (TS2345), not merely a non-zero exit.
//
// SELF-SKIPS when the typescript compiler is not installed (the CI unit matrix never installs the
// build-time toolchain); runs for real locally and on any lane that has built the cluster.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const TSC = path.join(REPO, "plugin", "skills", "faff", "node_modules", "typescript", "bin", "tsc");
const FIXTURE_TSCONFIG = path.join(REPO, "testdata", "typescript", "ts-brand-negative", "tsconfig.json");

const skip = existsSync(TSC) ? false : "typescript compiler not installed (run `npm install` under plugin/skills/faff)";

test("S2: a raw string at the branded admission API fails tsc with TS2345", { skip }, () => {
  const r = spawnSync(process.execPath, [TSC, "--noEmit", "-p", FIXTURE_TSCONFIG], { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.notEqual(r.status, 0, `tsc must FAIL on the brand-negative fixture (output: ${out})`);
  assert.match(out, /TS2345/, `the failure must be TS2345 (a raw string where a brand is required), got: ${out}`);
});
