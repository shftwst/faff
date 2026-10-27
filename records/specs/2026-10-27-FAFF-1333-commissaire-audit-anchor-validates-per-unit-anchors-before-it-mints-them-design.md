# FAFF-1333 — `commissaire audit anchor` validates per-unit anchors before it mints them

> Spec: faffter-dark-nlspec · 2026-10-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1333.

> Revised on 2026-10-27 (spec-review round 1 → revise): the staging dir is now the issue-named `<tmp>/<issue>` (the first draft validated a random-named tmp root, which the adversarial architectural lens showed diverges from `--dest` via FAFF-1347's basename-keyed scope leg); and error-branch, multi-issue and governed-run tests were added (QA minor).
>
> Revised again on 2026-10-27 (spec-review round 2 → revise): reverted the round-1 "replace `--dest`" step — a `rmSync(dest)` on an unvalidated caller path was a safety regression (it could destroy a run dir / governor key); placement is now a plain non-destructive `cpSync` overwrite, identical to today. Residue on a re-mint and the `legacy`→mint disposition are documented as accepted, CI-backstopped trade-offs matching the existing anchor suite, with hardening named as out-of-scope extension points.

This spec routes `faff commissaire audit anchor` through evidence-schema validation at mint time, so a per-unit anchor whose v0.3 evidence fails its schema is refused with a redacted refusal line naming the file, rather than slipping through to fail late under CI's `evidence-schema: require`. Audience: the build agent implementing the change, and the human reviewers gating it.

## 1. WHY — Problem and Principles

**Load-bearing model.** An anchor is bytes copied out of a run directory into a destination the consumer later seals and commits. "Minting" today means *copy straight into `--dest`*. If you want "copy only on a pass", you cannot validate in place — you must mint somewhere *else*, judge those bytes, and only then place them under `--dest`. That staging seam is the whole shape of this change; everything below follows from it.

**Problem statement.** `faff commissaire audit anchor` mints a per-unit anchor by calling `mintIssueAnchor(runDir, issue, dest)` directly (`plugin/skills/faff/bin/lib/commissaire.ts:557`, emit at `commissaire.js:572`) with no evidence-schema check, so a non-conforming anchor is written and only rejected later by CI under `evidence-schema: require`. This change gives the command its own validation before it writes, refusing a schema-failing anchor at mint with a file-naming refusal line. It closes observation P3 from the FAFF-1261 review (accepted risk).

**Design principles.**

- **One validator, no forked copy.** Reuse the existing single evidence validator (`checkAnchorDir` in `evidence.js:643`) and the existing single byte-copy core (`mintIssueAnchor` in `events.js:1744`). Do not write a second anchor validator and do not write a second byte-copy. The only new surface is the stage → validate → place wrapper around those two.
- **Refuse by leaving nothing behind.** A refusal must leave nothing under `--dest` *or its parent*. Because `mintIssueAnchor` creates `--dest` (and, for the default path, its `anchors/<seg>` parent) with `mkdir -p` before it writes, "copy on a pass" forces minting into a staging directory outside the `--dest` subtree first.
- **Redaction is load-bearing, not cosmetic.** Refusal output carries paths, statuses and counts only — never violation text or field values. `checkAnchorDir` already returns exactly this shape (counts, sanitised paths), so reuse it verbatim; do not re-derive a richer report for the refusal line.
- **Fail closed on the external-consumer seam.** This command exists for an external consumer who does not shell out to the `faff` binary (FAFF-1015). If the bundled schema set cannot be loaded or the validator itself faults, minting *unchecked* is the exact hole this ticket closes — so an unavailable/errored validator refuses, it does not wave the anchor through.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript (governed emit is `commissaire.js`) | Hosts `cmdAuditAnchor`; the file this issue edits |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript | `mintIssueAnchor` (shared byte-copy core); `warnOnEvidenceSchema` (warn-only precedent, FAFF-1263) |
| `plugin/skills/faff/bin/lib/evidence.js` | JavaScript | `checkAnchorDir` (the one validator), `sanitiseDisplay`, `exitCodeFor` |

**Scope statement.** This sits at the per-unit anchor mint seam inside the standalone Commissaire facade — one command (`audit anchor`), not the run-close bundle builder (`audit seal`) and not `events anchor`/`anchor-run`.

## 2. OUT OF SCOPE

- **Changing `events anchor` to stage/validate/copy-on-pass (FAFF-1261).** — Excluded: FAFF-1261 owns that and is In Review, not on main; `events anchor` here is still warn-only (`events.js:1493`, `warnOnEvidenceSchema`). **Extension point:** when FAFF-1261 lands, converge `audit anchor` onto its shared staged-mint helper instead of keeping this spec's local wrapper — see Design Decision Rationale.
- **Changing the warn-only behaviour of `events anchor` / `warnOnEvidenceSchema`.** — Excluded: FAFF-1263 deliberately made that leg warn-only; this ticket adds a refusing leg to a *different* command. **Extension point:** `events.js:1711`.
- **Validating whole anchor *trees* / sealing.** — Excluded: `audit anchor` writes one issue's subdir; it never assembles or reads a whole anchor tree. **Extension point:** `audit seal` (`commissaire.ts`).
- **Adding a merge-floor or self-verify gate to `audit anchor`.** — Excluded by design: an external consumer legitimately has no `ac-checklist.json` / `review-verdict.json` and must not forge them (the FAFF-1015 invariant the current selftest pins). This change adds *only* the evidence-schema leg. **Extension point:** `anchor-run`'s self-verify (`events.js:1598-1624`).
- **A new evidence-schema spec version or manifest change.** — Excluded: this consumes the existing bundled v0.3 manifest. **Extension point:** `plugin/skills/faff/contracts/evidence-v0.3/`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| per-unit anchor | the single-issue subdirectory `audit anchor` mints (events.jsonl + run-ledger.json + chain-head.json, plus any optional floor/effects/pk files) |
| staging dir | a scratch directory outside the `--dest` subtree where the anchor is minted and validated before placement |
| conforming anchor | an anchor carrying v0.3 field-versioned evidence that validates (`checkAnchorDir` status `pass`) |
| legacy anchor | an anchor carrying no field-versioned doc with a stamped `schema_version` (pre-v0.3 / schema-1) — `checkAnchorDir` status `legacy` |
| refusal | the command writes nothing under `--dest`/parent, emits a redacted one-line + per-file reason to stderr, and exits non-zero |

**The validator's return shape (existing, reused unchanged — `evidence.js:643`).**

```
RECORD AnchorCheck:                      # checkAnchorDir(dir, {}) return
  status: "pass" | "legacy" | "fail" | "error"
  files: List<{ path: String,            # sanitised; non-"ok" files only
                status: String,          # e.g. "fail", "legacy", "unschemaed"
                violations: Int }>       # COUNT only — never the violation text
  reason: String | null                  # set on "error"; sanitised; no field values
  schema_unavailable: Boolean            # true when the bundled schema set could not be used
  events_scope: object | null            # FAFF-1347; typed/closed-set only
  # CONSTRAINT: carries paths, statuses and counts only. No violation text, no field values.
```

**Mint-disposition decision (the core policy).** Map each `AnchorCheck.status` to mint-vs-refuse:

| status | meaning | disposition |
|---|---|---|
| `pass` | v0.3 evidence present and valid | **mint** (place under `--dest`) |
| `legacy` | no stamped v0.3 evidence (schema-1 / external minimal run) | **mint** |
| `fail` | v0.3 evidence present and invalid | **refuse** |
| `error` | validator faulted (unrecognised result, exception) | **refuse** (fail closed) |
| `schema_unavailable` (carried on an `error`) | bundled schema set unusable | **refuse** (fail closed) |

**Chosen:** refuse on `fail`, `error`, and `schema_unavailable`; mint on `pass` and `legacy`. Rationale lives in Design Decision Rationale; the pivotal point is that the *existing* `audit anchor` selftest round-trip seeds a schema-1 run whose `run-ledger.json` carries no `schema_version`, which validates as `legacy` — so refusing `legacy` would break "mints as today" and every external consumer anchoring a pre-v0.3 run.

**Exit codes (existing + one new).**

```
ENUM AuditAnchorExit:
  0  ok — minted (placed under --dest)
  2  usage / --unit-id shape / dest-resolution         # unchanged
  3  no-events / genesis-invalid (from mintIssueAnchor) # unchanged
  4  evidence-schema refusal                            # NEW — distinct from 2/3
```

**Chosen:** `4` for a schema refusal. It is unused by `audit anchor` today and distinct from the usage/no-events families, so a caller can tell a schema refusal from a bad invocation by exit code alone. Verify at build time that `4` does not collide with a sibling `commissaire` subcommand's documented code in a way that confuses a shared caller (the methodology critique flags `commissaire admit`'s exit 4 for "admit internal failure, nothing written"); if a shared caller branches on the binary's exit code regardless of subcommand, pick the next unused code instead — the contract is "a schema refusal is machine-distinguishable from usage/no-events", not the literal `4`.

