# Changelog

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
