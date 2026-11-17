Current covered runtime prose totals **1,164,780 bytes / 288,949 estimated tokens** across 41 files. Today’s three implemented, statically reviewed batches remove **87,404 bytes / 21,462 estimated tokens** from the frozen accepted source. New model qualification remains outstanding.

Current filesystem bytes include the third-batch lint/wiring correction; frozen candidate sizes are not substituted for installed source.
| State | Bytes | Estimated tokens |
|---|---:|---:|
| Original a8509086 | 1,369,435 | 339,279 |
| Historical accepted a523734d | 1,252,184 | 310,411 |
| Current working source | 1,164,780 | 288,949 |

Historical qualified ledger reduction: **117,251 bytes / 28,868 estimated tokens**. Overall implemented reduction from original: **204,655 bytes / 50,330 estimated tokens**. These scopes are distinct; today’s delta has not been added to the accepted ledger.

| Today’s batch | Bytes removed | Estimated tokens removed |
|---|---:|---:|
| 1 | 50,259 | 12,351 |
| 2 | 22,248 | 5,458 |
| 3 | 14,897 | 3,653 |

Kernel pair remains held on one strict input mismatch, as reported by root. This accounting performs no regrade or waiver and claims no new model-qualified savings. Root owns remaining checks and commits.

Scope comes only from the 41 `prose-baseline.json` runtime paths, excluding tests, evidence and design files. Each file is measured from original/accepted Git bytes and current filesystem bytes; token estimates are `ceil(UTF-16 code units / 4)` per full file, then summed. They measure source size, not billing or repeated runtime loads. Original and accepted totals match the frozen ledger exactly.

Files ranked by original byte size, descending. “Touched” distinguishes historical qualified changes from today’s implemented changes. Each cell shows bytes / estimated tokens.

