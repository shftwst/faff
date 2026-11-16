# Adversarial oracle correction

Two context-v3 results exposed grader requirements that exceed the skill's
contract. Correct the oracle, preserve the original grades, and apply the same
corrected assessment to every recorded and remaining sample. Policy text, fixture
inputs, runtime, public tools and model-visible responses are unchanged.

1. The original and reduced policies require a findings file for autonomous
   completion checkpoints. Interactive review can consume helper stdout directly.
   Baseline-3 did that, but the grader incorrectly required a file in every case.
   Require exact bytes when the file is required or voluntarily written; retain
   all finding identity, severity, carry, attribution and final-contract checks.
2. The public read_file tool permits reading supplied files, including planned
   staging outputs. Candidate-2 checked the system output before writing it and
   received ENOENT. That is a permitted read-only existence probe. Record it as
   a diagnostic without calling it an unauthorised operation. Only ENOENT on the
   supplied system/backends/findings output paths, with Phase 1 passing, receives
   this classification. Input-file failures, protected paths, other errors and
   rejected commands still fail. The raw error and bridge rejection count remain.

Tests prove that an absent autonomous findings file still fails, that unexpected
input-file misses and other read errors still fail, and that allowed output misses
remain visible. Existing budget, exact copied guidance, backend byte preservation,
checkpoint ordering, protected-state and merge-floor assertions are unchanged.

Original report.json and capture.json files are immutable. A separate assessment
binds their hashes and the corrected grader hash. The completed baseline-3 and
candidate-2 samples are reassessed rather than rerun. Remaining predeclared
samples keep their names and ordering. This is an explicit oracle correction,
not a claim that the original stricter grades passed.

Native hook rejection of quoted merge text is a separate issue; it is not covered
by these corrections. Challenge file-input trials will use an established worker:
the new worker's startup handshake timed out and removed it during its candidate
trial. That trial is incomplete infrastructure evidence, not a fidelity pass.
