# ADR 0084 — The events.jsonl chain rule: prev hashes the previous physical line's raw bytes, genesis is the run_id hash, one schema bump to 2

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-07-22
- **Issue:** FAFF-564

## Context

`events.jsonl` is append-only by convention only: any process with filesystem access can edit or truncate it undetectably after the fact. The 2026-07 governance landscape report names a tamper-evident audit trail as the one governance property nobody has shipped; the digest bracket (FAFF-518/520) defends a dispatch window, not post-hoc falsification of the whole record. The committed RFC (`docs/rfc/rfc-governance-tamper-evidence.md`) settles on a per-line prev-hash chain, but the chain needs one exact, foreign-implementable rule for what each link commits to. Candidate rules pull in different directions: canonicalised JSON requires a canonical-form spec every emitter must reimplement; hashing only *parseable* records (the seq-mint rule) lets malformed lines float outside the chain, so garbage could be inserted or removed between links undetected. Separately, `prev` is a required envelope field a reader must know to expect, so it is a schema fact — and the RFC's five-step sequencing exists precisely so the schema bumps once, not once for `prev` and again for the ledger fold.

## Decision

Every schema-2 record carries `prev`: 64 lowercase hex, the SHA-256 of the **previous physical line's raw bytes**, exclusive of its terminating newline. The genesis record's `prev` is the SHA-256 of the UTF-8 bytes of the record's own `run_id`. The chain is over physical lines, not parseable records — a link's `prev` hashes whatever line precedes it: a well-formed record, a torn partial segment, or a legacy schema-1 line. No canonicalisation anywhere in the write path. The schema bumps to 2 exactly once, covering both `prev` and the `ledger-write` fold (the sibling decision on ledger mutations joining the chain) in the same change; `eventViolations` accepts schema 1 or 2 per-record — schema 2 requires well-formed `prev`, schema 1 forbids it. The hash is computed only inside the lock-serialised append core (the decision that events.jsonl appends are serialised by an advisory lock file), extending its existing tail-read: `mintRecord` gains a `prevHash` argument, no second read, no new lock.

## Consequences

- Editing or reordering any mid-log line breaks the hash of every following line — detectable by any verifier that re-hashes the file with no key material and no canonical-JSON spec. Tail truncation alone stays undetectable until the chain head is anchored (FAFF-568); this change claims mid-log edit/reorder detection only.
- The rule is load-bearing and effectively frozen: FAFF-568's verifier, the governance-check integrity leg, and any Layer A schema publication re-implement exactly this rule from the schema alone. Changing it later invalidates every chained log.
- Raw-byte commitment makes any reformatting of existing lines — an editor, a git filter, a "helpful" re-serialisation — indistinguishable from tampering. Write-path code must never rewrite existing bytes; FAFF-574's torn-line repair (prefix a newline, never touch landed bytes) composes with this by construction.
- Mixed-schema logs are legal at the write side: the first schema-2 record hashes the preceding schema-1 line like any other link, so a run in flight at deploy time stays valid and the chain is verifiable from that record forward. Reporting policy for partial chains belongs to FAFF-568.
- The seq mint (last *parseable* record) and the chain hash (last *physical* line) deliberately read different things from the same locked tail window; they must not be conflated when either rule is next touched.
- Rejected alternatives: canonicalised-JSON hashing (needs a canonical-form spec, RFC-rejected); chaining only parseable records (malformed lines escape the chain); per-feature schema bumps (the double bump the RFC's sequencing exists to prevent).
