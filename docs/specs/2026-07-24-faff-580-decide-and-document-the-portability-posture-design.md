# Portability posture: declare POSIX-only + Node ≥20, and resolve the home directory the same way everywhere

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-580.

This spec is for the build agent implementing FAFF-580, and for the reviewers gating it. It settles what platforms faff supports today, writes that down where a user will actually see it, and removes the one class of silent bug that made "unsupported" look like "sort of works": four modules each resolving the user's home directory their own way. Full Windows support is deliberately left as a separate, larger decision — this spec draws the line, it does not cross it.

## 1. WHY — Problem and Principles

**The load-bearing idea.** faff already only runs on POSIX with a recent Node — CI pins Node 20, the code uses `.at()` and `??`, the CLI is an extensionless shebang binary, and the env/holdout machinery shells out to `docker`, `sqlite3` and `sleep`. What's missing isn't support, it's an *honest statement* of that floor plus a *single, consistent* way to find the home directory. Right now Windows doesn't refuse — it mis-resolves paths and limps, which is worse than a clean "not here, use WSL".

**Problem statement.** faff is POSIX-only in practice but says so nowhere a user looks, and its home-directory resolution disagrees module to module — so on an odd environment (an unset `HOME`, or Windows) it silently builds wrong paths instead of failing honestly. This change declares the supported floor in the README and routes every home-directory lookup through one shared helper, so the behaviour is consistent and documented rather than accidental.

**Design principles.**

- **Fail honestly over limp silently.** A platform faff doesn't support should get a clear refusal with a pointer to WSL, not a half-working session that mis-resolves paths. This is the "safe to stop watching" posture applied to the install surface: an operator must be able to trust that a session which started is a session on supported ground.
- **One resolution, one home.** Home-directory resolution is mechanical and identical everywhere it's needed, so it belongs in exactly one function under the deterministic-tools tenet — never four hand-rolled copies that drift.
- **Draw the Windows line, don't imply it.** Declaring POSIX-only is a commitment that full Windows support is a *separate* decision, not a vague "maybe later". The guard and the README both say so in plain words.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node (CJS) | Owns roots, ledger paths, and config resolution — the natural, region-legal home for a shared `homeDir()` |
| `plugin/skills/faff/bin/lib/budget.js` (`transcriptBaseDir`) | Node (CJS) | The one call site that already handles `USERPROFILE` — its form is the template to generalise |
| `plugin/skills/faff/bin/lib/gates.js` (`doctor`) | Node (CJS) | Two `HOME || ""` lookups that yield a relative path when `HOME` is unset |
| `plugin/skills/faff/bin/lib/hooks-ensure.js` (`resolveHookBin`) | Node (CJS) | One `HOME || ""` lookup, same relative-path trap |
| `plugin/skills/faff/bin/lib/lights-out.js` (`resolveWorktreeRoot`, FAFF-382) | Node (CJS) | Falls back to the literal string `"~"`, minting a worktree root that is a directory *named tilde* |
| `plugin/skills/faff/bin/faff` | Node (CJS) | The CLI dispatch shell — where a `win32` entrypoint guard belongs |
| `README.md` | Markdown | The only user-facing place a platform/Node floor can live (there is no `package.json`/`engines` by design) |
| `.github/workflows/validate.yml` | YAML | ubuntu-only today; the home for a cheap macOS smoke lane |

**Scope statement.** This sits at faff's install-and-run boundary — the platform floor and the path-resolution primitives every skill depends on before any delivery work happens.

## 2. OUT OF SCOPE

- **Full Windows support.** — Making faff actually run on native Windows (a `sleep` replacement, a `.cmd`/`.ps1` launcher, path-separator audits across the whole CLI). **Why excluded:** it's a separate, much larger decision with its own appetite and testing cost; this ticket's job is to *declare the line*, not cross it. **Extension point:** a future initiative under the "Harness portability — L2/L3 anywhere" project; the `win32` guard is the single place that would flip from "refuse" to "supported".
- **Replacing `spawnSync("sleep", …)` at `env.js` and the `docker`/`sqlite3` shell-outs.** — These POSIX/tool dependencies live in the L4 env/holdout machinery. **Why excluded:** they only run on platforms the newly-declared posture already excludes, and the entrypoint guard refuses those platforms before this code is reached — so fixing them buys nothing until full Windows support is on the table. **Extension point:** the same future Windows initiative; noted here so the next agent doesn't treat the guard as licence to assume these are portable.
- **Changing the unset-`HOME` semantics from "empty string" to "fail loud".** — `homeDir()` preserves today's tolerant `HOME || USERPROFILE || ""` behaviour (see the design decision below). **Why excluded:** making an unset home a hard error is a behavioural change to the token-metering degrade path (`transcriptBaseDir`, FAFF-502) that deserves its own ticket and its own test evidence. **Extension point:** `homeDir()` in `shared-infra.js` is the one function a future change would harden.
- **`.faffrc`/`engines` version pinning or a `package.json`.** — faff ships dependency-free with no manifest by design. **Why excluded:** adding one to state the Node floor would import an install/tooling model the project deliberately avoids. **Extension point:** none planned; the README is the declared home for the floor.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Portability posture | faff's stated, supported platform floor: which OS families and Node versions are supported, and what happens on the rest |
| Home directory resolution | Deriving the current user's home directory from the environment (`HOME`, falling back to `USERPROFILE`) |
| Entrypoint guard | A check at the top of the CLI's run path that refuses to proceed on an unsupported platform |

