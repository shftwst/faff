# Challenge input transport, frozen before new samples

Context-v3 challenge screens report that the local merge-fence hook rejected
literal `gh pr merge` text inside JSON reasoning in baseline-2, baseline-3 and
candidate-2. The worker reworded the reason and the bridge records only one actual
submission per case. All recorded admissions pass, but native rejected attempts
remain failures under the frozen no-rejection protocol. No old sample is waived.

For fresh challenge pairs, argument data is written with the native Write tool to
one explicitly authorised `bridge-arguments.json` file under the run directory.
The Bash call contains only the fixed bridge script, directory and tool name.
The bridge reads that file and sends it through the same recorded mailbox. No
shell command is hidden inside the data, evaluated or executed. Native guards
remain enabled, and actual commands remain visible to them. This separates
review reasoning from shell syntax without changing the judgement or consumer.

The same complete policy reader, mandatory guidance, production runtime, challenge
fixtures, effect oracles and Phase-1 field checks apply. Both arms use a fresh
context in the same Opus 5.5 medium worker. Five pairs alternate ordering. Every
candidate case and protocol review must pass. Preserve all rejected, failed or
incomplete samples; no pooling with prior treatments or sample replacement.

The bridge test passes quote characters, dollar signs, CRLFs and a literal merge
command as data, and checks that the process argument list contains none of that
review text. No native hook configuration or production code is changed.
