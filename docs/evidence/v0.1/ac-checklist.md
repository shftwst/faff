# ac-checklist.json

**Purpose.** The per-issue floor artifact recording whether every acceptance criterion in
the spec was auto-verified before merge. This is the artifact governance-check's
`merge_floor` leg re-reads — it never re-runs the AC verification itself.

**Location & lifecycle.** `<run-dir>/<issue>/ac-checklist.json`, written once at
`faff-graft` Step 8 (AC verification), after every AC in the spec has been checked
(auto-verified, or explicitly left unchecked with a "Needs human verification" note).
Not mutated afterward.

**Producer(s).** `faff-graft` Step 8, immediately after AC verification completes.

**Consumer(s).** `faff merge-gate`'s `readAcComplete` (`bin/lib/merge-gate.js`), reused
by governance-check's `merge_floor` leg.

**Schema.** [`schema/ac-checklist.schema.json`](schema/ac-checklist.schema.json).

**Integrity.** No locking or atomicity concerns — a single write, never mutated. The
canonical key is `all_verified`; `readAcComplete` also accepts a legacy `ac_complete`
key, treating it identically. `all_verified: true` means every auto-verifiable AC ticked
— an AC left unchecked with a "Needs human verification" note makes this `false`, not a
partial-credit value.

**Fail direction.** A missing or unreadable `ac-checklist.json` is fail-closed to
not-verified (`missing` ≠ `pass`) at the merge_floor leg — never treated as "no ACs to
verify".

**Example.** [`schema/examples/ac-checklist.example.json`](schema/examples/ac-checklist.example.json),
hand-carried from a real merged issue (`.faff/runs/run-20260724-125424-beepboop-full/FAFF-634/ac-checklist.json`).
