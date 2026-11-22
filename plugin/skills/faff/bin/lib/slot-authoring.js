"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdSlotAuthoring = cmdSlotAuthoring;
// === region:factory — scaffold and structurally check an explicit slot skill ===
const argv = require("./argv");
const fs = require("node:fs");
const path = require("node:path");
const checkUsage = "usage: faff validate-adapters check --slot SLOT (--path FILE_OR_DIR | --skill NAME [--skills-dir DIR])";
const scaffoldUsage = "usage: faff validate-adapters scaffold --slot SLOT --name NAME --description TEXT --judgement-seam KIND[,KIND...] --path NEW_SKILL.md";
const checkSpec = { flags: { "--slot": { arity: 1 }, "--path": { arity: 1 }, "--skill": { arity: 1 }, "--skills-dir": { arity: 1 } } };
const scaffoldSpec = { flags: {
        "--slot": { arity: 1 }, "--name": { arity: 1 }, "--description": { arity: 1 },
        "--judgement-seam": { arity: 1 }, "--path": { arity: 1 },
    } };
const skillName = /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?$/;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const kindList = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:,\s*[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
function violations(registry, profile, slot, text) {
    const bad = registry.checksFor(profile, text).filter(([ok]) => !ok).map(([, label]) => label);
    if (profile.type !== "pure-adaptor" && profile.type !== "adaptor") {
        if (!registry.referBack.test(text))
            bad.push("refer-back: Read the sibling faff/references/kernel.md when standalone");
        if (!registry.nonNormative.test(text))
            bad.push("recap marked non-normative or gateway wins");
    }
    if (!text.includes(slot))
        bad.push(`names its slot (${slot})`);
    const seam = registry.readJudgementSeam(text);
    if (seam === null || (Array.isArray(seam) && (seam.length === 0 || seam.includes("none") ||
        new Set(seam).size !== seam.length || seam.some((kind) => !slug.test(kind))))) {
        bad.push("frontmatter judgement_seam must declare unique KINDs or none");
    }
    return bad;
}
const contractPointers = {
    adaptor: "Follow Automation-routing verdict (fixed) in the kernel.",
    methodology: "Read `faff/references/methodology.md` and follow The methodology slot.",
    mechanism: "Read `faff/references/l4.md` and follow the concurrency slot contract.",
    "producer-spec": "Follow Spec readiness (fixed) in the kernel.",
    "producer-review": "Follow Review verdict (fixed) in the kernel.",
    "producer-ship": "Follow Delivery outcome (fixed) in the kernel.",
};
function scaffoldText(registry, profile, slot, name, description, seam) {
    const text = [
        "---", `name: ${name}`, `description: ${JSON.stringify(description)}`, "user-invocable: false",
        `judgement_seam: ${seam}`, "---", "", `# ${name}`, "", `Occupies the \`${slot}\` slot. ${description}`, "",
    ];
    if (profile.type === "pure-adaptor") {
        text.push("Rendering has no internal contract.", "");
    }
    else {
        const pointer = contractPointers[profile.type] ?? "Read the lane reference for this slot.";
        text.push("## Contract", "", `**How this contract reaches you.** The invoking consumer loads the gateway. When standalone, Read the sibling \`faff/references/kernel.md\` before applying the slot contract. ${pointer} Any recap is non-normative. The gateway wins.`, "");
    }
    text.push("## Dialect", "", "Author the inputs, procedure and output for this slot. Follow the fixed vocabulary and leave sequencing and gate decisions with the caller.", "");
    const artifact = registry.producerArtifacts[profile.type];
    if (artifact)
        text.push(`Emit the \`faff-contract:${artifact}\` block defined by \`faff contract ${artifact} --describe\`.`, "");
    switch (profile.type) {
        case "adaptor":
            text.push("## Validate", "", `Pipe the extraction to \`faff contract ${profile.contract}\`, the sole source of contract data.`, "");
            break;
        case "pure-adaptor":
            text.push("## Validate", "", "Author the checks for this rendering style.", "");
            break;
        case "methodology":
            text.push("Use the gateway methodology slot envelope. Author an answer for each required output:", "", ...registry.methodologyOutputs.map((name) => `- \`${name}\``), "");
            break;
        case "mechanism":
            text.push("Follow the gateway Mechanism slots contract. Keep each worktree isolated, record terminal outcomes in the run ledger and preserve the merge gate. Include the foreground-to-terminal dispatch clause and never end a turn with work still in flight.", "");
            break;
        case "producer-spec":
            text.push("Include the spec's confidence self-rating.", "");
            break;
        case "producer-intake":
            text.push("Return a discovery brief.", "");
            break;
        case "producer-adr":
            text.push("Return a Nygard ADR body (Context, Decision, Consequences) and advisory confidence.", "");
            break;
        case "producer-transport":
            text.push("Return the resolved base host to the env caller inline.", "");
            break;
        case "producer-env-code-interface":
            text.push("Document the bridge endpoint, `/faff-rpc/health`, transport-constrained host-side reachability and teardown.", "");
            break;
    }
    text.push("## Rules", "", "Author the lane restrictions and apply the suite's appetite where this slot acts.", "");
    return text.join("\n");
}
function writeNew(file, text) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const scratch = fs.mkdtempSync(path.join(dir, ".faff-scaffold-"));
    try {
        const staged = path.join(scratch, "SKILL.md");
        fs.writeFileSync(staged, text, { flag: "wx" });
        fs.linkSync(staged, file);
    }
    finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}