**AuditAnchorOutput (stdout, unchanged on a successful mint).**

```
RECORD AuditAnchorOutput:                # JSON on stdout, exit 0 — identical to today
  minted: true
  issue: String
  unit_id: String
  dest: String                           # the REAL --dest, never the staging dir
  head: ChainHead                        # from mintIssueAnchor; dir-independent
  copied_floor_files: List<String>
  effects_anchored: Boolean
```

`head`, `copied_floor_files`, `effects_anchored` all come from the `mintIssueAnchor` result computed during staging; `computeChainHead` keys off `path.basename(runDir)` and `issue`, not the destination path (`events.js:1763,1819`), so the staged bytes are byte-identical to what lands at `--dest` and the printed `head` is unchanged.

## 4. HOW — Behavior

**Architecture and approach.** `cmdAuditAnchor` keeps its existing front half unchanged: `requireRunDir`, the `--unit-id` shape guard, and `--dest` resolution (including the "no resolvable root" guard). The only change is the tail: instead of `mintIssueAnchor(runDir, issue, dest)` straight into `dest`, mint into a staging dir, validate it, and place it under `dest` only on a minting disposition. `checkAnchorDir` and `sanitiseDisplay` are `require("./evidence")`-d lazily inside the new tail (mirroring `warnOnEvidenceSchema` at `events.js:1714` and the existing lazy `require("./evidence")` at `commissaire.ts:188,204`), to keep the module load graph unchanged. Note `checkAnchorDir` is not currently imported into `commissaire.ts` (only `mintIssueAnchor` is, from `events.js`) — this lazy require is a real new code dependency.

