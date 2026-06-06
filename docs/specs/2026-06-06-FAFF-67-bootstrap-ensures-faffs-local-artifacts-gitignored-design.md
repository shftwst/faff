# Spec — FAFF-67: Bootstrap ensures faff's local artifacts are gitignored

This is the build spec for FAFF-67. It defines a deterministic CLI step that ensures a consuming project's `.gitignore` excludes faff's local artifacts — the `.faffrc` config and the `.faff/` directory. Audience: the build agent implementing it, and human reviewers checking the placement call.

## 1. WHY — Problem and Principles

**Problem statement.** faff writes two kinds of local artifact into a consuming repo — the `.faffrc` config and the `.faff/` directory (logs, runs, specs, calibration) — but nothing ensures they are gitignored, so they leak into commits (this exact bug left `.faff/` un-ignored in faff's own repo, and the gateway's claim that "`.faff/` is added to `.gitignore` on first write" is unimplemented). This change adds an idempotent, non-destructive "ensure gitignore" step that appends the faff-local patterns to `.gitignore` only if absent, runnable at bootstrap / first-run for any project, new or existing.

**Design principles.**

**Deterministic tools over prose.** The ensure operation is mechanical and must be byte-for-byte reproducible run-to-run — same `.gitignore` in, same `.gitignore` out. This is a tool's job (the bundled `faff` CLI), not an LLM-narrated edit. The whole point is that an agent never hand-edits `.gitignore` and never re-derives the pattern list.

**Non-destructive is a hard floor.** The step may only *append* missing patterns. It must never reorder, deduplicate, rewrite, or remove any existing line — including unrelated user content and pre-existing faff entries. A run against an already-correct `.gitignore` is a clean no-op that leaves the file byte-identical.

**Single source of truth for the pattern set.** The list of faff-local patterns is defined once, in the CLI, so bootstrap (FAFF-6) and the config writer (FAFF-5) both reach the same set rather than each hardcoding it — the same single-source discipline the control-label manifest (`faff labels`) already uses.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `skills/faff/bin/faff` | Node (CommonJS, no deps) | The bundled CLI this subcommand is added to — sibling to `config` / `runcheck` / `validate-adapters` / `labels` / `next`. |
| `findRoot()` in `bin/faff` | Node | Existing repo-root resolver (`.git` or `.faff` ancestor) — reused to locate the `.gitignore` target. |
| `cmdLabels` / `faff labels` | Node | Precedent for a manifest-style single-source-of-truth subcommand the rest of the suite reads from. |
| `skills/faff/SKILL.md` (gateway) | Markdown | Holds the unimplemented "`.faff/` added to `.gitignore` on first write" line (line ~387) this realises. |

**Scope statement.** This is the bootstrap-time repo-hygiene step for faff's own local artifacts; it sits beside the future config writer (FAFF-5) and bootstrap skill (FAFF-6) without depending on either being built first.

## 2. OUT OF SCOPE