function cmdSlotAuthoring(verb, args, registry) {
    const usage = verb === "check" ? checkUsage : scaffoldUsage;
    const { values, errors } = argv.parseArgs(args, verb === "check" ? checkSpec : scaffoldSpec);
    if (errors.length)
        return argv.usageError(errors, usage);
    const slot = values["--slot"];
    if (typeof slot !== "string" || !Object.hasOwn(registry.profiles, slot)) {
        process.stderr.write(usage + "\nSupported slots: " + Object.keys(registry.profiles).join(", ") + "\n");
        return 2;
    }
    const profile = registry.profiles[slot];
    if (!profile)
        return 2;
    try {
        const explicit = values["--path"];
        if (verb === "check") {
            const name = values["--skill"];
            if ((!explicit && !name) || (explicit && (name || values["--skills-dir"])) || (name && !skillName.test(name))) {
                process.stderr.write(usage + "\n");
                return 2;
            }
            const resolved = explicit ?? registry.locateSkill(registry.resolveSkillsDir(args), name);
            if (!resolved)
                throw new Error("slot skill not found");
            const target = path.resolve(resolved);
            const file = fs.statSync(target).isDirectory() ? path.join(target, "SKILL.md") : target;
            if (!fs.statSync(file).isFile())
                throw new Error("slot skill must be a regular file");
            const bad = violations(registry, profile, slot, fs.readFileSync(file, "utf8"));
            process.stdout.write(JSON.stringify({ signal: bad.length ? "fail" : "pass", scope: "structural", slot, path: file, violations: bad }) + "\n");
            return bad.length ? 1 : 0;
        }
        const name = values["--name"];
        const description = values["--description"];
        const seam = values["--judgement-seam"];
        if (!name || !slug.test(name) || !description?.trim() || /[\r\n]/.test(description) ||
            !seam || !kindList.test(seam) || !explicit || path.basename(explicit) !== "SKILL.md") {
            process.stderr.write(usage + "\n");
            return 2;
        }
        const file = path.resolve(explicit);
        const text = scaffoldText(registry, profile, slot, name, description, seam);
        const bad = violations(registry, profile, slot, text);
        if (bad.length)
            throw new Error(bad.join("; "));
        writeNew(file, text);
        process.stdout.write(JSON.stringify({ path: file, slot }) + "\n");
        return 0;
    }
    catch (err) {
        process.stderr.write(`faff validate-adapters ${verb}: ${err instanceof Error ? err.message : String(err)}\n`);
        return 2;
    }
}
