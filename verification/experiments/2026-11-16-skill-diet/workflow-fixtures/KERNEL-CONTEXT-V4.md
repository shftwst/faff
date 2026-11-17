# Kernel fixed literal command treatment

V3 functional cases passed, but the strict native audit found shell-variable command abbreviations in baseline sample 3 and candidate sample 4, plus an unrecognised command in candidate sample 3. All original evidence remains. No V3 sample is reused, normalised or pooled.

V4 explicitly forbids shell variables, abbreviated command prefixes, aliases, functions and separators. Both arms use the same new literal-command runner, policies, fixture, real CLI and initial global/repository guidance. Run five baseline and five candidate samples. Apply the unchanged case grader and strict native auditor to every sample. Do not count the source reduction until qualification passes.
