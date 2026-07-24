# ADR 0086 — faff supports POSIX (macOS/Linux) + Node >= 20; native Windows is a separate future decision

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-07-24
- **Issue:** FAFF-580

## Context

faff already only runs on POSIX with a recent Node in practice: CI pins Node 20, the codebase uses `.at()` and `??`, the CLI ships as an extensionless shebang binary, and the L4 env/holdout machinery shells out to `docker`, `sqlite3`, and `sleep`. None of that is stated anywhere a user looks — there's no `package.json`/`engines` by design, and no README section says what's supported.

Worse, on an environment faff doesn't actually support, it doesn't refuse — it limps. Home-directory resolution disagreed module to module: `budget.js` handled `USERPROFILE`, `gates.js` and `hooks-ensure.js` used `HOME || ""` (an unset `HOME` silently produces a relative path), and `lights-out.js` fell back to the literal string `"~"`, minting a worktree root that's a directory named tilde. On Windows, or any shell with an unset `HOME`, faff would mis-resolve paths instead of failing honestly.

## Decision

faff's supported platform floor is **POSIX (macOS/Linux) + Node ≥ 20**. Native Windows is not supported and is a **separate, future decision** — not implied by anything here.

This is backed by three things, all landing together (FAFF-580):

- A single `homeDir(env = process.env)` helper in `shared-infra.js`, used by every call site that needs the user's home directory. One resolution, done once, instead of four hand-rolled copies that drift.
- A `win32` entrypoint guard inside `bin/faff`'s `require.main === module` block — the CLI refuses to run on Windows with a clear message naming WSL2 as the route in, rather than silently mis-resolving paths.
- A README **Requirements** section stating the floor in plain words, so this is discoverable rather than folklore.

This is what turns the remaining POSIX-only dependencies — the `sleep`/`docker`/`sqlite3` shell-outs in the L4 env/holdout machinery — from bugs into an accepted consequence of a stated floor: the entrypoint guard refuses unsupported platforms before that code is ever reached.

## Consequences

- Any new code that needs the user's home directory goes through `homeDir()` — not a fresh `HOME || …` inline. This is now the only sanctioned path, and drift back to hand-rolled resolution is what future review should catch.
- The `win32` guard is the single place a future decision to support Windows would need to flip from "refuse" to "supported". Everything downstream of it — the `sleep`/`docker`/`sqlite3` shell-outs, path-separator assumptions elsewhere in the CLI — stays unaudited for Windows until that day, and this ADR is the record of why that's fine for now rather than an oversight.
- The macOS CI lane this ticket adds (selftests only, no docker) is deliberately a smoke check, not full parity — it exists because operators run faff on macOS, not because faff claims to support it more broadly than stated here.
- Full native Windows support — a `sleep` replacement, a `.cmd`/`.ps1` launcher, a path-separator audit across the CLI — is out of scope for this decision and belongs to its own future initiative should it ever get picked up.

<!-- confidence: high -->
