# FAFF-387 — Factory-state backup & recovery: commit the control panel, overlay the local bits

> Spec: faffter-dark-nlspec · 2026-07-08 · autonomous · confidence: high. Full spec on Linear FAFF-387.

This is the build spec for FAFF-387. Audience: the build agent implementing it and human reviewers. It settles both of the ticket's open questions (scope and mechanism) from tracker + codebase evidence and defines a deterministic, testable delivery.

## 1. WHY — Problem and Principles

**Load-bearing model: git is the backup and the drift alarm.** `.faffrc.yaml` never holds raw secrets by schema construction (`api_key_env` stores an env-var *name*; `review-call.mjs:590` reads the key from `process.env` — the value never touches the file), so the file is safe to commit. Once committed, recoverability is `git checkout`, history is `git log`, and silent wholesale drift becomes a visible working-tree diff. Machine-local values move to a gitignored overlay (`.faffrc.local.yaml`) so commit-by-default is actually adoptable, and a new deterministic `faff config check` surfaces posture gaps and secret-looking values loudly.

**Problem.** `.faffrc.yaml` is gitignored, unbacked-up, and was silently corrupted on 2026-07-01 (a wholesale agent rewrite dropped the `faffter_dark.adversarial` block, unnoticed). Corruption or loss is unrecoverable and undetectable today — the factory's control panel is its least durable artifact. The tracker owner has resolved the direction (comment, 2026-07-07): the rc file describes durable behaviour and should be committed; secrets always come from env.

**Design principles.**

- **Fail-safe migration.** faff never auto-commits, never auto-un-gitignores, never edits an existing repo's `.gitignore` outside the bootstrap `gitignore-ensure` path. Existing installs are *flagged and guided*; only new bootstraps get the new posture by default. A botched auto-migration could publish a value the operator considers private — the exact class of harm this ticket exists to prevent.
- **Recommended posture, not forced.** An operator may keep the whole rc gitignored; everything keeps working. `config check` findings are advisory at entry (warn, never block); only a repo's own CI may choose to fail on them. (Configurable-not-opinionated.)
- **No secrets in committed config, mechanically checked.** The schema already keeps key values out; the secret scan makes it a checked invariant rather than a convention.
- **Never echo a suspected secret.** Findings print the key path and a redacted prefix only — a checker that prints the secret into a log recreates the leak it guards against.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | Node (single file, no deps) | `parseYamlSubset` (~L112–228), config resolution `findConfigIn` (~L249, worktree fallback L260–286), `config` subcommands (~L802–968), surgical `config init` writer (~L445–692), `doctor` (~L7500), `gitignore-ensure` canonical set (~L5194) |
| `.gitignore` (repo root, L5–15) | — | Current posture: ignores `.faffrc`, `.faffrc.yml`, `.faffrc.yaml`, `.faff/`; `.faffrc.example.yaml` stays tracked |
| `.faffrc.example.yaml` | YAML | Committed template; documents `api_key_env` = env-var name, never the key |
| `plugin/skills/faff-graft/setup-worktree.sh` (L47) | Bash | Copies gitignored `.faffrc.yaml` into new worktrees (FAFF-186/208) |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` (L575, L590) | Node | Proof that credentials resolve from env by name — config never holds a key value |
| `plugin/skills/faff/SKILL.md` (Configuration section) | Prose | Gateway config rules to update (two-file model, no-hand-writes) |
| `test/` (`config-defaults`, `config-worktree-fallback`, `doctor`, `cli-coverage` `.test.mjs`) + `.github/workflows/validate.yml` | Node test / CI | Test + CI harness the new behaviour slots into |

**Scope statement.** This changes the faff CLI's config resolution + adds one CLI checker + adjusts bootstrap/worktree/doc surfaces; it does not touch the build pipeline, contracts, or any slot.

## 2. OUT OF SCOPE

- **`.faff/` run-state durability** (run ledgers, prep/provenance markers, calibration, git-only specs) — the ticket's scope question, settled *out*: `.faff/` is operational run state; the irreplaceable parts are append-only *history* whose loss degrades audit, not factory behaviour; committing them would inject per-run noise into every PR and race concurrent runs. `.faff/` stays gitignored (FAFF-67 posture unchanged). *Extension point:* a future snapshot/export ticket over `.faff/provenance` + `.faff/calibration`; the `gitignore-ensure` set in `bin/faff` is where any posture change would land.
- **CLI pre-write backup of the rc file** — git history covers the committed base, and `config init` is already surgical with a parse round-trip abort (~L637). A `.bak` file is a second unmanaged artifact with no drift signal. *Extension point:* `cmdConfigInit`, if a future writer grows riskier semantics.
- **Env-var interpolation in config values** (`${VAR}` expansion) — unneeded; the `*_env` name-indirection pattern already keeps values out. *Extension point:* `parseYamlSubset` callers.
- **Auto-migration of existing repos, including this repo's own config split** — deciding which current values are machine-local (e.g. a private Tailscale hostname in `faffter_dark.adversarial.fallbacks`) is the operator's call. The build ships mechanism + guidance; the human performs the split (documented follow-up, HOW §Migration).
- **Comment-preserving YAML re-serializer** — the writer stays surgical raw-text; full round-trip serialization is disproportionate.
- **Doctor exit-code surface changes** — `doctor`'s exit 1 already means "copy-install" and triggers the gateway's `faff sync` repair offer; config findings get their own command instead (rationale §6).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| base file | `.faffrc.yaml` at repo root — the durable, committable config |
| local overlay | `.faffrc.local.yaml` at repo root — optional, gitignored, machine-local values |
| posture | whether the base file is tracked by git (migrated) or ignored (legacy) |
| finding | one `config check` result line: `severity · key/surface · message` |

**Resolution model.**

```
RESOLUTION ORDER (highest wins):
  1. .faffrc.local.yaml   # optional overlay — parse error is LOUD (exit 2), never silently skipped
  2. .faffrc.yaml         # optional base
  3. DEFAULTS registry    # unchanged

