# Carry every spec-review round as a digest-checked comment (FAFF-1267)

> Spec: faffter-dark-nlspec, 2026-10-14. Slice 2c of the FAFF-1257 split under FAFF-1255. The full spec, with its methodology critique and spec-review record, is attached to FAFF-1267 on the tracker; this file is the build-time copy.

This spec is for the build agent picking up FAFF-1267 and its reviewers. It narrows the reviewed FAFF-1257 spec to the spec-review evidence path: collating every prep spec-review round, rendering the `## Spec-review evidence` comment in the CLI with a sha256 digest, and writing the v0.3 `spec-review-verdict.json` from that comment at graft Step 9b. It folds in the three round-1 minors listed on the ticket.

## 1. WHY

The anchor byte-copies whatever `spec-review-verdict.json` holds, and that file is built from a tracker comment an agent posts. So the comment has to be produced by code from the round files, carry every objection from every round, and be verifiable when graft reads it back. This slice makes the CLI read every `round-<n>.json` prep recorded, keep each objection as its own item, render the whole comment body (summary lines, fenced block, digest), and makes graft's writer refuse any block whose digest no longer matches.

Today `faff spec-review select-evidence` keeps only the highest-numbered objection-bearing round, and the agent assembles the comment by hand. On FAFF-1198, 25 objections were raised across rounds and 6 were anchored. After this slice every objection prep's loop recorded reaches the anchor with its round, its text and its disposition, and an edited or summarised block is detected and not anchored.

### Design principles

- **No objection is ever dropped or merged.** Every objection in every valid round file becomes exactly one item, with its own text and disposition.
- **Code writes the bytes.** The agent pipes CLI output to the tracker unchanged.
- **Governance code never requires factory code.** The writer and the collator live in `region:governance`; the factory `spec-review` verb requires them, never the reverse.
- **Evidence stays best-effort.** Nothing here blocks prep promotion, a build or a merge. Enforcement is FAFF-1261.

## 2. OUT OF SCOPE

- Code-review rounds, `review-verdict.json`, `ac-checklist.json` writers, `record-review-round`, `--terminal-only`, graft Steps 8 and 9 (FAFF-1268). Extension point: the shared writer core in `evidence.js` and `evidence-collate.js`.
- Reviewer contract fields, `findingId`, the title-stability eval (FAFF-1266).
- The review-verdict normaliser (`computeReviewVerdict`).
- Re-carrying evidence for issues prepped before this slice.
- Mint warnings, mint refusal, governance-check evidence leg (FAFF-1263, FAFF-1261).
- Signing the carried comment. The digest detects edits and summaries, not forgery.

## 3. WHAT

| Term | Meaning |
|---|---|
| Round file | `<scratch>/round-<n>.json`, one prep spec-review round's `{verdict, objections}`, unchanged by this slice |
| Objection key | `"<n>#<i>"`: round number and 0-based index in its round file |
| Collated record | The whole-loop list of objections the collator returns |
| Carried comment | The `## Spec-review evidence` tracker comment prep posts and graft reads |

### Departures from FAFF-1257

1. No merging of spec-review objections: every objection is its own item with `first_round = last_round = n` and one occurrence.
2. Dispositions are keyed by objection key, not list position.
3. Redaction happens before rendering, because the digest forbids changing the bytes afterwards.
4. The enums move to a governance home.
5. The digest covers the block's single JSON line without its line terminator, so `\r\n` conversion does not break it.

### Module layout

- `bin/lib/review-vocab.js` (new, `region:governance`, no local requires): `SPEC_REVIEW_VERDICTS`, `SPEC_REVIEW_LENSES`, `SPEC_REVIEW_SEVERITIES`, `REVIEW_DISPOSITIONS`, moved verbatim from `contract-defs.js`, which re-exports them under the same names. `spec-review-churn.js` drops its own lens list.
- `bin/lib/evidence-collate.js` (new if FAFF-1268 has not created it, `region:governance`): `collateSpecReviewRounds`, `applyDispositions`, `renderSpecReviewComment`, `parseSpecReviewComment`, and `extractSpecReviewEvidence` moved from `spec-review.js`, which re-exports it.
- `bin/lib/evidence.js`: gains `faff evidence write spec-review-verdict` and the shared writer core (`guardWriterPaths`, `writeEvidenceFile`) if FAFF-1268 has not added it.

### Collated record

```
RECORD CollatedSpecReview:
  verdict: String        # verdict of the highest-n round with non-empty objections; "approve" if none
  final_verdict: String  # verdict of the highest-n valid round; "approve" if no valid round
  rounds_total: Integer  # number of valid round files
  objections: List<CollatedObjection>   # round ascending, then index ascending
RECORD CollatedObjection:
  key: String            # "<n>#<i>"; present in plain output, never in the rendered block
  lens, severity: String
  claim, evidence, predicted_consequence, spec_anchor: String | absent
  disposition: "fixed" | "refuted" | "accepted-risk" | "open" | absent
  refutation, disposition_rationale: String | absent
  first_round = last_round = n: Integer
  occurrences: [ { round: n, severity, claim?, spec_anchor? } ]   # exactly one
```

