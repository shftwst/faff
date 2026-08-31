# L4 lights-out whole-loop proof, P1 link-shortener (FAFF-499) — retrospective backup

Status: RETROSPECTIVE BACKUP, not a published result. Do not cite as a positive proof and do not add to the results index in the parent README.

This case preserves the evidence from the 2026-08-29 L4 lights-out run (`run-20260829-100405-lights-out`) that delivered the P1 link-shortener end to end. Because the run executed before any hypothesis was registered, it does not meet the protocol's freeze-before-execute principle, so its honest main result is `inconclusive` (all criteria pass, but evidence is incomplete and registration is retrospective).

A fresh, frozen run will supersede this. That run registers and freezes the FAFF-499 acceptance criteria first, then executes against the pinned SUT, and is published as the citable `supports-hypothesis` case. This backup exists so that evidence is not lost if the fresh run is delayed, and so the fresh run has a worked template to build from.

Contents:

- `report.md`: the v0.1 report scaffold, filled from real run data, with MISSING tokens marking outstanding fields.
- `GAPS.md`: what is durable, what was deliberately excluded, and everything still missing to publish (the biggest being a durably-reachable SUT repo at commit `0e3b7be…`).
- `evidence/`: the curated, load-bearing artifacts (run ledger, timeline, plot log, roadmap, PRDR, holdout verdicts, merge records, the self-directed negative, and the live check captures).

The assertion harness these criteria are checked with lives at `../../assert-p1-top-of-loop.sh`.
