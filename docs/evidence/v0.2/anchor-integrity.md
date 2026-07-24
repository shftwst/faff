# chain-head.json + the anchor/verify surface (FAFF-568)

**Purpose.** Documents two things FAFF-568 added on top of v0.1's construction-only
hash chain: the `chain-head.json` witness artifact, and the `faff events verify` /
`faff events anchor` verbs that produce and consume it.

**Location & lifecycle.**
- `chain-head.json` — path `.faff/anchors/<run-id>/<issue>/chain-head.json`; written once
  by `faff events anchor` (never hand-edited). The anchor dir it lives in is
  intended-immutable — a later `verify` re-derives and cross-checks against it; mutating
  it defeats its purpose.
- The **anchor dir** itself (`.faff/anchors/<run-id>/<issue>/`) — a byte-copy of
  `events.jsonl` + `run-ledger.json` from the source run dir, plus the witness.
  Committed (not gitignored, unlike live run dirs) — the calling convention for *when*
  a PR anchors is FAFF-623's, out of scope here (this page documents the artifact and
  verbs, not the authorship policy).

**Producer(s).** `faff events anchor --run-dir <dir> --issue <issue> --dest
<anchor-dir>` (`events.js` `cmdEvents`, the `anchor` branch) — computes `chain-head.json`
via `computeChainHead`, byte-copies `events.jsonl`, copies `run-ledger.json` if present.
The head hash is **always CLI-computed from the copied bytes, never caller-supplied** —
this is the property that makes the witness trustworthy as a cross-check rather than
decorative.

**Consumer(s).** `faff events verify --run-dir <dir>` (any dir, run or anchor) and
governance-check's `integrity` leg (`evaluateIntegrityLeg`, called by both
`evaluateRunDir` for live run dirs and `evaluateAnchorDir` for anchor dirs, the latter
with `requireWitness: true`).

**Schema.** [`schema/chain-head.schema.json`](schema/chain-head.schema.json).

**Integrity — the classification vocabulary (transcribed verbatim from `verifyChain`'s
own status strings and the comment block in `events.js`, not paraphrased):**

| Status | Meaning |
|---|---|
| `verified` | The chain hashes clean from genesis (or from genesis to a torn tail, witness-corroborated when a witness is present). |
| `legacy-unverifiable` | No record in the file carries `prev` at all — an honest schema-1 log, no chain to verify. |
| `mixed` | Both `prev`-carrying and `prev`-less records coexist — the chained records verify, but the `prev`-less lines' contents are unverifiable (only their raw bytes fed the next link). |
| `broken` | A `prev`/ledger mismatch among schema-2 records — the tamper signature. |
| `witness-mismatch` | A `chain-head.json` witness is present and disagrees with the re-derived log (`head_sha256`/`line_count`/`schema_floor`) — a post-anchor rewrite, including the schema-downgrade spoof and the forged-torn-tail edit. |
| `witness-absent` | (Anchor evaluation only, `requireWitness: true`) — the dir carries `events.jsonl` but no `chain-head.json`; since `faff events anchor` always writes the witness, absence means post-anchor deletion or a broken writer. |
| `malformed` | The committed anchor (or its witness) is unreadable/corrupt. |

**Fail direction.** `broken` and `witness-mismatch` are **always** gating FAILs,
regardless of `--legacy-policy` — never softened. `legacy-unverifiable` / `mixed` FAIL
only under `--legacy-policy fail`; pass (with a `[warn]`-tagged detail) otherwise.
`witness-absent` is gating **only** when the dir is evaluated as an anchor
(`requireWitness`) — a live run dir mid-build has no witness by design and is
unaffected. Absent `events.jsonl` entirely → `verified` (nothing to break, a clean
no-op).

**Edge cases:**

- A witness's `head_seq`/`schema_floor` can be `null` (an anchor taken over an
  `events.jsonl` with zero parseable records — all-torn) while `head_sha256` is
  non-null (the torn bytes still hash). This is a valid, if unusual, combination — not
  an inconsistency.
- `run_id` inside `chain-head.json` is the **source run dir's basename**, not the anchor
  dir's basename (which is the issue id) — this is why `verifyChain`'s genesis hash uses
  the record's own `run_id` field, not `path.basename(dir)`: an anchor relocated under
  `.faff/anchors/<run>/<issue>/` must still verify.

**Example.** [`schema/examples/chain-head.example.json`](schema/examples/chain-head.example.json),
hand-carried from a real committed anchor
(`.faff/anchors/run-20260724-125424-beepboop-full/FAFF-634/chain-head.json`).
