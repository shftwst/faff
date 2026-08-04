// FAFF-667 — `faff config set` is the general scalar-leaf writer for the whole config schema.
// `config init` only ever covered the 7 flat tracking.* keys; every behaviour key (backends.*,
// models.*, slots.*, appetite, ...) had NO sanctioned write path at all. This exercises the new
// `set` verb through the REAL CLI on the filesystem (the whole write path — cmdConfigSet →
// mergeConfigPath/emitChainBlock → the round-trip guard → fs.writeFileSync), plus the two drift
// guards the ticket asked for: usage-string/dispatcher agreement, and the schema/carve-out
// coverage assertion. configSetSelftest (pure-helper unit coverage, incl. all three carve-out
// representations) runs via `faff config set --selftest`, asserted at the bottom of this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const CONFIG_LIB = join(HERE, "..", "plugin", "skills", "faff", "bin", "lib", "config.js");
const EXAMPLE_YAML = join(HERE, "..", ".faffrc.example.yaml");

function run(cwd, ...args) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString() };
  }
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "faff667-"));
}

// ---------------------------------------------------------------------------
// The FAFF-665 end-to-end case: a nested backends.<name>.<field> write, from nothing.
// ---------------------------------------------------------------------------

test("config set: backends.cx.provider then backends.cx.model produces a nested, unflattened map", () => {
  const dir = tmpDir();
  assert.equal(run(dir, "config", "set", "backends.cx.provider", "codex").code, 0);
  assert.equal(run(dir, "config", "set", "backends.cx.model", "o4-mini").code, 0);
  assert.equal(run(dir, "config", "get", "backends.cx.provider").out, "codex");
  const dump = JSON.parse(run(dir, "config", "get", "backends", "--json").out);
  assert.deepEqual(dump, { cx: { provider: "codex", model: "o4-mini" } });
});

