# ADR 0001 — Keep exports on the existing worker

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-11-16
- **Issue:** ADRWORK-1

## Summary

Run account exports on the existing worker process; the committed job streams one account export to disk.

## Rationale

The worker already streams files and one operator runs the first release. Restart/resume is outside this slice and remains unimplemented.

Self-review: The consequences match the supplied implementation evidence; no unverified behaviour is claimed.

confidence: high
