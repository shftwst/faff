# FAFF-959 — Re-stamp `pre_ruling_*` per proposition at dispatch: a `spec-judge-evidence --restamp` seam

> Spec: faffter-dark-nlspec · 2026-09-02 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-959.
build-tier: standard

## Why

**The load-bearing model.** The spec-review judge's admit roll-up decides whether a `UPHOLD_REVIEW`/`SYNTHESIZE` correction actually landed by comparing the current spec against a *pre-correction snapshot* stored in the ledger (`pre_ruling_spec_sha` + `pre_ruling_spec_content`). For that comparison to be honest, each proposition's snapshot must reflect the spec *as it stood just before that proposition's own correction* — after every earlier proposition's correction has already been applied. Today the snapshot is captured **once, for all propositions, at assemble time**, so every proposition after the first is judged against a stale snapshot.

**Problem.** `faff spec-judge-evidence --assemble` writes a single `const specSha = sha256Text(specText)` and the whole `specText` into every ledger entry before the dispatch loop runs (`spec-judge-casefile.js` `assemble()`, lines 317–393). FAFF-930 (PR #797, merged 407be00b) shipped the correction-applied check that reads these fields but left the per-proposition re-stamp as a **prose-only obligation** in faff-prep's SKILL.md — the dispatch prose must hand-edit `ledger.json` before applying each correction, with no CLI seam behind it. This change adds that seam: a third `--restamp` mode that rewrites one proposition's two `pre_ruling_*` fields to the current on-disk spec state, so the dispatch re-stamp is a deterministic CLI call, not a hand-edit.

**Why it matters (the concrete failure).** `correctionApplied(entry, ruling, currentSpecText)` (`spec-judge-casefile.js`:406–419) treats a correction as applied when the verification literal is present in the current spec, **absent from `entry.pre_ruling_spec_content`**, and the whole-file hash differs from `entry.pre_ruling_spec_sha`. With an assemble-time snapshot shared across propositions, cross-proposition contamination is possible: if proposition p-01's applied correction text happens to contain p-03's ≥24-char verification literal, then when p-03 is rolled up, its literal is already present in the *current* spec and *absent* from p-03's *stale* assemble-time snapshot — so p-03 reads as "applied" even though p-03's own correction was never made. Per-proposition re-stamping removes the shared-snapshot confound: each proposition's `absent-before` check runs against the spec state that immediately preceded that proposition's correction.

**Design principle — fail-loud, because restamp only ever runs mid-dispatch.** Unlike `--assemble`/the evidence bundle (which fail *safe* on an unreadable `--dir`, parking the loop), `--restamp` is called by the dispatch loop *after* `--assemble` has provably written `ledger.json`. A missing/malformed ledger at restamp time is therefore a plumbing fault, not an expected degrade — it fails loud (exit 2), consistent with `--admit`'s treatment of the same ledger.

**Design principle — the seam owns the ledger, not the case file.** `argument_B` re-derivation (the blinded defence the judge reads) lives in `case-<pid>.json`, not the ledger. Re-deriving it means re-running `deriveArgumentB` and re-blinding the anonymised A/B pair under the run seed — a materially larger job than rewriting two scalar ledger fields. This seam's job is strictly the ledger's `pre_ruling_*` fields; `argument_B` re-derivation stays a prose obligation of the dispatch loop.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/spec-judge-evidence.js` | Node.js | Hosts `cmdSpecJudgeEvidence` dispatch + `cmdAssemble`/`cmdAdmit`; gains `cmdRestamp` |
| `plugin/skills/faff/bin/lib/spec-judge-casefile.js` | Node.js | Exports `sha256Text`, `assemble`, `correctionApplied` — the snapshot writer and reader |
| `plugin/skills/faff-prep/SKILL.md` (line 197) | Prose | Dispatch step 2 that currently mandates the ledger hand-edit |
| `docs/guide/cli.md` (line 160) | Docs | The `spec-judge-evidence` row lint-cli-doc checks |

**Scope.** A bounded, mechanical CLI-seam addition — a third mode on an existing subcommand — plus a one-line simplification of the faff-prep dispatch prose to call the seam. It is the CLI backing for an obligation FAFF-930 already wrote into the prose.

## What

1. **A `--restamp` mode** on `faff spec-judge-evidence`. Signature: `faff spec-judge-evidence --restamp --pid <pid> --spec <file> [--out <judge-dir> | --dir <scratch>]`. It loads `ledger.json`, rewrites *only* `entries[pid].pre_ruling_spec_sha` and `entries[pid].pre_ruling_spec_content` to the current `--spec` state (`sha256Text(specText)` and the full `specText`), writes `ledger.json` back, and prints a one-line confirmation JSON. All other ledger fields (for `pid` and every other proposition) are preserved byte-for-byte through the JSON round-trip.

2. **Dispatch routing + mutual exclusion.** `cmdSpecJudgeEvidence` gains `if (values["--restamp"]) return cmdRestamp(values);` after the existing assemble/admit branches, and `--restamp` joins the mutually-exclusive guard so any two of `--assemble`/`--admit`/`--restamp` together is a `usageError`.

3. **faff-prep SKILL.md simplification.** Step 2 of the Spec-review judge (line 197) drops the "write them back into `ledger.json`" hand-edit clause and instead instructs a `"$faff" spec-judge-evidence --restamp --pid <pid> --spec <spec-file> --out $scratch/judge` call before applying each correction. The re-read-and-re-derive-`argument_B` obligation stays (the seam does not cover it).

4. **CLI doc row.** `docs/guide/cli.md`'s `spec-judge-evidence` row gains a sentence naming the third `--restamp` mode, so lint-cli-doc stays green.

5. **Tests** for the new mode under the existing `spec-judge-evidence` subcommand coverage (no new coverage registration needed).

**Decisions**

- **Chosen:** Add `--restamp` as a **third mode on the existing `spec-judge-evidence` subcommand**, routed by boolean-flag presence exactly like `--assemble`/`--admit`, not a new subcommand. Keeps one subcommand, one coverage entry, one doc row; mirrors the shipped pattern.
- **Chosen:** `--restamp` rewrites **only** `pre_ruling_spec_sha` + `pre_ruling_spec_content` for the one `--pid`. `argument_B` re-derivation stays a prose obligation of the dispatch loop (it lives in `case-<pid>.json`, and re-blinding is out of this seam's scope).
- **Chosen:** **Fail-loud exit 2** on a missing/malformed `ledger.json`, a ledger with no `order[]`/`entries{}`, or a `--pid` not present in the ledger — restamp runs only mid-dispatch when the ledger provably exists, so any of these is a plumbing fault, not a degrade. `usageError` exit 2 on missing/invalid flags; unreadable `--spec` exit 2; success exit 0 + one JSON line.
- **Chosen:** Match `--assemble`'s **plain `fs.writeFileSync(path, JSON.stringify(ledger,null,2)+"\n", {mode:0o600})` + best-effort `fs.chmodSync(...,0o600)`** — no atomic temp-swap. The existing assemble/admit writes are plain and 0600; a single-writer mid-dispatch re-stamp has no concurrent-reader hazard the assemble write does not already tolerate, so introducing an atomic-swap here would diverge from the sibling for no gain.
- **Chosen:** Success prints one line: `{ "restamped": "<pid>", "sha": "<new sha256>", "out": "<outDir>" }` — a confirmation the dispatch loop can log, echoing the shape of `--assemble`'s `{assembled,out,propositions}` line.
- **Chosen:** Validate `--pid` with `ledger.order.includes(pid)` **and** `ledger.entries[pid]` presence (mirroring `--admit`'s "ledger lists X but has no entry" fail-loud), gated first by the file's existing `badBareId` boundary guard.
- **Chosen:** Derive the ledger location as `outDir = values["--out"] || (values["--dir"] ? path.join(dir,"judge") : null)`, identical to `cmdAdmit`; a null `outDir` (neither flag given) is a `usageError`.
- **Chosen:** Edit only the **repo source** `plugin/skills/faff-prep/SKILL.md`; the installed marketplace copy under `~/.claude/...` is regenerated by link-skills, never hand-edited.
- **Assumes:** `casefile.sha256Text` is exported and stable — restamp reuses `casefile.sha256Text` (already required as `const casefile = require("./spec-judge-casefile")`) rather than re-implementing the hash, so the snapshot the roll-up reads is byte-identical in derivation to the one assemble writes. *Validate:* `grep -n "sha256Text" plugin/skills/faff/bin/lib/spec-judge-casefile.js` shows the `function sha256Text` definition (line 396) and its `module.exports`.

## How (shape, not implementation)

**New flag.** Add `"--restamp": { arity: 0 }` to `SPEC_JUDGE_EVIDENCE_SPEC.flags` (alongside `--assemble`/`--admit`, lines 152–154). `--pid` is new vocabulary — add `"--pid": { arity: 1 }`. `--spec`/`--out`/`--dir` already exist.

**Usage string.** Extend `SPEC_JUDGE_EVIDENCE_USAGE` with a fourth `or:` line naming the restamp form.

**Dispatch + mutual exclusion** in `cmdSpecJudgeEvidence`:

```
PROCEDURE cmdSpecJudgeEvidence(args):
  1. parse args; on parse errors -> usageError (exit 2)
  2. count set-flags among {--assemble, --admit, --restamp}
     IF count > 1 -> usageError "…are mutually exclusive" (exit 2)
  3. IF --assemble -> cmdAssemble
     IF --admit    -> cmdAdmit
     IF --restamp  -> cmdRestamp
     ELSE default evidence-bundle mode
```

**The restamp procedure:**

```
PROCEDURE cmdRestamp(values):
  1. pid  := values["--pid"];  IF pid missing        -> usageError (exit 2)
     IF badBareId(pid)                                -> usageError (exit 2)
  2. spec := values["--spec"]; IF spec missing        -> usageError (exit 2)
  3. outDir := values["--out"] || (values["--dir"] ? join(dir,"judge") : null)
     IF outDir null                                   -> usageError (exit 2)
  4. ledger := readJSON(join(outDir,"ledger.json"))
     IF unreadable/malformed                          -> stderr + exit 2 (fail-loud)
     IF no order[] / no entries{}                     -> stderr + exit 2 (fail-loud)
  5. IF NOT ledger.order.includes(pid)
        OR NOT ledger.entries[pid]                    -> stderr + exit 2 (fail-loud)
  6. specText := readFile(spec)
     IF unreadable                                    -> stderr + exit 2
  7. entry := ledger.entries[pid]
     entry.pre_ruling_spec_sha     := casefile.sha256Text(specText)
     entry.pre_ruling_spec_content := specText
  8. writeFileSync(join(outDir,"ledger.json"),
                   JSON.stringify(ledger,null,2)+"\n", {mode:0o600})
     chmodSync(...,0o600)   # best-effort, matching --assemble
  9. print { restamped: pid, sha: entry.pre_ruling_spec_sha, out: outDir }
     return 0
```

**Anti-pattern:** re-writing the whole ledger from a freshly-`assemble`d structure. Why: that would recompute *every* proposition's snapshot and clobber the earlier-restamped ones. Restamp mutates exactly one entry's two fields on the parsed-in-place ledger and writes it back, leaving all sibling entries (and `pid`'s other fields — `lens`, `severity`, `order_seed`, `ruling`, `resolution`, …) untouched.

**Anti-pattern:** failing safe (park / exit 0) on a missing ledger. Why: restamp is only ever called after `--assemble` wrote the ledger and mid-dispatch; an absent ledger there is a broken invariant that must surface loudly, not be swallowed as an expected degrade.

**Sequencing the seam owns (dispatch loop, already in prose).** For each proposition in fixed ledger order (`p-01…p-0N`): re-read spec sections and re-derive `argument_B`; **call `--restamp` to snapshot the spec as it stands now** (after earlier corrections, before this one); dispatch the judge; if `UPHOLD_REVIEW`/`SYNTHESIZE`, apply the correction before the next proposition. The restamp's whole value is that it runs *between* the previous proposition's applied correction and this proposition's judgement, so `correctionApplied` later compares against the right baseline.

**Failure modes.**

- **The failure:** restamp writes the snapshot at the wrong point in the loop (e.g. *after* this proposition's own correction is applied). **How you'd know:** the correction-applied check would see the literal already present in `pre_ruling_spec_content` and report `{applied:false, "already present pre-correction"}`, so a genuinely-applied blocking correction would fail to resolve and the roll-up would park a spec that was actually corrected. **What it means:** the ordering is load-bearing and belongs in the DONE checklist and a test — restamp *before* applying the correction, not after.
- **The failure:** a byte-for-byte preservation regression — the JSON round-trip drops or reorders a sibling field. **How you'd know:** a test that restamps `p-02` and asserts every other entry and every non-`pre_ruling_*` field of `p-02` is unchanged would fail. **What it means:** the mutate-in-place approach is a hard requirement, not a nicety.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an assembled ledger.json with propositions p-01, p-02, p-03 sharing one
      assemble-time pre_ruling snapshot
When  the spec is edited (p-01's correction applied) and
      `spec-judge-evidence --restamp --pid p-02 --spec <edited> --out <judge>` runs
Then  ledger.entries["p-02"].pre_ruling_spec_sha equals sha256 of the edited spec,
      ledger.entries["p-02"].pre_ruling_spec_content equals the edited spec text,
      and entries["p-01"], entries["p-03"], and every other field of entries["p-02"]
      are byte-for-byte unchanged
```

```
Given a --out directory with no ledger.json (or a malformed one)
When  `spec-judge-evidence --restamp --pid p-01 --spec <file> --out <dir>` runs
Then  it exits 2 with a fail-loud stderr message and writes nothing
```

## Done — acceptance criteria

1. `faff spec-judge-evidence --restamp --pid <pid> --spec <file> --out <judge-dir>` rewrites `ledger.entries[<pid>].pre_ruling_spec_sha` to `sha256Text(specText)` and `...pre_ruling_spec_content` to the full spec text, and exits 0 printing `{ "restamped": "<pid>", "sha": "<sha>", "out": "<dir>" }`.
2. Every other proposition entry, and every non-`pre_ruling_*` field of the target entry, is byte-for-byte unchanged after a restamp (asserted by a round-trip test that diffs the full ledger minus the two mutated fields).
3. `--out`/`--dir` resolve the ledger location identically to `--admit` (`--out` wins; else `--dir/judge`; neither → `usageError` exit 2).
4. Fail-loud exit 2 (nothing written) on: missing/malformed `ledger.json`; a ledger with no `order[]`/`entries{}`; a `--pid` absent from `ledger.order` or with no `entries[pid]`; an unreadable `--spec`.
5. `usageError` exit 2 on a missing `--pid`, a `badBareId` `--pid`, or a missing `--spec`.
6. Any two of `--assemble`/`--admit`/`--restamp` supplied together is a `usageError` (exit 2).
7. The restamped ledger is written with the same plain `fs.writeFileSync(..., {mode:0o600})` + best-effort `chmodSync(...,0o600)` as `--assemble` (no atomic temp-swap); the file remains mode `0600`.
8. `plugin/skills/faff-prep/SKILL.md` step 2 replaces the "write them back into `ledger.json`" hand-edit with a `spec-judge-evidence --restamp --pid <pid> --spec <spec-file> --out $scratch/judge` call, called before applying each proposition's correction; the re-read/re-derive-`argument_B` obligation is retained.
9. `docs/guide/cli.md`'s `spec-judge-evidence` row names the third `--restamp` mode; `faff validate-adapters` / lint-cli-doc / lint-cli-coverage all pass.
10. Tests covering criteria 1–7 live under the existing `spec-judge-evidence` subcommand coverage — CLI-level cases in `test/spec-judge-assemble-admit.test.mjs` (spawning real `bin/faff`) and/or unit cases in `test/spec-judge-casefile.test.mjs`; run green via `node --import ./test/hermetic-env.mjs --test test/spec-judge-assemble-admit.test.mjs`.
11. **The restamp-ordering property is asserted by a test, not left to prose review.** A test proves the load-bearing interaction: after applying a correction to the spec, a restamp taken **before** that correction snapshot makes `correctionApplied(entry, ruling, currentSpec)` return `{applied:true}` for the corrected proposition, whereas a restamp taken **after** the correction (the wrong order) makes it return `{applied:false, "already present pre-correction"}` (`spec-judge-casefile.js`:414–415). This closes the seam's own regression surface: a dispatch loop that restamps at the wrong point is caught by the test suite, not only by manual review of criterion 8's prose placement. (Criterion 8 still pins the *prose* call site in `faff-prep/SKILL.md`; this criterion pins the *behavioural* consequence the ordering exists to protect.)

**Integration smoke test (covers criteria 1–7 and 11):**

```
1. assemble a ledger from a fixture residue over a 3-proposition spec
2. edit the spec (simulate p-01's correction: append p-01's verification literal)
3. restamp --pid p-02 --spec <edited>
4. assert entries.p-02.pre_ruling_spec_sha == sha256(edited)
       and entries.p-01 / entries.p-03 unchanged
       and ledger.json mode == 0600
5. ordering assertion (criterion 11): with p-02's own ruling carrying a verification
   literal, apply p-02's correction to the spec, then:
     - restamp p-02 BEFORE that correction, run admit -> correctionApplied p-02 == true
     - restamp p-02 AFTER that correction (wrong order) -> correctionApplied p-02 == false
       (reason "already present pre-correction")
```

## Already shipped against this surface

- **FAFF-930** (Done, PR #797, 407be00b) — shipped the `--assemble`/`--admit` per-proposition modes, the ledger's `pre_ruling_*` fields, and `correctionApplied`. Its DONE item named "`pre_ruling_spec_sha`/`pre_ruling_spec_content` re-read/re-derived/re-captured from the current spec at dispatch time," but delivered that re-stamp only as a faff-prep prose obligation with no CLI backing. This ticket is the bounded follow-up that supplies the seam — the prior art to mirror for mode routing, flag validation, exit-code discipline, and the ledger write, none of which it supersedes.

confidence: high
spec-review: approve
