# WTF label-prefix equivalence

The first original baseline returned `Methodology: ` for the question asking for
the label prefix before the skill name. The frozen oracle stored `Methodology:`.
The output template puts a space between that colon and the name, so either
string names the same label. The original result remains a failed raw decision.

Before any candidate response, permit exactly one assessment normalisation:
`methodology-line` value `Methodology: ` becomes `Methodology:`. No other whitespace,
capitalisation, label, value, artifact or case is changed. The fixture and original
reports/captures remain immutable. Regrade a copy using the original grader and
bind the report, capture, fixture, grader, assessor and this note by hashes.

This does not excuse tool errors, omitted facts, reordered work, invented actions
or any other decision failure. Apply the same rule to both arms. Report raw and
assessed scores separately. Continue the planned samples; never replace a sample.