Absent fields are omitted (not null) in the rendered block and plain JSON. Only the anchored file null-fills.

### Dispositions file

A JSON array of `{ key, lens, disposition, disposition_rationale?, refutation? }`. Every collated key appears exactly once; no unknown key; lens matches the keyed objection. Without `--dispositions`, every objection renders `unsettled` and carries no `disposition`.

### CLI surfaces

| Command | Reads | Writes |
|---|---|---|
| `faff spec-review collate-evidence --dir S [--dispositions F]` | every `S/round-<n>.json`, plus dispositions | stdout: collated record as JSON, with `key` on each objection |
| `faff spec-review collate-evidence --dir S --dispositions F --comment` | the same | stdout: the whole comment body |
| `faff evidence write spec-review-verdict --run-dir D --issue I` | stdin: text holding a `## Spec-review evidence` section | `D/I/spec-review-verdict.json` |
| `faff spec-review extract-evidence` | unchanged | unchanged |

`faff spec-review select-evidence` and `selectEvidenceVerdict` are removed.

Exit codes. `collate-evidence`: 0 printed; 1 dispositions file invalid; 2 usage, unreadable `--dir`, or a redaction config fault. `write spec-review-verdict`: 0 written; 1 input refused (no section, no fence, missing or mismatched digest, pre-collation block, validation failure), nothing written; 2 usage, path-guard or IO fault, or a redaction config fault, nothing written. Messages name the rule and key path, never a field value.

### Comment format

```
## Spec-review evidence

<R> rounds, <N> objections (round 1: <a>, round 2: <b>, ...)

- [round <n>] <lens> <severity> (<spec_anchor, or "no anchor">): <disposition, or "unsettled">

```faff-contract:spec-review-verdict
<{verdict, final_verdict, rounds_total, objections} as one line of compact JSON, key fields stripped>
```
sha256: <lowercase hex SHA-256 of that JSON line's UTF-8 bytes, without its line terminator>
```

### Normaliser change

`computeSpecReviewVerdict` and `contracts/spec-review-verdict.schema.json`:

- A `null` optional field is treated as absent: no violation, omitted from output.
- Per objection, pass through `first_round`, `last_round` (integers) and `occurrences` (array of objects); at top level pass through `rounds_total` (integer), `final_verdict` (in `SPEC_REVIEW_VERDICTS`) and `schema_version` (integer).
- The schema types each pass-through field, so a mistyped value fails `schemaCheck`.
- The founded-verdict invariant, the `round_recorded` rule and the `{lens, severity}` checks are unchanged.

## 4. HOW

Build order: review-vocab and re-exports; evidence-collate with tests; the `collate-evidence` verb and `select-evidence` removal; the writer and shared core; normaliser and schema; SKILL edits and `docs/guide/cli.md` rows.

### Collation

```
PROCEDURE collateSpecReviewRounds(dir):
  1. List names matching ^round-(\d+)\.json$; sort by n ascending. Never use window_start.
  2. Parse each; skip it (name it on stderr) unless conformant: verdict in SPEC_REVIEW_VERDICTS,
     objections an array, every lens and severity in the enums, approve exactly when objections is empty
  3. secrets = resolveKnownSecretValues() (config fault -> exit 2); redact every string leaf of every valid round
  4. For each valid round n, each objection o at index i: item = the documented string fields of o
     + key, first_round n, last_round n, occurrences [{round n, severity, claim?, spec_anchor?}]
  5. verdict / final_verdict / rounds_total as in the record
```

The collator never renames or rewrites a round file.

### Rendering

Parse and redact the dispositions file; check full coverage, unknown keys, duplicates, lens match, enum (exit 1); fold each entry into its objection; block = `JSON.stringify({verdict, final_verdict, rounds_total, objections without key})`; digest = sha256 of its UTF-8 bytes; print the comment format.

### Writer

```
PROCEDURE write_spec_review_verdict(runDir, issue, stdin):
  1. guardWriterPaths(runDir, issue)   # exit 2 on failure, before any read
  2. Locate the "## Spec-review evidence" section as extractSpecReviewEvidence does; none -> exit 1
  3. A fence body of more than one line -> exit 1 "pre-collation evidence block"
  4. First line after the closing fence matching ^sha256: ([0-9a-f]{64})\s*$; missing -> exit 1.
     Recompute sha256 over the body line without terminator; mismatch -> exit 1
  5. Parse the body; no rounds_total, or any objection without first_round, last_round and occurrences -> exit 1
  6. Redact every string leaf (config fault -> exit 2)
  7. Build the v1 shape: schema_version 1, every documented key present, null when absent, unknown keys dropped
  8. Validate against the bundled v0.3 spec-review-verdict-anchored schema, then writer-only checks -> exit 1
  9. writeEvidenceFile: schema key order, two-space indent, trailing newline, temp file then rename
```

