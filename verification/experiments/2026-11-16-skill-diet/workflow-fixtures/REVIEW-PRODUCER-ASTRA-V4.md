# Review producer Astra V4 integration correction

V3 completed all ten samples and seventy artifact replays successfully. Its
source fails the existing inline-enum lint because compressed conditions group
all contract values within two lines. Keep that source and failed integration
log. Do not relax the linter.

V4 separates those existing judgement conditions and cardinality rules in prose.
No judgement, input, output, title, human-pass or appetite rule changes. Measure
five new candidate samples with the same original runner, fixture, context and
Astra-low settings. Compare against all five unchanged, successful V3 baseline
samples. This baseline reuse is explicit; no failed sample is replaced, and V3
candidate samples never count toward V4 acceptance.

Require the same functional/native/manual source-fact gates, exact candidate
prose/JSON title equality and actual-artifact connector replay. Require adapter
lint and committed-source integration tests before acceptance. Sentence-style
titles observed in V3 are recorded separately; no perfect style parity claim.
