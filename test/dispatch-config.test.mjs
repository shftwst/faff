// FAFF-1197 — one `dispatch:` tree pairs model and effort for every subagent-dispatched lane.
// Covers: the config get/set validators, `faff dispatch resolve`, the overlay feeding
// `models build-for` / `effort build-for` / `engine call`, the whole-tree validation, the run
// banner, and that the overlay never mutates the loaded config.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { resolveDispatch } from "../plugin/skills/faff/bin/lib/dispatch.js";
import { DEFAULTS, effectiveView } from "../plugin/skills/faff/bin/lib/config.js";

function withConfig(body, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff1197-"));
  if (body !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), body);
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const cli = (dir, ...args) => runCli(args, { cwd: dir });
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

test("overlay precedence: the more specific position wins across trees", () => {
  const body = "models:\n  build_by_tier:\n    complex: opus\ndispatch:\n  build:\n    model: sonnet\n";
  withConfig(body, (dir) => {
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--tier", "complex").stdout.trim(), '{"model":"opus","effort":"inherit"}');
    assert.equal(cli(dir, "models", "build-for", "--tier", "complex").stdout.trim(), "opus");
  });
  withConfig(`${body}`.replace("    model: sonnet\n", "    model: sonnet\n    by_tier:\n      complex:\n        model: haiku\n"), (dir) => {
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--tier", "complex").stdout.trim(), '{"model":"haiku","effort":"inherit"}');
  });
});

test("field independence: a node with only effort resolves model down the old tree, and the reverse", () => {
  withConfig("models:\n  spec: opus\ndispatch:\n  spec:\n    effort: high\n", (dir) => {
    assert.equal(cli(dir, "dispatch", "resolve", "spec").stdout.trim(), '{"model":"opus","effort":"high"}');
  });
  withConfig("effort:\n  methodology: low\ndispatch:\n  methodology:\n    model: haiku\n", (dir) => {
    assert.equal(cli(dir, "dispatch", "resolve", "methodology").stdout.trim(), '{"model":"haiku","effort":"low"}');
  });
});

test("tier-absent behaviour is unchanged per field", () => {
  const body = "dispatch:\n  build:\n    model: sonnet\n    by_tier:\n      default:\n        model: opus\n        effort: medium\n";
  withConfig(body, (dir) => {
    assert.equal(cli(dir, "dispatch", "resolve", "build").stdout.trim(), '{"model":"sonnet","effort":"medium"}');
    assert.equal(cli(dir, "dispatch", "resolve", "build", "--tier", "standard").stdout.trim(), '{"model":"opus","effort":"medium"}');
  });
});

test("models build-for and effort build-for honour dispatch.build.* through the overlay", () => {
  const body = "dispatch:\n  build:\n    model: sonnet\n    effort: low\n    by_tier:\n      complex:\n        model: opus\n        effort: high\n    by_confidence:\n      medium:\n        model: haiku\n";
  withConfig(body, (dir) => {
    assert.equal(cli(dir, "models", "build-for", "--tier", "complex").stdout.trim(), "opus");
    assert.equal(cli(dir, "models", "build-for", "--tier", "mechanical").stdout.trim(), "sonnet");
    assert.equal(cli(dir, "models", "build-for", "--confidence", "medium").stdout.trim(), "haiku");
    assert.equal(cli(dir, "effort", "build-for", "--tier", "complex").stdout.trim(), "high");
    assert.equal(cli(dir, "effort", "build-for").stdout.trim(), "low");
  });
});

test("engine call honours dispatch.<lane>.model / .effort and names the dispatch key in the refusal", () => {
  withConfig(`${ENGINE_OLLAMA}dispatch:\n  methodology:\n    model: engine:local\n    effort: high\n`, (dir) => {
    const r = cli(dir, "engine", "call", "--lane", "methodology", "--system", "/dev/null", "--user", "/dev/null");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /dispatch\.methodology\.effort/);
    assert.match(r.stderr, /no graded reasoning-effort transport/);
  });
  withConfig(`${ENGINE_OLLAMA}models:\n  methodology: engine:local\ndispatch:\n  methodology:\n    effort: high\n`, (dir) => {
    const r = cli(dir, "engine", "call", "--lane", "methodology", "--system", "/dev/null", "--user", "/dev/null");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /dispatch\.methodology\.effort/);
  });
});

