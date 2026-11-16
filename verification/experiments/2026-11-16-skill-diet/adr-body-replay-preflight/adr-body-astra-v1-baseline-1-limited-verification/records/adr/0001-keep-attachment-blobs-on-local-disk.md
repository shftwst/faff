# ADR 0001 — Keep attachment blobs on local disk

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-11-16
- **Issue:** ADRWORK-1

## Context

One host has an existing durable data volume; remote replication is outside this release.

## Decision

Store attachment blobs in the existing local data directory.

## Consequences

The local write/read test passes. Disk-loss recovery and backup restore remain unverified; later work must not assume replication.

Self-review: The consequences match the supplied implementation evidence; no unverified behaviour is claimed.

confidence: high
