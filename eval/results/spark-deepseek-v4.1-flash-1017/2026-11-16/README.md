# spark/deepseek-v4.1-flash-1017: model evaluation result

- Date: 2026-11-16
- Driver: local
- Tier: mixed (see notes)
- Commit: 94c684bc
- Reference: claude-opus-5-5 (medium effort), eval/baselines/frontier.json
- Lanes: blackbox, live, format
- Notes: Black-box lane rebuilt from three raw captures: 20 kinds at 20 to 50 reps per case (a full sweep stopped part-way, 2026-11-15), 11 kinds at 5 reps per case, and refutation-spec at 3 reps per case. Live and format lanes come from one quick-tier run on 2026-11-16 (6 format samples per producer; finding-identity runs one pair per case). The confidence kind was measured with the rubric wording before FAFF-1482; with the reworded rubric it scores 0.99 over 120 reps.

Accuracy is the mean over a skill's eval kinds, each kind the mean of its cases' accuracy. Deltas compare only kinds the reference also measured.

## By role

| role | skills | kinds | model | reference | delta | reps |
|---|---|---|---|---|---|---|
| judge | 1 | 3 | 0.867 | 1.000 | -0.050 | 230 |
| producer | 14 | 25 | 0.987 | 0.996 | -0.009 | 1115 |
| reviewer | 4 | 8 | 0.894 | 0.958 | -0.078 | 377 |
| **all** | 19 | 36 | 0.957 | 0.988 | -0.026 | 1722 |

## By skill

Sorted from the largest deficit to the largest lead. A `*` after the reps marks a skill with a kind run at fewer than 10 reps per case.

| skill | role | kinds | model | reference | delta | format (model / ref) | reps | weakest kind |
|---|---|---|---|---|---|---|---|---|
| faffter-dark-spec-review | reviewer | 1 | 0.549 | 0.904 | -0.355 | 1.000 / 1.000 | 51* | refutation-spec 0.549 |
| faffter-noon-spec-review | reviewer | 1 | 0.933 | 1.000 | -0.067 | 1.000 / 1.000 | 15* | spec-verdict 0.933 |
| faffter-noon-review | reviewer | 3 | 0.958 | 1.000 | -0.063 | 1.000 / 1.000 | 31* | finding-identity 0.875 |
| faffter-dark-methodology-agile-delivery | producer | 1 | 0.900 | 0.960 | -0.060 | 1.000 / 1.000 | 50 | grouping 0.900 |
| faffter-noon-architecture | producer | 1 | 0.930 | 0.990 | -0.060 | 1.000 / 0.955 | 70 | architecture 0.930 |
| faffter-noon-evaluate | judge | 3 | 0.867 | 1.000 | -0.050 | 1.000 / 1.000 | 230* | holdout-live 0.700 |
| faffter-noon-spec | producer | 3 | 0.952 | 1.000 | -0.048 | 0.999 / 0.983 | 325* | confidence 0.857 |
| faffter-dark-adversarial-review | reviewer | 3 | 0.932 | 0.933 | -0.001 | 1.000 / 1.000 | 280 | refutation-code 0.857 |
| faff-jot | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 10* | shaping 1.000 |
| faff-map | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 0.925 | 10* | roadmap 1.000 |
| faff-plot | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 40 | decomposition 1.000 |
| faff-prep | producer | 3 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 135* | reconciliation 1.000 |
| faffidavit-routing | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 30* | routing 1.000 |
| faffter-noon-adr | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 40 | adr-gloss 1.000 |
| faffter-noon-intake | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 60 | modedetect 1.000 |
| faffter-noon-methodology-thematic | producer | 1 | 1.000 | 1.000 | +0.000 | 0.950 / 1.000 | 40 | ordering 1.000 |
| faffter-noon-prd | producer | 1 | 1.000 | 1.000 | +0.000 | 1.000 / 1.000 | 80 | prd-readiness 1.000 |
| faff-tidy | producer | 7 | 1.000 | 0.997 | +0.003 | 0.943 / 1.000 | 125* | dupe 1.000 |
| faffidavit-rendering | producer | 2 | 1.000 | 0.990 | +0.010 | 0.883 / 1.000 | 100 | gloss 1.000 |

## Not measured

These kinds are registered but have no result in this run.

| kind | skill | registry status |
|---|---|---|
| spec-judge-discrimination | faffter-dark-spec-review | designed |
| build-adjudication | faffter-dark-adversarial-review | designed |

## Producer output through the real parsers

| producer | samples | passed | note |
|---|---|---|---|
| spec | 6 | 6 |  |
| architecture | 6 | 6 |  |
| routing | 6 | 6 |  |
| adr | 6 | 5 | A title or a Self-review heading is a miss. The confidence line is advisory and not machine-parsed. |

