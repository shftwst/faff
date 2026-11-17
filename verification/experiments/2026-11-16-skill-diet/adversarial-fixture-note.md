# Fixture correction before candidate authoring

The first draft used `changes-requested` as a Phase-1 signal. Inspecting
`faff contract review-verdict --describe` showed the actual value is `fail`.
This was found before any candidate was authored, independently of model answers.
The v1 fixtures and any runs remain unchanged. The v2 suite substitutes `fail`
in that input and oracle only. Headline comparisons will use v2 for both arms.

The first baseline reported only `review-call.mjs` for a question asking the
network path. That wording could reasonably name the network caller alone.
Before candidate authoring, v3 makes the answer shape explicit: an ordered array
of all required helpers, wrapper first. The expected operational requirement is
unchanged. v3 comparisons use the same fixture and oracle for both arms.

V3 retained both required helpers but included the correct `--consumer code_review`
flag in the requested full command. The exact-match oracle expected the command
name only. That flagged answer is semantically correct, not a baseline safety
failure. V4 explicitly requests the command name without flags. The oracle is
byte-identical to v3. No candidate exists at this point; final runs use v4.

V4 baseline passed 37/37. Candidate v1 supplied the correct wrapper/caller and
`adversarial-backends`, interpreting command name as the subcommand. That one
exact-match failure is a format ambiguity, not a different network path. V5
asks for the executable and subcommand as two array elements. All other cases
are unchanged. Candidate v1 and its 36/37 raw grade remain preserved. Separate
static checks also required retaining the fixture-cap set name and using the
CLI describe surface for the ADR outcome enum; candidate v2 addresses those.
