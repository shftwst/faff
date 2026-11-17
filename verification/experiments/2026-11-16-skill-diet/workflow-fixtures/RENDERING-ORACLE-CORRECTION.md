# Rendering heading comparison

The unchanged baseline's first two samples named the correct voice source as
`AGENTS.md`, heading `# Writing style`. The fixture expected `Writing style`.
Markdown's heading marker does not select a different section, and the unchanged
policy itself spells the heading with that marker.

Keep every original report and capture. A separate assessment accepts only these
two exact values for the `voice-source` answer: the two-key object with file
`AGENTS.md` and heading either `Writing style` or `# Writing style`. Normalise the
second spelling to the first for comparison. No other answer, artifact, tool
error or guard failure is waived. Apply this rule to both arms. The fixture,
model-visible task and original grader remain unchanged.

This correction was written before candidate rendering measurements. Remaining
baseline samples retain their planned identities and are run once. Their raw
failure scores stay visible beside assessed scores; failed samples are not
rerolled or removed.
