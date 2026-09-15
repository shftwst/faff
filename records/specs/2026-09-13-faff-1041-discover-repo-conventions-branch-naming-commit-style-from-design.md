# Discover repo conventions from standards docs + git history

> Spec: faffter-dark-nlspec · 2026-09-13 · autonomous · claude-code/unknown · confidence: high · build-tier: complex · spec-review: approve. Full spec on Linear FAFF-1041.

This spec addresses FAFF-1041. It is written for the build agent that will implement convention discovery and for the human reviewers gating the approach. It specifies a deterministic discovery pass that lets faff **conform** to a host repo's stylistic conventions (branch naming, commit-message grammar) instead of imposing its own.

## 1. WHY — Problem and Principles

**The load-bearing model:** faff should learn a repo's stylistic conventions the same way it already learns a repo's *infra* (`faff profile mine`) and its *CI gates* (`faff gates discover`) — a deterministic, read-only archaeology pass that reads what is already committed (standards docs, then git history), reports evidence-bearing facts, and is consulted at every site that currently hardcodes an opinion. Discovery never guesses: below a confidence bar it falls back to faff's current default, so an adopter repo is never worse off than today.

**Problem statement.** faff hardcodes its own stylistic opinions — branch naming (`<issue>-<slug>`), Conventional-Commits message grammar (`docs(<issue-id>): add spec …`), and PR-title shape — and imposes them on every repo it grafts in. Dropped into an established repo with its own documented or evident conventions, faff feels like a foreign body and papercuts every graft. This change makes faff discover-and-conform to the repo's own stylistic conventions, defaulting to today's behaviour only when the repo signals nothing.

**Design principles.**

**Adopt, don't impose (the tenet this ticket serves).** Where a repo has spoken — in a standards doc or clearly in its history — faff conforms. This governs every consumption site: a hardcoded convention string is replaced by a resolver call, never left as a silent default that overrides the repo.

