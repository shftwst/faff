// FAFF-1197 / FAFF-1198 — one `dispatch:` tree pairs model and effort for every subagent-dispatched
// lane, and is the only place a lane's model or effort is set. Covers: the config get/set
// validators, `faff dispatch resolve`, `engine call` reading `dispatch.<lane>.*`, the whole-tree
// validation and the run banner.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { resolveDispatch } from "../plugin/skills/faff/bin/lib/dispatch.js";
import { DEFAULTS, legacyTreeError, removedKeyError } from "../plugin/skills/faff/bin/lib/config.js";

function withConfig(body, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff1197-"));
  if (body !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), body);
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const cli = (dir, ...args) => runCli(args, { cwd: dir });
const NOT_APPLIED_NOTE = " (effort recorded, not applied: Agent tool)";
const ENGINE_OLLAMA = "engines:\n  local:\n    provider: ollama\n    model: m1\n    host: http://h.test:11434\n";

test("no dispatch.* key is registered in DEFAULTS; an unset dispatch key reads as absent (exit 3)", () => {
  assert.deepEqual(Object.keys(DEFAULTS).filter((k) => k.startsWith("dispatch.")), []);
  withConfig(undefined, (dir) => assert.equal(cli(dir, "config", "get", "dispatch.spec.effort").code, 3));
});

test("config set dispatch.spec.effort low writes a block-form node and exits 0", () => {
  withConfig("", (dir) => {
    const r = cli(dir, "config", "set", "dispatch.spec.effort", "low");
    assert.equal(r.code, 0, r.stderr);
    assert.match(readFileSync(path.join(dir, ".faffrc.yaml"), "utf8"), /dispatch:\n {2}spec:\n {4}effort: low/);
    assert.equal(cli(dir, "config", "get", "dispatch.spec.effort").stdout.trim(), "low");
  });
});

test("config get and config set both refuse invalid dispatch keys and values with exit 2", () => {
  const cases = [
    ["dispatch.spec.model", "gpt-5", /invalid model token/],
    ["dispatch.spec.effort", "turbo", /invalid effort token/],
    ["dispatch.build.model", "engine:local", /engine values are only legal on/],
    ["dispatch.methodology.effort", "engine:local", /invalid effort token/],
    ["dispatch.biuld.model", "opus", /unknown dispatch lane biuld/],
    ["dispatch.eval.model", "opus", /eval is not a dispatch lane/],
    ["dispatch.eval.effort", "low", /eval is not a dispatch lane/],
    ["dispatch.spec.temperature", "low", /unknown dispatch field temperature/],
    ["dispatch.build.by_confidence.medium.effort", "high", /ADR-0108.*dispatch\.build\.by_tier/],
    ["dispatch.spec", "{ effort: low }", /use block form/],
    ["dispatch.spec.effort", "{ effort: low }", /use block form/],
    ["dispatch.build.by_tier.huge.model", "opus", /unknown by_tier key huge/],
  ];
  for (const [key, value, message] of cases) {
    withConfig("", (dir) => {
      const set = cli(dir, "config", "set", key, value);
      assert.equal(set.code, 2, `set ${key}=${value}: ${set.stdout}`);
      assert.match(set.stderr, message, `set ${key}`);
    });
  }
});

test("config get refuses invalid dispatch values already in the file", () => {
  const cases = [
    ["dispatch.spec.model", "dispatch:\n  spec:\n    model: gpt-5\n", /invalid model token/],
    ["dispatch.eval.model", "dispatch:\n  eval:\n    model: opus\n", /eval is not a dispatch lane/],
    ["dispatch.spec.effort", "dispatch:\n  spec:\n    effort: turbo\n", /invalid effort token/],
    ["dispatch.build.by_confidence.medium.effort", "dispatch:\n  build:\n    by_confidence:\n      medium:\n        effort: high\n", /ADR-0108/],
    ["dispatch.spec", "dispatch:\n  spec: { effort: low }\n", /use block form/],
    ["dispatch.spec.colour", "dispatch:\n  spec:\n    colour: red\n", /unknown dispatch field colour/],
    ["dispatch.methodology.model", `${ENGINE_OLLAMA}dispatch:\n  methodology:\n    model: engine:nope\n`, /unknown engine "nope"/],
  ];
  for (const [key, body, message] of cases) {
    withConfig(body, (dir) => {
      const r = cli(dir, "config", "get", key);
      assert.equal(r.code, 2, `${key}: ${r.stdout}`);
      assert.match(r.stderr, message, key);
    });
  }
});

