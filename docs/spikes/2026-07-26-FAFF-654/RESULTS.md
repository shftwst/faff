# FAFF-654 — what a GitHub-hosted Actions job exposes

## Provenance

record_for: FAFF-654
consumed_by: FAFF-646
instrument: probe.sh
instrument_version: 1
observation_table: empty — no shape obtained yet; see the column status below
euid_caveat: the search and read tests call access(2), which grants both to uid 0 almost everywhere, so undecidable(ancestor-not-searchable) and unreadable(not-readable-by-euid) may be structurally unreachable on a shape whose job runs as root; every classification in a transcript is relative to that transcript's probe_euid
empty_definition: present("empty") means the read succeeded and obtained no bytes; it is not a claim that the file is empty
cgroup_decisiveness: non-decisive — container-check.js:9-10 records that the detector never parses /proc/1/cgroup because it is empty under cgroup v2 and carries no container hint
writable_proxy: connecting to a unix socket requires write permission, so the writable test is a necessary-condition proxy for connectability and never proof
canonical_vs_rootless: the canonical and rootless socket paths are two separately-labelled groups and are never merged; HOST_SOCKET_PATHS excludes the rootless paths deliberately, because they are the recommended bounded posture and must never read as a violation

## Column status

hosted-direct: unobtained — the workflow has not been dispatched
hosted-container: unobtained — the workflow has not been dispatched
selfhosted-direct: owned_by FAFF-656
selfhosted-container: owned_by FAFF-656
columns_identical: unobtained — requires two hosted transcripts
worktree_changed_by_checkout.hosted-direct: unobtained
worktree_changed_by_checkout.hosted-container: unobtained
worktree_changed_by_checkout.derivation: yes when the set of entry names one level deep differs between the pre-checkout file and the transcript's work-directory listing; no when those two sets are equal; names only, not byte equality and not owner or mode
actions_runner_controller: unmeasured — needs a cluster and a controller install, outside this timebox; not derivable from this repository; carried as the open punt on FAFF-654 and to be filed as its own ticket

## Token coverage

Table: selftest-coverage — 10 signals — shapes: hosted-direct, hosted-container

| case | token | non-root run | euid 0 run |
|---|---|---|---|
| a | present | exercised | exercised |
| b | absent | exercised | exercised |
| c | undecidable | exercised | skipped |
| d | absent | exercised | exercised |
| e | unreadable | exercised | skipped |
| f | undecidable | exercised | exercised |
| g | unmeasurable_here | exercised | exercised |
| h | present | exercised | exercised |
| i | absent | exercised | exercised |
| j | present | exercised | exercised |

unfixturable.open-failed: no self-test case exists; POSIX sh cannot create a unix socket, mknod needs root, and a FIFO blocks on open with no portable timeout
unfixturable.read-failed: no self-test case exists; no portable way to fail a read after a successful open
unfixturable.evidence_rule: for each of these two tokens this record either names the transcript and key that demonstrated it, or records that it was not observed in this run; the bare claim that it is demonstrated by transcript is not sufficient on its own
unfixturable.open-failed.observed: not yet observed in a committed transcript; observed on the author's local machine during the build, on a rootless socket at /run/user/501/docker.sock, which is not a committed shape
unfixturable.read-failed.observed: not yet observed; on the machine measured during the build, pid 1's environ failed at the readable test rather than reaching the read, so this token may have no field demonstration on any shape

## Structural guarantee

no_byte_emitting_code_path: the probe has no code path that prints the bytes of a file it classified; every file-facing key emits a token, a long-listing line, or a name
exception_1: the mount table, printed verbatim
exception_2: the pid-1 environ key names, never values, under the names mode
exception_3: the value of the container key from the pid-1 environ, printed in full
exception_4: long-listing lines, carrying mode, numeric uid and gid, size and name
exception_5: faff container-check stdout, both JSON and plain
exceptions_are_complete: nothing else in the probe writes bytes obtained from a measured file
scan_is_a_backstop: the pre-commit scan is a backstop on the guarantee above and is not the guarantee itself
scan_gap_1: a prefix-less credential under a key name outside the credential key-name gate, or one containing a dot, colon or slash, is not caught
scan_gap_2: the generic high-entropy branch is close to inert against this record's own format, because every value line is a grammar token carrying parentheses that fall outside its permitted characters, and the verbatim blocks have no key-value separator to split on; it is carried for FAFF-656, which handles a credential class of exactly that shape

