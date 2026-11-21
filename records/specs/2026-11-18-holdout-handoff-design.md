# Prepare and read existing holdout evidence

The default evaluator reads the same full-view spec and receives the same spawner payload. `faff holdout criteria` projects the existing classifier's running-stack rows and fills the fixed human-only outcome for prose scenarios. The evaluator still chooses the exercise and judges its results. Graft reads only the same classifier's counts for its holdout trigger.

On the trusted side, `faff holdout receipt` validates the existing writer's local record and returns its aggregate. A failed writer cannot advance from a previous file. A cage signal from launch or the recorded boundary requires both byte-identical copies and valid spawner attestation. A broken intent fails closed. The writer and spawner still own the evidence files, and the merge gate still verifies its own floor.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `` **Resolve the cage promise from `<run-dir>/lane-boundary.json`, then dispatch the evaluator code-blind.** `` | changed: launch and attestation ownership remain, and the receipt validates the closed result |
| `` Pipe the stored record (inline: `.faff/holdout/<key>.json`; caged: the run copy) `` | changed: the receipt validates local copies through the same contract and retains the cage ratchet |
| `` Confirm `.faff/holdout/<key>.json` exists `` | changed: the receipt requires the store before the same PRDR bridge |
| `` IF `faff dod classify --spec <full_spec>` judged_count == 0 `` | changed: the offer and run read the classifier's exact same counts without full rows |
| `` **Classify the DoD.** Run `faff dod classify --spec <spec> --json` `` | changed: holdout criteria uses the same classification with the judged-row projection |
| `` **Leave the delegated criteria out `` | changed: delegated tiers stay excluded from the model's judged set |
| `` **Exclude** every DELEGATED criterion from the emitted verdict's `criteria` array `` | changed: the projection includes only running-stack criteria and the writer still derives delegated rows |
| `` **Mention** them in the human-readable evidence report if useful `` | changed: delegates stay outside evidence judging while the narrative report remains optional context |
| `` **Record prose scenarios as `needs-human`.** `` | changed: the helper fills the fixed prose outcome and the evaluator still explains unavailable exercises |
| `` **Roll up + emit.** Derive the `aggregate` from the criteria per the fixed derivation `` | changed: the contract owns the aggregate rule and the spawner still derives and writes its attestation |
