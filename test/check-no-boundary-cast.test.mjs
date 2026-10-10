// FAFF-1170 — S3: the boundary-contract checker catches every unchecked-assertion form plus the two
// structural properties, and passes the real cluster sources. Drives scripts/check-no-boundary-cast.mjs
// (the TS-compiler-API AST walk) over planted-violation fixtures and the real sources.
//
// SELF-SKIPS when the typescript compiler API is not installed — the CI unit matrix never installs the
// build-time toolchain (typescript / @types/node are build-time-only devDependencies under
// plugin/skills/faff), so the AST walk cannot run there; it runs for real locally and on any lane that
// has built the cluster. The check itself is also wired into CI as a dedicated step would be under a
// toolchain-installing lane (FAFF-1171's remit); this slice proves it at the source.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveTypescript, checkSources, realSources } from "../scripts/check-no-boundary-cast.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const FIX = path.join(REPO, "testdata", "typescript", "boundary-cast");
const LIB = path.join(REPO, "plugin", "skills", "faff", "bin", "lib");
const PLUGIN = path.join(REPO, "plugin", "skills", "faff");
const CHECKER_URL = pathToFileURL(path.join(REPO, "scripts", "check-no-boundary-cast.mjs")).href;

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
  "require-ids-untyped.ts", // an untyped require("./ids")
  "cast-in-retired-mint.ts", // an `as` inside the retired asProducerId mint
  "cast-in-foreign-mint.ts", // an `as` inside parseOpaqueId outside bin/lib/ids.ts
];

test("S3: every planted boundary-cast fixture is caught (as / <T> / as any / ! / satisfies / any-reader / untyped require / retired and foreign mints)", { skip }, () => {
  for (const name of PLANTED) {
    const { violations } = checkSources([path.join(FIX, name)], ts);
    assert.ok(violations.length >= 1, `${name} should produce at least one violation (got ${violations.length})`);
  }
});

test("S3: the clean fixture (no assertion, typed producer-auth / ids / result requires) passes", { skip }, () => {
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
    "require-ids-untyped.ts": /IdsApi/,
    "cast-in-retired-mint.ts": /as-expression/,
    "cast-in-foreign-mint.ts": /as-expression/,
  };
  for (const [name, re] of Object.entries(forms)) {
    const { violations } = checkSources([path.join(FIX, name)], ts);
    assert.ok(violations.some((v) => re.test(v)), `${name} should report a ${re} violation, got: ${JSON.stringify(violations)}`);
  }
});

test("S3: realSources() lists the seven tsconfig include entries", () => {
  assert.deepEqual(realSources().map((f) => path.relative(LIB, f)), ["producer-auth.ts", "commissaire.ts", "commissaire-trust.ts", "ids.ts", "result.ts", "decision-policy.ts", "governor.ts"]);
});

test("S3: the real cluster sources are clean (exit 0)", { skip }, () => {
  const { violations } = checkSources(realSources(), ts);
  assert.equal(violations.length, 0, `real sources must be clean, got: ${JSON.stringify(violations)}`);
});

const tempDirs = [];
after(() => { for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true }); });

test("S3: the one brand assertion is allowed in the real ids.ts and nowhere else", { skip }, () => {
  const idsText = readFileSync(path.join(LIB, "ids.ts"), "utf8");
  assert.equal((idsText.match(/\bas OpaqueId\b/g) ?? []).length, 1, "ids.ts must hold exactly one brand assertion");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "faff-ids-copy-"));
  tempDirs.push(tmp);
  const copy = path.join(tmp, "ids.ts");
  writeFileSync(copy, idsText);
  const { violations } = checkSources([copy], ts);
  assert.equal(violations.length, 1, `the same text outside bin/lib/ids.ts must violate, got: ${JSON.stringify(violations)}`);
});

function packageWithInclude(include, extraLibFiles) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "faff-realsources-"));
  tempDirs.push(dir);
  const lib = path.join(dir, "bin", "lib");
  cpSync(path.join(PLUGIN, "bin", "lib"), lib, { recursive: true, filter: (src) => !src.endsWith(".js") });
  for (const file of extraLibFiles) {
    mkdirSync(path.dirname(path.join(lib, file)), { recursive: true });
    writeFileSync(path.join(lib, file), "export {};\n");
  }
  writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ include }));
  return dir;
}

function runRealSources(dir) {
  const code = `import { realSources } from ${JSON.stringify(CHECKER_URL)}; console.log(JSON.stringify(realSources(${JSON.stringify(dir)})));`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
}

const ALL_INCLUDE = ["bin/lib/producer-auth.ts", "bin/lib/commissaire.ts", "bin/lib/commissaire-trust.ts", "bin/lib/ids.ts", "bin/lib/result.ts", "bin/lib/decision-policy.ts", "bin/lib/governor.ts"];

test("S3: realSources() exits 2 naming a bin/lib .ts that include omits", () => {
  const r = runRealSources(packageWithInclude(ALL_INCLUDE, ["extra.ts"]));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /extra\.ts/);
});

test("S3: realSources() exits 2 naming a nested bin/lib .ts that include omits", () => {
  const dir = packageWithInclude(ALL_INCLUDE, [path.join("sub", "extra.ts")]);
  const r = runRealSources(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /sub[\\/]extra\.ts/);
});

test("S3: realSources() exits 2 when include has no literal .ts entry", () => {
  const r = runRealSources(packageWithInclude(["bin/lib/**/*"], []));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no literal \.ts entries/);
});

test("S3: realSources() passes a package whose include covers every bin/lib .ts", () => {
  const r = runRealSources(packageWithInclude(ALL_INCLUDE, []));
  assert.equal(r.status, 0, r.stderr);
});

// Sanity: the fixture dir didn't lose its planted files (a glob/rename would silently shrink coverage).
test("S3: the planted-fixture set is present (no silent coverage shrinkage)", { skip }, () => {
  const present = new Set(readdirSync(FIX).filter((f) => f.endsWith(".ts")));
  for (const name of [...PLANTED, "clean.ts"]) assert.ok(present.has(name), `fixture ${name} is missing`);
});
