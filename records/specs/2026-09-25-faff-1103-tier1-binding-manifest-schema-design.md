# FAFF-1103 — Tier-1 binding manifest schema

> Spec: faffter-dark-nlspec · 2026-09-25 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1103. Revised 2026-09-25 after round-1 spec-review (exit-code parity fix: valid-JSON non-object → exit 1, matching profile.js).

This spec defines the **Tier-1 binding manifest**: a declarative descriptor a project commits so faff's code-blind holdout can drive a plain code interface (a class, a set of functions) over the session RPC wire (FAFF-1102) with zero project code. The audience is the build agent that will implement the manifest's schema and its validator, and the human reviewers who gate this ticket. The runnable per-runtime reflection adapter that consumes the manifest is FAFF-1104; the env-slot branch that starts the bridge is FAFF-1105. Both are out of scope here: this ticket ships the descriptor's shape and the mechanism that validates it.

## 1. WHY — problem and principles

**The load-bearing model.** faff's code-blind holdout works because the judge reaches the system under build only over a wire, never in-process, so the judge's own process never contains the source. FAFF-1102 froze a universal wire for code interfaces (`open` / `call` / `call_static` / `close`). But the wire alone cannot tell a per-runtime adapter *which* real symbol to construct or *which* ops to expose. The binding manifest is the missing declaration: for each bindable entity it names the real entry symbol, how to construct it, and which ops are callable, so the FAFF-1104 adapter can reflect and drive the component with no project-written bridge code. Its security-critical property is that it can name real symbols only. It has no field capable of carrying behaviour, so a builder cannot use it to fake a result.

**Problem statement.** Today faff can only judge running services, and FAFF-1102's wire gives code interfaces a transport but no way to say what to bind. Without a declarative, tamper-resistant descriptor, a project would have to hand-write a bridge (project code the builder controls, which could fake results) or the harness could not bind the component at all. This ticket defines a descriptor that names symbols declaratively and a validator that proves the descriptor carries names only.

### Design principles

**Names only, structurally, never by discipline.** Every field the manifest exposes is a string name, a bare-identifier-or-dotted-path symbol, an integer count, or a value drawn from a closed enum. No field's value space includes a function body, a script, an expression to evaluate, a canned return value, or a mock. This mirrors the wire's `ThrownError` discipline: the descriptor never carries anything an evaluator or adapter would execute. This is what separates Tier-1 (cannot fake, so trustworthy) from Tier-2 (the escape hatch that can fake and is human-judged).

**Descriptor authorship, not producer authorship.** The manifest is authored by the project (a human deciding, intentionally, which symbols to expose), not emitted by an LLM producer at a gate. That authorship places it in faff's descriptor class, not its contract class (see the rationale in section 6).

**The frozen contracts do not move.** `env-handle`, `holdout-verdict`, `lane-boundary`, and the `transport` slot's inline return are untouched. The manifest is a new, separate artifact. It extends none of them and adds no field to any of them.

**The manifest defends the descriptor, not the SUT.** The manifest guarantees the *descriptor* cannot carry behaviour. It does not, and cannot, guarantee the *named symbol* behaves honestly. A dishonest SUT is the same existing risk the wire's threat model already accepts (a service can fake HTTP responses today), caught downstream by the born-verifiable holdout scenarios and the FAFF-1105/1107 topology check, not by this schema.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `docs/reference/session-rpc-wire.md` | Markdown (design) | FAFF-1102 wire the manifest's fields map onto (`open`/`call`/`call_static`/`close`); frozen. |
| `plugin/skills/faff/bin/lib/profile.js` | JavaScript | The `validateProfile` + `faff profile validate` descriptor precedent this ticket mirrors (0/1/2 exit, no `faff contract` entry, no `.schema.json`). |
| `plugin/skills/faff/bin/lib/contract-engine.js` | JavaScript | The schema-subset validator (`type`/`required`/`properties`/`enum`/`additionalProperties`/`items` only; no `pattern`), which is why names-only checks live in a JS validator, not a schema. |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript | The contract class (compute fn + `.schema.json` + `--describe`) the manifest deliberately does **not** join, and why. |
| `plugin/skills/faff/references/kernel.md` (~line 135) | Markdown | "Descriptor blocks are a distinct class" — blesses a future descriptor validated by its own command rather than `faff contract`. |
| `plugin/skills/faff/bin/faff` (~line 225), `bin/lib/regions.js` (~lines 268, 497) | JavaScript | Verb dispatch map + region/selftest registration a new `manifest` verb wires into. |