MERGE(base, overlay):
  maps      → deep-merge per key, overlay wins per leaf
  sequences → replaced wholesale by overlay (never element-merged)
  scalars   → overlay wins
```

- Legacy names (`.faffrc`, `.faffrc.yml`) still loud-error; `.example` files still never load. `.faffrc.local.yml`/bare `.faffrc.local` are legacy-shaped too — same loud error.
- Every existing read path (`config get/dump/resolved`, spec-docs-path, worktree fallback) resolves over the *merged* document. With no overlay present, behaviour is byte-for-byte today's.

**CLI surface changes.**

| Command | Change |
|---|---|
| `config path` | Prints each resolved file on its own line, base first. Exit 3 only when *neither* exists (first-run offer semantics preserved). |
| `config resolved` | Echoes both file paths (`config:` + `config local:` lines) so an active overlay is visible in run banners, never silent. |
| `config get/dump` | Operate on the merged document. No new flags. |
| `config init` | Unchanged — writes the base file only. |
| `config check` (**new**) | Deterministic posture + integrity checker. Read-only, no tracker access, no writes. `--selftest` runs its in-memory table tests (secret patterns + merge cases). |
| `gitignore-ensure` | Canonical set becomes `[".faffrc", ".faffrc.yml", ".faffrc.local.yaml", ".faff/"]` — `.faffrc.yaml` is no longer ignored on new bootstraps. Existing `.gitignore` lines are never removed by this command (append-only, as today). |

**`config check` — checks and exit codes.**

| # | Check | Finding when |
|---|---|---|
| 1 | base/overlay parse | either present file fails `parseYamlSubset` |
| 2 | posture | base exists but is git-ignored (`git check-ignore`) or untracked (`git ls-files`) → "unmigrated/uncommitted — unrecoverable if corrupted" + migration steps |
| 3 | overlay hygiene | overlay exists but is *not* git-ignored (about to be committed) |
| 4 | secret scan | any scalar value in either file matches the Appendix A patterns → redacted finding |
| 5 | legacy filename | `.faffrc` / `.faffrc.yml` present (mirrors the existing loud error as a finding) |

Exit: `0` clean (including "no config at all — defaults" and "not a git repo — posture checks skipped, reported as skipped"); `1` ≥1 finding; `2` unreadable/parse failure. Output is one line per finding: `severity`, key path or surface, message; suspected secrets render as key path + value length + first 4 chars only.

**Wiring (advisory only).**

- Autonomous entry (beep-boop/lights-out banner step): run `config check`, log findings to the run log + `/faff-wtf`-visible surface, continue unchanged. Never blocks, mirroring the container/branch-protection preflights' `warn` default.
- Interactive gateway entry: one advisory line when findings exist; never a gate, never nags twice a turn.
- `setup-worktree.sh`: add `.faffrc.local.yaml` to the copy loop; keep `.faffrc.yaml` in it (still needed for unmigrated repos). Extend the FAFF-208 linked-worktree fallback to the overlay file.

**Docs (same PR — a stale doc is a defect).** `docs/cli.md` (+`config check`, updated `config path`/`resolved` semantics); `.faffrc.example.yaml` header comment (two-file model + posture recommendation); gateway `SKILL.md` Configuration section (two-file resolution, committed-base posture, and an explicit extension of the CLI-only rule: **no skill or agent hand-writes any rc file** — `config init` is the only writer, matching the onboard skill's existing rule); `faff-onboard` SKILL.md (bootstrap now recommends committing the base file).

**Design decisions (markers).**

- Mechanism — commit the base + gitignored local overlay. **Chosen:** committed `.faffrc.yaml` + optional `.faffrc.local.yaml` overlay.
- Scope — rc file only. **Chosen:** `.faffrc.yaml` (+overlay); `.faff/` stays gitignored and out of scope.
- Checker home — new subcommand, not doctor. **Chosen:** `faff config check`.
- Merge semantics — **Chosen:** deep-merge maps, wholesale-replace sequences.
- Overlay naming — **Chosen:** `.faffrc.local.yaml` (precedent: `.claude/settings.local.json`, `.env.local` — both already in the worktree copy loop).
- **Assumes:** `git` is available in consumer repos (faff already requires a git repo for every flow). Validation: `config check` degrades posture checks to "skipped" outside a git repo — build agent verifies with a non-repo tmp-dir test.
- **Assumes:** the `*_env` name-indirection is the only credential pattern in the schema. Validation: grep `review-call.mjs` for `process.env` + `apiKey` (confirmed at L575/L590 at time of writing); the secret scan is the backstop if a future key sneaks in.

## 4. HOW — Behavior

**Architecture.** All new logic lands in `bin/faff` (single-file, stdlib-only — `child_process.execFileSync` for the two git probes is stdlib and acceptable). No new contract block, no new slot: `config check` is a plain deterministic checker in the `doctor`/`eligible` family.

```
PROCEDURE resolveConfig(cwd):                    # replaces single-file lookup
  1. loudly error on any legacy-named rc file (unchanged)
  2. base    := parse .faffrc.yaml if present    # parse error → loud exit 2
  3. overlay := parse .faffrc.local.yaml if present  # parse error → loud exit 2 (never skip)
  4. RETURN { doc: MERGE(base, overlay), paths: [basePath?, overlayPath?] }
  # worktree fallback (FAFF-208): apply the same two-file lookup in the main
  # checkout when a linked worktree has neither file; per-file fallback —
  # a worktree-local overlay still merges over a fallen-back base.
