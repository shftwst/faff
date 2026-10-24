// FAFF-1400: the shared no-follow leaf read: classification comes from the opened descriptor, never from a
// by-path look, and a symlink's target bytes are never returned.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { constants, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { readLeafNoFollow } = require("../plugin/skills/faff/bin/lib/leaf-read.js");

function dir(t) {
  const d = mkdtempSync(join(tmpdir(), "faff-leaf-read-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

test("a regular file returns kind regular with its exact bytes", (t) => {
  const d = dir(t);
  const body = Buffer.from([0, 1, 2, 255, 10]);
  writeFileSync(join(d, "f"), body);
  const r = readLeafNoFollow(join(d, "f"));
  assert.equal(r.kind, "regular");
  assert.ok(Buffer.isBuffer(r.bytes) && r.bytes.equals(body));
});

test("a symlink returns kind symlink with null bytes, never the target's bytes (valid-JSON target)", (t) => {
  const d = dir(t);
  writeFileSync(join(d, "target.json"), '{"ok":true}');
  symlinkSync(join(d, "target.json"), join(d, "link.json"));
  assert.deepEqual(readLeafNoFollow(join(d, "link.json")), { kind: "symlink", bytes: null });
});

test("a directory returns kind directory", (t) => {
  const d = dir(t);
  mkdirSync(join(d, "sub"));
  assert.deepEqual(readLeafNoFollow(join(d, "sub")), { kind: "directory", bytes: null });
});

test("a FIFO with no writer returns kind other without blocking", (t) => {
  const d = dir(t);
  execFileSync("mkfifo", [join(d, "fifo")]);
  // Run in a child with a timeout: a blocking open would hang the child, not this test process.
  const out = execFileSync(process.execPath, ["-e", `const {readLeafNoFollow:r}=require(${JSON.stringify(require.resolve("../plugin/skills/faff/bin/lib/leaf-read.js"))});process.stdout.write(JSON.stringify(r(process.argv[1])))`, join(d, "fifo")], { timeout: 15000, encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), { kind: "other", bytes: null });
});

test("a missing path and a path under a regular file return kind absent", (t) => {
  const d = dir(t);
  writeFileSync(join(d, "f"), "x");
  assert.deepEqual(readLeafNoFollow(join(d, "missing")), { kind: "absent", bytes: null });
  assert.deepEqual(readLeafNoFollow(join(d, "f", "below")), { kind: "absent", bytes: null });
});

test("a dangling symlink is a symlink, not absent", (t) => {
  const d = dir(t);
  symlinkSync(join(d, "nowhere"), join(d, "dangling"));
  assert.equal(readLeafNoFollow(join(d, "dangling")).kind, "symlink");
});

test("a constants object without a numeric O_NOFOLLOW throws without opening the path", (t) => {
  const d = dir(t);
  writeFileSync(join(d, "f"), "x");
  const { O_NOFOLLOW, ...rest } = constants;
  assert.throws(() => readLeafNoFollow(join(d, "f"), rest), /unsupported/);
  assert.throws(() => readLeafNoFollow(join(d, "missing"), rest), /unsupported/, "throws before any open, so a missing path is not reported absent");
});

test("a constants object without a numeric O_NONBLOCK throws without opening the path", (t) => {
  const d = dir(t);
  writeFileSync(join(d, "f"), "x");
  const { O_NONBLOCK, ...rest } = constants;
  assert.throws(() => readLeafNoFollow(join(d, "f"), rest), /unsupported/);
  assert.throws(() => readLeafNoFollow(join(d, "missing"), rest), /unsupported/);
});
