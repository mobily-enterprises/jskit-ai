import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCodexAppServerRuntime } from "../src/server/conversation/codexProcess.js";

/** Starts a runtime whose execution host records the launch and reports failure. */
async function launchRequest(t, configuration, executionMode = "interactive") {
  const runtimeDir = await mkdtemp(join(tmpdir(), "jskit-codex-"));
  t.after(() => rm(runtimeDir, { recursive: true, force: true }));
  let request;
  const runtime = createCodexAppServerRuntime({
    configuration,
    credentials: { identity: async () => "account", generation: async () => "generation", assertCurrent: async () => {} },
    execution: {
      async run(value) {
        request = value;
        return { ok: false, output: "recorded launch" };
      }
    }
  });
  await assert.rejects(runtime.start({ codexCommand: process.execPath, executionMode, runtimeDir }), /recorded launch/);
  return request;
}

test("the default startup script keeps the shared-file umask in launch and process profile", async (t) => {
  for (const executionMode of ["interactive", "helper"]) {
    const request = await launchRequest(t, {}, executionMode);
    assert.match(request.args[1], /^umask 0007\n/);
    assert.equal(request.processProfile.startup, request.args[1]);
  }
});

test("an empty umask inherits the host's own and emits no umask line", async (t) => {
  for (const executionMode of ["interactive", "helper"]) {
    const request = await launchRequest(t, { umask: "" }, executionMode);
    assert.doesNotMatch(request.args[1], /umask/);
    assert.equal(request.processProfile.startup, request.args[1]);
  }
  assert.doesNotMatch((await launchRequest(t, { umask: null })).args[1], /umask/);
  assert.match((await launchRequest(t, { umask: "0022" })).args[1], /^umask 0022\n/);
});

test("a non-octal umask is refused before it reaches the startup script", () => {
  assert.throws(() => createCodexAppServerRuntime({
    configuration: { umask: "0007; touch /tmp/x" },
    credentials: {},
    execution: {}
  }), /umask must be octal/);
});