test("config set: a write into an existing file leaves other blocks + comments byte-intact", () => {
  const dir = tmpDir();
  writeFileSync(join(dir, ".faffrc.yaml"),
    "slots:\n  spec: gstack:autoplan  # custom\nappetite: full\n");
  assert.equal(run(dir, "config", "set", "models.build", "sonnet").code, 0);
  const text = readFileSync(join(dir, ".faffrc.yaml"), "utf8");
  assert.match(text, /slots:\n {2}spec: gstack:autoplan {2}# custom/);
  assert.match(text, /appetite: full/);
  assert.equal(run(dir, "config", "get", "models.build").out, "sonnet");
});

// ---------------------------------------------------------------------------
// Usage / dispatcher agreement — the drift guard the ticket asks for.
// ---------------------------------------------------------------------------

test("config (no subcommand) and config bogus print an identical verb list, matching the dispatcher", () => {
  const dir = tmpDir();
  const bare = run(dir, "config");
  const bogus = run(dir, "config", "bogus");
  assert.equal(bare.code, 2);
  assert.equal(bogus.code, 2);
  const verbsOf = (s) => {
    const m = s.match(/(?:usage: faff config <|expected one of )([a-z|-]+)/);
    assert.ok(m, `no verb list found in: ${s}`);
    return m[1].split("|").sort();
  };
  const v1 = verbsOf(bare.err);
  const v2 = verbsOf(bogus.err);
  assert.deepEqual(v1, v2);
  assert.ok(v1.includes("set"), "verb list must include 'set'");
  // Every listed verb must actually dispatch — none falls through to "expected one of".
  for (const verb of v1) {
    if (verb === "get" || verb === "set") continue; // require extra positionals; exercised elsewhere
    const r = run(dir, "config", verb);
    assert.ok(!/expected one of/.test(r.err), `verb '${verb}' is listed but did not dispatch`);
  }
});

// ---------------------------------------------------------------------------
// Every top-level key documented in .faffrc.example.yaml is writable or in the carve-out.
// ---------------------------------------------------------------------------

test("schema coverage: every .faffrc.example.yaml top-level key is a writable namespace", async () => {
  const { WRITABLE_NAMESPACES } = await import(CONFIG_LIB);
  const { parseYamlSubset } = await import(join(HERE, "..", "plugin", "skills", "faff", "bin", "lib", "shared-infra.js"));
  const exampleText = readFileSync(EXAMPLE_YAML, "utf8");
  const topKeys = Object.keys(parseYamlSubset(exampleText));
  assert.ok(topKeys.length > 0, "sanity: example file must parse to a non-empty top-level map");
  for (const key of topKeys) {
    assert.ok(WRITABLE_NAMESPACES.has(key), `'${key}' is documented in .faffrc.example.yaml but not writable`);
  }
});

// ---------------------------------------------------------------------------
// Holdout: the array-valued carve-out refuses by key identity, in all three representations,
// leaving the file byte-for-byte unchanged — even with --force.
// ---------------------------------------------------------------------------

test("holdout: refuses a block-sequence carve-out key, file byte-unchanged", () => {
  const dir = tmpDir();
  const before = "faffter_dark:\n  adversarial:\n    refs:\n      - nvidia-glm\n      - studio-ollama\n";
  writeFileSync(join(dir, ".faffrc.yaml"), before);
  const r = run(dir, "config", "set", "faffter_dark.adversarial.refs", "foo");
  assert.equal(r.code, 2);
  assert.match(r.err, /list-valued key/);
  assert.equal(readFileSync(join(dir, ".faffrc.yaml"), "utf8"), before);
});

test("holdout: refuses the documented JSON-string fallbacks form, even with --force, file byte-unchanged", () => {
  const dir = tmpDir();
  const before = 'faffter_dark:\n  adversarial:\n    fallbacks: \'[{"provider":"ollama","model":"qwen3-next:80b","host":"http://studio:11434"}]\'\n';
  writeFileSync(join(dir, ".faffrc.yaml"), before);
  const r = run(dir, "config", "set", "faffter_dark.adversarial.fallbacks", "foo", "--force");
  assert.equal(r.code, 2);
  assert.match(r.err, /list-valued key/);
  assert.equal(readFileSync(join(dir, ".faffrc.yaml"), "utf8"), before, "the fallback chain must NOT be flattened to a scalar");
});

test("holdout: refuses the inline-flow refs form, even with --force, file byte-unchanged", () => {
  const dir = tmpDir();
  const before = "faffter_dark:\n  adversarial:\n    refs: [nvidia-glm, studio-ollama]\n";
  writeFileSync(join(dir, ".faffrc.yaml"), before);
  const r = run(dir, "config", "set", "faffter_dark.adversarial.refs", "foo", "--force");
  assert.equal(r.code, 2);
  assert.match(r.err, /list-valued key/);
  assert.equal(readFileSync(join(dir, ".faffrc.yaml"), "utf8"), before);
});

// ---------------------------------------------------------------------------
// Vocabulary / validation, --dry-run, conflicts, idempotence, namespace typo guard.
// ---------------------------------------------------------------------------

test("config set on models.* runs the same validator config get runs, refuses off-vocab before writing", () => {
  const dir = tmpDir();
  const before = run(dir, "config", "get", "models.build").out; // baked default, file absent
  const r = run(dir, "config", "set", "models.build", "gpt-5");
  assert.equal(r.code, 2);
  assert.match(r.err, /invalid model token/);
  // still no file written
  assert.equal(run(dir, "config", "path").code, 3);
  assert.equal(run(dir, "config", "get", "models.build").out, before);
});

test("config set --dry-run prints the would-be text and writes nothing", () => {
  const dir = tmpDir();
  const r = run(dir, "config", "set", "models.build", "sonnet", "--dry-run");
  assert.equal(r.code, 0);
  assert.match(r.out, /models:\n {2}build: sonnet/);
  assert.equal(run(dir, "config", "path").code, 3, "dry-run must not create the file");
});

test("config set: conflict without --force refuses; --force overwrites in place", () => {
  const dir = tmpDir();
  writeFileSync(join(dir, ".faffrc.yaml"), "appetite: high\nlogging: full\n");
  const refused = run(dir, "config", "set", "appetite", "low");
  assert.equal(refused.code, 2);
  assert.match(refused.err, /refusing to overwrite/);
  assert.equal(run(dir, "config", "get", "appetite").out, "high");
  const forced = run(dir, "config", "set", "appetite", "low", "--force");
  assert.equal(forced.code, 0);
  assert.equal(run(dir, "config", "get", "appetite").out, "low");
  assert.match(readFileSync(join(dir, ".faffrc.yaml"), "utf8"), /logging: full/);
});

test("config set: an identical value is idempotent (exit 0, no write)", () => {
  const dir = tmpDir();
  writeFileSync(join(dir, ".faffrc.yaml"), "appetite: high\n");
  const before = readFileSync(join(dir, ".faffrc.yaml"), "utf8");
  const r = run(dir, "config", "set", "appetite", "high");
  assert.equal(r.code, 0);
  assert.match(r.out, /no change/);
  assert.equal(readFileSync(join(dir, ".faffrc.yaml"), "utf8"), before);
});

test("config set: refuses a dotted key whose first segment is not a writable namespace", () => {
  const dir = tmpDir();
  const r = run(dir, "config", "set", "bogus.foo", "bar");
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown config namespace 'bogus'/);
});

test("config set: creates .faffrc.yaml with the header when absent", () => {
  const dir = tmpDir();
  assert.equal(run(dir, "config", "path").code, 3);
  const r = run(dir, "config", "set", "appetite", "high");
  assert.equal(r.code, 0);
  const text = readFileSync(join(dir, ".faffrc.yaml"), "utf8");
  assert.match(text, /^# \.faffrc\.yaml/);
  assert.equal(run(dir, "config", "get", "appetite").out, "high");
});

// ---------------------------------------------------------------------------
// The writer's pure-helper self-test (mirrors configInitSelftest, run via the CLI).
// ---------------------------------------------------------------------------

test("config set --selftest passes (writer pure-helper + carve-out + drift table)", () => {
  const dir = tmpDir();
  const r = run(dir, "config", "set", "--selftest");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /RESULT: PASS/);
});
