// === region:factory — review-fixture-paths — the directory prefixes whose files are test data, not shipped code ===
// Code review reads this list to treat fixture contents as data (references/review.md → Fixture data in
// review) and review-call.mjs caps a critical located only in these paths. `review.fixture_paths` replaces
// the default list; the review resolves it from the review BASE ref so the PR under review can never widen
// its own list. review-call.mjs is standalone ESM with no faff imports and carries a mirror of isFixturePath
// (pinned by test/review-fixture-paths.test.mjs) — keep the two in sync.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadConfig } = require("./config");
const { parseArgs, usageError } = require("./argv");
const { CANONICAL_CONFIG, DEPRECATED_CONFIG, LEGACY_CONFIG, dig, findRoot, parseConfigMapStrict, selectNamed } = require("./shared-infra");

const DEFAULT_FIXTURE_PATHS = Object.freeze(["fixtures/", "__fixtures__/", "testdata/"]);

function normalisePrefix(entry) {
  const trimmed = entry.trim().replace(/^(\.\/|\/)+/, "");
  if (trimmed === "") return null;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

// resolveFixturePaths(cfg) -> DirPrefix[]
// cfg is an already-parsed config object. Absent key -> defaults; a list replaces the defaults entirely
// (non-string entries ignored); any other present value is malformed and resolves to no paths.
function resolveFixturePaths(cfg) {
  const raw = dig(cfg || {}, "review.fixture_paths");
  if (raw === null || raw === undefined) return [...DEFAULT_FIXTURE_PATHS];
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry) => typeof entry === "string").map(normalisePrefix).filter(Boolean);
}

function isFixturePath(filePath, prefixes) {
  const p = String(filePath).replace(/^(a\/|b\/|\.\/)/, "");
  return (prefixes || []).some((prefix) => p.startsWith(prefix) || p.includes(`/${prefix}`));
}

