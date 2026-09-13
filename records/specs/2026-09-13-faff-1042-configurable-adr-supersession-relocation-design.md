# Spec — Configurable ADR supersession relocation (FAFF-1042)

> Spec: faffter-dark-nlspec · 2026-09-13 · autonomous · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-1042.

This spec addresses FAFF-1042: give `faff adr supersede` an opt-in mode that relocates the now-superseded ADR into a dedicated directory, instead of leaving it in place. The audience is the build agent implementing the change and the human reviewer gating the PR.

## Already shipped against this surface

Related Done work on the ADR subsystem — foundation this extends, not overlap (premise holds, not superseded):

- **FAFF-197** — built the supersession write (`recordSupersede`, canonical `Status: Superseded by` / `Supersedes:` back-refs). This spec adds the optional move to that exact primitive.
- **FAFF-768** — config-resolved the ADR doc root (`resolveAdrDocsPath`); this spec resolves the `superseded/` subdir under it.
- **FAFF-546 / FAFF-198 / FAFF-199** — `adr accept`, L3 supersession offer, L4 admit gate; all upstream of and untouched by relocation.
- The "Relocation slice 1–3" Done tickets (FAFF-748/749/750/751) are build-lane merge-locus relocation — a different sense of "relocation", unrelated to ADR files.

No Done ticket delivers configurable relocation-of-the-superseded-file on supersede — the premise is load-bearing.

## 1. WHY — Problem and Principles

**The mechanism this turns on:** supersession today is a two-file *edit* — `recordSupersede` rewrites the old ADR's `Status:` line and adds a `Supersedes:` line to the new one, both files staying in the active ADR directory. This spec adds an optional third action to that same operation — *moving* the old file to a `superseded/` subdirectory — and teaches the two readers of the ADR set (`adr validate` and `adr renumber`) to look in that subdirectory as well, so the record set stays whole after a move.

**Problem statement.** When `faff adr supersede` marks an ADR superseded, the file stays in the active ADR directory carrying a `Status: Superseded by ADR-NNNN` back-ref, so the active set accumulates dead records and gets harder to scan. Teams want superseded ADRs collected in a separate directory while the lineage and back-refs stay intact. This change adds an opt-in config knob that relocates the superseded file as part of the same supersession write, defaulting to today's in-place behaviour.

**Design principles.**

