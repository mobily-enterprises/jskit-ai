import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createClaudeConversationTurn } from "../src/server/conversation/claudeTurn.js";

const execute = promisify(execFile);

test("native Claude replaces a recorded system prompt on resume and retains ordinary history", { timeout: 90_000 }, async (t) => {
  try { await execute("claude", ["--version"]); }
  catch (error) { if (error.code === "ENOENT") { t.skip("Claude Code is not installed."); return; } throw error; }
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-claude-instructions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.url.includes("count_tokens")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ input_tokens: 20 }));
      return;
    }
    if (!request.url.startsWith("/v1/messages")) { response.writeHead(404); response.end(); return; }
    let input = "";
    for await (const chunk of request) input += chunk;
    const body = JSON.parse(input);
    requests.push(body);
    const message = { id: "msg_local", type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: "ACK" }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 20, output_tokens: 1 } };
    if (!body.stream) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(message));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    event("message_start", { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 0 } } });
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "ACK" } });
    event("content_block_stop", { index: 0 });
    event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
    event("message_stop", {});
    response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const env = {
    PATH: process.env.PATH, HOME: root, CLAUDE_CONFIG_DIR: path.join(root, "config"),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    ANTHROPIC_AUTH_TOKEN: "local-test", ANTHROPIC_MODEL: "fixture-model",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "fixture-model", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1", DISABLE_AUTOUPDATER: "1"
  };
  const runtime = createClaudeConversationTurn({ conversationId: "instruction-arguments", process: { getProcess: () => null,
    isActive: () => false, startProcess: () => {}, stopProcess: () => {} } });
  async function turn(id, instructions, text, resume) {
    const { stdout } = await execute("claude", ["--bare", "--print", "--output-format", "json", "--model", "fixture-model",
      "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      resume ? "--resume" : "--session-id", id, ...instructions, "--", text], { cwd: root, env, timeout: 25_000 });
    const result = JSON.parse(stdout);
    assert.equal(result.is_error, false);
    assert.equal(result.session_id, id);
    return requests.at(-1);
  }
  for (const instructionMode of ["append", "replace"]) {
    const id = randomUUID();
    await turn(id, [instructionMode === "append" ? "--append-system-prompt" : "--system-prompt",
      "CALENDAR_INSTRUCTIONS_A", "--system-prompt-snapshot", "on"], "First request", false);
    const current = runtime.instructionArguments({ systemPrompt: "CALENDAR_INSTRUCTIONS_B", instructionMode });
    const resumed = await turn(id, current, "Second request", true);
    assert.match(JSON.stringify(resumed.system), /CALENDAR_INSTRUCTIONS_B/);
    assert.doesNotMatch(JSON.stringify(resumed.system), /CALENDAR_INSTRUCTIONS_A/);
    const followup = await turn(id, current, "Third request", true);
    assert.equal(followup.messages.filter(message => message.role === "user").length, 3);
    assert.match(JSON.stringify(followup.messages.at(-1)), /Third request/);
    assert.doesNotMatch(JSON.stringify(followup.messages), /CALENDAR_INSTRUCTIONS_[AB]/);
  }
});