**Scope statement.** This is the declarative-descriptor layer sitting between FAFF-1102's frozen wire (below it) and FAFF-1104's runnable reflection adapter (above it, out of scope).

## 2. OUT OF SCOPE

- **The reflection adapter that consumes the manifest.** Why excluded: it is FAFF-1104, a runnable per-runtime component. Extension point: FAFF-1104 reads a validated manifest, resolves `entry`/`op` symbols by reflection in its runtime, and drives them over the wire.
- **Starting the bridge process (env-slot branch).** Why excluded: it is FAFF-1105. Extension point: the `env` slot's code-interface branch stands the bridge up SUT-side and authors the `env-handle`.
- **Symbol resolution and reflection semantics.** Why excluded: how a dotted path resolves to a live class or function is runtime-specific and belongs to the adapter. Extension point: FAFF-1104's per-runtime resolver.
- **Argument marshalling / rich-type lowering.** Why excluded: the wire (FAFF-1102) already punts rich-type marshalling to the first adapter; the manifest only hints, it does not lower. Extension point: FAFF-1104's marshaller.
- **Keyword-argument lowering and defaulting.** Why excluded: the wire carries positional args only; keyword lowering is explicitly the adapter's job. Extension point: FAFF-1104.
- **A `faff-contract` validator entry / `contracts/*.schema.json` file for the manifest.** Why excluded: the chosen mechanism is the descriptor class (section 6), which by precedent has neither. Extension point: none intended; if a future ticket ever makes the manifest an LLM-producer emission, it would revisit this.
- **Any change to `env-handle`, `holdout-verdict`, `lane-boundary`, or `transport`.** Why excluded: frozen. Extension point: none.

## 3. WHAT — vocabulary, types, and the descriptor

### Vocabulary

| Term | Definition |
|---|---|
| Bindable entity | One class or one group of functions the holdout may drive: a single `Binding` in the manifest. |
| Entry symbol | The real runtime symbol the adapter resolves and constructs or calls (a dotted path, e.g. `myproject.collections.Stack`). |
| Target name | The manifest-local handle a spec criterion names; the wire's `open` `target`. Maps to one entry symbol. |
| Instance op | A method needing a live session: reached via the wire's `call(session_id, op, args)`. |
| Static op | A function needing no session: reached via the wire's `call_static(op, args)`. |
| Names-only | The property that every manifest field is a name, a count, or a closed-enum value; no field can carry executable content. |

### The descriptor

The manifest is a single JSON object. Its normative shape:

```
RECORD BindingManifest:
  schema: Integer               # MUST == 1; the manifest schema version
  runtime: String               # a bare identifier naming the runtime that routes FAFF-1104's adapter
                                #   (recommended vocabulary: node | python | go — see Open Questions)
  bindings: Array<Binding>      # non-empty; one entry per bindable entity

RECORD Binding:
  name: String                  # bare identifier; the target name a spec criterion states (wire `target`)
  entry: String                 # bare-identifier-or-dotted-path; the real symbol the adapter resolves
  construction: Construction    # absent -> the entity is static-only (no session)
                | absent
  instance_ops: Array<OpDecl>   # ops needing a live session (wire `call`); requires `construction`
                | absent
  static_ops: Array<OpDecl>     # ops with no session (wire `call_static`)
                | absent

  CONSTRAINT at least one of {instance_ops, static_ops} is present and non-empty
  CONSTRAINT instance_ops present => construction present
  CONSTRAINT name is unique within bindings

RECORD Construction:
  kind: Enum{ ctor, factory }   # ctor: construct `entry` directly; factory: call a named factory symbol
  factory: String               # present iff kind==factory; bare-identifier-or-dotted-path; returns an instance
           | absent
  arity: ArgArity               # positional constructor-arg hints (counts/types only, NEVER values)

RECORD OpDecl:
  op: String                    # bare-identifier-or-dotted-path; the operation name (wire `op`)
  arity: ArgArity               # positional arg hints

RECORD ArgArity:
  required: Integer             # >= 0; count of required positional args
  optional: Integer             # >= 0; count of further optional positional args (default 0 when absent)
  types: Array<TypeHint>        # OPTIONAL, informational only; per-position hint, JSON base vocabulary
          | absent

ENUM TypeHint: { string, number, integer, boolean, object, array, null, any }
```