Writer-only checks: founded verdict (`approve` exactly when objections is empty); lens and severity in the review-vocab enums; disposition in `REVIEW_DISPOSITIONS` or null; `1 <= first_round <= last_round <= rounds_total` and every occurrence round in range.

Path guards: `--issue` matches `^[A-Za-z0-9][A-Za-z0-9._-]*$` with no `..`; the realpath of `--run-dir` lies inside `<root>/.faff/runs/` for `root` = `findRoot()` or `mainWorktreeRoot` of the working directory; the output path lies inside `<run-dir>/<issue>/`.

### Prep terminal seam and graft Step 9b

Rewrite the prep "Persist + carry the spec-review evidence" paragraph in place (at most 200 words, line-neutral): collate, build dispositions mechanically (never synthesising rationale), render with `--comment`, post byte for byte (git-only: append to the spec), log and continue on any non-zero exit. Rewrite graft Step 9b's "Materialise the spec-review evidence floor file" paragraph in place: locate the newest `## Spec-review evidence` comment, else the committed spec; pipe to `faff evidence write spec-review-verdict`; any non-zero exit is logged and the PR still opens.

### Edge cases

- Clean first-round approve: nothing carried.
- Approve after objections, or judge accept: `verdict` is the last objection-bearing round's verdict, `final_verdict` is `approve`.
- Malformed round file: skipped, named on stderr; `rounds_total` counts valid rounds only.
- Two objections on one heading in one round: two items.
- Pre-collation comment: the writer exits 1; graft logs it.
- Several evidence comments: graft reads the newest.
- `\r\n` line endings: the parser splits on `\r?\n`; the digest covers the line without its terminator.

## Scenarios

- Rounds 1 to 3 (two objections, then a re-raise plus one, then approve) with every key fixed yield verdict `revise`, final_verdict `approve`, rounds_total 3, four objections keyed 1#0, 1#1, 2#0, 2#1 each with its own evidence text; `faff contract spec-review-verdict` exits 0; round files are byte-identical.
- Two methodology objections on one heading in round 1 keep their two distinct dispositions.
- A dispositions file built before round 3's file was written exits 1 naming the uncovered key 3#0 and prints nothing.
- A configured known secret in a round objection's evidence and a disposition rationale is `[REDACTED]` in the comment, its digest input and the anchored file; the writer exits 0.
- A block with one objection removed after rendering fails with a digest mismatch, writes nothing.
- A git-only spec with the comment appended under its last heading is parsed by the writer (exit 0).
- A round file with lens `security` is skipped and named on stderr; the rest collate and pass the contract and the writer.
- No output contains a configured known secret present in its input; the collated objection count equals the sum over valid rounds.

## 5. DONE

Run each test with `node --test <file>` from the repo root.

- After a prep loop with two objection-bearing rounds and a build, `faff evidence validate --json` over the minted anchor reports `spec-review-verdict.json` ok, with `objections` equal to the total across both round files.
- `review-vocab.js` and `evidence-collate.js` are `region:governance`; `contract-defs.js` re-exports the four enums; `spec-review-churn.js` has no local lens list; `faff regions check` passes; existing extract-evidence selftests pass unchanged.
- The plain collate output carries `key`; the rendered block does not.
- `collate-evidence --comment` output passes `faff contract spec-review-verdict` and the writer; exits 1 for an uncovered, unknown or duplicate key, a lens mismatch and an out-of-enum disposition.
- The `sha256:` line equals SHA-256 of the block's JSON line; `\r\n` still verifies.
- `computeSpecReviewVerdict` reports no violation for null optionals and passes through the new fields; a mistyped pass-through fails the schema check; golden cases pass.
- `select-evidence` is gone from code, usage and the prep SKILL; `docs/guide/cli.md` has the two new rows; `test/spec-review-additive-invariant.test.mjs` passes unchanged.
- The writer exits 1 and writes nothing on a missing section, a missing digest line, an edited block, a pre-collation block and a founded-verdict violation; exits 2 and writes nothing for `--issue ../x`, an `--issue` with `/`, and a `--run-dir` outside `.faff/runs/` (including via a symlink), and accepts a run dir in the main checkout from a linked worktree.
- The writer is byte-deterministic. A malformed redaction config exits 2 from both verbs with nothing printed or written.
- Neither SKILL exceeds its line baseline, rewritten paragraphs are at most 200 words, and `faff validate-adapters` passes.
