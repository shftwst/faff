# FAFF-633 — integrity-digest resolves its SHA-256 tool from a fixed absolute candidate list, portable across macOS and Linux

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-633.

Spec for FAFF-633, for the build agent and human reviewers. It makes `faff integrity-digest` (and its `--selftest`) work on stock macOS without weakening the same-uid tool-poisoning mitigation the hardcoded path was there to provide, and re-includes the command in the `validate-macos` CI lane that surfaced the break.

**Base note:** build from an up-to-date `origin/main`. The `validate-macos` lane and its `integrity-digest` exclusion (FAFF-580, merged in #482) exist on `origin/main` but not in every local checkout.

## 1. WHY — Problem and Principles

**Load-bearing model.** The hardcoded `/usr/bin/sha256sum` is two decisions fused into one constant: *which tool* hashes (Linux coreutils' `sha256sum`) and *how it is found* (an absolute, root-owned path — never `PATH`, which a same-uid lane can shadow). Only the first decision breaks macOS. The fix separates them: keep absolute-path-only resolution, but probe a short fixed list of absolute candidates instead of assuming one path — first present wins, fail loud if none.

**Problem.** `integrity-digest` pins `SHA256SUM = "/usr/bin/sha256sum"` (`plugin/skills/faff/bin/lib/integrity-digest.js:22`); macOS ships `/usr/bin/shasum` instead, so the digest-custody bracket fails outright (`sha256sum failed (ENOENT)`) exactly where it is meant to protect. FAFF-580 (ADR-0086) declared the floor as POSIX — macOS and Linux — and its new `validate-macos` lane had to exclude this one command to stay green. This change resolves the hasher portably and removes that exclusion.

**Design principles:**

- **The mitigation is non-negotiable.** Every spawned hasher path is absolute and drawn from a fixed in-code list. A bare tool name handed to `PATH` resolution — including the "resolve from `PATH`" phrasing in the ticket body — reopens the shadowing the FAFF-518 design explicitly closed. The FAFF-580 discovered-scope artifact that spawned this ticket says the same: platform-aware absolute resolution, mitigation preserved.
- **Fail-loud stays fail-loud.** A hash that cannot be computed must never read as `digest-verified`. No candidate present is an error (CLI exit 2), same as today's spawn failure.
- **One resolver.** The house rule from FAFF-518 ("one member-set resolver, never a second hand-written list") applies to the hasher too: the CLI and the orchestrator prose in `faffter-dark-concurrency-parallel/SKILL.md` must not each carry their own tool-picking policy.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/integrity-digest.js` | JS (Node builtin only) | The module under change; `sha256()` at line 26 spawns the constant |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` (line 87) | Prompt prose | Intended-content check pipes to `/usr/bin/sha256sum` — same break on macOS |
| `.github/workflows/validate.yml` (origin/main lines ~277–285) | YAML | `validate-macos` lane's `grep -v 'integrity-digest --selftest'` exclusion + comment to remove |
| `docs/guide/cli.md` | Markdown | One `integrity-digest` row asserting the absolute `/usr/bin/sha256sum`; `lint-cli-doc` gates it |
| `test/integrity-digest.test.mjs` | JS (node:test) | CLI-seam tests; line ~142 uses `node:crypto` as an independent oracle — a property to keep |
| `plugin/skills/faff/bin/lib/events.js` (line 86) | JS | Separate hash chain; uses `node:crypto` in-process — unaffected |

**Scope.** A portability fix inside one CLI module plus the prose, docs, and CI lines that state its old behaviour. No change to manifest format, verify semantics, trust classes, or the custody model.

## 2. OUT OF SCOPE

- **`faff-graft/SKILL.md:356`'s bare `sha256sum`** (`git diff main...HEAD | sha256sum | cut -d' ' -f1`) — a loop-detection convenience hash, not custody evidence, but it also breaks on stock macOS. Excluded: different surface, different (nil) threat model, and a plain portable alternative exists (`git hash-object --stdin`). Extension point: that SKILL line; this is un-ticketed work the pipeline should file a gap issue for.
- **Historical documents naming the old path** — the FAFF-518 spec (`docs/specs/2026-07-16-…`), ADR-0073's illustrative mention, `docs/audits/2026-07-20-l4-capabilities-audit.md`. Excluded: they are records of decisions and findings at a point in time, not living docs. The living doc is `docs/guide/cli.md`, which is updated here.
- **Switching hashing to `node:crypto`** — rejected as a design option (rationale in section 6), so no extension point is promised; if revisited it would be its own decision against the FAFF-518 trail.
- **Windows** — ADR-0086 pins the floor at POSIX; the `win32` entrypoint guard refuses before this code runs.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Candidate | An absolute path plus fixed argv prefix that, given bytes on stdin, prints a SHA-256 digest line |
| Resolved hasher | The first candidate whose binary exists on this host, memoized for the process lifetime |

```
CONSTANT SHA256_CANDIDATES: List<Candidate> = [
  { bin: "/usr/bin/sha256sum", args: [] },        # Linux, coreutils
  { bin: "/bin/sha256sum",     args: [] },        # Linux variants without merged /usr
  { bin: "/usr/bin/shasum",    args: ["-a","256"] } # macOS system tool (also present on most Linux)
]

FUNCTION resolveHasher(candidates = SHA256_CANDIDATES) -> Candidate
  # first candidate whose bin exists; memoized on the default list only;
  # THROWS (fail-loud) when none exists — message names every candidate and the remedy
```

**CLI surface.** The `integrity-digest` action vocabulary grows by one: `snapshot | verify | hash`. `hash` reads stdin to EOF, prints the 64-hex digest and a newline, exit 0; resolver failure is the existing fail-loud exit 2. No new flags. (`cli-surface` classifies `integrity-digest` as `flat` with no declared vocabulary, so no grammar change is needed there.)

**Module exports.** `SHA256SUM` (currently exported, consumed nowhere else — verified by repo grep) is removed. In its place export `SHA256_CANDIDATES` and `resolveHasher` so node:test can exercise the resolver with injected candidates. No other export changes — FAFF-579 just cleaned dead exports; do not add any.

**Docs.** The `docs/guide/cli.md` `integrity-digest` row: replace the "absolute `/usr/bin/sha256sum` (never PATH)" sentence with the candidate-list statement (absolute paths only, probed in order, fail-loud exit 2 when none exists — the same mitigation, now portable), and document the `hash` action. `lint-cli-doc` must stay clean.

## 4. HOW — Behaviour

**Resolution.** `resolveHasher` walks the candidate list in order and returns the first whose `bin` exists on disk (an `lstat`/`existsSync`-class check is sufficient — a present-but-broken binary still hits the existing spawn fail-loud). The result for the default list is memoized once per process; injected candidate lists (tests) are never memoized. Nothing is ever handed to `PATH`: `spawnSync` always receives an absolute `bin`.

**Hashing.** `sha256(bytes)` changes only its first line:

```
PROCEDURE sha256(bytes):
  1. hasher := resolveHasher()                       # throws if no candidate exists
  2. r := spawnSync(hasher.bin, hasher.args, stdin=bytes, env=SANITIZED_ENV)
  3. existing fail-loud checks unchanged: spawn error / non-zero exit / no 64-hex match → throw
```

**Sanitized spawn env (spec-review revision).** `/usr/bin/shasum` is a Perl script, and an inherited environment lets a same-uid actor inject code via `PERL5LIB` / `PERL5OPT` despite the absolute path — a channel the coreutils binary doesn't have. **Chosen:** spawn every hasher with a minimal fixed environment (`{ PATH: "/usr/bin:/bin" }` only — no inherited vars), closing the interpreter-env channel for the script candidate and costing nothing for the binary candidates. This is mitigation-consistent, not mitigation-complete: an actor who controls the process env generally has broader same-uid reach the FAFF-518 mitigation already concedes; the sanitized env just avoids adding a new channel.

Stdin mode is retained deliberately: both tools, given no file operands, read stdin and print `<64-hex>␠␠-`, which the existing parse (`/^([0-9a-f]{64})\b/`) already matches for both. The error messages should name the resolved tool rather than assuming `sha256sum` (e.g. `` `${hasher.bin} failed (…)` ``).

**No-candidate error.** One message, thrown from `resolveHasher`:

```
no SHA-256 tool found (tried /usr/bin/sha256sum, /bin/sha256sum, /usr/bin/shasum) —
install coreutils or ensure the system shasum exists; cannot hash, refusing to report verified
```

It surfaces through the existing `catch` in `cmdIntegrityDigest` as exit 2 — never a silent `verified`. The tried list in the message is derived from the candidate list, not restated by hand.

**`hash` action.** In `cmdIntegrityDigest`, alongside `snapshot`/`verify`: read stdin fully (`fs.readFileSync(0)`), print `sha256(bytes)` + newline, return 0. Update the usage string to `<snapshot|verify|hash>`. Its purpose is the orchestrator's intended-content check: `faffter-dark-concurrency-parallel/SKILL.md:87` changes its snippet from `printf '%s' "$intended" | /usr/bin/sha256sum` to piping into `faff integrity-digest hash` — the SKILL stops carrying its own tool policy and shares the CLI's resolver.

**Selftest.** The assertion at line 267 (`SHA256SUM === "/usr/bin/sha256sum"`) becomes: the resolved hasher's `bin` is absolute AND is a member of `SHA256_CANDIDATES`, and every candidate `bin` in the list is absolute — "never a bare name, never PATH" stays selftest-asserted without pinning a platform. Add one check that `resolveHasher` with an injected list of non-existent paths throws the no-candidate message. The trust-class boundary check (no mount-asserted symbols) is untouched.

**CI.** In `validate.yml`'s `validate-macos` lane: delete the `| grep -v 'integrity-digest --selftest'` line and the six-line exclusion comment beneath the list builder. The lane then re-derives `integrity-digest --selftest` from the ubuntu job automatically (the drift-avoidance the lane was built for); the ≥40 sanity floor is unaffected.

**Tests (`test/integrity-digest.test.mjs`).** Existing tests unchanged — in particular the intended-content oracle (line ~142) keeps its independence: the CLI still hashes via an external binary, `node:crypto` remains a different implementation. Add: resolver order (injected list with two existing paths picks the first), resolver fail-loud (injected all-missing list), and a `hash`-action CLI-seam test asserting its output equals the `node:crypto` digest of the piped bytes.

**Failure modes.**

- **The probe silently weakens the mitigation** — a future edit swaps existence-probing for `PATH` lookup. How you'd know: the selftest's absolute-and-in-list assertion fails. What it means: the change is wrong, not the assertion.
- **macOS stops shipping `/usr/bin/shasum`** (it is a perl script; Apple has deprecated bundled scripting runtimes before). How you'd know: the `validate-macos` lane goes red loudly at the first hash. What it means: extend the candidate list in its one home — no other code moves.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a stock macOS host (no coreutils, /usr/bin/shasum present)
When faff integrity-digest --selftest runs
Then it passes, having hashed via /usr/bin/shasum -a 256
```

```
Given a resolver invoked with an injected candidate list of only non-existent paths
When any hashing action is attempted through the CLI
Then it exits 2 with the no-candidate message naming every tried path, and never prints digest-verified
```

```
Given bytes piped to faff integrity-digest hash
When the command runs on either platform
Then stdout is exactly the 64-hex node:crypto SHA-256 of those bytes plus a newline, exit 0
```

- Every spawned hasher invocation MUST use an absolute path from `SHA256_CANDIDATES`; no bare tool name reaches `spawnSync`.

## 6. Design Decision Rationale

- **How the tool is found: fixed absolute candidate list vs `PATH` vs `node:crypto`.** `PATH` resolution (the ticket body's literal phrasing) is the same-uid shadowing the FAFF-518 design rejected — the ticket's *intent* (works on both platforms, fail loud, dependency-free) is fully met without it, and the discovered-scope artifact this ticket was filed from recommends exactly the absolute route. `node:crypto` would be simpler and spawn-free, but it silently rewrites a shipped decision rather than extending it, and it collapses the test suite's independent oracle (CLI and test would be the same implementation). **Chosen:** probe a fixed in-code list of absolute paths, in order; never `PATH`, and `node:crypto` stays the tests' oracle only.
- **Candidate order.** coreutils first where present (native binary over perl script), `/bin` variant for distros without merged `/usr`, `shasum` last as the macOS floor. **Chosen:** `/usr/bin/sha256sum`, `/bin/sha256sum`, `/usr/bin/shasum -a 256`.
- **Probe mechanic.** A trial-spawn probe would verify the tool works, but the existing spawn fail-loud already catches a broken binary; existence is enough and cheaper. Memoize the default resolution once per process (snapshot hashes many leaves); injected lists un-memoized for testability. **Chosen:** existence-probe, memoized default, injectable for tests.
- **Stdin vs file-operand hashing.** File operands would let the tool do the reading, but the module must read bytes itself anyway (symlink safety, events-prefix subarray), and both tools' stdin output shape already matches the parser. **Chosen:** stdin mode retained unchanged.
- **Where the resolver lives.** A shared helper (the FAFF-580 `homeDir()` shape) suits many consumers; this has one module consumer, and the SKILL prose reaches it through the CLI. **Chosen:** inline in `integrity-digest.js`; the `hash` action is the sharing seam. Extension point: promote to `shared-infra.js` only when a second module consumer exists.
- **The SKILL's intended-content hash.** Duplicating a two-tool fallback in prose would mean two resolution policies drifting. **Chosen:** a `hash` action on the CLI; the SKILL pipes to it.
- **Export surface.** Keeping `SHA256SUM` as a deprecated alias would be a dead export the day after FAFF-579 removed those. **Chosen:** remove it; export `SHA256_CANDIDATES` + `resolveHasher`.
- **At the time of writing** macOS has no `/usr/bin/sha256sum` and ships `/usr/bin/shasum`; revisit the list if either changes (the macOS CI lane is the tripwire).

## 7. Open Questions and Assumptions

**Open questions:** none.

**Assumptions:**

- **Assumes:** `/usr/bin/shasum` exists root-owned on the macOS CI runner and supported operator machines, and prints `<64-hex>  -` for stdin input with `-a 256`. Validation: the `validate-macos` lane runs `integrity-digest --selftest` after the exclusion is removed — a wrong assumption fails that lane loudly.
- **Assumes:** nothing outside `integrity-digest.js` imports `SHA256SUM`. Validation: repo-wide grep before removing the export (it held at spec time).

## 8. DONE — Definition of Done

### From WHY / WHAT
- [ ] `SHA256SUM` constant replaced by `SHA256_CANDIDATES` + `resolveHasher`; the string `/usr/bin/sha256sum` survives only as a candidate-list member (and historical docs), never as a sole pinned hasher
- [ ] Every candidate `bin` is absolute; no bare tool name is ever passed to `spawnSync` — selftest-asserted
- [ ] Every hasher spawn passes the minimal fixed env (no inherited `PERL5LIB`/`PERL5OPT` or other vars) — covered by a test asserting the spawn env, and noted in the cli.md row
- [ ] Exports: `SHA256SUM` removed, `SHA256_CANDIDATES` and `resolveHasher` exported; no other export changes

### From HOW (behaviour)
- [ ] On a host with coreutils, hashing uses `/usr/bin/sha256sum`; on stock macOS, `/usr/bin/shasum -a 256`; digests are byte-identical to `node:crypto` for the same input
- [ ] No candidate present → the no-candidate message (naming every tried path, derived from the list) and CLI exit 2 — never `digest-verified`
- [ ] `hash` action: stdin → 64-hex + newline, exit 0; usage string reads `<snapshot|verify|hash>`
- [ ] `faffter-dark-concurrency-parallel/SKILL.md:87` intended-content snippet pipes to `faff integrity-digest hash`; no `/usr/bin/sha256sum` literal remains in SKILL prose

### From HOW (selftest / CI / docs / tests)
- [ ] Selftest: absolute-and-in-list assertion replaces the old equality; injected-all-missing list throws; `--selftest` passes on macOS (no coreutils) and Linux
- [ ] `validate.yml`: the `grep -v 'integrity-digest --selftest'` line and its comment block removed; `validate-macos` runs the selftest and stays green; ≥40 floor untouched
- [ ] `docs/guide/cli.md`: row updated to the candidate-list statement + `hash` documented; `lint-cli-doc` clean
- [ ] `test/integrity-digest.test.mjs`: resolver-order, resolver-fail-loud, and `hash`-vs-`node:crypto` tests added; existing tests (including the independent-oracle test) pass unmodified

**Integration smoke test:**

```
PROCEDURE smoke():
  1. Build an evidence dir (as the selftest does)
  2. manifest := faff integrity-digest snapshot --run-dir DIR --issue X --events
  3. faff integrity-digest verify --run-dir DIR --manifest - <<< manifest   -> exit 0, digest-verified
  4. printf 'abc' | faff integrity-digest hash                             -> the well-known SHA-256 of "abc"
  # run on both an ubuntu and a macos runner — if this passes, the plumbing is portable
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4):** One module's resolution logic plus the prose, doc, CI, and test lines that state its old behaviour — a coherent 1–3 day unit. The added `hash` CLI action is the one scope extension, and it earns its place: it is the seam that lets `faffter-dark-concurrency-parallel/SKILL.md:87` stop carrying its own tool policy (the FAFF-518 "one resolver" rule), so splitting it out would leave the same macOS break half-fixed. No split or merge recommended.
- **Workstream fit (principles 1 + 5):** The ticket is FAFF-580 discovered scope (labelled `faff-chain-gap-fill`), and the spec delivers exactly that outcome — the POSIX floor ADR-0086 declared, closing the one `validate-macos` exclusion that lane had to carry. Nothing in scope serves a second outcome. Fits.
- **Deps surfaced (principle 6):** The FAFF-580 relation exists and the base note handles the merged-on-main-only `validate-macos` lane. One gap: section 2 references un-ticketed peer work — `faff-graft/SKILL.md:356`'s bare `sha256sum` loop-detection hash, which also breaks on stock macOS. The spec correctly excludes it (different surface, nil threat model) and itself says the pipeline should file a gap issue; that issue does not exist yet. Diagnosis: a spec referencing un-ticketed work leaves the dependency graph dishonest — the macOS break will look fully closed when one surface remains. Recommended action: file the peer gap ticket (portable loop-detection hash in faff-graft, e.g. `git hash-object --stdin`) and relate it to FAFF-633.
- **Risk profile (principle 7):** Low. Both hashers' stdin output shape already matches the existing parser, the `validate-macos` lane is a live tripwire for the load-bearing assumption (`/usr/bin/shasum` present, correct output), and the failure-modes section names how each residual risk would surface. No de-risking spike warranted.

spec-review: approve
