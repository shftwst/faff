# Planner boundary contract

Implementation boundary specification for `faff review-comment plan --input -`.
Release 0.45.0 was verified at `690546db64e3de7a68058a98a9945bfb731e68b3` on 2026-11-16.
The seven operator decisions in `eval/control-parity/policy-decisions.json` take
precedence. These boundary rules make invalid or ambiguous input fail without a
write plan; they add no tracker authority. The implementer adopts the boundary rules below for the read-only planner.
These are implementation choices, not additional operator decisions in the
seven-decision record. Rejection returns no plan and performs no write.

| Input | Accepted shape |
|---|---|
| Envelope | Exactly `schema`, `issue_id`, `faff_body`, `comments`; schema is integer 1 |
| Issue ID | Non-empty string with no whitespace, control characters, `<` or `>` |
| Replacement | String, including empty text, Unicode and original line endings |
| Comments | Array of objects with non-empty string `id` and string `body`; IDs must be unique |
| Comment metadata | Preserved as input data; authorship is ignored |
| Timestamp | Absent or null means missing. Otherwise a valid RFC 3339 timestamp with a timezone and at most three fractional second digits. Invalid calendar dates, leap seconds and unsupported precision are rejected |
| JSON | One value, no trailing values, duplicate object keys, non-finite numbers or unpaired Unicode surrogates |

The CLI rejects an input document larger than one MiB, before parsing. Successful
stdout is one schema-1 JSON plan plus a newline. Invalid arguments or input exit 2
with a diagnostic on stderr and empty stdout. No configuration, tracker, network,
environment credential, repository or clock lookup is needed to compute a plan.

| Boundary | Rule |
|---|---|
| Logical lines | Split only at LF, retaining offsets into the original string. A CR before LF belongs to its preceding line |
| Marker recognition | The whole line, after removing trailing whitespace, must equal the current issue's open or close marker; leading whitespace disqualifies it |
| Foreign markers | A marker for another issue is ordinary text |
| First marker | First structural marker for the current issue must be open; an earlier structural close disqualifies the comment |
| Pair | First open through the first structural close after it. Later marker text is preserved |
| Fences | Backtick or tilde runs of at least three, preceded by at most three ASCII spaces. A closing fence uses the same character, at least the opening length, and only trailing spaces or tabs. A backtick opening info string cannot contain a backtick |
| Unclosed fence | Everything after its opening is fenced text |
| Open-only comment | Open marker through end of body is replaceable; preserve its prefix |
| Complete-pair preference | If any matching comment has a close after its open, restrict selection to those comments |
| Timestamp order | Earlier instant first; equal instants keep listing order; missing timestamps follow all timestamped comments |
| Duplicate comments | Return one target; leave all other comments untouched |
| Splice | Preserve prefix through the open line's starting offset and suffix from immediately after the close line's content. Preserve the suffix LF and all later bytes. Replace marker-line trailing whitespace, including CR, with the canonical region |
| Canonical region | Open marker, LF, exact replacement text, LF, close marker |
| Replacement markers | Reject replacement text containing a structural marker for the current issue outside a fence. Such text would change the region on a later run. Quoted, inline and closed fenced examples remain data. Reject an unclosed replacement fence, which would hide the closing region marker on the next run |

The plan fields are defined in `command-contract.md`. A create has reason
`created`; an update has reason `updated` for one structural match and
`reconciled` for several, including matches excluded by complete-pair preference.
`expectedDigest` hashes the complete original selected body as UTF-8. It does not
provide remote compare-and-swap protection.

Additional deterministic cases must cover: close-before-open, foreign markers,
both fence characters and their indentation/length rules, unclosed fences,
empty replacement, Unicode, mixed line endings, missing/equal/offset timestamps,
invalid dates, duplicate IDs, repeated and nested marker pairs, shell-like text,
exact prefix/suffix preservation, and repeating an operation without another
create or loss of preserved text. These are development cases, not holdouts.

The candidate must also pass all eleven independent recorded outcomes through
the emitted CLI. Expected effects stay in the evaluation/test tree and are never
imported into production code. The production module is `plugin/skills/faff/bin/lib/review-comment.ts`, with
committed JavaScript emit, factory registration and CLI coverage mapping.
