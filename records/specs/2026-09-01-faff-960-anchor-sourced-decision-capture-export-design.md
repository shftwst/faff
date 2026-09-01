# FAFF-960 — Reach external lights-out decision-capture records via anchor-sourced export

> Spec: faffter-dark-nlspec · 2026-09-01 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-960.

## Context

An external L4 lights-out run on a separate rig does capture decision-kernel records: the capture gate `capture.decision_kernel` is committed `"on"` on main (`.faffrc.yaml`), and FAFF-954 wired capture into beep-boop's run gate and dispatched grafts. But those records land in that rig's local `.faff/runs/<run-id>/events.jsonl`, which is gitignored and never returns to any other machine as a live run directory.

`faff decision-capture export` (in `plugin/skills/faff/bin/lib/decision-capture.js`, verb `cmdExportVerb`) reads only live `.faff/runs` on the box it runs on: it calls `collectRunDirs(root, null, true)`, which enumerates `.faff/runs/*`. It never looks at committed anchors or pushed bundles. So the FAFF-826 study (`faff shadow-fidelity`, in `shadow-fidelity.js`) can only ever study runs whose live directories still exist on the exporting machine, which excludes every external rig run.

The records do travel off-box by two routes that export ignores:

- **Committed anchors.** `faff events anchor` (and `anchor-run`) byte-copy the run's `events.jsonl`, decision-capture events included, into `.faff/anchors/<run-id>/<issue>/events.jsonl`. That path is a deliberate gitignore carve-out (`!.faff/anchors/` in `.gitignore`), so anchors land on main through merged PRs. The copy is verbatim (`mintIssueAnchor` in `events.js`: `fs.writeFileSync(path.join(destDir, "events.jsonl"), eventsBuf)`), so the anchored envelope keeps the identical `run_id` and `seq` the live record carried.
- **Pushed bundles.** With `bundle_store: git-remote`, the same evidence is pushed to `refs/faff/bundles/…`.

This ticket makes the committed-anchor route reachable by export, so an external rig's decision records that reached main can be studied.

## Decisions

**Chosen:** scope this ticket to the anchor-sourced export path only, behind a new opt-in `--include-anchors` flag on `faff decision-capture export`. The anchor route is the leanest self-contained first slice. The records are already on main after a PR merges, so no git fetch or ref plumbing is needed. Reading `.faff/anchors/**/events.jsonl` is established (`events.js`, `merge-gate.js`, `run-ledger.js`, `bundle.js` all read that tree), and each anchor `events.jsonl` is read by the existing `readDecisionCaptureRecords(dir)` with no new parser. Redaction reuses the same publish-boundary `redactKnownSecrets` pass the export loop already applies to every record.

**Chosen:** dedup identity is the pair `run_id` + `seq` from the event envelope. That pair is globally unique across all runs (`seq` is per-run monotonic, minted by `appendEventRecord`), it is exactly the key `shadow-fidelity` already joins on (`analyzeCorpus` reads `rec.run_id`, `rec.seq`), and the anchored copy carries the identical pair because the anchor is a byte-copy. A record present in both a live run directory and its committed anchor is therefore one logical record under this key.

**Chosen:** when `--include-anchors` is set, the merged records are de-duplicated by `run_id`+`seq` and then sorted ascending by `run_id`, then by `seq`, before the redaction-and-serialisation step. A total order keyed on the same identity makes the emitted `decision-corpus.jsonl` bytes independent of which source (live directory or anchor) a record arrived from, and independent of directory-walk order, so `manifest.json`'s `corpus_sha256` reproduces across exports of the same logical record set. This satisfies `shadow-fidelity reproduce`, which recomputes the digest and asserts byte-identical corpus-derived output.

**Chosen:** live run directories win the dedup. Records from `collectRunDirs` are gathered first; an anchor record whose `run_id`+`seq` is already present is dropped. The two copies are byte-identical, so the choice is not observable in output; stating it fixes the rule and keeps the behaviour deterministic.

**Chosen:** the default export path (no `--include-anchors`) is left byte-for-byte unchanged. The new dedup-and-sort applies only on the opt-in path. Without the flag, `cmdExportVerb` runs exactly the code it runs today: live directories only, in current order, no sort, no dedup. A plain local beep-boop export is unaffected.

