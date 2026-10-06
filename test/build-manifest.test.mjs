// FAFF-1180 — the build manifest: the committed file matches the tree, the writer is deterministic, and
// every refusal path (stale emit, missing emit, uncovered source, drifted or absent compiler) fails loud.
// Pure fs and child processes: it never loads `typescript`, so it runs in every lane.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..", "plugin", "skills", "faff");
const { computeManifest, serialiseManifest, installedCompilerVersion } = createRequire(import.meta.url)(path.join(PKG, "scripts", "build-manifest.js"));

const PACKAGE_FILES = ["tsconfig.json", "package.json", "package-lock.json", "build-manifest.json"];

function copyPackage() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "faff-manifest-"));
  for (const file of PACKAGE_FILES) cpSync(path.join(PKG, file), path.join(dir, file));
  cpSync(path.join(PKG, "bin", "lib"), path.join(dir, "bin", "lib"), { recursive: true });
  cpSync(path.join(PKG, "scripts"), path.join(dir, "scripts"), { recursive: true });
  return dir;
}

function run(dir, mode) {
  return spawnSync(process.execPath, [path.join(dir, "scripts", "build-manifest.js"), ...(mode ? [mode] : [])], { cwd: dir, encoding: "utf8" });
}

function plantInstalledTypescript(dir, { version, integrity }) {
  const lockedVersion = JSON.parse(readFileSync(path.join(dir, "package-lock.json"), "utf8")).packages["node_modules/typescript"].version;
  mkdirSync(path.join(dir, "node_modules", "typescript"), { recursive: true });
  writeFileSync(path.join(dir, "node_modules", "typescript", "package.json"), JSON.stringify({ name: "typescript", version: version ?? lockedVersion }));
  writeFileSync(path.join(dir, "node_modules", ".package-lock.json"), JSON.stringify({ packages: { "node_modules/typescript": { version: version ?? lockedVersion, integrity } } }));
}

test("the committed manifest equals the one computed from the tree, byte for byte", () => {
  const committed = readFileSync(path.join(PKG, "build-manifest.json"), "utf8");
  assert.equal(committed, serialiseManifest(computeManifest(PKG)));
});

test("the manifest is deterministic: sorted keys, LF, one trailing newline, no timestamps or absolute paths", () => {
  const text = readFileSync(path.join(PKG, "build-manifest.json"), "utf8");
  assert.ok(text.endsWith("}\n") && !text.endsWith("\n\n"));
  assert.ok(!text.includes("\r"));
  assert.ok(!text.includes(PKG) && !/\/Users\/|\/home\/|[A-Za-z]:\\\\/.test(text));
  const manifest = JSON.parse(text);
  assert.deepEqual(Object.keys(manifest), ["schema", "compiler", "config", "lock", "inputs", "outputs", "output_digest"]);
  for (const map of [manifest.lock, manifest.inputs, manifest.outputs]) {
    assert.deepEqual(Object.keys(map), Object.keys(map).sort());
  }
  assert.deepEqual(Object.keys(manifest.config), ["tsconfig.json"]);
  assert.deepEqual(Object.keys(manifest.lock), ["package-lock.json", "package.json"]);
});

test("the manifest compiler matches package-lock.json and the build script chains the writer", () => {
  const lock = JSON.parse(readFileSync(path.join(PKG, "package-lock.json"), "utf8")).packages["node_modules/typescript"];
  const manifest = JSON.parse(readFileSync(path.join(PKG, "build-manifest.json"), "utf8"));
  assert.deepEqual(manifest.compiler, { name: "typescript", version: lock.version, integrity: lock.integrity });
  const pkg = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8"));
  assert.equal(pkg.scripts.build, "tsc -p tsconfig.json && node scripts/build-manifest.js write");
  assert.equal(pkg.dependencies, undefined);
});

test("inputs are the tsconfig include entries and outputs are their .js siblings", () => {
  const include = JSON.parse(readFileSync(path.join(PKG, "tsconfig.json"), "utf8")).include;
  const manifest = computeManifest(PKG);
  assert.deepEqual(Object.keys(manifest.inputs), [...include].sort());
  assert.deepEqual(Object.keys(manifest.outputs), include.map((f) => f.replace(/\.ts$/, ".js")).sort());
});

