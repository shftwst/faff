# FAFF-238 — Self-contained prose guard (slice 1): enforce on `docs/guide/`, relocate the guides, correct the standard

> Spec: faffter-dark-nlspec · 2026-06-26 · interactive · confidence: medium.

> Slice 1 of 2 (guard + `docs/guide/` relocation + standard rewrite, green-by-construction). The `SKILL.md` ref sweep is slice 2 (FAFF-239, `blockedBy` this).

*Build spec for the build agent and human reviewers. It defines a deterministic CI check that bans external-artifact references in prose a reader executes or publicly consumes, establishes `docs/guide/` as the enforced public-docs surface, relocates the six user guides there, and rewrites the authoring standard.*

## 1. WHY — Problem and Principles

**The load-bearing model — directional self-containment.** Prose a reader *executes* (a skill prompt) or *publicly consumes* (a user guide) is the artifact, and the reader has no tracker access. A ticket or ADR is the *reasoning that produced* a rule — upstream provenance — never something the reader follows. So everything **inlines *from*** the reasoning corpora (`docs/adr/`, `docs/specs/`, tickets); **nothing in executed/public prose points *into*** them. A `FAFF-NN`/`ADR NNNN` ref in enforced prose is therefore always one of two defects: *decorative* (delete) or *smuggling meaning* the prose should state outright (inline the rule, then delete). There is no third "load-bearing reference" category in this prose.

**Problem.** The authoring standard already calls decorative issue-tags cruft, but the `validate-adapters` `stray marker` rule was deliberately scoped to exclude `FAFF-NN` tags — so nothing fails CI and refs accumulate. This slice installs the mechanical floor for the **public** surface and stops the drift there.

**Design principles:**

- **Allow-by-default in `docs/`; enforce only two surfaces.** `docs/` is a mixed corpus (ADRs, build specs, contributor guidance, design notes) that legitimately cites provenance. The ban is enforced **only** on `plugin/skills/**/SKILL.md` and `docs/guide/**`. Everything else under `docs/` is untouched.
- **The ADR corpus is exempt and must stay so.** `faff adr validate` *requires* symmetric supersession back-refs; banning ADR citations under `docs/adr/` would break it.
- **Within-prose cross-references are not external refs.** `gateway → Section`, sibling skill names (`faff/SKILL.md`) point at prose in the same corpus — the deduplication mechanism. They must never be flagged.
- **Green by construction.** The six guides are already ref-free, so enforcing on `docs/guide/` ships green immediately. The not-yet-clean `SKILL.md` surface is deferred to slice 2 so this slice never holds CI red.

## 2. OUT OF SCOPE

- **The `SKILL.md` ref sweep + enforcing the ban on skills (slice 2 / FAFF-239).** ~125 refs across 17 skills, each a delete-or-rewrite judgement. *Extension:* slice 2 reuses this slice's ref-matcher over `plugin/skills/*/SKILL.md`.
- **`docs/configuration.md` config-key coverage / `docs/skills.md` slot coverage checks.** Same theme, different mechanism.
- **Touching `docs/specs/`, `docs/adr/`, `docs/audits/`, `docs/reports/`, `design/`.** Allow-by-default.
- **The `docs/cli.md` ⊇ `faff --help` coverage check** — its own sibling ticket; targets the relocated `docs/guide/cli.md` path.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| **Enforced surface** | The file set the ban applies to. **This slice: `docs/guide/**/*.md`.** (Slice 2 adds `plugin/skills/*/SKILL.md`.) |
| **External-artifact ref** | A `FAFF-NN` ticket tag, an `ADR NNNN` citation, or a numbered `docs/adr/NNNN-*` pointer in enforced prose. |
| **Reasoning corpus** | `docs/adr/`, `docs/specs/`, tickets — where refs belong; enforced prose inlines *from* here. |
| **Within-prose anchor** | A cross-reference to other prose in the same corpus (`gateway → Section`, `faff/SKILL.md`). Never an external ref. |

**Ref-match patterns** (line-wise; case-insensitive where natural):

