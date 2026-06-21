# Spec: `faff hooks-ensure` — deterministic, repeatable registration of faff's Stop-hook command set

> Spec: faffter-dark-nlspec · 2026-06-20 · interactive · confidence: high. Source: Linear FAFF-192.

Defines a new `faff hooks-ensure` CLI subcommand that idempotently installs faff's Stop-hook commands into `.claude/settings.json`, plus the skill-prose changes that call it on first run — replacing the per-install manual `settings.json` edit that under-delivered FAFF-178's AC7.

## 1. WHY

`faff prepcheck` (FAFF-178) only fires once `faff prepcheck --hook` is in the Stop hook, but FAFF-178 left that registration as a per-install manual `settings.json` edit — which doesn't generalise and is error-prone (a hook against a stale CLI copy exits 2 → a Stop hook treats that as *block-stop-with-error*, jamming every session end). This change makes registration a deterministic, idempotent CLI operation that skills call automatically.

**Principles.** Deterministic tools over prose (a CLI subcommand, not agent JSON-editing — mirrors `gitignore-ensure`). Non-destructive + idempotent (add only missing faff commands; no-op writes nothing). Never register a hook the target bin can't serve (probe first; skip+warn on a stale install).

## 2. OUT OF SCOPE
- The `WorktreeCreate` hook (faff-graft) — different hook type; extension point: a `--set` selector over an internal hook-set.
- Fixing a stale/copy install — only detect+warn (the re-link is `link-skills.sh`/`faff doctor`'s job).
- Migrating/removing operator-customised hooks (non-destructive is hard).
- A general settings.json editor (proportionality).

## 3. WHAT

- `FAFF_STOP_HOOKS = ["runcheck", "prepcheck"]` — the command set (single source of truth).
- **present** — a Stop command, in either `settings.json` or `settings.local.json`, recognised as invoking faff's `<sub> --hook` (token identity).
- **served** — the resolved bin actually implements `<sub>` (probe exit ≠ unknown-subcommand).
- CLI: `faff hooks-ensure [--root DIR] [--json] [--dry-run] [--selftest]`. Exit `0` normal (incl. no-op + stale-skip); `2` only on malformed settings JSON (fail-loud, no write).
- Result: `{ path, created, bin, added, already, skipped_stale }` (mirrors `gitignoreEnsure`).

**Decisions.**
- **Chosen:** write to `.claude/settings.json`; detect presence across **both** settings files (avoid double-registration — they merge).
- **Chosen:** token-identity presence match (basename `faff` + subcommand + `--hook`), not exact-string — survives per-install path differences; never duplicates or clobbers a customised invocation.
- **Chosen:** registered bin = on-PATH `faff` (`command -v faff`) if served, else the running binary's own real path; never hardcode `~/.claude/...`.
- **Chosen:** stale-bin guard — probe `<bin> <sub> --hook` before writing; on unknown-subcommand, skip + `skipped_stale` + warn the re-link remedy.
- **Chosen:** no-op writes nothing (byte-stable).

## 4. HOW

`cmdHooksEnsure(args)` is the I/O shell; testable core is the pure `planStopHooks(settings, presentSubs, servedSubs)` → `{ added, already, skipped_stale, nextSettings }`.

```
PROCEDURE cmdHooksEnsure(args):
  1. root := --root or findRoot(); target := <root>/.claude/settings.json; local := <root>/.claude/settings.local.json
  2. parse target (→ {} + created:true if absent), local (→ {} if absent). Malformed EXISTING file → stderr fail-loud, return 2, NEVER write.
  3. resolvedBin := resolveBin()   # command -v faff (if served), else realpath(this binary)
  4. presentSubs := { s : isPresent(s,target) OR isPresent(s,local) }   # token identity
  5. servedSubs  := { s : probeServes(resolvedBin, s) }
  6. plan := planStopHooks(target, presentSubs, servedSubs)
  7. IF --dry-run OR plan.added empty: print result; DO NOT WRITE.
     ELSE write target := JSON.stringify(plan.nextSettings, null, 2) + "\n"
  8. warn each skipped_stale; print result (--json or human); return 0

PURE planStopHooks(settings, presentSubs, servedSubs):
  toAdd   := [ s in FAFF_STOP_HOOKS : s NOT in present AND s in served ]
  already := [ s in FAFF_STOP_HOOKS : s in present ]
  skipped := [ s in FAFF_STOP_HOOKS : s NOT in present AND s NOT in served ]
  next := deepCopy(settings)
  IF toAdd: ensure next.hooks.Stop is array; group := Stop[0] or push {hooks:[]}; for s in toAdd: group.hooks.push({type:"command", command: binInvocation(s)})
  RETURN { added: toAdd, already, skipped_stale: skipped, nextSettings: next }
```

`isPresent(sub, settings)`: scan every `settings.hooks.Stop[*].hooks[*].command`; true if, tokenised on whitespace, some token's basename is `faff`, followed by the subcommand token, with `--hook` present.

**Edge cases.** neither file → create settings.json with the shape; settings without `hooks` → add `hooks.Stop`, preserve keys; Stop with non-faff commands → append to first group; present in local only → `already`, no write; bin serves neither → both `skipped_stale`, untouched, exit 0; malformed → exit 2 no write.

**Anti-patterns.** exact-string match (re-adds duplicates); rewrite-on-no-op (reorders operator keys — don't write when added empty); register-without-probe (Stop-blocking exit-2 hook).

## 5. Scenarios
- runcheck present + bin serves prepcheck → append prepcheck, runcheck `already`, others preserved, exit 0.
- both present → nothing added, file not rewritten (byte-identical), exit 0.
- bin doesn't serve prepcheck → `skipped_stale:[prepcheck]` + warning, no broken hook, exit 0.
- malformed settings.json → exit 2, no write.
- first-run skill call with no faff Stop hook → set registered, no manual editing.
- pure planner does no I/O; `--selftest` runs with no filesystem.

## 8. DONE
- [ ] `faff hooks-ensure [--root] [--json] [--dry-run] [--selftest]` exists; wired into main() dispatch + USAGE + header comment.
- [ ] `--json` prints `{ path, created, bin, added, already, skipped_stale }`; exit 0 normal/no-op/stale-skip, 2 on malformed (no write).
- [ ] Adds only missing faff commands; preserves all other keys/hooks verbatim.
- [ ] Token-identity presence across both settings files (no duplicate, no clobber).
- [ ] No-op run writes nothing (settings file byte-identical).
- [ ] Creates settings.json with correct shape when absent.
- [ ] Stale-bin: unserved subcommand → `skipped_stale` + warning, no hook written.
- [ ] Registered invocation prefers on-PATH `faff`, falls back to running binary's real path; no `~/.claude/...` hardcode.
- [ ] `hooks-ensure --selftest` over in-memory cases, wired into validate.yml.
- [ ] `test/hooks-ensure.test.mjs`: add-missing, idempotent no-op (no write), preserve-other-settings, present-in-local-only, stale-bin skip, malformed→exit 2, create-when-absent.
- [ ] faff-onboard / faff-beep-boop / faff-prep call `faff hooks-ensure`; manual Stop-hook prose replaced.

confidence: high
