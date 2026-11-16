# Correct the help-page heading

This spec addresses SPEC-1: rename the help-page heading while preserving the rest of the page. It is for the build agent and human reviewers.

## WHY

Change only the existing heading in `docs/help.md`. The page currently calls itself `CLI reference`; the required name is `Command reference`. This is a mechanical documentation edit with no command or API change.

**Reference context:** `docs/help.md` is Markdown and currently contains exactly `# CLI reference\n\nUse tool --help for options.\n`.

## OUT OF SCOPE

- **Command behaviour:** Only documentation naming changes. Future command changes belong in `src/cli.ts`.

## WHAT

The resulting page MUST contain exactly `# Command reference\n\nUse tool --help for options.\n`, where `\n` denotes a newline. Preserve every byte after the original first heading, including blank lines and the final newline. No types or interfaces change.

## HOW

Replace the existing heading in place. Verify the new heading and compare the remainder byte for byte against the supplied original.

```
PROCEDURE correct_help_heading(page):
  1. Locate the initial heading '# CLI reference'.
  2. Replace that heading with '# Command reference'.
  3. Preserve every subsequent byte.
```

A file-content assertion checks the heading and unchanged remainder.

## Scenarios

No behavioural scenario is required for this mechanical text-only objective.

## DESIGN DECISION RATIONALE

**How should the heading change be applied?**

- **Edit in place:** Limits the change to the requested heading.
- **Replace the page or change commands:** Adds unnecessary change outside the issue.

**Chosen:** Edit the existing heading in place to avoid replacing the page or changing command behaviour.

## OPEN QUESTIONS AND ASSUMPTIONS

No open questions or external assumptions. The supplied Punt scan reports zero eligible Punts and zero blocking open Punts.

## DONE

### From WHY and WHAT

- [ ] `docs/help.md` starts with `# Command reference` and every byte following the original heading is unchanged.

### From HOW

- [ ] The file-content assertion for the heading and unchanged remainder passes.

### Integration smoke test

```
PROCEDURE smoke_check_help_page:
  1. Read docs/help.md after the edit.
  2. Assert its bytes equal '# Command reference\n\nUse tool --help for options.\n'.
```

## Review record

The supplied inherited review is complete: 0 blocker, 0 major, 0 minor findings. All supplied facts were checked; no changes beyond the snapshot are authorised. No review fixes, dismissals or additional Punts remain.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"}]}
```