**Behaviour summary.** Mint into an *issue-named* scratch subdir; if it fails the schema, delete it and refuse without touching `--dest`; otherwise replace `--dest` with exactly those validated bytes and print the same JSON as today.

**The basename is load-bearing — stage into `<tmp>/<issue>`, not the tmp root.** `checkAnchorDir` folds in the FAFF-1347 `events_scope` leg, whose `resolveAnchorScope` (`events.js`) has an *unconditional* step: `if (path.basename(anchorDir) !== proposed) return { accepted: null, refusals: [PATH_DISAGREES] }`, after which `validateAnchorEventsScoped` falls back to **whole-file** judgement (every row gates, including rows belonging to *other* admitted issues in the same run). A `mkdtemp` directory has a random basename that never equals the issue, so validating the tmp root directly would whole-file-gate and **diverge** from the real `--dest` (whose basename *is* the issue and so narrows correctly) — falsely refusing a conforming multi-issue anchor, exactly the FAFF-1015 external-consumer case. Therefore mint and validate the inner `path.join(staging, issue)` directory, whose basename equals the issue, so the staged verdict matches the placed verdict byte-for-byte on every run (single- *and* multi-issue). This was the architectural defect in the first draft; it is the pivot of the whole approach.

```
PROCEDURE audit_anchor_tail(runDir, issue, dest):   # replaces commissaire.ts:557-571
  1. staging ← mkdtemp(os.tmpdir() + "/faff-audit-anchor-")
  2. inner   ← path.join(staging, issue)              # basename(inner) == issue — load-bearing (scope leg)
  3. result ← mintIssueAnchor(runDir, issue, inner)   # SAME core as today
  4. IF NOT result.ok:
       a. rmSync(staging, recursive, force)           # scratch only; dest untouched
       b. write stderr "faff commissaire audit anchor: <result.message>"
       c. RETURN result.code == "no-events" ? 3 : 2   # unchanged mapping
  5. { checkAnchorDir, sanitiseDisplay } ← require("./evidence")
  6. check ← checkAnchorDir(inner, {})                # validate the ISSUE-named dir, never the tmp root
  7. IF check.status is "fail" OR "error" (incl. schema_unavailable):
       a. emit_refusal(check, issue, dest, sanitiseDisplay)   # stderr, redacted
       b. rmSync(staging, recursive, force)
       c. RETURN 4
  8. # status is "pass" or "legacy" → place under dest
     a. cpSync(inner → dest, recursive)               # creates dest + parents; overwrite-in-place, exactly as today
     b. rmSync(staging, recursive, force)
     c. print AuditAnchorOutput JSON (using the REAL dest, result.head/…)
     d. RETURN 0
```

`audit anchor` **only ever creates/overwrites files** — it never deletes a caller-supplied path. `cpSync` into `--dest` is the identical in-place overwrite `mintIssueAnchor` does today; the single behavioural change this ticket makes is the pre-copy refusal, nothing else. An earlier draft added a `rmSync(dest)` "replace" to drop residue, but that turned a residue *minor* into a safety *major* — `rmSync(dest, recursive, force)` on an unvalidated caller path (`--dest <runDir>`, `--dest .faff`) would recursively destroy the run dir, ledger, and governor signing key. That is rejected: the command must not grow a destructive delete of an arbitrary path. Residue is handled as the documented accepted trade-off below.