Every object level is closed (`additionalProperties:false` in spirit; enforced by the validator's key-allowlist). There is no `value`, `default`, `body`, `script`, `expr`, `returns`, or `mock` field anywhere, by construction.

### How the fields map to the frozen wire (FAFF-1102)

| Wire method / field | Manifest source |
|---|---|
| `open(target, ctor_args)` `target` | `Binding.name` (looked up to `Binding.entry`) |
| `open` `ctor_args` shape (positional) | `Binding.construction.arity` (counts/types; the caller supplies the values, not the manifest) |
| construct via ctor vs factory | `Binding.construction.kind` (+ `factory` symbol) |
| `call(session_id, op, args)` `op` | one of `Binding.instance_ops[].op` |
| `call_static(op, args)` `op` | one of `Binding.static_ops[].op` |
| `close(session_id)` | no manifest field (session lifecycle is the bridge's, FAFF-1104) |

The manifest supplies names and shapes only. Argument *values* are read by the evaluator from the trusted spec criterion's own words, exactly as FAFF-1102 specifies; the manifest never carries them.

### Design decision: the field set

**Chosen:** the field set is `{schema, runtime, bindings[]}` at the top level, and per binding `{name (target), entry (real symbol), construction (ctor|factory + positional arity), instance_ops[], static_ops[]}` as defined in the `BindingManifest` record above. Rationale: this is the minimal set that lets the FAFF-1104 adapter learn the target, how to construct it, and which instance and static ops are exposed, mapping one-to-one onto FAFF-1102's four wire methods, with `runtime` routing the adapter and `schema` versioning the descriptor. Per-decision rationale for the sub-choices (ctor vs factory, two op lists, shape-only arg hints) is in section 6.

### Design decision: the validation mechanism

**Chosen:** the **descriptor block** mechanism (Option A), mirroring `infra-profile`. The manifest is a `faff-contract:tier1-binding-manifest`-tagged block / committed JSON file, validated by a bespoke `faff manifest validate` verb backed by a hand-written `validateManifest` function. It is **not** registered in the CONTRACTS registry and is **not** reachable via `faff contract`. Rationale and the rejected `faff contract` alternative are in section 6.

### Design decision: where the manifest lives and who authors it

**Chosen:** the manifest is **authored by the project (a human)** and **committed to the repo** as `.faff/binding-manifest.json` (parity with `infra-profile`'s stored form at `.faff/infra-profile.json`). Its normative shape is documented as a design artifact at `docs/reference/tier1-binding-manifest.md` (parity with FAFF-1102's `docs/reference/session-rpc-wire.md`). Unlike `infra-profile`, there is **no `mine` acquirer**: which symbols to expose to the holdout is an intentional human decision, not a repo-scannable fact, so the verb offers `validate` only.

### Design decision: names-only enforcement

**Chosen:** the manifest is proven names-only by four structural checks in `validateManifest`, not by author discipline (full check list in section 4). The JSON-Schema subset cannot express an identifier grammar (it has no `pattern`), so the enforcement is a hand-written validator either way; this is a point in favour of the descriptor mechanism, whose precedent (`validateProfile`) is exactly such a validator.

## 4. HOW — behaviour

### The validator

`faff manifest validate [--file PATH]` reads a manifest from `--file` or stdin and exits:

- **0** — valid: the manifest is names-only and structurally conformant.
- **1** — invalid: one or more violations (printed to stderr, one per line) — a bad enum value, a non-identifier symbol, a missing required op set, **or a valid-JSON non-object top level** (`[]`, `null`, a number).
- **2** — malformed: input does not parse as JSON at all (a parse failure; no safe target to validate).

This mirrors `faff profile validate` (`profile.js`) byte-for-byte in exit policy and input handling: `parseProfileInput` throws (→ exit 2) **only** on a JSON parse failure, and a valid-JSON non-object flows into `validateProfile`, which returns the `must be a JSON object` violation (→ exit 1). It accepts either raw JSON or a fenced `faff-contract:tier1-binding-manifest` block (parity with `parseProfileInput`).

**Behaviour summary — validateManifest proves the descriptor carries names only, then checks structural consistency.**

```
PROCEDURE validateManifest(obj) -> Array<String> (violations; empty == valid):
  1. IF obj is not a JSON object: return ["manifest must be a JSON object"]   # a violation -> caller maps to exit 1 (parity with validateProfile). Exit 2 is reserved for a JSON PARSE failure, caught before validateManifest is called.
  2. Structural version + top level:
     a. IF obj.schema != 1: violate "schema must be 1"
     b. IF obj.runtime is not a non-empty bare-identifier string: violate
     c. IF obj.bindings is not a non-empty array: violate; skip per-binding checks
  3. Key allowlist (names-only guard #1): for obj and EVERY nested object, any key
     not in that record's declared field set is a violation
     ("<path>: unknown field '<k>' — the manifest carries names only").
  4. For each binding b at index i:
     a. IF b.name is not a bare identifier: violate
     b. IF b.entry is not a bare-identifier-or-dotted-path: violate
     c. IF neither instance_ops nor static_ops is present/non-empty: violate
     d. IF instance_ops present AND construction absent: violate
     e. IF b.construction present:
        - kind not in {ctor, factory}: violate
        - kind==factory AND factory not a bare-identifier-or-dotted-path: violate
        - kind==ctor AND factory present: violate
        - validate construction.arity (step 6)
     f. For each op in instance_ops + static_ops:
        - op not a bare-identifier-or-dotted-path: violate
        - validate op.arity (step 6)
  5. IF binding names are not unique: violate
  6. PROCEDURE validate_arity(a):
     - a.required not an integer >= 0: violate
     - a.optional present and not an integer >= 0: violate
     - a.types present: not an array, or any element not in the TypeHint enum: violate
       (NB: types is a per-position HINT; it carries no value)
  7. return violations
```

### The names-only structural checks (the security-critical core)

These are the checks that make the manifest **provably** unable to carry behaviour:

1. **Key allowlist, every level.** Any field not in a record's declared set is a violation. A smuggled `body`, `script`, `expr`, `eval`, `returns`, or `mock` field is rejected because it is not an allowed key. This is the primary guarantee.
2. **Identifier grammar on every symbol field.** `runtime`, `name`, `entry`, `factory`, and every `op` must match the names-only grammar: one or more dot-separated segments, each a bare identifier `[A-Za-z_][A-Za-z0-9_]*`. A string containing `(`, `;`, whitespace, `=`, `lambda`, or any non-identifier character (i.e. anything that could form an expression or statement) fails. `name` and instance `op` are restricted to a **single** segment (no dots); `entry`, `factory`, and static `op` permit a dotted path.
3. **No value-bearing field exists.** The only non-string fields are `schema` (integer), `arity.required`/`arity.optional` (integers), `kind` (closed enum), and `types` (array of a closed enum). None of these can carry a caller value, a default value, or an expression. `arity` describes *shape* (how many args), never *content* (what the args are).
4. **Closed enums.** `kind` and each `TypeHint` are checked against fixed sets as violations (exit 1), never fail-loud, matching the `env-handle`/`holdout-verdict` enum-as-violation convention.

Together, checks 1 and 3 mean the manifest's field space contains no slot into which behaviour could be placed; checks 2 and 4 mean every string that *is* present is a bare name or a closed enum, not an expression. That is the structural proof, mirroring the wire's `ThrownError` "never carries anything the evaluator executes".

**Anti-pattern:** enforcing the identifier grammar in a `contracts/*.schema.json` via `pattern`. Why: the dependency-free subset validator (`contract-engine.js`) does not implement `pattern`/regex, so a `pattern` keyword is silently ignored and the guarantee evaporates. The grammar must be checked in `validateManifest`.

**Anti-pattern:** adding a "return value" or "example output" field for adapter convenience. Why: it is exactly the fake-behaviour vector Tier-1 exists to exclude; that need is Tier-2's.

### Failure modes

- **The failure:** the identifier grammar is too strict and rejects legitimate symbols (Python dunders like `__init__`, JS `$`-prefixed names, package-qualified Go symbols). **How you'd know:** real projects' valid manifests exit 1 on well-formed symbols. **What it means:** narrow, do not abandon. The grammar here is a conservative superset of node/python/go identifiers (letters, digits, underscore, dot); the exact per-runtime widening is punted to FAFF-1104 (Open Questions). `__init__` passes the underscore rule; `$` and `[]`/generics do not, and are deferred.
- **The failure:** names-only is necessary but insufficient — a manifest names a real but dishonest symbol (`FakeStack` returning canned values). **How you'd know:** the manifest validates, yet the holdout's born-verifiable scenarios expose the dishonesty (or the FAFF-1105/1107 topology check catches a mis-placed bridge). **What it means:** proceed — this is by design. The manifest's guarantee is "no executable field in the descriptor", not "the named symbol is honest"; SUT dishonesty is the pre-existing wire threat, out of scope here.
- **The failure:** the `runtime` value routes to an adapter that does not exist yet. **How you'd know:** every manifest is unroutable at FAFF-1103 time because no adapter ships until FAFF-1104. **What it means:** proceed — the routable-runtime enum is owned by FAFF-1104's adapter registry (Punt), so FAFF-1103 validates `runtime` only as a bare identifier and does not gate on a closed set.

## 5. Scenarios — main objectives, born verifiable

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a manifest whose only fields are the declared names, symbols, counts and enums
When `faff manifest validate` reads it
Then it exits 0 (the descriptor is names-only and structurally conformant)
```

```
Given a manifest binding carrying an extra field `returns: "[1,2,3]"` (a canned return value)
When `faff manifest validate` reads it
Then it exits 1 with a violation naming the unknown field
And no field in the accepted schema could have held that value
```

```
Given input that does not parse as JSON at all
When `faff manifest validate` reads it
Then it exits 2 (malformed — a JSON parse failure, no safe object to validate)
```

```
Given input that is valid JSON but not an object (a JSON array, number, or null)
When `faff manifest validate` reads it
Then it exits 1 with the "manifest must be a JSON object" violation (parity with `faff profile validate`)
```

- The manifest schema exposes no field whose value space includes a function body, script, expression, canned return value, or mock (assertion; verified by the accepted field-set being closed and value-free).

## 6. Design decision rationale

**Which validation mechanism: descriptor block or `faff contract` validator?**

- **Option A — descriptor block + bespoke `faff manifest validate`** (the `infra-profile` pattern). Pros: matches the artifact's authorship (human/project, deterministic, not an LLM producer); the enforcement is a hand-written JS validator, which the subset schema requires anyway for the identifier grammar; keeps the `faff contract` registry meaning "LLM-producer-emitted blocks gated at read". Cons: no `contracts/*.schema.json` and no `--describe` machinery (acceptable — `infra-profile` has neither).
- **Option B — `faff contract` validator** (compute fn + `contracts/tier1-binding-manifest.schema.json` + `--describe` + CONTRACTS registry). Pros: the standard exit-0/1/2 gate with fixtures, `--describe`, and belt-and-braces `schemaCheck`; well-suited to a hard trust property. Cons: `faff contract` is the read-time gate for **LLM-producer** emissions (`env-handle`, `holdout-verdict`, `lane-boundary` are all producer blocks); the manifest is human-authored, so registering it there miscategorises it and blurs the invariant.

**Chosen:** Option A — the descriptor block. The load-bearing discriminator between faff's two validation classes is **authorship**, not trust-criticality. Every current `faff contract` member is an LLM-producer emission gated at read; `infra-profile` is trust-bearing too (evidence-cited infra facts) yet is a descriptor **because it is deterministically authored**. The kernel makes this explicit: "a future descriptor block follows this class — emitted by the trusted CLI, validated (if at all) by its own command — rather than being wired into `faff contract`" (kernel ~line 135). The manifest is human/project-authored, so it is descriptor-class. Crucially, Option B's headline advantage (active cross-field structural enforcement) is **not** exclusive to `faff contract`: `validateProfile` already performs exactly such enforcement from a bespoke verb, and the names-only identifier grammar *must* live in JS regardless because the subset validator has no `pattern`. So Option A loses no enforcement strength while keeping the class boundary clean. At the time of writing, faff has no LLM producer that emits this manifest; should a future ticket introduce one (emitting the block at a gate), the mechanism should be revisited against this same authorship test.

**How to construct: ctor vs factory?**
- **Chosen:** support both via `Construction.kind`. A `ctor` constructs `entry` directly; a `factory` names a separate callable returning an instance. Rationale: both are common ("drive this class" vs "call this builder"), both map cleanly to the wire's `open`, and both are expressible as names only.

**Instance ops vs static ops: one list or two?**
- **Chosen:** two explicit lists. Rationale: the wire has two distinct methods (`call` needs a session, `call_static` does not); a single list would force the adapter to guess, and the manifest exists precisely to remove guessing. `instance_ops` requires `construction`; `static_ops` does not.

**Arg hints: values or shape only?**
- **Chosen:** shape only — `arity.required`/`optional` counts and an optional per-position `types` hint from a JSON base vocabulary. Rationale: a value field would be a fake-behaviour vector; the evaluator reads actual arg values from the trusted spec criterion, so the manifest needs only enough to reflect arity, and rich types are deferred (below).

## 7. Open questions and assumptions

### Open questions

- **Punt:** the closed set of routable `runtime` values (`node` | `python` | `go` | ...). It equals the set of shipped reflection adapters, which do not exist until FAFF-1104, so FAFF-1103 validates `runtime` as a bare identifier only and does not gate on a closed enum. Context: no `jvm` anywhere in the codebase; `infra-profile` has seen `node`/`python`/`go`. (decides: architecture)
- **Punt:** the arg-type hint vocabulary beyond the JSON base set (dates, arbitrary-precision decimals, binary blobs, sets, enums). This mirrors FAFF-1102's own rich-type-marshalling open question and is entangled with each runtime adapter's reflection, so it defers to the first adapter (FAFF-1104). Until then `types` is limited to `{string, number, integer, boolean, object, array, null, any}`. (decides: architecture)
- **Punt:** the exact per-runtime symbol grammar (JS `$`, Python generics/subscripts, Go package qualification, operator methods). FAFF-1103 uses a conservative dot-and-identifier superset; FAFF-1104's resolver owns any widening once concrete runtimes land. (decides: architecture)
- **Punt:** the resolution scoping of a **static** op's dotted path (module-relative to `entry` vs absolute). FAFF-1103 accepts a dotted path syntactically; FAFF-1104's resolver decides how it resolves. (decides: architecture)

### Assumptions

- **Assumes:** FAFF-1102's wire doc exists at `docs/reference/session-rpc-wire.md` with the four methods and positional-args guarantee. Validate: `git show origin/main:docs/reference/session-rpc-wire.md` (confirmed present at spec time, merged to main).
- **Assumes:** the `infra-profile` descriptor precedent is intact — `validateProfile` + `faff profile validate` (0/1/2), no `contracts/infra-profile.schema.json`, no `faff contract` entry. Validate: read `plugin/skills/faff/bin/lib/profile.js` and `ls plugin/skills/faff/contracts/` (confirmed at spec time).
- **Assumes:** the CLI verb-dispatch map (`plugin/skills/faff/bin/faff`) and region/selftest registries (`bin/lib/regions.js`) accept a new leaf verb the same way `profile` is registered. Validate: read those files around the `profile` entries (confirmed at spec time).

## 8. DONE — definition of done

### From WHY
- [ ] A committed manifest lets the FAFF-1104 adapter learn what to bind with zero project bridge code (the descriptor names entry symbol, construction, and exposed ops).
- [ ] The manifest carries no field capable of holding behaviour (verified by the closed, value-free field set — the Tier-1 vs Tier-2 property).

### From WHAT (types and the descriptor)
- [ ] `BindingManifest` accepts exactly `{schema, runtime, bindings}` and rejects any other top-level key.
- [ ] `schema` must equal `1`; any other value is a violation (exit 1).
- [ ] Each `Binding` accepts exactly `{name, entry, construction?, instance_ops?, static_ops?}`.
- [ ] A binding with neither `instance_ops` nor `static_ops` non-empty is a violation.
- [ ] `instance_ops` present without `construction` is a violation.
- [ ] Duplicate binding `name`s are a violation.
- [ ] `Construction` accepts exactly `{kind, factory?, arity}`; `kind==ctor` with a `factory` present is a violation; `kind==factory` without a valid `factory` symbol is a violation.
- [ ] `ArgArity` accepts exactly `{required, optional?, types?}`; `required`/`optional` are integers `>= 0`; `types` (if present) is an array whose every element is in the `TypeHint` enum.
- [ ] Each wire method/field in the FAFF-1102 mapping table has a named manifest source (or is documented as owned by the bridge).

### From WHAT (mechanism, authorship, location)
- [ ] The manifest is validated by a bespoke `faff manifest validate` verb, not `faff contract`, and no `contracts/tier1-binding-manifest.schema.json` or CONTRACTS registry entry is added.
- [ ] The normative shape is documented at `docs/reference/tier1-binding-manifest.md`.
- [ ] The verb offers `validate` only (no `mine` acquirer).

### From HOW (validator behaviour)
- [ ] `faff manifest validate` exits 0 on a conformant names-only manifest.
- [ ] It exits 1 with per-line stderr violations on a structurally invalid manifest.
- [ ] It exits 2 on input that does not parse as JSON (a parse failure); a valid-JSON non-object top level (`[]`/`null`/number) is a violation → exit 1, mirroring `faff profile validate`.
- [ ] It reads from `--file PATH` or stdin, accepting raw JSON or a fenced `faff-contract:tier1-binding-manifest` block.
- [ ] `validateManifest` is a pure function over the parsed object (no I/O), returning a violations array (empty == valid), mirroring `validateProfile`.

### From HOW (names-only structural checks)
- [ ] Any field not in a record's declared set is a violation, at every nesting level (a smuggled `returns`/`body`/`script`/`mock`/`expr` field is rejected as unknown).
- [ ] `runtime`, `name`, and every instance `op` are single-segment bare identifiers; a non-identifier string (containing `(`, `;`, whitespace, `=`, etc.) is a violation.
- [ ] `entry`, `factory`, and every static `op` are bare-identifier-or-dotted-path; a non-conforming string is a violation.
- [ ] `kind` and `TypeHint` are checked as closed-enum violations (exit 1), never fail-loud (exit 2).
- [ ] No accepted field's value space can hold a caller value, a default value, or an expression (verified by inspection of the field set: only names, integer counts, and closed enums).

### From HOW (verb wiring)
- [ ] The `manifest` verb is registered in `plugin/skills/faff/bin/faff`'s dispatch map.
- [ ] The `manifest` verb has a region assignment and a `--selftest` entry in `bin/lib/regions.js`, mirroring `profile`.
- [ ] `faff manifest validate --selftest` runs an in-lib self-test covering: a conformant manifest (0), a smuggled-field manifest (1), a non-identifier op (1), an instance-op-without-construction manifest (1), a valid-JSON non-object (1), and a non-JSON parse failure (2).

### Integration smoke test

```
PROCEDURE smoke:
  1. Author a minimal manifest: schema=1, runtime="python",
     bindings=[{ name:"Stack", entry:"demo.Stack",
                 construction:{ kind:"ctor", arity:{ required:0 } },
                 instance_ops:[{ op:"push", arity:{ required:1 } },
                               { op:"pop",  arity:{ required:0 } }] }]
  2. `faff manifest validate --file <that>` exits 0.
  3. Add `returns:"[1,2]"` to the pop op; re-run; exits 1 naming the unknown field.
  4. Replace the op name with "pop();import os"; re-run; exits 1 with a grammar violation.
```

If step 2 passes and steps 3-4 fail loud, the descriptor and its names-only guard are wired correctly.

confidence: medium
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "punt" }, { "marker": "punt" }, { "marker": "punt" } ] }
```