- **No regression by default.** The knob defaults to in-place; a repo that never sets it must behave byte-for-byte as today, and `prdr supersede` (which shares the same write primitive) must be entirely unaffected.
- **Move, never delete.** The append-not-delete audit trail is inviolable: a superseded ADR is relocated, never removed, and its number is never freed for reuse.
- **The record set is the union of directories, not one directory.** Once a move can happen, "the ADRs" means the active directory plus the superseded subdirectory. Any read that answered a lineage/numbering/back-ref question over one directory must answer it over the union, or it will report false failures on a legitimately-moved record.
- **Purity parity with the sibling writers.** `recordSupersede`, `adrRenumber`, and `adrAccept` are pure `fs` operations tested under `adr --selftest`; the relocation stays pure `fs` too. Git records the rename by similarity when the caller stages the tree — the write primitive never shells `git`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/adr.js` → `recordSupersede` | Node | The supersession write; the move is added here (prefix-shared with PRDR — must stay ADR-only) |
| `plugin/skills/faff/bin/lib/adr.js` → `listAdrs` / `adrValidate` / `recordSupersessionProblems` | Node | The readers that must span active ∪ superseded |
| `plugin/skills/faff/bin/lib/adr.js` → `adrRenumber` | Node | The merge-time collision-repair primitive; open question 2 lives here |
| `plugin/skills/faff/bin/lib/adr.js` → `cmdAdr` (`supersede` / `validate` / `renumber` dispatch) | Node | Resolves config and calls the primitives |
| `plugin/skills/faff/bin/lib/config.js` → `DEFAULTS`, `resolveAdrDocsPath` | Node | Registers the new knob; resolves the base ADR directory |

**Scope statement.** This is a self-contained enhancement to the `faff adr` CLI subsystem; it does not change how ADRs are authored, accepted, or admitted, only where a *superseded* file comes to rest and how the readers find it.

## 2. OUT OF SCOPE

- **Explicit `adr.superseded_dir` path override.** A free-form target path (vs the fixed `superseded/` subdir). Why excluded: a single fixed subdir under the resolved ADR directory keeps blast-radius containment trivial and matches the minimal-config-surface tenet; a path override adds a second resolution + containment surface for marginal benefit. Extension point: add an `adr.superseded_dir` key resolved via `resolveDocsPath` in `config.js`, consumed by the same `supersededDir` seam this spec introduces.
- **PRDR supersession relocation.** The same could apply to `prdr supersede`. Why excluded: not requested, and PRDR has its own landing-branch lifecycle; keeping the shared `recordSupersede` PRDR-path byte-identical is a hard principle here. Extension point: `prdr supersede` dispatch would pass its own resolved `supersededDir` to the same primitive.
- **Retroactive migration of already-superseded ADRs.** Flipping the knob to `move` does not sweep existing in-place superseded ADRs into the subdir. Why excluded: a bulk move is a separate, riskier operation. Extension point: a future `faff adr relocate-superseded` housekeeping subcommand.
- **Auto-supersede honouring the knob.** Autonomous `adr admit` never auto-supersedes (hard floor); the knob only affects the interactive/loop-ratified `adr supersede` write. No change to that floor.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Active dir | The resolved ADR directory (`resolveAdrDocsPath` → e.g. `records/adr/`) where live ADRs sit |
| Superseded dir | The fixed subdirectory `<active dir>/superseded/` where a moved superseded ADR comes to rest |
| Scan set | The union of the active dir and (when it exists) the superseded dir — the set every reader operates over |

**Config key.**

```
adr.on_supersede: "in-place" | "move"      # DEFAULTS → "in-place"
```

- Registered in `config.js` `DEFAULTS` as `"adr.on_supersede": "in-place"`. The `adr` namespace is already in `WRITABLE_NAMESPACES`, so `faff config set adr.on_supersede move` works with no namespace change.
- Read the same way `adr admit` reads its knobs: `const cfg = loadConfig(root)[0]; const mode = dig(cfg, "adr.on_supersede") || DEFAULTS["adr.on_supersede"]`.
- Any value other than the literal `"move"` resolves to in-place behaviour (fail-safe: a typo never silently relocates).

**Superseded-dir resolution.**

```
supersededDir(root) = path.join(adrDir(root), "superseded")
```

where `adrDir(root)` is the existing helper (`root` + `resolveAdrDocsPath`). Always a fixed relative subdir of the active dir, so it is contained under the ADR directory by construction (no traversal / containment check needed).

**Primitive signature change (additive, back-compatible).**

```
recordSupersede(dir, root, records, oldTok, newTok, prefix, supersededDir?)
  # supersededDir absent/null/"" → in-place, byte-identical to today (the PRDR call path)
  # supersededDir set            → after the two edits, move the OLD file into supersededDir
```

**Shared-primitive path-join fallback (load-bearing for PRDR parity).** `recordSupersede` is called with `records` from `listAdrsAcross` (ADR path, entries carry `.dir`) **and** from `listPrdrs(dir)` (PRDR path, entries carry **no** `.dir`). Every in-primitive file join MUST therefore be `path.join(a.dir || dir, a.file)` — the `|| dir` fallback resolves to today's active-dir join whenever an entry lacks `.dir`, keeping the PRDR path byte-identical while letting the ADR path address a relocated file. A bare `path.join(a.dir, a.file)` would throw on the PRDR records — a regression in the shared write. This fallback is the single reconciliation of the "in `dir`, as today" pseudocode below with the cross-dir requirement.

**Multi-dir listing helper.**

```
RECORD AdrEntry:                 # today's listAdrs entry, plus one field
  number, num, title, slug,
  status, date, provenance,
  file          # basename, unchanged
  dir           # NEW: absolute containing directory (active dir or superseded dir)

