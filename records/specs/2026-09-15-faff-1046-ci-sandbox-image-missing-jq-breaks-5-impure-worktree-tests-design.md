# Spec — FAFF-1046: drop the `jq` dependency from `setup-worktree.sh` hook mode

> Spec: faffter-dark-nlspec · 2026-09-15 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1046.

This is the buildable design for FAFF-1046. Audience: the build agent that will implement the fix, and the human reviewers who gate it. It is a high-level design doc — it says what to change, why, and how we will know it is done, not line-by-line code.

## 1. WHY — Problem and Principles

**Load-bearing model.** `setup-worktree.sh` provisions a build worktree and has two front doors that feed one shared body: a **direct mode** (positional args `<name> [<repo-root>]`, used by faff-graft in production per FAFF-595) that never reads stdin and never calls `jq`, and a legacy **hook mode** (zero args) that reads a Claude Code `WorktreeCreate` JSON object off stdin and extracts `.name` / `.cwd`. Today hook mode does that extraction with `jq`. `jq` is the only external dependency the script has beyond the standard toolchain, and it is the only thing that makes any part of the script fail on a `jq`-less host. Remove that one call and the whole script — both modes — runs on the same toolchain the direct mode already guarantees.

**Problem statement.** On any environment without `jq` (the fly.io agent sandbox, and any clean machine where the runner image does not ship `jq`), the hook-mode parse at lines 22-24 aborts with exit 127 under `set -euo pipefail`, so the five hook-mode assertions across `test/impure/setup-worktree-{base,clobber,direct}.test.mjs` fail and `faff gates run` is red on an unmodified tree. This has recurred as gate-ladder noise across FAFF-1035/1038/1042/1044, forcing each build to re-triage the same environmental gap. This change removes the `jq` dependency so hook mode parses the same JSON with the Node runtime the script already relies on, turning all five tests green without touching them.

**Design principles.**

