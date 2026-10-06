// FAFF-1180 — the closed result helper: constructors and the exhaustiveness check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, "..", "plugin", "skills", "faff", "bin", "lib");
const { ok, err, assertNever } = createRequire(import.meta.url)(path.join(LIB, "result.js"));

test("ok and err build the two arms of the result", () => {
  assert.deepEqual(ok(1), { ok: true, value: 1 });
  assert.deepEqual(err("e"), { ok: false, error: "e" });
});

test("assertNever throws an Error starting with the context and holding the JSON form of the value", () => {
  assert.throws(
    () => assertNever({ kind: "surprise" }, "handle"),
    (e) => e instanceof Error && e.message.startsWith("handle: ") && e.message.includes('{"kind":"surprise"}'),
  );
});

test("assertNever names the typeof when JSON.stringify returns a non-string or throws", () => {
  const cases = [[undefined, "undefined"], [() => 1, "function"], [10n, "bigint"]];
  for (const [value, type] of cases) {
    assert.throws(
      () => assertNever(value, "handle"),
      (e) => e instanceof Error && e.message === `handle: unhandled variant ${type}`,
      `${type} should be described by its typeof`,
    );
  }
});

test("result.js requires nothing", () => {
  assert.doesNotMatch(readFileSync(path.join(LIB, "result.js"), "utf8"), /\brequire\(/);
});