```
PROCEDURE emit_refusal(check, issue, dest, sanitise):
  who  ← sanitise(issue)
  dst  ← sanitise(dest)
  1. IF check.status == "error":
       write "faff commissaire audit anchor: evidence-schema refusal: error <who>: <check.reason>; nothing written to <dst>"
       RETURN                      # check.reason is already sanitised; no field values
  2. write "faff commissaire audit anchor: evidence-schema refusal: <check.status> <who> (<check.files.length> non-conforming file(s)); nothing written to <dst>"
  3. FOR f IN check.files[:5]:     # cap at 5, mirroring warnOnEvidenceSchema
       write "  <f.path>: <f.status>, <f.violations> violation(s)"
  4. IF check.files.length > 5:
       write "  (+<N-5> more files)"
```

**Why staging in `os.tmpdir()` and a recursive copy (not a rename).** `mintIssueAnchor` creates its destination with `mkdir -p`; minting directly into `dest` and removing on failure would transiently create `dest` and (for the default path) its `anchors/<seg>` parent, which the first acceptance criterion forbids and a crash mid-remove would leave behind. Staging in `os.tmpdir()` keeps every byte out of the `--dest` subtree until a pass. A `rename` from tmp into `dest` can cross filesystems (`EXDEV`); a recursive copy (`cpSync`, Node ≥ 16.7; adopter floor is Node 20 per `AGENTS.md`) always works and copies the nested `commissaire/producer/pk.json` layout intact. The copy source is the inner `<staging>/<issue>` directory (never the tmp root), so what lands at `--dest` is byte-for-byte the tree `checkAnchorDir` just passed.

**Residue on a re-mint is an accepted, documented trade-off (not a destructive replace).** When `--dest` already exists, `cpSync` overwrites the files the mint produces but leaves any pre-existing *unrelated* file in place — so the committed tree is staging ∪ prior residue, exactly as `audit anchor` behaves today. This is deliberately **not** "fixed" by deleting `--dest` first: the writer of `--dest` is the same trust domain as the consumer invoking the command, CI's `evidence-schema: require` is the whole-tree backstop, and a clean tree is already available by pointing `--dest` at a fresh directory (the default per-run path is always fresh). Hardening re-mint residue — whether by refusing a non-empty `--dest` (as `audit export` does) or an atomic temp-sibling swap — is a separate decision about the command's placement contract, **out of scope** here; this ticket adds the mint-time schema refusal only. **Extension point:** the placement tail of `cmdAuditAnchor`.

**Edge cases and error handling.**

