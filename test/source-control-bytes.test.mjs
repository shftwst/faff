// FAFF-626 — guard the class: no source file under the CLI's plugin/skills/faff/bin/ tree
// (the `faff` entrypoint plus everything under lib/, recursively) may contain a raw C0
// control byte (minus tab/LF/CR). A raw NUL byte flips grep's binary-file heuristic and
// silently removes the whole module from plain-text search (see effects.js:64's fix).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SCAN_ROOT = join(REPO, "plugin", "skills", "faff", "bin");

// Forbidden: the C0 control range minus legitimate whitespace (tab 0x09, LF 0x0A, CR 0x0D).
function isForbiddenByte(byte) {
  if (byte === 0x09 || byte === 0x0a || byte === 0x0d) return false;
  return (byte >= 0x00 && byte <= 0x1f) && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d;
}

// Pure helper: scan a buffer for forbidden control bytes. Returns [{offset, byte}].
function findControlBytes(buffer) {
  const findings = [];
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (isForbiddenByte(byte)) findings.push({ offset: i, byte });
  }
  return findings;
}

// Every regular file under root, recursively. No extension filter — the `faff` entrypoint has none.
function listFilesRecursive(root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test("no source file under plugin/skills/faff/bin/ contains a raw control byte", () => {
  const files = listFilesRecursive(SCAN_ROOT);
  assert.ok(files.length > 0, `expected to find files under ${SCAN_ROOT}`);

  const failures = [];
  for (const file of files) {
    const buffer = readFileSync(file);
    for (const { offset, byte } of findControlBytes(buffer)) {
      failures.push(`${file}: raw control byte 0x${byte.toString(16).padStart(2, "0")} at offset ${offset}`);
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
});

test("an empty file passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-controlbytes-"));
  const file = join(dir, "empty.js");
  writeFileSync(file, "");
  try {
    const findings = findControlBytes(readFileSync(file));
    assert.deepEqual(findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the scanner catches a synthetic planted-NUL byte (guard's own smoke test)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-controlbytes-"));
  const file = join(dir, "planted.js");
  const contents = Buffer.from("const k = `${a}\0${b}`;\n", "binary");
  writeFileSync(file, contents);
  try {
    const findings = findControlBytes(readFileSync(file));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].byte, 0x00);
    assert.equal(findings[0].offset, contents.indexOf(0x00));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the scanner catches other C0 control bytes, not just NUL", () => {
  const findings = findControlBytes(Buffer.from([0x41, 0x01, 0x42, 0x1f, 0x43]));
  assert.deepEqual(findings.map((f) => f.byte), [0x01, 0x1f]);
});

test("tab, LF, and CR are allowed (ordinary whitespace, not flagged)", () => {
  const findings = findControlBytes(Buffer.from("a\tb\nc\rd", "binary"));
  assert.deepEqual(findings, []);
});