**Chosen:** anchor reading is best-effort and read-only. A missing `.faff/anchors` directory yields no anchor records. An unreadable anchor subdirectory or a malformed `events.jsonl` is skipped with a one-line note to stderr, and export continues. Export never mutates anything and never faults mid-run because of a bad anchor. A genuine failure to write the output directory keeps today's exit-2 behaviour; a bad anchor never causes a non-zero exit.

**Assumes:** the anchored `events.jsonl` decision-capture envelopes carry the same shape as live ones (`run_id`, `seq`, `type: "decision-capture"`, `data`), because the anchor is a verbatim byte-copy of the live file. Verified against `mintIssueAnchor` in `events.js`.

**Assumes:** anchor decision-capture records were already redacted at capture time (`appendEventRecord` applies FAFF-107 known-secret redaction on every durable write). The publish-boundary re-redaction in export is belt-and-braces, matching how live records are already handled; it is not the only redaction an anchor record has seen.

**Assumes:** the run-close anchor layout can copy the same run-level `events.jsonl` under more than one per-issue subdirectory of a single run (noted in `bundle-recover.js`, `firstNestedEventsKey`: "a run-close anchor always copies the SAME run-level events.jsonl"). The `run_id`+`seq` dedup collapses those sibling copies to one record each, so this needs no special-casing.

**Punt:** the bundle-sourced path (reading `refs/faff/bundles`) and the on-rig export-and-commit-at-run-close step are left out of this ticket. See scope-out and open questions.

## Design

### Flow

```
faff decision-capture export --out DIR [--include-anchors]

  1. live records   := readDecisionCaptureRecords(dir)  for dir in collectRunDirs(root,null,true)
                        (unchanged; this is the whole default path)

  if --include-anchors:
  2. anchor records := readDecisionCaptureRecords(d)     for d in anchor issue-dirs under .faff/anchors
                        (best-effort; a bad anchor is skipped with a stderr note)
  3. merged         := dedupeAndOrder(live ++ anchor)    dedup by run_id+seq (live wins),
                        then sort ascending by run_id, then seq
  else:
  3'. merged        := live                               (today's exact ordering, no dedup, no sort)

  4. corpus         := merged.map(rec => redactKnownSecrets(rec, resolveKnownSecretValues(root)))
                        (one existing publish-boundary redaction pass, all records)
  5. write DIR/decision-corpus.jsonl + DIR/manifest.json (corpus_sha256 via integrity-digest sha256)
```

Steps 1 and 5 are today's code. Redaction is currently *fused* into the collection loop (each record is redacted as it is gathered — `records.push(redactKnownSecrets(rec, …))`); this change **lifts** it into a single post-merge pass (step 4) applied to the `merged` list, so redaction runs identically whether records came from live dirs or anchors. The default path yields the identical redacted record set as today — same records, same redaction, same order; the lift changes *where* redaction runs, never *whether* or *what* it redacts. The flag adds steps 2 and 3 (anchor collection + dedup/order) ahead of that post-merge redaction-and-write tail.

### Interfaces touched

All in `plugin/skills/faff/bin/lib/decision-capture.js`:

