# Tier-1 binding manifest

> The declarative descriptor a project commits so faff's code-blind holdout can drive a plain code interface (a class, a set of functions) over the session RPC wire with zero project bridge code. It names real symbols only: it has no field that can carry behaviour, so a builder cannot use it to fake a result. Spec: FAFF-1103.

This is the normative specification of the **Tier-1 binding manifest**. It is a design artifact, not a running system: the manifest is authored by the project and validated by `faff manifest validate`; the runnable pieces that consume it are delivered by sibling tickets and named at their extension points below. Read it before implementing the reflection adapter (FAFF-1104), the env-slot code-interface branch (FAFF-1105), or the end-to-end conformance test (FAFF-1107). It sits above the session RPC wire (`docs/reference/session-rpc-wire.md`, FAFF-1102) and maps directly onto it.

## Why this exists

faff's code-blind holdout works because the judge reaches the system under build only over a wire, never in-process, so the judge's own process never contains the source. FAFF-1102 froze a universal wire for code interfaces (`open` / `call` / `call_static` / `close`). But the wire alone cannot say **which** real symbol to construct or **which** ops to expose. The binding manifest is the missing declaration: for each bindable entity it names the real entry symbol, how to construct it, and which ops are callable, so the FAFF-1104 adapter can reflect and drive the component with no project-written bridge.

The manifest's security-critical property is that it can name real symbols only. Every field it exposes is a string name, a symbol path, an integer count, or a value drawn from a closed enum. No field's value space includes a function body, a script, an expression, a canned return value, or a mock. That is what separates Tier-1 (cannot fake, so trustworthy) from Tier-2 (the escape hatch that can fake and is human-judged). The manifest defends the **descriptor**, not the SUT: it guarantees the descriptor cannot carry behaviour, not that the named symbol behaves honestly. A dishonest SUT is the pre-existing wire threat, caught downstream by the born-verifiable holdout scenarios and the topology check, not by this schema.

## Records

The manifest is a single JSON object. Every object level is closed: any key outside the record's declared set is a violation. There is no `value`, `default`, `body`, `script`, `expr`, `returns`, or `mock` field anywhere, by construction.

```
RECORD BindingManifest:
  schema: Integer               # MUST == 1; the manifest schema version
  runtime: String               # a single-segment bare identifier naming the runtime that
                                #   routes FAFF-1104's adapter (e.g. node | python | go)
  bindings: Array<Binding>      # non-empty; one entry per bindable entity

RECORD Binding:
  name: String                  # single-segment bare identifier; the target name a spec
                                #   criterion states (the wire's `open` target)
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
  arity: ArgArity               # positional constructor-arg hints (counts/types only, never values)

RECORD OpDecl:
  op: String                    # the operation name (the wire's `op`); single-segment for an
                                #   instance op, bare-identifier-or-dotted-path for a static op
  arity: ArgArity               # positional arg hints

RECORD ArgArity:
  required: Integer             # >= 0; count of required positional args
  optional: Integer             # >= 0; count of further optional positional args (default 0 when absent)
                | absent
  types: Array<TypeHint>        # OPTIONAL, informational only; per-position hint, JSON base vocabulary
          | absent

ENUM TypeHint: { string, number, integer, boolean, object, array, null, any }
```

### The names-only guarantee

Four structural checks make the manifest provably unable to carry behaviour:

1. **Key allowlist, every level.** Any field not in a record's declared set is a violation. A smuggled `body`, `script`, `expr`, `returns`, or `mock` field is rejected because it is not an allowed key. This is the primary guarantee.
2. **Identifier grammar on every symbol field.** `runtime`, `name`, `entry`, `factory`, and every `op` must be a bare identifier `[A-Za-z_][A-Za-z0-9_]*` or a dot-separated path of such segments. A string containing `(`, `;`, whitespace, `=`, or any other non-identifier character fails. `name` and an instance `op` are restricted to a single segment; `entry`, `factory`, and a static `op` permit a dotted path.
3. **No value-bearing field exists.** The only non-string fields are `schema` (integer), `arity.required` / `arity.optional` (integers), `kind` (closed enum), and `types` (array of a closed enum). None can carry a caller value, a default value, or an expression. `arity` describes shape (how many args), never content (what the args are).
4. **Closed enums.** `kind` and every `TypeHint` are checked against fixed sets. An out-of-set value is a violation (exit 1), never a fail-loud.

