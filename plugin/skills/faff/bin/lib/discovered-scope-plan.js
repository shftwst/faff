"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdDiscoveredScopePlan = cmdDiscoveredScopePlan;
// === region:factory — form an autonomous candidate from supplied filing facts ===
const { parseArgs, usageError } = require("./argv");
const { readValidateInput } = require("./ratified-scope");
const { cmdContain } = require("./contain");
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function id(value) {
    return typeof value === "string" && value.trim().length > 0 && !value.startsWith("-");
}
const appetites = ["low", "medium", "high", "full"];
const relationships = ["blocker", "blocked-by", "peer", "none", "parent"];
const priorContainments = ["contained", "outward-new-root", "outward-self-intake"];
function plan(facts, audit) {
    if (!record(facts))
        throw new Error("expected a filing facts object");
    if (facts.confidence === "vague")
        return { action: "surface", containment: null, reason: "vague" };
    if (facts.confidence !== "concrete")
        throw new Error("confidence must be concrete or vague");
    const { mandate, parent, appetite, opinionated, relationship, ancestry } = facts;
    const prior = facts.prior_containment ?? null;
    const link = facts.relationship_target ?? null;
    const target = facts.target ?? { team: null, repo: null };
    if (!id(mandate))
        throw new Error("mandate must be an issue or container ID string");
    if (parent !== null && !id(parent))
        throw new Error("parent must be an ID string or null for a root");
    if (ancestry !== undefined && !Array.isArray(ancestry))
        throw new Error("ancestry must be an array of tracker ancestry entries");
    if (typeof appetite !== "string" || !appetites.includes(appetite))
        throw new Error("appetite must be " + appetites.join("|"));
    if (typeof opinionated !== "boolean")
        throw new Error("opinionated must be a boolean");
    if (typeof relationship !== "string" || !relationships.includes(relationship))
        throw new Error("relationship must be " + relationships.join("|"));
    if (relationship === "none" ? link !== null : !id(link)) {
        throw new Error("relationship_target must be an ID string for a link or null for none");
    }
    if (prior !== null && (typeof prior !== "string" || !priorContainments.includes(prior))) {
        throw new Error("prior_containment must be null or " + priorContainments.join("|"));
    }
    if (!record(target))
        throw new Error("target must be a {team, repo} object when supplied");
    const placement = parent === null ? ["--root"] : ["--parent", parent];
    const graph = ancestry === undefined ? [] : ["--ancestry", JSON.stringify(ancestry)];
    const captureOnly = () => { };
    const result = cmdContain([mandate, ...placement, ...graph, ...audit, "--json"], captureOnly);
    if (result !== 0 && result !== 3)
        throw new Error("containment check failed");
    let self = false;
    if (result === 3) {
        const { cmdSelfIntake } = require("./self-intake");
        const intake = cmdSelfIntake([mandate, "--target", JSON.stringify(target), ...audit, "--json"], captureOnly);
        if (intake !== 0 && intake !== 3) {
            return { action: "surface", containment: "outward-new-root", reason: "self-intake-check-failed" };
        }
        self = intake === 0;
    }
    if (!self && (result === 3 || prior === "outward-new-root")) {
        return { action: "surface", containment: "outward-new-root", reason: "outside-mandate" };
    }
    const containment = self ? "outward-self-intake" : "contained";
    if (appetite === "low" || (appetite === "medium" && !opinionated)) {
        return { action: "surface", containment, reason: "appetite-withholds" };
    }
    return {
        action: "may-file", containment, reason: "appetite-allows",
        proposal: {
            mandate, relationship, relationship_target: link, status: "Backlog",
            intake: { via: "jot", initiated: "autonomous" },
            ...(self ? { destination: "self-intake", omit_automation_label: true } : { parent }),
        },
    };
}
const spec = { flags: { "--facts": { arity: 1 }, "--record": { arity: 1 }, "--phase": { arity: 1 } }, positionals: { max: 0 } };
const usage = "usage: faff discovered-scope-plan --facts FILE|- [--record RUN-ID [--phase run|tidy]]";
function cmdDiscoveredScopePlan(args) {
    if (args.length === 1 && args[0] === "--help") {
        console.log(usage + '\nExample facts:\n{"confidence":"concrete","mandate":"A","parent":"B","ancestry":[{"id":"B","parentId":"A"}],"appetite":"high","opinionated":false,"relationship":"parent","relationship_target":"B"}');
        return 0;
    }
    const { values, errors } = parseArgs(args, spec);
    const source = values["--facts"];
    const run = values["--record"];
    const phase = values["--phase"];
    if (errors.length || !source || run?.startsWith("-") || (phase !== undefined && (!run || !["run", "tidy"].includes(phase)))) {
        return usageError(errors, usage);
    }
    const audit = run === undefined ? [] : ["--record", run, "--phase", phase ?? "run"];
    try {
        const input = readValidateInput(source === "-" ? null : source);
        if (!input.ok)
            throw new Error("facts exceed one MiB");
        const facts = JSON.parse(input.text);
        process.stdout.write(JSON.stringify(plan(facts, audit)) + "\n");
        return 0;
    }
    catch (error) {
        process.stderr.write(`faff discovered-scope-plan: ${error instanceof Error ? error.message : String(error)}\n`);
        return 2;
    }
}
