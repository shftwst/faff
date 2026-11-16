## Summary

Run account exports on the existing worker process. The implemented worker job streams one account export to disk. This records ADRWORK-1, Keep exports on the existing worker.

## Rationale

The existing worker already streams files, and the first release has one operator. Reusing that worker keeps exports within the existing process.

Restart/resume is not implemented and is explicitly outside this slice. Later work must not assume that an interrupted export can resume.

---

Self-review: The body matches the supplied streaming implementation and states the restart/resume exclusion. Only Summary and Rationale are used, in the supplied order. The resolved format has no Decision heading, so L3 contradiction detection is disabled for this repository.

confidence: high