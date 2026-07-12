# Changelog

## [0.10.0](https://github.com/shftwst/faff/compare/faff--v0.9.0...faff--v0.10.0) (2026-07-12)


### Features

* **FAFF-194:** deterministic guards for machine-checkable adversarial findings + output-format enforcement ([#321](https://github.com/shftwst/faff/issues/321)) ([3a03dc8](https://github.com/shftwst/faff/commit/3a03dc8e15d34cac6eb596f0534a3461c6a108ee))
* **FAFF-355:** dedicated single-value heartbeat file — close the N-writer ledger race ([#317](https://github.com/shftwst/faff/issues/317)) ([f81e819](https://github.com/shftwst/faff/commit/f81e8199dfa337101b8df5f5aa139cf01bd6cfbe))
* **FAFF-361:** review-call.mjs prepends the model-attribution header itself ([#322](https://github.com/shftwst/faff/issues/322)) ([27fc571](https://github.com/shftwst/faff/commit/27fc571717b9fdd92e0830f1271e68375bdb5e4b))
* **FAFF-397:** blocking run-end ground-truth reconcile ([#318](https://github.com/shftwst/faff/issues/318)) ([2bf69c6](https://github.com/shftwst/faff/commit/2bf69c609a82811cba6d7d7a5f585d08dc1c45dd))
* **FAFF-403:** retry-later/awaiting-review disposition for review-provider outage ([#320](https://github.com/shftwst/faff/issues/320)) ([b0560fd](https://github.com/shftwst/faff/commit/b0560fd14f19803d425439127260ed8c608a71fc))
* **FAFF-405:** add unavailable as a first-class review-verdict signal ([#319](https://github.com/shftwst/faff/issues/319)) ([23307e6](https://github.com/shftwst/faff/commit/23307e66adb1e1b5084c002bfe19a681b1c20969))
* **FAFF-421:** migrate read-skill methodology calls to producer dispatch ([#315](https://github.com/shftwst/faff/issues/315)) ([52bbef5](https://github.com/shftwst/faff/commit/52bbef51142aedb44257d6875be6dca4917dddb3))
* **FAFF-422:** local-engine lane values v1 — one-shot dispatch for methodology/intake ([#316](https://github.com/shftwst/faff/issues/316)) ([1539f3d](https://github.com/shftwst/faff/commit/1539f3d4f480e1808c03b91daa637b4c2f01dcde))
* **FAFF-427:** wire the ADR-0048 per-model × per-class price map into budget.cost; make a dollar ceiling the default L4 governor ([#324](https://github.com/shftwst/faff/issues/324)) ([037148c](https://github.com/shftwst/faff/commit/037148c62f705bdcedf97c97ce842f36e056ae67))


### Bug Fixes

* **FAFF-414:** review-call.mjs advances the fallback chain on a non-transient throw (HTTP 400/413), not abort to EXIT.OTHER ([#323](https://github.com/shftwst/faff/issues/323)) ([c9306d7](https://github.com/shftwst/faff/commit/c9306d7a9a9e2d8c06da00ad7656baac6910b034))
* **FAFF-428:** refuse or loudly degrade L4 budget metering when transcripts are unavailable ([#325](https://github.com/shftwst/faff/issues/325)) ([bc02ff6](https://github.com/shftwst/faff/commit/bc02ff6c2dbbba02b7d946f3300ec906ab835f29))
* **FAFF-443:** source --global skill links from the main checkout, flag worktree-sourced links in doctor ([#312](https://github.com/shftwst/faff/issues/312)) ([518cf45](https://github.com/shftwst/faff/commit/518cf45ed807e64e35a6bbd2602937b80568c884))

## [0.9.0](https://github.com/shftwst/faff/compare/faff--v0.8.0...faff--v0.9.0) (2026-07-10)


### Features

* **FAFF-210:** native gemini / anthropic adaptors for the adversarial-review backend ([#294](https://github.com/shftwst/faff/issues/294)) ([7c56dca](https://github.com/shftwst/faff/commit/7c56dca018b78ea438884633111a87fa488aa0a6))
* **FAFF-260:** PRD-admissibility LLM validator — slot-skill, gateway entry, L4 run-start wiring ([#274](https://github.com/shftwst/faff/issues/274)) ([e52c9ae](https://github.com/shftwst/faff/commit/e52c9aee5d1f8fdf992f805074af73d6018bb267))
* **FAFF-312:** L4 run governance — run-done terminates, Sentry interrupts, budget backstops (count-caps banned) ([#265](https://github.com/shftwst/faff/issues/265)) ([02df7d0](https://github.com/shftwst/faff/commit/02df7d0740a48fbac43ce5005f34815781d3754d))
* **FAFF-329:** prevent + cheaply recover the graft mid-review stall ([#273](https://github.com/shftwst/faff/issues/273)) ([d4e80b5](https://github.com/shftwst/faff/commit/d4e80b5d5420ea849619204264582563c382fe4a))
* **FAFF-334:** per-issue build-model routing by spec confidence ([#268](https://github.com/shftwst/faff/issues/268)) ([4b364e7](https://github.com/shftwst/faff/commit/4b364e793ba17ec567aaa85f1764ac0e419d9169))
* **FAFF-346:** wire the architecture slot call-site (prep-time proposal, holdout consumption) ([#283](https://github.com/shftwst/faff/issues/283)) ([ae2cc9c](https://github.com/shftwst/faff/commit/ae2cc9c1ec7087a18015d63f698110c09ed09c9b))
* **FAFF-350:** faff merge-gate — mechanical merge floor + branch-protection preflight ([#264](https://github.com/shftwst/faff/issues/264)) ([3f82c02](https://github.com/shftwst/faff/commit/3f82c02284ee0d5531691cf45ff0f49776933a76))
* **FAFF-353:** escalate Phase-2 adversarial criticals on any autonomous run + annotate full-chain outage ([#271](https://github.com/shftwst/faff/issues/271)) ([04eb5c4](https://github.com/shftwst/faff/commit/04eb5c4db2efc1fb2a87c92383617a9db253dde4))
* **FAFF-356:** optional (decides: &lt;owner&gt;) tag on Punt markers + per-owner routing ([#270](https://github.com/shftwst/faff/issues/270)) ([d843871](https://github.com/shftwst/faff/commit/d84387154153f5e219bc7ab6ea3db65100b4081f))
* **FAFF-357:** faff economics — per-run unit economics (cost-per-shipped-issue) ([#269](https://github.com/shftwst/faff/issues/269)) ([0770de5](https://github.com/shftwst/faff/commit/0770de59177cda1b49c7f7c73db98fe808500260))
* **FAFF-365:** merge-gate re-checks PR state on a non-zero forge-merge exit ([#302](https://github.com/shftwst/faff/issues/302)) ([511070e](https://github.com/shftwst/faff/commit/511070e09e988aa8902e5fc8c4725938af853828))
* **FAFF-368:** re-validate ADR numbering at the merge gate, renumber on collision ([#288](https://github.com/shftwst/faff/issues/288)) ([a42614b](https://github.com/shftwst/faff/commit/a42614b9a09b5b48a3a7c6a49f4133900ee29d5b))
* **FAFF-371:** validate + harden the env lane against a bounded rootless engine ([#278](https://github.com/shftwst/faff/issues/278)) ([abbfff9](https://github.com/shftwst/faff/commit/abbfff9a4a1a22048bf759d5f87aca37bdcc7172))
* **FAFF-372:** dispatch interactive L2 producers as Agent subagents + per-producer model lanes ([#276](https://github.com/shftwst/faff/issues/276)) ([6e6fa4e](https://github.com/shftwst/faff/commit/6e6fa4e1ff8321e4ffa53d6d85142b3e3f8c85e4))
* **FAFF-373:** corrective-integrity fail-safe gate (probe + degrade-to-Channel-D) ([#277](https://github.com/shftwst/faff/issues/277)) ([833350c](https://github.com/shftwst/faff/commit/833350cce8cf782801ee4831e7b12b3cd4e15322))
* **FAFF-376:** pin observed head sha through merge-gate + fail-closed on partial gh API ([#281](https://github.com/shftwst/faff/issues/281)) ([5dc0366](https://github.com/shftwst/faff/commit/5dc03661c820dbabe8f01ac6e5fa2cd91536eb8b))
* **FAFF-379:** make the L4 lights-out floor:worktree_isolation a real check ([#280](https://github.com/shftwst/faff/issues/280)) ([2bcbfe9](https://github.com/shftwst/faff/commit/2bcbfe924f149243905f243761dee04922ed7335))
* **FAFF-382:** single-source the worktree-root resolver + make the checked isolation root bind ([#289](https://github.com/shftwst/faff/issues/289)) ([7cf1cc5](https://github.com/shftwst/faff/commit/7cf1cc5daad4652ab08b485f099e52f2e6c8027c))
* **FAFF-398:** fail-closed on mandatory review-chain exhaustion ([#284](https://github.com/shftwst/faff/issues/284)) ([ca03cb9](https://github.com/shftwst/faff/commit/ca03cb929e88990cb383f86124785e051ee101f7))
* **FAFF-401:** derive mandatory review from the run ledger, not a prose flag hop ([#308](https://github.com/shftwst/faff/issues/308)) ([aa22c93](https://github.com/shftwst/faff/commit/aa22c932ecd8f7537186d1e6f2cd1eb97a9e1e5c))
* **FAFF-402:** build-complete checkpoint + push-at-build-complete resumability ([#287](https://github.com/shftwst/faff/issues/287)) ([dc2d402](https://github.com/shftwst/faff/commit/dc2d40225f5b8b8a66e10c884828fcf712457036))
* **FAFF-407:** token-usage breakdown spike — analysis + report ([#290](https://github.com/shftwst/faff/issues/290)) ([1f2414c](https://github.com/shftwst/faff/commit/1f2414cd8543d69af5b899ebcade5195503369f2))
* **FAFF-408:** add opt-in --tokens flag to events append for per-phase token attribution ([#291](https://github.com/shftwst/faff/issues/291)) ([bd2e309](https://github.com/shftwst/faff/commit/bd2e3097f85483be57c49b695568e1b1e6464bd4))
* **FAFF-409:** measure per-tool MCP cache-amplification via reconciling cache_read attribution ([#292](https://github.com/shftwst/faff/issues/292)) ([d055a56](https://github.com/shftwst/faff/commit/d055a56d5ea2d7e400a8c7da046ca1c453191a8d))
* **FAFF-410:** faff economics --by class|model|mcp|day breakdown ([#293](https://github.com/shftwst/faff/issues/293)) ([10748a0](https://github.com/shftwst/faff/commit/10748a08be97f15a1a81637020b1ade420b44ff4))
* **FAFF-411:** build-model downgrade calibration spike — Phase 1 retrospective predictor ([#299](https://github.com/shftwst/faff/issues/299)) ([5995146](https://github.com/shftwst/faff/commit/5995146e0ab218b1e5114cca422dbc78498d0aab))
* **FAFF-415:** record reasoning-effort per dispatch, surface via economics --by effort ([#296](https://github.com/shftwst/faff/issues/296)) ([3bc020c](https://github.com/shftwst/faff/commit/3bc020c008f99c1bd42f6d173206c307d3c18515))
* **FAFF-416:** per-slot {model, effort} routing — the effort lever ([#297](https://github.com/shftwst/faff/issues/297)) ([9bf87c1](https://github.com/shftwst/faff/commit/9bf87c135702b11e9f2d19d0621c630c2d7d38aa))
* **FAFF-418:** quality/outcome telemetry — faff quality + issue-outcome gate/rework tags ([#298](https://github.com/shftwst/faff/issues/298)) ([48db49e](https://github.com/shftwst/faff/commit/48db49e72b052f24d874a57af5ba25fa78715374))
* **FAFF-424:** derive merge-gate level from the run ledger; refuse a contradicting --level ([#300](https://github.com/shftwst/faff/issues/300)) ([dad4ea9](https://github.com/shftwst/faff/commit/dad4ea9d04091a740cd642ab968f83904c962c7a))
* **FAFF-434:** hooks-ensure owns a PreToolUse fence on raw gh pr merge ([#307](https://github.com/shftwst/faff/issues/307)) ([fd91a30](https://github.com/shftwst/faff/commit/fd91a308844ddb23590ba1f838c9cd2867d44dc5))


### Bug Fixes

* **FAFF-337:** pin the canonical beep-boop run-id format everywhere ([#306](https://github.com/shftwst/faff/issues/306)) ([0a3d0f5](https://github.com/shftwst/faff/commit/0a3d0f5d7540778ecc67280dbf8e550239cd5d0c))
* **FAFF-364:** reject a malformed budget.until / --until at resolution and the lights-out preflight ([#304](https://github.com/shftwst/faff/issues/304)) ([8ea221c](https://github.com/shftwst/faff/commit/8ea221cf4ace682adfc3c16d861d351e75965796))
* **FAFF-369:** correct merge-gate CI classification on Actions-only repos (+ FAFF-366) ([#272](https://github.com/shftwst/faff/issues/272)) ([ce85976](https://github.com/shftwst/faff/commit/ce85976d922cf74b5832a44166dab89e25c1e157))
* **FAFF-375:** harden merge-gate flag surface — drop --admin, fence --human-override/--allow-no-ci on a real TTY ([#285](https://github.com/shftwst/faff/issues/285)) ([955d5b2](https://github.com/shftwst/faff/commit/955d5b26f8b0b0b6701931135bfccb54ae2802df))
* **FAFF-377:** close the unbacked-recipe L4 dial-coherence bypass ([#303](https://github.com/shftwst/faff/issues/303)) ([6371aa2](https://github.com/shftwst/faff/commit/6371aa2315530ba8b5febd0bc9e0f4bd5e3f9bd6))
* **FAFF-378:** gate the L4 appetite pin on run liveness (runIsHeld) ([#279](https://github.com/shftwst/faff/issues/279)) ([cadb4a8](https://github.com/shftwst/faff/commit/cadb4a88987bcebb17402d2763bff1f2db132723))
* **FAFF-420:** bind readHoldout to the run-dir and freshness-check it ([#301](https://github.com/shftwst/faff/issues/301)) ([d3c16c9](https://github.com/shftwst/faff/commit/d3c16c91d8c7c5058f643ba65b0f11e6ec85111e))
* **FAFF-425:** governance CLIs fail closed on their own read faults ([#305](https://github.com/shftwst/faff/issues/305)) ([036b05a](https://github.com/shftwst/faff/commit/036b05aa73bb7fea24546efb5dd0db361f87291c))
* **FAFF-439:** pin a turn-safe build-dispatch posture across the concurrency executors ([#310](https://github.com/shftwst/faff/issues/310)) ([eadd68a](https://github.com/shftwst/faff/commit/eadd68ad454a07227708f8e6fd9e33d5ffd57b66))
* **FAFF-442:** worktree-safe parity harness — materialise the baseline via git archive ([#311](https://github.com/shftwst/faff/issues/311)) ([c95329a](https://github.com/shftwst/faff/commit/c95329aedec205883e618be617ed4b3132f458f0))

## [0.8.0](https://github.com/shftwst/faff/compare/faff--v0.7.0...faff--v0.8.0) (2026-07-04)


### Features

* **FAFF-106:** faff effects — escaped-side-effect detection via a declared-effects ledger ([#236](https://github.com/shftwst/faff/issues/236)) ([2070681](https://github.com/shftwst/faff/commit/2070681af1ce99461006754fd0812e1faf36a78e))
* **FAFF-240:** roadmap eval kind — faff-map roadmap-synthesis coverage ([#249](https://github.com/shftwst/faff/issues/249)) ([1547e9f](https://github.com/shftwst/faff/commit/1547e9f63432b4752d91083fcabd0bd34b176e14))
* **FAFF-241:** specqual eval kind — generated lite-nlspec body-quality coverage ([#246](https://github.com/shftwst/faff/issues/246)) ([dadf126](https://github.com/shftwst/faff/commit/dadf126a4ace885d984f5e08dc9f099814319857))
* **FAFF-244:** declare faffter-dark-authoring-adaptors judgement_seam: none ([#251](https://github.com/shftwst/faff/issues/251)) ([1a940b6](https://github.com/shftwst/faff/commit/1a940b6acecaf5362002ad60daef703b1104c52a))
* **FAFF-271:** command-replay seed strategy for the env compose redis datastore ([#243](https://github.com/shftwst/faff/issues/243)) ([4f22a82](https://github.com/shftwst/faff/commit/4f22a825f8e58fe5e494fd733374d1e328e43dc2))
* **FAFF-272:** mongoimport seed strategy for the env compose mongo datastore ([#242](https://github.com/shftwst/faff/issues/242)) ([25e910b](https://github.com/shftwst/faff/commit/25e910bbc375ddd9b884b4ec50537d1346e1838f))
* **FAFF-273:** S3-compatible object store (MinIO) env provisioning + object-upload seed ([#245](https://github.com/shftwst/faff/issues/245)) ([2e8e0ef](https://github.com/shftwst/faff/commit/2e8e0ef7e23ceade56b8fea1478bd57ca4c2a75c))
* **FAFF-278:** Sentry-2 corrective authority — ADR-0039 GO-narrow subtractive stop-and-redispatch ([4721e1f](https://github.com/shftwst/faff/commit/4721e1f97a827d47bf51e79a37507e63d5831251))
* **FAFF-282:** spec-verdict eval kind — spec-review verdict admission-gate coverage ([#248](https://github.com/shftwst/faff/issues/248)) ([50e0f32](https://github.com/shftwst/faff/commit/50e0f329c914e69a7f9c533e683a1947fd31666b))
* **FAFF-283:** adversarial-dimension eval coverage — refutation-spec + refutation-code grader KINDs ([#252](https://github.com/shftwst/faff/issues/252)) ([7ffae5c](https://github.com/shftwst/faff/commit/7ffae5c1c981ac96d62dd145302378dd49bf9d67))
* **FAFF-284:** holdout evaluator eval coverage (holdout grader KIND) ([#247](https://github.com/shftwst/faff/issues/247)) ([596e00d](https://github.com/shftwst/faff/commit/596e00d3acb261ce16d0f41c85a874818108fd03))
* **FAFF-285:** architecture-proposal eval coverage (faffter-noon-architecture) ([#244](https://github.com/shftwst/faff/issues/244)) ([91f65ba](https://github.com/shftwst/faff/commit/91f65ba9fdb7858efad9c9101d6f2219f2e62de6))
* **FAFF-286:** adr-gloss eval KIND + env-compose declared-deterministic ([#250](https://github.com/shftwst/faff/issues/250)) ([52e38c4](https://github.com/shftwst/faff/commit/52e38c469623fa681df52faf3861da7bc7a98a8f))
* **FAFF-297:** lights-out adversarial review — escalate Phase-2 critical to needs-human ([#260](https://github.com/shftwst/faff/issues/260)) ([ab829b7](https://github.com/shftwst/faff/commit/ab829b744aff989ff6f1e1415ebc1f590ed08521))
* **FAFF-298:** L4 dial-coherence preflight — refuse reckless unattended slot+gates combinations ([#238](https://github.com/shftwst/faff/issues/238)) ([f6c3284](https://github.com/shftwst/faff/commit/f6c3284d5bcc4753a828f46fdee5742bcafb2dfa))
* **FAFF-304:** admissible warns when prose DONE items will become evaluator punts ([#233](https://github.com/shftwst/faff/issues/233)) ([472a626](https://github.com/shftwst/faff/commit/472a626c78ee180289186cc08301129e958edf7d))
* **FAFF-308:** make appetite level-scoped — L4 forces full via a single resolution seam ([#239](https://github.com/shftwst/faff/issues/239)) ([068936e](https://github.com/shftwst/faff/commit/068936eb62f626df9fe57c0381321d601c502b58))
* **FAFF-309:** wire the code-blind holdout step into the L4 delivery path + flip guardrail to enforced ([#237](https://github.com/shftwst/faff/issues/237)) ([7d2110a](https://github.com/shftwst/faff/commit/7d2110aebc81292ea4ea1c9e190101d2c45e772f))
* **FAFF-311:** wire the code-blind holdout at the per-issue graft gate (4th L4 merge-floor condition) ([#257](https://github.com/shftwst/faff/issues/257)) ([31c3219](https://github.com/shftwst/faff/commit/31c3219b2503f1942ffb8c051e250703bbc3a4de))
* **FAFF-315:** per-lane model selection — models: config surface + dispatch wiring ([#258](https://github.com/shftwst/faff/issues/258)) ([1161f81](https://github.com/shftwst/faff/commit/1161f81e233c9fe9f3878e04374e20467e02c38f))


### Bug Fixes

* **FAFF-303:** reconcile env app tier against repo compose + resolve build context ([#229](https://github.com/shftwst/faff/issues/229)) ([e03bd8c](https://github.com/shftwst/faff/commit/e03bd8c20550583059f2438032b63fbd09c878fd))
* **FAFF-303:** reconcile env datastore auth-env + order app behind it ([#235](https://github.com/shftwst/faff/issues/235)) ([ab25088](https://github.com/shftwst/faff/commit/ab2508823561754513d8b68da1c4952cf9f68fc6))
* **FAFF-305:** lights-out banner distinguishes reachable from enforced guardrails ([#231](https://github.com/shftwst/faff/issues/231)) ([55a2942](https://github.com/shftwst/faff/commit/55a2942b9a91d021d89455d64411cab13ec21236))
* **FAFF-306:** bound the scenarios section so dod classify and admissible cannot over-capture past a shallower DONE heading ([#232](https://github.com/shftwst/faff/issues/232)) ([c15421b](https://github.com/shftwst/faff/commit/c15421b9a2a8afd915acb4a24883438c5b4c56ab))
* **FAFF-315:** gitignore .env / .env.* (secret-leak root-cause fix) ([#259](https://github.com/shftwst/faff/issues/259)) ([b5c673d](https://github.com/shftwst/faff/commit/b5c673d29d75a9c37339409b8afe0f353ef5913f))

## [0.7.0](https://github.com/shftwst/faff/compare/faff--v0.6.0...faff--v0.7.0) (2026-06-30)


### Features

* **FAFF-225:** faff lights-out — the L4 lights-out entry point / runner ([#223](https://github.com/shftwst/faff/issues/223)) ([a740408](https://github.com/shftwst/faff/commit/a7404080d9a238ef7f9d10cf0164b73c7d3ce5c3))
* **FAFF-270:** live compose provisioning — env actually stands up, tested ([#207](https://github.com/shftwst/faff/issues/207)) ([94c3b51](https://github.com/shftwst/faff/commit/94c3b515d117b0165c959d991b187ee86c79d1cb))
* **FAFF-277:** wire holdout verdicts into the PRD-coverage gate — faff holdout verdicts → faff prdr coverage --dod-verdicts ([#213](https://github.com/shftwst/faff/issues/213)) ([db53ef6](https://github.com/shftwst/faff/commit/db53ef643d864465b59877112f8774388dea0e2e))
* **FAFF-280:** judgement-seam declaration + shared seam→KIND registry ([#212](https://github.com/shftwst/faff/issues/212)) ([785adac](https://github.com/shftwst/faff/commit/785adac387c99204214ea193b2e73c3cbdde50f4))
* **FAFF-281:** lintable eval-coverage gate in validate-adapters + DoD/authoring rules ([#224](https://github.com/shftwst/faff/issues/224)) ([19d5257](https://github.com/shftwst/faff/commit/19d5257926cfd10b03e7eb3b8d6ae8ff2f554f0b))
* **FAFF-289:** faff audit &lt;run-id&gt; read-only run-reconstruction forensics view ([#215](https://github.com/shftwst/faff/issues/215)) ([ea65f4e](https://github.com/shftwst/faff/commit/ea65f4e9bd922fa41b56cdd6cdaa1ee2dcaa475c))
* **FAFF-290:** re-ground-before-gate freshness contract across gating chokepoints ([#216](https://github.com/shftwst/faff/issues/216)) ([7a727da](https://github.com/shftwst/faff/commit/7a727da4ee20d3e86f7781e579f353c02e4fd560))
* **FAFF-291:** topology-write-authority dial in the gateway + ADR 0035 ([#218](https://github.com/shftwst/faff/issues/218)) ([8088be3](https://github.com/shftwst/faff/commit/8088be39a73b9feca1b702466259f0ba3cef2ff9))
* **FAFF-292:** agile lens re-homes gating chains by structural reparent, not view-only ([#219](https://github.com/shftwst/faff/issues/219)) ([0e69418](https://github.com/shftwst/faff/commit/0e694189fb7c1a7008c29fbf5d7271909328ee73))
* **FAFF-293:** agile-lens default landing for new work = project-less Backlog ([#220](https://github.com/shftwst/faff/issues/220)) ([6b1956d](https://github.com/shftwst/faff/commit/6b1956db3a56393e59391077ba65b11b87118ede))
* **FAFF-294:** split agile-lens scope rule into lost vs rehomed scope ([#221](https://github.com/shftwst/faff/issues/221)) ([1d90dd5](https://github.com/shftwst/faff/commit/1d90dd57cc420a94e0d5b7ea168b561ce73ebc7a))
* **FAFF-295:** agile lens diagnoses + converts thematic projects to outcome-led ([#222](https://github.com/shftwst/faff/issues/222)) ([198195f](https://github.com/shftwst/faff/commit/198195faf82c027b59b6e74fc00b78234a02ca03))
* **FAFF-296:** rename default methodology lens → thematic; reserve structural for tracker topology ([#217](https://github.com/shftwst/faff/issues/217)) ([8982ed6](https://github.com/shftwst/faff/commit/8982ed6eaa901a9098f9c8adcb3c5787235cac8e))
* **FAFF-34:** evaluator-lane holdout harness (v1a) — holdout-verdict contract + evaluator slot ([#209](https://github.com/shftwst/faff/issues/209)) ([e817d33](https://github.com/shftwst/faff/commit/e817d330ff0e499fcdb3e7b08fa14d55bfac129d))
* **FAFF-49:** faff sentry — live-run derailment detection + hard kill-switch ([#214](https://github.com/shftwst/faff/issues/214)) ([b674f6d](https://github.com/shftwst/faff/commit/b674f6d9848541d849d14830bd9cded8fc26d54c))


### Bug Fixes

* **FAFF-250:** session-scope + liveness gate for the prepcheck Stop hook ([#211](https://github.com/shftwst/faff/issues/211)) ([efe6148](https://github.com/shftwst/faff/commit/efe6148579e13cf16bb1afcabc25c5ad3c000129))
* **FAFF-299:** faff doctor flags a dangling skill symlink as unhealthy ([#225](https://github.com/shftwst/faff/issues/225)) ([396f3da](https://github.com/shftwst/faff/commit/396f3da3b5d02240352defff59c21584644becf0))
* **FAFF-300:** recognise numbered scenario headings in faff admissible ([#226](https://github.com/shftwst/faff/issues/226)) ([e2c1140](https://github.com/shftwst/faff/commit/e2c11407ae795af20fd214fb15385040e93c37ea))
* **FAFF-301:** harden the AC5 sentry test against a time-of-day flake ([#227](https://github.com/shftwst/faff/issues/227)) ([3804a08](https://github.com/shftwst/faff/commit/3804a08149b4e83f56b2ea2f5c5510842fbc1a60))
* **FAFF-302:** harden budget.test.mjs against a time-of-day flake via a hermetic clock seam ([#228](https://github.com/shftwst/faff/issues/228)) ([a315844](https://github.com/shftwst/faff/commit/a315844d71ccce208e55f6240d4e232c7cc3a97d))

## [0.6.0](https://github.com/shftwst/faff/compare/faff--v0.5.0...faff--v0.6.0) (2026-06-28)


### Features

* **FAFF-11:** cost-ordered engineering-quality gate ladder before review/CI ([#156](https://github.com/shftwst/faff/issues/156)) ([1f1e9e9](https://github.com/shftwst/faff/commit/1f1e9e98142ebe3b5c1255fca3b286c9afd68f36))
* **FAFF-125:** mechanical pre-worktree eligibility gate in autonomous graft ([#154](https://github.com/shftwst/faff/issues/154)) ([65bb11d](https://github.com/shftwst/faff/commit/65bb11df1bcb4d0ca2d2b9d508640e00f723d9c7))
* **FAFF-201:** enforce per-issue context isolation — subagent-per-build dispatch ([#166](https://github.com/shftwst/faff/issues/166)) ([3c632f8](https://github.com/shftwst/faff/commit/3c632f8af8ce16403265b526b7a3ebd906380965))
* **FAFF-212:** intake-provenance guard — graft-time precondition + intake-record/intakecheck CLI ([#155](https://github.com/shftwst/faff/issues/155)) ([99a98b2](https://github.com/shftwst/faff/commit/99a98b23f59775429ea47157615fd79123ef7601))
* **FAFF-215:** autonomous build-order dependency inference — producer→consumer conflict-analysis heuristic ([#151](https://github.com/shftwst/faff/issues/151)) ([b63eeb4](https://github.com/shftwst/faff/commit/b63eeb495b1fb9eadb10e3aaf417eca0c4269f63))
* **FAFF-218:** tracker-own eligibility labels — CLI refuses to write faff-automate/faff-automation-hold ([#157](https://github.com/shftwst/faff/issues/157)) ([42767ef](https://github.com/shftwst/faff/commit/42767efa7d32af9f35880fcb5afe4e22a578b776))
* **FAFF-219:** faff contain — subtree-of-mandate containment primitive ([#159](https://github.com/shftwst/faff/issues/159)) ([f4336aa](https://github.com/shftwst/faff/commit/f4336aa7cdacb52b3d2a601741d7b17f91c4bb5e))
* **FAFF-220:** provenance schema 1→2 — initiated audit field ([363ca8a](https://github.com/shftwst/faff/commit/363ca8a4469c949ad14df7f199ed224dfe725316))
* **FAFF-221:** wire containment at the autonomous filing chokepoints + outward-new-root surfacing ([#162](https://github.com/shftwst/faff/issues/162)) ([708ce5e](https://github.com/shftwst/faff/commit/708ce5e53076f2ace184e19dc9d6f683e44d1347))
* **FAFF-222:** generalize faff contain to container-level mandates (issue|project|initiative) ([7b86b3c](https://github.com/shftwst/faff/commit/7b86b3cba4ad730da86b75890e3ff683180dfd2a))
* **FAFF-223:** human-side intake provenance — eligibility-gesture basis + --interactive bypass ([#161](https://github.com/shftwst/faff/issues/161)) ([bf6a3fc](https://github.com/shftwst/faff/commit/bf6a3fcba24c1c324f4298a7786675db3029eb6a))
* **FAFF-224:** lights-out admissibility gate — faff admissible + call-site integrations ([#187](https://github.com/shftwst/faff/issues/187)) ([0167f1f](https://github.com/shftwst/faff/commit/0167f1f0dba35fde2d97670c63833c6164276f0d))
* **FAFF-231:** infra-profile repo-mining acquirer + public profile slot ([#189](https://github.com/shftwst/faff/issues/189)) ([720d0e7](https://github.com/shftwst/faff/commit/720d0e7eea7d9880fd3f77ffe21e63e70a231d15))
* **FAFF-232:** adversarial-review fallback chain of backends ([#172](https://github.com/shftwst/faff/issues/172)) ([bedc1e0](https://github.com/shftwst/faff/commit/bedc1e0390f9566aa03a9c9d9c3bb8e7f4b17464))
* **FAFF-234:** faff heartbeat primitive + boundary-tick wiring for long graft sub-steps ([#177](https://github.com/shftwst/faff/issues/177)) ([9c18bbd](https://github.com/shftwst/faff/commit/9c18bbd734d54571539611b3059ae7a5c5fe6e93))
* **FAFF-237:** CI guardrail — lint-cli-doc keeps docs/guide/cli.md in sync with the CLI subcommand set ([#176](https://github.com/shftwst/faff/issues/176)) ([de130d2](https://github.com/shftwst/faff/commit/de130d27542c02e3a09c8c9b3ce5de417d750041))
* **FAFF-238:** self-contained-prose guard (slice 1) — faff lint-refs + docs/guide relocation ([#174](https://github.com/shftwst/faff/issues/174)) ([397b6a0](https://github.com/shftwst/faff/commit/397b6a050ba57b3993e69e814f6c223b601c9bdd))
* **FAFF-245:** faff prdr — product-requirements decision-record mechanic ([#183](https://github.com/shftwst/faff/issues/183)) ([288fc2b](https://github.com/shftwst/faff/commit/288fc2beb0d24871f95ba77ba7d0272a2c607b9c))
* **FAFF-246:** agile lens re-homes a stream's gating chain into its order ([#190](https://github.com/shftwst/faff/issues/190)) ([e1f9e5c](https://github.com/shftwst/faff/commit/e1f9e5c5dfaf131a02f4f9314aa84b0104b8100c))
* **FAFF-248:** faff project-next predicate + faff-tidy state-coherence sweep ([#188](https://github.com/shftwst/faff/issues/188)) ([0ad0da0](https://github.com/shftwst/faff/commit/0ad0da0b9d30cb860f7cc803a3ed9c0a7f9c7696))
* **FAFF-251:** prdr-author methodology named output — L3 proposes, L4 self-defines ([#195](https://github.com/shftwst/faff/issues/195)) ([6656bc6](https://github.com/shftwst/faff/commit/6656bc60ad6f1709437faff944eaa54706ee3062))
* **FAFF-252:** faff prd CLI — product-axis PRD artifact + lifecycle ([#179](https://github.com/shftwst/faff/issues/179)) ([9444358](https://github.com/shftwst/faff/commit/9444358662829f79e408b27e8f37fba4d60c6beb))
* **FAFF-253:** prd-readiness contract — deterministic admissibility-verdict shape gate ([#184](https://github.com/shftwst/faff/issues/184)) ([16b5ba2](https://github.com/shftwst/faff/commit/16b5ba27444ff44d01297e063983348b1fd41436))
* **FAFF-254:** born-verifiable PRD stop-conditions form-check ([#186](https://github.com/shftwst/faff/issues/186)) ([7ac29c4](https://github.com/shftwst/faff/commit/7ac29c42a7f425b6467fd97b0c96a508b556e007))
* **FAFF-255:** two-gate bound — faff prdr admit + prdr-admission contract ([#192](https://github.com/shftwst/faff/issues/192)) ([4f246a6](https://github.com/shftwst/faff/commit/4f246a61fb58634b3a8a199e268c6ab8d30caa7a))
* **FAFF-256:** PRDR upper/YAGNI gate — two-phase arbitration + prdr-yagni contract ([#196](https://github.com/shftwst/faff/issues/196)) ([0306a3f](https://github.com/shftwst/faff/commit/0306a3ff33733de450da1e031cafd86a6d1d4aa9))
* **FAFF-257:** lower/coverage gate + prd-satisfied roll-up — the product-done predicate ([#197](https://github.com/shftwst/faff/issues/197)) ([b7d6a23](https://github.com/shftwst/faff/commit/b7d6a239c5e763cf744878432e5eaca4dc470dfa))
* **FAFF-262:** native YAML block-sequence arrays in the config parser ([#191](https://github.com/shftwst/faff/issues/191)) ([05d2e3c](https://github.com/shftwst/faff/commit/05d2e3c89947054862dd8375fb5329a1a22089d3))
* **FAFF-265:** spec-review-verdict contract + spec_review slot scaffold ([#198](https://github.com/shftwst/faff/issues/198)) ([e27dd90](https://github.com/shftwst/faff/commit/e27dd900a5851bf2e63858800632e640d88bfb71))
* **FAFF-266:** L1–L3 single-pass spec reviewer, wired prep→build-admission ([#200](https://github.com/shftwst/faff/issues/200)) ([6d7b205](https://github.com/shftwst/faff/commit/6d7b20521c36bbb97f6833a4611040508c46fb3c))
* **FAFF-267:** L4 adversarial per-lens spec refuters in the spec_review slot ([#201](https://github.com/shftwst/faff/issues/201)) ([5124e1b](https://github.com/shftwst/faff/commit/5124e1bc75a34be67a59e7e730a08b4b12961107))
* **FAFF-268:** change-surface lens selection for the spec_review cost-gate ([#202](https://github.com/shftwst/faff/issues/202)) ([12eb85a](https://github.com/shftwst/faff/commit/12eb85a38d7855aa0f6d162b60170d6d25df3caf))
* **FAFF-26:** infra-profile schema + faff profile CLI (slice 1 of 2) ([#167](https://github.com/shftwst/faff/issues/167)) ([9e13882](https://github.com/shftwst/faff/commit/9e13882f6efc31128242768b08092ef3f6da7771))
* **FAFF-27:** generative architecture & infra proposal — architecture-proposal contract + slot ([#205](https://github.com/shftwst/faff/issues/205)) ([c014be8](https://github.com/shftwst/faff/commit/c014be8b2aa4259be1f47063d08b270e76583161))
* **FAFF-30:** digital-twin & environment provisioning — env-handle contract + env slot (v1a) ([#206](https://github.com/shftwst/faff/issues/206)) ([b9e99bd](https://github.com/shftwst/faff/commit/b9e99bda9a8bb984452d5f71d5f543130cdf174b))
* **FAFF-31:** fixtures dataset-manifest schema + faff fixtures CLI (slice 1) ([#178](https://github.com/shftwst/faff/issues/178)) ([1c4d51d](https://github.com/shftwst/faff/commit/1c4d51d24b5fb39178b9ab56273638ef9c0a5058))
* **FAFF-35:** faff events CLI — structured run-event log substrate (slice 1) ([#181](https://github.com/shftwst/faff/issues/181)) ([e1f6b7e](https://github.com/shftwst/faff/commit/e1f6b7eefc79beb7e86c17ec7e231e1e1e6a53e0))
* **FAFF-36:** run cost / compute budgeting — BudgetEnvelope + faff budget check ([#165](https://github.com/shftwst/faff/issues/165)) ([17241e4](https://github.com/shftwst/faff/commit/17241e4edfd42f9774ac82775f93caac789b59c4))
* **FAFF-38:** faff run-done terminating-condition predicate + run-termination contract ([#199](https://github.com/shftwst/faff/issues/199)) ([1b5524c](https://github.com/shftwst/faff/commit/1b5524c36a56c1aaea4a8f63b06bb07e08e56bca))
* **FAFF-42:** faff container-check — assert the ADR-0010 blast-radius boundary ([#180](https://github.com/shftwst/faff/issues/180)) ([b9413a2](https://github.com/shftwst/faff/commit/b9413a2fdd64fb80acd0815ae20c9bc9cebe1572))
* **FAFF-87:** within-run convergence loop — drain execution-discovered scope same-run (L4) ([#204](https://github.com/shftwst/faff/issues/204)) ([3b0e6d8](https://github.com/shftwst/faff/commit/3b0e6d8e78b2bd6b5e6824ac7e4e3bba752305ed))


### Bug Fixes

* **FAFF-205:** session-scope runcheck Stop hook so a parallel beep-boop run can't false-block ([#153](https://github.com/shftwst/faff/issues/153)) ([4504b19](https://github.com/shftwst/faff/commit/4504b197442e27209f91fcd13bcbe8d30c5bb9a0))
* **FAFF-227:** bounded transient-transport retry in review-call.mjs, no unmapped exit 1 ([#163](https://github.com/shftwst/faff/issues/163)) ([1dc8ed8](https://github.com/shftwst/faff/commit/1dc8ed8702eaeeb5d899dab14a5f3fff90cc3ad8))
* **FAFF-228:** map HTTP 429 rate-limit to a documented exit (+ correct timeout-bound doc) ([#168](https://github.com/shftwst/faff/issues/168)) ([532ae14](https://github.com/shftwst/faff/commit/532ae14b7a9ea551df9f34c4c1575f8f658f76c5))
* **FAFF-229:** attribute child agent-*.jsonl by owning sessionId, not bare mtime ([#169](https://github.com/shftwst/faff/issues/169)) ([2659cbf](https://github.com/shftwst/faff/commit/2659cbfe79a5e1e442c5c3e7c29426f0182fa5f5))
* **FAFF-233,FAFF-235:** heartbeat-authoritative runcheck liveness + foreign sessions warn, never hard-block ([#171](https://github.com/shftwst/faff/issues/171)) ([a2b6271](https://github.com/shftwst/faff/commit/a2b62710599d1b512a4e0bb8282ff70e6f9ff6cf))
* **FAFF-247:** map sources cycle + cross-project blockers from always-fires backlog-diagnostics ([#182](https://github.com/shftwst/faff/issues/182)) ([f5421b5](https://github.com/shftwst/faff/commit/f5421b5a1e01c28da0c6860925bea3ece8dfb523))

## [0.5.0](https://github.com/shftwst/faff/compare/faff--v0.4.1...faff--v0.5.0) (2026-06-22)


### Features

* **FAFF-115:** lean the duplicated entry-preamble boilerplate (9 skills) ([#117](https://github.com/shftwst/faff/issues/117)) ([1205f8a](https://github.com/shftwst/faff/commit/1205f8af983754a33e95bd128d3f87fc8eff9480))
* **FAFF-116:** terseness + cruft pass over the orchestration skills ([#118](https://github.com/shftwst/faff/issues/118)) ([2f6169a](https://github.com/shftwst/faff/commit/2f6169a56a680e822ada3a0b2c38095c14025f78))
* **FAFF-117:** terseness + cruft pass over the slot skills ([#119](https://github.com/shftwst/faff/issues/119)) ([671187d](https://github.com/shftwst/faff/commit/671187dcc6547b97ca735b869231d076b9b86cd0))
* **FAFF-120:** skill-authoring charter + CLAUDE.md auto-load + lint rules ([#130](https://github.com/shftwst/faff/issues/130)) ([53a04ac](https://github.com/shftwst/faff/commit/53a04acba831f4feeb74c1b2022a984dc507c9fd))
* **FAFF-16:** faff adr CLI + ADR promotion (record-and-promote v1) ([#131](https://github.com/shftwst/faff/issues/131)) ([80c34fe](https://github.com/shftwst/faff/commit/80c34fec2530a486d57897ed5f6594f83c7dcf06))
* **FAFF-171:** prompt-token budget gate in CI (advisory ratchet) ([#114](https://github.com/shftwst/faff/issues/114)) ([149185a](https://github.com/shftwst/faff/commit/149185a90953d5c062ab4785dfb3f18c2d8f5640))
* **FAFF-172:** delegation-conformance lint in validate-adapters ([#116](https://github.com/shftwst/faff/issues/116)) ([538915f](https://github.com/shftwst/faff/commit/538915f3c79d6e0967a91c7883a6833bf2e28ef7))
* **FAFF-175:** Linear MCP call census from session transcripts ([#138](https://github.com/shftwst/faff/issues/138)) ([e8b9bec](https://github.com/shftwst/faff/commit/e8b9bec504175356f1530c1a2540bfcf9ef90b2e))
* **FAFF-178:** faff prepcheck — Stop-hook backstop for same-turn spec attach ([#128](https://github.com/shftwst/faff/issues/128)) ([8f6d9ae](https://github.com/shftwst/faff/commit/8f6d9aefdbc33c975110edc2c82038afa1b0cd13))
* **FAFF-179:** terseness + cruft pass over the gateway body ([#120](https://github.com/shftwst/faff/issues/120)) ([050ed13](https://github.com/shftwst/faff/commit/050ed1398ebb4bae69b7ce7959acdc8a1056c356))
* **FAFF-180:** proportionate judgement-eval gate with selectable drivers (smart/local/frontier) ([#127](https://github.com/shftwst/faff/issues/127)) ([a5d7578](https://github.com/shftwst/faff/commit/a5d7578678e3956140f52dc3483b70d69e0010fe))
* **FAFF-181:** migrate sub-skills to canonical gateway pointers; cut Legacy contract aliases ([#121](https://github.com/shftwst/faff/issues/121)) ([a6435cd](https://github.com/shftwst/faff/commit/a6435cd92e43ae07912dcc66bc0e94fc109c3225))
* **FAFF-182:** default-aware config get via a CLI DEFAULTS registry ([#124](https://github.com/shftwst/faff/issues/124)) ([c5c718c](https://github.com/shftwst/faff/commit/c5c718c180c8ba1b192a1b0e9f1d6eb9ac6cc5ea))
* **FAFF-183:** robust adversarial-review backend call (review-call.mjs) ([#122](https://github.com/shftwst/faff/issues/122)) ([513ac1b](https://github.com/shftwst/faff/commit/513ac1b1935aca8bec4c356cc645a142c920188b))
* **FAFF-184:** collapse-and-log review-comment policy for iterated reviews ([#135](https://github.com/shftwst/faff/issues/135)) ([a88fefd](https://github.com/shftwst/faff/commit/a88fefd4b8d3ac87be88e3f5fdb5110bb4d29ee7))
* **FAFF-185:** reconcile review timing — pre-PR review, tracker findings surface, PR opens at Step 9b ([#136](https://github.com/shftwst/faff/issues/136)) ([e83f15c](https://github.com/shftwst/faff/commit/e83f15c0ee28968a4809d5a7332b7f3662786a2e))
* **FAFF-187:** faff label add|remove — mechanical CLI op for control-label mutation ([#140](https://github.com/shftwst/faff/issues/140)) ([9874bc1](https://github.com/shftwst/faff/commit/9874bc16eb0bfb08f9f3740ef851d7e849dc1a45))
* **FAFF-190:** faff doctor install-health check ([#125](https://github.com/shftwst/faff/issues/125)) ([fc3ad81](https://github.com/shftwst/faff/commit/fc3ad81a88e18bb2d7880e241f2ae135b4f02c10))
* **FAFF-192:** faff hooks-ensure — deterministic, repeatable Stop-hook registration ([#129](https://github.com/shftwst/faff/issues/129)) ([3a2ee15](https://github.com/shftwst/faff/commit/3a2ee1528f73352e83a78e2a499ad0bf777f507b))
* **FAFF-193:** rendering adaptor lead-with-the-model + surface-the-concrete rules + gloss eval ([#139](https://github.com/shftwst/faff/issues/139)) ([e2371ba](https://github.com/shftwst/faff/commit/e2371ba823a202e1e081462987eea441c8780008))
* **FAFF-195:** nlspec Failure-modes section + load-bearing-model WHY principle ([#137](https://github.com/shftwst/faff/issues/137)) ([8fe338c](https://github.com/shftwst/faff/commit/8fe338cb4bc907a1341aec70663902cb0f2e4df0))
* **FAFF-196:** adr producer slot + faffter-noon-adr ([#132](https://github.com/shftwst/faff/issues/132)) ([aa41e3d](https://github.com/shftwst/faff/commit/aa41e3d29df57b9c566e03a4bd32ec4f8b99de8e))
* **FAFF-197:** faff adr supersede + supersession validation ([#133](https://github.com/shftwst/faff/issues/133)) ([b1565e7](https://github.com/shftwst/faff/commit/b1565e7644369594d18301bc75c2f27d539e454b))
* **FAFF-198:** ADR L3 — offer supersession when a new ADR contradicts a live one ([#147](https://github.com/shftwst/faff/issues/147)) ([39b35f4](https://github.com/shftwst/faff/commit/39b35f42081fadaeb52cd7e97b742f3e7dbef696))
* **FAFF-200:** install-health auto-heal — faff sync + doctor-at-entry + hooks-ensure normalization ([#134](https://github.com/shftwst/faff/issues/134)) ([b8d02e4](https://github.com/shftwst/faff/commit/b8d02e49b442f7bc4167cd5a3d772f7075f161fb))
* **FAFF-202:** comment-identity contract for collapse-and-log update-in-place ([#143](https://github.com/shftwst/faff/issues/143)) ([63e9f8a](https://github.com/shftwst/faff/commit/63e9f8a519f9eecf126824ba19e461b6d93eab57))
* **FAFF-203:** add explanatory-order eval kind (covers Edit A — lead-with-the-model) ([#145](https://github.com/shftwst/faff/issues/145)) ([91277bd](https://github.com/shftwst/faff/commit/91277bdcea27df4662437ed964042c602b2d458c))
* **FAFF-209:** OpenAI-compatible transport for adversarial review (NVIDIA/vLLM/OpenRouter) ([#148](https://github.com/shftwst/faff/issues/148)) ([17094e0](https://github.com/shftwst/faff/commit/17094e0c7fee2921f8ea64f3ce54381d3aa6c62c))
* **FAFF-213:** fail loud when adversarial-review host is the unconfigured localhost default ([#150](https://github.com/shftwst/faff/issues/150)) ([3ffb9d4](https://github.com/shftwst/faff/commit/3ffb9d49075b6594cb9c5775364392965a61fa5c))


### Bug Fixes

* **FAFF-126:** scoped faff worktree-prune — own-only, never repo-wide ([#142](https://github.com/shftwst/faff/issues/142)) ([89bb7f3](https://github.com/shftwst/faff/commit/89bb7f371609bf1fcab8325e8d6feb01177e5105))
* **FAFF-186:** copy .faffrc.yaml into graft worktrees ([#123](https://github.com/shftwst/faff/issues/123)) ([7b59dcc](https://github.com/shftwst/faff/commit/7b59dcca1ee2dabf2577191b3031bcc5fb334b9d))
* **FAFF-204:** faff sync resolves repo root for link-skills.sh via layered resolver ([#141](https://github.com/shftwst/faff/issues/141)) ([b7e46c7](https://github.com/shftwst/faff/commit/b7e46c7aa33fb255f5ce51718e673d5d42e1cb49))
* **FAFF-207:** harden review-findings comment-identity match to structured-match ([#146](https://github.com/shftwst/faff/issues/146)) ([ed2e68c](https://github.com/shftwst/faff/commit/ed2e68c4bc96ff0132299c1cf966a9ec8cb014dd))
* **FAFF-208:** config resolves via main worktree when a build worktree lacks .faffrc.yaml ([#149](https://github.com/shftwst/faff/issues/149)) ([ee68da5](https://github.com/shftwst/faff/commit/ee68da5ae739ee09ebef8928d3db00f935fb111e))

## [0.4.1](https://github.com/shftwst/faff/compare/faff--v0.4.0...faff--v0.4.1) (2026-06-18)


### Bug Fixes

* **FAFF-164:** install-mode-portable cross-skill delegation convention ([#110](https://github.com/shftwst/faff/issues/110)) ([b14b8e5](https://github.com/shftwst/faff/commit/b14b8e545b4ea13df4f84216b0db0f46cdc874bc))

## [0.4.0](https://github.com/shftwst/faff/compare/faff--v0.3.0...faff--v0.4.0) (2026-06-16)


### Features

* **FAFF-10:** BDD scenarios for main spec objectives (born-verifiable) ([#64](https://github.com/shftwst/faff/issues/64)) ([820aaa5](https://github.com/shftwst/faff/commit/820aaa59ce48b14f57eed0bfe2a5f27bba5e42d2))
* **FAFF-118:** response-side token discipline in skill output contracts ([#65](https://github.com/shftwst/faff/issues/65)) ([d07683a](https://github.com/shftwst/faff/commit/d07683adfc0620bbea17e502a95fb86a224b7f9c))
* **FAFF-124:** slim, refresh & re-frame the root README around L3 ([#63](https://github.com/shftwst/faff/issues/63)) ([00b4dbd](https://github.com/shftwst/faff/commit/00b4dbdbf912a6676ffd9e37a2e9f9554ffe271a))
* **FAFF-130:** judgement-eval harness + deterministic grader (measured run split to FAFF-131) ([#72](https://github.com/shftwst/faff/issues/72)) ([d7dc737](https://github.com/shftwst/faff/commit/d7dc7370aae22b598787de746f8f06db444b1312))
* **FAFF-132:** local-model (ollama) eval driver preset + --driver selector ([#73](https://github.com/shftwst/faff/issues/73)) ([14d20a2](https://github.com/shftwst/faff/commit/14d20a246f71dc158780c1b10823c7e76eb682c6))
* **FAFF-133:** load the repo plugin into the isolated eval run (--bare --plugin-dir) ([#74](https://github.com/shftwst/faff/issues/74)) ([41330b8](https://github.com/shftwst/faff/commit/41330b84b82161958d1c8f17875bd472ae4b1c02))
* **FAFF-134:** inline faff-tidy's real judgement rubric into the eval prompt ([#75](https://github.com/shftwst/faff/issues/75)) ([94749b1](https://github.com/shftwst/faff/commit/94749b1941384289b4b6df0378a484d050086936))
* **FAFF-135:** live driver for the skill-run harness (faithful judgement lane) ([#76](https://github.com/shftwst/faff/issues/76)) ([590a04e](https://github.com/shftwst/faff/commit/590a04ecd9d9f9606fd2beaff9e5223bdaf550bf))
* **FAFF-136:** direct ollama /api/chat model for the live driver (fast local lane) ([#77](https://github.com/shftwst/faff/issues/77)) ([28844b4](https://github.com/shftwst/faff/commit/28844b4a4bfd45623f774820d3032a3a4a04e236))
* **FAFF-137:** path-B graded-run enablers (think/options + envelope classify-fallback + format-adherence) ([#78](https://github.com/shftwst/faff/issues/78)) ([896af47](https://github.com/shftwst/faff/commit/896af47ae7544a0208063793c07d6835eedd888a))
* **FAFF-138:** frontier eval auth — forward OAuth creds + drop --bare ([#79](https://github.com/shftwst/faff/issues/79)) ([a19f03b](https://github.com/shftwst/faff/commit/a19f03bf6de1dc5f6f8b554e3aacf3ae4519ecac))
* **FAFF-144:** direct-ollama eval driver — run the orchestrator over /api/chat at local speed ([#83](https://github.com/shftwst/faff/issues/83)) ([c9cd21c](https://github.com/shftwst/faff/commit/c9cd21cd62dd06b14da54e249f8040a0f6cdab3f))
* **FAFF-146:** confidence + decision-marker judgement-eval kinds (+ reconciliation design) ([#89](https://github.com/shftwst/faff/issues/89)) ([68d57c7](https://github.com/shftwst/faff/commit/68d57c76978e103b588caf91142aa1abe6580200))
* **FAFF-147:** add splittable judgement-eval kind to eval/ ([#88](https://github.com/shftwst/faff/issues/88)) ([9325a55](https://github.com/shftwst/faff/commit/9325a551c73b50008301c97d4f1c5bc9fdcd386b))
* **FAFF-148:** verdict-revert eval kind — revert-test discrimination of described findings ([#90](https://github.com/shftwst/faff/issues/90)) ([0aec301](https://github.com/shftwst/faff/commit/0aec301a5cbe0215bdf1bb2aaa27a5d7a570e465))
* **FAFF-149:** routing eval kind — six-verdict assignment over an assembled fixture ([#91](https://github.com/shftwst/faff/issues/91)) ([d257147](https://github.com/shftwst/faff/commit/d257147f6d5d1584908aa2d686aff5458814ccf3))
* **FAFF-150:** modedetect judgement-eval kind (jot/intake mode detection) ([#93](https://github.com/shftwst/faff/issues/93)) ([d51c5f3](https://github.com/shftwst/faff/commit/d51c5f3e8389bb84b92199d05df493d5706b9b7d))
* **FAFF-152:** faff park-history seam + repeat-park scripted-driver test ([#94](https://github.com/shftwst/faff/issues/94)) ([2791efb](https://github.com/shftwst/faff/commit/2791efb61cd07f753e6527955be2946ee412df64))
* **FAFF-153:** chain-gap judgement-eval kind (full-pipeline prose-parsing half) ([#104](https://github.com/shftwst/faff/issues/104)) ([4fbb22b](https://github.com/shftwst/faff/commit/4fbb22bdb0ed1f61c85e8c68770c7d4f74003c2f))
* **FAFF-154:** reconciliation judgement-eval — ThreadFixture cases + live-driver runner + dry-smoke ([#95](https://github.com/shftwst/faff/issues/95)) ([219af7c](https://github.com/shftwst/faff/commit/219af7c72be26f260169d27f9ca4d2a5f96fb8e4))
* **FAFF-155:** verdict-build live-driver — whole-change review verdict over a real build ([#102](https://github.com/shftwst/faff/issues/102)) ([23d08e5](https://github.com/shftwst/faff/commit/23d08e52370426f9f915defbf64186b53b3fb181))
* **FAFF-157:** add confidence high/medium boundary-fuzz eval cases ([#98](https://github.com/shftwst/faff/issues/98)) ([092d3b8](https://github.com/shftwst/faff/commit/092d3b89d861c358b38e4b8d1b48b5daa215a8dc))
* **FAFF-158:** routing live-driver + shared makeLiveDriver seam ([#92](https://github.com/shftwst/faff/issues/92)) ([42cec38](https://github.com/shftwst/faff/commit/42cec380dcb4271e35713ae18e5c6946192ca92a))
* **FAFF-160:** routing live-driver frontier runner + measured baseline ([#100](https://github.com/shftwst/faff/issues/100)) ([1c4ec1a](https://github.com/shftwst/faff/commit/1c4ec1a1f46a7a533f020b4d5bbcc29e020389ee))
* **FAFF-161:** advisory rubric-coverage oracle — gradeShaping / gradeDecomposition ([#101](https://github.com/shftwst/faff/issues/101)) ([ff70701](https://github.com/shftwst/faff/commit/ff707015280a040cd28a8a03727bf3c129aa3bfc))
* **FAFF-162:** wire faff park-history seam into live repeat-park diagnostic ([#97](https://github.com/shftwst/faff/issues/97)) ([8e723e3](https://github.com/shftwst/faff/commit/8e723e323993b2e6d17d618693f2a8636c7c172c))
* **FAFF-163:** shared live-driver frontier runner + reconciliation adapter ([#99](https://github.com/shftwst/faff/issues/99)) ([b67bce0](https://github.com/shftwst/faff/commit/b67bce0dd72c3831a11155f7026602407ec5982c))
* **FAFF-19:** name 'Human curation is authoritative' gateway principle ([#66](https://github.com/shftwst/faff/issues/66)) ([f8944dc](https://github.com/shftwst/faff/commit/f8944dc6808af606b6dc78856211d1be5727f0c5))
* **FAFF-89:** mock-tracker fixture format + loader ([#60](https://github.com/shftwst/faff/issues/60)) ([41d2fd8](https://github.com/shftwst/faff/commit/41d2fd84acc7b1593861e3f2b1d6ed8ba8dd20da))
* **FAFF-90:** seeded-repo substrate — deterministic real git/.faff tree ([#62](https://github.com/shftwst/faff/issues/62)) ([25aeb74](https://github.com/shftwst/faff/commit/25aeb74439b6e0922bca91bb7264b3b261bd0d0e))
* **FAFF-93:** skill-run harness — drive a skill in test mode, capture decisions ([#67](https://github.com/shftwst/faff/issues/67)) ([9e51e32](https://github.com/shftwst/faff/commit/9e51e32f8b4c48dc553a4934b7a51c55d9937d3e))
* **FAFF-95:** decision-assertion matchers + refactor faff-tidy test onto them ([#69](https://github.com/shftwst/faff/issues/69)) ([be7a276](https://github.com/shftwst/faff/commit/be7a2762098695c720ac46a4067a66ae43ea5741))
* **FAFF-97:** rendering-adaptor routing assertion — skills route human-facing output through the rendering pass ([#70](https://github.com/shftwst/faff/issues/70)) ([dc3e300](https://github.com/shftwst/faff/commit/dc3e300f972807404d4fc981ce0b6e5fa81914e5))


### Bug Fixes

* **FAFF-139:** remove per-rep cfgDirs (+ forwarded credential copies) after each rep ([#85](https://github.com/shftwst/faff/issues/85)) ([48a4fcd](https://github.com/shftwst/faff/commit/48a4fcde2ef1f9386aae0d624585a6fef43aa955))
* **FAFF-140:** gloss/stale eval defects — synthesis-gloss injection + stale-001 oracle ([#80](https://github.com/shftwst/faff/issues/80)) ([770a2f4](https://github.com/shftwst/faff/commit/770a2f486612009360176cc170cd1968cf662abf))
* **FAFF-142:** soften the gloss oracle with synonym-set rubric entries ([#81](https://github.com/shftwst/faff/issues/81)) ([321adb7](https://github.com/shftwst/faff/commit/321adb7942dd7c12713782c4076410df4f17cce3))
* **FAFF-143:** re-author stale-002 as a genuine stale case (twin of FAFF-140) ([#82](https://github.com/shftwst/faff/issues/82)) ([2ffa32a](https://github.com/shftwst/faff/commit/2ffa32aa196f3626cc69d6992e797c0a3e0ec190))

## [0.3.0](https://github.com/shftwst/faff/compare/faff--v0.2.0...faff--v0.3.0) (2026-06-11)


### Features

* **FAFF-108:** review + ship producers emit their faff-contract block (Path A) ([#50](https://github.com/shftwst/faff/issues/50)) ([c358790](https://github.com/shftwst/faff/commit/c358790cc6667bfeb5c4dda0d7c9172f538f3537))
* **FAFF-109:** retire the faffidavit-* artifact adaptors (Option A) ([#53](https://github.com/shftwst/faff/issues/53)) ([b5f2dd9](https://github.com/shftwst/faff/commit/b5f2dd9e0c414f920f5baf32d4eb4cf17f47ce0d))
* **FAFF-113:** delegate all ordering/value/risk opinion to the methodology slot ([#58](https://github.com/shftwst/faff/issues/58)) ([2aa6a07](https://github.com/shftwst/faff/commit/2aa6a07accc6d2525c1303440d3d03471922aa34))
* **FAFF-121:** relocate plugin into ./plugin subtree so marketplace consumers get skills-only ([#59](https://github.com/shftwst/faff/issues/59)) ([0d503cf](https://github.com/shftwst/faff/commit/0d503cfedd2d204b7f2c57fddb9aedfd177f1e33))
* **FAFF-14:** type-appropriate issue templates — born-structured create boundary ([#44](https://github.com/shftwst/faff/issues/44)) ([330ac74](https://github.com/shftwst/faff/commit/330ac7400411fc762ea51e34a292c4f1fbb09c85))
* **FAFF-3:** distinguish no-ci-coverage from CI-green at the merge gate ([#46](https://github.com/shftwst/faff/issues/46)) ([bfb2c84](https://github.com/shftwst/faff/commit/bfb2c84476987f4ff13b82837ce6aeb28834e6de))
* **FAFF-4:** delivery-precondition pre-flight + graceful not-ready park ([#47](https://github.com/shftwst/faff/issues/47)) ([fc14217](https://github.com/shftwst/faff/commit/fc14217b854a392c33119a8779d7a024a1b998b8))
* **FAFF-60:** name the Tracker-as-the-lights-out-control-plane principle ([#51](https://github.com/shftwst/faff/issues/51)) ([2ea4faa](https://github.com/shftwst/faff/commit/2ea4faa44be9fecde6cc34ddf127d9876e03424a))
* **FAFF-82:** tracker-status issue claim + status-monotonicity guard ([#49](https://github.com/shftwst/faff/issues/49)) ([a6242aa](https://github.com/shftwst/faff/commit/a6242aa2aaccf276bdec9eb291ba59bd083721ed))
* **FAFF-88:** skill test architecture — node:test runner + CLI-seam reference fixture (ADR 0002) ([#54](https://github.com/shftwst/faff/issues/54)) ([faeb762](https://github.com/shftwst/faff/commit/faeb76281d9827e9ad80e9e2ecc37f7ab0d44a96))
* **FAFF-91:** CLI test runner — runCli helper + self-test ([#55](https://github.com/shftwst/faff/issues/55)) ([0a59ccf](https://github.com/shftwst/faff/commit/0a59ccf711001a66dd2b6072f78f65e47400b0c0))
* **FAFF-92:** cover config / next / state / validate-adapters ([#57](https://github.com/shftwst/faff/issues/57)) ([e3cf2dc](https://github.com/shftwst/faff/commit/e3cf2dcbfc79937336263af13d5b51599113ce6f))
* **FAFF-96:** contract-conformance golden tests (4 contracts, 8 cases) ([#56](https://github.com/shftwst/faff/issues/56)) ([60f6e23](https://github.com/shftwst/faff/commit/60f6e23da53d114fe1d208847c94eb20324ce2a4))
* **FAFF-99:** carve trusted-spec live-exercise AC out of the no-execute floor ([#48](https://github.com/shftwst/faff/issues/48)) ([cd2cc7f](https://github.com/shftwst/faff/commit/cd2cc7fd7e6e29788d5f7fb3818f721a804fa776))


### Bug Fixes

* **FAFF-110:** live-thread reconciliation at the autonomous verdict gate ([#52](https://github.com/shftwst/faff/issues/52)) ([ee0aa74](https://github.com/shftwst/faff/commit/ee0aa745ff10e02aab99edc80614fb6cf0bb8613))

## [0.2.0](https://github.com/shftwst/faff/compare/faff--v0.1.0...faff--v0.2.0) (2026-06-10)


### Features

* **FAFF-83:** faff next --if-eligible advisory mode ([#39](https://github.com/shftwst/faff/issues/39)) ([849676e](https://github.com/shftwst/faff/commit/849676e8adc2a9ecfa22c5e5950347cae8ab7259))
* **FAFF-84:** bless-set methodology named-output ([#41](https://github.com/shftwst/faff/issues/41)) ([1cb9d10](https://github.com/shftwst/faff/commit/1cb9d10eb3d162413a5f27d7b45616f011ee1769))
* **FAFF-85:** render bless-set proposals (read-only) ([#42](https://github.com/shftwst/faff/issues/42)) ([9b3358e](https://github.com/shftwst/faff/commit/9b3358e95eaec5c9590f0d188efee1c1590be9c5))
* **FAFF-86:** interactive faff-tidy batch-bless ([#43](https://github.com/shftwst/faff/issues/43)) ([e89375e](https://github.com/shftwst/faff/commit/e89375ec53188a03868b697a7413c44affea0540))

## 0.1.0 (2026-06-10)


### ⚠ BREAKING CHANGES

* **FAFF-61:** automation eligibility now defaults to opt-in (automation_default: opt-in). A ticket is no longer auto-specced/promoted/built unless it carries the new faff-automate label; an unlabelled ticket is left alone (fail-safe). To restore the previous opt-out behaviour, set automation_default: opt-out in .faffrc. faff-automation-hold still hard-excludes.

### Features

* add link-skills.sh for global skill discovery ([0676c06](https://github.com/shftwst/faff/commit/0676c06845bf5126a80ce54fe1ff76613f9c4201))
* **FAFF-44:** spec provenance stamp — adaptor-defined, prep-populated ([#27](https://github.com/shftwst/faff/issues/27)) ([d3f6c1e](https://github.com/shftwst/faff/commit/d3f6c1e6155895b3d08be1d15317e2d8a6157254))
* **FAFF-54:** validate-adapters guards faff-* commands reference the rendering pass ([#22](https://github.com/shftwst/faff/issues/22)) ([d946fc2](https://github.com/shftwst/faff/commit/d946fc22ceeca73a397a11513e7774a2ba6a1b48))
* **FAFF-5:** faff config init — deterministic .faffrc.yaml writer (CLI subcommand) ([#24](https://github.com/shftwst/faff/issues/24)) ([2af8d2b](https://github.com/shftwst/faff/commit/2af8d2bd535acc50f49d01d2eff22e0e33f15c1f))
* **FAFF-61:** invert automation eligibility to fail-safe opt-in (faff-automate) ([#36](https://github.com/shftwst/faff/issues/36)) ([a26ce54](https://github.com/shftwst/faff/commit/a26ce5421e8a798c5d3c8c593b529a9d8f0d0037))
* **FAFF-64:** wire faff skills to consult faff next for sequencing ([#19](https://github.com/shftwst/faff/issues/19)) ([9a40962](https://github.com/shftwst/faff/commit/9a4096233bc10eda78df21c15234f7b3ee1382e3))
* **FAFF-65:** faff state — ledger-reading orchestration read-model (CLI) ([#25](https://github.com/shftwst/faff/issues/25)) ([a2c77ba](https://github.com/shftwst/faff/commit/a2c77ba975bc926468bda60cd72b6e5d89446786))
* **FAFF-67:** faff gitignore-ensure — idempotent gitignore of faff local artifacts ([#23](https://github.com/shftwst/faff/issues/23)) ([8e0dc09](https://github.com/shftwst/faff/commit/8e0dc09200cbf4e01dbcdf86051709c0e946b756))
* **FAFF-68:** untrusted-input no-execute floor — trusted command-source allowlist + gateway contract ([#26](https://github.com/shftwst/faff/issues/26)) ([8ba97f9](https://github.com/shftwst/faff/commit/8ba97f9f66a162971780b1350f82c307de2d3a4d))
* **FAFF-6:** faff-onboard first-run bootstrap skill + gateway no-config trigger ([#29](https://github.com/shftwst/faff/issues/29)) ([78ed819](https://github.com/shftwst/faff/commit/78ed819c0968d90aafb6df8c361f31ccd0bd7397))
* **FAFF-76:** contract-as-code foundations — ADR + reference schema + proof harness ([#28](https://github.com/shftwst/faff/issues/28)) ([80e746e](https://github.com/shftwst/faff/commit/80e746eb90c99af14fc1d22539e8416d20142c61))
* **FAFF-77:** spec-contract vertical slice — faff contract spec-readiness + thin faffidavit-spec + wiring-check ([#31](https://github.com/shftwst/faff/issues/31)) ([d726bc1](https://github.com/shftwst/faff/commit/d726bc13407faa084c1c7fd5d4d4a0b67a1cdf14))
* **FAFF-78:** review-verdict contract-as-code — thin faffidavit-review + wiring-check ([#32](https://github.com/shftwst/faff/issues/32)) ([4a20f11](https://github.com/shftwst/faff/commit/4a20f1170239a04bc41c8ad13b32a773918a03b5))
* **FAFF-79:** delivery-outcome contract-as-code — thin faffidavit-ship + wiring-check ([#33](https://github.com/shftwst/faff/issues/33)) ([bf20e49](https://github.com/shftwst/faff/commit/bf20e494e5897724eb173f5521bed6a0ab964955))
* **FAFF-7:** logging: full|essential knob — silence per-invocation narrative logs, hard floor preserved ([#30](https://github.com/shftwst/faff/issues/30)) ([675f47a](https://github.com/shftwst/faff/commit/675f47a42c9b004cbb61afdc3f7f906f49aa3c38))
* **FAFF-80:** automation-routing contract-as-code — thin faffidavit-routing (completes the 4-contract rollout) ([#34](https://github.com/shftwst/faff/issues/34)) ([4169269](https://github.com/shftwst/faff/commit/416926942caa0fd1058bec4a7fdd7e683eed3e02))
* **FAFF-81:** producer-emitted contract artifact — lights up the artifact-preferred path ([#35](https://github.com/shftwst/faff/issues/35)) ([1177989](https://github.com/shftwst/faff/commit/117798992fa298b97dd9a9e4f6ad5e0fa715d6cb))
* **FAFF-98:** jot interactor — promote/demote over faff-automate ([#37](https://github.com/shftwst/faff/issues/37)) ([dbb717b](https://github.com/shftwst/faff/commit/dbb717b3251a193efe65f445a61c7050a2e49c5c))
* **faff-beep-boop:** add --until and --max cost-budget flags ([07c669d](https://github.com/shftwst/faff/commit/07c669d6c853499d97e0e71d04667197bd5cc771))
* **faff-beep-boop:** add unattended orchestrator for the faff suite ([e825a15](https://github.com/shftwst/faff/commit/e825a158dd86d10e75610a1af5e60affe36fec2a))
* **faff-beep-boop:** add wave loop for mid-run chain unlocks ([2b06d0c](https://github.com/shftwst/faff/commit/2b06d0cefe836a5c34b0a190488e23f452a4011b))
* **faff-beep-boop:** apply delivery-lead methodology lens ([9f268af](https://github.com/shftwst/faff/commit/9f268af88c0ddfb8f1a18c904d661648ad84a8f8))
* **faff-beep-boop:** verdict-gated build queue + new summary sections ([0627654](https://github.com/shftwst/faff/commit/0627654ce38cbda5c3711f145532f20eb5c0f8c1))
* **faff-jot:** existing-ticket interactor (/faff-jot ISSUE-XX) — v1 freeze/thaw (FAFF-24) ([#4](https://github.com/shftwst/faff/issues/4)) ([6b81465](https://github.com/shftwst/faff/commit/6b814658e3560c6103eb82f75ca6af68e246bd65))
* **faff-prep:** add already-shipped scan + premise-superseded gate ([4e8fc7d](https://github.com/shftwst/faff/commit/4e8fc7d380d45651d55b27798b1dd6aa7c30e2c6))
* **faff-prep:** add build chain gate and autonomous respec paths ([b065891](https://github.com/shftwst/faff/commit/b06589143b2b2857985e1b7040ddd859537c2b23))
* **faff-prep:** apply delivery-lead methodology critique ([c70ae42](https://github.com/shftwst/faff/commit/c70ae42f5ed707d9f03bd7f3bfab58299d50a86a))
* **faff-tidy:** add structural diagnostics + calibration synthesis ([7e4c6b5](https://github.com/shftwst/faff/commit/7e4c6b58a65c04613b96e6c08c9852274fb5cd21))
* **faff-tidy:** add yes/no chaining gates and autonomous mode ([e5cdbb8](https://github.com/shftwst/faff/commit/e5cdbb80605e10ecf32d3ffab411a1b42694532b))
* **faff-tidy:** apply delivery-lead methodology lens ([f7f2816](https://github.com/shftwst/faff/commit/f7f2816b0b99b3bbe6da3a83e2e4675ddb2ad3f7))
* **faff-tidy:** forbid auto-creating methodology-recommended relations ([b371ac0](https://github.com/shftwst/faff/commit/b371ac0cf44edec0fd9f35f2d622c7e7601aa0a4))
* **faff-whereto:** add roadmap synthesis skill, mandate fresh tracker pulls in wtf+tidy ([bf2b72d](https://github.com/shftwst/faff/commit/bf2b72d540288b42c9c34b67cf0a6b8098c75556))
* **faff-whereto:** apply delivery-lead methodology lens ([c8caa6b](https://github.com/shftwst/faff/commit/c8caa6b3881efe0402c13a11b73968fffa2ba280))
* **faff-whereto:** consume synthesis contract + cross-ref tidy structural diagnostics ([b3f9f44](https://github.com/shftwst/faff/commit/b3f9f44015b745fb8f1560afddfb2c61a075a632))
* **faff-workit:** add AC verification, review phase, and merge gate ([1b410e6](https://github.com/shftwst/faff/commit/1b410e63a669c7f0c5968f69a11e7fec7365655d))
* **faff-workit:** add resolve-attempt step before autonomous park ([29cae22](https://github.com/shftwst/faff/commit/29cae2235ec108ccc838ff4d89467355ab145bca))
* **faff-workit:** add SKIP_NPM_PACKAGES_INSTALL escape hatch ([cc62360](https://github.com/shftwst/faff/commit/cc62360b3ae899ff19dff255eff8dad5c6fde6a0))
* **faff-wtf:** apply delivery-lead methodology (Delivery view + WIP) ([1cd27a3](https://github.com/shftwst/faff/commit/1cd27a37eab788636218c724c4ff62f5362cf2d4))
* **faff-wtf:** consume synthesis + verdicts + structural diagnostics + calibration ([74201ef](https://github.com/shftwst/faff/commit/74201ef1f2dea31fb291bd5d2617b9ae512f2aa9))
* **faff:** add /faff-noodle new-work intake and close L1 onboarding gaps ([debc24c](https://github.com/shftwst/faff/commit/debc24c7a21ac5b97d40971deb5e9995551b64e5))
* **faff:** add adversarial review and holdout test pipeline steps ([ff375b1](https://github.com/shftwst/faff/commit/ff375b190c4d3d67cd692a15a0f58e580e009661))
* **faff:** add appetite-for-destruction config knob ([64fcb1e](https://github.com/shftwst/faff/commit/64fcb1e2cf76538f2ad5b516f2be05d5f2a2f78b))
* **faff:** add automation-hold — keep tickets out of autonomous spec/build until human release ([98c63c4](https://github.com/shftwst/faff/commit/98c63c4d418ab8f5be99568d1773a65d5ffb2520))
* **faff:** add Automation-routing contract to gateway ([29b0189](https://github.com/shftwst/faff/commit/29b0189068e275909d79bc43f361703da783b897))
* **faff:** add chain-gap detection to structural diagnostics ([10304a6](https://github.com/shftwst/faff/commit/10304a60e21b1272e970c495c66360c8b214e3e2))
* **faff:** add Delivery-lead methodology contract to gateway ([14e6a8c](https://github.com/shftwst/faff/commit/14e6a8c2bc9182c366bcec1fe072fd2c1442b068))
* **faff:** add faffter-dark-* skills for dark factory workflow ([0caeb45](https://github.com/shftwst/faff/commit/0caeb45ee70fe98bc219c23890a562dcec929735))
* **faff:** add humanisation rule to synthesis contract ([7af9d95](https://github.com/shftwst/faff/commit/7af9d95b96689af6c42fa575df2e1f7cae86bf3c))
* **faff:** add opt-in runtime slot-conformance validation (validate_slots) ([045f1b7](https://github.com/shftwst/faff/commit/045f1b74d4aac5d74d29e72d7ae98280dd342bcc))
* **faff:** add shared rules, autonomous contract, and chaining pattern ([93b08b2](https://github.com/shftwst/faff/commit/93b08b23ffb76c834de1c985117f46b1b8503de3))
* **faff:** add Structural diagnostics contract to gateway ([de03091](https://github.com/shftwst/faff/commit/de03091513984f7f5a67eed575d016ce45128397))
* **faff:** add Synthesis contract to gateway ([0ccdba1](https://github.com/shftwst/faff/commit/0ccdba149b759cbf5eb6ba6d584dc4f59891ae1c))
* **faff:** add TUI-friendly tabular output convention ([0b3022c](https://github.com/shftwst/faff/commit/0b3022cb542c9709b3a6e9fdebb664724e655af5))
* **faff:** add validate-adapters conformance lint for shipped slot skills ([030d4a0](https://github.com/shftwst/faff/commit/030d4a005d9727694e7afa5de2eba0fff4db9f8c))
* **faff:** add Visualisation-over-prose contract to gateway ([ceedb95](https://github.com/shftwst/faff/commit/ceedb95e393488568061260b357587e04c1d3fe5))
* **faff:** adopt release-please for automated releases ([cd9f458](https://github.com/shftwst/faff/commit/cd9f45835ed6b135628801f9e54cf13ad9569017))
* **faff:** bake "a description is never a spec" into the spec gate ([d1ddea9](https://github.com/shftwst/faff/commit/d1ddea9df49f6221a7f81c96c764c7626939a4e7))
* **faff:** canonical control-label manifest + ensure-before-tag rule (FAFF-47) ([#9](https://github.com/shftwst/faff/issues/9)) ([71b7045](https://github.com/shftwst/faff/commit/71b704506883de290ebf18fece19057566686b47))
* **faff:** close L2 gaps — test-command discovery and medium-confidence visibility ([53da3e6](https://github.com/shftwst/faff/commit/53da3e677f0c1761807d5aeafcbae8b687912d26))
* **faff:** close L3 slot gaps — methodology contract + contract-binding mechanism ([18c19b5](https://github.com/shftwst/faff/commit/18c19b558cb727f309bfaab28addf724d9af5b14))
* **faff:** consolidate review slot and remove holdout from pipeline ([e38095f](https://github.com/shftwst/faff/commit/e38095f73ab1841130320cbbd1eda14114e57221))
* **faff:** define agent lanes (orchestrator, implementor, evaluator) ([dd0044b](https://github.com/shftwst/faff/commit/dd0044bc713ffc1b81bd37e422b5daade88b83ce))
* **faff:** document .faff/calibration/ + verdict cache layout ([aee4945](https://github.com/shftwst/faff/commit/aee4945835f19fe287b86ba19c50f2b3a1a95ecd))
* **faff:** execution-reporting — discovered work becomes backlog ([dd9eb16](https://github.com/shftwst/faff/commit/dd9eb16a2df1e5de8d4825cb9c8d972915657880))
* **faff:** extend Autonomous Mode Contract with resolve-attempt + calibration ([557ae0a](https://github.com/shftwst/faff/commit/557ae0aa4292bc31ebd6f0c1f95ce72e6d3ab18c))
* **faff:** extract default structural methodology into faffter-noon skill ([6b715d2](https://github.com/shftwst/faff/commit/6b715d2790940c90b4e8d5dc2dcfcea73991ae4f))
* **faff:** extract delivery-lead into pluggable methodology slot ([8d6f080](https://github.com/shftwst/faff/commit/8d6f0809ab49a4eafbfa8bf02f9f38834da05455))
* **faff:** extract review and spec-format into faffter-noon skills ([2dac8c7](https://github.com/shftwst/faff/commit/2dac8c7ec668700d4adee5d611b2014fd6c0f104))
* **faff:** faff next — deterministic legal-next-step transition function (FAFF-63) ([#17](https://github.com/shftwst/faff/issues/17)) ([006ea4b](https://github.com/shftwst/faff/commit/006ea4be5b6b1497ba3e4dbbc83d7ce225123ce3))
* **faff:** faff-plot — top-down planning closes the loop ([340ac8e](https://github.com/shftwst/faff/commit/340ac8ef2592bb2fc0b1707dfe88155b2d28af6b))
* **faff:** give the methodology critique a real home via issue-critique ([33d2dd3](https://github.com/shftwst/faff/commit/33d2dd365ee0ed10e5215f610363962e1521f11c))
* **faff:** hide internal slot skills from the / menu via user-invocable: false (FAFF-51) ([#7](https://github.com/shftwst/faff/issues/7)) ([99b037c](https://github.com/shftwst/faff/commit/99b037c37ffd8577f6f0e8c12e574835e55deeed))
* **faff:** make appetite suite-wide with full autonomy level ([d73b89f](https://github.com/shftwst/faff/commit/d73b89f67acd385acc2968dabc36d36410426c7d))
* **faff:** make graph-detection a required floor of backlog-diagnostics ([11381a2](https://github.com/shftwst/faff/commit/11381a22de90b84ac052483daf697087798d0443))
* **faff:** make spec docs path configurable with smart default ([4809111](https://github.com/shftwst/faff/commit/4809111c16578c93688ebeacc62221311aaa3255))
* **faff:** mechanical CLI-only config access — hard cutover + loud error + resolved echo (FAFF-50) ([#13](https://github.com/shftwst/faff/issues/13)) ([b930c9c](https://github.com/shftwst/faff/commit/b930c9c857f465cb464414f1c058fb7c97acaddc))
* **faff:** mechanically enforce beep-boop queue completeness ([409c379](https://github.com/shftwst/faff/commit/409c379422d2a0c48b3ac7a6491335e8f96e5adc))
* **faff:** move config to .faffrc with a resolver and example template ([6f1cf20](https://github.com/shftwst/faff/commit/6f1cf2095932a2421773b6979c02a2762a783955))
* **faff:** pre-flight validation for configured slot occupants + doc hygiene ([0773b31](https://github.com/shftwst/faff/commit/0773b31ae88d7a877ec22ab2306524ca560fead6))
* **faff:** promote build-pass execution to a swappable concurrency slot ([4d720c8](https://github.com/shftwst/faff/commit/4d720c8faa8c3cab0995037ed2b7d1572d5713be))
* **faff:** single-source worktree policy with a configurable home-dir root ([c767562](https://github.com/shftwst/faff/commit/c767562bab2a116009d0b452e71c9912871325dc))
* **faff:** surface value chains to unlock in faff-wtf ([accbc9b](https://github.com/shftwst/faff/commit/accbc9bba4e16f36e80b17189709abea6a0cae9f))
* **faff:** teach faffter-dark-authoring-adaptors about mechanism slots ([260b619](https://github.com/shftwst/faff/commit/260b61931f7c71dd35196f8c89d9fc53bfab6fb1))
* **faff:** widen Ignore cancelled rule to cover Duplicate state ([1d27547](https://github.com/shftwst/faff/commit/1d275470f9975b3e6d57480d7948f19280a1a5d5))
* initial release — for devs who hate project management but still need to ship ([e18a912](https://github.com/shftwst/faff/commit/e18a912500f5856da3bac97830fe4d0714b40840))


### Bug Fixes

* **faff-beep-boop:** spec-gate via shared discovery rule, not repo-only ([8270f06](https://github.com/shftwst/faff/commit/8270f06a843c2935e00cc6452d993773b7078be9))
* **faff-tidy:** correct structural-diagnostics category count to five ([cd19a61](https://github.com/shftwst/faff/commit/cd19a614263d0b63d73804f52211274f3e325bb7))
* **faff-tidy:** forbid narrowing scope to a prior skill's surfaced subset ([61499b1](https://github.com/shftwst/faff/commit/61499b13cff65fec3840addf9f57ae91024ef3ea))
* **faff-wtf:** use Bash ls instead of Glob to check .faff/runs/ ([dcebb6c](https://github.com/shftwst/faff/commit/dcebb6cb18963db1d80030191a032ebd78a29754))
* **faff:** clarify the methodology slot always runs in beep-boop ([947e6e3](https://github.com/shftwst/faff/commit/947e6e3eda8d295d920138d13213f9bed53c1383))
* **faff:** close L1–L3 audit gaps — frontmatter, example, README, drop --split ([3928d13](https://github.com/shftwst/faff/commit/3928d13d2f69822a542ab7d0cb371b146e1b5032))
* **faff:** close regressions surfaced by the L1–L4 gap re-assessment ([2841704](https://github.com/shftwst/faff/commit/284170439ad818c806c2e06fd145800725d5570a))
* **faff:** close the git-only spec handoff (prep → graft with no tracker) ([71f69f8](https://github.com/shftwst/faff/commit/71f69f8b1cbed242a51a77c17c8c03b61d6178b7))
* **faff:** correct stale form numbering reference in automation-routing display ([0936c40](https://github.com/shftwst/faff/commit/0936c40debd26378bf87234ae6766c005dbdc8b8))
* **faff:** distinguish flaky CI from real defects in workit ([15b039a](https://github.com/shftwst/faff/commit/15b039a7de7b1360100de6624b163686f2ede674))
* **faff:** gate chain-gap auto-create on appetite, not methodology ([c73be82](https://github.com/shftwst/faff/commit/c73be82d37806eaef3c99dcf8297acf7fac29467))
* **faff:** make the standalone gateway refer-back layout-relative ([0d32907](https://github.com/shftwst/faff/commit/0d329077c885e31943d2e50dd777fcf3fd3da8b3))
* **faff:** post-audit cleanups — appetite config locus, evaluator-lane honesty, slots-aren't-levels ([cd41c01](https://github.com/shftwst/faff/commit/cd41c01d9d8017c8a174e2bd6df6cd1ef06087a1))
* **faff:** resolve gateway refer-back path to the install location ([a24c4b3](https://github.com/shftwst/faff/commit/a24c4b330bc80a4ed46e9d2c14cf3fa38a4655f7))
* **faff:** resolve the bundled CLI robustly, not via the hardcoded dev path ([43e36ef](https://github.com/shftwst/faff/commit/43e36eff5f88f38aec0084c43b9eafb759f3c687))
* **faff:** resurface interactively parked work in faff-wtf ([dfd434e](https://github.com/shftwst/faff/commit/dfd434e8f0a70e27a255d426cbdd76ef0b606ab8))
* **faff:** tighten beep-boop conflict analysis ([1bcc6b4](https://github.com/shftwst/faff/commit/1bcc6b453d98a1cb347ec88b0db5098b52b2fc6b))
* **tidy:** require spec before promoting; suggest /faff-prep for spec-less issues ([62a5f19](https://github.com/shftwst/faff/commit/62a5f197fda94d4b4df6117c1c975602b4359bbd))