- **Stay dependency-free.** The repo is intentionally dependency-free (CONTRIBUTING.md). The fix must not add a runtime dependency, and it must not paper over the gap by installing `jq` somewhere — it must remove the need for `jq`. Reject any implementation that reintroduces a `jq` code path or makes the tests pass only by provisioning `jq`.
- **Preserve the two-mode contract exactly.** Direct mode is the load-bearing production path (FAFF-595) and must be byte-for-byte unchanged. Hook mode must keep its existing input contract — same accepted JSON shape, same `.name`/`.cwd` semantics, same "empty field means abort with exit 1" behaviour (lines 27-28). Reject any change that alters direct mode or changes what hook mode accepts or rejects.
- **Fail loud on malformed input, exactly as before.** `jq -r` under `set -euo pipefail` aborts the script on unparseable stdin. The replacement must preserve that: bad JSON is a terminal error, not a silent empty-name fall-through beyond the existing guard.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/setup-worktree.sh` (lines 16-25) | Bash | The script under change; the `jq` calls at lines 22-24 are the only `jq` usage in it |
| `test/impure/setup-worktree-base.test.mjs` (hook iterations at L100-101, L122-123) | JS (`node:test`) | Spawns the real script in hook mode, asserts `status===0`; 2 of the 5 failures |
| `test/impure/setup-worktree-clobber.test.mjs` (`runHook` L45, asserts L58, called L71+L101) | JS | 2 of the 5 failures |
| `test/impure/setup-worktree-direct.test.mjs` (hook-parity L119-120; jq-absence direct test L140-172) | JS | 1 of the 5 failures; also already enforces the jq-free guarantee for **direct** mode |
| `operations/ci/faff-cron.sh` (L85-95) | Bash + `node -e` | Precedent: parse `--json` via a `node -e` one-liner "(no `jq` dependency assumed on the host)" |
| `test/impure/external-binaries.test.mjs` (L10-16) | JS | The must-resolve-on-PATH checklist — `node` is required, `jq` is deliberately excluded |

**Scope statement.** This is a one-file behavioural fix to the hook-mode input parser of `setup-worktree.sh`, with a matching regression test; it does not change how worktrees are provisioned or how faff-graft invokes the script.

## 2. OUT OF SCOPE

- **Installing `jq` in CI or sandbox images.** Excluded because it contradicts the dependency-free posture and, more concretely, has no clean in-repo surface — the failing environment is the fly.io agent sandbox, which is not checked into this repo, and the GitHub `validate.yml` lanes rely on the hosted runner image rather than an in-repo image definition. Extension point: if a future issue genuinely needs `jq` for something new, add it to the sandbox image definition (nearest analogue: `verification/audits/2026-08-16-FAFF-586-clean-machine-install/Dockerfile`) — not to fix this bug.
- **Changing the direct-mode path.** Excluded because direct mode is the load-bearing production path and already never touches `jq`; it is correct as-is. Extension point: direct-mode argument handling lives at `setup-worktree.sh` lines 16-19.
- **Broadening the hook-mode input contract** (new fields, tolerant parsing of non-`WorktreeCreate` payloads). Excluded — this fix preserves the existing `.name`/`.cwd` contract only. Extension point: the hook-mode branch at lines 20-25.
- **Reworking `jq` usage elsewhere in the repo** (`gh api --jq` in `merge-gate.js` / `ci-triage.js`, `operations/ci/*`, `.github/workflows/dco.yml`, the landing-comment action). Excluded — those are network/`gh`-gated or CI-runner-scoped and out of this issue's blast radius. Extension point: each call site individually.
- **Removing hook mode entirely.** Excluded — hook mode is a legacy/optional convenience with existing test coverage; deleting it is a larger decision than this environmental fix warrants. Extension point: the hook-mode branch and its tests.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Direct mode | `setup-worktree.sh <name> [<repo-root>]` — one or more positional args; never reads stdin, never calls `jq`. The faff-graft production path (FAFF-595). |
| Hook mode | `setup-worktree.sh` with zero args — reads a Claude Code `WorktreeCreate` JSON object off stdin and extracts `.name` / `.cwd`. Legacy/optional. |

**Hook-mode input.** Hook mode reads a single JSON object from stdin. Only two fields are consumed:

```
RECORD WorktreeCreateHookInput:   # Claude Code guarantees the shape; other fields ignored
  name: String                    # -> NAME; empty/absent -> treated as empty (existing guard aborts)
  cwd:  String                    # -> CWD;  empty/absent -> treated as empty (existing guard aborts)
```

**Parse contract (unchanged from the `jq` version).** For each field: parse the stdin JSON, read the field, emit its string value, and emit the empty string when the field is `null` or absent — mirroring `jq -r '.<field> // empty'`. Downstream, the existing guard at lines 27-28 (`[ -z "$NAME" ] || [ -z "$CWD" ] => exit 1`) is unchanged and still catches the empty case. Unparseable stdin is a terminal error (the script aborts under `set -euo pipefail`), same observable outcome as `jq` failing.

**Design decision — how to remove the `jq` dependency.** Options: (a) parse the stdin JSON with an inline `node -e` one-liner; (b) install `jq` in the environments; (c) emit only a "jq not found" message and still exit non-zero. Option (b) contradicts the dependency-free posture and has no in-repo surface. Option (c) leaves the five tests red because they assert `status===0`, not a message. Option (a) removes the dependency, matches existing repo precedent (`faff-cron.sh` parses `--json` with `node -e`), and turns all five tests green with no test edits. **Chosen:** replace the two `jq -r` calls with an inline `node -e` JSON parse over stdin.

**Design decision — inline snippet vs new faff subcommand.** No existing faff CLI subcommand does this parse; adding one to serve a legacy hook path is disproportionate. **Chosen:** an inline `node -e` snippet in the script, matching the `operations/ci/faff-cron.sh` precedent, not a new call-out.

## 4. HOW — Behavior

**Approach.** Only the hook-mode branch (lines 20-25) changes. The `INPUT=$(cat)` read stays; the two `jq -r` extractions become two `node -e` extractions with identical semantics. Direct mode (lines 16-19), the empty-field guard (lines 27-28), and the entire body below are untouched.

**Behaviour summary.** Given the hook JSON on stdin, extract `.name` and `.cwd` as strings using the Node runtime, emitting empty for a missing/null field, then hand off to the same guard-and-provision body the script already runs.

```
PROCEDURE hook_mode_parse(stdin):        # replaces lines 22-24
  1. INPUT = read all of stdin           # unchanged: INPUT=$(cat)
  2. NAME = extract_field(INPUT, "name") # was: printf %s "$INPUT" | jq -r '.name // empty'
  3. CWD  = extract_field(INPUT, "cwd")  # was: printf %s "$INPUT" | jq -r '.cwd  // empty'
  # control falls through to the existing guard (lines 27-28) unchanged

PROCEDURE extract_field(json_text, field):
  # Implemented as an inline `node -e` one-liner fed json_text on stdin, e.g. conceptually:
  #   read all stdin -> JSON.parse -> value = parsed[field]
  #   write (value == null ? "" : String(value)) with no extra output
  1. Parse json_text as JSON
  2. IF parse fails: exit non-zero  # set -euo pipefail aborts the script (parity with jq failure)
  3. value = parsed[field]
  4. IF value is null or undefined: emit ""    # the `// empty` semantics
     ELSE: emit value as a string
  # trailing newline is irrelevant — command substitution $(...) strips it, as it did for jq
```

**Edge cases and error handling.**

- **Field absent or `null`** → emit empty string → existing guard aborts with exit 1. Same as `jq '.x // empty'`.
- **Malformed / non-JSON stdin** → parse throws → the `node` process exits non-zero → the assignment's command substitution fails under `set -euo pipefail` → script aborts. Same terminal outcome `jq` produced; the hook contract guarantees well-formed input, so this is the defensive path, not the expected one.
- **`node` absent from PATH** → the command is unresolvable and the script aborts. This is not a regression relative to `jq`: `node` is already a hard requirement of the script (it shells to the Node-based faff binary at lines 38-47 and is on the required-binaries checklist), whereas `jq` was an *extra* requirement this change removes. Net: hook mode now depends on the same toolchain direct mode already does.
- **Value with special characters / whitespace** → passed through as a JSON string value; the surrounding shell quoting of the assignment (`NAME="$(...)"`) preserves it exactly as the `jq -r` path did.

**Anti-pattern:** guarding with `command -v jq` and branching to a `jq` path when present. Why: it keeps a `jq` code path alive, so the two environments diverge and the `jq`-less path stays under-exercised — exactly the drift that caused this bug. Remove `jq` outright.

**Anti-pattern:** making the tests pass by installing `jq` (in CI, a Dockerfile, or a test setup step). Why: it re-adds the dependency this issue exists to remove and does nothing for the fly.io sandbox that is not in the repo.

**Anti-pattern:** touching direct mode or the shared body. Why: direct mode is the production path and is already correct and `jq`-free; the only defect is the hook-mode parse.

**Failure modes.**

- **The failure:** the `node -e` extraction does not perfectly reproduce `jq -r '.x // empty'` semantics — e.g. it prints `"null"`/`"undefined"` for a missing field, or adds stray output — so a downstream value differs from the `jq` era. **How you'd know:** the hook-mode assertions in `setup-worktree-{base,clobber,direct}.test.mjs` fail on value/parity, or the empty-field guard stops firing. **What it means:** narrow the one-liner's null handling until parity holds; do not proceed until the five tests are green.
- **The failure:** an environment that lacks `jq` *also* lacks `node`, so hook mode still aborts. **How you'd know:** the new hook-mode jq-absence regression test (below) fails in an env with `node` removed; in practice this cannot happen because the whole script already requires `node`. **What it means:** proceed — this is out of contract; `node` is a documented hard dependency, unlike `jq`.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a WorktreeCreate JSON object on stdin with name and cwd set, in an environment with node but no jq
When setup-worktree.sh runs in hook mode
Then it extracts name and cwd, provisions the worktree, exits 0, and prints the worktree path last —
     with config-copy outcomes identical to direct mode
```

- The five existing hook-mode assertions across `setup-worktree-{base,clobber,direct}.test.mjs` MUST pass with **no edits to those tests**.

(The holdout is a hook-mode counterpart to the existing direct-mode jq-absence test at `setup-worktree-direct.test.mjs` L140-172 — a different concrete instantiation of the already-stated rule "the script must not require `jq`", reserved for the code-blind evaluator.)

## 6. DESIGN DECISION RATIONALE

**How should the `jq` dependency be removed?**
- Inline `node -e` JSON parse — pros: no new dependency, matches `faff-cron.sh`/`l3-watcher.yml` precedent, `node` already required, turns all five tests green; cons: a short inline snippet to get right.
- Install `jq` in CI / sandbox images — pros: no script change; cons: contradicts dependency-free posture, no in-repo surface for the fly.io sandbox, masks rather than fixes.
- Message-only ("jq not found") — pros: clearer failure; cons: still exits non-zero, so the five tests stay red; does not fix the stated problem.
- **Chosen:** inline `node -e` JSON parse replacing the two `jq -r` calls — the only option that removes the dependency and turns the tests green, and the one consistent with existing precedent.

**Should `jq` also be installed in CI/sandbox images (the issue's option 1)?**
- Yes — pros: defence in depth; cons: re-adds the dependency, no clean in-repo PR surface, and the node fix makes it unnecessary.
- No — pros: keeps the tree dependency-free, single source of fix; cons: none material once hook mode no longer needs `jq`.
- **Chosen:** No — rely solely on the `node` fallback; do not add `jq` anywhere.

**Should the five failing impure tests be edited?**
- Yes — cons: unnecessary; they assert real behaviour (`status===0`, config parity) that a correct fix satisfies as-is; editing them would weaken the guarantee.
- No — the correct fix makes them pass unchanged.
- **Chosen:** No test edits to the five failing assertions; add one *new* hook-mode jq-absence regression test as additive coverage.

**Inline snippet vs a new faff subcommand for the parse?**
- **Chosen:** inline `node -e` snippet — no faff subcommand exists for this, and adding one for a legacy hook path is disproportionate (matches the `faff-cron.sh` precedent). (At the time of writing, no faff CLI subcommand performs a generic stdin-JSON field extraction; revisit only if one is later introduced for broader reasons.)

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — all decisions are closed.

**Assumptions.**

- **Assumes:** `node` resolves on PATH wherever hook mode runs. Validation before building: confirm `node` is in the required-binaries checklist at `test/impure/external-binaries.test.mjs` (L10-16) and that `setup-worktree.sh` already invokes the Node-based faff binary (lines 38-47); both hold today, so `node` is a documented hard dependency of the script and hook mode is entitled to rely on it exactly as the body already does.

## 8. DONE — Definition of Done

### From WHY
- [ ] On a host with `node` but without `jq`, `setup-worktree.sh` hook mode no longer exits 127; `faff gates run`'s UNIT rung is green on an unmodified tree in a `jq`-less environment.
- [ ] The script contains no `jq` invocation (verify: no `jq` token remains in `plugin/skills/faff-graft/setup-worktree.sh`).

### From WHAT (parse contract)
- [ ] Hook mode extracts `.name` into `NAME` and `.cwd` into `CWD` from the stdin JSON.
- [ ] A `null`/absent `name` or `cwd` yields an empty string, so the existing guard at lines 27-28 aborts with exit 1 (behaviour unchanged from the `jq` version).
- [ ] Malformed / non-JSON stdin causes the script to exit non-zero (terminal, not a silent empty-value fall-through beyond the existing guard).

### From HOW (behaviour)
- [ ] Direct mode (lines 16-19) and the shared provisioning body are byte-for-byte unchanged.
- [ ] Hook mode provisions a worktree, prints the worktree path as the last stdout line, and produces config-copy outcomes identical to direct mode.
- [ ] The five existing hook-mode assertions in `setup-worktree-{base,clobber,direct}.test.mjs` pass with no edits to those tests.

### From HOW (regression coverage)
- [ ] A new test asserts hook mode succeeds (`status===0`, worktree path printed, FAFF-532 config parity) when `jq` is removed from PATH but `node` remains — the hook-mode counterpart to the existing direct-mode jq-absence test (`setup-worktree-direct.test.mjs` L140-172).

### From scope
- [ ] No `jq` is installed in any CI workflow, Dockerfile, or test setup as part of this change.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. In a temp git repo, remove jq from PATH but keep node, git, bash, cp, etc.
  2. Run: printf '{"name":"feat-x","cwd":"<repo>"}' | bash setup-worktree.sh   # hook mode, no args
     with SKIP_NPM_PACKAGES_INSTALL=1 and CLAUDE_PLUGIN_ROOT set
  3. ASSERT exit status == 0
  4. ASSERT the last stdout line is an existing worktree path under the resolved worktree root
  5. ASSERT the worktree's untracked overlay files were copied (config parity)
```

## Already shipped against this surface

No **Done** ticket has removed the `jq` dependency or otherwise superseded this premise — the failure still reproduces on unmodified `origin/main`, so the premise holds. Related surface, surfaced for human triage (not superseding):

- **FAFF-881** (Backlog, Medium, *not* automation-eligible) — "Sandbox test-suite flakiness trips post-merge verification every run (hook-mode jq, doctor symlinks, config-copy parity, order-dependence)". The broad parent-class ticket; hook-mode jq is one of ~4 clusters it names. FAFF-1046 is effectively the narrow, automation-eligible slice of that jq cluster. Shipping FAFF-1046 closes the jq cluster of FAFF-881 but leaves its other clusters (doctor symlinks, `test/670`/oracle-triage stale sha, the order-dependent flaky slot). A human may want to link FAFF-1046 to FAFF-881 and/or narrow FAFF-881's scope after this ships.
- **FAFF-925** (Duplicate → duplicateOf FAFF-881) — "Six pre-existing sandbox test failures… (jq absent + oracle-triage stale commit-hash fixture)". Already resolved as a duplicate of FAFF-881; recorded here only as corroboration that the jq gap is a known, recurring paper-cut.
- **FAFF-595** (Done) — de-hooked worktree provisioning; established direct mode as the production path and demoted hook mode to optional. Context for why this fix confines itself to the hook-mode parser, not the design of hook mode itself.

---

confidence: high
build-tier: complex