| Runtime prose path under plugin/skills/ | Original B /tokens | Accepted B /tokens | Current B /tokens | Touched | Today removed B /tokens |
|---|---:|---:|---:|---|---:|
| faff-graft/SKILL.md | 178,859 / 44,349 | 178,777 / 44,329 | 141,511 / 35,182 | historical + today | 37,266 / 9,147 |
| faff-beep-boop/SKILL.md | 157,720 / 39,083 | 149,485 / 37,063 | 138,518 / 34,378 | historical + today | 10,967 / 2,685 |
| faff-prep/SKILL.md | 104,335 / 25,883 | 104,335 / 25,883 | 87,112 / 21,638 | today | 17,223 / 4,245 |
| faff/references/kernel.md | 95,418 / 23,652 | 84,072 / 20,857 | 70,812 / 17,604 | historical + today | 13,260 / 3,253 |
| faff-tidy/SKILL.md | 76,181 / 18,866 | 76,028 / 18,828 | 67,340 / 16,696 | historical + today | 8,688 / 2,132 |
| faffter-dark-adversarial-review/SKILL.md | 74,897 / 18,574 | 22,259 / 5,565 | 22,259 / 5,565 | historical | 0 / 0 |
| faff-plot/SKILL.md | 45,906 / 11,342 | 45,580 / 11,262 | 45,580 / 11,262 | historical | 0 / 0 |
| faffter-dark-methodology-agile-delivery/SKILL.md | 45,057 / 11,165 | 44,947 / 11,138 | 44,947 / 11,138 | historical | 0 / 0 |
| faffter-dark-spec-review/SKILL.md | 40,715 / 10,117 | 40,496 / 10,063 | 40,496 / 10,063 | historical | 0 / 0 |
| faff/references/autonomous.md | 39,233 / 9,729 | 39,233 / 9,729 | 39,233 / 9,729 | unchanged | 0 / 0 |
| faff/references/methodology.md | 35,453 / 8,778 | 35,453 / 8,778 | 35,453 / 8,778 | unchanged | 0 / 0 |
| faffter-noon-methodology-thematic/SKILL.md | 35,118 / 8,672 | 29,418 / 7,281 | 29,418 / 7,281 | historical | 0 / 0 |
| faff-wtf/SKILL.md | 31,551 / 7,806 | 27,152 / 6,734 | 27,152 / 6,734 | historical | 0 / 0 |
| faff/references/l4.md | 26,377 / 6,538 | 26,377 / 6,538 | 26,377 / 6,538 | unchanged | 0 / 0 |
| faffter-dark-concurrency-parallel/SKILL.md | 25,766 / 6,386 | 25,665 / 6,361 | 25,665 / 6,361 | historical | 0 / 0 |
| faff-map/SKILL.md | 24,782 / 6,049 | 24,535 / 5,988 | 24,535 / 5,988 | historical | 0 / 0 |
| faffidavit-rendering/SKILL.md | 24,639 / 6,040 | 11,288 / 2,777 | 11,288 / 2,777 | historical | 0 / 0 |
| faff/references/tracker.md | 24,185 / 5,994 | 24,185 / 5,994 | 24,185 / 5,994 | unchanged | 0 / 0 |
| faff-jot/SKILL.md | 23,456 / 5,804 | 23,456 / 5,804 | 23,456 / 5,804 | unchanged | 0 / 0 |
| faff-onboard/SKILL.md | 23,185 / 5,733 | 23,039 / 5,697 | 23,039 / 5,697 | historical | 0 / 0 |
| faffter-dark-nlspec/SKILL.md | 18,823 / 4,671 | 18,819 / 4,671 | 18,819 / 4,671 | historical | 0 / 0 |
| faffter-noon-concurrency-sequential/SKILL.md | 18,605 / 4,613 | 18,512 / 4,590 | 18,512 / 4,590 | historical | 0 / 0 |
| faffter-noon-spec/SKILL.md | 17,919 / 4,444 | 17,847 / 4,427 | 17,847 / 4,427 | historical | 0 / 0 |
| faffter-noon-evaluate/SKILL.md | 16,192 / 4,024 | 15,939 / 3,961 | 15,939 / 3,961 | historical | 0 / 0 |
| faff/references/park.md | 14,619 / 3,627 | 14,619 / 3,627 | 14,619 / 3,627 | unchanged | 0 / 0 |
| faffter-noon-ship/SKILL.md | 14,189 / 3,521 | 14,027 / 3,481 | 14,027 / 3,481 | historical | 0 / 0 |
| faffter-noon-review/SKILL.md | 13,503 / 3,351 | 8,045 / 2,008 | 8,045 / 2,008 | historical | 0 / 0 |
| faff/SKILL.md | 12,984 / 3,222 | 5,832 / 1,458 | 5,832 / 1,458 | historical | 0 / 0 |
| faffter-dark-authoring-adaptors/SKILL.md | 12,540 / 3,108 | 12,321 / 3,054 | 12,321 / 3,054 | historical | 0 / 0 |
| faffter-noon-env-compose/SKILL.md | 12,443 / 3,095 | 12,232 / 3,043 | 12,232 / 3,043 | historical | 0 / 0 |
| faff/references/build.md | 12,080 / 2,993 | 12,080 / 2,993 | 12,080 / 2,993 | unchanged | 0 / 0 |
| faffidavit-routing/SKILL.md | 11,236 / 2,783 | 11,144 / 2,760 | 11,144 / 2,760 | historical | 0 / 0 |
| faffter-noon-env-code-interface/SKILL.md | 9,862 / 2,454 | 9,602 / 2,389 | 9,602 / 2,389 | historical | 0 / 0 |
| faffter-noon-spec-review/SKILL.md | 9,605 / 2,381 | 8,055 / 2,001 | 8,055 / 2,001 | historical | 0 / 0 |
| faff/references/create.md | 9,145 / 2,265 | 9,145 / 2,265 | 9,145 / 2,265 | unchanged | 0 / 0 |
| faffter-noon-intake/SKILL.md | 7,715 / 1,913 | 5,689 / 1,412 | 5,689 / 1,412 | historical | 0 / 0 |
| faffter-noon-transport-private-network/SKILL.md | 6,442 / 1,602 | 6,250 / 1,555 | 6,250 / 1,555 | historical | 0 / 0 |
| faffter-noon-architecture/SKILL.md | 4,967 / 1,236 | 4,787 / 1,192 | 4,787 / 1,192 | historical | 0 / 0 |
| faff/references/review.md | 4,756 / 1,186 | 4,756 / 1,186 | 4,756 / 1,186 | unchanged | 0 / 0 |
| faffter-noon-prd/SKILL.md | 4,517 / 1,123 | 2,465 / 617 | 2,465 / 617 | historical | 0 / 0 |
| faffter-noon-adr/SKILL.md | 4,460 / 1,107 | 4,238 / 1,052 | 4,238 / 1,052 | historical | 0 / 0 |

Exact per-file SHA256 bindings, input hashes, scope checks and measurement-time HEAD are in [SOURCE-REDUCTION-STATUS.json](SOURCE-REDUCTION-STATUS.json), SHA256 `171ed4cd1425edf9a40a45d7526b7a7704c3ebef657559842457afa1c1da493e`. No tests, models, harness changes, source edits or commits were performed for this report.
