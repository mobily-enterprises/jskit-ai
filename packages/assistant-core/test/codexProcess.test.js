import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertCodexAuthPreflightReady } from "../src/server/conversation/codexAuthPreflight.js";
import { codexAppServerHelperHomeDir } from "../src/server/conversation/codexProcess.js";
import { createCodexAppServerRuntime } from "../src/server/conversation/codexRuntime.js";

const ONE_MODEL = "printf '%s' '{\"models\":[{\"slug\":\"fixture-model\"}]}'";

/**
 * Starts a runtime, with a stand-in Codex CLI whose `debug models` runs `exporter` and which records each call's home
 * and arguments, under an execution host that records the launch and reports failure.
 */
async function startRecorded(t, configuration = {}, executionMode = "interactive", exporter = ONE_MODEL) {
  const dir = await mkdtemp(join(tmpdir(), "jskit-codex-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runtimeDir = join(dir, "runtime");
  await mkdir(runtimeDir);
  const calls = join(dir, "calls");
  const codexCommand = join(dir, "codex");
  await writeFile(codexCommand, [
    "#!/bin/sh",
    `printf '%s %s\\n' "$CODEX_HOME" "$*" >> '${calls}'`,
    `if [ "$1 $2" = "debug models" ]; then ${exporter}; exit; fi`,
    "exit 1",
    ""
  ].join("\n"), { mode: 0o755 });
  let request = null;
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
  const error = await runtime.start({ codexCommand, env: process.env, executionMode, runtimeDir }).then(() => null, (failure) => failure);
  const recorded = async () => (await readFile(calls, "utf8").catch(() => "")).split("\n").filter(Boolean);
  return { request, error, runtimeDir, calls: recorded };
}

/** The launch a runtime start asks its execution host for. */
async function launchRequest(t, configuration, executionMode = "interactive") {
  const { request, error } = await startRecorded(t, configuration, executionMode);
  assert.match(error?.message ?? "", /recorded launch/);
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

test("main and helper app-servers start with plugin and app background work off", async (t) => {
  for (const executionMode of ["interactive", "helper"]) {
    const request = await launchRequest(t, {}, executionMode);
    const codexArgs = request.args.slice(request.args.indexOf("app-server"));
    for (const feature of ["plugins", "apps"]) {
      const index = codexArgs.indexOf(`features.${feature}=false`);
      assert.ok(index > 0 && codexArgs[index - 1] === "-c", `${executionMode} app-server disables ${feature}`);
    }
  }
});

test("a helper app-server starts with the catalogue its start exports from the binary's bundled models, in its own home", async (t) => {
  const { request, error, runtimeDir, calls } = await startRecorded(t, {}, "helper");
  assert.match(error?.message ?? "", /recorded launch/);
  const catalogue = join(runtimeDir, "models.json");
  // Last, after every other override: without it Codex fetches the provider's model list before each turn.
  assert.deepEqual(request.args.slice(-2), ["-c", `model_catalog_json=${JSON.stringify(catalogue)}`]);
  assert.deepEqual(JSON.parse(await readFile(catalogue, "utf8")).models.map((model) => model.slug), ["fixture-model"]);
  // The bundled definitions: an export that fetches no model list (chatgpt.com, for OpenAI).
  assert.deepEqual(await calls(), [`${codexAppServerHelperHomeDir(runtimeDir)} debug models --bundled -c check_for_update_on_startup=false`]);
});

test("a helper app-server whose catalogue cannot be exported is refused before it starts", async (t) => {
  const { request, error } = await startRecorded(t, {}, "helper", "echo broken >&2; false");
  assert.equal(request, null, "no launch without a catalogue");
  assert.equal(error?.code, "codex_helper_runtime_start_failed");
  assert.equal(error?.message, "Codex isolated helper runtime could not export its model catalogue.");
});

test("a non-octal umask is refused before it reaches the startup script", () => {
  assert.throws(() => createCodexAppServerRuntime({
    configuration: { umask: "0007; touch /tmp/x" },
    credentials: {},
    execution: {}
  }), /umask must be octal/);
});

test("the Codex sign-in check names itself to the execution host", async () => {
  let request;
  const execution = { async run(value) { request = value; return { ok: true, exitCode: 0, output: "{}" }; } };
  await assertCodexAuthPreflightReady({ codexCommand: process.execPath, env: process.env }, { execution });
  assert.equal(request.mode, "capture");
  assert.deepEqual(request.args.slice(-2), ["debug", "models"]);
  assert.deepEqual(request.execution, { label: "Checking the Codex sign-in", operationId: "codex-auth-preflight" });
});
