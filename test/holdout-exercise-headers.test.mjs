// FAFF-852 — proves test/helpers/holdout-exercise.mjs exercise() forwards an optional
// `headers` argument to fetch, so the docker-gated integration test can drive an
// authenticated endpoint. This is the non-docker unit-level coverage for that plumbing:
// a plain node:http server, no container required.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { exercise } from "./helpers/holdout-exercise.mjs";

function withServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

test("exercise(): with headers supplied, forwards them to fetch — the server observes the Authorization header", async () => {
  let observedAuth;
  const { server, url } = await withServer((req, res) => {
    observedAuth = req.headers["authorization"];
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok: authenticated");
  });
  try {
    const result = await exercise(url, "authenticated", { Authorization: "Bearer tok-header-test" });
    assert.equal(observedAuth, "Bearer tok-header-test", "the server must observe the header exercise() forwarded");
    assert.equal(result.verdict, "met");
  } finally {
    server.close();
  }
});

test("exercise(): with no headers argument, behaviour is unchanged — no Authorization header sent", async () => {
  let observedAuth = "unset";
  const { server, url } = await withServer((req, res) => {
    observedAuth = req.headers["authorization"];
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok: bare");
  });
  try {
    const result = await exercise(url, "bare");
    assert.equal(observedAuth, undefined, "absent headers argument must never synthesize an Authorization header");
    assert.equal(result.verdict, "met");
  } finally {
    server.close();
  }
});