- **no-events / genesis-invalid:** `mintIssueAnchor` returns `!ok` before writing anything substantial; staging is removed and the existing exit `3`/`2` mapping is preserved (step 4). Validation never runs.
- **`--dest` already exists (re-mint):** `cpSync` overwrites the minted files in place (today's behaviour); on a refusal the pre-existing `--dest` is **not** touched at all — validation happened entirely in staging, so a schema-failing re-mint leaves the prior anchor intact (strictly safer than a design that cleared `--dest` up front).
- **Default-dest parent:** on a pass, `cpSync` creates `anchors/<seg>/<issue>` and parents; on a refusal neither `anchors/<seg>` nor `<issue>` is created.
- **staging cleanup is best-effort but refusal is authoritative:** even if `rmSync(staging)` throws, `--dest` reflects the disposition (untouched on a refusal, the minted bytes on a pass) and the exit code still reflects it (wrap cleanup so it cannot change the return code).

**Anti-pattern:** minting into `dest` and `rm`-ing it on failure. Why: it transiently creates `dest`/parent and can leave them behind on an interrupted cleanup, violating AC1.

**Anti-pattern:** re-reading or re-deriving the violation text for a nicer refusal message. Why: `checkAnchorDir` deliberately returns counts only; pulling field values back in would leak exactly what the third acceptance criterion forbids.

**Anti-pattern:** writing a second byte-copy or a second anchor validator "because it's just a per-unit anchor". Why: the composition / one-validator rule — reuse `mintIssueAnchor` and `checkAnchorDir`.

**Failure modes.**

- **The failure (the one that sank the first draft):** staging validates *different* bytes than `--dest` would. `checkAnchorDir`'s FAFF-1347 scope leg **does** key off `path.basename(anchorDir)` (`resolveAnchorScope` → `PATH_DISAGREES` → whole-file gating), so validating a random-named tmp root diverges from `--dest` on a multi-issue run (stricter in staging). **How you'd know:** a conforming multi-issue anchor is falsely refused with exit 4; a single-issue smoke test would *not* catch it. **What it means:** the fix is already in the procedure — mint and validate `<staging>/<issue>` (basename == issue), so the scope leg narrows identically to `--dest`. `computeChainHead(eventsBuf, basename(runDir), issue)` is keyed on the *run dir* basename and the issue, not the dest path, so the head is unchanged; the staged `<issue>` dir and the placed `--dest` are byte-identical. The DONE tests include a **multi-issue** fixture precisely to guard this.
- **The failure:** fail-closed on `schema_unavailable` makes the command unusable where the bundle is genuinely missing, turning a config problem into a hard refusal for every mint. **How you'd know:** `audit anchor` starts returning `4` with an `error … schema-unavailable` line across all invocations in one environment. **What it means:** narrow — that is a broken install to fix at the bundle, not a reason to mint unchecked; the refusal names the cause without leaking content.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run dir whose per-unit evidence carries a v0.3 schema_version but violates its schema
When `faff commissaire audit anchor --run-dir <run> --unit-id <id> --dest <dest>` runs
Then the command exits 4
 And nothing exists at <dest> or at <dest>'s parent directory
 And stderr carries a one-line evidence-schema refusal naming <dest> plus per-file "<path>: <status>, <N> violation(s)" lines, with no violation text or field values
```

```
Given a run dir whose per-unit evidence is valid v0.3 (conforming)
When `faff commissaire audit anchor … --dest <dest>` runs
Then the command exits 0 with the same AuditAnchorOutput JSON shape as today (minted:true, issue, unit_id, dest, head, copied_floor_files, effects_anchored)
 And `faff evidence validate --require-evidence-schema <dest>` exits 0
```

```
Given a seeded run dir whose genesis chain is absent (no events)
When `faff commissaire audit anchor … --dest <dest>` runs
Then the command exits 3 (unchanged) and nothing is written at <dest>
 And validation never ran (the pre-write refusal still governs)
```

```
Given a run whose evidence the validator cannot judge — checkAnchorDir returns status "error" (e.g. schema_unavailable, the bundled schema set unloadable)
When `faff commissaire audit anchor … --dest <dest>` runs
Then the command exits 4 (fail closed — never minted unchecked)
 And nothing exists at <dest> or its parent
 And stderr carries "evidence-schema refusal: error <issue>: <reason>; nothing written to <dest>" with only checkAnchorDir's sanitised reason, no field values
```

```
Given a run that touched two admitted issues (events.jsonl carries rows for both), each conforming under its own per-issue scope
When `faff commissaire audit anchor … --unit-id <issueA> --dest <dest>` runs
Then the command exits 0 and mints (the other issue's rows are scoped out, not whole-file-gated), proving staging validation at <staging>/<issueA> matches a validation at <dest>
```

```
Given a conforming anchor already minted at <dest>, and a run whose current evidence FAILS its schema
When `faff commissaire audit anchor … --dest <dest>` runs (a schema-failing re-mint)
Then the command exits 4 and the pre-existing <dest> is left entirely untouched (byte-for-byte unchanged) — the pre-write refusal governs and placement is never reached
```

```
Given a governed run carrying commissaire/producer/pk.json (the FAFF-976 byte-copy), otherwise conforming
When `faff commissaire audit anchor … --dest <dest>` runs
Then the command exits 0 and mints — pk.json is a named manifest entry, so a governed anchor (the external-consumer case) is judged normally, not refused as unschemaed
```

- The refusal path MUST NOT print any evidence field value or violation message at any verbosity — only sanitised paths, closed-set statuses, and integer counts.

## 6. DESIGN DECISION RATIONALE

**How do we copy to `--dest` only on a pass, given `mintIssueAnchor` writes in place?**
- *Mint-to-dest, remove-on-fail:* simplest diff, but transiently creates `dest`/parent and can leave them on an interrupted cleanup — violates AC1.
- *Stage as a sibling of `dest`:* avoids tmp, but creating the sibling still materialises `dest`'s parent (`anchors/<seg>`), which AC1 forbids.
- *Stage in `os.tmpdir()`, validate, `cpSync` into `dest` on a pass, `rm` staging always.*
- **Chosen:** stage into an **issue-named** subdir `<os.tmpdir()/…>/<issue>`, validate *that* dir, then recursive-copy it into `dest` on a pass — the only option that keeps every byte out of the `--dest` subtree until validation passes *and* keeps the staged verdict identical to the placed one. The issue-named subdir is load-bearing: `checkAnchorDir`'s FAFF-1347 scope leg keys off `path.basename(anchorDir)`, so validating a random tmp-root name would whole-file-gate and diverge from `--dest`. `mintIssueAnchor` is used unchanged as the copy core.

**How do we place onto `--dest` without the command growing a destructive delete (infosec major, round 2)?**
- *`rmSync(dest)` then copy (the round-1 "replace"):* makes the committed tree exactly the validated bytes, but `rmSync(recursive, force)` on an unvalidated caller `--dest` (`<runDir>`, `.faff`) destroys the run dir / ledger / governor key — a safety major, and a new destructive capability this command never had.
- *Refuse a non-empty `--dest` (as `audit export` does):* safe, but breaks re-mint, a first-class external-consumer operation.
- **Chosen:** plain `cpSync(inner → dest)` — overwrite-in-place, identical to today's `mintIssueAnchor` placement. The command keeps its create-only posture (it never deletes a caller path), re-mint keeps working, and a refusal never touches a pre-existing `--dest`. The residual (a prior-mint stray file surviving a re-mint) is the documented accepted trade-off above — a pre-existing same-trust-domain minor backstopped by CI, not worth a destructive delete to close.

**Does `legacy` → mint let a producer strip `schema_version` to dodge the gate (infosec minor, round 2)?**
- *Qualify `legacy` → mint with a temporal cutoff* (mirror `evaluateRunDirEventsSchema`'s FAFF-1353 `legacy_relief`: mint `legacy` only when the run's genesis predates the v0.3 cutover): closes the strip-to-downgrade path.
- **Chosen:** `legacy` → mint, unqualified — **matching the shipped `--legacy-policy pass` disposition every other anchor path already uses** (`events anchor`, `anchor-run`, `anchor`'s own `validateAnchorGenesis`). A producer that strips `schema_version` is the same trust domain as one that writes bad evidence, and CI's `evidence-schema: require` is the backstop. Making `audit anchor` *stricter* than the rest of the anchor suite is a cross-cutting change to the shared legacy policy, **out of scope** for this one command. **Extension point:** `evaluateRunDirEventsSchema`'s `legacy_relief` cutoff, applied suite-wide if the strip-downgrade is ever judged a real threat.

**Which `checkAnchorDir` statuses refuse?**
- *Mint iff `exitCodeFor(report, true) === 0`:* would refuse `legacy` — but the existing selftest round-trip and external minimal runs are `legacy`, so this breaks "mints as today" (AC2) and FAFF-1015's external-consumer contract.
- *Refuse only `fail`; wave through `error`/`unavailable`:* reopens the unchecked-mint hole for a broken bundle.
- **Chosen:** refuse `fail` + `error` + `schema_unavailable`; mint `pass` + `legacy`. This mirrors `anchor-run`'s `--legacy-policy pass` disposition (legacy anchors cleanly; broken/mismatch fail) and fails closed on the one seam — a missing/faulting validator — where minting unchecked is the very bug FAFF-1333 fixes.

**Is validation unconditional or flag-gated?**
- *Opt-out flag (e.g. `--no-evidence-schema`):* an escape hatch for external consumers — but it re-creates the hole, and the legitimate pre-v0.3 case is already handled by the `legacy`→mint disposition.
- **Chosen:** unconditional. The acceptance criteria read as unconditional refusal at mint, and there is no benign case the `legacy` disposition does not already cover.

**Exit code for a schema refusal.**
- **Chosen:** `4`, subject to the no-collision verification noted in WHAT. Unused by `audit anchor`, distinct from usage (`2`) and no-events (`3`), so a schema refusal is machine-distinguishable.

**Convergence with FAFF-1261 (temporal anchor).** At the time of writing, FAFF-1261 (the `events anchor` staged mint) is In Review, not merged to `main`; `events anchor` on `main` is still warn-only. This spec therefore takes the ticket's OR branch — `audit anchor` gets its own validation, reusing `checkAnchorDir` — buildable now with no dependency. When FAFF-1261 lands and extracts a shared stage→validate→copy-on-pass helper, `audit anchor` should be rebased onto that helper rather than keeping this local wrapper, so the two commands share one staged-mint path. This spec deliberately does not fork a second byte-copy or a second validator, so that convergence is a lift-and-replace of the wrapper only. A non-blocking follow-up ticket ("converge `commissaire audit anchor` onto FAFF-1261's shared staged-mint helper", `blockedBy` FAFF-1261) is recommended so the convergence is tracked, not buried in prose.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None (no blocking punts).

**Assumptions.**

- **Assumes:** `checkAnchorDir(<staging>/<issue>, {})` — where the validated directory's basename equals the issue — is equivalent to validating `--dest`. This holds *because* the basenames match: `checkAnchorDir`'s FAFF-1347 scope leg keys off `path.basename(anchorDir)`, so an issue-named staging dir narrows exactly as `--dest` does, and `computeChainHead` is keyed on `basename(runDir)`+`issue` (not the dest path). *Validate:* read `resolveAnchorScope` (`events.js`, the `PATH_DISAGREES` step) and `validateAnchorEventsScoped` to confirm basename is the only directory-name input, then the DONE multi-issue byte-identity test confirms it end to end across every status branch. (The first draft assumed the directory name was *ignored*; the spec-review architectural lens falsified that against the shipped validator, which is why the design now stages into `<staging>/<issue>`.)
- **Assumes:** `fs.cpSync(recursive)` is available on the adopter Node floor (≥ 20 per `AGENTS.md`). *Validate:* `cpSync` landed in Node 16.7; the floor is 20, so this holds — confirm no lint forbids it.

## 8. DONE — Definition of Done

### From WHY
- [ ] A per-unit anchor carrying v0.3 evidence that fails its schema is refused at mint (exit 4), not written and caught later by CI.

### From WHAT (types / policy)
- [ ] `checkAnchorDir` status `fail`, `error`, and `error`-with-`schema_unavailable` each cause a refusal; `pass` and `legacy` each mint.
- [ ] A schema refusal exits `4` (or the chosen non-colliding code); usage/shape/dest still exit `2`; no-events/genesis-invalid still exit `3`; a successful mint still exits `0`.
- [ ] On exit 0 the stdout JSON is unchanged: `{minted:true, issue, unit_id, dest, head, copied_floor_files, effects_anchored}` with the real `--dest`.

### From HOW (behaviour)
- [ ] `audit anchor` mints into an **issue-named** subdir `<os.tmpdir()/…>/<issue>`, validates *that* dir with `checkAnchorDir`, and copies it into `--dest` only on a `pass`/`legacy` disposition; the staging dir is removed in every path.
- [ ] Placement is a plain `cpSync` overwrite-in-place (today's behaviour); the command **never** deletes a caller-supplied path (no `rmSync`/`rename` of `--dest`).
- [ ] On a refusal, nothing exists under `--dest` or its parent (including the default `anchors/<seg>` parent) when `--dest` did not previously exist, and any pre-existing `--dest` is left entirely untouched.
- [ ] The implementation reuses `mintIssueAnchor` (no second byte-copy) and `checkAnchorDir` (no second validator); `evidence` is required lazily in the new tail.

### From HOW (redaction)
- [ ] The refusal writes one summary line naming `--dest` plus up to 5 `  <path>: <status>, <N> violation(s)` lines (and a `(+N more files)` line past 5), via `sanitiseDisplay`, with no violation text or field values at any verbosity.
- [ ] The `error`/`schema_unavailable` refusal line prints only `checkAnchorDir`'s sanitised `reason`.

### From WHAT (build artifact — AGENTS.md)
- [ ] The edit is made in `commissaire.ts` and the committed `commissaire.js` emit + `build-manifest.json` are regenerated (`cd plugin/skills/faff && npm install && npm run build`) and committed; `faff regions check` passes.

### From Scenarios (tests)
- [ ] The `audit anchor` selftest block in `commissaire.ts` (around the emit's `commissaire.js:1769`) is extended: a run seeded with a schema-violating v0.3 `run-ledger.json` (carrying a `schema_version`) refuses with exit 4 and leaves nothing at `--dest` or its parent; the existing schema-1 round-trip still mints exit 0 (legacy); a conforming v0.3 anchor mints and `faff evidence validate --require-evidence-schema <dest>` exits 0.
- [ ] A **multi-issue** fixture: a run whose `events.jsonl` carries rows for two admitted issues, each conforming under its own scope, mints exit 0 for one unit-id (proving the issue-named staging dir scopes identically to `--dest`, not whole-file-gating the other issue's rows). This fixture is the guard against the architectural staging-divergence defect.
- [ ] An **error-branch** test: `checkAnchorDir` returning status `error` (incl. `schema_unavailable`) refuses with exit 4 and the `error <issue>: <reason>` line format, leaving nothing at `--dest`.
- [ ] A **governed-run** fixture: a run carrying `commissaire/producer/pk.json` (the FAFF-976 byte-copy) mints exit 0 — proving a governed anchor (the external-consumer case) is judged normally by the manifest, not auto-refused as `unschemaed`.
- [ ] A **refusal-against-pre-existing-`--dest`** test: a schema-failing re-mint against an existing `--dest` exits 4 and leaves the prior `--dest` entirely untouched (the pre-write refusal governs; placement is never reached).
- [ ] A CLI-level check confirms the refusal stderr contains no evidence field value (counts/paths/statuses only).

**Integration smoke test.**

```
PROCEDURE smoke():
  1. seed runDir with a schema-1 events.jsonl + run-ledger.json (no schema_version)
  2. audit anchor --run-dir runDir --unit-id FAFF-1 --dest D1   # legacy → mint
     ASSERT exit 0 AND D1/events.jsonl bytes == runDir/events.jsonl bytes
  3. seed runDir2 with run-ledger.json carrying a schema_version but an invalid body
  4. audit anchor --run-dir runDir2 --unit-id FAFF-1 --dest D2  # fail → refuse
     ASSERT exit 4 AND NOT exists(D2) AND NOT exists(parent(D2))
     AND stderr matches /evidence-schema refusal/ AND stderr has no field values
```

confidence: high
spec-review: approve
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

**Right-sized?** No issues. The spec is one command (`cmdAuditAnchor` in `commissaire.ts`, currently a direct `mintIssueAnchor(runDir, issue, dest)` → exit 0 at lines 557-571) gaining a single cohesive concern: gate the mint behind `checkAnchorDir` and refuse on failure. The new exit code and refusal line are the gate's output, not an independent second concern, and both halves reuse existing helpers (`mintIssueAnchor`, `checkAnchorDir`) rather than building new machinery. That is an honest 1-3 day unit — nothing to split, nothing to merge.

**Workstream fit?** The issue sits in Backlog with no project, but it is plainly one of a family — FAFF-1261 (`events anchor` staged mint, In Review), FAFF-1263 (warn-only precedent, merged), FAFF-1347 (`events_scope`, merged) and this ticket all converge on one outcome: *anchor evidence is schema-validated before it is trusted/minted*. Left loose, that convergence is invisible at the tracker level, so the real sequencing relationship can't be ordered — in particular that FAFF-1261's shared staged-mint path arguably wants to land first so this ticket converges onto it rather than building a throwaway own-validation path, and that 1263→1333 is a deliberate warn-only→refuse progression. Consider an outcome-named home (e.g. "schema-validated anchor minting") grouping 1261/1263/1333 so the set can be sequenced as a stream, or confirm on the ticket that it is deliberately loose. (Proposal only — conservative; a wrong grouping costs more than a loose ticket.)

**Deps surfaced?** The spec's first "What" bullet mirrors FAFF-1261's shared staged-mint helper and names a future "converge onto FAFF-1261's helper later" step, but FAFF-1261 is only noted as "Related (not blocking)" and the convergence lives in spec prose with no tracked follow-up. The *decoupling* is the right call — taking the OR branch (own validation now) avoids blocking buildable work on an In-Review ticket that isn't on main. The gap is principle-6: a load-bearing future dependency recorded only in prose is unfinished thinking — if FAFF-1261 merges, nothing in the tracker makes anyone converge. Keep a non-blocking "related" link to FAFF-1261 and file an explicit follow-up ticket ("converge `commissaire audit anchor` onto FAFF-1261's shared staged-mint helper", `blockedBy` FAFF-1261) so the convergence is sequenced rather than buried. (Minor, related: `checkAnchorDir` currently lives in `evidence.js` and is not yet imported into `commissaire.ts` — only `mintIssueAnchor` is, from `events.js`; a real code dep the spec silently assumes.)

**Risk profile?** Two surfaces. First, the spec's single Assumes — *staging validation equivalent to dest validation* — is the load-bearing novelty: `checkAnchorDir` runs against an `os.tmpdir()` staging dir, then the bytes are copied to `--dest` only on pass. `checkAnchorDir` resolves the bundled v0.3 schemas, folds in the FAFF-1347 `events_scope` leg, and returns `error`/`schema_unavailable` branches (evidence.js:643-675); if any of its verdict is path- or filesystem-sensitive, a staging "pass" could diverge from the real dest — minting invalid evidence or refusing valid evidence, exactly the surprise principle 7 wants pulled forward, not discovered after merge. Second, exit code 4 is already in use in this same binary — `commissaire admit` returns 4 for "admit internal failure, nothing written" (commissaire.ts:743) — so the spec's "new exit 4" overloads one code with two meanings across subcommands, and any caller branching on exit status loses legibility. De-risk early: a focused test asserting `checkAnchorDir` yields a byte-identical verdict in tmpdir-staging vs in-place-at-dest across every branch (pass, legacy relief, fail, error, schema_unavailable, events_scope) plus the cross-filesystem copy/rename path; and confirm 4 is the intended shared "refused, nothing written" code (or choose an unused one) before committing to the exit contract.
