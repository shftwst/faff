import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildLensRequests } from "../plugin/skills/faffter-dark-spec-review/build-lens-requests.mjs";

const skills = fileURLToPath(new URL("../plugin/skills", import.meta.url));
const faff = join(skills, "faff/bin/faff");
const systemDir = join(skills, "faffter-dark-spec-review");
const first = { provider: "openai", model: "first", host: "https://a.invalid/v1", api_key_env: "FIRST_KEY" };
const second = { provider: "nvidia", model: "second", host: "https://b.invalid/v1" };
const config = [
  "adversarial:",
  "  backends:",
  "    - provider: openai",
  "      model: first",
  "      host: https://a.invalid/v1",
  "      api_key_env: FIRST_KEY",
  "    - provider: nvidia",
  "      model: second",
  "      host: https://b.invalid/v1",
].join("\n") + "\n";

function fixture(t, text = config) {
  const root = mkdtempSync(join(tmpdir(), "faff-spec-review-requests-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "review scratch");
  const spec = join(root, "draft spec.md");
  mkdirSync(dir);
  writeFileSync(spec, "# Fixture spec\n");
  writeFileSync(join(root, ".faffrc.yaml"), text);
  const cli = (...args) => spawnSync(process.execPath, [faff, ...args, "--root", root], {
    cwd: root, encoding: "utf8", env: { ...process.env, TMPDIR: root, FIRST_KEY: "fixture-secret-value" },
  });
  return { root, dir, spec, cli, prepare: (...args) => cli("spec-review", "prepare-requests", "--dir", dir, "--spec", spec, ...args) };
}

function readReady(result) {
  assert.equal(result.status, 0, result.stderr);
  const prepared = JSON.parse(result.stdout);
  return {
    ...prepared,
    requests: readFileSync(prepared.requests_path, "utf8"),
    backends: readFileSync(prepared.backends_path, "utf8"),
  };
}

test("prepare-requests preserves the legacy request bytes and default full lens order", (t) => {
  const f = fixture(t);
  const contextPaths = [join(f.root, "src", "with spaces.mjs"), "relative file.md"];
  const scope = join(f.dir, "ratified-scope.md");
  writeFileSync(scope, "## Ratified scope\n");
  const result = readReady(f.prepare("--context", contextPaths[0], "--context", contextPaths[1]));
  const old = f.cli("spec-review-pin", "--resolve", "--dir", f.dir, "--consumer", "spec_review");
  assert.equal(old.status, 0, old.stderr);
  assert.equal(result.backends, old.stdout);
  assert.doesNotMatch(result.backends, /fixture-secret-value/);
  assert.equal(result.strategy, "prime-then-parallel");
  assert.equal(result.round, 1);
  assert.equal(result.requests, JSON.stringify(buildLensRequests({
    lenses: ["architectural", "infosec", "methodology", "QA"],
    backendsJson: result.backends_path, timeout: "120", maxTokens: "2000", deadline: "900",
    systemDir, diffPath: f.spec, contextPaths: [...contextPaths, scope], rawDir: join(f.dir, "raw"), round: 1,
  })) + "\n");
  assert.equal(statSync(dirname(result.backends_path)).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(f.dir), ["ratified-scope.md"]);
});

test("FAFF-746/706 spec-review command contract supplies non-empty system, diff, and context paths", (t) => {
  const f = fixture(t);
  const named = [join(f.root, "named file.mjs"), "relative context.md"];
  const scope = join(f.dir, "ratified-scope.md");
  writeFileSync(named[0], "export const fixture = true;\n");
  writeFileSync(join(f.root, named[1]), "# Named context\n");
  writeFileSync(scope, "# Ratified scope\n");
  const ready = readReady(f.prepare(...named.flatMap(file => ["--context", file])));
  const requests = JSON.parse(ready.requests);
  assert.deepEqual(requests.map(({ lens }) => lens), ["architectural", "infosec", "methodology", "QA"]);
  for (const { lens, argv } of requests) {
    const values = flag => argv.filter((_, index) => argv[index - 1] === flag);
    const system = join(systemDir, `refute-${lens.toLowerCase()}.md`);
    assert.deepEqual(values("--system"), [system]);
    assert.deepEqual(values("--diff"), [f.spec]);
    // Exact context checks enforce FAFF-882's gateway exclusion and preserve named file order.
    assert.deepEqual(values("--context"), [...named, scope]);
    for (const file of [system, f.spec, ...named, scope]) {
      assert.ok(readFileSync(resolve(f.root, file), "utf8").trim(), file);
    }
  }
});

test("prepare-requests uses the pinned chain, exact retry subset, unchanged round and matching raw paths", (t) => {
  const f = fixture(t, config + [
    "  timeout: 45",
    "  max_tokens: 2500",
    "  deadline: 30",
    "  dispatch_strategy: parallel",
    "  spec_review:",
    "    timeout: 75",
    "    max_tokens: 2600",
    "    dispatch_strategy: serial",
  ].join("\n") + "\n");
  writeFileSync(join(f.dir, "pinned-reviewer.json"), JSON.stringify(second));
  writeFileSync(join(f.dir, "round-2.json"), "{}");
  writeFileSync(join(f.dir, "round-3-QA.retry-1.md"), "retained earlier attempt");
  for (const reply of [f.prepare("--lenses", "QA,architectural"), f.prepare("--lenses", "QA,architectural")]) {
    const ready = readReady(reply);
    assert.equal(ready.round, 3);
    assert.equal(ready.strategy, "serial");
    assert.deepEqual(JSON.parse(ready.backends), [second, first]);
    assert.equal(ready.requests, JSON.stringify(buildLensRequests({
      lenses: ["QA", "architectural"], backendsJson: ready.backends_path, timeout: "75", maxTokens: "2600",
      deadline: "30", systemDir, diffPath: f.spec, contextPaths: [], rawDir: join(f.dir, "raw"), round: 3,
    })) + "\n");
    assert.match(reply.stderr, /WARNING: adversarial\.spec_review\.deadline \(30s\) is below the 60s sanity floor/);
  }
  assert.equal(readFileSync(join(f.dir, "round-3-QA.retry-1.md"), "utf8"), "retained earlier attempt");
});

test("prepare-requests preserves empty, invalid and absent setting fallbacks", (t) => {
  const f = fixture(t, config + [
    "  timeout: 45",
    "  max_tokens: 2500",
    "  deadline: 60",
    "  dispatch_strategy: parallel",
    "  spec_review:",
    '    timeout: ""',
    "    max_tokens: false",
    '    deadline: ""',
  ].join("\n") + "\n");
  const reply = f.prepare("--lenses", "QA");
  const ready = readReady(reply);
  assert.equal(reply.stderr, "");
  assert.equal(ready.strategy, "parallel");
  assert.deepEqual(JSON.parse(ready.requests)[0].argv.slice(2, 8), [
    "--timeout", "45", "--max-tokens", "2000", "--deadline", "900",
  ]);
});

test("prepare-requests preserves unset and broken pin dispositions without creating a request bundle", (t) => {
  const unset = fixture(t, "{}\n");
  const unavailable = unset.prepare();
  assert.equal(unavailable.status, 3, unavailable.stderr);
  assert.deepEqual(JSON.parse(unavailable.stdout), { round: 1 });
  assert.match(unavailable.stderr, /adversarial.*unset/);
  const broken = fixture(t);
  writeFileSync(join(broken.dir, "pinned-reviewer.json"), "{");
  writeFileSync(join(broken.dir, "round-1.json"), "{}");
  const badPin = broken.prepare();
  assert.equal(badPin.status, 2, badPin.stderr);
  assert.deepEqual(JSON.parse(badPin.stdout), { round: 2 });
  assert.match(badPin.stderr, /pinned-reviewer\.json is not valid JSON/);
  assert.ok(!readdirSync(broken.root).some(name => name.startsWith("faff-spec-review-")));
});

test("prepare-requests strikes unpinned flagged backends but keeps the pin and fallback tail", (t) => {
  const f = fixture(t);
  const runs = join(f.root, ".faff", "runs");
  for (let n = 1; n <= 8; n++) {
    const previous = join(runs, "run-20261101-000000-review", `TEST-${n}`, "spec-review");
    mkdirSync(previous, { recursive: true });
    writeFileSync(join(previous, "round-1.json"), '{"verdict":"reject-approach"}');
    writeFileSync(join(previous, "pinned-reviewer.json"), JSON.stringify(first));
  }
  const accepted = join(runs, "run-20261102-000000-shipped");
  mkdirSync(accepted);
  writeFileSync(join(accepted, "run-ledger.json"), '{"outcomes":{"TEST-1":"shipped","TEST-2":"shipped","TEST-3":"pr-open"}}');

  const unpinned = f.prepare();
  const struck = readReady(unpinned);
  assert.deepEqual(JSON.parse(struck.backends), [second]);
  assert.match(unpinned.stderr, /struck 1 candidate-degenerate backend/);
  assert.ok(JSON.parse(struck.requests).every(request => request.argv[1] === struck.backends_path));

  const corrupt = join(accepted, "run-ledger.json");
  writeFileSync(corrupt, "{");
  const unfiltered = f.prepare();
  assert.deepEqual(JSON.parse(readReady(unfiltered).backends), [first, second]);
  assert.match(unfiltered.stderr, /malformed run-ledger\.json/);

  writeFileSync(join(f.dir, "pinned-reviewer.json"), JSON.stringify(second));
  const pinned = f.prepare("--lenses", "QA");
  assert.deepEqual(JSON.parse(readReady(pinned).backends), [second, first]);
  assert.equal(pinned.stderr, "", "a pin skips reputation reads, including the corrupt historical ledger");
});

test("prepare-requests resolves configured per-consumer references in their original order", (t) => {
  const f = fixture(t, [
    "backends:",
    "  primary:",
    "    provider: openai",
    "    model: first",
    "    host: https://a.invalid/v1",
    "    api_key_env: FIRST_KEY",
    "  fallback:",
    "    provider: nvidia",
    "    model: second",
    "    host: https://b.invalid/v1",
    "adversarial:",
    "  refs:",
    "    - primary",
    "  spec_review:",
    "    refs:",
    "      - fallback",
    "      - primary",
  ].join("\n") + "\n");
  const ready = readReady(f.prepare());
  assert.deepEqual(JSON.parse(ready.backends), [second, first]);
  assert.deepEqual(JSON.parse(f.cli("spec-review-pin", "--resolve", "--dir", f.dir, "--consumer", "spec_review").stdout), [second, first]);
});

test("prepare-requests resets invalid numeric settings and honours exact positive floor values", (t) => {
  const f = fixture(t);
  for (const value of ["abc", "0", "00", "-1", "3.5", "", "9223372036854775808"]) {
    writeFileSync(join(f.root, ".faffrc.yaml"), config + [
      "  spec_review:",
      `    deadline: ${JSON.stringify(value)}`,
      `    timeout: ${JSON.stringify(value)}`,
      `    max_tokens: ${JSON.stringify(value)}`,
    ].join("\n") + "\n");
    const reply = f.prepare("--lenses", "QA");
    assert.deepEqual(JSON.parse(readReady(reply).requests)[0].argv.slice(2, 8), [
      "--timeout", "120", "--max-tokens", "2000", "--deadline", "900",
    ], value);
    assert.equal(reply.stderr, "");
  }
  writeFileSync(join(f.root, ".faffrc.yaml"), config + "  timeout: 90\n  deadline: 60\n");
  const reply = f.prepare("--lenses", "QA");
  assert.deepEqual(JSON.parse(readReady(reply).requests)[0].argv.slice(2, 8), [
    "--timeout", "90", "--max-tokens", "2000", "--deadline", "60",
  ]);
  assert.equal(reply.stderr, "");
});
