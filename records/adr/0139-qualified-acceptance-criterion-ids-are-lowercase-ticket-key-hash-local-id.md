# ADR 0139 — Qualified acceptance-criterion ids are lowercase ticket key, hash, local id

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-10-15
- **Issue:** FAFF-1287

## Context

An acceptance criterion (AC) is named in four places: the spec's DONE lines, the PR-body checklist, the `ac-checklist.json` anchor and, from FAFF-1288, the test that verifies it. Until FAFF-1287 these places had no shared name, so nothing could match a PR-body line to its anchor entry or to the test that proves it. FAFF-1287 introduces one qualified id, and FAFF-1288 and FAFF-1289 build on it.

The id has to come through the PR body unchanged. The citation-hygiene sanitizer in `pr-body.js` rewrites the hyphen in any uppercase `[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*` token to U+2011, so an id such as `FAFF-1287#AC-3` would reach the PR body as different bytes from the ones in the anchor. The options considered:

- Keep the uppercase form and exempt it from the sanitizer. This weakens a hygiene rule to suit one caller.
- Use an underscore form such as `FAFF_1287#AC_3`. It survives the sanitizer, but a search for the ticket key no longer finds it.
- Use the lowercased ticket key.

## Decision

The qualified acceptance-criterion id is the lowercased ticket key, `#`, and a local id: `faff-1287#ac-3`. When a DONE item carries no usable `[ac-N]` marker, the positional fallback is `faff-1287#done:3`.

Every place that names an AC uses exactly these bytes:

- spec DONE lines, as the local part `[ac-N]`
- the PR-body checklist
- `ac-checklist.json`, in `ac_id`
- test-source tags (FAFF-1288)

Lowercase was chosen because:

- The sanitizer matches only uppercase keys, so the id passes through the PR body unchanged.
- The ticket key still turns up in a case-insensitive search (`grep -i FAFF-1287`).
- It needs no escaping in Markdown, JSON or test titles, and GitHub-flavoured Markdown does not autolink it.

The sanitizer is left unchanged.

## Consequences

- Ids are compared as exact bytes. Code that uppercases or otherwise normalises the key breaks the match, so the grammar lives in one helper (`ac-id.js`) rather than in each consumer.
- FAFF-1288 and FAFF-1289 emit and parse this grammar and do not introduce their own spelling.
- Anchors written before this change carry no `ac_id` and remain valid. They are not rewritten.
- The ids read differently from tracker keys (`FAFF-1287`), so a search by key needs to be case-insensitive.
- The lowercase rule depends on the sanitizer matching only uppercase keys. If that pattern ever widens to lowercase, this decision needs revisiting. A round-trip test (render, sanitize, compare) guards it.
