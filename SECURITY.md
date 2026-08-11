# Security policy

## Supported versions

Only the latest release is supported. The project ships as a single component
through release-please; fixes land on `main` and in the next release.

## Reporting a vulnerability

Report a suspected vulnerability through GitHub's private vulnerability
reporting: open the repository's **Security** tab and choose **Report a
vulnerability**. This keeps the report confidential while it is assessed.

Please do not open a public issue or pull request for a vulnerability.

## What is in scope

SuperDomestique runs delegated work and lets Commissaire, its governance layer,
stop or block work when the evidence is insufficient. In scope for a security
report:

- A way for an autonomous run to produce an effect that Commissaire should have
  blocked: bypassing the merge gate, or reaching a merge through prompt
  injection.
- A weakness in the tamper-evidence chains that record what a run did
  (`events.jsonl`, `declared-effects.jsonl`).
- An ordinary code-execution or credential-exposure defect in the `faff` CLI or
  the skills.

This policy makes no claim about what the governance checks currently prove; the
[public trust-claim audit](verification/audits/2026-08-07-FAFF-732-public-trust-claims.md)
records that separately.

## What to expect

This is a solo-maintained project. Expect a best-effort acknowledgement, with a
target of seven days, and a request to coordinate disclosure until a fix is
available. There is no bug-bounty programme.
