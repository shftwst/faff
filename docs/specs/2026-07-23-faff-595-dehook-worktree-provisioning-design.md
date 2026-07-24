# FAFF-595 — De-hook worktree provisioning: setup-worktree.sh invoked from the skill step

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-595.

This spec covers making build-worktree provisioning harness-portable: `setup-worktree.sh` gains a direct argument interface and the faff-graft skill step invokes it via shell, so the Claude Code WorktreeCreate hook stops being load-bearing. Audience: the build agent patching the script, the two skill prompts, and the test surface; and human reviewers checking the parity claim.

## 1. WHY — Problem and Principles

**The load-bearing model:** `setup-worktree.sh` already performs the entire provisioning job — branch-off-HEAD worktree creation, the config-copy with the FAFF-532 tracked-file skip, and the package-manager install. The only harness-coupled part is *how it gets invoked*: Claude Code's EnterWorktree tool fires the registered WorktreeCreate hook, which feeds the script JSON on stdin. Give the script a plain argument interface and have the graft skill step call it directly, and provisioning works identically on any harness that has a shell tool.

**Problem statement:** worktree provisioning rides a Claude-Code-only mechanism (EnterWorktree tool → `.claude/settings.json` WorktreeCreate registration → JSON-on-stdin parsed with jq), so a graft on any other harness cannot provision a build worktree. This change makes the skill-step shell invocation the load-bearing path and demotes the hook to an optional convenience.

**Design principles:**

**One provisioning implementation, two entrances.** Direct-argument mode and hook-stdin mode are two input parsers in front of the same script body. Every provisioning semantic — branch naming, worktree-root resolution, the tracked-file skip, install/skip — is shared by construction. Never fork the script or port it to a second implementation.

**The direct path needs only bash and git.** jq is acceptable in the hook-stdin parser (Claude Code guarantees the JSON shape); the direct path must not invoke it, so a bare harness with only bash, git, and node (for `faff worktree-root`) provisions fine — and even an unresolvable faff binary already falls back to the literal default root.

**Nothing load-bearing depends on the hook.** Graft must complete a build on a machine with no WorktreeCreate registration at all. An existing registration stays harmless (graft no longer triggers it), but no step may require one.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/setup-worktree.sh` | Bash | The provisioning script this change re-fronts |
| `plugin/skills/faff-graft/SKILL.md` | Markdown | "Worktree Hook" config section + Step 3 fresh-create path — both rewritten |
| `plugin/skills/faff/SKILL.md` → Worktree policy | Markdown | The canonical worktree-mechanism wording — two lines updated |
| `plugin/skills/faff/bin/lib/` (`faff worktree-root`) | Node | The canonical root resolver (FAFF-382) — called by both modes, untouched |
| `test/setup-worktree-clobber.test.mjs`, `test/setup-worktree-config.test.mjs` | Node test | Existing end-to-end + static coverage; direct-mode parity test lands beside them |

**Scope statement:** this is the worktree seam of the harness-portability stream — the seam the per-seam coupling audit classifies as "drop the harness mechanic; the skill step calls the script" — implemented independently of the sibling seams (engine transport, telemetry, permission mapping).

## 2. OUT OF SCOPE

- **Other harness seams** (codex engine transport, telemetry adapter, appetite→permission mapping, window-mode budget) — why excluded: each is its own ticket in the same project. Extension point: those tickets.
- **The disposition-table doc** (`docs/architecture/harness-coupling.md`, FAFF-592) — why excluded: its WorktreeCreate row already records this outcome with FAFF-595 as the follow-on; no edit needed whether it lands before or after this change. Extension point: that doc's own "how to extend" note.
- **The FAFF-402 resume path** — why excluded: it already runs `git worktree add` directly (checkout of an existing remote branch, deliberately not provisioning). Extension point: none needed.
- **`faff worktree-root` / `faff worktree-prune`** — why excluded: already harness-independent CLI; both invocation modes call the resolver identically. Extension point: `bin/lib/worktree-prune.js` if prune semantics ever change.
- **Removing the Stop / PreToolUse hook registrations** — why excluded: different seams with a different disposition (enforcement moves down-stack to CI; hooks stay as fast local feedback). Extension point: the governance-check chain.

## 3. WHAT — interfaces

**Script interface (the change):**

```
setup-worktree.sh <name> [<repo-root>]     # direct mode
setup-worktree.sh                          # hook mode (JSON on stdin, as today)
```

- **Direct mode** — fires when ≥1 positional argument is present. `NAME := $1`; `CWD := $2` when given, else the invoking working directory. stdin is never read; jq is never invoked.
- **Hook mode** — fires when no positional arguments are present: read stdin, parse `name` + `cwd` with jq, exactly today's behaviour.
- Everything after input resolution is the existing shared body, unchanged in meaning: empty `NAME`/`CWD` → exit 1; `/`→`-` name sanitisation; root via `faff worktree-root` (fallback to the literal default); `git worktree add -b <safe-name> <path> HEAD`; config-copy with the per-file `git ls-files --error-unmatch` tracked-skip (FAFF-532); install honouring `SKIP_NPM_PACKAGES_INSTALL=1`; worktree path printed to stdout as the last line.

**Graft skill step (fresh-create path, Step 3):** replace "use the `EnterWorktree` tool" with the direct invocation:

```
faff=<resolved per gateway → Resolving the faff executable>
script="$(dirname "$faff")/../../faff-graft/setup-worktree.sh"   # the "$faff"-adjacent path
[ -f "$script" ] || script=$(find <skills parent> -path '*/faff-graft/setup-worktree.sh' | head -1)
wt=$(bash "$script" "<branch-name>" "$repo_root")                # last stdout line = worktree path
```

The captured `wt` is the worktree path all subsequent steps operate in (explicit `cd "$wt"` / absolute paths). The FAFF-382 worktree-root assert runs against `wt` unchanged; its prose no longer says "after `EnterWorktree` returns, the session cwd is the new worktree" — the invocation returns a path, it does not switch any session cwd.

**Graft configuration section:** the "Worktree Hook" section (first-use registration of the WorktreeCreate hook into `.claude/settings.json`) is replaced by a short "Worktree provisioning" section: the skill step invokes the bundled script directly; a project-specific wrapper at `scripts/setup-worktree.sh` is preferred when present (the existing convention, now resolved by the skill step instead of the hook registration); an existing WorktreeCreate registration is harmless and may be kept or removed by the operator.

**Gateway Worktree policy:** two wording updates — the mechanism line ("/faff-graft owns the mechanism (the skill-step invocation of `setup-worktree.sh`)") and the provisioning bullet ("performed by `setup-worktree.sh` when the skill step invokes it — or when a legacy WorktreeCreate hook fires it").

Design decisions are collected in section 6 with markers.

## 4. HOW — behaviour

Input resolution at the top of the script; the body below it is untouched:

```
PROCEDURE resolve_inputs(argv, stdin):
  1. IF argv has ≥1 entry:
     a. NAME = argv[1]
     b. CWD  = argv[2] if present, else the invoking working directory
     (stdin untouched; no jq)
  2. ELSE:
     a. INPUT = read all of stdin
     b. NAME = jq '.name // empty';  CWD = jq '.cwd // empty'
  3. IF NAME or CWD is empty → exit 1
