# spark/deepseek-v4.1-flash-1017: model evaluation result

- Date: 2026-11-17
- Driver: local
- Tier: mixed (see notes)
- Commit: 5c5dd242
- Reference: claude-opus-5-5 (medium effort), eval/baselines/frontier.json
- Lanes: blackbox, live, format
- Notes: Thin kinds rerun at 20 reps per case (refutation-spec 5 reps; its other cases from the earlier 3-rep sweep are replaced). Format lane at 12 samples per producer. finding-identity unchanged at one pair per case. Black-box kinds not listed as rerun come from the 2026-11-15 sweep at 20 to 50 reps per case. The confidence kind predates the FAFF-1482 rubric.

Accuracy is the mean over a skill's eval kinds, each kind the mean of its cases' accuracy. Deltas compare only kinds the reference also measured.

## By role

| role | skills | kinds | model | reference | delta | reps |
|---|---|---|---|---|---|---|
| judge | 1 | 3 | 0.842 | 1.000 | -0.050 | 260 |
| producer | 14 | 25 | 0.984 | 0.996 | -0.012 | 1490 |
| reviewer | 4 | 8 | 0.903 | 0.958 | -0.068 | 501 |
| **all** | 19 | 36 | 0.954 | 0.988 | -0.027 | 2251 |

## By skill

Sorted from the largest deficit to the largest lead. A `*` after the reps marks a skill with a kind run at fewer than 10 reps per case.

| skill | role | kinds | model | reference | delta | format (model / ref) | reps | weakest kind |
|---|---|---|---|---|---|---|---|---|
| faffter-dark-spec-review | reviewer | 1 | 0.553 | 0.904 | -0.351 | 1.000 / 1.000 | 85* | refutation-spec 0.553 |
| faffter-noon-spec | producer | 3 | 0.936 | 1.000 | -0.064 | 0.999 / 0.983 | 370 | confidence 0.857 |
| faffter-noon-review | reviewer | 3 | 0.958 | 1.000 | -0.063 | 1.000 / 1.000 | 76* | finding-identity 0.875 |
| faffter-dark-methodology-agile-delivery | producer | 1 | 0.900 | 0.960 | -0.060 | 1.000 / 1.000 | 50 | grouping 0.900 |
| faffter-noon-architecture | producer | 1 | 0.930 | 0.990 | -0.060 | 1.000 / 0.955 | 70 | architecture 0.930 |
| faffter-noon-evaluate | judge | 3 | 0.842 | 1.000 | -0.050 | 1.000 / 1.000 | 260 | holdout-live 0.625 |
| faff-tidy | producer | 7 | 0.996 | 0.997 | -0.001 | 0.964 / 1.000 | 260 | splittable 0.975 |
| faffter-dark-adversarial-review | reviewer | 3 | 0.932 | 0.933 | -0.001 | 1.000 / 1.000 | 280 | refutation-code 0.857 |
| faff-jot | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 40 | shaping 1.000 |
| faff-map | producer | 1 | 1.000 | 1.000 | +0.000 | 0.975 / 0.925 | 40 | roadmap 1.000 |
| faff-plot | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 40 | decomposition 1.000 |
| faff-prep | producer | 3 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 180 | reconciliation 1.000 |
| faffidavit-routing | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 120 | routing 1.000 |
| faffter-noon-adr | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 40 | adr-gloss 1.000 |
| faffter-noon-intake | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 60 | modedetect 1.000 |
| faffter-noon-methodology-thematic | producer | 1 | 1.000 | 1.000 | +0.000 | 0.950 / 1.000 | 40 | ordering 1.000 |
| faffter-noon-prd | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 80 | prd-readiness 1.000 |
| faffter-noon-spec-review | reviewer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 60 | spec-verdict 1.000 |
| faffidavit-rendering | producer | 2 | 1.000 | 0.990 | +0.010 | 0.883 / 1.000 | 100 | gloss 1.000 |
| **all** | | 36 | 0.954 | 0.988 | -0.027 | | 2251 | |

## By role, per skill

The same table split by role, to show whether one role is a clear hit or miss.

### judge

| skill | kinds | model | reference | delta | format (model / ref) | reps | weakest kind |
|---|---|---|---|---|---|---|---|
| faffter-noon-evaluate | 3 | 0.842 | 1.000 | -0.050 | 1.000 / 1.000 | 260 | holdout-live 0.625 |
| **judge total** | 3 | 0.842 | 1.000 | -0.050 | | 260 | |

### producer

| skill | kinds | model | reference | delta | format (model / ref) | reps | weakest kind |
|---|---|---|---|---|---|---|---|
| faffter-noon-spec | 3 | 0.936 | 1.000 | -0.064 | 0.999 / 0.983 | 370 | confidence 0.857 |
| faffter-dark-methodology-agile-delivery | 1 | 0.900 | 0.960 | -0.060 | 1.000 / 1.000 | 50 | grouping 0.900 |
| faffter-noon-architecture | 1 | 0.930 | 0.990 | -0.060 | 1.000 / 0.955 | 70 | architecture 0.930 |
| faff-tidy | 7 | 0.996 | 0.997 | -0.001 | 0.964 / 1.000 | 260 | splittable 0.975 |
| faff-jot | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 40 | shaping 1.000 |
| faff-map | 1 | 1.000 | 1.000 | +0.000 | 0.975 / 0.925 | 40 | roadmap 1.000 |
| faff-plot | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 40 | decomposition 1.000 |
| faff-prep | 3 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 180 | reconciliation 1.000 |
| faffidavit-routing | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 120 | routing 1.000 |
| faffter-noon-adr | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 40 | adr-gloss 1.000 |
| faffter-noon-intake | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 60 | modedetect 1.000 |
| faffter-noon-methodology-thematic | 1 | 1.000 | 1.000 | +0.000 | 0.950 / 1.000 | 40 | ordering 1.000 |
| faffter-noon-prd | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 80 | prd-readiness 1.000 |
| faffidavit-rendering | 2 | 1.000 | 0.990 | +0.010 | 0.883 / 1.000 | 100 | gloss 1.000 |
| **producer total** | 25 | 0.984 | 0.996 | -0.012 | | 1490 | |

### reviewer

| skill | kinds | model | reference | delta | format (model / ref) | reps | weakest kind |
|---|---|---|---|---|---|---|---|
| faffter-dark-spec-review | 1 | 0.553 | 0.904 | -0.351 | 1.000 / 1.000 | 85* | refutation-spec 0.553 |
| faffter-noon-review | 3 | 0.958 | 1.000 | -0.063 | 1.000 / 1.000 | 76* | finding-identity 0.875 |
| faffter-dark-adversarial-review | 3 | 0.932 | 0.933 | -0.001 | 1.000 / 1.000 | 280 | refutation-code 0.857 |
| faffter-noon-spec-review | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 60 | spec-verdict 1.000 |
| **reviewer total** | 8 | 0.903 | 0.958 | -0.068 | | 501 | |

## Not measured

These kinds are registered but have no result in this run.

| kind | skill | registry status |
|---|---|---|
| spec-judge-discrimination | faffter-dark-spec-review | designed |
| build-adjudication | faffter-dark-adversarial-review | designed |

## Producer output through the real parsers

| producer | samples | passed | note |
|---|---|---|---|
| spec | 12 | 11 |  |
| architecture | 12 | 12 |  |
| routing | 12 | 12 |  |
| adr | 12 | 10 | A title or a Self-review heading is a miss. The confidence line is advisory and not machine-parsed. |