## Signal roster

Table: signal-roster — 41 signals — shapes: hosted-direct, hosted-container

| signal |
|---|
| mounts.table |
| socket.canonical./var/run/docker.sock |
| socket.canonical./var/run/docker.sock.is_socket |
| socket.canonical./var/run/docker.sock._dangling_symlink |
| socket.canonical./var/run/docker.sock.readable |
| socket.canonical./var/run/docker.sock.writable |
| socket.canonical./run/docker.sock |
| socket.canonical./run/docker.sock.is_socket |
| socket.canonical./run/docker.sock._dangling_symlink |
| socket.canonical./run/docker.sock.readable |
| socket.canonical./run/docker.sock.writable |
| socket.rootless.docker |
| socket.rootless.podman |
| env.DOCKER_HOST |
| attest.canonical_socket_present |
| attest.canonical_socket_writable_by_euid |
| attest.writable_is_a_proxy |
| attest.rootless_socket_present |
| containment.env.KUBERNETES_SERVICE_HOST |
| containment./.dockerenv |
| containment./run/.containerenv |
| containment.proc1.environ |
| containment.proc1.environ_keys |
| containment.proc1.container_value |
| containment.env.container |
| containment.proc1.cgroup |
| containment.proc1.cgroup.decisiveness |
| containment.proc1.comm |
| workdir.path |
| workdir.parent |
| workdir.checkout |
| workdir.listing |
| home.path |
| home.entries |
| socket_removal.performed |
| socket_removal.kind |
| socket_removal./var/run/docker.sock.after |
| socket_removal./run/docker.sock.after |
| crosscheck.container_check_json |
| crosscheck.container_check_plain |
| crosscheck.container_check_exit |

## Notes

notes: This is the one free-prose line class in this record. Every other line above is a provenance field, a table row, a caption matching the fixed template, a column-status line, or a heading, and every table cell is a value-grammar token, a signal name, a shape name, or the literal non-decisive marker. The advisory word-list check runs over this section specifically and its hits are recorded here with a reason each.

notes: No shape has been dispatched, so this record carries no observations. The instrument, its self-test and the workflow are committed; obtaining the two hosted columns is a dispatch of job-surface-probe.yml and a commit of the uploaded artifacts, verbatim. Until then every reading cell is absent from this file rather than filled with a placeholder, because a placeholder in an observation table is indistinguishable from a measurement.

notes: Operator attestation, image digest — NOT YET SATISFIED. The workflow takes the container image as a dispatch input defaulting to a bare tag, which is runnable but not reproducible. Before taking a reading that goes into this record, resolve the digest from the tag on the day, pass it as the input, and paste the resolving command and its output here.

notes: Operator attestation, credential-shape constants — NOT YET SATISFIED. Before running the pre-commit scan over any transcript, open config.js lines 859 to 880 and read all four constants by eye, confirming the copied values still match. They cannot be imported, so this is a copy that can drift.

notes: Operator attestation, pid-1 environ key block — NOT YET SATISFIED. Before committing any transcript, read its environ key-name block and confirm it carries no value material.

notes: Operator attestation, this notes section — NOT YET SATISFIED for the transcripts, since none exist. It is satisfied for this file as it stands: the content above was read for findings language. The advisory word-list check returns one hit, on the canonical_vs_rootless provenance field. It is left in: the word there reports what ADR-0041 already says about the rootless posture, which is why HOST_SOCKET_PATHS excludes those paths, and it asserts nothing about what faff or FAFF-646 ought to do. This is the over-flagging the word list was expected to produce, which is why it is advisory rather than gating.

notes: A self-test was run during the build on the author's machine at euid 501, reporting 11 assertions across 10 fixture cases, zero skipped and zero failed. That run is not committed here because local-dev is not one of the four shapes; the committed self-test outputs come from the dispatched jobs. It is recorded because the non-root demonstration criterion turns on at least one committed non-root run, and the hosted-direct job is the one expected to supply it.