- **What faff writes into `.faffrc`** — Why excluded: that's FAFF-5's deterministic writer. Extension point: the future `faff config init` subcommand in `bin/faff`, which would *call* this ensure step but owns config content separately.
- **The bootstrap conversation / MCP detection** — Why excluded: that's FAFF-6's conversational skill. Extension point: the bootstrap skill invokes this CLI step as one of its provisioning actions.
- **Ignoring `.claude/` local config (`settings.local.json`, `worktrees/`)** — Why excluded: that's FAFF-66's repo-hygiene pass, a different artifact owner (Claude Code, not faff). Extension point: FAFF-66 edits `.gitignore` directly for this repo; it is not folded into this general CLI step.
- **Un-ignoring / commit-logs opt-in** — Why excluded: the gateway already notes users may un-ignore `.faff/` to commit logs; this step only *adds* ignores, never enforces them, so a user's manual un-ignore is respected (see the no-op-when-present behaviour). Extension point: none needed — append-only is the seam.
- **Wiring bootstrap/first-run to actually call this** — Why excluded: there is no first-run trigger yet (FAFF-6, held). This ticket ships the callable step + the one real caller available today (faff's own repo, by running it). Extension point: FAFF-6's first-run trigger and FAFF-5's `config init` both call `faff gitignore-ensure`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| faff-local artifacts | The files/dirs faff writes into a consuming repo: the `.faffrc` config (any accepted form) and the `.faff/` directory. |
| ensure | Append a pattern to `.gitignore` only if no existing line already ignores it; otherwise no-op. |
| accepted `.faffrc` forms | The three runtime-valid config filenames: `.faffrc`, `.faffrc.yml`, `.faffrc.yaml`. |

**The pattern set (single source of truth).** A constant list in `bin/faff`:

```
FAFF_GITIGNORE_PATTERNS = [
  ".faffrc",            # bare legacy form
  ".faffrc.yml",        # legacy YAML form
  ".faffrc.yaml",       # canonical form
  ".faff/",             # the local artifacts dir (trailing slash = dir-only)
]
```

**Design decision — which `.faffrc` forms to ignore.** Options: (a) only the canonical form faff now writes (`.faffrc.yaml`); (b) all three accepted runtime forms. The config resolver (`findConfig`) treats all three as valid runtime configs (a legacy one is a loud error, but it is still a real local config a user might hold). Ignoring only the canonical form would leave a user's legacy-named local config exposed to a stray `git add`. The cost of the broader set is three extra ignore lines; the benefit is no accepted local config form can leak. **Chosen:** ignore all three accepted `.faffrc` forms plus `.faff/` — the broader set, matching the resolver's accepted-filename surface. This also matches the precedent already in faff's own `.gitignore` (all three `.faffrc*` forms are ignored there).

**Design decision — where the behaviour lives.** Options:

1. Inside `faff config init` (FAFF-5's writer) — fits "deterministic tools" but couples gitignore-ensure to a subcommand that **does not exist yet** (no `init` in `cmdConfig`, no writer in the CLI), making FAFF-67 block on FAFF-5 (Backlog).
2. The FAFF-6 bootstrap *skill* — but FAFF-6 is a conversational/MCP skill (held), and a `.gitignore` edit is pure deterministic mechanics that belongs in a tool, not agent prose (governing tenet).
3. A standalone `faff` CLI subcommand invoked by bootstrap — self-contained, no MCP, independently shippable today, callable by both FAFF-5's writer and FAFF-6's skill when they land.

**Chosen:** a standalone `faff gitignore-ensure` CLI subcommand (option 3) — rationale in §5.

**Interface.**

```
faff gitignore-ensure [--root DIR] [--json]
```

- `--root DIR` — repo root to operate on; defaults to `findRoot()` (the existing resolver), consistent with `cmdConfig`.
- `--json` — emit a machine-readable result (`{ path, added: [...], already: [...], created: bool }`) for a caller (bootstrap) to report; default is a short human line.
- Exit code: `0` on success (whether it added lines, no-op'd, or created the file); non-zero only on a real I/O error (unwritable path).

**Result shape (for `--json` and the return value):**

```
RECORD EnsureResult:
  path: string         # absolute path to the .gitignore acted on
  created: bool        # true if .gitignore did not exist and was created
  added: List<string>  # patterns newly appended this run (in pattern-set order)
  already: List<string> # patterns already covered, left untouched
  CONSTRAINT added ∪ already == FAFF_GITIGNORE_PATTERNS  (set-equal)
```

## 4. HOW — Behavior

**Architecture and approach.** A new `cmdGitignoreEnsure(args)` in `bin/faff`, dispatched from `main()` on the `gitignore-ensure` subcommand, listed in `USAGE` and the header comment. It reads `.gitignore` at the resolved root (or treats it as empty if absent), determines which patterns from `FAFF_GITIGNORE_PATTERNS` are not already present, appends the missing ones, and writes back. No dependencies; uses the already-imported `fs` / `path`.

**Presence test (what counts as "already ignored").** A pattern is "already present" if any existing non-comment line, trimmed, **equals** the pattern after normalising a trailing slash. The match is deliberately literal-with-slash-normalisation, not a full gitignore-semantics evaluator:

```
PROCEDURE is_present(pattern, existing_lines):
  norm = strip_trailing_slash(pattern)            # ".faff/" -> ".faff"
  FOR each line in existing_lines:
    t = line.trim()
    IF t == "" OR t startswith "#": continue       # skip blanks + comments
    IF strip_trailing_slash(t) == norm: RETURN true
  RETURN false
```

This catches the real duplication cases (`.faff/` vs `.faff`, and exact `.faffrc*` lines — which is how faff's own `.gitignore` already lists them) without trying to interpret globs, negations (`!`), or anchored paths. **Anti-pattern:** implementing a full gitignore matcher. Why: gitignore semantics (precedence, negation, `**`, anchoring) are large and error-prone; the contract here is only "don't add a line that's textually already there," and over-matching risks *failing to add* a needed pattern because some broad unrelated glob looked like a match.

**Append behavior.**

```
PROCEDURE gitignore_ensure(root):
  1. target = path.join(root, ".gitignore")
  2. existed = fs.existsSync(target)
  3. raw = existed ? read(target) : ""
  4. lines = raw.split newlines
  5. missing = [p for p in FAFF_GITIGNORE_PATTERNS if not is_present(p, lines)]
  6. IF missing is empty:
       RETURN { path: target, created: false, added: [], already: all-patterns }
  7. block = build_append_block(raw, missing)   # see below
  8. write(target, raw + block)
  9. RETURN { path: target, created: not existed, added: missing, already: covered }
```

**`build_append_block` — exact formatting (deterministic).**

```
PROCEDURE build_append_block(raw, missing):
  parts = []
  # ensure separation from prior content: exactly one blank line before our block,
  # unless the file is empty / brand new.
  IF raw != "" AND not raw.endsWith newline: parts.push(newline)   # finish a no-EOL last line
  IF raw.trim() != "": parts.push(newline)                         # one blank separator line
  parts.push("# faff local artifacts (added by `faff gitignore-ensure`)" + newline)
  FOR p in missing: parts.push(p + newline)
  RETURN parts.join("")
```

- A brand-new file gets the comment header + patterns, no leading blank line.
- An existing non-empty file gets exactly one blank separator line, then the header, then the missing patterns — never the already-present ones.
- Patterns are appended in `FAFF_GITIGNORE_PATTERNS` order for deterministic output.

**Idempotency guarantee.** Run twice in a row: the first run appends the block; the second run finds every pattern present (the header is a comment, skipped by `is_present`; each pattern line matches literally) → `missing` is empty → no-op, file byte-identical. This is the load-bearing property — the DONE checklist tests it directly.

**Edge cases and error handling.**

- **No `.gitignore`** → create it with the header + all patterns (`created: true`).
- **`.gitignore` exists but is empty / whitespace-only** → no separator blank line; write header + patterns.
- **Some patterns present, some absent** (e.g. faff's own repo today: `.faffrc*` present, `.faff/` absent) → append only the absent ones (`.faff/`), under one header block. `already` lists the three `.faffrc*` forms.
- **`.faff` present without trailing slash** → treated as already-present for `.faff/` (slash-normalised match); not re-added.
- **Unwritable path / I/O error** → propagate as a non-zero exit with a stderr message; do not partially write (single `fs.writeFileSync` of the full new content).

**Anti-pattern:** rewriting the whole file from a parsed model. Why: any normalisation (trimming, re-sorting, comment-stripping) violates the non-destructive floor. The implementation must be `raw + appended-block` — original bytes untouched.

**Gateway claim reconciliation.** The gateway line (`skills/faff/SKILL.md` ~line 387) currently says `.faff/` is added to `.gitignore` "on first write," which describes an unimplemented lazy behaviour. **Chosen:** reword it to point at this bootstrap-time CLI step rather than a per-write hook — the ensure runs at bootstrap/first-run (and can be re-run any time), not silently on every log write. Update the line to: ".faff/ and .faffrc are gitignored by `faff gitignore-ensure`, run at bootstrap/first-run (FAFF-67); idempotent and non-destructive. Users may un-ignore to commit logs." This keeps the gateway honest (no claim of unbuilt behaviour) without promising a per-write hook that this ticket does not build.

## 5. DESIGN DECISION RATIONALE

**Where does the gitignore-ensure live?**

- *Option 1 — inside `faff config init` (FAFF-5).* Pro: one bootstrap entrypoint. Con: `config init` does not exist (no `init` branch in `cmdConfig`, no writer); FAFF-5 is Backlog. Building FAFF-67 here forces a dependency on FAFF-5 and couples config-content writing with gitignore mechanics.
- *Option 2 — the FAFF-6 bootstrap skill.* Pro: bootstrap is the conceptual home. Con: FAFF-6 is a conversational/MCP skill (and `faff-automation-hold`); editing `.gitignore` is deterministic mechanics that the governing "deterministic tools over prose" tenet says belongs in a tool, not agent prose. A skill-authored `.gitignore` edit is exactly the prose-reliance the suite is reducing.
- *Option 3 — a standalone `faff gitignore-ensure` subcommand.* Pro: self-contained, no MCP, no deps; independently shippable today regardless of FAFF-5/6 status; both FAFF-5's writer and FAFF-6's skill can call it when they land; matches the existing one-concern-per-subcommand CLI shape and the `faff labels` single-source precedent. Con: one more subcommand (negligible).

**Chosen:** Option 3 — a standalone `faff gitignore-ensure` subcommand. Rationale: it satisfies the deterministic-tools tenet, decouples FAFF-67 from the unbuilt FAFF-5/6 (no build-order block), and gives both future callers a single shared mechanism. At the time of writing neither `faff config init` (FAFF-5) nor the bootstrap skill (FAFF-6) exists, so any in-host placement would block on unbuilt work; a standalone subcommand is the only option shippable now and reusable later.

**Which `.faffrc` forms to ignore?** **Chosen:** all three accepted forms (`.faffrc`, `.faffrc.yml`, `.faffrc.yaml`) plus `.faff/` — see §3. Ignoring only the canonical form would leave a legacy-named local config exposable.

**Keep / reword / remove the gateway "on first write" line?** **Chosen:** reword to describe the bootstrap-time CLI step (see §4) — it is now real, but as a bootstrap step, not a per-write hook; the wording must not promise behaviour this ticket doesn't build.

**Pattern presence test — literal-with-slash-normalisation vs full gitignore semantics.** **Chosen:** literal match with trailing-slash normalisation, skipping blanks/comments. A full matcher is out of proportion to the contract and risks under-adding. Temporal anchor: at the time of writing, faff ships no gitignore-parsing dependency and the no-deps constraint forbids adding one.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The placement question the ticket flagged for prep is resolved (standalone subcommand, §5) on defensible grounds — the alternatives block on unbuilt work or violate the deterministic-tools tenet.

**Assumptions.**

- **Assumes:** the `faff` CLI dispatch pattern (a `cmdX` function + a `main()` branch + a `USAGE` line) is the established way to add a subcommand. *Validation:* confirmed against `bin/faff` `main()` (lines ~707–718) and the existing `cmdConfig` / `cmdLabels` / `cmdNext` functions during explore — already true in the codebase.
- **Assumes:** `fs` and `path` are sufficient (no new deps). *Validation:* both are already `require`d at the top of `bin/faff`; the no-deps constraint is satisfied.

## 7. DONE — Definition of Done

### From WHY
- [ ] Running the step against a repo with no faff entries results in `.faffrc`, `.faffrc.yml`, `.faffrc.yaml`, and `.faff/` all ignored.
- [ ] The gateway no longer claims unimplemented "on first write" behaviour — its line describes the real bootstrap-time step.

### From WHAT (interface)
- [ ] `faff gitignore-ensure` exists as a subcommand: dispatched in `main()`, listed in `USAGE` and the header comment.
- [ ] `--root DIR` overrides the target root; absent, it uses `findRoot()`.
- [ ] `--json` emits `{ path, created, added, already }`; without it, a short human line is printed.
- [ ] The pattern set is a single named constant in `bin/faff` (single source of truth), containing exactly the three `.faffrc` forms and `.faff/`.

### From HOW (behavior)
- [ ] No `.gitignore` present → file is created with a `# faff local artifacts` header and all four patterns; `created: true`.
- [ ] Existing `.gitignore` missing only `.faff/` (faff's own repo case) → only `.faff/` is appended; the three `.faffrc*` lines are untouched and reported in `already`.
- [ ] Appended block is separated from prior non-empty content by exactly one blank line; a brand-new/empty file gets no leading blank line.
- [ ] Patterns are appended in constant order.

### From HOW (idempotency + non-destructive floor)
- [ ] Running the step twice leaves the file byte-identical after the first run (second run is a no-op; `added` empty).
- [ ] An existing `.faff` line without a trailing slash is treated as already-present for `.faff/` and not duplicated.
- [ ] No existing line (faff or user content) is ever reordered, removed, deduplicated, or rewritten — output is original bytes plus the appended block only.
- [ ] Exit code is 0 on add / no-op / create; non-zero only on a genuine I/O error, with no partial write.

**Integration smoke test:**

```
GIVEN a temp dir with a .gitignore containing ".faffrc / .faffrc.yml / .faffrc.yaml" lines (faff's-own-repo shape, .faff/ missing)
WHEN  faff gitignore-ensure --root <dir> --json
THEN  result.added == [".faff/"]
AND   result.already == [".faffrc", ".faffrc.yml", ".faffrc.yaml"]
AND   the file now ends with a "# faff local artifacts" header line followed by ".faff/"
AND   re-running yields added == [] and a byte-identical file
```

## Already shipped against this surface

No Done ticket implements gitignore-provisioning or a config writer — the premise is fully load-bearing, not superseded. Related, non-superseding work:

- **FAFF-66 (Todo, not merged)** — fixes *this repo's* `.gitignore` by hand (`.claude/settings.local.json`, `.claude/worktrees/`, the `.faffrc.example` rename) and flags `.faff/` as the same bug class. It is the manual one-off precedent for faff's own repo; FAFF-67 is the *general* CLI behaviour for any consuming project. Distinct deliverables — no overlap to narrow.
- **FAFF-5 (Backlog)** — `faff config init` deterministic `.faffrc` writer; does not exist in the CLI yet. A future caller of this step, not a superseder.
- **FAFF-6 (Backlog, `faff-automation-hold`)** — first-run bootstrap skill; MVP scope is the `tracking` block only, gitignore-ensure explicitly excluded. A future caller, not a superseder.

## Methodology critique

_Methodology: faffter-dark-methodology-agile-delivery_

- **Right-sized? (principle 4).** Well-sized. One cohesive concern — a single idempotent CLI subcommand plus a one-line gateway reword. Comfortably a 1–3 day unit; no split or merge indicated.
- **Workstream fit? (principles 1+5).** Outcome-coherent ("faff's local artifacts stay out of commits"). Sits naturally beside the bootstrap/config workstream (FAFF-5/6) without being bundled into either — the standalone-subcommand choice keeps it cohesive rather than smearing gitignore logic into the config writer.
- **Deps surfaced? (principle 6).** The ticket is `relatedTo` FAFF-5 / FAFF-6 / FAFF-66 but has **no blocker links** — correctly so. The spec's placement decision (standalone subcommand) deliberately removes any build-order dependency on FAFF-5/6, so there is no implicit blocker to surface. The relationship to FAFF-66 is precedent, not dependency. No missing blocker link.
- **Risk profile? (principle 7).** Low risk — no novel integration, no external dep, no new package (no-deps constraint upheld). The only real hazard is the non-destructive floor (never mangling existing `.gitignore` content), which the spec pins down with the byte-identical-idempotency DONE items and the "append raw bytes, never re-parse" anti-pattern. No de-risking spike warranted.

confidence: high