```

```
PROCEDURE cmdConfigCheck(cwd):
  findings := []
  1. run resolveConfig in "collect" mode — parse failures become findings (and exit 2)
  2. IF in a git repo:
       a. base present AND (check-ignore says ignored OR ls-files says untracked)
          → finding: posture, with the 3 migration steps (HOW §Migration)
       b. overlay present AND NOT ignored → finding: overlay hygiene
     ELSE record "posture checks skipped (not a git repo)"
  3. FOR each scalar leaf in base+overlay: secret-scan per Appendix A
       → finding renders keyPath + "len=N" + first 4 chars, NEVER the value
  4. legacy filename present → finding
  5. print findings; exit 1 if any (parse failure already exited 2); else 0
```

**Secret-scan behaviour summary.** Two complementary detectors — known credential prefixes, and a generic high-entropy shape gated on key-name — tuned for near-zero false positives on real config (hosts, model ids like `qwen3-next:80b-a3b-instruct-q4_K_M`, and paths all contain `. : /` separators the generic detector excludes; `*_env` keys are exempt by design).

**Migration (human-performed; the finding's message body).**

```
1. Move machine-local values (private hosts, personal model prefs) into .faffrc.local.yaml
2. Edit .gitignore: drop the `.faffrc.yaml` line; add `.faffrc.local.yaml`
3. Run `faff config check`, then commit .faffrc.yaml
```

This repo's own migration is exactly this, performed by the operator after merge (the PR must not flip this repo's `.gitignore` for `.faffrc.yaml` — doing so before the human splits out the private host risks a broad `git add` sweeping it into a commit).

**Edge cases.**

- Overlay only, no base → valid (all-overlay config); `config path` prints the overlay; exit 0.
- Neither file → all defaults; `config path` exit 3; `config check` exit 0 ("no config — defaults").
- Overlay parse error → exit 2 everywhere (fail loud; a half-applied overlay silently reverting to base values is the FAFF-50 silent-default failure reborn).
- Not a git repo → posture checks skipped + said so; parse/secret checks still run.
- First-run stub write (gateway decline path) → unchanged; the stub base file is now simply committable.

**Failure modes.**

- **The heuristic misses a novel secret format.** How you'd know: a credential lands in a committed rc discovered later. What it means: extend the Appendix A table (it is data, one row per pattern) — the committed-file posture still *localises* the leak to a reviewable diff, which is strictly better than today's invisible file.
- **An operator commits a value they later consider private (not a secret, just private — e.g. an internal hostname).** How you'd know: they spot it in the diff/PR — the posture makes it reviewable pre-push. What it means: move it to the overlay; document the overlay's purpose prominently in the example file.
- **Overlay/base divergence confuses debugging ("why is this value X?").** How you'd know: support questions where `config get` ≠ the committed file. Mitigation is built in: `config resolved` names both files, so the run banner shows an active overlay.

**Anti-patterns.** `config check` never writes anything. `gitignore-ensure` never removes existing ignore lines. No skill/agent ever hand-writes an rc file (CLI-only, both directions). Entry wiring never blocks or prompts.

## 5. SCENARIOS

```
Given a committed .faffrc.yaml
When any process wholesale-rewrites it (the 2026-07-01 failure mode)
Then `git status`/`git diff` show the change and `git checkout -- .faffrc.yaml` restores it
  (AC: restorable + silent wholesale drift detectable)

