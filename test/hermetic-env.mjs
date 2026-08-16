// FAFF-785 — hermetic-env suite-preload.
//
// Loaded via `node --import ./test/hermetic-env.mjs --test` before any test file. It makes the
// process environment look like a clean CI checkout with respect to faff, so that a `node --test`
// run on a self-hosting checkout (a live faff repo whose operator shell exports FAFF_*/CLAUDE_*
// variables) matches the clean-CI result — same code in, same result out.
//
// The dominant leak vector is one seam: child processes spawned by test helpers inherit the
// parent's environment (test/helpers/run-cli.mjs spawns with `env: opts.env ?? process.env`, and
// several per-file helpers spawn with `{ ...process.env, ... }`). Rather than editing dozens of
// spawn sites, scrub the parent process.env ONCE here; because this module is loaded via
// `--import`, the mutation runs in the parent test-runner process (and, via execArgv forwarding,
// each per-file test child), so every spawnSync/execFileSync child — and the CLI grandchildren
// they spawn — inherits the already-scrubbed environment.
//
// Scope is the two faff-owned prefixes (/^FAFF_/, /^CLAUDE_/) minus a single-key EXEMPT set. It
// deletes nothing else: PATH, HOME, TMPDIR and NODE_V8_COVERAGE (the FAFF-581 coverage passthrough)
// all survive, so children still run and CI coverage capture keeps working. See FAFF-785 §4.
//
// Prefix-match rather than a frozen name list: the invariant is "faff-owned env is not test input",
// so the next FAFF_* variable added anywhere is covered by construction.

// FAFF_REQUIRE_DOCKER is exempt: .github/workflows/validate.yml sets it so docker-gated cases FAIL
// LOUD rather than silently skip (FAFF-274). Scrubbing it in-process would re-open exactly the
// silent-skip hole that guarantee closed. It is CI test-orchestration, not a faff-runtime-behaviour
// input — the only key that qualifies today.
const EXEMPT = new Set(["FAFF_REQUIRE_DOCKER"]);

for (const key of Object.keys(process.env)) {
  if ((/^FAFF_/.test(key) || /^CLAUDE_/.test(key)) && !EXEMPT.has(key)) {
    delete process.env[key];
  }
}