**Never adopt a guessed convention.** A noisy or inconsistent history must not silently flip a convention. Inference adopts only above a dominance threshold; below it, discovery returns the faff default and records the ambiguity. A wrong-but-confident adoption (e.g. flipping to a commit grammar the repo's own CI then rejects) is worse than keeping the default, so the fail direction is always toward the default.

**Stylistic opinion is not a CI gate.** Some apparent faff opinions are the repo's *enforced* gates — the `dco` sign-off check, a Conventional-Commits PR-title check — already discovered by `faff gates discover` (reads `.github/workflows`) and authoritative. This pass covers only the *stylistic, non-gated* conventions faff assumes; where a real CI gate exists, faff conforms to the gate (existing machinery), never re-infers it here.

**Deterministic tool, not skill prose.** The discovery, precedence, and threshold logic is a testable CLI (mirroring `profile.js` / `gates.js`), never prose in a `SKILL.md`. Same input ⇒ same output.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/profile.js` | Node (CLI lib) | The precedent: a read-only repo-miner emitting a `faff-contract:*` block, cached to `.faff/*.json`, overlaid by `.faffrc`. This spec mirrors its shape. |
| `plugin/skills/faff/bin/lib/gates.js` | Node (CLI lib) | `faff gates discover` reads `.github/workflows` for real CI gates — the authoritative gate side this pass defers to. |
| `plugin/skills/faff-graft/setup-worktree.sh` | Bash | Creates the worktree branch from a name passed by graft — a branch-naming consumption site. |
| `plugin/skills/faff-graft/SKILL.md` | Prose (skill) | Hardcodes branch-name resolution (Step 3) and Conventional-Commits messages (Steps 4, 4c, merge-time ADR renumber) + PR creation (Step 9b). |
| `plugin/skills/faff/bin/lib/pr-body.js` | Node (CLI lib) | Composes the PR body. The PR title is **implicit** today — graft Step 9b runs `gh pr create --body-file …` with **no `--title`**, so gh derives the title from the branch's commit subject; conforming commit grammar therefore already flows into the PR title. |
| `plugin/skills/faff/bin/lib/config.js` | Node (CLI lib) | `faff config get/set` — the explicit-config precedence tier. |

**Scope statement.** This is a new leaf in faff's "repo archaeology" family (infra profile, CI gates, now stylistic conventions), consumed by faff-graft at branch/commit/PR sites.

## 2. OUT OF SCOPE

- **Sign-off / DCO trailers** — Why excluded: sign-off is a *real, enforced gate* (this repo's `dco` check, added by the `.githooks/prepare-commit-msg` hook), already discoverable via `faff gates discover`. Extension point: conform to the gate through the existing gates machinery; do not re-infer sign-off here.
- **Spec / ADR / PRD doc locations** — Why excluded: already fully config-driven via `tracking.spec_docs_path` / `adr_docs_path` / `prdr_docs_path` with default-resolution (`faff config spec-docs-path`). They are not hardcoded and need no discovery. Extension point: the existing `tracking.*_docs_path` keys.
- **PR-body section content and citation-hygiene** — Why excluded: PR *body* structure is faff's own governance artifact (anchors, AC checklist), not a repo stylistic convention. Only the PR *title* grammar is in scope (v1, derived from commit grammar). Extension point: `pr-body.js` if body conventions are later discovered.
- **Rewriting existing history or existing branches** — Why excluded: discovery is read-only and forward-only; it changes how *new* branches/commits/PRs are shaped, never past ones. Extension point: none needed.
- **Non-git trackers' branch hints** — Why excluded: where the tracker supplies a `gitBranchName` (e.g. Linear), that remains an input to branch-name resolution; harmonising tracker hints with discovered schemes beyond v1's rule is deferred. Extension point: the branch-name resolver's precedence list.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Convention | A single stylistic decision faff makes when acting on a repo (branch naming, commit-subject grammar, PR-title grammar). |
| Standards doc | A committed file declaring conventions: `CONTRIBUTING*`, `AGENTS.md`, `CONVENTIONS*`, `.github/` PR/commit templates, `docs/` contributing/style pages. |
| History-inferred | A convention derived from the dominant pattern across recent git history when docs are silent. |
| Confidence | The discoverer's strength-of-signal for one convention: `explicit` (config), `documented` (standards doc), `inferred` (history above threshold), `default` (nothing conclusive). |

**The discovered-conventions record (emitted as a `faff-contract:conventions` block, cached to `.faff/conventions.json`).**

```
RECORD ConventionSet:
  schema: Int                       # schema version, for forward-compat (start at 1)
  generated_at: Timestamp           # when mined
  branch_naming: Convention         # v1
  commit_subject: Convention        # v1
  pr_title: Convention              # v1 (derived: mirrors commit_subject grammar unless a doc says otherwise)

RECORD Convention:
  key: String                       # "branch_naming" | "commit_subject" | "pr_title"
  value: String                     # the resolved scheme token (see enums below)
  source: Enum{explicit, documented, inferred, default}
  confidence: Enum{high, medium, low}   # low ⇒ value fell back to default
  evidence: List<Evidence>          # every non-default value cites where it came from

RECORD Evidence:
  kind: Enum{config-key, doc-file, history}
  ref: String                       # ".faffrc:conventions.commit_subject" | "CONTRIBUTING.md" | "git-log:last-200"
  detail: String                    # e.g. "184/200 commits match conventional-commits grammar (0.92)"
```

**Scheme value vocabulary (v1 — closed, extensible by later schema bumps).**

```
branch_naming ∈ {
  "issue-slug",        # <issue>-<slug>  (faff default)
  "slash-scoped",      # <type>/<issue>-<slug>  e.g. feature/FAFF-1-foo
  "tracker-hint",      # use the tracker-provided gitBranchName verbatim when present
}
commit_subject ∈ {
  "conventional",      # <type>(<scope>): <subject>  (faff default)
  "bare-imperative",   # "<Subject>" — no type prefix
}
pr_title ∈ {
  "conventional",      # mirrors commit_subject (faff default)
  "bare-imperative",
}
```

**CLI surface (new — `faff conventions`, in a new `plugin/skills/faff/bin/lib/conventions.js`, mirroring `profile.js`).**

```
faff conventions mine [--json] [--root DIR]
  # deterministic, read-only. Scan standards docs then history; emit ONE
  # faff-contract:conventions block (--json: raw JSON). No network/install/subprocess. Writes no files.

faff conventions get <key> [-d DEFAULT] [--json]
  # resolve ONE convention with full precedence (see HOW). Prints the resolved value token (or --json the Convention record).
  # exit 0 always resolves (default is the floor); never exits non-zero for "unset".

faff conventions show
  # print the effective ConventionSet (.faff/conventions.json ⊕ .faffrc conventions:), exit 3 when never mined.

faff conventions --selftest
  # exercise the precedence + threshold table.
```

**Config surface (new `conventions:` block in `.faffrc`, all optional).**

```yaml
conventions:
  branch_naming: issue-slug        # explicit override (highest precedence)
  commit_subject: conventional
  pr_title: conventional
  history_window: 200              # commits scanned for inference (default 200)
  history_dominance: 0.7           # min fraction for one grammar to win inference (default 0.7)
```

**Design decisions** — each concluded with a canonical marker below and collected in §6.

- **v1 convention scope** → `**Chosen:** branch naming + commit-subject grammar + (derived) PR-title grammar. Sign-off and doc-locations excluded (§2).`
- **Discovery mechanism + caching** → `**Chosen:** a deterministic `faff conventions` CLI mirroring `faff profile mine`, cached to `.faff/conventions.json`, overlaid by `.faffrc conventions:`.`
- **Resolution precedence** → `**Chosen:** explicit config > standards doc > history-inferred (above threshold) > faff default.`
- **History-inference threshold** → `**Chosen:** scan `history_window` (default 200) commits; adopt an inferred grammar only when one pattern's share ≥ `history_dominance` (default 0.7); else fall back to default with `confidence: low`.`
- **Cache freshness** → `**Chosen:** consumers auto-mine into `.faff/conventions.json` when it is absent; an existing cache is reused within a graft and refreshable via `faff conventions mine`. `.faff/conventions.json` is gitignored.`

## 4. HOW — Behavior

**Architecture.** `faff conventions` is a new CLI lib beside `profile.js`. `mine` runs the two-tier discovery and emits the contract block; the orchestrator (graft) validates the block and writes `.faff/conventions.json` (miner writes nothing, exactly as `profile mine` leaves the write to the orchestrator). `get <key>` is the single resolver every consumption site calls in place of a hardcoded string.

**Discovery — per convention, precedence-ordered.**

```
PROCEDURE resolve(key):
  1. explicit: IF `faff config get conventions.<key>` is set → { value, source: explicit, confidence: high }
  2. documented: scan standards docs (fixed order below) for an explicit statement of <key>
       → first confident doc hit → { value, source: documented, confidence: high, evidence: doc-file }
  3. inferred: study git history for <key>'s dominant pattern (PROCEDURE infer below)
       → dominance ≥ history_dominance → { value, source: inferred, confidence: high|medium, evidence: history }
  4. default: faff's current hardcoded value → { value, source: default, confidence: low }
```

**Standards-doc walk (step 2 — fixed scan order, first confident hit wins).**

```
PROCEDURE scan_docs(key):
  order = [ CONTRIBUTING*, AGENTS.md, CONVENTIONS*, .github/PULL_REQUEST_TEMPLATE*, .github/*commit*, docs/**/{contributing,style}* ]
  FOR each existing file in order:
    match the file for an explicit statement of <key>'s scheme (e.g. a "## Commit messages" section naming
      Conventional Commits, a branch-naming rule, a PR-title rule)
    IF a confident, unambiguous statement is found → return it (cite the file + matched line)
  return no-doc-signal   # fall through to inference
