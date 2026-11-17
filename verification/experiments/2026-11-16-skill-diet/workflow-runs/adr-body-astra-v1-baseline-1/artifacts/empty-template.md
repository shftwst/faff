## Context

Exports from two regions need one comparable timestamp convention. This records ADRWORK-1, Use UTC timestamps.

## Decision

Store event timestamps in UTC to give exports a shared timestamp convention. The implemented change is limited to exported representation: the serializer emits UTC timestamps.

## Consequences

- Exported timestamps use UTC; two timezone conversion tests pass.
- Retention and scheduling are unchanged.
- The supplied evidence establishes serializer behaviour, not a change to internal timestamp storage.

---

Self-review: The consequences match the serializer change and its two conversion tests. The settled storage choice is recorded without claiming an unreported storage migration. The supplied format resolver fell back to Nygard because the template was empty or had no level-2 headings; its resolved sections are used unchanged.

confidence: medium

Confidence is advisory: the evidence verifies exported representation only, while the settled choice is worded as storage.