- **`cmdExportVerb(values, root)`** — reads a new `values["--include-anchors"]`. When unset, the collected record set and its order are exactly today's (live dirs only). When set, appends anchor records, then runs the merged list through `dedupeAndOrder`. Redaction is lifted from the per-record collection loop into one post-merge `redactKnownSecrets` map over the final record list (identical on both paths); the `mkdirSync`, the corpus/manifest write, the `sha256` digest, and the exit codes are untouched.
- **`DECISION_CAPTURE_SPEC.flags`** — add `"--include-anchors": { arity: 0 }`.
- **`DECISION_CAPTURE_USAGE`** — extend the `export` usage string to `export --out DIR [--include-anchors]`.
- **New `collectAnchorRecordDirs(root)`** — returns the sorted list of issue-level directories under `.faff/anchors` that contain an `events.jsonl` (recursive walk for `**/events.jsonl`, mirroring `bundle-recover.js`'s `endsWith("/events.jsonl")` seam). Missing `.faff/anchors` returns `[]`. An unreadable subdirectory is skipped with a stderr note. This is the only new I/O; record parsing reuses the existing `readDecisionCaptureRecords(dir)`, which already tolerates torn or malformed lines.
- **New pure `dedupeAndOrder(records)`** — dedup by `` `${run_id}${seq}` `` keeping first occurrence, then a stable sort ascending by `run_id` (string compare) then `seq` (numeric). A record missing `run_id` or a non-integer `seq` is kept but ordered after well-formed records by a deterministic fallback (empty-string `run_id`, `seq` treated as `-1`, and any remaining ties broken by the record's serialised bytes — never by original index, so the order is invariant to which source a record arrived from), so a stray record can never make the output non-deterministic or source-mix-dependent. This is the one piece worth unit-testing directly in `decisionCaptureSelftest`.

Documentation: update the `decision-capture` row in `docs/guide/cli.md` to describe `--include-anchors` (opt-in; folds committed `.faff/anchors/**/events.jsonl` decision-capture records into the exported corpus, de-duplicated by `run_id`+`seq`, deterministically ordered, re-redacted at the publish boundary).

Not touched: `shadow-fidelity.js` needs no change. It already consumes `decision-corpus.jsonl` and `manifest.json` and joins cost by `run_id`. An anchor-sourced corpus is a normal corpus to it. For an external run whose live directory is absent on the exporting box, the cost join degrades to null by the study's own best-effort rule (`joinCost` note: "absence isn't a fault"); the corpus-derived analysis still produces a non-null result.

### Deterministic-ordering and dedup rule (stated once)

- **Identity:** `run_id` + `seq` from the event envelope.
- **Dedup:** first occurrence wins; live directories are gathered before anchors, so a live record is kept over its byte-identical anchor copy.
- **Order (opt-in path only):** ascending by `run_id`, then ascending by `seq`.
- **Default path:** no dedup, no sort, live directories only, in `collectRunDirs` order. Byte-identical to today.

## Scope out

- **Bundle-sourced export (`refs/faff/bundles`).** `bundle-recover.js` already resolves `refs/faff/bundles/*/seg-*/<ISSUE>` and extracts an anchor's `events.jsonl` from a bundle's file map, so this is a real follow-up seam, but it needs a git fetch of the bundle refs and is heavier than reading files already on disk. Left to a follow-up. The dedup identity (`run_id`+`seq`) and the `dedupeAndOrder` helper this ticket adds are the same ones a bundle path would reuse, so this slice does not paint that path into a corner.
- **On-rig export-and-commit at run close.** Wiring a "export the corpus and commit it" step into the lights-out run-close is a different lane (run-close orchestration, not the export reader) and is not needed to reach the records: the anchors already carry them to main. Left to a follow-up.

## Open questions

- Should a later ticket add bundle-sourced records under a second flag (for example `--include-bundles`), reusing `bundle-recover.js`'s ref resolution and the same `dedupeAndOrder` merge? This ticket leaves the door open but does not decide it.
- Should the on-rig run-close commit the corpus directly, or is anchor-sourced export from main sufficient in practice? Deferred until there is a real external-rig run to measure against.

## Acceptance criteria

1. **Anchor records reach the corpus, re-redacted.** With `--include-anchors`, a decision-capture record that exists only in a committed anchor (`.faff/anchors/<run>/<issue>/events.jsonl`), with no matching live run directory, appears in `decision-corpus.jsonl`, and it has passed through the same `redactKnownSecrets(rec, resolveKnownSecretValues(root))` publish-boundary pass export applies to live records.
2. **Dedup by run_id+seq.** A record present in both a live run directory and its committed anchor appears exactly once in the corpus, keyed on `run_id`+`seq`. The `record_count` in `manifest.json` counts it once.
3. **Deterministic, reproducible corpus.** Two `--include-anchors` exports of the same logical record set produce byte-identical `decision-corpus.jsonl` and therefore the same `corpus_sha256`, regardless of the source mix (live vs anchor) each record came from. `faff shadow-fidelity reproduce` over such a corpus passes its digest assertion.
4. **Default path unchanged.** Running `faff decision-capture export --out DIR` without `--include-anchors` produces a byte-identical `decision-corpus.jsonl` — and therefore the same `corpus_sha256` and `record_count` — to the current implementation, for the same live `.faff/runs` state. `manifest.json` matches modulo its `generated_at` field (which is `new Date().toISOString()` and is never byte-identical across runs, on either the old or new code); assert on `corpus_sha256` + `record_count`, not raw manifest bytes.
5. **Bad anchor degrades, never faults.** A missing `.faff/anchors` directory, an unreadable anchor subdirectory, or a malformed anchor `events.jsonl` is skipped with a note to stderr; the export completes and its exit code is unaffected by the bad anchor.
6. **End-to-end study.** An anchor-sourced corpus exported with `--include-anchors` runs through `faff shadow-fidelity run --corpus … --manifest …` to a non-null result (a populated coverage/divergence matrix), including for a run whose live directory is absent on the exporting box.

## Done

- [ ] `--include-anchors` flag added to `DECISION_CAPTURE_SPEC.flags` and the `export` usage string.
- [ ] `cmdExportVerb` folds anchor-sourced records in only when the flag is set; the default path is untouched.
- [ ] `collectAnchorRecordDirs(root)` walks `.faff/anchors/**/events.jsonl`, returns issue-level dirs sorted, best-effort on read faults, reuses `readDecisionCaptureRecords`.
- [ ] `dedupeAndOrder(records)` de-duplicates by `run_id`+`seq` (live wins) and sorts ascending by `run_id` then `seq`; pure, deterministic on malformed records.
- [ ] Anchor records flow through the existing single `redactKnownSecrets` publish-boundary loop, never emitted raw.
- [ ] `docs/guide/cli.md` decision-capture row documents `--include-anchors`.
- [ ] `decisionCaptureSelftest` covers `dedupeAndOrder` dedup and ordering, and asserts the default-path record list is unchanged when the flag is absent.
- [ ] Acceptance criteria 1 to 6 exercised (unit for the pure helper; a fixture-based export-then-shadow-fidelity check for the end-to-end and reproducibility criteria).

## Scenarios

**External-only run reaches the study.** Given a committed anchor at `.faff/anchors/run-EXT/FAFF-x/events.jsonl` holding a `type="decision-capture"` record, and no live `.faff/runs/run-EXT`, when `faff decision-capture export --out DIR --include-anchors` runs, then `DIR/decision-corpus.jsonl` contains that record, redacted, and `faff shadow-fidelity run --corpus DIR/decision-corpus.jsonl --manifest DIR/manifest.json` returns a non-null result.

**Live and anchor copy collapse to one.** Given a run present both as a live directory and as its committed anchor, both carrying the same decision-capture record (same `run_id`+`seq`), when export runs with `--include-anchors`, then that record appears once in the corpus and `manifest.json` `record_count` counts it once.

**Reproducible digest.** Given a fixed set of live directories and anchors, when export runs twice with `--include-anchors`, then both runs write byte-identical `decision-corpus.jsonl` and report the same `corpus_sha256`, and `faff shadow-fidelity reproduce --dir REPORTDIR` over a report built from it passes.

**Default path untouched.** Given any live `.faff/runs` state, when export runs without `--include-anchors`, then `decision-corpus.jsonl` is byte-identical to the pre-change implementation (same `corpus_sha256` and `record_count`), and `manifest.json` is identical modulo its `generated_at` timestamp.

**Malformed anchor is skipped.** Given a committed anchor whose `events.jsonl` is truncated or non-JSON, when export runs with `--include-anchors`, then the bad anchor's parseable records (if any) are included and the rest skipped, a note is written to stderr, and the command exits with the same code it would have without the bad anchor.

**No anchors present.** Given no `.faff/anchors` directory, when export runs with `--include-anchors`, then the command behaves as the default path for the live directories and writes a well-formed corpus (empty if there are no live records), with no error.

confidence: high
spec-review: approve
build-tier: standard

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"},{"marker":"assumes"},{"marker":"punt"}]}
```
