# Review producer V2 oracle correction

The unchanged V1 baseline correctly refused missing mixed-case coverage. Its
concrete action was `Add assert.equal(lower('AbC'), 'abc') to cover AC2.`.
The original recogniser required mixed, test or coverage and rejected it.

V2 accepts cover, assert and AC2 as equivalent action wording, while preserving
the required test-file location and fail signal. All other fixture bytes and
producer instructions are unchanged. The original report, artifact and native
trace remain separate. A fresh five-versus-five comparison is required; the
failed V1 sample is not replaced or pooled. The review body is still unchanged.