listAdrsAcross(dirs: string[]) -> AdrEntry[]
  # concatenate listAdrs over each existing dir, tagging each entry with its `dir`;
  # sorted by (num, file) so numbering/gap logic is stable across the union
```

`adrValidate` and the supersession/advisory readers switch from `path.join(dir, a.file)` to `path.join(a.dir, a.file)`, reading over the scan set.

## 4. HOW — Behavior

**Overview.** Three edits, in order, in one `faff adr supersede` invocation, mirroring today plus a move:

```
PROCEDURE record_supersede(dir, root, records, old, new, prefix, supersededDir?):
  1. Resolve oldA, newA from records (unchanged: self-supersede, already-superseded,
     not-found guards all fire exactly as today, exit 1/2).
  2. Rewrite oldA file: Status value → "Superseded by <prefix>-<newNum>"   (in `dir`, as today)
  3. Rewrite newA file: add "- **Supersedes:** <prefix>-<oldNum>" once     (in `dir`, as today)
  4. IF supersededDir set AND supersededDir != dir:
     a. mkdir -p supersededDir
     b. target := path.join(supersededDir, oldA.file)
     c. IF target already exists → return { code: 1, err: "supersede: <target> already exists — refusing to overwrite (append-only)" }
     d. move oldA file from path.join(dir, oldA.file) to target   (fs.renameSync, or write-then-rm)
     e. oldPath := target                                          (reported path reflects the move)
  5. Return { code: 0, out: "<oldPath>\n<newPath>\n" }
```

The status/supersedes edits happen **before** the move so the relocated file already carries its correct back-ref; the new (active) file's `Supersedes:` line is unaffected by the old file's location (refs are by number, not path).

**Dispatch wiring (`cmdAdr`, `action === "supersede"`).**

```
PROCEDURE dispatch_supersede(args, root, dir):
  1. cfg  := loadConfig(root)[0]
  2. mode := dig(cfg, "adr.on_supersede") || DEFAULTS["adr.on_supersede"]
  3. sdir := (mode === "move") ? supersededDir(root) : null
  4. records := listAdrsAcross([dir, supersededDir(root)])   # resolve OLD/NEW across the scan set
  5. r := recordSupersede(dir, root, records, args[1], get("--by"), "ADR", sdir)
  6. emit r.out / r.err; return r.code
```

Note step 4: `records` is resolved over the scan set so an already-moved ADR can still be named as the *old* target of a fresh supersession chain, and so `newA` can be found wherever it lives. `recordSupersede` writes each file at `path.join(a.dir || dir, a.file)` for the status/supersedes edits (per the shared-primitive fallback above) — cross-dir on the ADR path, byte-identical active-dir join on the PRDR path.

The `prdr supersede` dispatch is **unchanged**: it calls `recordSupersede(...)` with no `supersededDir` argument, so PRDR is byte-identical.

**Validate over the scan set (`adrValidate`).**

```
PROCEDURE adr_validate(dir, root):
  1. adrs := listAdrsAcross([dir, supersededDir(root)])
  2. per-file field checks (heading, Status, Date, Provenance)  — unchanged, over the union
  3. duplicate-number detection                                 — over the union (a moved file must
                                                                   NOT be re-detected as a duplicate)
  4. numbering-gap / contiguity check                           — over the union (a moved superseded
                                                                   ADR still occupies its number)
  5. supersession back-ref symmetry (recordSupersessionProblems) — over the union texts map, so a
                                                                    cross-dir OLD↔NEW pair resolves
