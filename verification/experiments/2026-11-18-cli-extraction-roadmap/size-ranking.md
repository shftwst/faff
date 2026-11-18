# Original skill sizes and delivered reductions

Baseline [`63e71d1f`](https://github.com/shftwst/faff/commit/63e71d1f6bfa5ea8ba6590861ab2fd76b7042f2d) is the first parent of the initial prose cut. Main [`626f6a3c`](https://github.com/shftwst/faff/commit/626f6a3caf5f216975323cfdb9007e0b06a522a0) includes #1233. The combined column applies all 22 open prompt patches in dependency order and matches the independently built integration tree. Each pair of sizes gives UTF-8 bytes and estimated tokens. Each complete file rounds up at four UTF-16 code units per token.

## Skills

| Skill | Original B / tokens | Main B / tokens | Combined B / tokens | Saved B / tokens | Changes |
|---|---:|---:|---:|---:|---|
| faff-graft | 179,464 / 44,495 | 168,608 / 41,822 | 161,986 / 40,187 | 17,478 / 4,308 | merged, [#1236](https://github.com/shftwst/faff/pull/1236), [#1240](https://github.com/shftwst/faff/pull/1240), [#1242](https://github.com/shftwst/faff/pull/1242), [#1248](https://github.com/shftwst/faff/pull/1248), [#1250](https://github.com/shftwst/faff/pull/1250), [#1254](https://github.com/shftwst/faff/pull/1254) |
| faff-beep-boop | 157,720 / 39,083 | 154,055 / 38,180 | 133,758 / 33,172 | 23,962 / 5,911 | merged, [#1234](https://github.com/shftwst/faff/pull/1234), [#1237](https://github.com/shftwst/faff/pull/1237), [#1243](https://github.com/shftwst/faff/pull/1243), [#1245](https://github.com/shftwst/faff/pull/1245), [#1246](https://github.com/shftwst/faff/pull/1246), [#1248](https://github.com/shftwst/faff/pull/1248), [#1249](https://github.com/shftwst/faff/pull/1249), [#1253](https://github.com/shftwst/faff/pull/1253) |
| faff-prep | 104,335 / 25,883 | 97,780 / 24,269 | 97,550 / 24,212 | 6,785 / 1,671 | merged, [#1243](https://github.com/shftwst/faff/pull/1243) |
| faff-tidy | 76,181 / 18,866 | 69,483 / 17,217 | 66,358 / 16,449 | 9,823 / 2,417 | merged, [#1239](https://github.com/shftwst/faff/pull/1239), [#1249](https://github.com/shftwst/faff/pull/1249) |
| faffter-dark-adversarial-review | 74,289 / 18,424 | 22,259 / 5,565 | 21,902 / 5,476 | 52,387 / 12,948 | merged, [#1240](https://github.com/shftwst/faff/pull/1240) |
| faff-plot | 45,906 / 11,342 | 41,576 / 10,284 | 40,601 / 10,041 | 5,305 / 1,301 | merged, [#1247](https://github.com/shftwst/faff/pull/1247) |
| faffter-dark-methodology-agile-delivery | 45,057 / 11,165 | 40,637 / 10,084 | 40,609 / 10,076 | 4,448 / 1,089 | merged, [#1239](https://github.com/shftwst/faff/pull/1239) |
| faffter-dark-spec-review | 40,715 / 10,117 | 37,882 / 9,418 | 15,961 / 3,974 | 24,754 / 6,143 | merged, [#1235](https://github.com/shftwst/faff/pull/1235), [#1238](https://github.com/shftwst/faff/pull/1238) |
| faffter-noon-methodology-thematic | 35,118 / 8,672 | 28,485 / 7,055 | 27,257 / 6,752 | 7,861 / 1,920 | merged, [#1239](https://github.com/shftwst/faff/pull/1239) |
| faff-wtf | 31,551 / 7,806 | 29,189 / 7,228 | 29,189 / 7,228 | 2,362 / 578 | merged |
| faffter-dark-concurrency-parallel | 25,766 / 6,386 | 20,682 / 5,133 | 20,682 / 5,133 | 5,084 / 1,253 | merged |
| faff-map | 24,782 / 6,049 | 23,486 / 5,732 | 22,953 / 5,603 | 1,829 / 446 | merged, [#1239](https://github.com/shftwst/faff/pull/1239) |
| faffidavit-rendering | 24,639 / 6,040 | 11,291 / 2,778 | 11,291 / 2,778 | 13,348 / 3,262 | merged |
| faff-jot | 23,456 / 5,804 | 18,798 / 4,661 | 18,380 / 4,557 | 5,076 / 1,247 | merged, [#1244](https://github.com/shftwst/faff/pull/1244) |
| faff-onboard | 23,185 / 5,733 | 17,929 / 4,437 | 16,836 / 4,165 | 6,349 / 1,568 | merged, [#1252](https://github.com/shftwst/faff/pull/1252) |
| faffter-dark-nlspec | 18,737 / 4,651 | 17,941 / 4,456 | 16,749 / 4,159 | 1,988 / 492 | merged, [#1241](https://github.com/shftwst/faff/pull/1241) |
| faffter-noon-concurrency-sequential | 18,605 / 4,613 | 13,229 / 3,288 | 13,229 / 3,288 | 5,376 / 1,325 | merged |
| faffter-noon-spec | 17,805 / 4,417 | 16,577 / 4,115 | 14,722 / 3,653 | 3,083 / 764 | merged, [#1241](https://github.com/shftwst/faff/pull/1241) |
| faffter-noon-evaluate | 16,192 / 4,024 | 15,592 / 3,878 | 12,487 / 3,108 | 3,705 / 916 | merged, [#1248](https://github.com/shftwst/faff/pull/1248) |
| faffter-noon-ship | 14,189 / 3,521 | 12,793 / 3,179 | 10,307 / 2,565 | 3,882 / 956 | merged, [#1251](https://github.com/shftwst/faff/pull/1251) |
| faffter-noon-review | 13,503 / 3,351 | 13,503 / 3,351 | 13,503 / 3,351 | 0 / 0 | Untouched |
| faff | 12,984 / 3,222 | 5,832 / 1,458 | 5,832 / 1,458 | 7,152 / 1,764 | merged |
| faffter-dark-authoring-adaptors | 12,540 / 3,108 | 11,876 / 2,945 | 7,928 / 1,968 | 4,612 / 1,140 | merged, [#1255](https://github.com/shftwst/faff/pull/1255) |
| faffter-noon-env-compose | 12,443 / 3,095 | 12,054 / 3,000 | 12,054 / 3,000 | 389 / 95 | merged |
| faffidavit-routing | 11,236 / 2,783 | 10,286 / 2,549 | 10,286 / 2,549 | 950 / 234 | merged |
| faffter-noon-env-code-interface | 9,862 / 2,454 | 9,400 / 2,339 | 9,400 / 2,339 | 462 / 115 | merged |
| faffter-noon-spec-review | 9,605 / 2,381 | 8,055 / 2,001 | 8,055 / 2,001 | 1,550 / 380 | merged |
| faffter-noon-intake | 7,715 / 1,913 | 7,594 / 1,883 | 7,594 / 1,883 | 121 / 30 | merged |
| faffter-noon-transport-private-network | 6,442 / 1,602 | 6,143 / 1,529 | 6,143 / 1,529 | 299 / 73 | merged |
| faffter-noon-architecture | 4,967 / 1,236 | 4,608 / 1,148 | 4,608 / 1,148 | 359 / 88 | merged |
| faffter-noon-prd | 4,517 / 1,123 | 2,516 / 629 | 2,516 / 629 | 2,001 / 494 | merged |
| faffter-noon-adr | 4,460 / 1,107 | 4,158 / 1,032 | 4,158 / 1,032 | 302 / 75 | merged |

## Shared references

| Reference | Original B / tokens | Main B / tokens | Combined B / tokens | Saved B / tokens | Changes |
|---|---:|---:|---:|---:|---|
| faff/references/kernel.md | 95,418 / 23,652 | 70,435 / 17,511 | 70,288 / 17,474 | 25,130 / 6,178 | merged, [#1241](https://github.com/shftwst/faff/pull/1241) |
| faff/references/autonomous.md | 39,233 / 9,729 | 36,702 / 9,109 | 35,378 / 8,781 | 3,855 / 948 | merged, [#1246](https://github.com/shftwst/faff/pull/1246), [#1249](https://github.com/shftwst/faff/pull/1249) |
| faff/references/methodology.md | 35,453 / 8,778 | 32,071 / 7,948 | 31,556 / 7,818 | 3,897 / 960 | merged, [#1239](https://github.com/shftwst/faff/pull/1239) |
| faff/references/l4.md | 26,377 / 6,538 | 26,700 / 6,621 | 26,301 / 6,524 | 76 / 14 | merged, [#1236](https://github.com/shftwst/faff/pull/1236) |
| faff/references/tracker.md | 24,185 / 5,994 | 18,258 / 4,533 | 18,258 / 4,533 | 5,927 / 1,461 | merged |
| faff/references/park.md | 14,619 / 3,627 | 13,771 / 3,417 | 11,206 / 2,785 | 3,413 / 842 | merged, [#1243](https://github.com/shftwst/faff/pull/1243) |
| faff/references/build.md | 12,080 / 2,993 | 9,689 / 2,405 | 9,689 / 2,405 | 2,391 / 588 | merged |
| faff/references/create.md | 9,145 / 2,265 | 7,429 / 1,840 | 2,232 / 557 | 6,913 / 1,708 | merged, [#1244](https://github.com/shftwst/faff/pull/1244) |
| faff/references/review.md | 7,605 / 1,887 | 7,238 / 1,796 | 7,238 / 1,796 | 367 / 91 | merged |

## All 41 files

Original **1,372,081 / 339,929**, main **1,176,590 / 291,823**, combined **1,097,030 / 272,136**. Main has saved **195,491 / 48,106**. The open PRs add **79,560 / 19,687**, yielding **275,051 / 67,793** in total.