test("one changed byte in a committed .js makes outputs and output_digest differ, and check exits 1 naming them", () => {
  const dir = copyPackage();
  assert.equal(run(dir, "check").status, 0);
  writeFileSync(path.join(dir, "bin", "lib", "result.js"), `${readFileSync(path.join(dir, "bin", "lib", "result.js"), "utf8")} `);
  const committed = JSON.parse(readFileSync(path.join(dir, "build-manifest.json"), "utf8"));
  const computed = computeManifest(dir);
  assert.notDeepEqual(computed.outputs, committed.outputs);
  assert.notEqual(computed.output_digest, committed.output_digest);
  assert.deepEqual(computed.inputs, committed.inputs);
  const r = run(dir, "check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /output_digest, outputs/);
});

test("a missing emit makes computeManifest throw naming the file", () => {
  const dir = copyPackage();
  rmSync(path.join(dir, "bin", "lib", "ids.js"));
  assert.throws(() => computeManifest(dir), /missing emit bin\/lib\/ids\.js for bin\/lib\/ids\.ts/);
});

test("a bin/lib .ts absent from include makes computeManifest throw naming the path", () => {
  for (const rel of ["extra.ts", "sub/extra.ts"]) {
    const dir = copyPackage();
    mkdirSync(path.dirname(path.join(dir, "bin", "lib", rel)), { recursive: true });
    writeFileSync(path.join(dir, "bin", "lib", rel), "export {};\n");
    assert.throws(() => computeManifest(dir), { message: `bin/lib/${rel} is not in tsconfig include; add it so it is checked and recorded` });
  }
});

test("an include with no literal .ts entry, or a non-.ts entry, is refused", () => {
  const none = copyPackage();
  writeFileSync(path.join(none, "tsconfig.json"), JSON.stringify({ include: [] }));
  assert.throws(() => computeManifest(none), /no literal \.ts entries/);
  const mixed = copyPackage();
  const cfg = JSON.parse(readFileSync(path.join(mixed, "tsconfig.json"), "utf8"));
  writeFileSync(path.join(mixed, "tsconfig.json"), JSON.stringify({ ...cfg, include: [...cfg.include, "bin/lib/**/*"] }));
  assert.throws(() => computeManifest(mixed), /bin\/lib\/\*\*\/\*/);
});

test("write exits 1 and writes nothing when typescript is not installed", () => {
  const dir = copyPackage();
  rmSync(path.join(dir, "build-manifest.json"));
  assert.equal(installedCompilerVersion(dir), null);
  const r = run(dir, "write");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /typescript is not installed; run npm ci/);
  assert.equal(existsSync(path.join(dir, "build-manifest.json")), false);
});

test("write exits 1 and writes nothing when the installed version differs from the lockfile", () => {
  const dir = copyPackage();
  rmSync(path.join(dir, "build-manifest.json"));
  const integrity = computeManifest(dir).compiler.integrity;
  plantInstalledTypescript(dir, { version: "0.0.1", integrity });
  const r = run(dir, "write");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /installed typescript 0\.0\.1 does not match package-lock\.json/);
  assert.equal(existsSync(path.join(dir, "build-manifest.json")), false);
});

test("write exits 1 and writes nothing when the installed integrity differs from the lockfile", () => {
  const dir = copyPackage();
  rmSync(path.join(dir, "build-manifest.json"));
  plantInstalledTypescript(dir, { integrity: "sha512-not-the-locked-integrity" });
  const r = run(dir, "write");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /installed typescript integrity does not match package-lock\.json/);
  assert.equal(existsSync(path.join(dir, "build-manifest.json")), false);
});

test("write succeeds when the installed compiler matches the lockfile, and reproduces the committed manifest", () => {
  const dir = copyPackage();
  const committed = readFileSync(path.join(dir, "build-manifest.json"), "utf8");
  rmSync(path.join(dir, "build-manifest.json"));
  plantInstalledTypescript(dir, { integrity: computeManifest(dir).compiler.integrity });
  assert.equal(run(dir, "write").status, 0);
  assert.equal(readFileSync(path.join(dir, "build-manifest.json"), "utf8"), committed);
});

test("an unknown mode exits 2 with a usage line", () => {
  const r = run(copyPackage(), "bogus");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});