```

Validate scans the superseded dir **whenever it exists, independent of the current `adr.on_supersede` value** — a repo that moved ADRs then set the knob back to `in-place` must still validate its already-moved records. The knob governs only the *write*; the readers always span the union.

**Renumber over the scan set (`adrRenumber`) — answers open question 2 (yes).**

The merge-time collision-repair primitive must be superseded-dir-aware, or a move+renumber sequence produces a validate failure that nothing else catches:

```
PROCEDURE adr_renumber(dir, root, selector, target, refScope):
  1. adrs := listAdrsAcross([dir, supersededDir(root)])         # number space spans the union
  2. selector resolution, occupied-target check, contiguity     # all over the union — never assign
                                                                   a number a superseded ADR holds
  3. move the source file within its OWN dir (a.dir), heading rewrite — unchanged shape
  4. ref-scope back-ref rewrite: for each in-scope file, read/write at path.join(a.dir, a.file),
     so a superseded partner's "Status: Superseded by ADR-NNNN" is re-pointed when its active
     successor is renumbered (and vice-versa) — preserving symmetry across the boundary
  5. re-validate over the union (step above); never claim success on a red tree
```

The blast-radius confinement is unchanged in spirit: writes still touch only real ADR-shaped filenames (`ADR_FILE_RE`) within the two known ADR directories — the superseded dir is a fixed child of the active dir, so no new traversal surface is opened.

**Edge cases and error handling.**

- **Knob unset / any non-`move` value** → `supersededDir` is null → in-place, byte-identical to today.
- **`move` set but old file already in the superseded dir** (re-superseding a chain) → the move step's target-exists guard (4c) fires; but since the old file's `dir` is already the superseded dir and `target == source`, treat `supersededDir === a.dir` as a no-op move (guard: `if (supersededDir === oldA.dir) skip move`). Precedence: the `supersededDir === dir` skip in step 4 handles the active-dir case; add the symmetric `=== oldA.dir` skip so an already-moved file is not moved onto itself.
- **Superseded dir does not exist yet** → `mkdir -p` creates it on first move; validate/renumber treat a non-existent superseded dir as an empty contribution to the scan set (no error).
- **PRDR path** → `supersededDir` argument omitted → move branch never taken.

**Failure modes.**

- **The failure:** the readers span the union but a *third* reader still assumes a single dir (e.g. `adrLiveDecisions`, `adrAdvisories`, `adrGitTier`, `next-number`). A superseded ADR relocated out of the active dir would then be invisible to that reader, changing a number-space or lineage answer silently.
  - **How you'd know:** `adr --selftest` case that moves an ADR then asserts `adrNextNumber` still counts it, and that `adrLiveDecisions` still excludes it (it is superseded, so exclusion is correct either way — but the count must be right). A wrong next-number (reusing a moved number) is the observable.
  - **What it means:** narrow — audit every `listAdrs(dir)` call site in `adr.js` and route each through `listAdrsAcross` where a whole-set answer is required. `adrNextNumber` MUST span the union (never reuse a superseded number). `adrLiveDecisions` already filters superseded out, so its dir-spanning is cosmetic but should still span for a correct exclude set.
- **The failure:** `git add -A` similarity detection fails to record the move as a rename (e.g. the file was also heavily edited), so history does not follow the file.
  - **How you'd know:** `git log --follow` on the moved path shows a truncated history at the move commit.
  - **What it means:** proceed — this matches the existing `adrRenumber` behaviour exactly (it too relies on `git add -A` similarity), so it introduces no new risk relative to the established pattern; the status-line edit is a one-line change, well within git's rename threshold.

**Anti-pattern:** shelling `git mv` inside `recordSupersede`. Why: it breaks purity parity with `adrRenumber`/`adrNew`/`adrAccept`, makes the primitive untestable under `adr --selftest` without a git work tree, and the caller already stages with `git add -A` which records the rename by similarity.

**Anti-pattern:** making validate/renumber scan the superseded dir only when `adr.on_supersede === "move"`. Why: a repo can hold moved ADRs while the knob reads `in-place` (flipped back after a move); gating the read on the write-knob would make those records vanish from validation. The readers span the union whenever the dir exists.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo with adr.on_supersede unset (default in-place)
When `faff adr supersede 0005 --by 0009` runs
Then ADR-0005 stays in the active dir with Status "Superseded by ADR-0009", ADR-0009 gains "Supersedes: ADR-0005", and the output is byte-identical to today
```