Checks 1 and 3 mean the field space has no slot to place behaviour in; checks 2 and 4 mean every string present is a bare name or a closed enum, not an expression. The identifier grammar lives in the JS validator, not a JSON schema: faff's schema-subset validator has no `pattern`, so a `pattern` keyword would be silently ignored and the guarantee would evaporate.

## Mapping to the wire (FAFF-1102)

The manifest supplies names and shapes only. Argument **values** are read by the evaluator from the trusted spec criterion's own words, exactly as FAFF-1102 specifies; the manifest never carries them.

| Wire method / field | Manifest source |
|---|---|
| `open(target, ctor_args)` `target` | `Binding.name` (looked up to `Binding.entry`) |
| `open` `ctor_args` shape (positional) | `Binding.construction.arity` (counts/types; the caller supplies the values) |
| construct via ctor vs factory | `Binding.construction.kind` (+ the `factory` symbol) |
| `call(session_id, op, args)` `op` | one of `Binding.instance_ops[].op` |
| `call_static(op, args)` `op` | one of `Binding.static_ops[].op` |
| `close(session_id)` | no manifest field (session lifecycle is the bridge's, FAFF-1104) |

## The validator

The manifest is authored by the project (a human deciding which symbols to expose) and committed to the repo as `.faff/binding-manifest.json`. Because that authorship is deterministic, not an LLM-producer emission, the manifest is a **descriptor**, not a contract: it is validated by the bespoke `faff manifest validate` verb, mirroring `faff profile validate`. It is not registered in the CONTRACTS registry, is not reachable via `faff contract`, and ships no `contracts/*.schema.json`. The verb offers `validate` only: which symbols to expose is an intentional human decision, not a repo-scannable fact, so there is no `mine` acquirer.

`faff manifest validate [--file PATH]` reads a manifest from `--file` or stdin (raw JSON, or a fenced `faff-contract:tier1-binding-manifest` block) and exits:

- **0** — valid: the manifest is names-only and structurally conformant.
- **1** — invalid: one or more violations, printed to stderr one per line. A bad enum value, a non-identifier symbol, a missing required op set, a duplicate binding name, or a valid-JSON non-object top level (`[]`, `null`, a number) all land here.
- **2** — malformed: the input does not parse as JSON at all (a parse failure; there is no safe object to validate).

The exit policy mirrors `faff profile validate` exactly. A valid-JSON non-object is a **violation** (exit 1), not a parse failure (exit 2): exit 2 is reserved for input that `JSON.parse` cannot read. `validateManifest` is a pure function over the parsed object (no I/O) returning a violations array, so the same core drives the verb and its `--selftest`.

## Out of scope

- **The reflection adapter that consumes the manifest** — FAFF-1104. It reads a validated manifest, resolves `entry` / `op` symbols by reflection in its runtime, and drives them over the wire.
- **Starting the bridge process** — FAFF-1105, the `env` slot's code-interface branch.
- **Symbol resolution and reflection semantics** — runtime-specific; FAFF-1104's per-runtime resolver.
- **Argument marshalling, rich-type lowering, and keyword-argument lowering** — the wire carries positional args only; lowering is FAFF-1104's job. The manifest only hints arity.
- **The closed set of routable `runtime` values, the per-runtime symbol grammar, and the arg-type hint vocabulary beyond the JSON base set** — each equals or entangles a shipped adapter, which does not exist until FAFF-1104. FAFF-1103 validates `runtime` as a bare identifier only and uses a conservative dot-and-identifier grammar; widening is owned by FAFF-1104's resolver.
- **Any change to `env-handle`, `holdout-verdict`, `lane-boundary`, or the `transport` slot's inline return** — frozen. The manifest is a new, separate artifact that extends none of them.