```

**Behaviour summary:** one script, one body; the mode choice is purely which parser filled `NAME`/`CWD`.

**Edge cases and error handling:**

- Worktree/branch already exists → `git worktree add -b` fails, script exits non-zero (unchanged). Graft's Step 3 already checks `git worktree list` for the issue's worktree before provisioning, so the double-provision case is guarded at the caller in both modes.
- Direct mode with one argument from a cwd that is not the repo root → provisioning runs against the wrong repo; the skill step therefore always passes `repo_root` explicitly (second argument), and the FAFF-382 assert catches a mis-rooted worktree fail-closed.
- Script path unresolvable (no adjacent `faff-graft/` dir — e.g. a partial install) → the skill step's `find` fallback; if still absent, that is a park (unexpected state), not a silent skip.
- Hook mode continues to exit 1 on empty stdin/fields — existing behaviour, existing callers.

**Failure modes:**

- **The failure:** parity drift — the two modes diverge over time (a fix lands in one parser's assumptions but not the other's). **How you'd know:** the parity test (Scenarios) runs both modes against the same fixture and compares results; a divergence fails CI. **What it means:** fix the shared body; if a change genuinely can't be mode-neutral, that is a design smell to escalate, not to fork around.
- **The failure:** some other faff surface secretly depended on EnterWorktree/hook side effects (session-cwd switch). **How you'd know:** graft steps after Step 3 operating on the main checkout instead of the worktree — the FAFF-382 assert and the spec-commit landing on the wrong tree make this loud. **What it means:** the offending step's prose is updated to use the captured path; the assert already fails closed autonomously.

**Anti-pattern:** registering the hook as part of graft's flow "just in case". Why: it re-couples the load-bearing path to the harness and hides direct-path breakage on the one harness where the hook silently covers for it.

**Anti-pattern:** a second provisioning script (or inlining `git worktree add` + copy loop into skill prose) for the direct path. Why: the FAFF-532 semantics live in one place; a second copy is the clobber bug waiting to recur.

## Scenarios

Given a harness with no WorktreeCreate hook support and no hook registered
When the graft skill step provisions via `setup-worktree.sh <branch> <repo-root>`
Then a worktree exists on a new branch off HEAD under the resolved worktree root, untracked config (`.env*`, `.claude/settings.local.json`, `.faffrc.local.yaml`, a gitignored `.faffrc.yaml`) is copied in, and a git-tracked `.faffrc.yaml` is left at the worktree's own ref (the FAFF-532 skip)

Given one repo fixture with a tracked-but-divergent `.faffrc.yaml` and an untracked overlay
When the script runs once in hook mode (JSON stdin) and once in direct mode (arguments) against equivalent fixtures
Then both worktrees have identical config-copy outcomes and both print the worktree path as the last stdout line

Given a PATH with no `jq` binary available
When the script runs in direct mode
Then provisioning succeeds (the direct path never invokes jq)

- The hook-mode invocation contract (JSON stdin → path on stdout) MUST remain byte-compatible: the two existing setup-worktree tests pass unmodified.

## 6. DESIGN DECISION RATIONALE

**How does the direct path get its inputs?** Options: positional arguments (name, repo-root); flags (`--name/--cwd`); an env-var pair. Positional is the smallest surface for a two-value interface, matches how the skill step calls it, and leaves the zero-arg case unambiguously meaning hook mode. **Chosen:** positional `<name> [<repo-root>]`, zero args = hook mode.

**One dual-mode script or a new entrypoint?** Options: dual-mode parser in the existing script; a sibling `provision-worktree.sh` that the hook script wraps; a Node port into the faff CLI. The provisioning semantics (FAFF-532 skip, install heuristics) must have exactly one home; a Node port is a rewrite risk far above Size S. **Chosen:** dual-mode input resolution in the existing script, shared body untouched.

**Does graft still register the hook?** Options: keep first-use registration as today; register only on request; drop registration entirely. The coupling audit's disposition for this seam is drop, and any required registration keeps `.claude/settings.json` load-bearing. **Chosen:** drop the first-use registration requirement from graft's configuration section; hook-stdin mode stays in the script so an operator-registered hook (or older installs) keeps working; graft never needs it.

**How does the skill step find the script?** Options: hardcode `~/.claude/skills/faff-graft/…`; resolve adjacent to the resolved `"$faff"` binary; a new `faff` subcommand that prints the path. The gateway already forbids hardcoding the dev-linked prefix, and the binary's resolved location fixes the skills parent for both dev-link and plugin installs. **Chosen:** `"$(dirname "$faff")/../../faff-graft/setup-worktree.sh"` with a `find`-based fallback, mirroring the existing executable-resolution rule. The project-wrapper convention (`scripts/setup-worktree.sh` preferred when present) moves into the same resolution step.

**Both modes or direct-only in graft's two entry flavours?** Options: direct invocation autonomous-only (interactive keeps EnterWorktree); direct in both. Two live invocation paths in one skill means the rarely-exercised one rots, and interactive Claude sessions lose nothing (the step cd's into the printed path). **Chosen:** the skill step invokes directly in both interactive and autonomous modes.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — every decision above is closed.

**Assumptions:**

**Assumes:** the install layout keeps `setup-worktree.sh` at `skills/faff-graft/` sibling to `skills/faff/bin/faff` (true for the repo, the dev symlink farm, and the plugin cache). Validation: the skill step tests `-f "$script"` before invoking and falls back to `find`; the build agent verifies both locations resolve in a dev-linked checkout.

## 8. DONE — Definition of Done

### From WHY
- [ ] A build worktree can be provisioned by running `setup-worktree.sh <name> <repo-root>` with no WorktreeCreate hook registered and no EnterWorktree tool involved

### From WHAT (script interface)
- [ ] ≥1 positional argument selects direct mode (`NAME=$1`, `CWD=$2|invoking-dir`); zero arguments reads JSON stdin exactly as today
- [ ] The direct-mode code path performs no jq invocation
- [ ] Both modes share the unchanged body: sanitisation, `faff worktree-root` resolution, branch-off-HEAD, FAFF-532 tracked-skip config-copy, install/skip, path-on-stdout

### From WHAT (skill prose)
- [ ] faff-graft SKILL.md Step 3 fresh-create invokes the script directly via the `"$faff"`-adjacent path (with `find` fallback and the `scripts/setup-worktree.sh` project-wrapper preference) and operates on the captured path; the FAFF-382 assert prose references the captured path, not a session cwd
- [ ] faff-graft SKILL.md no longer requires WorktreeCreate registration (the "Worktree Hook" section is replaced by the provisioning section; existing registrations documented as harmless-optional)
- [ ] Gateway Worktree policy mechanism + provisioning lines name the skill-step invocation, hook as optional/legacy

### From HOW (tests)
- [ ] `test/setup-worktree-clobber.test.mjs` and `test/setup-worktree-config.test.mjs` pass unmodified
- [ ] A new test provisions in direct mode against the FAFF-532 fixture and asserts parity with hook mode (tracked `.faffrc.yaml` kept at worktree ref; untracked overlay copied; path printed last on stdout)
- [ ] A new test case runs direct mode with jq absent from PATH and asserts success

**Integration smoke test:**

```
1. Tmp git repo, committed .faffrc.yaml=A, working tree=B, untracked overlay
2. bash setup-worktree.sh feat-x <repo> (env: FAFF_WORKTREE_ROOT=<tmp>, SKIP_NPM_PACKAGES_INSTALL=1, PATH without jq)
3. Printed path exists, is a worktree on branch feat-x; its .faffrc.yaml == A; overlay present
```

confidence: high
spec-review: approve