```
Given a repo with adr.on_supersede: move and ADR-0005 live in the active dir
When `faff adr supersede 0005 --by 0009` runs
Then ADR-0005 is relocated to <adr_docs_path>/superseded/0005-*.md carrying "Superseded by ADR-0009", ADR-0009 (active) carries "Supersedes: ADR-0005", and `faff adr validate` exits 0
```

- The `prdr supersede` write MUST be byte-identical before and after this change (no `supersededDir` ever reaches its call path).
- `faff adr next-number` MUST never return a number already held by a superseded ADR in the superseded dir.

## 6. Design Decision Rationale

**Config shape: enum knob vs explicit path?**
- Options: (a) `adr.on_supersede: in-place | move` with a fixed `superseded/` subdir; (b) `adr.superseded_dir: <path>` where presence implies move; (c) both.
- (a) matches the existing `adr.*` enum idiom (`adr.mode`, `adr.validate_git`), keeps a fixed contained subdir, and adds one DEFAULTS line. (b) opens a path-resolution + containment surface. (c) is redundant surface now.
- **Chosen:** (a) `adr.on_supersede: in-place | move`, default `in-place`, move target `<adr_docs_path>/superseded/` — minimal surface, convention-matching, trivially contained. The explicit-path variant is a clean later extension (OUT OF SCOPE).

**Move mechanism: `git mv` vs pure-fs + `git add -A`?**
- The ticket says "git mv within the same commit." The established sibling primitive `adrRenumber` uses pure `fs` (write new, rm old) and relies on the caller's `git add -A` to record the rename by similarity.
- **Chosen:** pure-fs move inside `recordSupersede`, git records the rename via the caller's existing `git add -A` staging — consistency with `adrRenumber`/`adrNew`/`adrAccept`, keeps the primitive pure and `--selftest`-testable, and achieves the ticket's "history follows the file" intent through git similarity detection.