Given a repo where .faffrc.yaml exists but is git-ignored (legacy install)
When `faff config check` runs
Then it exits 1 with a posture finding containing the 3 migration steps

Given a base file and an overlay that overrides one nested leaf
When `faff config get` reads that leaf and a sibling leaf
Then the overridden leaf returns the overlay value and the sibling returns the base value

Given a base file containing `api_key: sk-...<40 chars>`
When `faff config check` runs
Then it exits 1 with a secret finding showing the key path and first 4 chars only — never the value

Given no overlay file
When any faff CLI config read runs
Then output is byte-for-byte identical to the pre-change CLI (back-compat assertion)
```

Assertions: `config check` performs no writes and no network; entry wiring never blocks a run at any appetite.

## 6. DESIGN DECISION RATIONALE

- **Which mechanism: backup file vs redacted committed copy vs committed base + overlay?** A timestamped backup file recovers loss but detects nothing and adds a second unmanaged artifact. A redacted committed *copy* (generated from the secretful real file) is two sources of truth that drift — the generator is itself a wholesale writer, the hazard class under repair. The committed base + gitignored overlay keeps one source of truth per key, gets recovery *and* drift detection from git for free, and matches the tracker owner's explicit resolution (2026-07-07 comment). It is viable precisely because the schema already keeps secrets out (`api_key_env` names, `review-call.mjs:590`). **Chosen:** committed `.faffrc.yaml` + optional `.faffrc.local.yaml` overlay.
- **Scope: rc-only or also `.faff/`?** `.faff/` loss degrades audit history, not factory behaviour; committing it pollutes every PR and races concurrent runs; the motivating incident was config. **Chosen:** rc-only; `.faff/` posture unchanged (see OUT OF SCOPE for the extension point).
- **Checker in `doctor` or its own subcommand?** Doctor's exit 1 already carries a specific meaning (copy-install) with a specific gateway repair offer (`faff sync`); overloading it would mis-route config findings into a re-link prompt. **Chosen:** new `faff config check`, doctor untouched.
- **Merge semantics for sequences?** Element-wise merging of arrays (e.g. `fallbacks`) is ambiguous (by index? by key?) and surprising. **Chosen:** overlay replaces sequences wholesale.
- **Overlay name?** **Chosen:** `.faffrc.local.yaml` — mirrors `settings.local.json`/`.env.local`, both already handled by the worktree copy loop, so the convention is pre-taught.
- At the time of writing, `git check-ignore`/`git ls-files` are the portable posture probes; if the CLI ever drops shelling out, `.gitignore` parsing in-process is the fallback.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — both ticket questions are closed above (scope: rc-only; mechanism: committed base + overlay), grounded in the owner's resolution comment and codebase evidence.

**Assumptions** (collected from §3, each with validation):

- **Assumes:** `git` present in consumer repos — validate via the non-git-repo degradation test.
- **Assumes:** `*_env` indirection is the schema's only credential pattern — validate by grepping `review-call.mjs` before build; the secret scan backstops future drift.

## 8. DONE — Definition of Done

### From WHY
- [ ] The 2026-07-01 failure mode is demonstrably recoverable + detectable: scenario 1 exercised in a test fixture repo (rewrite → diff visible → checkout restores).

### From WHAT (resolution model + CLI)
- [ ] Two-file merged resolution live in every config read path; deep-merge maps / replace sequences; overlay parse error exits 2 loudly.
- [ ] No-overlay behaviour byte-for-byte unchanged (existing config tests still green, plus an explicit back-compat case).
- [ ] `config path` multi-line + exit-3-only-when-neither; `config resolved` echoes both paths.
- [ ] `faff config check` implements checks 1–5 with exit 0/1/2 as specified; `--selftest` covers the secret-pattern + merge tables.
- [ ] Secret findings are redacted (key path + length + 4-char prefix); a test asserts the raw value never appears in output.
- [ ] `gitignore-ensure` emits the new canonical set (no `.faffrc.yaml`; adds `.faffrc.local.yaml`) and never removes existing lines.
- [ ] `setup-worktree.sh` copies `.faffrc.local.yaml`; FAFF-208 fallback covers the overlay (per-file).

### From HOW (edge cases)
- [ ] Overlay-only, neither-file, not-a-git-repo, and legacy-name cases behave as §4 specifies (tests for each).

### From WHAT (docs — same PR)
- [ ] `docs/cli.md`, `.faffrc.example.yaml`, gateway `SKILL.md` Configuration section (incl. the no-hand-writes rule), and `faff-onboard` SKILL.md updated; `faff validate-adapters` green.
- [ ] This repo's `.gitignore` deliberately NOT flipped for `.faffrc.yaml` (human migration follow-up stated in the PR description).

### Integration smoke test
```
tmp git repo → write .faffrc.yaml (one nested block) + .faffrc.local.yaml (override one leaf)
→ faff config get returns overlay value           # merge plumbing connected
→ faff config check exits 1 (base untracked)      # posture check connected
→ git add + commit base, re-run check → exit 0    # clean posture
→ append `token: <40-char blob>` to base → check exits 1, output redacted
```

(No new LLM-judgement seam — all additions are deterministic CLI — so no eval-coverage item.)

## Appendix A — secret-scan patterns

| Detector | Pattern | Notes |
|---|---|---|
| Known prefixes | `sk-`, `ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_`, `AKIA`, `xox[baps]-`, `nvapi-`, `AIza`, `-----BEGIN ` | value-anchored, any key |
| Generic shape | key name matches `/key\|token\|secret\|password\|credential/i` AND key does not end `_env` AND value is ≥32 chars of `[A-Za-z0-9+/=_-]` containing no `.` `:` `/` | separator exclusion clears hosts, model ids, paths |

Table is data (one row per pattern) so extending it is a one-line change + a selftest row.

## Already shipped against this surface

Related Done work (context — none supersedes this premise): FAFF-67 established the gitignore posture this partially reverses; FAFF-66 standardised `.faffrc.yaml` + example; FAFF-5/6 built the surgical `config init` writer + onboard flow this reuses unchanged; FAFF-50/182 made config access CLI-only (this extends the rule to writes); FAFF-186/208 built the worktree copy/fallback this extends to the overlay; FAFF-190/200/204/299 are the doctor/sync precedent motivating a separate `config check`; FAFF-262 gave the parser the sequences the merge rule covers; FAFF-92/48 provide the test + CI harness. No Done ticket delivers backup, recovery, or drift detection — premise holds.

## Methodology critique

*(agile-delivery lens, `issue-critique` — advisory, does not gate promotion)*

- **Right-sized?** One cohesive 1–3-day unit. The overlay resolution and `config check` could split mechanically, but the checker's posture rules are meaningless without the posture itself — always-ships-together; keep merged.
- **Workstream fit?** Team-level (no project). Outcome-wise it belongs with the "Repo is safe to open to the public" durability theme; advisory: consider rehoming when that project is active.
- **Deps surfaced?** No blockers. Touches the FAFF-208 fallback surface and gateway Configuration prose — same-PR edits, no cross-ticket dep to draw.
- **Risk profile?** Low — deterministic CLI over existing parser; no novel integration; the one behavioural risk (back-compat of resolution) carries an explicit byte-for-byte DONE item.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
