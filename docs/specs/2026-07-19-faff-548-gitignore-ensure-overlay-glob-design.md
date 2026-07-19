# FAFF-548 — Ignore the faffrc overlay by glob, not the exact local name

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: high. Full spec on Linear FAFF-548.

This spec is for the build agent implementing FAFF-548 and for human reviewers. It hardens `faff gitignore-ensure` so every machine-local `.faffrc` overlay variant is gitignored, not just `.faffrc.local.yaml`, while the committed base `.faffrc.yaml` stays tracked.

## 1. WHY — Problem and Principles

**Load-bearing model.** `gitignore-ensure` owns one pattern list (`FAFF_GITIGNORE_PATTERNS`) that it appends, append-only and idempotently, to the repo `.gitignore`. Whatever is *not* in that list can be committed by accident. The list currently enumerates the overlay by its exact name, so it protects exactly one overlay filename.

**Problem statement.** `FAFF_GITIGNORE_PATTERNS` lists the literal `.faffrc.local.yaml`, so a machine-local overlay under any other name (`.faffrc.dev.yaml`, `.faffrc.machine.yaml`, …) is left committable. This change replaces the literal with a glob (`.faffrc.*.yaml`) that covers every overlay variant while leaving the base `.faffrc.yaml` tracked.

**Design principles.**