```

- Matching is conservative: a doc must *state* the convention (a named scheme, a template, an explicit rule), not merely contain an example. Ambiguous or conflicting doc statements → treat as no-doc-signal and fall through to inference (do not adopt a guess).

**History study (step 3).**

```
PROCEDURE infer(key):
  commits = `git log --format=%s -n <history_window>` on the default branch      # subjects only for commit/PR grammar
  IF key == branch_naming: sample recent branch names via `git for-each-ref --format='%(refname:short)' refs/heads` + merged-PR head refs
  classify each sample into the scheme vocabulary for <key>
  winner, share = the most common scheme and its fraction of classified samples
  IF share ≥ history_dominance AND classified-sample count ≥ a floor (e.g. 20):
      confidence = high IF share ≥ 0.85 ELSE medium
      return { value: winner, source: inferred, confidence, evidence: "history: <n>/<N> (<share>)" }
  return no-history-signal   # fall through to default
```

**Consumption wiring (the sites that stop hardcoding).**

```
PROCEDURE branch_name(issue):
  scheme = faff conventions get branch_naming
  IF scheme == tracker-hint AND tracker supplies gitBranchName → use it verbatim
  ELSE format per scheme (issue-slug default = "<issue>-<slug>", the current behaviour)
  # graft Step 3 passes the result to setup-worktree.sh (unchanged: it still receives a name positional)