```
TICKET   := /\bFAFF-\d+\b/                      # FAFF-238, FAFF-11
ADR_CITE := /\bADR[-\s]?\d{3,4}\b/              # "ADR 0013", "ADR-9"
ADR_PTR  := /\bdocs\/adr\/\d{3,4}[-\w]*/        # docs/adr/0013-...  (numbered pointer only)
```

```
RECORD RefViolation:
  file: string        # repo-relative
  line: int           # 1-based
  match: string       # the offending token
  pattern: "ticket" | "adr-cite" | "adr-ptr"
```

**Design decisions:**

- **Chosen:** the check is a **separate enforcement pass with its own enumeration**, not a row in the existing `validate-adapters` per-skill loop — that loop only walks `faffidavit-*`/`faffter-*` and would miss every `faff-*` skill. Implemented as a `faff` CLI subcommand (`faff lint-refs`) with a `--selftest` table, wired into `validate.yml`.
- **Chosen:** allow-by-default in `docs/`; enforce only `SKILL.md` + `docs/guide/` (this slice: `docs/guide/`).
- **Chosen:** match *numbered* artifacts only — a bare `docs/adr/` path naming the directory the `faff adr` command operates on is **not** a violation; only a numbered `docs/adr/NNNN-*` pointer is.
- **Chosen:** relocate exactly these six into `docs/guide/`: `cli.md`, `configuration.md`, `skills.md`, `walkthroughs.md`, `unattended.md`, `architecture.md`. `skill-authoring.md` stays at `docs/` root (contributor guidance, ref-permitted).
- **Chosen:** `docs/adr/**` is exempt (forced by `faff adr validate`).
- **Assumes:** the six guides are currently ref-free — re-grep before enabling the check.
- **Assumes:** `.github/workflows/validate.yml` + `node --test` is the CI/test host.

## 4. HOW — Behavior

**The check.** Enumerate the enforced surface, scan each line against the three patterns, collect `RefViolation`s, print one `FAIL <file>:<line> ✗ <match>` per hit, exit 1 if any, 0 if clean.

```
PROCEDURE lint_refs(root):
  files := glob(root + "/docs/guide/**/*.md")          # slice 1 surface
  violations := []
  FOR file IN files:
    FOR (lineno, line) IN enumerate(read(file)):
      FOR pattern IN [TICKET, ADR_CITE, ADR_PTR]:
        IF pattern matches line: violations.append({file, lineno, match, pattern})
  IF violations: print each "FAIL <file>:<line> ✗ <match>"; exit 1
  print "PASS  no external-artifact refs in enforced prose"; exit 0
```

**`--selftest`** drives an in-memory table: `FAFF-238` → ticket hit; `ADR 0013`/`ADR-9` → adr-cite hit; `docs/adr/0013-foo.md` → adr-ptr hit; `gateway → Section`, `faff/SKILL.md`, bare `docs/adr/` mention, `faffter-dark-nlspec` → **no** hit.

**Relocation (mechanical, ordered):**

```
1. mkdir docs/guide/
2. git mv each of the six guides → docs/guide/
3. fix intra-guide relative links — all verified sibling-relative (survive a same-dir move)
4. repoint ALL inbound links to the six guides:
     README "Going further" AND README body refs
     (unattended ~L29; configuration ~L33, ~L44; walkthroughs ~L50),
     plus any in CLAUDE.md / other docs → docs/guide/<name>
5. verify: repo-wide grep for docs/<oldname>.md returns clean (no dead links)
```

**Standard rewrite — `docs/skill-authoring.md`:** replace the `stray marker` row's parenthetical and the "Honest limits … deliberately narrow … load-bearing FAFF-NN anchors" sentence with the forward rule: *executed/public prose (`SKILL.md` + `docs/guide/`) carries no `FAFF-NN`/`ADR` ref — state the rule, inline from the reasoning corpus; `docs/` outside `docs/guide/` is ref-permitted; within-prose anchors are not external refs.*

**CI wiring:** add `faff lint-refs` + its `--selftest` to `validate.yml` beside `validate-adapters` and `node --test`.

