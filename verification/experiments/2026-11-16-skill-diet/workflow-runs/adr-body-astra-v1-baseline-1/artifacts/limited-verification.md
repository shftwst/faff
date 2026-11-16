## Context

The deployment has one host and a durable data volume. Remote replication is excluded from this release. This records ADRWORK-1, Keep attachment blobs on local disk.

## Decision

Store attachment blobs in the existing local data directory. The single-host deployment and existing durable volume support this choice without adding remote replication.

## Consequences

- Blob storage depends on the host's data volume and configured local directory.
- The implementation writes blobs to that directory, and a write/read test passes.
- Remote replication remains outside this release.
- Disk-loss recovery and backup restore have not been tested. The passing write/read test does not establish either recovery capability.

---

Self-review: The consequences describe the implemented local write/read path and preserve the release's replication exclusion. Recovery claims are withheld because disk-loss recovery and backup restore remain untested.

confidence: medium

Confidence is advisory: the local storage path is supported by evidence, but recovery behaviour has not been verified.