function git(root, args) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function parseConfigText(text, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-fixture-paths-"));
  const file = path.join(dir, "config.yaml");
  try {
    fs.writeFileSync(file, text);
    return { cfg: parseConfigMapStrict(file, "base-parse-error", "the base config") };
  } catch (e) {
    if (e && e.message === "base-parse-error") {
      return { error: `faff review-fixture-paths: ${label} is malformed (${e.detail})` };
    }
    throw e;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// readConfigAtRef(root, ref) -> { cfg } | { error }
// The committed base config at `ref`, via the same strict YAML reader `faff config` uses. A ref with no
// config file resolves to {} (defaults); a legacy-named config or a malformed one is an error.
function readConfigAtRef(root, ref) {
  if (git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status !== 0) {
    return { error: `faff review-fixture-paths: cannot resolve --ref "${ref}" to a commit` };
  }
  const exists = (name) => git(root, ["cat-file", "-e", `${ref}:${name}`]).status === 0;
  let picked;
  try {
    picked = selectNamed(exists, CANONICAL_CONFIG, DEPRECATED_CONFIG, LEGACY_CONFIG, "legacy-config-name");
  } catch (e) {
    if (e && e.message === "legacy-config-name") {
      return { error: `faff review-fixture-paths: legacy config filename at ${ref} (${e.legacy.join(", ")}); rename to ${CANONICAL_CONFIG}` };
    }
    throw e;
  }
  if (picked === null) return { cfg: {} };
  const shown = git(root, ["show", `${ref}:${picked.name}`]);
  if (shown.status !== 0) return { error: `faff review-fixture-paths: cannot read ${picked.name} at ${ref}` };
  return parseConfigText(shown.stdout, `${picked.name} at ${ref}`);
}

function readWorkingTreeConfig(root) {
  try {
    return { cfg: loadConfig(root)[0] };
  } catch (e) {
    if (e && e.message === "base-parse-error") return { error: `faff review-fixture-paths: ${e.file} is malformed (${e.detail})` };
    if (e && e.message === "legacy-config-name") return { error: `faff review-fixture-paths: legacy config filename (${(e.legacy || []).join(", ")}); rename to ${CANONICAL_CONFIG}` };
    if (e && e.message === "overlay-parse-error") return { error: `faff review-fixture-paths: ${e.file} is malformed (${e.detail})` };
    throw e;
  }
}

const REVIEW_FIXTURE_PATHS_SPEC = { flags: { "--selftest": { arity: 0 }, "--ref": { arity: 1 } } };
const REVIEW_FIXTURE_PATHS_USAGE = "usage: faff review-fixture-paths [--ref <base>]";

function cmdReviewFixturePaths(args, root = findRoot()) {
  if (args.includes("--selftest")) return reviewFixturePathsSelftest();
  const { values, errors } = parseArgs(args, REVIEW_FIXTURE_PATHS_SPEC);
  if (errors.length) return usageError(errors, REVIEW_FIXTURE_PATHS_USAGE);
  const ref = values["--ref"];
  const read = ref === undefined ? readWorkingTreeConfig(root) : readConfigAtRef(root, ref);
  if (read.error) { process.stderr.write(read.error + "\n"); return 2; }
  const configured = dig(read.cfg || {}, "review.fixture_paths");
  if (configured !== null && configured !== undefined && !Array.isArray(configured)) {
    process.stderr.write("faff review-fixture-paths: review.fixture_paths is not a list; no fixture paths apply\n");
  }
  const resolved = resolveFixturePaths(read.cfg);
  if (resolved.length) console.log(resolved.join("\n"));
  return 0;
}

function reviewFixturePathsSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  ok("unset key resolves to the defaults", same(resolveFixturePaths({}), DEFAULT_FIXTURE_PATHS));
  ok("a configured list replaces the defaults", same(resolveFixturePaths({ review: { fixture_paths: ["eval/cases", "./test/fixtures/"] } }), ["eval/cases/", "test/fixtures/"]));
  ok("an empty list turns the feature off", same(resolveFixturePaths({ review: { fixture_paths: [] } }), []));
  ok("non-string entries are ignored", same(resolveFixturePaths({ review: { fixture_paths: ["a/", 7, null, { x: 1 }] } }), ["a/"]));
  ok("a scalar value resolves to no paths", same(resolveFixturePaths({ review: { fixture_paths: "eval/" } }), []));

  ok("matches a nested fixtures dir", isFixturePath("test/fixtures/x.json", DEFAULT_FIXTURE_PATHS));
  ok("matches a top-level fixtures dir", isFixturePath("fixtures/x.json", DEFAULT_FIXTURE_PATHS));
  ok("does not match bridge-fixture.mjs", !isFixturePath("eval/bridge-fixture.mjs", DEFAULT_FIXTURE_PATHS));
  ok("does not match myfixtures/", !isFixturePath("myfixtures/x", DEFAULT_FIXTURE_PATHS));
  ok("sibling directory is not matched", !isFixturePath("eval/cases-live/a.json", ["eval/cases/"]));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "faff-fixture-paths-selftest-"));
  try {
    const run = (...gitArgs) => spawnSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...gitArgs], { encoding: "utf8" });
    run("init", "-q");
    run("commit", "-q", "--allow-empty", "-m", "empty");
    const noFile = readConfigAtRef(root, "HEAD");
    ok("a ref with no config resolves to the defaults", noFile.cfg && same(resolveFixturePaths(noFile.cfg), DEFAULT_FIXTURE_PATHS));
    fs.mkdirSync(path.join(root, ".faff"), { recursive: true });
    fs.writeFileSync(path.join(root, CANONICAL_CONFIG), "review:\n  fixture_paths:\n    - base/data/\n");
    run("add", CANONICAL_CONFIG);
    run("commit", "-q", "-m", "base config");
    fs.writeFileSync(path.join(root, CANONICAL_CONFIG), "review:\n  fixture_paths:\n    - src/\n");
    const atRef = readConfigAtRef(root, "HEAD");
    ok("--ref returns the base ref's list, not the working tree's", atRef.cfg && same(resolveFixturePaths(atRef.cfg), ["base/data/"]));
    ok("without --ref the working tree is read", same(resolveFixturePaths(readWorkingTreeConfig(root).cfg), ["src/"]));
    ok("an unknown ref is an error", Boolean(readConfigAtRef(root, "no-such-ref").error));

    fs.writeFileSync(path.join(root, CANONICAL_CONFIG), "- not\n- a mapping\n");
    run("add", CANONICAL_CONFIG);
    run("commit", "-q", "-m", "malformed config");
    const malformed = readConfigAtRef(root, "HEAD");
    ok("a malformed base config is an error", Boolean(malformed.error) && /malformed/.test(malformed.error));

    const stderrWrite = process.stderr.write.bind(process.stderr);
    let stderr = "";
    process.stderr.write = (chunk) => { stderr += chunk; return true; };
    let code;
    try { code = cmdReviewFixturePaths(["--ref", "HEAD"], root); } finally { process.stderr.write = stderrWrite; }
    ok("a malformed base config exits 2 with the parse error on stderr", code === 2 && /malformed/.test(stderr));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const deprecatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-fixture-paths-deprecated-"));
  try {
    const run = (...gitArgs) => spawnSync("git", ["-C", deprecatedRoot, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...gitArgs], { encoding: "utf8" });
    run("init", "-q");
    fs.writeFileSync(path.join(deprecatedRoot, DEPRECATED_CONFIG[0]), "review:\n  fixture_paths:\n    - old/data/\n");
    run("add", DEPRECATED_CONFIG[0]);
    run("commit", "-q", "-m", "deprecated-tier base config");
    ok("--ref reads a base config on the deprecated root tier", same(resolveFixturePaths(readConfigAtRef(deprecatedRoot, "HEAD").cfg), ["old/data/"]));
  } finally {
    fs.rmSync(deprecatedRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (review-fixture-paths, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  DEFAULT_FIXTURE_PATHS,
  cmdReviewFixturePaths,
  isFixturePath,
  readConfigAtRef,
  resolveFixturePaths,
  reviewFixturePathsSelftest,
};
