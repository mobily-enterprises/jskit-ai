import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createConversationRuntime, createFileConversationStorage } from "../src/server/conversation/index.js";
import { createServiceToolCatalog } from "../src/server/lib/serviceToolCatalog.js";
import { createConversationTools } from "../src/server/conversation/tools.js";

// An unsaved tool's call id, argument and result, each unique: any copy of one in what the
// runtime stores, emits, logs or sends a later turn is a leak.
const PRIVATE = Object.freeze({ id: "callprivate7d41", argument: "argument-marker-5b93", result: "result-marker-e602" });
const SAVED_ID = "callsaved3c08";
const context = { actor: { id: "owner" }, surface: "app", applicationId: "test", subjectId: "owner" };
const leaks = value => Object.values(PRIVATE).filter(marker => (typeof value === "string" ? value : JSON.stringify(value)).includes(marker));

/** An app's anonymous-survey listing, unsaved, beside an ordinary saved action. */
function surveyActions({ logger, execute = async ({ code }) => ({ surveys: code === PRIVATE.argument ? PRIVATE.result : "none" }) } = {}) {
  const actions = createActionCatalogue(logger ? { logger } : {});
  actions.register({ contributorId: "test.tools", domain: "test", actions: [{
    id: "surveys.open", version: 1, kind: "query", channels: ["automation"], surfaces: ["app"], permission: { require: "authenticated" },
    extensions: { assistant: { unsaved: true, description: "List the surveys open to this person." } },
    input: { schema: createSchema({ code: { type: "string", required: true } }), mode: "replace" },
    output: { schema: createSchema({ surveys: { type: "string", required: true } }), mode: "replace" }, execute
  }, {
    id: "numbers.add", version: 1, kind: "command", channels: ["automation"], surfaces: ["app"], permission: { require: "authenticated" },
    input: { schema: createSchema({ left: { type: "number", required: true }, right: { type: "number", required: true } }), mode: "replace" },
    output: { schema: createSchema({ total: { type: "number", required: true } }), mode: "replace" },
    execute: async ({ left, right }) => ({ total: left + right })
  }] });
  return actions;
}

async function filesUnder(directory) {
  let text = "";
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) text += await readFile(join(entry.parentPath, entry.name), "latin1");
  }
  return text;
}

const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const stream = body => new Response(body, { headers: { "content-type": "text/event-stream" } });

test("an unsaved call runs once from the turn's memory, is never saved, announced or recorded, and a lost outcome names no tool", async () => {
  let executions = 0;
  let lose = false;
  const catalog = createServiceToolCatalog(surveyActions({ async execute() {
    executions += 1;
    if (lose) throw Object.assign(new Error("Acknowledgement lost"), { statusCode: 503 });
    return { surveys: PRIVATE.result };
  } }));
  const saved = [], emitted = [];
  const hooks = { catalog, context, signal: new AbortController().signal, authorize: async () => {},
    save: async calls => { saved.push(structuredClone(calls)); }, emit: async event => { emitted.push(event); } };
  const tools = createConversationTools({ ...hooks, offerUnsaved: true });
  const input = { id: PRIVATE.id, name: "surveys_open", arguments: JSON.stringify({ code: PRIVATE.argument }) };
  assert.equal(tools.descriptors.find(tool => tool.name === "surveys_open").unsaved, true);
  assert.deepEqual(await tools.execute(input), { ok: true, result: { surveys: PRIVATE.result } });
  assert.deepEqual(await tools.execute(input), { ok: true, result: { surveys: PRIVATE.result } }, "A repeated id reads the turn's memory");
  assert.equal(executions, 1);
  await assert.rejects(tools.execute({ ...input, arguments: "{}" }), /different arguments/);
  await tools.execute({ id: SAVED_ID, name: "numbers_add", arguments: '{"left":2,"right":3}' });
  assert.deepEqual(leaks([saved, emitted, tools.records()]), []);
  assert.deepEqual(tools.records().map(call => call.id), [SAVED_ID], "Only the saved call is recorded");

  lose = true;
  const lost = { ...input, id: "private-lost" };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(tools.execute(lost), error => error.code === "conversation_request_incomplete" &&
      error.message === "The assistant could not complete this request." && error.messageCode === "assistant.turn.requestIncomplete");
  }
  assert.equal(executions, 2, "A lost outcome is never run again");
  assert.deepEqual(tools.records().map(call => call.id), [SAVED_ID]);

  assert.deepEqual(createConversationTools(hooks).descriptors.map(tool => tool.name), ["numbers_add"], "Not offered unless the caller keeps it");
  assert.throws(() => createConversationTools({ ...hooks, toolSet: catalog.resolveToolSet(context, { offerUnsaved: true }) }),
    /offers unsaved tools, whose calls these application tools would save/);
  assert.throws(() => createConversationTools({ ...hooks, offerUnsaved: "yes" }), /explicit server-side boolean/);
});