**Edge cases:**
- Bare `docs/adr/` (no number) → **not** a violation.
- `docs/guide/` empty/absent at check time → 0 files, exit 0 (degrade clean).

**Anti-patterns:**
- **Anti-pattern:** adding the ref-check inside `cmdValidateAdapters`'s loop. **Why:** that loop only enumerates `faffidavit-*`/`faffter-*`.
- **Anti-pattern:** banning a bare `docs/adr/` directory mention. **Why:** legitimate command description, not a provenance pointer.

## 5. Scenarios

```
Given docs/guide/cli.md containing "see FAFF-26 for rationale"
When  faff lint-refs runs        Then exit 1, names docs/guide/cli.md:<line> ✗ FAFF-26
```
```
Given docs/guide/architecture.md citing "ADR 0010" and "docs/adr/0010-foo.md"
When  faff lint-refs runs        Then exit 1, both the ADR-cite and the numbered pointer named
```
```
Given the six guides relocated to docs/guide/ and ref-free
When  faff lint-refs runs in CI  Then exit 0 (green by construction)
```
```
Given a prose line "gateway → Automation eligibility" and "faff/SKILL.md"
When  faff lint-refs --selftest runs   Then neither flagged (within-prose anchors)
```
```
Given docs/adr/0013 "Superseded by ADR-0014" and 0014 "Supersedes: ADR-0013"
When  faff lint-refs runs AND faff adr validate runs   Then lint ignores docs/adr/** AND adr validate exits 0
```

Non-functional: deterministic, dependency-free (`node:*`), offline · README + every inbound link resolves post-move · `docs/` outside `docs/guide/` byte-unchanged except the `skill-authoring.md` rewrite.

## 6. Design Decision Rationale

**Where does the check live?** Extend the per-skill loop (misses `faff-*`); broaden that loop (drags slot-conformance onto `faff-*`); a separate detector pass. **Chosen:** separate pass, own enumeration, `faff` CLI + `--selftest`, wired into `validate.yml`.
**Match numbered artifacts only?** **Chosen:** yes — a bare `docs/adr/` mention is legitimate description; only numbered pointers/citations are provenance.
**Which docs move?** **Chosen:** the six README-linked guides; `skill-authoring.md` stays ref-permitted at `docs/` root.

## 7. Open Questions and Assumptions

**Assumptions:**
- **Assumes:** the six guides are ref-free today. *Validate:* `grep -nE 'FAFF-[0-9]+|ADR[- ]?[0-9]{3,4}' docs/guide/*.md` returns nothing before enabling the check.
- **Assumes:** `.github/workflows/validate.yml` + `node --test` is the CI/test host.

## 8. DONE — Definition of Done

**From WHY**
- [ ] A `FAFF-NN` / `ADR NNNN` / numbered `docs/adr/NNNN-*` ref in any `docs/guide/**/*.md` fails the check, naming `file:line ✗ match`.
- [ ] `docs/` outside `docs/guide/` is never flagged; a bare (un-numbered) `docs/adr/` mention is not a violation.

**From WHAT**
- [ ] The three patterns match `FAFF-238`, `ADR 0013`/`ADR-9`, `docs/adr/0013-foo.md`; they do **not** match `gateway → Section`, `faff/SKILL.md`, bare `docs/adr/`, or `faffter-*` names.
- [ ] `--selftest` covers every positive and negative case; exit 0.

**From HOW**
- [ ] The six guides live under `docs/guide/`; README "Going further" + README body refs + every other inbound link repointed; repo-wide grep for `docs/<oldname>` clean.
- [ ] Intra-guide relative links resolve post-move.
- [ ] `docs/skill-authoring.md` rewritten — false "load-bearing FAFF-NN anchors" carve-out removed; ban stated forward.
- [ ] `faff lint-refs` + `--selftest` run in `validate.yml`.
- [ ] `faff adr validate` still exits 0.

**Non-functional**
- [ ] Deterministic, dependency-free (`node:*`), offline; covered by a `node --test` test.
- [ ] Green on the resulting tree.
