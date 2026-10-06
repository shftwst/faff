#!/usr/bin/env node
// Deterministic build manifest for the TypeScript closure: binds the compiler identity, the
// configuration and the source digests to the digests of the committed .js emit.
//   write  - refuse unless the installed typescript matches package-lock.json, then write the manifest
//   check  - exit 1 naming each manifest key that differs from the committed file
// The working directory is the package directory (npm sets it for `npm run build`).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_FILE = "build-manifest.json";
const LIB_DIR = "bin/lib";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sortedObject(entries) {
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function tsFilesUnder(root, relDir) {
  const found = [];
  for (const dirent of fs.readdirSync(path.join(root, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${dirent.name}`;
    if (dirent.isDirectory()) found.push(...tsFilesUnder(root, rel));
    else if (dirent.name.endsWith(".ts")) found.push(rel);
  }
  return found;
}

function includedSources(pkgDir) {
  const include = readJson(path.join(pkgDir, "tsconfig.json")).include || [];
  const entries = include.filter((entry) => typeof entry === "string" && entry.endsWith(".ts"));
  if (entries.length === 0) throw new Error("tsconfig include has no literal .ts entries");
  const other = include.find((entry) => !entries.includes(entry));
  if (other !== undefined) throw new Error(`tsconfig include entry ${JSON.stringify(other)} is not a literal .ts path`);
  for (const file of tsFilesUnder(pkgDir, LIB_DIR)) {
    if (!entries.includes(file)) throw new Error(`${file} is not in tsconfig include; add it so it is checked and recorded`);
  }
  return entries;
}

function lockedCompiler(pkgDir) {
  const entry = readJson(path.join(pkgDir, "package-lock.json")).packages?.["node_modules/typescript"];
  if (!entry || typeof entry.version !== "string" || typeof entry.integrity !== "string") {
    throw new Error("package-lock.json has no typescript entry");
  }
  return { name: "typescript", version: entry.version, integrity: entry.integrity };
}

function computeManifest(pkgDir) {
  const entries = includedSources(pkgDir);
  const compiler = lockedCompiler(pkgDir);
  const inputs = {};
  const outputs = {};
  for (const entry of entries) {
    inputs[entry] = sha256(path.join(pkgDir, entry));
    const js = entry.replace(/\.ts$/, ".js");
    if (!fs.existsSync(path.join(pkgDir, js))) throw new Error(`missing emit ${js} for ${entry}; run npm run build`);
    outputs[js] = sha256(path.join(pkgDir, js));
  }
  const sortedOutputs = sortedObject(outputs);
  const outputDigest = crypto
    .createHash("sha256")
    .update(Object.entries(sortedOutputs).map(([file, digest]) => `${file}\t${digest}\n`).join(""), "utf8")
    .digest("hex");
  return {
    schema: 1,
    compiler,
    config: { "tsconfig.json": sha256(path.join(pkgDir, "tsconfig.json")) },
    lock: sortedObject({
      "package-lock.json": sha256(path.join(pkgDir, "package-lock.json")),
      "package.json": sha256(path.join(pkgDir, "package.json")),
    }),
    inputs: sortedObject(inputs),
    outputs: sortedOutputs,
    output_digest: outputDigest,
  };
}

function serialiseManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function installedCompilerVersion(pkgDir) {
  try {
    const version = readJson(path.join(pkgDir, "node_modules", "typescript", "package.json")).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

function installedCompilerIntegrity(pkgDir) {
  try {
    const entry = readJson(path.join(pkgDir, "node_modules", ".package-lock.json")).packages?.["node_modules/typescript"];
    return entry && typeof entry.integrity === "string" ? entry.integrity : null;
  } catch {
    return null;
  }
}

function fail(message) {
  process.stderr.write(`build-manifest: ${message}\n`);
  return 1;
}

function writeMode(pkgDir) {
  const installed = installedCompilerVersion(pkgDir);
  if (installed === null) return fail("typescript is not installed; run npm ci");
  let manifest;
  try {
    manifest = computeManifest(pkgDir);
  } catch (error) {
    return fail(error.message);
  }
  if (installed !== manifest.compiler.version) {
    return fail(`installed typescript ${installed} does not match package-lock.json ${manifest.compiler.version}; run npm ci`);
  }
  if (installedCompilerIntegrity(pkgDir) !== manifest.compiler.integrity) {
    return fail("installed typescript integrity does not match package-lock.json; run npm ci");
  }
  fs.writeFileSync(path.join(pkgDir, MANIFEST_FILE), serialiseManifest(manifest));
  return 0;
}

function differingKeys(committed, computed) {
  const keys = new Set([...Object.keys(committed), ...Object.keys(computed)]);
  return [...keys].filter((key) => JSON.stringify(committed[key]) !== JSON.stringify(computed[key])).sort();
}

function checkMode(pkgDir) {
  let computed;
  try {
    computed = computeManifest(pkgDir);
  } catch (error) {
    return fail(error.message);
  }
  let committedText;
  try {
    committedText = fs.readFileSync(path.join(pkgDir, MANIFEST_FILE), "utf8");
  } catch {
    return fail(`no committed ${MANIFEST_FILE}; run npm run build and commit it`);
  }
  if (committedText === serialiseManifest(computed)) return 0;
  let keys;
  try {
    keys = differingKeys(JSON.parse(committedText), computed);
  } catch {
    keys = ["(unparseable)"];
  }
  return fail(`${MANIFEST_FILE} is stale; differing keys: ${keys.join(", ") || "(formatting only)"}`);
}

function main(argv) {
  const mode = argv[0];
  if (mode === "write") return writeMode(process.cwd());
  if (mode === "check") return checkMode(process.cwd());
  process.stderr.write("usage: node scripts/build-manifest.js <write|check>\n");
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { computeManifest, serialiseManifest, installedCompilerVersion };