test("a saved conversation, its events, logs and later turns hold neither an unsaved call nor its result", async t => {
  const directory = await mkdtemp(join(tmpdir(), "jskit-unsaved-tools-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logs = [];
  const logger = Object.fromEntries(["debug", "info", "warn", "error"].map(level => [level, (...entry) => { logs.push([level, ...entry]); }]));
  const printed = [];
  for (const method of ["log", "info", "warn", "error", "debug"]) t.mock.method(console, method, (...entry) => { printed.push(entry); });
  const requests = [];
  const runtime = createConversationRuntime({ storage: createFileConversationStorage({ directory }), actions: surveyActions({ logger }),
    authorize: () => true,
    connections: { resolve: async () => ({ providerId: "test", model: "exact-model", sdkPackage: "@ai-sdk/openai-compatible", apiKey: "test", baseURL: "http://test.invalid/v1" }) },
    fetch: (_url, request) => {
      requests.push(JSON.parse(request.body));
      if (requests.length > 1) return stream(frame({ content: "The total is five." }) + frame({}, "stop"));
      return stream(frame({ tool_calls: [
        { index: 0, id: PRIVATE.id, type: "function", function: { name: "surveys_open", arguments: JSON.stringify({ code: PRIVATE.argument }) } },
        { index: 1, id: SAVED_ID, type: "function", function: { name: "numbers_add", arguments: '{"left":2,"right":3}' } }
      ] }) + frame({}, "tool_calls"));
    } });
  t.after(() => runtime.close());
  const conversation = await runtime.open({ id: "private", context, configuration: { systemPrompt: "Use the application operations.", integrationId: "assistant" } });
  const events = [];
  await conversation.subscribe(event => { events.push(event); });
  await conversation.send({ messageId: "first", text: "Which surveys are open, and what is two and three?" });
  const first = await conversation.wait();
  await conversation.send({ messageId: "next", text: "What did you just find?" });
  const next = await conversation.wait();
  const read = await conversation.read();
  await runtime.close();

  assert.equal(first.error, "");
  assert.match(requests[0].tools.find(tool => tool.function.name === "surveys_open").function.description,
    /Private: its call and result are kept only for this reply/u, "The model learns from the tool that later replies won't see it");
  assert.ok(JSON.stringify(requests[1].messages).includes(PRIVATE.result), "The live turn's model sees the result");
  assert.deepEqual(leaks(requests[2].messages), [], "A later turn sees neither the call nor the result");
  assert.equal(JSON.stringify(requests[2].messages).includes("surveys_open"), false, "nor that the tool was used");
  assert.ok(JSON.stringify(requests[2].messages).includes(SAVED_ID), "while the saved call is in its history");

  assert.deepEqual(first.conversationLog[0].metadata.applicationTools.map(call => call.name), ["numbers_add"]);
  assert.deepEqual(leaks([first, next, read]), [], "Neither the turn records nor the conversation as read hold them");
  const stored = await filesUnder(directory);
  assert.ok(stored.includes(SAVED_ID), "The saved call is on disk, so this search reads what storage wrote");
  assert.deepEqual(leaks(stored), []);
  assert.equal(stored.includes("surveys_open") || stored.includes("surveys.open"), false, "Storage never names the unsaved tool");

  const tools = events.filter(event => event.type === "tool");
  assert.deepEqual(tools.map(event => [event.call.name, event.call.status]), [["numbers_add", "running"], ["numbers_add", "complete"]]);
  assert.deepEqual(leaks(events), []);
  assert.ok(logs.some(entry => entry[2] === "action.execution" && entry[1].action === "numbers.add"), "The saved action is logged");
  assert.equal(JSON.stringify(logs).includes("surveys"), false, "The unsaved one leaves no log line");
  assert.deepEqual(leaks(printed), []);
  assert.equal(JSON.stringify(printed).includes("surveys"), false);
});