PROCEDURE commit_subject(kind, issue, subject):
  scheme = faff conventions get commit_subject
  IF scheme == conventional → "<kind>(<issue>): <subject>"   # current behaviour, e.g. docs(FAFF-1): add spec …
  IF scheme == bare-imperative → "<Subject> (<issue>)"
  # applies at graft Step 4 (spec commit), Step 4c (decisions), merge-time ADR renumber, and build commits

PROCEDURE pr_title(issue, subject):
  scheme = faff conventions get pr_title   # defaults to mirror commit_subject
  # TODAY the PR title is implicit: `gh pr create --body-file …` carries no --title, so gh derives it
  # from the commit subject — a conforming commit_subject already produces a conforming PR title.
  # v1 wiring: only when pr_title is DISCOVERED to diverge from commit_subject does graft Step 9b add
  # an explicit `gh pr create --title "<formatted>"`; otherwise the implicit derivation is left as-is.
```

- **Consumption is prose-in-`SKILL.md` today**, so wiring means: graft Step 3 (branch), Step 4 / 4c / merge-time ADR renumber (commit subjects) call `faff conventions get <key>` and format from the returned token instead of stating the hardcoded string; `setup-worktree.sh` is unchanged (it already takes the name as a positional); the PR title needs a Step 9b `--title` only for the divergent-`pr_title` case above. No consumption site formats a convention it did not resolve through `get`.

**Edge cases and fallbacks.**

- **No docs, no clear history** → every convention resolves `source: default, confidence: low` — byte-identical to today's behaviour. No regression.
- **Git history unreadable** (shallow clone, empty repo) → inference is skipped; fall to default. Never crash.
- **Conflicting doc vs history** → doc wins (higher precedence); history is not consulted once a confident doc hit exists.
- **Conflicting doc vs explicit config** → config wins; a `faff config check`-style advisory may note the divergence (non-blocking, optional).
- **A discovered scheme the vocabulary can't represent** → classify as no-signal for that tier and fall through; never invent an out-of-vocabulary token (a later schema bump extends the enum).

**Failure modes.**

- **The failure:** history inference adopts a convention the repo's own CI then rejects (e.g. infers `bare-imperative` on a repo whose PR-title CI check demands Conventional Commits). **How you'd know:** the first autonomous PR on that repo fails the title/commit CI check. **What it means:** the gate-vs-style boundary (§2, `Stylistic opinion is not a CI gate`) is the guard — a real CI check is discovered by `faff gates discover` and is authoritative; inference must never override a discovered gate. Narrow: when a gate for a convention exists, `get` returns the gate-conformant value regardless of history.
- **The failure:** the dominance threshold is mis-tuned (too low ⇒ adopts noise; too high ⇒ never adopts, always defaults). **How you'd know:** `faff conventions show` reports `source: inferred` on a visibly mixed history, or `source: default` on a visibly consistent one. **What it means:** the defaults (200 / 0.7) are tunable via `.faffrc conventions.*`; ship the defaults, expose the knobs, revisit if calibration data shows systematic mis-fires.

**Anti-patterns.**

- **Anti-pattern:** silently adopting an inferred convention below the dominance threshold. Why: a guessed convention that fails the repo's own gate is worse than the default (the `Never adopt a guessed convention` principle).
- **Anti-pattern:** re-inferring a convention that a discovered CI gate already fixes. Why: the gate is authoritative and already handled by `faff gates discover`; double-sourcing risks divergence.
- **Anti-pattern:** hand-reading `.faffrc` or standards docs in `SKILL.md` prose to resolve a convention. Why: resolution is CLI-only (`faff conventions get`), the deterministic-tool tenet and the CLI-only-config rule.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose CONTRIBUTING.md documents "Conventional Commits" for commit messages
When `faff conventions get commit_subject` runs
Then it returns "conventional" with source "documented" citing CONTRIBUTING.md
```

