Prompt caching depends on an identical leading token sequence.

- **Mechanism:** The SDK checks the longest matching request prefix and recomputes its suffix.
- **Measurement:** Measure hits using `cache_read_input_tokens`.
- **Placement:** Put stable system text before the volatile user turn.