test("config get dispatch.build (a node) validates leaves only and reads as before", () => {
  withConfig("dispatch:\n  build:\n    model: sonnet\n", (dir) => {
    const r = cli(dir, "config", "get", "--json", "dispatch.build");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { model: "sonnet" });
  });
});

test("config get dispatch.methodology.model accepts a resolvable engine value", () => {
  withConfig(`${ENGINE_OLLAMA}dispatch:\n  methodology:\n    model: engine:local\n`, (dir) => {
    const r = cli(dir, "config", "get", "dispatch.methodology.model");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "engine:local");
  });
});

test("dispatch resolve returns a settable effort for all eight lanes", () => {
  for (const lane of ["build", "prep_explore", "spec", "spec_review", "methodology", "intake", "architecture", "adr"]) {
    withConfig(`dispatch:\n  ${lane}:\n    effort: low\n`, (dir) => {
      const r = cli(dir, "dispatch", "resolve", lane);
      assert.equal(r.code, 0, `${lane}: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '{"model":"inherit","effort":"low"}', lane);
    });
  }
});

test("dispatch resolve refuses --tier/--confidence off the build lane, eval and unknown lanes (exit 2)", () => {
  withConfig(undefined, (dir) => {
    for (const args of [["spec", "--tier", "complex"], ["adr", "--confidence", "high"], ["eval"], ["bogus"], []]) {
      assert.equal(cli(dir, "dispatch", "resolve", ...args).code, 2, args.join(" "));
    }
    assert.match(cli(dir, "dispatch", "resolve", "eval").stderr, /eval is not a dispatch lane/);
  });
});

test("the more specific dispatch.build position wins over a less specific one", () => {
  const body = "dispatch:\n  build:\n    model: sonnet\n    by_confidence:\n      high:\n        model: fable\n    by_tier:\n      complex:\n        model: haiku\n";
  withConfig(body, (dir) => {
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--tier", "complex", "--confidence", "high").stdout.trim(), '{"model":"haiku","effort":"inherit"}');
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--confidence", "high").stdout.trim(), '{"model":"fable","effort":"inherit"}');
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--tier", "standard").stdout.trim(), '{"model":"sonnet","effort":"inherit"}');
  });
});

test("field independence: a node with only effort leaves model to the rest of the chain, and the reverse", () => {
  withConfig("dispatch:\n  build:\n    model: opus\n    by_tier:\n      complex:\n        effort: high\n", (dir) => {
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--tier", "complex").stdout.trim(), '{"model":"opus","effort":"high"}');
  });
  withConfig("dispatch:\n  methodology:\n    effort: low\n  spec:\n    model: haiku\n", (dir) => {
    assert.equal(cli(dir, "dispatch", "resolve", "methodology").stdout.trim(), '{"model":"inherit","effort":"low"}');
    assert.equal(cli(dir, "dispatch", "resolve", "spec").stdout.trim(), '{"model":"haiku","effort":"inherit"}');
  });
});

test("tier-absent behaviour is unchanged per field", () => {
  const body = "dispatch:\n  build:\n    model: sonnet\n    by_tier:\n      default:\n        model: opus\n        effort: medium\n";
  withConfig(body, (dir) => {
    assert.equal(cli(dir, "dispatch", "resolve", "build").stdout.trim(), '{"model":"sonnet","effort":"medium"}');
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--tier", "standard").stdout.trim(), '{"model":"opus","effort":"medium"}');
  });
});

test("dispatch resolve build honours dispatch.build.* at every position", () => {
  const body = "dispatch:\n  build:\n    model: sonnet\n    effort: low\n    by_tier:\n      complex:\n        model: opus\n        effort: high\n    by_confidence:\n      medium:\n        model: haiku\n";
  withConfig(body, (dir) => {
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--tier", "complex").stdout.trim(), '{"model":"opus","effort":"high"}');
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--tier", "mechanical").stdout.trim(), '{"model":"sonnet","effort":"low"}');
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--confidence", "medium").stdout.trim(), '{"model":"haiku","effort":"low"}');
    assert.equal(cli(dir, "dispatch", "resolve", "build").stdout.trim(), '{"model":"sonnet","effort":"low"}');
  });
});

test("engine call honours dispatch.<lane>.model / .effort and names the dispatch key in the refusal", () => {
  withConfig(`${ENGINE_OLLAMA}dispatch:\n  methodology:\n    model: engine:local\n    effort: high\n`, (dir) => {
    const r = cli(dir, "engine", "call", "--lane", "methodology", "--system", "/dev/null", "--user", "/dev/null");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /dispatch\.methodology\.effort/);
    assert.match(r.stderr, /no graded reasoning-effort transport/);
  });
});

test("every resolver validates the whole dispatch tree: a typo'd lane elsewhere exits 2", () => {
  const body = `${ENGINE_OLLAMA}dispatch:\n  methodology:\n    model: engine:local\n  biuld:\n    model: opus\n`;
  withConfig(body, (dir) => {
    for (const args of [["dispatch", "resolve", "spec"], ["dispatch", "resolve", "build"], ["engine", "call", "--lane", "methodology", "--system", "/dev/null", "--user", "/dev/null"]]) {
      const r = cli(dir, ...args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /unknown dispatch lane biuld/, args.join(" "));
    }
  });
});

test("a {...} string at a node position exits 2 with the block-form message naming the node", () => {
  withConfig("dispatch:\n  spec: { effort: low }\n", (dir) => {
    const r = cli(dir, "dispatch", "resolve", "spec");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /dispatch\.spec/);
    assert.match(r.stderr, /use block form/);
  });
});

test("dispatch effort by confidence in a file fails every resolver (ADR-0108)", () => {
  withConfig("dispatch:\n  build:\n    by_confidence:\n      medium:\n        effort: high\n", (dir) => {
    for (const args of [["dispatch", "resolve", "build"], ["config", "get", "dispatch.build.by_confidence.medium.effort"]]) {
      const r = cli(dir, ...args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /ADR-0108/);
      assert.match(r.stderr, /dispatch\.build\.by_tier/);
    }
  });
});

test("config resolved prints dispatch lines only for set values, annotating unapplied effort", () => {
  const body = [
    "dispatch:", "  spec:", "    effort: low",
    "  build:", "    model: sonnet",
    "    by_tier:", "      complex:", "        model: opus", "        effort: high",
    "    by_confidence:", "      medium:", "        model: haiku", "      low:", "        model: haiku",
    "  methodology:", "    effort: high", "",
  ].join("\n");
  withConfig(`${ENGINE_OLLAMA}${body}  intake:\n    model: engine:local\n    effort: low\n`, (dir) => {
    const lines = cli(dir, "config", "resolved").stdout.split("\n").filter((l) => l.startsWith("dispatch "));
    const note = NOT_APPLIED_NOTE;
    assert.deepEqual(lines, [
      "dispatch build: model=sonnet",
      `dispatch spec: effort=low${note}`,
      `dispatch methodology: effort=high${note}`,
      "dispatch intake: model=engine:local effort=low",
      `dispatch build.by_tier.complex: model=opus effort=high${note}`,
      "dispatch build.by_confidence.medium: model=haiku",
    ]);
  });
});

test("config resolved flags an invalid dispatch tree instead of staying silent", () => {
  withConfig("dispatch:\n  biuld:\n    model: opus\n", (dir) => {
    const r = cli(dir, "config", "resolved");
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^dispatch: INVALID — .*unknown dispatch lane biuld/m);
  });
});

test("with no dispatch key the config resolved banner gains no line", () => {
  withConfig("tracking:\n  team_key: X\n", (dir) => {
    assert.ok(!cli(dir, "config", "resolved").stdout.includes("dispatch"));
  });
});

const LANES = ["build", "prep_explore", "spec", "spec_review", "methodology", "intake", "architecture", "adr"];

test("config get and config set exit 2 for every removed key, naming the dispatch replacement, whether or not it is set", () => {
  const cases = [
    ...LANES.map((lane) => [`models.${lane}`, `dispatch.${lane}.model`]),
    ...LANES.map((lane) => [`effort.${lane}`, `dispatch.${lane}.effort`]),
    ["models.build_by_confidence.high", "dispatch.build.by_confidence.high.model"],
    ["models.build_by_confidence.default", "dispatch.build.by_confidence.default.model"],
    ["models.build_by_tier.complex", "dispatch.build.by_tier.complex.model"],
    ["effort.build_by_tier.complex", "dispatch.build.by_tier.complex.effort"],
    ["models", "dispatch.<lane>.model"],
    ["effort", "dispatch.<lane>.effort"],
    ["models.build_by_tier", "dispatch.<lane>.model"],
    ["effort.build_by_confidence.high", "dispatch.<lane>.effort"],
  ];
  const unset = [undefined, "models:\n  spec: opus\n  build_by_tier:\n    complex: opus\neffort:\n  build: low\n  build_by_tier:\n    complex: low\n"];
  for (const body of unset) {
    withConfig(body, (dir) => {
      for (const [removed, replacement] of cases) {
        const get = cli(dir, "config", "get", removed);
        assert.equal(get.code, 2, `get ${removed}`);
        assert.ok(get.stderr.includes(replacement), `get ${removed}: ${get.stderr}`);
        const set = cli(dir, "config", "set", removed, "low");
        assert.equal(set.code, 2, `set ${removed}`);
        assert.ok(set.stderr.includes(replacement), `set ${removed}: ${set.stderr}`);
      }
    });
  }
});

test("the eval keys keep their moved-to message and removedKeyError leaves other keys alone", () => {
  assert.match(removedKeyError("models.eval"), /moved to eval\.model/);
  assert.match(removedKeyError("effort.eval"), /moved to eval\.effort/);
  for (const key of ["dispatch.spec.model", "eval.model", "tracking.repo", "modelsfoo", "effortive"]) assert.equal(removedKeyError(key), null, key);
});

test("config unset removes a legacy tree, including an empty header, and is never refused as a removed key", () => {
  withConfig("models:\n  adr: sonnet\neffort:\ntracking:\n  repo: a/b\n", (dir) => {
    assert.equal(cli(dir, "config", "unset", "models").code, 0);
    assert.equal(cli(dir, "config", "unset", "effort").code, 0);
    assert.equal(readFileSync(path.join(dir, ".faffrc.yaml"), "utf8"), "tracking:\n  repo: a/b\n");
  });
  withConfig("tracking:\n  repo: a/b\n", (dir) => {
    writeFileSync(path.join(dir, ".faffrc.local.yaml"), "effort:\n");
    assert.equal(cli(dir, "config", "unset", "effort", "--local").code, 0);
  });
});

test("legacyTreeError names the file, each leaf with its replacement and the exact unset command", () => {
  const base = { file: ".faffrc.yaml", local: false, doc: { models: { prep_explore: "sonnet", build_by_tier: { complex: "opus" } }, effort: { spec: "low" } } };
  const overlay = { file: ".faffrc.local.yaml", local: true, doc: { effort: null } };
  assert.equal(
    legacyTreeError([base, overlay]),
    ".faffrc.yaml still holds the removed models: tree (ADR-0134); set models.prep_explore -> dispatch.prep_explore.model, models.build_by_tier.complex -> dispatch.build.by_tier.complex.model, then run `faff config unset models`."
    + " .faffrc.yaml still holds the removed effort: tree (ADR-0134); set effort.spec -> dispatch.spec.effort, then run `faff config unset effort`."
    + " .faffrc.local.yaml still holds the removed effort: tree (ADR-0134); run `faff config unset effort --local`.",
  );
  assert.equal(legacyTreeError([{ file: ".faffrc.yaml", local: false, doc: { tracking: {} } }]), null);
});

test("a legacy tree in the base makes every resolver exit 2, and the named command clears it", () => {
  withConfig(`${ENGINE_OLLAMA}models:\n  prep_explore: sonnet\n  adr: sonnet\n`, (dir) => {
    for (const args of [["dispatch", "resolve", "prep_explore"], ["engine", "call", "--lane", "methodology", "--system", "/dev/null", "--user", "/dev/null"]]) {
      const r = cli(dir, ...args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /\.faffrc\.yaml still holds the removed models: tree/);
      assert.ok(r.stderr.includes("models.prep_explore -> dispatch.prep_explore.model"));
      assert.ok(r.stderr.includes("models.adr -> dispatch.adr.model"));
      assert.ok(r.stderr.includes("`faff config unset models`"));
    }
    const resolved = cli(dir, "config", "resolved");
    assert.match(resolved.stdout, /^dispatch: INVALID — .*models\.prep_explore -> dispatch\.prep_explore\.model/m);
    const check = cli(dir, "config", "check");
    assert.equal(check.code, 1);
    assert.match(check.stdout, /ERROR \.faffrc\.yaml: .*models\.adr -> dispatch\.adr\.model/);
    assert.equal(cli(dir, "config", "set", "dispatch.spec.effort", "low").code, 0, "config set keeps working beside a legacy tree");
    assert.equal(cli(dir, "config", "get", "tracking.repo").code, 3, "config get of a non-removed key keeps working");
    assert.equal(cli(dir, "config", "unset", "models").code, 0);
    assert.equal(cli(dir, "dispatch", "resolve", "prep_explore").code, 0);
    assert.equal(cli(dir, "config", "check").code, 0);
  });
});

test("an empty effort: header is a legacy tree: exit 2 with no set clause, cleared by unset", () => {
  withConfig("effort:\n", (dir) => {
    const r = cli(dir, "dispatch", "resolve", "spec");
    assert.equal(r.code, 2);
    assert.ok(r.stderr.includes(".faffrc.yaml still holds the removed effort: tree (ADR-0134); run `faff config unset effort`."), r.stderr);
    assert.doesNotMatch(r.stderr, /set .* -> /);
    assert.equal(cli(dir, "config", "unset", "effort").code, 0);
    assert.equal(cli(dir, "dispatch", "resolve", "spec").code, 0);
  });
});

test("a legacy tree in the overlay names .faffrc.local.yaml and the --local command", () => {
  withConfig("tracking:\n  repo: a/b\n", (dir) => {
    writeFileSync(path.join(dir, ".faffrc.local.yaml"), "models:\n  spec: opus\n");
    const r = cli(dir, "dispatch", "resolve", "spec");
    assert.equal(r.code, 2);
    assert.ok(r.stderr.includes(".faffrc.local.yaml still holds the removed models: tree"));
    assert.ok(r.stderr.includes("`faff config unset models --local`"));
    assert.equal(cli(dir, "config", "unset", "models", "--local").code, 0);
    assert.equal(cli(dir, "dispatch", "resolve", "spec").code, 0);
  });
});

test("the resolvers also refuse a merged legacy tree, naming both unset commands", () => {
  assert.match(resolveDispatch({ models: { spec: "opus" } }, "spec").error, /faff config unset models.*faff config unset effort/);
  assert.match(resolveDispatch({ effort: null }, "build").error, /faff config unset effort/);
});

test("config resolved annotates every Agent-dispatched effort and no engine lane's", () => {
  withConfig(`${ENGINE_OLLAMA}dispatch:\n  methodology:\n    model: engine:local\n    effort: high\n  spec:\n    effort: low\n  prep_explore:\n    effort: inherit\n`, (dir) => {
    const lines = cli(dir, "config", "resolved").stdout.split("\n").filter((l) => l.startsWith("dispatch "));
    assert.deepEqual(lines, [
      "dispatch prep_explore: effort=inherit",
      `dispatch spec: effort=low${NOT_APPLIED_NOTE}`,
      "dispatch methodology: model=engine:local effort=high",
    ]);
  });
});

test("faff models and faff effort are unknown commands", () => {
  for (const verb of ["models", "effort"]) {
    const r = cli(undefined, verb, "build-for");
    assert.notEqual(r.code, 0, verb);
  }
  assert.doesNotMatch(cli(undefined, "--help").stdout + cli(undefined, "--help").stderr, /\bmodels\b.*build-for|\beffort\b.*build-for/);
});

test("legacyTreeError maps the eval leaves to their eval: keys instead of dropping them", () => {
  const doc = { models: { adr: "sonnet", eval: "x" }, effort: { eval: "low" } };
  const message = legacyTreeError([{ file: ".faffrc.yaml", local: false, doc }]);
  assert.ok(message.includes("models.adr -> dispatch.adr.model, models.eval -> eval.model, then run `faff config unset models`."), message);
  assert.ok(message.includes("effort.eval -> eval.effort"), message);
});