**Primitive signature: fork vs optional parameter?**
- `recordSupersede` is prefix-shared with PRDR. A fork duplicates the write logic; a mode flag inside the primitive couples it to ADR config.
- **Chosen:** an optional trailing `supersededDir` parameter (null → today's behaviour). The ADR dispatch resolves config and passes it; the PRDR dispatch omits it, staying byte-identical. One write path, no PRDR coupling.

**Readers gated on the knob vs always spanning the union?**
- **Chosen:** readers (`validate`, `renumber`, `next-number`, listing) always span active ∪ superseded whenever the superseded dir exists, independent of `adr.on_supersede`. The knob governs the write only; a repo with moved records must validate correctly whatever the knob currently says.

**Open question 2 — must renumber/collision machinery look in the superseded dir?**
- **Chosen: yes.** The number space (occupancy, contiguity, duplicate detection) and the ref-scope back-ref rewrite both span the union, or a move+renumber sequence leaves an asymmetric cross-dir back-ref that the now-union-spanning validate would flag. This is load-bearing, not optional.

## 7. Open Questions and Assumptions

**Open Questions.** None — both ticket open questions are firmed above (config shape → enum knob; renumber cross-dir → yes).

**Assumptions.**

- **Assumes:** the ADR readers to audit for single-dir assumptions are exactly those in `plugin/skills/faff/bin/lib/adr.js` (`listAdrs`, `adrValidate`, `recordSupersessionProblems`, `adrAdvisories`, `adrLiveDecisions`, `adrGitTier`, `adrNextNumber`, `adrRenumber`, `recordSupersede`). Validation: `grep -n "listAdrs(" plugin/skills/faff/bin/lib/adr.js` enumerates every call site; route each through the scan set where a whole-set answer is required.
- **Assumes:** `faff config set adr.on_supersede move` needs no `.faffrc.example.yaml` edit because the `adr` top-level namespace is already documented there (the namespace-drift check is top-level only). Validation: run `faff config check --selftest` and `faff config defaults --selftest` after registering the DEFAULTS key.

## 8. DONE — Definition of Done

### From WHY
- [ ] With `adr.on_supersede` unset, `faff adr supersede` and `faff prdr supersede` are byte-identical to pre-change behaviour (no regression).

### From WHAT (config + types)
- [ ] `adr.on_supersede` registered in `config.js` DEFAULTS with default `"in-place"`; `faff config get adr.on_supersede` returns `in-place` unset and `move` when set.
- [ ] `faff config set adr.on_supersede move` succeeds; `config check --selftest` and `config defaults --selftest` pass.
- [ ] `recordSupersede` takes an optional trailing `supersededDir`; omitted → no move.
- [ ] A `listAdrsAcross([dirs])` helper (or equivalent) returns entries tagged with their containing dir, spanning active ∪ superseded.

### From HOW (behaviour)
- [ ] With `adr.on_supersede: move`, `faff adr supersede <old> --by <new>` relocates the OLD file to `<adr_docs_path>/superseded/`, both back-refs correct, exit 0; output paths reflect the relocated old path.
- [ ] The status/supersedes edits are written at each file's actual containing dir via `path.join(a.dir || dir, a.file)`; the `|| dir` fallback keeps the PRDR path (records without `.dir`) byte-identical.
- [ ] `prdr supersede` never receives a `supersededDir` argument, and `prdr --selftest` passes unchanged.
- [ ] Re-superseding an already-moved ADR is a no-op move (no self-move, no overwrite).

### From HOW (readers span the union)
- [ ] `faff adr validate` scans active ∪ superseded whenever the superseded dir exists (independent of the knob) and exits 0 for a valid moved-record tree.
- [ ] `faff adr next-number` never returns a number held by a superseded ADR in the superseded dir.
- [ ] `faff adr renumber` resolves occupancy, contiguity, and ref-scope back-refs across the union; a move+renumber sequence re-validates symmetric (exit 0).

### From HOW (edge cases)
- [ ] Non-existent superseded dir is treated as an empty scan-set contribution (no error); created on first move.
- [ ] A pre-existing target file in the superseded dir is refused, never overwritten (append-only).

**Eval coverage.** No LLM-judgement seam is introduced or changed — no grader/eval-case DONE item applies.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. In a temp repo: adr new "A" (→0001), adr new "B" (→0002)
  2. faff config set adr.on_supersede move
  3. faff adr supersede 0001 --by 0002
  4. ASSERT records/adr/superseded/0001-*.md exists AND records/adr/0001-*.md does not
  5. ASSERT faff adr validate exits 0
  6. ASSERT faff adr next-number == 0003 (0001 not reused)
```

## Methodology critique

_Methodology: faffter-dark-methodology-agile-delivery_

- **Right-sized?** No issues. One cohesive 1–3 day unit around a single concern (relocation-on-supersede). The three moving parts — the move in `recordSupersede`, the union-spanning readers, and the union-aware renumber — are not independent concerns to split: shipping the move without the union-spanning validate/renumber would leave a latent cross-dir asymmetry, so they always ship together. No split, no merge.
- **Workstream fit?** No issues. Sits squarely in the ADR-governance subsystem (`adr.js` + `adr.*` config), outcome-named, cohesive with FAFF-197/768.
- **Deps surfaced?** No issues. Builds only on already-Done work (FAFF-197, FAFF-768); no implicit blocker link is missing.
- **Risk profile?** No de-risking spike needed. The change is mechanical `fs` + a config knob with no novel integration or external dependency. The one real risk is a missed single-dir reader call site; the spec's Failure-modes section already names the audit (`grep -n "listAdrs("`) and the observable (a reused superseded number from `next-number`), so the risk is surfaced and testable under `adr --selftest`.

build-tier: complex
confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