```
Given a repo with no standards docs and a git history where 184 of the last 200 commit subjects are bare imperative (no type prefix)
When `faff conventions mine` runs
Then commit_subject resolves value "bare-imperative", source "inferred", confidence high, evidence "history: 184/200 (0.92)"
```

```
Given `.faffrc` sets conventions.branch_naming: slash-scoped and CONTRIBUTING.md documents issue-slug
When `faff conventions get branch_naming` runs
Then it returns "slash-scoped" with source "explicit" (config wins over the doc)
```

- The `faff conventions mine` output validates against the `faff-contract:conventions` block shape (schema, per-convention value/source/confidence/evidence).
- Running `faff conventions get <key>` on a repo with neither docs nor history is byte-identical to today's hardcoded value for every consumption site (no regression).

## 6. Design Decision Rationale

**Which conventions ship in v1?**
Options: (a) branch + commit only; (b) branch + commit + PR-title; (c) everything the ticket lists (also sign-off, doc-locations).
- (c) over-reaches: sign-off is a real gate (handled) and doc-locations are already config-driven — including them re-implements solved problems.
- (a) leaves PR-title hardcoded even though it trivially derives from commit grammar.
**Chosen:** (b) — branch naming + commit-subject grammar + PR-title (derived from commit grammar). Rationale: these are the highest-papercut, purely-stylistic, non-gated conventions; PR-title rides commit grammar for near-zero extra cost. The rest have documented extension points (§2).

**How is discovery implemented and cached?**
Options: (a) a deterministic `faff conventions` CLI mirroring `profile mine`; (b) inline prose logic in `faff-graft`'s `SKILL.md`; (c) re-derive live every graft with no cache.
- (b) violates the deterministic-tool tenet and the CLI-only-config rule; (c) re-scans history every build (cost, non-determinism within a run).
**Chosen:** (a) — a CLI lib beside `profile.js`, cached to `.faff/conventions.json` (gitignored) and overlaid by `.faffrc`, auto-mined when absent, refreshable on demand. Rationale: exact precedent exists (`profile.js`), keeps logic testable, and gives one resolver (`get`) for every consumption site.