- **Never widen to the committed base.** `.faffrc.yaml` is the durable, shareable base config (FAFF-387: git is its backup + drift alarm). The chosen glob must not match it. `.faffrc.*.yaml` matches only names with a middle segment, so `.faffrc.yaml` is safe by construction — this is the property the whole change turns on.
- **Append-only, never remove.** The command must never drop an existing line (an existing `.faffrc.local.yaml` line, or an existing `.faffrc.yaml` line in an unmigrated repo). Migration off an old line is deliberate and human-driven, never an automated line-drop that could sweep a private value into a commit.
- **The literal matcher stays literal.** `gitignoreHasPattern` is deliberately not a gitignore-semantics evaluator. It must keep treating pattern lines as opaque strings — that is exactly what makes a glob line idempotent (it is "already present" only when the identical `.faffrc.*.yaml` string is already in the file, never because some file it *would* match is listed).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gitignore-ensure.js` | Node (no deps) | The command; the pattern set (L22-27) and `gitignoreHasPattern` (L37-45) both change/are-confirmed here |
| `plugin/skills/faff/bin/lib/config.js` | Node | `faff config check` posture finding — the deliberate-migration surface (unchanged, referenced) |

**Scope statement.** This is a one-file hardening of the bootstrap gitignore writer; it does not touch config resolution.

## 2. OUT OF SCOPE

- **Resolver awareness of non-`local` overlays.** The resolver still reads only `.faffrc.local.yaml`. A broadly-ignored `.faffrc.dev.yaml` is *not committed* but is also *not read* — a possible operator surprise. Excluded because it is a resolver/`config check` concern, not a gitignore-writer concern. Extension point: `faff config check` posture findings in `config.js` (warn on an ignored-but-unread overlay).
- **Migrating existing repos off the literal `.faffrc.local.yaml` line.** Excluded: append-only never rewrites existing lines. Extension point: the existing `config check` migration finding.
- **The stale-install field report.** The operator's sighting of `.faffrc.yaml` itself being ignored is **not reproducible on current `main`** (confirmed during prep: `git check-ignore .faffrc.yaml` reports it tracked; the SUT scaffolder `.gitignore` heredocs ignore only `node_modules/`, `dist/`, `*.log`, `.env.claude-box` — never `.faffrc.yaml`). It is a stale copy-install, not a code defect. Excluded from the code change; `faff doctor` (gateway doctor-at-entry) already surfaces stale copy-installs.

## 3. WHAT — the pattern set and matcher

**The new pattern set** (order matters — see HOW):

```
FAFF_GITIGNORE_PATTERNS = [
  ".faffrc",              # bare legacy form (unchanged)
  ".faffrc.yml",          # legacy YAML form (unchanged)
  ".faffrc.*.yaml",       # NEW: glob — every machine-local overlay variant
  "!.faffrc.example.yaml", # NEW: negation — keep the tracked template out of the glob
  ".faff/",               # local artifacts dir (unchanged, stays last)
]
```

- `.faffrc.local.yaml` (the old literal) is **removed from the set** — the glob covers it. Append-only guarantees any existing literal line in a real repo is preserved untouched.
- **Design decision — glob vs enumerate recognised names.** Options: (a) glob `.faffrc.*.yaml` covering *all* variants; (b) enumerate only resolver-recognised overlay names (today just `.faffrc.local.yaml`). **Chosen:** glob (a). Rationale: the writer's job is the safety property "never commit a machine-local overlay"; enumerating leaves every non-`local` variant committable, which is the exact defect. The counter-risk (an ignored file the resolver won't read) is a non-committing, recoverable surprise addressed out-of-band by `config check`, strictly less bad than leaking a private value into a commit.
- **Design decision — negation placement.** **Chosen:** `!.faffrc.example.yaml` immediately follows `.faffrc.*.yaml` in the array. Rationale: git applies a negation only if it comes *after* the matching ignore line; the append writer emits `missing` in array order, so array order is file order.
- **Design decision — matcher.** **Chosen:** `gitignoreHasPattern` is unchanged. Rationale: its literal, non-glob-expanding comparison is correct for these lines — it makes both the glob and the negation idempotent (present iff the identical string is present) and cannot over-match. No negation-aware or glob-aware logic is added.

## 4. HOW — Behavior

The only functional change is the contents of `FAFF_GITIGNORE_PATTERNS`. `gitignoreEnsure`, `buildGitignoreAppendBlock`, and `gitignoreHasPattern` are unchanged in logic.

**Behaviour on a fresh repo (no faff lines yet):** all faff patterns — `.faffrc`, `.faffrc.yml`, `.faffrc.*.yaml`, `!.faffrc.example.yaml`, `.faff/` — are missing, so the append block writes them under the header in array order. `.faffrc.*.yaml` lands before `!.faffrc.example.yaml`, so the negation is effective.

**Behaviour on an existing repo that already ignores `.faffrc.local.yaml`:**

```
PROCEDURE ensure(existing_lines):
  1. .faffrc, .faffrc.yml               -> already present (unchanged)
  2. .faffrc.*.yaml                     -> NOT literally present -> appended
  3. !.faffrc.example.yaml              -> NOT literally present -> appended (after the glob)
  4. .faff/                             -> already present (unchanged)
  # the pre-existing literal `.faffrc.local.yaml` line is NEITHER in the new set NOR removed:
  # append-only leaves it in place; it and the glob coexist harmlessly.
```

**Idempotency:** a second run finds `.faffrc.*.yaml` and `!.faffrc.example.yaml` literally present -> both filtered out of `missing` -> byte-identical no-op.

**Anti-pattern:** teaching `gitignoreHasPattern` to expand globs so it treats `.faffrc.local.yaml` as "covered by" `.faffrc.*.yaml`. Why: it would make the writer skip appending the glob when only the old literal is present, and re-introduces exactly the full-evaluator over-matching the matcher is documented to avoid.

**Failure modes.**

- **The failure:** the negation is ordered before the glob (e.g. a future edit reorders the array), making `.faffrc.example.yaml` handling order-fragile. **How you'd know:** the `--selftest` order assertion fails; `git check-ignore .faffrc.example.yaml` returns a match. **What it means:** fix array order — proceed.
- **The failure:** `.faffrc.example.yaml` isn't actually tracked in this repo, so the negation appears to do nothing. **How you'd know:** `git check-ignore` shows it neither ignored nor tracked. **What it means:** harmless — a gitignore negation of a not-yet-present template is a defensive no-op that becomes load-bearing the moment the template is added. Proceed; no assumption blocks the change.

## 5. Scenarios

```
Given a repo whose .gitignore has no faff lines
When `faff gitignore-ensure` runs
Then .gitignore contains `.faffrc.*.yaml` on a line strictly before `!.faffrc.example.yaml`
 And `git check-ignore .faffrc.dev.yaml` matches (ignored)
 And `git check-ignore .faffrc.local.yaml` matches (ignored)
 And `git check-ignore .faffrc.yaml` returns no match (tracked base)
 And `git check-ignore .faffrc.example.yaml` returns no match (tracked template)
