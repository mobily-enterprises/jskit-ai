import assert from "node:assert/strict";
import test from "node:test";
import { codexInteractiveArguments } from "../src/server/conversation/codexConfiguration.js";

const options = Object.freeze({
  command: "codex", model: "selected-model", effort: "high",
  disableStartupUpdates: true, bypassApprovalsAndSandbox: true, bypassHookTrust: true
});

test("remote Codex resume keeps server-owned permissions and the selected native thread", () => {
  assert.deepEqual(codexInteractiveArguments({
    ...options, remoteEndpoint: "unix:///runtime/codex.sock", threadId: "retained-thread"
  }), [
    "codex", "-c", "check_for_update_on_startup=false",
    "--remote", "unix:///runtime/codex.sock", "--model", "selected-model",
    "-c", 'model_reasoning_effort="high"',
    "--dangerously-bypass-hook-trust", "resume", "retained-thread"
  ]);
});

test("local Codex and new remote threads retain their explicit permission selection", () => {
  for (const input of [{}, { threadId: "local-thread" }, { remoteEndpoint: "unix:///runtime/codex.sock" }]) {
    const args = codexInteractiveArguments({ ...options, ...input });
    assert.ok(args.includes("--dangerously-bypass-approvals-and-sandbox"));
    assert.ok(args.includes("--dangerously-bypass-hook-trust"));
    assert.equal(args.includes("resume"), Boolean(input.threadId));
  }
  assert.equal(codexInteractiveArguments({ ...options, bypassApprovalsAndSandbox: false })
    .includes("--dangerously-bypass-approvals-and-sandbox"), false);
});
