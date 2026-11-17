# Extracted skill reductions

Two independent PRs extract the previously measured adversarial-review and
gateway prompts onto main. `status.json` records source hashes, bytes, estimated
tokens, local checks and historical fidelity limits. The prompts match their
measured candidates; no new model samples were run.

- #1207: 52,030 bytes / 12,859 estimated tokens; six implementation files.
- #1208: 7,152 bytes / 1,764 estimated tokens; four implementation files.

Both PRs are open. Current-main savings already landed are 42,050 bytes /
10,326 estimated tokens. The two extractions would add 59,182 bytes / 14,623
estimated tokens. Keep landed and pending totals separate.

The adversarial loader received a one-line section-boundary correction and
regression checks because the reordered skill otherwise included implementor
instructions in the reviewer prompt. The old loader fails the new regression
checks. All 651 relevant tests pass after the fix. Gateway validation passes
10 targeted tests. Both adapter and inventory checks pass.

Detailed historical evidence remains at the commits linked in the PR bodies.
These implementation branches include the runtime edits, optional operator
reference, minimal inventories, size ratchets and the required consumer fix.
They include no experiment harness, transcripts or raw run archive.
