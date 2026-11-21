# Scaffold and check a slot skill

The authoring skill uses the existing structural profiles to scaffold a local `SKILL.md` or check an existing file. The author supplies the name, description, judgement seam and path. The scaffold uses an exclusive final link so an existing file stays intact even if two authors request the same path.

One check accepts a path outside the default install or an installed skill name. It reads the file and returns structural findings. Existing bundled and configured validation retain their scope. Semantic review still tests the slot's actual mapping, obligations and action boundary, and the runtime still invokes the authoring skill's semantic face before first use of a foreign occupant.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `` **Validate** (audit): given an existing slot skill `` | changed: the semantic runtime face keeps its original pass and fail contract and first-use gate |
| `` ## Conformance checklist (what Validate checks, what Author bakes in) `` | changed: the authoring skill uses CLI structural profiles and continues semantic review |
| `` **Names its slot and contract.** `` | changed: the scaffold names the slot and the checker tests its profile |
| `` **Carries refer-back prose.** `` | changed: the scaffold supplies existing refer-back prose and pure rendering stays exempt |
| `` **Recaps are non-normative.** `` | changed: the scaffold keeps the gateway authoritative and the path check verifies the marker |
| `` **Maps onto, never redefines.** `` | changed: the semantic face retains vocabulary and required-output conformance |
| `` **Has both faces / honours its obligations where the slot expects them.** `` | changed: the scaffold covers the declared profiles and the skill retains their semantic obligations |
| `` **Respects appetite.** If the slot acts `` | changed: the semantic face and scaffold both retain the suite's appetite |
| `` **Stays in its lane.** Adaptors translate/validate `` | changed: the semantic face checks the consumer-owned boundaries |
| `` **Declares its judgement seam.** `` | changed: the CLI checks the field and the author retains eval registration |
| `` Given the target slot + a one-line description, emit a skeleton `` | changed: the CLI writes the supported file without replacing an existing path |
| `` does and which slot it fills> `` | changed: the scaffold emits the role-specific contract pointers and the dialect outline |
| `` Fill the dialect; leave the contract pointers exactly as scaffolded. `` | changed: the author still fills the dialect and preserves the pointers |
| `` Given a slot skill (name or path), read it and run the checklist. `` | changed: the CLI checks either input form and the skill finishes semantic review |
| `` `pass` when no item fires `` | changed: the final pass requires both checks and failures remain violations |
| `` **Mechanical pre-check.** The bundled `faff validate-adapters` command `` | changed: bundled and configured linting remain, with an explicit path check for foreign files |
