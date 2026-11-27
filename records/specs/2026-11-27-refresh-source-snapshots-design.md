# Compare the original approved spec with the staged refresh

Prep stages a spec in place. In git-only mode staging also updates the local spec store. Capture the source selected during discovery before either file can change. A paths-only carry requires an independent original and the actual staged body. Challenges and resolutions still require a review, and intent reconciliation still follows attachment.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `save the Step 1 spec` | Preserve original before revision and reconcile intent on reattachment. | test/prep-resume-guidance.test.mjs | kept |
| `Then run the shared already-shipped scan` | Run the premise gate after preserving the original. Keep the narrow, proceed and park routes. | test/prep-resume-guidance.test.mjs | kept |
| `produce a refreshed spec with changes annotated` | Stage the working copy, including changes attributed to post-spec comments. | test/prep-attach.test.mjs | kept |
| `Save the spec text read at the top of this path` | Compare two independent files and re-review when the original cannot be established. | test/spec-review-carry-check.test.mjs | kept |
| `run no lens, write no round record` | Resolve the review directory before writing carried evidence. Preserve the evidence digest and unchanged verdict. | test/spec-review-pin.test.mjs | kept |
