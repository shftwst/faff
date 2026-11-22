# Select the promotion source before scaffolding ADRs

Use the known tracker intent when available. Otherwise read the exact file committed by Step 4 using the existing section locator. When the project disables ADRs or the spec contains no readable intent, graft skips the promotion path. The local output includes the resolved directory for active promotions. The CLI never fetches tracker comments or creates an ADR.

Numbering, authoring, contradiction judgement and human acceptance retain their existing owners. An issue ID or title alone cannot identify two different decisions from one spec revision, so the selector does not deduplicate ADR writes by those fields.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `Resolve adr_docs_path=` | The selector returns the resolved directory for a live promotion. | test/adr-promotion-source.test.mjs | kept |
| `No intent located (no tracker comment` | Missing or unreadable spec intent returns absent. Off mode skips both sources. | test/adr-promotion-source.test.mjs | kept |
