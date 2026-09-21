// FAFF-1052 — every new sidecar (pin-capture.json, served-<n>.json, governance-<n>.json, and
// pinned-reviewer.json itself) is written atomically (write-temp-rename), named explicitly in
// the spec's DONE list as a crash-injection test. Mirrors heartbeat.test.mjs's own atomicity
// proof: force the rename step to fail by pre-creating the TARGET path as a directory (the same
// EISDIR fault a real disk-full / removed-run-dir / permissions error would hit), then assert
// the target is left either absent-or-untouched or complete-and-parseable — never a torn/partial
// file — and that no orphaned `*.tmp.*` file is left behind either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicWriteJSON, capturePin, captureNoLensServed, backendIdentity,
} from "../plugin/skills/faff/bin/lib/spec-review-pin.js";
import { govern, writeWindowStart } from "../plugin/skills/faff/bin/lib/spec-review-window.js";

const BACKENDS = [{ provider: "openai", model: "mA", host: "https://a/v1" }];

function tmpNamesIn(dir) {
  try { return readdirSync(dir).filter((n) => n.includes(".tmp.")); }
  catch { return []; }
}

test("atomicWriteJSON: a successful write leaves a complete, parseable file and no tmp leftover", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srp-atomic-"));
  try {
    const target = join(dir, "x.json");
    atomicWriteJSON(target, { a: 1 });
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { a: 1 });
    assert.deepEqual(tmpNamesIn(dir), [], "no orphaned tmp file after a successful write");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("atomicWriteJSON: a rename fault (target pre-exists as a directory) throws, never leaves a torn file, and cleans up the tmp", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srp-atomic-fault-"));
  try {
    const target = join(dir, "y.json");
    mkdirSync(target); // force renameSync(tmp, target) to fail with EISDIR/ENOTEMPTY
    assert.throws(() => atomicWriteJSON(target, { a: 1 }), "a failed rename re-throws, never silently swallowed");
    assert.equal(statSync(target).isDirectory(), true, "the pre-existing directory is untouched — never a torn write over it");
    assert.deepEqual(tmpNamesIn(dir), [], "the tmp file is cleaned up on a failed rename, not orphaned");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("capturePin: a rename fault on the SECOND sidecar write (pin-capture.json) still leaves the first write (pinned-reviewer.json) complete, never torn", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srp-atomic-cap-"));
  try {
    // pinned-reviewer.json does NOT pre-exist, so capturePin takes the fresh-capture branch and
    // writes it successfully FIRST; pin-capture.json is pre-occupied as a directory so the
    // SECOND write fails — proving a mid-sequence fault never leaves a torn earlier file.
    mkdirSync(join(dir, "pin-capture.json"));
    assert.throws(() => capturePin(dir, BACKENDS, 0, 1));
    const pin = JSON.parse(readFileSync(join(dir, "pinned-reviewer.json"), "utf8"));
    assert.deepEqual(pin, BACKENDS[0], "the first write completed intact despite the later fault");
    assert.deepEqual(tmpNamesIn(dir), [], "no orphaned tmp file left behind by either write");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("captureNoLensServed: a rename fault on pin-capture.json throws and leaves no orphaned tmp file", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srp-atomic-nolens-"));
  try {
    mkdirSync(join(dir, "pin-capture.json"));
    assert.throws(() => captureNoLensServed(dir, 1));
    assert.deepEqual(tmpNamesIn(dir), [], "no orphaned pin-capture.json.tmp.* left behind");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: a rename fault on governance-<n>.json throws and leaves no orphaned tmp file", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srp-atomic-gov-"));
  try {
    writeWindowStart(dir, 1);
    mkdirSync(join(dir, "governance-1.json"));
    assert.throws(() => govern(dir, 1, "no-lens"));
    assert.deepEqual(tmpNamesIn(dir), [], "no orphaned governance-1.json.tmp.* left behind");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a fully successful capture round-trips every sidecar as complete, parseable JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srp-atomic-full-"));
  try {
    capturePin(dir, BACKENDS, 0, 1);
    for (const file of ["pinned-reviewer.json", "pin-capture.json", "served-1.json"]) {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
      assert.ok(parsed && typeof parsed === "object", `${file} is complete, parseable JSON`);
    }
    assert.deepEqual(tmpNamesIn(dir), [], "no leftover tmp files after a fully successful capture");
    const g = govern(dir, 1, "any-served");
    assert.equal(g.code, 0);
    const gov = JSON.parse(readFileSync(join(dir, "governance-1.json"), "utf8"));
    assert.equal(gov.served_identity, backendIdentity(BACKENDS[0]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
