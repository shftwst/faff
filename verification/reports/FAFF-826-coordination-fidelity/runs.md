# Post-fix stratum: runs (FAFF-974, protocol version 2)

This file records every run considered for the post-fix stratum, as `protocol-v2.md` requires: each run's plugin version, its capture setting and whether it is included. It was written on 2026-10-27, after collection stopped. Only counts were read before writing it: base records and joined pairs per kernel, which the protocol's "No peeking" section permits. No record was replayed and no agreement or divergence was read.

## Window

- **Start:** v0.43.0 published at 2026-10-24 15:40:37Z (the first release containing FAFF-1394, #1115 and #1117).
- **Stop:** rule 2, 30 included runs. The 30th included run is `run-20261027-192721-beepboop-list-c7df54`, started 2026-10-27 19:27:21Z.
- **Rule 1 was never met:** four gradeable kernels have no joined pair (see below), so rule 1 could not fire before rule 2.

## Where the records are

All runs below ran on `fly-ci-l3-runner` (stratum S3). Their run directories and streams live on the runner's state volume (`faff-state` Docker volume, `runs/` and `streams/`). The count was read from a fork of that volume on 2026-10-27; the fork was destroyed afterwards. The corpus was extracted from a second fork of the volume on 2026-10-27 and is committed in `verification/reports/FAFF-974-post-fix-fidelity/` (`decision-corpus.jsonl`, sha256 `1310d43e…87b8fbcd`, 128 records: 75 base records and 53 action markers from 16 of the 30 included runs; the other 14 made no decisions). Its `manifest.json` lists the 30 included run ids and the sha256 of the archive the runs were copied from. The corpus holds only included runs, kept apart from the pre-fix pilot corpus as FAFF-974 requires.

No beep-boop run on the operator's machine started inside the window, so S2 is empty.

## How each field was established

- **Version.** The protocol names the version the runner's install step logged. Fly keeps only the last 100 log lines, so that line is gone for every run. The version is instead taken from the run ledger's `owner.faff_version` where present, otherwise from the plugin cache path (`cache/faff/faff/<version>/`) in the persisted stream's init event. Both name the plugin the run actually loaded. A run with neither is excluded.
- **Capture.** Every Fly drain clones the repository and uses the committed `.faff/config.yaml`, which has set `capture.decision_kernel: "on"` since 2026-10-16 (#1080) with no change in the window. Neither of the two runner images inspected (`sha256:6d2283da…`, the release image deployed on 2026-10-24, and `sha256:a0b6cd5b…`, the image running at the stop) overrides it in `drain.sh`. The second image reached the machine by a direct machine update rather than a release, so the release history cannot rule out a third image in between.
- **Instrumentation runs.** No run was labelled as an instrumentation test before it started; there was no `runs.md` until now. None is excluded on that ground.

## Runs

| Run | Stratum | Version | Version source | Capture | Run ended | Included | Reason excluded |
|---|---|---|---|---|---|---|---|
| `run-20261024-164332-beepboop-list-95716c` | S3 | unknown | none | on | no | no | version cannot be established (no ledger version, no stream) |
| `run-20261026-023518-beepboop-list-9f24af` | S3 | unknown | none | on | no | no | version cannot be established (no ledger version, no stream) |
| `run-20261026-031227-fly-l3` | S3 | 0.43.0 | stream init event | on | no | yes (1) |  |
| `run-20261026-070223-fly-l3` | S3 | 0.43.0 | stream init event | on | yes | yes (2) |  |
| `run-20261026-072331-beepboop-list-915cd3` | S3 | 0.43.0 | stream init event | on | yes | yes (3) |  |
| `run-20261026-075325-beepboop-list-c04534` | S3 | 0.43.0 | stream init event | on | yes | yes (4) |  |
| `run-20261026-082356-beepboop-list-a16688` | S3 | 0.43.0 | stream init event | on | yes | yes (5) |  |
| `run-20261026-131701-beepboop-list-f0d18c` | S3 | 0.43.0 | stream init event | on | yes | yes (6) |  |
| `run-20261026-153646-beepboop-list-11b481` | S3 | 0.43.0 | stream init event | on | yes | yes (7) |  |
| `run-20261026-164319-beepboop-list-945e0e` | S3 | 0.43.0 | stream init event | on | yes | yes (8) |  |
| `run-20261026-165441-beepboop-list-c8818e` | S3 | 0.43.0 | stream init event | on | yes | yes (9) |  |
| `run-20261026-190448-beepboop-list-232058` | S3 | 0.43.0 | stream init event | on | yes | yes (10) |  |
| `run-20261026-191031-beepboop-list-b24b24` | S3 | 0.43.0 | stream init event | on | yes | yes (11) |  |
| `run-20261026-205051-beepboop-list-713e07` | S3 | 0.43.0 | stream init event | on | yes | yes (12) |  |
| `run-20261026-213652-beepboop-list-31f750` | S3 | 0.43.0 | stream init event | on | yes | yes (13) |  |
| `run-20261026-214540-beepboop-list-9d5e07` | S3 | 0.43.0 | stream init event | on | yes | yes (14) |  |
| `run-20261027-020353-beepboop-list-18aac9` | S3 | 0.43.0 | stream init event | on | yes | yes (15) |  |
| `run-20261027-024440-beepboop-list-fa4ec4` | S3 | 0.43.0 | stream init event | on | yes | yes (16) |  |
| `run-20261027-025421-beepboop-list-1f19c0` | S3 | 0.43.0 | stream init event | on | yes | yes (17) |  |
| `run-20261027-030828-beepboop-list-9fd3e4` | S3 | 0.43.0 | run ledger | on | yes | yes (18) |  |
| `run-20261027-032405-beepboop-list-88c035` | S3 | 0.43.0 | stream init event | on | yes | yes (19) |  |
| `run-20261027-033635-beepboop-list-149b76` | S3 | 0.43.0 | stream init event | on | yes | yes (20) |  |
| `run-20261027-065425-beepboop-list-d4c19d` | S3 | 0.43.0 | run ledger | on | yes | yes (21) |  |
| `run-20261027-112413-beepboop-full-ba10f6` | S3 | 0.43.0 | run ledger | on | no | yes (22) |  |
| `run-20261027-162841-beepboop-list-36511a` | S3 | 0.43.0 | stream init event | on | yes | yes (23) |  |
| `run-20261027-185215-beepboop-list-1456d4` | S3 | 0.43.0 | stream init event | on | yes | yes (24) |  |
| `run-20261027-185806-beepboop-list-620a46` | S3 | 0.43.0 | stream init event | on | yes | yes (25) |  |
| `run-20261027-190707-beepboop-list-906233` | S3 | 0.43.0 | stream init event | on | yes | yes (26) |  |
| `run-20261027-191213-beepboop-list-fe15ad` | S3 | 0.43.0 | stream init event | on | yes | yes (27) |  |
| `run-20261027-191711-beepboop-list-7a746f` | S3 | 0.43.0 | stream init event | on | yes | yes (28) |  |
| `run-20261027-192337-beepboop-list-fa30c6` | S3 | 0.43.0 | stream init event | on | yes | yes (29) |  |
| `run-20261027-192721-beepboop-list-c7df54` | S3 | 0.43.0 | stream init event | on | yes | yes (30) |  |
| `run-20261027-193228-beepboop-list-e86e72` | S3 | 0.43.0 | stream init event | on | yes | no | started after collection stopped (rule 2) |
| `run-20261027-193707-beepboop-list-9d0fa8` | S3 | 0.43.0 | stream init event | on | yes | no | started after collection stopped (rule 2) |
| `run-20261027-194211-beepboop-list-1a207e` | S3 | 0.43.0 | run ledger | on | yes | no | started after collection stopped (rule 2) |
| `run-20261027-194732-beepboop-list-33ed46` | S3 | 0.43.0 | run ledger | on | yes | no | started after collection stopped (rule 2) |
| `run-20261027-195210-beepboop-list-acc4d9` | S3 | 0.43.0 | stream init event | on | yes | no | started after collection stopped (rule 2) |

Included: 30. Excluded: 7.

## Runs on the operator's machine that are not counted

Two interactive graft runs started in the window on the operator's machine: `run-20261024-163825-graft-FAFF-1397` and `run-20261024-215841-graft-FAFF-1400`. They are not beep-boop runs, and standalone interactive graft mints its run substrate only after its decision gates, so it captures no decisions by design (faff-graft Step 2). Their `events.jsonl` hold no decision records. They are listed here and not counted. Counting them in S2 would have moved the 30th included run two runs earlier, to `run-20261027-191711-beepboop-list-7a746f`; it adds no records either way.

## Joined pairs per kernel at the stop (count only)

Counted over every run in the table above, including the excluded ones; the per-stratum denominators are computed at grading.

| Kernel | Base records | Joined pairs |
|---|---|---|
| `next` | 48 | 37 |
| `eligible` | 27 | 10 |
| `run-done` | 1 | 1 |
| `run-start` | 5 | 0 |
| `run-outward` | 6 | 0 |
| `claim-verdict` | 0 | 0 |
| `park-verdict` | 0 | 0 |

Under the stopping rule, a gradeable kernel still at zero is reported as zero-denominator, and the gate can narrow to the kernels with evidence. `run-start` and `run-outward` have base records but no action marker on any of them, which points to an instrumentation gap rather than an absence of decisions.