**What resolution precedence?**
**Chosen:** explicit `.faffrc` config > repo standards doc > history-inferred > faff default (the ticket's stated order). Rationale: an operator's explicit config is intent; a documented convention is the repo's stated rule; history is a weaker inference; the default is the floor.

**How much history is enough signal?**
Options: fixed N with a dominance threshold; a statistical test; adopt-on-any-majority.
- adopt-on-any-majority flips conventions on noisy history (the failure the ticket warns against).
**Chosen:** scan `history_window` (default 200) commits and adopt an inferred grammar only when one pattern's share ≥ `history_dominance` (default 0.7) over a minimum sample floor; else fall back to default with `confidence: low`. At the time of writing these are unvalidated defaults exposed as `.faffrc conventions.*` knobs — revisit against calibration data.

## 7. Open Questions and Assumptions

**Open Questions:** none — the ticket's three open questions are resolved above (v1 scope; CLI + `.faff/conventions.json` cache re-mined on demand; a 200-commit window with a 0.7 dominance threshold, both tunable).

**Assumptions.**

- **Assumes:** `faff gates discover` remains the authoritative source for *enforced* conventions (sign-off, CI-checked PR-title). Validate: `faff gates discover` exists and reads `.github/workflows` (it does — FAFF-848/849, Done); the gate-vs-style boundary depends on it.
- **Assumes:** a git repository with readable history is present at graft time for the inference tier. Validate: `git log` succeeds; if not (shallow/empty), inference is skipped and defaults apply — a handled fallback, not a blocker.

## 8. Already shipped against this surface

Related but **not superseding** — these confirm the gate-vs-style boundary rather than deliver convention discovery:

- **FAFF-848 / FAFF-849 / FAFF-533 / FAFF-11 / FAFF-522** (all Done) — `faff gates discover` + the gate ladder: discovers and runs the repo's *enforced* CI gates. This is the authoritative "real gate" side this ticket explicitly defers to; it does **not** discover stylistic, non-gated conventions.
- **FAFF-708** (Done) — graft branch base fix (branches off fetched remote default). Touches branch creation but is about the *base ref*, not the *name scheme*.
- **FAFF-174** (Done) — release-please conventional-commit types for faff's own releases; about faff's release automation, not host-repo convention discovery.

No Done ticket delivers standards-doc + history discovery of branch naming / commit grammar / PR-title. Premise holds.

## 9. DONE — Definition of Done

### From WHY
- [ ] With no docs and no clear history, every convention resolves to today's hardcoded default (no regression) — verified byte-for-byte at each consumption site.

### From WHAT (types and interfaces)
- [ ] `faff conventions mine [--json]` emits one `faff-contract:conventions` block matching the `ConventionSet` shape (schema, per-convention value/source/confidence/evidence).
- [ ] `faff conventions get <key> [-d DEFAULT]` resolves branch_naming / commit_subject / pr_title and always exits 0 with a value.
- [ ] `faff conventions show` prints the effective set (`.faff/conventions.json` ⊕ `.faffrc conventions:`), exit 3 when never mined.
- [ ] `faff conventions --selftest` exercises the precedence + threshold table.
- [ ] The new subcommand is registered in the CLI surface and passes `lint-cli-coverage` / `lint-cli-doc`.
- [ ] `.faff/conventions.json` is written under `.faff/`, which is already gitignored by default (`.faff/*`, only `!.faff/anchors/` carved out to commit) — so it stays out of the repo like `.faff/infra-profile.json`, no new gitignore rule needed.

### From HOW (behaviour)
- [ ] Resolution precedence is explicit config > documented > inferred > default, per the resolve procedure.
- [ ] The standards-doc walk scans CONTRIBUTING*/AGENTS.md/CONVENTIONS*/.github templates/docs in the fixed order and adopts only a confident, unambiguous statement (cites the file).
- [ ] History inference adopts a scheme only when share ≥ `history_dominance` over ≥ the sample floor; otherwise falls to default with `confidence: low`.
- [ ] `history_window` and `history_dominance` are read from `.faffrc conventions.*` with defaults 200 / 0.7.
- [ ] graft Step 3 (branch) and Step 4 + 4c + merge-time ADR renumber (commit subjects) resolve via `faff conventions get` instead of a hardcoded string; the PR title conforms via the commit subject (implicit) unless a divergent `pr_title` is discovered, in which case Step 9b passes an explicit `--title`.
- [ ] A convention fixed by a discovered CI gate is never overridden by history inference (gate > style).

### From HOW (edge cases)
- [ ] Unreadable/empty git history skips inference and applies defaults without crashing.
- [ ] A conflicting doc-vs-config resolves to config; doc-vs-history resolves to doc.
- [ ] An out-of-vocabulary discovered scheme is treated as no-signal for that tier, never adopted verbatim.

### Eval coverage
- [ ] The doc-parse and history-classification steps are deterministic (regex/pattern classification), so no new LLM-judgement seam is introduced; if the doc-parse is implemented as an LLM seam instead, register its grader KIND + ≥1 eval case + seam-registry row in this ticket.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. In a repo whose CONTRIBUTING.md names Conventional Commits and whose history is bare-imperative:
     run `faff conventions mine --json`
  2. ASSERT commit_subject.value == "conventional" (doc beats history), source == "documented"
  3. run `faff conventions get branch_naming` in a repo with no docs/history
  4. ASSERT it prints "issue-slug" (the faff default) — plumbing connected, no regression
```

## Methodology critique

_Methodology: faffter-dark-methodology-agile-delivery_

- **Right-sized?** One cohesive concern (stylistic-convention discovery) with a clear v1 scope-cut to branch naming + commit grammar (+ derived PR title). The new CLI plus the graft wiring are a single 1–3 day unit; the deferred conventions (sign-off, doc-locations, PR-body) carry explicit extension points, so no split is warranted.
- **Workstream fit?** Sits squarely in faff's "repo archaeology" family beside `faff profile mine` and `faff gates discover`, serving the *adoptable, not all-encompassing* tenet. Outcome-named and cohesive with that workstream.
- **Deps surfaced?** No unbuilt dependency. It composes with `faff gates discover` (Done — FAFF-848/849) for the gate-vs-style boundary, an existing shipped seam rather than an implicit blocker; no blocker link needed.
- **Risk profile?** Low–moderate. The one real risk is heuristic history inference adopting a wrong convention; de-risked by the dominance threshold, fail-to-default, and gate-authoritative rule. No novel integration or external dependency, so no de-risking spike.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ {"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"} ] }
```
