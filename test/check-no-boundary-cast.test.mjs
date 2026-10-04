// FAFF-1170 — S3: the boundary-contract checker catches every unchecked-assertion form plus the two
// structural properties, and passes the real cluster sources. Drives scripts/check-no-boundary-cast.mjs
// (the TS-compiler-API AST walk) over planted-violation fixtures and the real sources.
//
// SELF-SKIPS when the typescript compiler API is not installed — the CI unit matrix never installs the
// build-time toolchain (typescript / @types/node are build-time-only devDependencies under
// plugin/skills/faff), so the AST walk cannot run there; it runs for real locally and on any lane that
// has built the cluster. The check itself is also wired into CI as a dedicated step would be under a
// toolchain-installing lane (FAFF-1171's remit); this slice proves it at the source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTypescript, checkSources } from "../scripts/check-no-boundary-cast.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const FIX = path.join(HERE, "fixtures", "boundary-cast");
const LIB = path.join(REPO, "plugin", "skills", "faff", "bin", "lib");
const REAL = [path.join(LIB, "producer-auth.ts"), path.join(LIB, "commissaire.ts")];

const ts = resolveTypescript();
const skip = ts ? false : "typescript compiler API not installed (run `npm install` under plugin/skills/faff)";

// Each planted fixture must yield at least one violation; clean.ts must yield none.
const PLANTED = [
  "cast-as-brand.ts",   // `as ProducerId` / `as string`
  "cast-angle.ts",      // `<string>value`
  "cast-as-any.ts",     // `as any`
  "cast-nonnull.ts",    // `value!`
  "cast-satisfies.ts",  // `value satisfies T`
  "reader-any.ts",      // a boundary reader returning `any`
  "require-untyped.ts", // an untyped require("./producer-auth")
];

test("S3: every planted boundary-cast fixture is caught (as / <T> / as any / ! / satisfies / any-reader / untyped require)", { skip }, () => {
  for (const name of PLANTED) {
    const { violations } = checkSources([path.join(FIX, name)], ts);
    assert.ok(violations.length >= 1, `${name} should produce at least one violation (got ${violations.length})`);
  }
});

test("S3: the clean fixture (validator-mint `as` + typed producer-auth require) passes", { skip }, () => {
  const { violations } = checkSources([path.join(FIX, "clean.ts")], ts);
  assert.equal(violations.length, 0, `clean.ts should have no violations, got: ${JSON.stringify(violations)}`);
});

test("S3: each assertion FORM is detected (not just `as`)", { skip }, () => {
  const forms = {
    "cast-angle.ts": /angle-bracket-assertion/,
    "cast-nonnull.ts": /non-null-assertion/,
    "cast-satisfies.ts": /satisfies-expression/,
    "reader-any.ts": /returns `any`|no explicit return type/,
    "require-untyped.ts": /ProducerAuthApi/,
  };
  for (const [name, re] of Object.entries(forms)) {
    const { violations } = checkSources([path.join(FIX, name)], ts);
    assert.ok(violations.some((v) => re.test(v)), `${name} should report a ${re} violation, got: ${JSON.stringify(violations)}`);
  }
});

test("S3: the real cluster sources are clean (exit 0)", { skip }, () => {
  const { violations } = checkSources(REAL, ts);
  assert.equal(violations.length, 0, `real sources must be clean, got: ${JSON.stringify(violations)}`);
});

// Sanity: the fixture dir didn't lose its planted files (a glob/rename would silently shrink coverage).
test("S3: the planted-fixture set is present (no silent coverage shrinkage)", { skip }, () => {
  const present = new Set(readdirSync(FIX).filter((f) => f.endsWith(".ts")));
  for (const name of [...PLANTED, "clean.ts"]) assert.ok(present.has(name), `fixture ${name} is missing`);
});
