# Sol native model-expectation correction

The initial Sol runner invoked the frozen Astra auditor, whose model/effort gate
expects gpt-6-astra / low. That wrongly rejects the requested gpt-6.1-sol / medium.
The underlying literal-command, initial-read, completion and CLI-version checks
remain correct and unchanged.

A separate Sol wrapper reuses that exact audited core and replaces only the
model/effort expectation. It requires exactly gpt-6.1-sol and medium; other models
or efforts still fail. Tests cover those mismatches and retain transport/read
failures. Reports bind the wrapper, unchanged core, classifier and raw session.
The Astra auditor and already qualified evidence are untouched.

Re-audit each existing Sol native capture without a new model call. Preserve its
first report as native-audit-astra-expectation.json, and record both report hashes
and the correction in native-audit-correction.json. The corrected report occupies
native-audit.json for standard downstream binding. Original worker logs retain
the first disposition. No task, output, fixture or sample is replaced.

The initial running calibration workers retain their original runner source.
Subsequent workers use run-sol-workflow-samples-v2.py, which changes only the
auditor path; model prompts, tool permissions and grading remain identical.
