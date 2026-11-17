# Kernel fixture interface correction

Before any kernel edit, baseline-v1 completed all real config and dispatch choices
correctly but failed the fixture protocol and strict metadata comparison:

- The status field was exposed only as string with a description saying
  "completed", while the server accepted only "complete" or "blocked". Declare
  the exact enum and wording before further samples.
- Full kernel policy requires adapter validation before invoking an unvalidated
  occupant. The fixture exposed stub occupants but rejected validate-adapters.
  State explicitly that supplied stubs are already validated; this bounds the
  fixture to config/dispatch, leaving the unchanged conformance section outside
  the cut and the measurement claim. No real validator execution is claimed.
- Resolved spec/review/model/effort metadata in submit_result is useful and was
  not forbidden. Accept it when accurate; still require requested values and
  reject wrong or unknown values. The comparison omits these optional redundant
  echoes; raw reported values remain in the capture and grade.
- faff-graft Step 4b and graft Step 4b name the same architecture materialiser.
  Canonicalise that prefix; retain all authority/attachment assertions.

Original v1 report, capture and native errors remain unchanged. No part of that
failed protocol trial is pooled into the new five-pair v2 treatment. The policy,
production runtime, nine execution cases and 24 rule obligations are unchanged.
The public task/schema changes precede both v2 arms and candidate authoring.