```

```
Given a .gitignore that already contains `.faffrc.*.yaml` and `!.faffrc.example.yaml`
When `faff gitignore-ensure` runs again
Then the file is byte-identical (idempotent no-op)
```

- The pure-function pattern set MUST place the glob at an index lower than the negation (order assertion, checkable without git).

## 6. DESIGN DECISION RATIONALE

**Glob or enumerate the overlay names?** (a) glob `.faffrc.*.yaml` / (b) enumerate recognised names. Glob covers all variants but ignores files the resolver won't read; enumerate is precise but leaves non-`local` variants committable. **Chosen:** glob — not-committing is the writer's safety mandate, and the ignored-but-unread surprise is recoverable and handled by `config check`.

**Keep the `.faffrc.local.yaml` literal alongside the glob?** Keeping it is redundant (the glob covers it) and clutters fresh `.gitignore`s. **Chosen:** drop it from the set; append-only preserves any existing literal line in real repos, so no repo regresses.

**Change the matcher to understand the negation/glob?** **Chosen:** no — the literal matcher is correct and any glob-awareness re-introduces over-matching. Temporal anchor: correct as long as `gitignoreHasPattern` remains a bootstrap idempotency check, not a gitignore evaluator.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the glob-vs-enumerate question is resolved (Chosen: glob).

**Assumptions:** none that block the build. The negation line is correct whether or not `.faffrc.example.yaml` is currently tracked.

## 8. DONE — Definition of Done

### From WHAT (pattern set)
- [ ] `FAFF_GITIGNORE_PATTERNS` contains `.faffrc.*.yaml` and `!.faffrc.example.yaml`, with the glob at a lower index than the negation.
- [ ] `FAFF_GITIGNORE_PATTERNS` no longer contains the literal `.faffrc.local.yaml`.
- [ ] `.faffrc.yaml` is not in the set and is never appended.
- [ ] The `FAFF-387` header comment block (L14-27) is updated to describe the overlay glob rather than the exact local name.

### From HOW (behaviour)
- [ ] Fresh repo: `git check-ignore` reports `.faffrc.dev.yaml` and `.faffrc.local.yaml` ignored, `.faffrc.yaml` and `.faffrc.example.yaml` tracked.
- [ ] The appended negation line follows the glob line in `.gitignore`.
- [ ] Second run is a byte-identical no-op (idempotent).
- [ ] An existing repo's pre-existing `.faffrc.local.yaml` line is preserved (append-only).
- [ ] `gitignoreHasPattern` logic is unchanged.

### From test coverage
- [ ] A `faff gitignore-ensure --selftest` subcommand exists and asserts: fresh-repo append content + glob-before-negation order; idempotent no-op on re-run; existing-literal preservation; `.faffrc.yaml` never added. It follows the sibling `--selftest` convention (per-case ok/FAIL + a RESULT line, non-zero exit on any failure) and is wired into the same CI check the other `--selftest`s run under.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. In a temp git repo with an empty .gitignore, run `faff gitignore-ensure`.
  2. Assert `git check-ignore .faffrc.machine.yaml` exits 0 (ignored).
  3. Assert `git check-ignore .faffrc.yaml` exits 1 (tracked).
  4. Run `faff gitignore-ensure` again; assert .gitignore is byte-identical.
```

confidence: high
spec-review: approve