test("every resolver validates the whole dispatch tree: a typo'd lane elsewhere exits 2", () => {
  const body = `${ENGINE_OLLAMA}models:\n  methodology: engine:local\ndispatch:\n  biuld:\n    model: opus\n`;
  withConfig(body, (dir) => {
    for (const args of [["dispatch", "resolve", "spec"], ["models", "build-for"], ["effort", "build-for"], ["engine", "call", "--lane", "methodology", "--system", "/dev/null", "--user", "/dev/null"]]) {
      const r = cli(dir, ...args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /unknown dispatch lane biuld/, args.join(" "));
    }
  });
});

test("a dispatch leaf over a non-map old-tree parent exits 2 naming the old-tree key", () => {
  withConfig("models:\n  build_by_tier: opus\ndispatch:\n  build:\n    by_tier:\n      complex:\n        model: haiku\n", (dir) => {
    const r = cli(dir, "dispatch", "resolve", "build");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /models\.build_by_tier/);
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

test("config resolved prints dispatch lines only for set values, with the FAFF-1198 annotation off the build lane", () => {
  const body = [
    "dispatch:", "  spec:", "    effort: low",
    "  build:", "    model: sonnet",
    "    by_tier:", "      complex:", "        model: opus", "        effort: high",
    "    by_confidence:", "      medium:", "        model: haiku", "      low:", "        model: haiku",
    "  methodology:", "    effort: high", "",
  ].join("\n");
  withConfig(`${ENGINE_OLLAMA}models:\n  intake: engine:local\n${body}  intake:\n    effort: low\n`, (dir) => {
    const lines = cli(dir, "config", "resolved").stdout.split("\n").filter((l) => l.startsWith("dispatch "));
    const note = " (not yet read at subagent dispatch sites; FAFF-1198)";
    assert.deepEqual(lines, [
      "dispatch build: model=sonnet",
      `dispatch spec: effort=low${note}`,
      `dispatch methodology: effort=high${note}`,
      "dispatch intake: effort=low",
      "dispatch build.by_tier.complex: model=opus effort=high",
      "dispatch build.by_confidence.medium: model=haiku",
    ]);
  });
});

test("with no dispatch key the config resolved banner gains no line", () => {
  withConfig("models:\n  spec: opus\n", (dir) => {
    assert.ok(!cli(dir, "config", "resolved").stdout.includes("dispatch"));
  });
});

test("the overlay never mutates the loaded config, and repeated resolves agree", () => {
  const cfg = {
    models: { build_by_tier: { complex: "opus" }, build_by_confidence: { high: "sonnet" } },
    effort: { build_by_tier: { complex: "low" } },
    dispatch: { build: { by_tier: { complex: { model: "haiku", effort: "high" } }, by_confidence: { high: { model: "fable" } } } },
  };
  const before = JSON.stringify(cfg);
  const first = resolveDispatch(cfg, "build", { tier: "complex", confidence: "high" });
  const second = resolveDispatch(cfg, "build", { tier: "complex", confidence: "high" });
  assert.equal(JSON.stringify(cfg), before);
  assert.deepEqual(first, second);
  assert.deepEqual(first, { model: "haiku", effort: "high" });
  assert.equal(effectiveView(cfg).view.models.build_by_confidence.high, "fable");
  assert.equal(cfg.models.build_by_confidence.high, "sonnet");
});

test("effectiveView returns the loaded config itself when there is no dispatch key", () => {
  const cfg = { models: { build: "opus" } };
  assert.equal(effectiveView(cfg).view, cfg);
});