**The shared helper.**

```
FUNCTION homeDir(env = process.env) -> String
  # returns the user's home directory, or "" when neither variable is set
  RETURN env.HOME OR env.USERPROFILE OR ""
```

- Lives in `shared-infra.js`, added to its `module.exports`, alongside `findRoot` / `mainWorktreeRoot` (same roots-and-paths concern).
- Takes `env` as an argument (defaulting to `process.env`) so it stays pure and testable — matching how `transcriptBaseDir` and `resolveWorktreeRoot` already thread `env`.
- Region rule (ADR 0042): `shared-infra` may reference neither region's identifiers. `homeDir` references only `process.env` and its argument, so it is region-legal here.

**Design decisions.**

**Where does the shared helper live, and what does it return on an unset home?**

- **Chosen:** `homeDir(env = process.env)` in `shared-infra.js`, returning `env.HOME || env.USERPROFILE || ""` — a verbatim generalisation of the most complete existing form (`budget.js`'s `transcriptBaseDir`). Rationale: it is behaviour-preserving for the best existing call site, an unambiguous improvement for the three that lacked `USERPROFILE` or fell back to `"~"`, and it keeps the change to a pure consolidation with no semantic surprises for reviewers to weigh.

**Should an unset home fail loud instead of returning `""`?**

- **Chosen:** No — preserve the tolerant `""` return. Rationale: an unset `HOME` on a supported POSIX platform is already vanishingly rare, and the `win32` guard removes the Windows path where `USERPROFILE`-only environments show up; the one call site where `""` is actively harmful (the `resolveWorktreeRoot` default) is already caught downstream by FAFF-382's strictly-under `--assert` isolation check, which fails closed on a non-isolated root. Turning unset-home into a hard error is a behavioural change to the FAFF-502 metering degrade path and belongs in its own ticket (see OUT OF SCOPE).

**Where does the platform guard sit?**

- **Chosen:** At the top of the CLI run path — inside the `if (require.main === module)` block in `plugin/skills/faff/bin/faff`, before `main()` dispatches. Rationale: it must refuse a *user invocation* of the CLI on `win32`, but must **not** fire when the module is `require`d for its exported pure functions (the FAFF-373 corrective-integrity tests import it), so it cannot live at module top level. The `require.main === module` block is exactly the "invoked as a CLI" boundary.

## 4. HOW — Behavior

**Architecture and approach.** Four steps, independent enough to land in one PR: add `homeDir()` and repoint the four call sites at it; add the `win32` entrypoint guard; add the README posture section; add the macOS CI smoke lane. No call site changes its observable behaviour on a supported platform except that the three weaker ones now also honour `USERPROFILE` and never emit `"~"`.

**Step 1 — the shared helper and its four call sites.**

Add `homeDir` to `shared-infra.js` and its exports. Then repoint:

```
PROCEDURE repoint_call_sites:
  budget.js  transcriptBaseDir:  const home = homeDir(env)            # was: env.HOME || env.USERPROFILE || ""
  gates.js   doctor (x2):        homeDir()                            # was: process.env.HOME || ""
  hooks-ensure.js resolveHookBin: homeDir()                           # was: process.env.HOME || ""
  lights-out.js resolveWorktreeRoot: const home = homeDir(env)        # was: (env && env.HOME) ? String(env.HOME) : "~"
```

Each importing module already `require`s `shared-infra`, so this adds one name to the existing destructure, not a new dependency edge.

**Anti-pattern:** re-implementing the `HOME || USERPROFILE` fallback inline "just here" in a new call site. Why: that is the exact drift this ticket removes — every home lookup goes through `homeDir()`.

**Step 2 — the `win32` entrypoint guard.**

```
PROCEDURE cli_entry:  # inside `if (require.main === module)` in bin/faff, before main() dispatch
  1. IF process.platform === "win32":
     a. Write to stderr a clear refusal:
        "faff is POSIX-only (macOS/Linux). Native Windows is not supported —
         run faff under WSL2. See the Requirements section in the README."
     b. Exit non-zero (process.exitCode = 1) and do NOT dispatch a subcommand.
  2. ELSE: proceed to main() dispatch unchanged.
```

The message names the platform limit, the remedy (WSL2), and where to read more — no PM jargon, no apology.

**Anti-pattern:** putting the guard at module top level. Why: it would fire on `require()` of the file for its exported pure functions and break the corrective-integrity tests, which run on POSIX CI. The guard belongs strictly inside the CLI-execution block.

**Step 3 — README posture section.**

Add a short **Requirements** (or "Platform support") section to `README.md` stating, in plain words:

- macOS and Linux (POSIX) only.
- Node ≥ 20 (the de-facto floor CI already pins; there is no `package.json`/`engines`, so the README is where it's written).
- Native Windows is not supported; run under WSL2. Full Windows support is a separate, future decision — not implied by anything here.

Prose follows `.agents/STYLE.md`: casual-but-credible, British understatement, gaps stated as facts (Windows is a separate decision, tracked as future work), not apologies.

**Step 4 — macOS CI smoke lane.**

Add a job to `.github/workflows/validate.yml`, `runs-on: macos-latest`, Node 20, that runs the **pure `--selftest` suite only** — no docker, no `node --test` under `FAFF_REQUIRE_DOCKER`. The selftests are pure (no network, no docker, no subprocess beyond Node), so they are the honest cheap cross-platform smoke: they prove the CLI's deterministic cores load and pass on macOS, which is what operators actually run on (`.faffrc.yaml:12`'s Colima note). The existing ubuntu `validate` job is unchanged and stays the full lane (docker, rootless, `node --test`).

**Failure modes.**

- **The failure:** the macOS lane is *supposed* to be cheap but silently pulls in a docker-dependent test, making it slow or flaky. **How you'd know:** the lane's wall-time jumps or it fails on a missing `docker`/`sqlite3`. **What it means:** narrow the lane back to an explicit list of `--selftest` invocations (or a dedicated `make`/npm-script target that excludes docker), rather than a blanket `node --test`.
- **The failure:** consolidating `resolveWorktreeRoot`'s `"~"` fallback to `""` changes where a worktree lands when `HOME` is unset. **How you'd know:** a build on an `HOME`-less shell resolves a worktree under a relative `.faff/worktrees/...` and FAFF-382's `--assert` strictly-under check refuses it. **What it means:** proceed — that refusal is the correct, honest outcome (it already fails closed); it is strictly better than a directory literally named `~`.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given faff is invoked as a CLI on a win32 platform
When any subcommand is run (e.g. `faff config path`)
Then it exits non-zero, prints a POSIX-only message naming WSL2, and dispatches no subcommand
```

```
Given a module that requires bin/faff for its exported pure functions on POSIX
When the require happens (as the corrective-integrity tests do)
Then no guard fires and the exported functions are available unchanged
```

```
Given an environment where HOME is unset but USERPROFILE is set
When homeDir() is called
Then it returns USERPROFILE (not "" and not "~")
```

- assertion: The macOS CI lane runs only pure `--selftest` invocations — it invokes neither docker nor `node --test` under `FAFF_REQUIRE_DOCKER`.
- assertion: `grep` for `USERPROFILE`, `HOME ||`, and the literal `"~"` fallback across `bin/lib` finds no home-directory resolution outside `homeDir()`.

## 6. DESIGN DECISION RATIONALE

**Where should `homeDir()` live?**
Options: `shared-infra.js` (roots/paths module) vs a new `platform.js` module vs leaving it in `budget.js`. `shared-infra` already owns `findRoot`, `mainWorktreeRoot`, and config path resolution — the same concern — and is required by all four call-site modules already; a new module adds an edge for no gain; `budget.js` is a consumer, not a home. **Chosen:** `shared-infra.js` — least new surface, region-legal, already a shared dependency.

**Return `""` or throw on an unset home?**
Throwing gives a cleaner failure but changes the FAFF-502 metering degrade path and adds a failure mode to a rarely-hit branch. **Chosen:** return `""` (behaviour-preserving); harden separately if evidence warrants. At the time of writing, no call site depends on a *thrown* error for correctness, and the one harmful-`""` site is already guarded by FAFF-382.

**Guard placement — top of file vs `require.main` block vs inside `main()`?**
Top of file breaks `require`-for-pure-functions. Inside `main()` works but `main()` is also reachable in ways the tests exercise; the `require.main === module` block is the precise "run as a CLI" signal. **Chosen:** the `require.main === module` block, before `main()` is called.

**macOS lane scope — full `node --test` vs selftests only?**
Full parity would need docker on macOS runners (slow, and Colima/Docker Desktop licensing friction) for near-zero extra signal over the ubuntu lane. **Chosen:** selftests only — the cheap, pure, honest smoke that catches a macOS-specific load/parse regression without the docker tax.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — every decision above is closed.

**Assumptions:**

- **Assumes:** `shared-infra.js` is `require`d by `budget.js`, `gates.js`, `hooks-ensure.js`, and `lights-out.js` already. **Validation:** `grep -n "shared-infra" plugin/skills/faff/bin/lib/{budget,gates,hooks-ensure,lights-out}.js` before adding the destructured import; if any doesn't, add the `require` there. *(Validated during prep — all four already import it.)*
- **Assumes:** `macos-latest` GitHub-hosted runners provide Node 20 via `actions/setup-node@v4` with no extra setup. **Validation:** the lane's first green run confirms it; a setup failure is a loud CI failure, not a silent skip.

## 8. DONE — Definition of Done

### From WHY
- [ ] The README states, in plain STYLE.md-conformant prose, that faff supports macOS/Linux (POSIX) + Node ≥ 20 and that native Windows is unsupported (WSL2 pointer), with full Windows support named as a separate future decision.

### From WHAT (the shared helper)
- [ ] `homeDir(env = process.env)` exists in `shared-infra.js`, returns `env.HOME || env.USERPROFILE || ""`, and is in `module.exports`.
- [ ] `budget.js`, `gates.js` (both lookups), `hooks-ensure.js`, and `lights-out.js` resolve the home directory *only* via `homeDir()`.
- [ ] No home-directory resolution (`HOME ||`, `USERPROFILE`, literal `"~"` fallback) remains inline anywhere under `bin/lib`.

### From HOW (the guard)
- [ ] Invoking the CLI on `process.platform === "win32"` exits non-zero with a POSIX-only message naming WSL2 and dispatches no subcommand.
- [ ] The guard sits inside the `require.main === module` block; `require`-ing `bin/faff` for its exports on POSIX fires no guard and the existing test suite passes.

### From HOW (CI)
- [ ] `.github/workflows/validate.yml` has a `macos-latest` job (Node 20) running only pure `--selftest` invocations — no docker, no `node --test` under `FAFF_REQUIRE_DOCKER`.
- [ ] The existing ubuntu `validate` and `env-rootless` jobs are unchanged.

### From HOW (behaviour preserved)
- [ ] `transcriptBaseDir` and `resolveWorktreeRoot` return the same values as before for a set `HOME`; `resolveWorktreeRoot` no longer returns a path under a directory named `~`.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. On POSIX: `node plugin/skills/faff/bin/faff config path` runs normally (guard does not fire).
  2. With process.platform stubbed to "win32" (unit-level): the entry guard exits non-zero with the WSL2 message.
  3. `node --test` (the home-dir + worktree-root selftests) passes on POSIX.
```

## Methodology critique

Agile-delivery lens (issue-critique):

- **Right-sized?** Yes. The four changes — the shared `homeDir()` and its four repoints, the `win32` guard, the README posture, the macOS smoke lane — are one coherent "declare and consolidate the portability posture" decision that always ships together. Splitting them would separate a declaration from the consistency it declares. Single 1–3 day unit; no split.
- **Workstream fit?** One observation, not a blocker: there is an active project **Harness portability — L2/L3 anywhere** (FAFF-595, FAFF-592 landed there), and this ticket is the same theme but currently sits in no project. Worth re-homing it under that project so the portability work stays converged — an orchestrator/tidy call, not a prep one.
- **Deps surfaced?** Clean. Related to FAFF-544 and FAFF-204 (both Done — the earlier `$HOME`-relative path-resolution class), and it consolidates FAFF-382's worktree-root resolver. No open blocker, no implicit unlinked dependency.
- **Risk profile?** Low. Pure consolidation plus docs plus a cheap CI lane — no novel integration, no external dependency, no de-risking spike warranted.

confidence: high
spec-review: approve
