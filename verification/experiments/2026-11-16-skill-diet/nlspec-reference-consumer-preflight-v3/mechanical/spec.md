# SPEC-1: Correct the help-page heading

> Spec: faffter-dark-nlspec · 2026-11-16 · interactive · claude-code/unknown · faff 0.45.0 · confidence: high. Full spec on Linear SPEC-1.

This spec addresses SPEC-1 for the build agent and human reviewers.

## 1. WHY
An in-place heading edit preserves the rest of the help page. The current CLI reference label should be Command reference.

Reference context:

| System | Language | Relevance |
|---|---|---|
| docs/help.md | Markdown | Existing help page updated in place |

## 2. OUT OF SCOPE
- Command behaviour: excluded because only naming changes; extend src/cli.ts in a separate issue.

## 3. WHAT
docs/help.md contains the heading CLI reference and the unchanged help sentence. The heading becomes Command reference.

## 4. HOW
PROCEDURE update_help:
  1. Replace the first heading only.
  2. Preserve all remaining bytes.


## 6. DESIGN DECISION RATIONALE
**Heading edit or page rewrite?** In-place editing avoids unrelated changes; rewriting the page risks them. **Chosen:** edit the existing heading in place.

## 7. OPEN QUESTIONS AND ASSUMPTIONS
No open questions or external assumptions.

## 8. DONE
### From WHY / WHAT / HOW
- [ ] docs/help.md MUST begin with # Command reference.
- [ ] The remaining page bytes MUST be unchanged.

Integration smoke test: compare the heading and remaining bytes with the supplied original.

## Review record
Supplied completed review: no blocker, major or minor findings. No resolution changes or dismissed findings.

confidence: high
build-tier: mechanical
admissibility: refused — R1.scenarios (no Scenarios units)

```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}]}
```
