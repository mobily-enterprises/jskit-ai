import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nativeCommandHook, wrapNativeCommand } from "../src/server/conversation/commandWrapper.js";
import { createConversationRuntime, createMemoryConversationStorage } from "../src/server/conversation/index.js";

test("a command wrapper receives exactly one original argument, including shell syntax", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-command-wrapper-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const wrapper = path.join(directory, "wrapper's executable");
  await writeFile(wrapper, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.RECEIPT, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
  const command = "printf '%s' \"$SECRET\"\n$(touch escaped) `touch escaped` '🌏'";
  execFileSync("sh", ["-c", wrapNativeCommand(wrapper, command)], { cwd: directory, env: { ...process.env, RECEIPT: path.join(directory, "receipt") } });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "receipt"), "utf8")), [command]);
  await assert.rejects(readFile(path.join(directory, "escaped")), { code: "ENOENT" });
});

test("native command hooks preserve tool options and deny malformed commands", () => {
  const input = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pwd", timeout: 500, description: "Current directory" } };
  const output = nativeCommandHook("/host/wrapper", input).hookSpecificOutput;
  assert.equal(output.updatedInput.command, "'/host/wrapper' 'pwd'");
  assert.equal(output.updatedInput.timeout, 500);
  assert.equal(output.updatedInput.description, "Current directory");
  for (const command of [null, "", "  ", "pwd\0bad"]) {
    assert.equal(nativeCommandHook("/host/wrapper", { ...input, tool_input: { command } }).hookSpecificOutput.permissionDecision, "deny");
  }
  assert.throws(() => nativeCommandHook("/host/wrapper", { ...input, tool_name: "Read" }), /unexpected native tool/);
});

test("the native hook executable fails closed on malformed or oversized input", () => {
  const executable = fileURLToPath(new URL("../src/server/conversation/commandHook.js", import.meta.url));
  for (const input of ["invalid JSON", "x".repeat(2 * 1024 * 1024 + 1)]) {
    const output = JSON.parse(execFileSync(process.execPath, [executable, "/host/wrapper"], { input, encoding: "utf8" }));
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  }
});

test("a required command wrapper cannot be silently ignored by an incompatible host", async () => {
  for (const host of [{ commandWrapper: "relative", nativeTools: true }, { commandWrapper: "/host/wrapper" }, { commandWrapper: "/host/wrapper", nativeTools: true }]) {
    const runtime = createConversationRuntime({ storage: createMemoryConversationStorage(), authorize: () => true, host });
    await assert.rejects(runtime.open({ id: "wrapper", configuration: { integrationId: "unused" } }), /commandWrapper|requires native/);
    await runtime.close();
  }
});
