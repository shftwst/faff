# Kernel summary projection correction

The original `kernel-config-v2-results.json` reports all cases passing, but its
cross-arm hash differs because the summary compared the raw spellings
`faff-graft Step 4b` and `graft Step 4b`. The v2 fixture grader already normalised
that exact prefix before either arm ran, as documented in KERNEL-CONFIG-V2.md.
The summary omitted that same normalisation from its decision projection.

Apply the already-declared prefix normalisation to that one field and write a
new summary. Preserve the original summary and all raw reports. No policy,
fixture, runtime result, requirement or grade changes. This is not a new oracle
exception and requires no rerun.
