# Review artifact downstream replay

After the fresh Astra V3 comparison completes, replay all seventy actual review
artifacts through the real review-verdict CLI and production stored-comment
connector. The caller performs prepare, apply by reference, then finish after an
acknowledged write. The upstream tracker is a separate fixture process.

Require two reads, one acknowledged update, the original comment identity and
timestamp, and the exact persisted body for every artifact. The byte oracle is a
literal expected marker region around the unmodified artifact, with the fixture's
human prefix and suffix, including their CRLF sequences. Escaped strings and
outside-region newline normalisation must fail that comparison. Preserve each
artifact hash, native-audit hash, CLI result, connector calls and tracker events.

This supplements producer parity with deterministic downstream consumption. It
does not count as another model sample or as model-driven handoff selection, full
graft execution, or hosted tracker qualification. The earlier interactive CRLF
execution and its accounting limitations remain separately recorded.
