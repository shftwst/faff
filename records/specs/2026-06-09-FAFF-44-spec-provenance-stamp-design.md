# FAFF-44 — Spec provenance stamp: date + producing spec skill (+ mode) on every spec

> Spec: faffter-dark-nlspec · 2026-06-09 · autonomous · adaptor: faffidavit-spec · confidence: high. Full spec on linear FAFF-44.

## WHY
Every spec faff attaches should be self-describing about its lineage: when produced, which producer ran, in what mode, under which `spec_adaptor`. Today that's forensics. The committed specs prove the pain — provenance is inconsistent across every spec because no contract owns it (FAFF-63/62 use a blockquote header, FAFF-58 has no stamp, FAFF-23 a bare confidence token, FAFF-1 names `faffter-noon-spec` while `.faffrc` configures `faffter-dark-nlspec` — the exact config-drift the issue cites).

- **Chosen:** adaptor owns format + validates; **prep populates values** — mirrors how the `confidence:` line works. Producer-emitted rejected (a producer can't reliably know the mode; self-naming is the failure this fixes).
- **Chosen:** record the **resolved** slot occupants (`faff config get slots.spec` / `slots.spec_adaptor`), not a producer's self-report — that's what makes it a drift detector.

## WHAT
**Chosen:** fields = date · producer · mode · adaptor (the four values prep holds at attach time).
**Punt:** faff **version** field — not reliably resolvable today (`.release-please-manifest.json`=`0.0.0` vs `plugin.json`=`0.1.0`; no `faff config version`). Default: omit until a trustworthy source exists.

**Chosen — format:** a dedicated blockquote line directly under the H1:
```
> Spec: <producer> · <date> · <mode> · adaptor: <adaptor> · confidence: <level>. Full spec on <tracker> <ISSUE-ID>.
```
Echoes the confidence token for skimmability but does NOT replace the standalone trailing `confidence:` line, which stays authoritative for validation + the prep gate.

**Chosen — enforcement:** adaptor-defines-and-validates, prep-populates. Producers unchanged.

## HOW
- `skills/faffidavit-spec/SKILL.md`: new _Provenance stamp_ section (format + placement under H1); validation check that the stamp line is present + well-formed (date ISO, mode ∈ {interactive,autonomous}).
- `skills/faff-prep/SKILL.md`: at attach (Scenario A, Scenario B refresh, both autonomous paths) prep resolves producer (`faff config get slots.spec -d faffter-noon-spec`), adaptor (`faff config get slots.spec_adaptor -d faffidavit-spec`), date (today), mode (autonomous under the signal else interactive), and writes the blockquote line under the H1 before validation + attach. On stale-refresh, re-stamp with fresh date + current config. Git-only mode writes the stamp into `.faff/specs/<id>.md`; the "Full spec on …" tail drops when no tracker resolves.
- **Anti-pattern:** validation checks the stamp is present + well-formed, never that its values are runtime-true (validation is structural/pre-attach).
- **Chosen — backfill:** new-and-refreshed-only; do not rewrite historical committed specs.

## DONE
- [ ] Stamp carries exactly date (ISO) · producer · mode · adaptor; version absent (punted).
- [ ] Producer field reflects resolved `slots.spec` → a drift case is a one-line read.
- [ ] Renders as a blockquote under the H1; trailing standalone `confidence:` line unchanged + authoritative.
- [ ] `faffidavit-spec` defines the format + adds a validation check; producers unchanged re stamping.
- [ ] Prep resolves producer/adaptor CLI-only, resolves mode from the autonomous signal, writes the stamp before validate+attach (fresh, refresh, both autonomous paths); re-stamps on refresh.
- [ ] Validation fails a missing/malformed stamp; does not assert values are runtime-true.
- [ ] Existing committed specs not rewritten. Git-only writes the stamp into `.faff/specs/<id>.md`.
