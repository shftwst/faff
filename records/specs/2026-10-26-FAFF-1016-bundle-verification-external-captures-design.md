# Bundle verify: an explicit `--bundle-store` override, a fetch-target trust gate against untrusted `git-remote` roots, and a fail-closed `publish` rejection

> Spec: faffter-dark-nlspec · 2026-09-25 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1016.
> build-tier: complex

> Revised 2026-09-25 (round 2 — design-lens re-spec after the L4 adversarial spec-review's round-1 `reject-approach`). Two human-ratified decisions are unchanged: the git-remote/untrusted-`--root` risk is a **code gate** (fail-closed refusal), not a documentation-only boundary; and `bundle publish` **rejects** `--bundle-store` (exit 2). This revision strengthens *how* the gate decides trust and *how* the spec proves it: the trust predicate is re-grounded on **strict path-containment of `--root` inside the invoker's own working tree** plus an explicit **resolved-origin-URL** check — closing the nested-checkout, `.git`-file-gitlink, and symlinked-`.git` escapes that a repository-identity (git-common-dir) predicate falsely admits; and the "refused before any git op" / "probe is side-effect-free" properties are now pinned by born-verifiable no-fetch observables.

## Already shipped against this surface

Related Done work on the bundle-store surface, none of which supersedes this fix (premise holds):

- **FAFF-861** (Done) — moved `bundle_store` out of slots into a top-level config mode enum. Establishes the two occupants (`local`/`git-remote`) this override selects between; does not add a verify override.
- **FAFF-1000** (Done) — built the Commissaire facade's `audit seal` / `audit export` with `--bundle-store local`. This is the precedent the override mirrors — but it deliberately did **not** touch `bundle verify`, so the asymmetry the bug reports remains.
- **FAFF-360** (Done) — the second-consumer demo that surfaced this; its spec works around the bug by copying the capture to a temp dir outside any repo. This fix removes the need for that workaround.

This spec addresses FAFF-1016. Audience: the build agent implementing the fix, and the human reviewers of the resulting PR. It specifies (a) a store-selection override on `faff bundle verify` so an exported capture verifies where it sits without inheriting an enclosing checkout's `bundle_store`; (b) a fail-closed code gate that refuses `--bundle-store git-remote` against an untrusted `--root`, keyed on the *actual fetch target* git would use; and (c) a fail-closed rejection of `--bundle-store` on `bundle publish`.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff bundle verify` picks *which* store occupant to read (`local` — read bundle files from a directory tree; `git-remote` — fetch them from a git remote) by reading the `bundle_store` config key, and config discovery walks *up* from the given root into any enclosing git checkout. A capture is a self-contained directory tree meant to be read as `local` files; when it happens to sit inside a repo whose config says `git-remote`, verify reads the wrong occupant and fails a bundle that is actually intact. The same mechanism is a security hazard for `git-remote`: the occupant runs every git operation as `git -C <root> … origin …`, so **the fetch target is whatever `origin` git resolves from `<root>`'s own `.git` discovery** — not a URL faff ever reads. An attacker-supplied `--root` can therefore name the fetch target. That is why the new `--bundle-store git-remote` value is gated in code, not merely documented.

**Problem statement.** A published capture (`.faff/bundles/<run_id>/seg-<N>/run-close/` plus the run anchor) is meant to be replayed by anyone with `faff bundle verify --root <capture>`; today, when that capture sits inside a git checkout whose `.faffrc.yaml` sets `bundle_store: git-remote`, verify resolves the git-remote occupant and returns `MISSING` / `VERIFICATION_UNAVAILABLE` on a bundle that verifies `CLEAN` from a temp dir outside any repo. This change gives `bundle verify` an explicit `--bundle-store` override — matching the one `audit seal` / `audit export` already carry — so a capture is read with the occupant its layout actually needs, in place, and closes the trust-root hazard the override's `git-remote` value would otherwise open by refusing it against an untrusted root in code.

**Design principles.**

- **Zero-config behaviour is unchanged.** The override is opt-in. When `--bundle-store` is absent, `bundle verify` resolves the store exactly as today (config-driven, walk-up included). No existing invocation changes its verdict, and the new code gate keys strictly on the *explicit* `--bundle-store git-remote` flag — the config-driven resolution path is never gated (so the in-repo walk-up cases FAFF-208 relies on, and Scenario 2's regression guard, are untouched).
- **Gate on the actual fetch target, established structurally.** The override newly makes the `git-remote` occupant reachable *by flag* against an arbitrary `--root`. The dangerous variable is *which `origin` URL `git -C root` will fetch from*, so the gate must guarantee that URL is the operator's own vetted one. Repository identity (git-common-dir equality) does **not** guarantee it — a `.git`-file gitlink or a symlinked `.git` pointing into the operator's checkout resolves to the *same* common dir yet is an attacker-controlled directory (§6). The gate therefore requires `--root` to be a plain subdirectory of the invoker's **own working tree** (no `.git` indirection), which *by construction* makes `git -C root` use the operator's own `.git/config` and hence the operator's own `origin`; the resolved `origin` URL is additionally compared as the explicit fetch-target invariant. Fail-closed: any doubt refuses before any git operation.
- **Fail-closed on `publish` too.** `bundle publish` refuses an inapplicable `--bundle-store` rather than silently ignoring it — consistent with the CLI's fail-closed parsing posture (FAFF-576).
- **Mirror the sibling verbs' vocabulary; do not invent a dialect — for the surface this change actually owns.** `commissaire audit seal` / `audit export` already take `--bundle-store` with the same occupant vocabulary; `bundle verify` adopts the same flag name, the same enum, and the same fail-safe posture, for its own resolution path in `bundle.js`. This is narrower than "mirrors the sibling verbs" sounds: `commissaire.js`'s own store resolution (`resolveFacadeStore`) is a **separate, already-divergent** site — it refuses `--bundle-store git-remote` outright in-process (the standalone facade's import-independence constraint, FAFF-999). This change does not unify the two resolution sites (see §2).
- **The flag selects the occupant only; the root's meaning still comes from the occupant, not from the flag.** `--bundle-store` says *how to read it*; what `--root` means was already occupant-specific before this change, and stays that way — see the grounding below.

**Where `--bundle-store git-remote`'s remote comes from — and why an untrusted root is dangerous.** `gitRemoteBundleStore(root, remoteName = "origin")` (`bundle.js`) never reads `.faffrc.yaml` for a remote URL — it never did, in either the config-driven path or this change's flag path. Every git operation it performs (`ls-remote`, `fetch`, `push`, `show`) runs as `git -C root <op> origin …` (`gitReadRefManifest`, the occupant's `headDigest`/`member`/`listBoundaries`); the remote named `origin` is resolved by **git's own native config discovery** — the `.git/config` of whichever checkout `git -C root` lands in, via git's ordinary upward search from `root`. `resolveBundleStore(root)` — the existing config-driven path — already calls `gitRemoteBundleStore(root)` with this identical default (`bundle.js`: `return name === "git-remote" ? gitRemoteBundleStore(root) : localBundleStore(root);`, no `remoteName` argument passed). The `bundle_store: git-remote` config key only ever decided **which occupant class to construct**; it never supplied a remote URL. So `--bundle-store git-remote --root <dir>` is byte-for-byte `gitRemoteBundleStore(<dir>)` — the identical construction and remote-resolution mechanism config resolution already produces for the same root. "Minus the config read" (§4, §8) means minus the `bundle_store` *key lookup* only; it was never "minus a remote-URL lookup", because `.faffrc.yaml` never supplied one.

The security consequence follows directly. Because `origin` is resolved by git's discovery from `--root`, the fetch target is named by whatever `.git/config` git associates with `--root`. For an **attacker-supplied capture** — one that ships its own `.git` (a nested checkout, a `.git`-file gitlink, or a symlinked `.git`), or sits inside a checkout the attacker controls — that origin is attacker-influenced, with three consequences: (a) network egress from the operator's machine to an attacker-chosen host; (b) git may invoke that checkout's configured `credential.helper` during the fetch; (c) in `git-remote` mode the remote *is* the trust root, so an attacker-controlled origin can serve a bundle whose own digests recompute `CLEAN` — a forged pass. The override newly makes this reachable *by an explicit flag* against an arbitrary `--root`, so the fix closes it in code (§3/§4 gate) rather than by a note. `--bundle-store local` reads the tree in place, performs **no** git operation and **no** network fetch, and remains the safe default for verifying an untrusted capture; the gate constrains only the `git-remote` value.

**Corollary — `--root` means something occupant-specific, and did so before this spec.**
- **`local`** — `root` is the file-tree root read directly. Confirmed at `bundle-seal-core.js`'s `localBundleStore(root)`, which keys its directory off `root` (`localBundleSegDir`) with no git or config involvement at all.
- **`git-remote`** — `root` is the working directory `git -C root …` runs from; git's own `.git` discovery from there finds whichever checkout/worktree git associates with `root`, and reads *that*'s `origin` remote. A capture directory is therefore only `git-remote`-capable if git associates it with a checkout that has an `origin` remote — the identical requirement the config-driven path already has, and the exact reason an *untrusted* such directory is a hazard.

This is why the capture bug's fix is `--bundle-store local` (no git repository required at all), and why `--bundle-store git-remote` on `bundle verify` is coherent *only against the operator's own trusted checkout* — an operator scripting a verify against a known, trusted git-remote checkout without depending on `.faffrc.yaml` being present or well-formed at that moment (Scenario 3). Any other use is refused (Scenario 3b).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/bundle.js` | Node (dependency-free CLI) | Hosts `cmdBundle` (the shared `BUNDLE_SPEC` flags + the `verify`/`publish` actions), `resolveBundleStore` / `resolveBundleStoreName`, `gitRemoteBundleStore` (its `root` + default `remoteName="origin"`), `gitReadRefManifest` (the `ls-remote`→status mapping the verdict grounding reads), `classifyBundle` (the **pure** verdict ladder), `verifyBundleIdentity`, the `gitRun`/`gitRunText` helpers, and the exported `setGitArgvSpy(arr)` / `__gitArgvSpy` argv-recording seam (used to pin git argv sequences byte-for-byte). Change lands here. |
| `plugin/skills/faff/bin/lib/bundle-seal-core.js` | Node | Defines `localBundleStore(root)` — keys its dir off `root` (`localBundleSegDir`), no config or git read. Confirms `--bundle-store local` reads the capture in place. |
| `plugin/skills/faff/bin/lib/commissaire.js` | Node | Precedent, with a caveat: `audit seal` / `audit export` accept `--bundle-store`, but `resolveFacadeStore` refuses `git-remote` in-process — the divergence this spec scopes around rather than fixes. |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node | `findRoot` (walks up from `process.cwd()` to the `.git`/`.faff` root — the invoker anchor), `findConfig` / `mainWorktreeRoot` (the walk-up that causes the bug; `mainWorktreeRoot` runs `git -C root rev-parse --git-common-dir` — the primitive the *prior* predicate reused, which §6 shows is insufficient), and `readBaseConfigStrict` (throws `base-parse-error` on a malformed `.faffrc.yaml`, after a loud stderr warning, unless `FAFF_CONFIG_BASE_LENIENT` is set — the mechanism Scenario 5 exercises). |
| `plugin/skills/faff/bin/lib/argv.js` | Node | `parseArgs`'s `enum` handling — the exact `bad-enum` stderr text (`"<value> not in <enum.join('|')>"`) Scenario 4 pins; the fail-closed unknown-flag posture (FAFF-576) the publish-rejection design in §3 aligns with. `BUNDLE_SPEC` is a **single shared** CommandSpec parsed once for both `publish` and `verify` — a flag cannot be made "unknown to one action only". |

**Scope statement.** A hardening of the `bundle verify` / `bundle publish` CLI path so an exported capture is a portable, in-place-verifiable artifact and the newly-reachable distributing occupant cannot be aimed at a root whose `origin` git would resolve outside the operator's own working tree — the last gap in the FAFF-360 replay story.

## 2. OUT OF SCOPE

- **A Commissaire-native `audit verify` that reads no config.** Excluded — the rejected alternative to the chosen override (§6): a whole new verb with the facade's import-independence constraints, disproportionate to a store-selection bug. Extension point: `commissaire.js` (the `audit` verb dispatcher).
- **Unifying `bundle.js`'s `bundleStoreByName` with `commissaire.js`'s `resolveFacadeStore`.** Excluded. They already diverge — the facade refuses the `git-remote` occupant in-process (§1); `bundleStoreByName` doesn't. Reconciling the two resolution sites is a separate, larger change. Extension point: `resolveFacadeStore` in `commissaire.js`.
- **Gating the config-driven (`bundle_store: git-remote`, absent-flag) resolution path.** Excluded. The code gate keys strictly on the *explicit* `--bundle-store git-remote` flag; it does **not** intercept config-driven git-remote resolution. Gating that path would change the absent-flag behaviour globally (regressing FAFF-208's in-repo walk-up and Scenario 2's documented regression-guard verdict), and it addresses a pre-existing risk this ticket does not newly introduce. The mitigation for verifying an untrusted capture stays "use `--bundle-store local`". Extension point: `resolveBundleStore` in `bundle.js`, if a future change wants a blanket untrusted-root guard.
- **Sandboxing the `git-remote` fetch itself (credential-helper suppression, network-egress controls, `-c credential.helper=` / `GIT_TERMINAL_PROMPT=0` hardening of the occupant).** Excluded. The gate refuses *before* any fetch, so the occupant's fetch behaviour is unchanged from today's config-driven path; deeper sandboxing of a fetch that is nonetheless permitted (trusted root) is a separate hardening. Extension point: `gitRemoteBundleStore` in `bundle.js`.
- **Re-admitting a same-repository linked worktree as a trusted `--root`.** Excluded, and a deliberate reversal from the round-1 spec. A `git worktree add` linked worktree shares the invoker's git-common-dir and `origin` yet has a **different** working-tree top-level, so the strict path-containment predicate (§3) refuses it. This is fail-closed over-strictness: the operator's remedy is to run verify from *inside* the linked worktree (so cwd and `--root` share a top-level), omit `--root`, or use `--bundle-store local`. Admitting linked worktrees would require re-introducing a common-dir/origin-only test, which §6 shows is defeatable by a symlinked `.git`. Extension point: `isGitRemoteRootTrusted` in `bundle.js`.
- **Changing config walk-up (`findConfig` / `mainWorktreeRoot`).** Excluded. The walk-up is correct for the in-repo cases it was built for (FAFF-208 linked-worktree config fallback); narrowing it would regress those. The override sidesteps it for the capture case rather than altering it. Extension point: `shared-infra.js`.
- **Auto-detecting "this root is a capture, not a checkout."** Excluded. Heuristic detection is fragile and out of proportion; an explicit flag plus a trust gate is the honest interface. Extension point: `resolveBundleStore` in `bundle.js`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Store occupant | A built-in implementation of the fixed BundleStore contract. Exactly two exist: `local` and `git-remote` (`BUNDLE_STORE_OCCUPANTS` in `bundle.js`). |
| Capture | An exported, self-contained bundle directory tree (`.faff/bundles/<run_id>/seg-<N>/<boundary_key>/` plus the run anchor) meant to be replayed by a third party via `faff bundle verify --root <capture>`. |
| Config walk-up | `findConfig(root)` falling back to `mainWorktreeRoot(root)`'s `.faffrc.yaml` for any root inside a git checkout — the mechanism by which an enclosing checkout's `bundle_store` wins over a capture's own layout. |
| Invoker anchor | `process.cwd()` — the directory `faff` was invoked from. The trust predicate measures `--root` against the working tree that encloses the invoker anchor. |
| Working-tree top-level | `git -C <dir> rev-parse --show-toplevel` — the root of the git *working tree* git associates with `<dir>`. Distinct from the git-common-dir: a nested checkout, a `.git`-file gitlink, or a symlinked `.git` each make `<dir>` its **own** top-level even when its common-dir resolves elsewhere. |
| Fetch target | The `origin` URL `git -C <root>` would fetch from — `git -C <root> remote get-url origin`. The variable the gate actually protects. |
| Untrusted `--root` | A `--root` that is not a plain subdirectory of the invoker's own working tree, or whose resolved `origin` differs from the invoker's, or that is outside any working tree. The precise mechanical predicate is pinned below. |

**CLI surface — the change.**

```
faff bundle verify  --run-id ID --run-segment-id N --boundary-kind KIND --boundary-key KEY
                    [--root DIR] [--bundle-store local|git-remote] [--json]
faff bundle publish --run-dir DIR --boundary-kind KIND --boundary-key KEY
                    [--root DIR] [--json]        # --bundle-store is REJECTED (see below)
```

- `--bundle-store` — NEW. Optional. Arity 1. Enum-validated against `BUNDLE_STORE_OCCUPANTS` (`local` | `git-remote`) by the existing `parseArgs` enum machinery. Consumed only by `verify`.
- **`verify`, flag absent** → resolve the store from config exactly as today (`resolveBundleStore(root)`, walk-up included) — byte-for-byte unchanged.
- **`verify`, `--bundle-store local`** → construct `localBundleStore(root)` directly; no config read for occupant selection.
- **`verify`, `--bundle-store git-remote`** → construct `gitRemoteBundleStore(root)` directly **only if `root` is trusted**; against an untrusted `root`, refuse (exit 2, clear stderr) before constructing the occupant or performing any git operation *against `origin`*.
- **`publish`, any `--bundle-store` value** → **rejected**: exit 2 with an explicit error (see below).

**Trust predicate — the untrusted-`--root` gate (`git-remote` only).** The gate must guarantee the fetch target is the operator's own vetted `origin`. The load-bearing invariant is **strict path-containment**: `--root` must be a plain subdirectory of the invoker's **own working tree**, established by canonicalized working-tree-top-level equality — which refuses any `.git` indirection (nested checkout, `.git`-file gitlink, symlinked `.git`), each of which makes `--root` its own top-level. A complementary **fetch-target** check compares the resolved `origin` URL. Both are read-only, local git queries; neither contacts a remote, invokes a credential helper, or runs a repository hook. The probe routes through the module's `gitRunText` helper so the argv-recording seam (`setGitArgvSpy`) captures it — making "no remote op ran" born-verifiable (§5).

```
FUNCTION gitWorktreeTop(dir):                     # read-only local git; no network/helper/hook
  r := gitRunText(dir, ["rev-parse", "--show-toplevel"])
  IF r.status != 0 OR r.stdout is empty: RETURN null
  RETURN realpath(r.stdout.trim())                # canonicalise symlinks; null on realpath failure

FUNCTION gitOriginUrl(dir):                        # read-only local git; no network/helper/hook
  r := gitRunText(dir, ["remote", "get-url", "origin"])
  IF r.status != 0: RETURN null                    # e.g. "No such remote 'origin'" -> exit 2
  u := r.stdout.trim()
  RETURN u == "" ? null : u

FUNCTION isPathContained(childReal, parentReal):   # lexical, over already-realpath'd absolute paths
  rel := relative(parentReal, childReal)
  RETURN rel == "" OR (rel is not absolute AND rel does not start with "..")

FUNCTION isGitRemoteRootTrusted(root, invokerCwd):
  invokerTop := gitWorktreeTop(invokerCwd)
  rootTop    := gitWorktreeTop(root)
  IF invokerTop == null OR rootTop == null: RETURN false        # either side not in a working tree
  IF invokerTop != rootTop: RETURN false                        # nested/gitlinked/symlinked/other worktree
  rootReal := realpath(root)
  IF rootReal == null OR NOT isPathContained(rootReal, invokerTop): RETURN false   # symlink escape
  invokerOrigin := gitOriginUrl(invokerCwd)
  rootOrigin    := gitOriginUrl(root)
  IF invokerOrigin == null OR rootOrigin == null: RETURN false  # no origin -> nothing safe to fetch
  RETURN invokerOrigin == rootOrigin                            # explicit fetch-target invariant
```

- **Trusted (allowed):** `--root` omitted (defaults to `findRoot(cwd)`, inside the invoker's own working tree → same top-level, same origin); or an explicit `--root` that is a subdirectory of the invoker's own working tree.
- **Untrusted (refused):** an explicit `--root` in a *different* repository; one carrying its own nested `.git`; one whose `.git` is a file-gitlink or symlink (its top-level is itself, not the invoker's); a *linked worktree* of the same repo (different top-level — §2 reversal); one outside any working tree; an invoker anchor outside any working tree; or a root whose resolved `origin` differs from (or is absent against) the invoker's. All fail closed.
- **Why top-level, not common-dir.** `--show-toplevel` returns `<root>` itself for a `.git`-file gitlink or a symlinked `.git` (grounded: `git -C <ext> rev-parse --show-toplevel` yields `<ext>`, not the target's top-level), so those cases are refused. `--git-common-dir` instead **resolves through** the gitlink/symlink to the invoker's `.git` (falsely equal), which is exactly why the round-1 predicate admitted them (§6).
- **Why the origin check is retained though same-top-level implies same-config.** When top-level equality holds, `gitOriginUrl(root)` and `gitOriginUrl(invokerCwd)` read the same `.git/config`, so the origin comparison cannot *independently* reject a containment-passing root. It is kept as the **explicit, machine-checkable statement of the fetch-target invariant** the objecting lenses named, and as a guard that survives a future loosening of the structural check. It is not the load-bearing check; path-containment is. (Origin-identity *alone* is insufficient: a symlinked `.git` into the operator's checkout resolves `origin` to the operator's *own* URL, so an origin-only test would falsely trust it — §6.)
- The probe is safe against a hostile `--root`: `rev-parse --show-toplevel` and `remote get-url origin` are read-only local queries — no fetch, no `ls-remote`, no `credential.helper`, no hooks. (git ≥ 2.35.2's `safe.directory` ownership check is an additional fail-closed layer: a differently-owned `--root` makes `rev-parse` exit non-zero → `null` → untrusted.)

**Publish rejection of `--bundle-store` (folds the operator's "false analogy" finding).** The earlier posture had `publish` accept-and-ignore `--bundle-store`, justified by analogy to the already-shared verify-only `--run-id`/`--run-segment-id` flags. The operator ruled that a **false analogy** and directed a fail-closed resolution. Because `BUNDLE_SPEC` is a single shared CommandSpec parsed once for both actions (`bundle.js`; `argv.js` cannot mark a flag unknown-to-one-action-only), `publish` cannot make `--bundle-store` an *unknown* flag; instead the `publish` action rejects it explicitly:

- `faff bundle publish --bundle-store local` (or `git-remote`) → **exit 2** with `faff bundle publish: --bundle-store is not valid for publish (publish resolves its store from config inside a live run); it is a verify-only flag` — an explicit refusal, consistent with FAFF-576's fail-closed posture, not a silent ignore.
- `faff bundle publish --bundle-store s3` → still **exit 2 at parse time** via the enum's `bad-enum` path in `parseArgs`, before action dispatch — unchanged. (A malformed *value* is caught by parse; a well-formed-but-inapplicable value is caught by the action's explicit reject.)

This does **not** lean on the `--run-id` precedent. The remaining shared verify-only flags (`--run-id`, `--run-segment-id`) keep their existing accept-and-ignore behaviour on `publish` — they are out of scope; only `--bundle-store` is resolved here.

**Store-selection helper (refactor for a single home — scoped to `bundle.js`).**

```
FUNCTION bundleStoreByName(name, root):
  # name is an already-validated occupant token (local | git-remote)
  RETURN name == "git-remote" ? gitRemoteBundleStore(root) : localBundleStore(root)

FUNCTION resolveBundleStore(root):            # unchanged behaviour, now expressed via the helper
  RETURN bundleStoreByName(resolveBundleStoreName(root), root)
```

`resolveBundleStoreName` (the config read + fail-safe-to-`local` on an unrecognised name) is untouched and still the sole config-driven path. "Single home" here means: within `bundle.js`, verify and config-driven resolution both route through `bundleStoreByName` and can never map a token to a different occupant from each other. It does not extend to `commissaire.js`'s `resolveFacadeStore` (§1, §2). The trust gate is applied at the CLI action *before* `bundleStoreByName` is called for the explicit-`git-remote` case, so `bundleStoreByName` itself stays a pure two-way switch (the gate is a CLI-layer policy, not baked into the occupant constructor, so library callers that pass a pre-built `opts.store` are unaffected).

**Design decisions (markers; full rationale in §6).**

- **Chosen:** add an explicit `--bundle-store local|git-remote` override to `bundle verify`, mirroring `audit seal` / `audit export`'s flag/enum/posture within `bundle.js`'s own resolution path (not the facade's in-process reach).
- **Chosen:** gate `--bundle-store git-remote` behind `isGitRemoteRootTrusted(root, process.cwd())` — strict path-containment of `--root` in the invoker's own working-tree top-level plus a resolved-`origin` equality check — refuse (exit 2, no git op against `origin`) when `--root` is untrusted; the gate keys on the explicit flag only, never the config-driven path.
- **Chosen:** `bundle publish` **rejects** any `--bundle-store` value (exit 2, explicit error), not accept-and-ignore.

## 4. HOW — Behavior

**Architecture and approach.** `verifyBundleIdentity(identity, opts)` already accepts `opts.store` and only falls back to `resolveBundleStore(opts.root)` when it is absent (`bundle.js`: `const store = opts.store || resolveBundleStore(root)`). The change is: (1) register `--bundle-store` in the shared `BUNDLE_SPEC.flags`; (2) in the `verify` action, when the flag is present, apply the trust gate for the `git-remote` value, then build the occupant via `bundleStoreByName` and pass it as `opts.store`; (3) refactor `resolveBundleStore` to route through the same helper; (4) in the `publish` action, reject any `--bundle-store` value.

```
PROCEDURE cmd_bundle_verify(values):
  1. Read run_id, run_segment_id, boundary_kind, boundary_key (all still required; unchanged validation).
  2. root := values["--root"] OR findRoot()
  3. storeName := values["--bundle-store"]              # already enum-validated by parseArgs, or undefined
  4. opts := { root }
  5. IF storeName == "git-remote":
       IF NOT isGitRemoteRootTrusted(root, process.cwd()):
         stderr: "faff bundle verify: refusing --bundle-store git-remote against an untrusted --root
                  <root> — git would resolve 'origin' from that directory, not from your checkout;
                  use --bundle-store local to verify an external capture in place"
         RETURN 2                                        # fail closed, BEFORE any origin git op / occupant build
  6. IF storeName is present:
       opts.store := bundleStoreByName(storeName, root)   # explicit occupant; NO config read
  7. result := verifyBundleIdentity(identity, opts)       # absent store -> resolveBundleStore(root), unchanged
  8. Conformance-check + print verdict + return bundleExitCode(verdict)  # all unchanged

PROCEDURE cmd_bundle_publish(values):
  1. IF values["--bundle-store"] is present:
       stderr: "faff bundle publish: --bundle-store is not valid for publish
                (publish resolves its store from config inside a live run); it is a verify-only flag"
       RETURN 2                                           # fail closed, before publishBundle
  2. ... existing publish behaviour, unchanged ...
```

The trust gate performs only `rev-parse --show-toplevel` and `remote get-url origin` (via `gitRunText`) — never `ls-remote`, `fetch`, or `push`. "No git op against `origin`" in step 5 means exactly: no remote-contacting verb runs on the refusal path (§5 pins this).

**Behaviour summary.** With `--bundle-store local --root <capture>`, verify constructs `localBundleStore(<capture>)`, which reads `<capture>/.faff/bundles/<run_id>/seg-<N>/<boundary_key>/` directly — no `loadConfig`, no `mainWorktreeRoot` walk-up — so the enclosing checkout's `git-remote` config can no longer hijack the resolution. With `--bundle-store git-remote --root <dir>`, verify first checks `<dir>` is a plain subdirectory of the invoker's own working tree with a matching `origin`; if not, it refuses before any remote-contacting git subprocess; if so, it constructs `gitRemoteBundleStore(<dir>)`, whose remote resolves exactly as §1 grounds.

**Grounding — occupant selection is the ONLY config-touching step on the verify path.** The call graph (confirmed in `bundle.js`, `verifyBundleIdentity` ≈ lines 1072–1092):

1. `const store = opts.store || resolveBundleStore(root)` — **the only config-touching branch.** When `--bundle-store` is present, `opts.store` is set, so `resolveBundleStore` (→ `resolveBundleStoreName` → `loadConfig` → `readBaseConfigStrict`) is **never called**.
2. `validateIdentityForHandle(queryIdentity)` — **pure** input validation; no config, no I/O.
3. `store.headDigest(...)`, `store.member(...)`, `store.listBoundaries(...)` — read the **store occupant only** (for `local`: files under `root`; for `git-remote`: `git -C root …`). No `.faffrc` read in either occupant.
4. `classifyBundle(read)` — **pure** by construction (the code's own comment: "folds them through the PURE `classifyBundle` ladder"); no config, no I/O beyond a scratch temp dir it owns.
5. `bundleExitCode(verdict)` — pure mapping.

So with `--bundle-store` present there is provably **zero** `.faffrc` read on the verify path (the trust gate's git queries read git config, never `.faffrc`), which is what makes Scenario 5's first run (`CLEAN`/0 against a malformed enclosing `.faffrc.yaml`) a *grounded* falsifiable outcome. The build must not add any new `.faffrc` read to steps 2–5.

**Grounding — the verdict/exit classification for a git remote.** Scenario 2 / smoke step 6 expect `VERIFICATION_UNAVAILABLE`/2 for an **unreachable** git-remote origin, and Scenario 3 expects `MISSING`/1 for a **reachable-but-empty** one — grounded by the status ladder in `bundle.js`:
- `gitReadRefManifest(root, "origin", ref)` runs `git ls-remote origin <ref>`. For a **nonexistent local path** origin, `ls-remote` exits **non-zero**, so `gitReadRefManifest` returns `{ status: "store-unreachable" }` (`if (ls.status !== 0 || ls.error) return { status: "store-unreachable" }`) → `headDigest` maps to `{ status: "bundle-unreadable" }` → `classifyBundle` = `VERIFICATION_UNAVAILABLE` → `bundleExitCode` = **2**.
- For a **reachable** origin with no such ref, `ls-remote` exits **0 with empty stdout**, so `gitReadRefManifest` returns `{ status: "bundle-missing" }` → `classifyBundle` = `MISSING` → exit **1**.
- These two dispositions are distinct external observables (exit 2 vs exit 1) and are pinned separately (Scenario 2 vs Scenario 3; DONE items below).

**Edge cases and error handling.**

- **Unrecognised `--bundle-store` value** (`s3`) → rejected at parse time by the flag's `enum`: `parseArgs`'s `bad-enum` path emits `detail: "s3 not in local|git-remote"`, surfaced via `usageError` (`faff: bad-enum: s3 not in local|git-remote`, exit 2), before either action runs (Scenario 4).
- **`--bundle-store git-remote` against a trusted root** → constructs `gitRemoteBundleStore(root)` directly; identical construction/remote-resolution to a `git-remote` config for the same root (§1), minus the `bundle_store` key read (Scenario 3).
- **`--bundle-store git-remote` against an untrusted root** → refused, exit 2, no remote-contacting git op (Scenario 3b).
- **`--bundle-store` on publish** → refused, exit 2 (Scenario 4b).
- **Flag absent** → unchanged: `verifyBundleIdentity` calls `resolveBundleStore(root)`, walk-up included; a malformed enclosing `.faffrc.yaml` throws `base-parse-error`, caught in the verify action → exit 2 (Scenario 5).
- **Verdict/exit-code mapping** (`CLEAN`=0, four determinate non-clean=1, `VERIFICATION_UNAVAILABLE`=2) is untouched.

**Failure modes — how the trust gate could be wrong, and how you'd notice.**

- **The failure: the predicate is too *loose* — it admits a `--root` whose `origin` git would resolve outside the operator's own checkout.** The named realisations: a nested checkout, a `.git`-file gitlink, or a symlinked `.git` pointing into (or anywhere), each of which a common-dir predicate would admit (§6). Also: a bind-mount/overlay layout that collapses two paths.
  - **How you'd know:** direct fixtures where `--root` is (a) an independent `git init` with its own `origin`, (b) a directory carrying a nested `.git`, (c) a directory whose `.git` is a file-gitlink into the invoker's checkout, (d) a directory whose `.git` is a symlink into the invoker's checkout — each run from the invoker's checkout MUST return `trusted == false`. If any returns `true`, the gate is defeated.
  - **What it means:** if a fixture returns true, the predicate is wrong — do not proceed. The path-containment design makes (b)–(d) return `false` because each makes `--root` its own working-tree top-level; bind-mount collapse is neutralised because a collapsed path that also shares the invoker's `origin` *is* the operator's own repo (safe), and one that does not share it fails the origin check.
- **The failure: the predicate is too *strict* — it refuses a legitimate in-tree verify.** A plain subdirectory of the operator's own checkout addressed by `--root` must pass.
  - **How you'd know:** a fixture that runs verify with `--root <subdir-of-invoker-checkout>` from the invoker checkout returns `trusted == false`.
  - **What it means:** narrow the resolution/realpath step, not abandon the gate. (Linked worktrees are *intentionally* refused — §2 — so their refusal is expected, not a bug.)

**Anti-pattern:** using `git rev-parse --git-common-dir` (the round-1 primitive) for the trust test. Why: a `.git`-file gitlink or symlinked `.git` resolves the common dir *through* the indirection to the invoker's `.git`, so it compares equal and the attacker directory is falsely trusted (§6, grounded). Use `--show-toplevel` + path-containment.

**Anti-pattern:** baking the trust gate into `bundleStoreByName` or `gitRemoteBundleStore`. Why: those are reused by library callers that pass a pre-built store or a trusted root; the gate is a CLI-input policy and belongs in the `verify` action so it fires exactly once, on the explicit-flag path, without changing occupant construction.

**Anti-pattern:** gating the config-driven resolution path (absent flag). Why: it would change the absent-flag verdict globally (regressing FAFF-208 walk-up and Scenario 2), and the ticket's remit is the newly-added flag's widening, not the pre-existing config path (§2).

**Anti-pattern:** duplicating the `name == "git-remote" ? … : …` occupant switch in the verify action. Why: it must stay a single home (`bundleStoreByName`) within `bundle.js`.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Every `Then` pins a concrete, externally observable verdict token / exit code / side-effect — never a claim about which internal code path ran.

**Scenario 1 — override reads the capture in place.**

```
Given a CLEAN capture at <capture> sitting inside a checkout whose .faffrc.yaml sets bundle_store: git-remote
When faff bundle verify --root <capture> --bundle-store local ... is run (with the capture's identity flags)
Then the verdict is CLEAN and the exit code is 0
```

**Scenario 2 — regression guard (absent flag), unreachable origin, observable differing from Scenario 1.**

**Scenario 3 — `--bundle-store git-remote` against a TRUSTED root, with MISSING distinct from UNAVAILABLE.**

```
Given a CLEAN bundle published ONLY via the git-remote occupant (gitRemoteBundleStore) into a local
  bare-repo "origin" (network-free, mirroring bundle.js's own git-remote selftest fixture), with <dir> the
  invoker's OWN checkout (or a subdirectory of it) with that "origin" (so isGitRemoteRootTrusted is true)
  and NO local .faff/bundles files present at <dir>
When faff bundle verify --root <dir> --bundle-store git-remote ... is run (with the bundle's identity flags)
Then the verdict is CLEAN and the exit code is 0 — parity with what a bundle_store: git-remote config would
  resolve for the same root. By contrast, --bundle-store local at the same <dir> (no local files) returns
  MISSING (exit 1): the two occupants are observably distinct, so a build that hard-codes the local occupant
  regardless of the flag fails this scenario. Additionally, with --bundle-store git-remote against a REACHABLE
  bare-repo origin from which the ref has been removed, ls-remote exits 0 with empty output -> bundle-missing
  -> MISSING/1 — distinct from Scenario 2's unreachable-origin VERIFICATION_UNAVAILABLE/2.
```

**Scenario 3b — `--bundle-store git-remote` against an UNTRUSTED root is refused before any remote git op (born-verifiable no-fetch).**

```
Given a bundle root <ext> that git does NOT associate with the invoker's own working tree — in turn each of:
  (a) an independent `git init` checkout with its own "origin"; (b) a directory carrying its own nested .git;
  (c) a directory whose .git is a FILE gitlink into the invoker's checkout; (d) a directory whose .git is a
  SYMLINK into the invoker's checkout — and whose "origin" is a git ext:: transport URL wired to touch a
  sentinel file if the transport is ever invoked (network-free; it would egress/hang if actually contacted)
When faff bundle verify --root <ext> --bundle-store git-remote ... is run from the invoker's checkout, with
  the module's git-argv seam recording every git subcommand
Then for every case the exit code is 2 and stderr contains "refusing --bundle-store git-remote against an
  untrusted --root"; the recorded git argv contains NO ls-remote / fetch / push (only the read-only probe
  verbs rev-parse --show-toplevel and remote get-url origin may appear); and the sentinel file does NOT exist
  — the gate returned before occupant construction, so nothing contacted <ext>'s origin. Cases (c) and (d)
  are the escapes a git-common-dir predicate would falsely TRUST; here they refuse. By contrast,
  --bundle-store local at the same <ext> is NOT refused (it reads the tree in place: CLEAN/0 for a CLEAN
  capture, MISSING/1 for an absent bundle) — the gate constrains only the git-remote value.
```

**Scenario 3c — trust predicate classification table (guards both over-strictness and the escapes).**

- `isGitRemoteRootTrusted(root, invokerCwd)` MUST return, exercised directly against network-free fixtures in the selftest:
  - `true` — `root` is the invoker's own checkout root, or a subdirectory of it, with an `origin`.
  - `false` — `root` is an independently `git init`-ed repo (different top-level and/or origin).
  - `false` — `root` carries a nested `.git` (its own top-level).
  - `false` — `root`'s `.git` is a FILE gitlink into the invoker's checkout (top-level is `root`, though common-dir resolves to the invoker's — the round-1 defect).
  - `false` — `root`'s `.git` is a SYMLINK into the invoker's checkout (top-level is `root`; origin resolves to the invoker's own URL — so an origin-only test would falsely trust it, but path-containment refuses it).
  - `false` — `root` is a `git worktree add` linked worktree of the invoker's repo (different top-level — deliberate reversal, §2).
  - `false` — `root` or `invokerCwd` is not inside any working tree, or `root` has no `origin`.

**Scenario 3d — the trust probe is side-effect-free against a hostile origin (no fetch, no credential-helper).**

```
Given an untrusted --root <ext> (per 3b) whose .git/config sets origin to an ext:: sentinel URL AND sets
  credential.helper to a command that touches a second sentinel file when invoked (network-free)
When faff bundle verify --root <ext> --bundle-store git-remote ... is run (the gate refuses)
Then the exit code is 2, NEITHER sentinel file exists, and the recorded git argv contains no ls-remote/fetch/
  push — establishing that the probe (rev-parse --show-toplevel, remote get-url origin) performed no network
  access and invoked no credential helper. Decidable: if either sentinel appears, the probe is not read-only.
```

**Scenario 4 — invalid `--bundle-store` value (both actions), and publish rejection of a valid value.**

```
Given any bundle root
When faff bundle verify --root <root> --bundle-store s3 ... is run
Then it exits 2, and stderr contains the parseArgs bad-enum text ("s3 not in local|git-remote")
And When faff bundle publish --run-dir <dir> --boundary-kind run-close --boundary-key run-close --bundle-store s3 is run
Then it likewise exits 2 with the same bad-enum text — enum rejection is shared and pre-dispatch (§3)
```

**Scenario 4b — publish rejects a well-formed `--bundle-store` value (fail-closed, not accept-and-ignore).**

```
Given a valid run-dir <dir> that would otherwise publish successfully
When faff bundle publish --run-dir <dir> --boundary-kind run-close --boundary-key run-close --bundle-store local is run
Then the exit code is 2 and stderr names the refusal (contains "--bundle-store is not valid for publish"),
  and NO bundle is published — publish never silently ignores the flag (reverses the earlier accept-and-ignore
  posture; the --run-id false analogy is not relied upon)
```

**Scenario 5 — no config read for occupant selection, proven against a malformed enclosing config.**

```
Given a CLEAN capture at <capture> sitting inside a checkout whose .faffrc.yaml is malformed
  (fails parseConfigMapStrict — e.g. a top-level YAML sequence instead of a mapping)
When faff bundle verify --root <capture> --bundle-store local ... is run
Then the verdict is CLEAN and the exit code is 0 — the malformed .faffrc is never read on this path
  (grounded in §4: occupant selection is verify's only .faffrc-touching step, and the override bypasses it)

Given the same <capture> and the same malformed .faffrc.yaml
When faff bundle verify --root <capture> ... is run WITHOUT --bundle-store
Then it exits 2, and stderr surfaces the config fault — it names the malformed .faffrc.yaml and carries the
  base-parse-error catch message (readBaseConfigStrict's loud warning followed by the verify action's catch).
  The absent-flag path visibly fails on exactly the fault the override path bypasses.
```

**Scenario 6 — the default (absent-flag) path still constructs the local occupant for a valid local config.**

```
Given a CLEAN capture at <capture> whose enclosing checkout has a VALID .faffrc.yaml with bundle_store: local
  (or no bundle_store key — the local default) — the ordinary-repo case
When faff bundle verify --root <capture> ... is run WITHOUT --bundle-store
Then the verdict is CLEAN and the exit code is 0 — resolveBundleStore(root) routes through
  bundleStoreByName("local", root) and reads the capture's own tree. Exercises the refactored default path for
  the LOCAL occupant, which neither Scenario 2 (git-remote config) nor Scenario 5's second run (throws before
  occupant construction) reaches — so a build that breaks bundleStoreByName/resolveBundleStore for a valid
  local config is caught here, making "byte-for-byte unchanged" decidable.
```

## 6. DESIGN DECISION RATIONALE

**How should a capture be verifiable in place, ignoring an enclosing checkout's `bundle_store`?**

- **Option A — explicit `--bundle-store` override on `bundle verify`.** Pros: tiny, self-contained; `verifyBundleIdentity` already takes `opts.store`; mirrors the shipped `audit seal` / `audit export` flag name/enum/posture; opt-in, so zero regression to existing invocations; for `git-remote`, the remote-resolution mechanism is identical to today's config-driven path (§1). Cons: the operator must know to pass it (mitigated: FAFF-360's in-place verify step becomes `--bundle-store local`); the flag rides the shared `BUNDLE_SPEC` table.
- **Option B — a Commissaire-native `audit verify` for bundles that reads no config.** Pros: config-blind by construction; no flag to remember. Cons: a whole new verb; the standalone facade's import-independence constraints (`resolveFacadeStore` refuses git-remote in-process) make a config-blind verify a larger build than the bug warrants; duplicates verify logic across two entry points.

**Chosen:** Option A — add an explicit `--bundle-store local|git-remote` override to `faff bundle verify`, routed through a shared `bundleStoreByName` helper, mirroring `audit seal` / `audit export`'s flag/enum/posture within `bundle.js`'s own resolution path. Rationale: minimal, precedent-consistent, reuses the existing `opts.store` seam and enum machinery, leaves the config walk-up untouched, and introduces no new remote-resolution mechanism (§1). Option B remains the extension point (§2).

**On what invariant should the newly-reachable `git-remote` value be gated?** (Operator-ratified that it IS a code gate, 2026-09-25; the 2026-09-21 park is closed. This decision settles the *predicate*, folding the round-1 objection that it gated repository identity rather than the fetch target.)

- **Option G1 — documentation/operating-boundary note only.** The override *newly* makes `git-remote` reachable by flag against an arbitrary root, and git resolves `origin` from that root (§1) — a fail-open trust-root widening (egress, credential-helper, forged-CLEAN). A note does not stop it. **Rejected by the operator.**
- **Option G2 — refuse ALL explicit `--root` under `git-remote`.** Trivially mechanical but over-broad — refuses a legitimate git-remote verify against the operator's own checkout addressed by `--root`.
- **Option G3 — refuse when `--root`'s git-common-dir differs from the invoker's (`gitCommonDir` equality, the round-1 predicate).** Appears to test "same repository", but **defeated by indirection**, grounded: for a directory whose `.git` is a FILE gitlink into the invoker's checkout, `git rev-parse --git-common-dir` returns the invoker's `.git` (falsely equal); for a directory whose `.git` is a SYMLINK into it, the common dir resolves (via realpath) to the invoker's `.git` (falsely equal) *while `origin` resolves to the invoker's own URL*. Both are attacker-controlled directories that this predicate TRUSTS. It also leans on "one common dir per repo", which is false under bind-mount/overlay filesystems (two repos can share a common-dir inode → realpath collapse → fail-open). **Rejected — it gates repository identity, not the fetch target.**
- **Option G4 — refuse unless `--root` is a plain subdirectory of the invoker's OWN working-tree top-level (path-containment) AND their resolved `origin` URLs match.** `git rev-parse --show-toplevel` returns `<root>` itself for a nested checkout, a `.git`-file gitlink, or a symlinked `.git` (grounded), so all three fail top-level equality and are refused; a plain subdirectory of the invoker's checkout shares the top-level and passes. Path-containment *structurally guarantees* `git -C root` uses the operator's own `.git/config`, hence the operator's own `origin` — the fetch target the objection names. The `origin`-URL equality check states that invariant explicitly (it cannot independently reject a containment-passing root, since same top-level ⇒ same config, but it is the machine-checkable fetch-target assertion and a guard against future loosening; origin-identity *alone* is insufficient because the symlink case resolves to the invoker's own URL). No dependence on common-dir inode identity, so the bind-mount fail-open is sidestepped. Cost: two read-only `git` queries per gated invocation. Refuses same-repo linked worktrees (different top-level) — an accepted fail-closed over-strictness (§2), remedied by running from inside the worktree or using `--bundle-store local`.

**Chosen:** Option G4 — gate `--bundle-store git-remote` behind `isGitRemoteRootTrusted(root, process.cwd())` = canonicalized working-tree-top-level path-containment plus resolved-`origin` equality; refuse (exit 2, no remote git op) when untrusted. The gate keys strictly on the explicit flag, never the config-driven path (§2), so it widens no existing behaviour and cannot regress FAFF-208 or Scenario 2. `--bundle-store local` stays the safe default for untrusted captures. The predicate is settled (path-containment is the minimal test closing the nested / gitlink / symlink escapes G3 admits); over-strictness (linked worktrees) and over-looseness (the three escapes) are pinned by Scenario 3c and the §4 failure-mode fixtures rather than left open.

**How should `bundle publish` treat `--bundle-store`?** (Operator-ratified secondary; the earlier `--run-id`-analogy justification was called a **false analogy**.)

- **Option P1 — accept-and-ignore (the earlier posture).** Silently drops an operator-supplied flag — the exact fail-open behaviour FAFF-576 exists to prevent; rested on the `--run-id` analogy the operator rejected. **Rejected.**
- **Option P2 — make it unknown to `publish` (per-action specs).** `parseArgs` would reject it as unknown-flag, but `BUNDLE_SPEC` is one shared CommandSpec parsed once for both actions; splitting into per-action specs is a larger refactor of `cmdBundle`'s dispatch than the bug warrants. **Rejected as disproportionate.**
- **Option P3 — explicit reject in the `publish` action body.** Minimal (a two-line guard); fail-closed and self-documenting; consistent with FAFF-576. The rejection lives in the action, not the parser (acceptable — parse still rejects malformed *values* via the enum).

**Chosen:** Option P3 — `bundle publish` rejects any `--bundle-store` value with an explicit exit-2 error. It does not rely on the `--run-id` analogy; the other shared verify-only flags keep their existing behaviour (out of scope).

At the time of writing, `bundle verify` has no store override, `commissaire audit seal` / `audit export` do, and neither the override nor `publish` had a fail-closed posture for this flag; these decisions close that asymmetry without opening a third pattern.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. All three design calls (override vs new verb; git-remote code gate + trust predicate; publish rejection) are resolved in §6 per the operator ratification.

**Assumptions.**

- **Assumes:** `verifyBundleIdentity(identity, opts)` honours `opts.store` when present and only falls back to `resolveBundleStore(opts.root)` when absent. Validate: confirmed at `bundle.js` `verifyBundleIdentity` (`const store = opts.store || resolveBundleStore(root)`); re-confirm before wiring.
- **Assumes:** occupant selection (`resolveBundleStore`) is the only `.faffrc`-reading step on the verify path — `validateIdentityForHandle`/`classifyBundle` are pure and the occupants read no `.faffrc`. Validate: confirmed by the `verifyBundleIdentity` call graph in §4 (`bundle.js` ≈ 1072–1092); re-confirm no `.faffrc` read is added to steps 2–5.
- **Assumes:** `git -C <dir> rev-parse --show-toplevel` returns the working-tree top-level git associates with `<dir>`, and returns `<dir>` itself (not the referent's top-level) when `<dir>`'s `.git` is a nested repo, a file-gitlink, or a symlink — the property the gate relies on. Validate: run `git -C <ext> rev-parse --show-toplevel` in a fixture where `<ext>/.git` is a gitlink/symlink into another repo and confirm it prints `<ext>`; confirm a plain subdirectory prints the enclosing checkout root.
- **Assumes:** `git -C <dir> remote get-url origin` prints the configured `origin` URL and exits non-zero ("No such remote 'origin'") when absent — a read-only local query that contacts no remote, invokes no credential helper, and runs no hook. Validate: confirmed by running against a repo with and without an `origin`; the trust probe treats a non-zero exit as `null` (untrusted).
- **Assumes:** the module's `gitRun`/`gitRunText` helpers append each git subcommand's argv (after `-C <root>`) to `__gitArgvSpy` when `setGitArgvSpy(arr)` has armed it, and `setGitArgvSpy` is exported — so a selftest can assert no `ls-remote`/`fetch`/`push` ran on the refusal path. Validate: confirmed at `bundle.js` (`__gitArgvSpy`, `setGitArgvSpy`, the spy push in `gitRun`/`gitRunText`, and the `module.exports`); the trust probe MUST route through `gitRunText` for the spy to capture it.
- **Assumes:** a failed `git ls-remote` (non-zero exit) maps to `store-unreachable` → `bundle-unreadable` → `VERIFICATION_UNAVAILABLE`/2, while a reachable-but-empty `ls-remote` maps to `bundle-missing` → `MISSING`/1. Validate: confirmed at `bundle.js` `gitReadRefManifest`, `gitRemoteBundleStore.headDigest`, `classifyBundle`; re-confirm before pinning Scenario 2/3.
- **Assumes:** `parseArgs` supports an `enum` constraint on a flag spec (as `--boundary-kind` uses) and enum rejection is pre-dispatch and shared across actions. Validate: `--boundary-kind` carries `enum: BUNDLE_BOUNDARY_KINDS`; reuse the shape for `--bundle-store`. Confirmed at `argv.js` `bad-enum`.
- **Assumes:** `BUNDLE_SPEC` is a single shared CommandSpec parsed once for both `publish` and `verify` (a flag cannot be marked unknown-to-one-action-only), so `publish`'s rejection of `--bundle-store` must be an explicit guard in the `publish` action body. Validate: confirmed the single `BUNDLE_SPEC` + `cmdBundle` post-parse dispatch on the action positional (`bundle.js` ≈ 1105–1181).
- **Assumes:** the invoker anchor is `process.cwd()`; the verify action resolves `root` as `values["--root"] || findRoot()`, and `findRoot` walks from `process.cwd()` — so an omitted `--root` resolves inside the invoker's own working tree and is trusted by construction. Validate: confirmed `cmdBundle` root resolution (`bundle.js` ≈ 1122) and `findRoot` (`shared-infra.js` ≈ 30–38).
- **Assumes:** `localBundleStore(root)` and `gitRemoteBundleStore(root)` are both in scope in `bundle.js` at the verify call site. Validate: both referenced in `bundle.js` (`resolveBundleStore`, module exports); no new import needed.
- **Assumes:** `readBaseConfigStrict` throws `base-parse-error` (after a loud stderr warning) on a malformed/unreadable `.faffrc.yaml`, unless `FAFF_CONFIG_BASE_LENIENT` is set — so an absent-flag verify against a malformed enclosing config surfaces as a caught exception → exit 2. Validate: confirmed at `shared-infra.js` `readBaseConfigStrict` (≈ 676–689) and the verify action's `catch` (`bundle.js` ≈ 1164–1167).

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff bundle verify --root <capture> --bundle-store local` returns `CLEAN` (exit 0) on a capture that returns `MISSING`/`VERIFICATION_UNAVAILABLE` today when the capture sits inside a `bundle_store: git-remote` checkout (Scenario 1).

### From WHAT (interfaces)
- [ ] `BUNDLE_SPEC.flags` includes `--bundle-store` with `arity: 1` and `enum: BUNDLE_STORE_OCCUPANTS`.
- [ ] The `verify` usage string lists `[--bundle-store local|git-remote]`, and a selftest step asserts it.
- [ ] `bundleStoreByName(name, root)` exists as the single occupant-construction site *within `bundle.js`*; `resolveBundleStore(root)` routes through it (behaviour unchanged). (No claim about `commissaire.js`'s `resolveFacadeStore` — §2.)

### From WHAT / HOW (the git-remote fetch-target trust gate)
- [ ] `isGitRemoteRootTrusted(root, invokerCwd)` exists as a testable helper that (a) requires `git rev-parse --show-toplevel` on both `root` and `invokerCwd` to be non-empty and, after `realpath`, EQUAL; (b) requires `realpath(root)` to be lexically contained in that top-level; (c) requires `git remote get-url origin` on both to succeed and be EQUAL; returning `false` if any fails. It routes its git calls through `gitRunText`.
- [ ] `isGitRemoteRootTrusted` returns `false` for each of: an independent `git init` repo; a nested-`.git` directory; a `.git`-file-gitlink-into-invoker directory; a symlinked-`.git`-into-invoker directory; a `git worktree add` linked worktree of the invoker's repo; a non-repo `root` or `invokerCwd`; a `root` with no `origin` (Scenario 3c).
- [ ] `isGitRemoteRootTrusted` returns `true` for the invoker's own checkout root and for a subdirectory of it that has an `origin` (Scenario 3c).
- [ ] `faff bundle verify --root <ext> --bundle-store git-remote` where `<ext>` is untrusted exits 2, stderr contains `refusing --bundle-store git-remote against an untrusted --root`, and NO `git ls-remote`/`fetch`/`push` runs (asserted via the `setGitArgvSpy` recording) and the ext:: origin sentinel file is absent — the gate returns before occupant construction (Scenario 3b).
- [ ] The trust probe invokes no credential helper: against an untrusted `<ext>` whose `credential.helper` is a sentinel-touching command, the sentinel is absent after the refusal (Scenario 3d).
- [ ] The gate does NOT fire on the absent-flag config-driven path (Scenario 2 still yields `VERIFICATION_UNAVAILABLE`/2, not a refusal) and does NOT fire for `--bundle-store local` against an untrusted `<ext>` (Scenario 3b's contrast).

### From HOW (behaviour)
- [ ] When `--bundle-store` is present (and, for `git-remote`, the root is trusted), the verify action constructs the named occupant via `bundleStoreByName` and passes it as `opts.store` — no `.faffrc` read for occupant selection, none added elsewhere on the path. Falsifiable: Scenario 5's first run (malformed enclosing config + `--bundle-store local` → CLEAN/0).
- [ ] When `--bundle-store` is absent, the verify action performs no store construction and `verifyBundleIdentity` resolves via `resolveBundleStore(root)` exactly as before. Falsifiable: Scenario 6 (valid `local` config, absent flag → CLEAN/0) and Scenario 5's second run (malformed config, no flag → exit 2).
- [ ] `--bundle-store git-remote --root <trusted>` constructs the git-remote occupant: verify against a bundle published only via git-remote returns `CLEAN`/0, while `--bundle-store local` at the same root returns `MISSING`/1 (Scenario 3).
- [ ] A `--bundle-store git-remote` verify against a **reachable** origin from which the ref has been removed yields `MISSING`/1 (`ls-remote` exit 0, empty output → `bundle-missing`), distinctly from the **unreachable**-origin `VERIFICATION_UNAVAILABLE`/2 mapping (Scenario 3 / Scenario 2; grounded in §4).

### From HOW (publish rejection + edge cases)
- [ ] `faff bundle publish --bundle-store <local|git-remote>` exits 2 with stderr containing `--bundle-store is not valid for publish`, and publishes nothing (Scenario 4b) — reversing the earlier accept-and-ignore posture.
- [ ] `--bundle-store <unknown>` (e.g. `s3`) exits 2 on **both** `verify` and `publish` via the `parseArgs` `bad-enum` usage error (stderr contains `not in local|git-remote`) (Scenario 4).

### Tests
- [ ] A `bundle --selftest` case block covers Scenarios 1–6 (incl. 3b/3c/3d/4b) 1:1, using network-free git fixtures throughout (a local bare repo as `origin` for the CLEAN / reachable-but-empty git-remote cases; a nonexistent local path as `origin` for the unreachable case; an `ext::` sentinel origin + a sentinel `credential.helper` for the no-fetch/no-helper cases; an independent `git init`, a nested `.git`, a `.git`-file gitlink, a symlinked `.git`, and a `git worktree add` for the trust-predicate cases) so no coverage depends on network reachability or can hang on a real fetch.
- [ ] `isGitRemoteRootTrusted` is exercised directly (deterministic, explicit `(root, invokerCwd)` args) for every classification row in Scenario 3c.
- [ ] The no-fetch observable is asserted via `setGitArgvSpy`: after a refusal, the recorded argv contains no `ls-remote`/`fetch`/`push`.
- [ ] A selftest step asserts the `verify` usage string contains `[--bundle-store local|git-remote]`.
- [ ] A selftest step asserts `faff bundle publish --bundle-store local` exits 2 with the refusal message and `faff bundle publish --bundle-store s3` exits 2 with the bad-enum message.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Build a CLEAN local capture under <tmp>/cap/.faff/bundles/<rid>/seg-0/run-close/ (+ anchor).
  2. Place <tmp>/cap inside a checkout whose .faffrc.yaml sets bundle_store: git-remote, and whose
     "origin" remote points at a nonexistent local path (network-free, deterministic).
  3. Run: faff bundle verify --root <tmp>/cap --bundle-store local --run-id <rid> --run-segment-id 0 \
          --boundary-kind run-close --boundary-key run-close --json
  4. ASSERT verdict == "CLEAN" and exit code == 0.
  5. Re-run the same identity WITHOUT --bundle-store.
  6. ASSERT verdict == "VERIFICATION_UNAVAILABLE" and exit code == 2 (config-driven git-remote occupant's
     ls-remote exits non-zero against the nonexistent origin -> store-unreachable -> bundle-unreadable ->
     VERIFICATION_UNAVAILABLE; no network, no hang; distinct from step 4; gate does not fire on this path).
  7. Create <tmp>/ext with a .git symlink into <tmp>/cap's enclosing checkout and an ext:: sentinel origin;
     run --bundle-store git-remote --root <tmp>/ext from an invoker cwd whose own checkout is a DIFFERENT
     working tree.
  8. ASSERT exit code == 2, stderr contains "refusing --bundle-store git-remote against an untrusted --root",
     the sentinel file does not exist, and the recorded git argv contains no ls-remote/fetch/push.
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized (principle 4).** One "complex"-tier ticket carrying three coupled, always-ship-together concerns — the `--bundle-store` override on `verify`, the `isGitRemoteRootTrusted` fail-closed gate against an untrusted `--root`, and the fail-closed `--bundle-store` rejection on `publish`. `--bundle-store` rides the single shared `BUNDLE_SPEC`, so adding the flag forces `publish`'s posture; and shipping the verify override without the git-remote gate would ship the fail-open trust widening the ticket exists to close. Keep it whole; hold the line at the three named concerns and keep the §2 out-of-scope items out.

**Workstream fit (principles 1 + 5).** Project-less Backlog is the correct home for a follow-up whose outcome stream (verifiable capture replay — FAFF-861, FAFF-1000, FAFF-360) is already Done; one cohesive outcome. No issues.

**Surfaced dependencies (principle 6).** Every prerequisite is Done and named; the remaining constraints are must-not-regress relations to FAFF-208 (config walk-up) and FAFF-576 (fail-closed parsing), correctly encoded as Scenario 2 / scope statements rather than blocker links. No issues.

**Risk profile (principle 7).** The novel, security-load-bearing piece is `isGitRemoteRootTrusted` — path-containment over `--show-toplevel` plus resolved-`origin` equality, threading nested `.git`, file-gitlinks, symlinked `.git`, linked worktrees, and `safe.directory`. Too loose re-opens the escapes a common-dir predicate admitted; too strict refuses a legitimate in-tree verify. Build-ordering recommendation (not added scope — the spec already specifies these fixtures): sequence the trust predicate and its adversarial network-free fixtures first as a thin de-risking commit — prove red-for-attacker (independent `git init`, nested `.git`, `.git`-file gitlink, symlinked `.git`, neither-in-a-repo) and green-for-in-tree (own checkout root, subdirectory) before wiring the flag, and pin the no-fetch observable (argv seam + `ext::` sentinel) in that same first commit so the fail-open widening cannot regress unnoticed.
