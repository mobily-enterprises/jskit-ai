import { createMemoryTurnRequests } from "./support/memoryTurnRequests.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createChatService } from "../src/server/services/chatService.js";
import { createAssistantConversationRuntime } from "../src/server/createAssistantRuntime.js";
import { createMemoryAssistantRows } from "./support/memoryAssistantRows.js";
import { createScriptedModel } from "./support/scriptedModel.js";

const APP_CONFIG = Object.freeze({
  surfaceDefinitions: {
    assistant: {
      id: "assistant",
      enabled: true,
      requiresWorkspace: false,
      accessPolicyId: "public"
    }
  },
  assistantSurfaces: {
    assistant: {
      settingsSurfaceId: "assistant",
      configScope: "global"
    }
  }
});

function textCompletion(text) {
  return { text };
}

function toolCompletion(name, sequence, { text = "" } = {}) {
  return {
    text,
    toolCall: {
      id: `tool_call_${sequence}`,
      name,
      arguments: JSON.stringify({ sequence })
    }
  };
}

async function* completionStream(completion = {}) {
  if (completion.text) {
    yield {
      choices: [
        {
          delta: {
            content: completion.text
          }
        }
      ]
    };
  }

  if (completion.toolCall) {
    yield {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: completion.toolCall.id,
                function: {
                  name: completion.toolCall.name,
                  arguments: completion.toolCall.arguments
                }
              }
            ]
          }
        }
      ]
    };
  }
  yield { choices: [{ delta: {}, finish_reason: completion.toolCall ? "tool_calls" : "stop" }] };
}

function createHarness(completions, { executeToolCall = null, tools: configuredTools = null, attachments, supportsAttachments = true, wrapRuntime = (runtime) => runtime,
  once } = {}) {
  const pendingCompletions = [...completions];
  const completionRequests = [];
  const transcriptMessages = [];
  const completedConversations = [];
  const executedTools = [];
  const streamEvents = [];
  const tools = Array.isArray(configuredTools)
    ? configuredTools
    : ["action_search", "action_contract", "action_execute"].map((name) => ({
        name,
        parameters: {
          type: "object"
        },
        outputSchema: {
          type: "object"
        }
      }));

  const dependencies = {
    turnRequests: createMemoryTurnRequests(),
    attachments,
    aiClientFactory: {
      resolveClient() {
        return {
          enabled: true,
          supportsAttachments,
          provider: "test",
          defaultModel: "test-model",
          model: createScriptedModel(body => {
            completionRequests.push({
              messages: structuredClone(body.messages),
              tools: structuredClone(body.tools)
            });
            const completion = pendingCompletions.shift();
            assert.ok(completion, "Expected a queued assistant completion.");
            return completion[Symbol.asyncIterator] ? completion : completionStream(completion);
          }, { once })
        };
      }
    },
    transcriptService: {
      async createConversationForTurn() {
        return {
          conversation: {
            id: "conversation_1"
          }
        };
      },
      async completeConversation(_surface, _conversationId, completion) {
        completedConversations.push(structuredClone(completion));
      }
    },
    serviceToolCatalog: {
      limits: { maxToolArgumentBytes: 64 * 1024 },
      resolveToolSet() {
        return { tools };
      },
      toOpenAiToolSchema(tool) {
        return {
          type: "function",
          function: {
            name: tool.name,
            parameters: tool.parameters
          }
        };
      },
      async executeToolCall(request) {
        executedTools.push(structuredClone(request));
        if (typeof executeToolCall === "function") {
          return executeToolCall(request, executedTools.length);
        }
        return {
          ok: true,
          result: {
            sequence: executedTools.length,
            tool: request.toolName
          }
        };
      }
    },
    assistantConfigService: {
      async resolveSystemPrompt() {
        return "";
      }
    },
    appConfig: APP_CONFIG
  };
  const conversationRuntime = createAssistantConversationRuntime({
    ...createMemoryAssistantRows({ messages: transcriptMessages }),
    aiClientFactory: dependencies.aiClientFactory, toolCatalog: dependencies.serviceToolCatalog, attachments
  });
  const chatService = createChatService({ ...dependencies, conversationRuntime: wrapRuntime(conversationRuntime) });

  const streamWriter = {};
  for (const method of [
    "sendMeta",
    "sendAssistantDelta",
    "sendAssistantMessage",
    "sendToolCall",
    "sendToolResult",
    "sendError",
    "sendDone"
  ]) {
    streamWriter[method] = (payload) => {
      streamEvents.push({ method, payload: structuredClone(payload) });
    };
  }

  async function run(input = "Help me", payload = {}) {
    return chatService.streamChat(
      {
        targetSurfaceId: "assistant",
        messageId: "message_1",
        input,
        history: [],
        ...payload
      },
      {
        context: {
          actor: {
            id: "1"
          }
        },
        streamWriter
      }
    );
  }

  return {
    completedConversations,
    completionRequests,
    executedTools,
    run,
    streamEvents,
    transcriptMessages
  };
}

function messageText(message) {
  return typeof message?.content === "string" ? message.content
    : (message?.content || []).filter(part => part.type === "text").map(part => part.text).join("");
}

function assistantMessages(events) {
  return events
    .filter((event) => event.method === "sendAssistantMessage" && event.payload.status !== "streaming")
    .map((event) => event.payload.text);
}

test("the provider receives collection guidance in direct and discovery modes", async (t) => {
  for (const discovery of [false, true]) {
    await t.test(discovery ? "discovery" : "direct", async () => {
      const toolNames = discovery
        ? ["assistant_action_search", "assistant_action_contract", "assistant_action_execute"]
        : ["inventory_assets_list"];
      const harness = createHarness([textCompletion("The requested comparison is complete.")], {
        tools: toolNames.map((name) => ({
          name,
          parameters: { type: "object" },
          outputSchema: { type: "object" }
        }))
      });

      await harness.run("Compare all records, including those outside last week's results.");

      const prompt = harness.completionRequests[0].messages[0].content;
      assert.match(prompt, /collection action such as list, search, or query/u);
      assert.match(prompt, /first look for a suitable count, aggregate, or report action before reading individual records/u);
      assert.match(prompt, /remove earlier date or other filters that no longer apply/u);
      assert.match(prompt, /follow returned pagination until the requested number or scope is covered/u);
      assert.match(prompt, /Never present a partial page or sample as complete/u);
      if (discovery) {
        assert.match(prompt, /Before claiming an operation or dataset is unavailable.*assistant_action_search/u);
        assert.match(prompt, /count\/aggregate\/report for totals or summaries/u);
        assert.match(prompt, /broader terms such as list or query.*omit query to browse/u);
        assert.match(prompt, /one empty search or unrelated page does not establish that a capability is absent/u);
        assert.match(prompt, /load assistant_action_contract before assistant_action_execute/u);
      } else {
        assert.doesNotMatch(prompt, /assistant_action_search|assistant_action_contract|assistant_action_execute/u);
      }
    });
  }
});

test("an empty authorized tool set does not advertise discovery or collection actions", async () => {
  const harness = createHarness([textCompletion("No application actions are available in this session.")], {
    tools: []
  });

  await harness.run("List the available records.");

  const request = harness.completionRequests[0];
  assert.equal(request.tools, undefined, "The model is offered no tools");
  assert.match(request.messages[0].content, /No tools are currently available for this user\/session/u);
  assert.doesNotMatch(request.messages[0].content, /assistant_action_search|collection action/u);
});

test("a reply that only announces work carries on once, and the state note gives the time without a clock action", async () => {
  const harness = createHarness(
    [
      textCompletion("Let me query the current time."),
      textCompletion("<think>This must remain private.</think>\nIt is Tuesday in the workspace timezone.")
    ],
    {
      tools: [{
        name: "workspace_clock",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {}
        },
        outputSchema: { type: "object" }
      }],
      executeToolCall() {
        return { ok: true, result: { localDateTime: "2026-08-25T11:15:00+08:00", timeZone: "Australia/Perth" } };
      }
    }
  );

  const result = await harness.run("What day is it today?");

  assert.equal(result.status, "completed");
  assert.deepEqual(harness.executedTools, [], "No clock action runs before the model asks for one");
  const system = harness.completionRequests[0].messages[0];
  assert.equal(system.role, "system");
  assert.match(system.content, /use the current time in the system's state note/u);
  assert.match(system.content, /\n\nCurrent state, from the system\. It is the truth; earlier messages may be out of date:\n- The time: .+ UTC\./u,
    "The state note at the end of the system prompt tells the model the current time");
  assert.match(messageText(harness.completionRequests[1].messages.at(-1)), /^\(Check from the app: your reply ended by saying what you'd do next/u,
    "The reply that only announced work carries on once with the engine's check");
  assert.deepEqual(assistantMessages(harness.streamEvents), ["It is Tuesday in the workspace timezone."]);
  assert.ok(harness.streamEvents.some((event) => event.method === "sendAssistantDelta"));
  assert.deepEqual(
    harness.transcriptMessages
      .filter((message) => message.kind === "chat")
      .map((message) => message.contentText),
    ["What day is it today?", "It is Tuesday in the workspace timezone."]
  );
});

test("native search, contract, and execution workflows stream progress across more than four tool rounds", async () => {
  const harness = createHarness([
    toolCompletion("action_search", 1, { text: "I'll search first." }),
    toolCompletion("action_contract", 2, { text: "Let me inspect that contract." }),
    toolCompletion("action_execute", 3, { text: "I'll execute it now." }),
    toolCompletion("action_contract", 4),
    toolCompletion("action_execute", 5),
    textCompletion("The requested operation completed successfully.")
  ]);

  await harness.run();

  assert.deepEqual(
    harness.executedTools.map((request) => request.toolName),
    ["action_search", "action_contract", "action_execute", "action_contract", "action_execute"]
  );
  assert.deepEqual(assistantMessages(harness.streamEvents), ["The requested operation completed successfully."]);
  assert.ok(harness.streamEvents.some((event) => event.method === "sendAssistantDelta"));
  const lastRequest = harness.completionRequests.at(-1).messages;
  const assistantToolMessages = lastRequest.filter((message) => Array.isArray(message.tool_calls));
  assert.equal(assistantToolMessages.length, 5);
  assert.deepEqual(assistantToolMessages.map(message => message.content || ""),
    ["I'll search first.", "Let me inspect that contract.", "I'll execute it now.", "", ""],
    "Each step's words stay with its action calls in the model's history");
});

test("at the step limit the model gives its own account of where it got to", async () => {
  const harness = createHarness(
    Array.from({ length: 32 }, (_, index) => toolCompletion("action_execute", index + 1)),
    { once: body => /personal assistant/u.test(JSON.stringify(body.messages)) ? "I ran 32 actions and stopped before the last check." : "" }
  );

  await harness.run();

  assert.equal(harness.executedTools.length, 32, "The step limit stays within the turn's 32 application action calls");
  assert.equal(harness.completionRequests.length, 32);
  assert.deepEqual(assistantMessages(harness.streamEvents), ["I ran 32 actions and stopped before the last check."]);
  assert.doesNotMatch(JSON.stringify(harness.streamEvents), /Limit reached/u);
});

test("a failed action's error goes back to the model, and the action stays available", async () => {
  const harness = createHarness(
    [toolCompletion("action_search", 1), toolCompletion("action_search", 2), textCompletion("The second search found it.")],
    {
      executeToolCall(_request, sequence) {
        return sequence === 1
          ? { ok: false, error: { code: "assistant_tool_failed", message: "Tool call failed." } }
          : { ok: true, result: { found: 1 } };
      }
    }
  );

  await harness.run();

  assert.deepEqual(harness.executedTools.map(request => request.toolName), ["action_search", "action_search"]);
  assert.deepEqual(JSON.parse(harness.completionRequests[1].messages.at(-1).content),
    { error: { code: "assistant_tool_failed", message: "Tool call failed." } });
  assert.ok(harness.completionRequests[1].tools.some(tool => tool.function.name === "action_search"), "The failed action is not hidden");
  assert.deepEqual(assistantMessages(harness.streamEvents), ["The second search found it."]);
});


test("answer text reaches the client before the provider finishes, then persists once", async () => {
  const firstChunk = Promise.withResolvers();
  const continueResponse = Promise.withResolvers();
  async function* response() {
    yield { choices: [{ delta: { content: "The first sentence." } }] };
    firstChunk.resolve();
    await continueResponse.promise;
    yield { choices: [{ delta: { content: " The second sentence." } }] };
    yield { choices: [{ delta: {}, finish_reason: "stop" }] };
  }
  const harness = createHarness([response()]);
  const running = harness.run();
  await firstChunk.promise;
  const deltas = () => harness.streamEvents.filter(event => event.method === "sendAssistantDelta");
  for (let tries = 0; tries < 200 && !deltas().length; tries += 1) await new Promise(resolve => setTimeout(resolve, 5));
  try {
    assert.deepEqual(harness.streamEvents.filter(event => event.method === "sendAssistantDelta").map(event => event.payload.delta), ["The first sentence."]);
    assert.deepEqual(harness.completedConversations, []);
    assert.deepEqual(harness.transcriptMessages.filter(message => message.role === "assistant"), []);
  } finally {
    continueResponse.resolve();
  }
  await running;
  assert.deepEqual(harness.streamEvents.filter(event => event.method === "sendAssistantDelta").map(event => event.payload.delta), ["The first sentence.", " The second sentence."]);
  assert.deepEqual(assistantMessages(harness.streamEvents), ["The first sentence. The second sentence."]);
  assert.deepEqual(harness.transcriptMessages.filter(message => message.role === "assistant").map(message => message.contentText), ["The first sentence. The second sentence."]);
});

test("tool calls written as text never run, never become answer deltas, and the model carries on once", async () => {
  async function* response() {
    for (const content of ["<th", "ink>private reasoning", "</thi", "nk>", "<｜DSML｜function_", "calls><｜DSML｜invoke name=\"action_search\">", '{"secret":"private arguments"}', "</｜DSML｜invoke></｜DSML｜function_calls>"]) {
      yield { choices: [{ delta: { content } }] };
    }
    yield { choices: [{ delta: {}, finish_reason: "stop" }] };
  }
  const harness = createHarness([response(), textCompletion("The search is complete.")]);
  await harness.run();
  assert.deepEqual(harness.executedTools, [], "A tool call written as text is not run");
  assert.match(messageText(harness.completionRequests[1].messages.at(-1)), /^\(Check from the app: your last message contained raw markup/u);
  assert.doesNotMatch(JSON.stringify(harness.streamEvents), /DSML|private reasoning|private arguments/u);
  assert.deepEqual(assistantMessages(harness.streamEvents), ["The search is complete."]);
});

test("application-authorized attachments reach the model and are authorized again from saved history", async () => {
  const calls = [];
  const receipt = { attachmentId: "file-one", fileName: "notes.txt", size: 12 };
  const attachments = { async resolve(request) {
    calls.push(request);
    assert.equal(request.context.actor.id, "1");
    assert.equal(request.conversation.id, "conversation_1");
    if (request.attachmentIds[0] !== "file-one") throw new Error("Attachment access denied");
    return { attachments: [receipt], content: [{ type: "text", text: "Authorized file bytes" }] };
  } };
  const harness = createHarness([textCompletion("I read your notes."), textCompletion("They mention the plan.")], { attachments });
  await harness.run("Read this", { attachmentIds: ["file-one"] });
  assert.equal(calls.length, 1, "The new message's file is authorized before admission");
  assert.deepEqual(harness.transcriptMessages[0].metadata.attachments, [receipt]);
  assert.deepEqual(harness.completionRequests[0].messages.at(-1).content, [
    { type: "text", text: "Read this" }, { type: "text", text: "Authorized file bytes" }
  ]);
  await harness.run("What do they say?", { messageId: "message_2" });
  assert.equal(calls.length, 2, "The saved file is authorized again when the next turn reads its history");
  assert.ok(harness.completionRequests[1].messages.some(message => message.role === "user" && Array.isArray(message.content) &&
    message.content.some(part => part.text === "Authorized file bytes")), "The saved history gives the model the earlier file");
  const denied = createHarness([textCompletion("Must not run")], { attachments });
  await assert.rejects(denied.run("Read this", { attachmentIds: ["another-users-file"] }), /access denied/);
  assert.deepEqual(denied.completionRequests, []);
  assert.deepEqual(denied.transcriptMessages, []);
  const disabled = createHarness([textCompletion("Must not run")]);
  await assert.rejects(disabled.run("Read this", { attachmentIds: ["file-one"] }), /not configured/);
  const legacy = createHarness([textCompletion("Must not run")], { attachments, supportsAttachments: false });
  await assert.rejects(legacy.run("Read this", { attachmentIds: ["file-one"] }), /not configured/);
});

test("attachment identifiers use the conversation runtime's shape before any file is resolved", async () => {
  const calls = [];
  const attachments = { async resolve(request) { calls.push(request); return { attachments: [], content: [] }; } };
  for (const attachmentIds of [["file-one", "file-one"], ["  "], Array.from({ length: 11 }, (_, index) => `file-${index}`)]) {
    const harness = createHarness([textCompletion("Must not run")], { attachments });
    await assert.rejects(harness.run("Read this", { attachmentIds }), error =>
      error.status === 400 && /Invalid attachment identifiers/u.test(error.message));
    assert.deepEqual(harness.completionRequests, []);
  }
  assert.deepEqual(calls, []);
});

// Counts the conversations the chat service opens and disposes in the runtime.
function countDisposals() {
  const counts = { opened: 0, disposed: 0 };
  const wrapRuntime = (runtime) => ({ ...runtime, async open(input) {
    const handle = await runtime.open(input);
    counts.opened += 1;
    return { ...handle, async dispose(options) { counts.disposed += 1; return handle.dispose(options); } };
  } });
  return { counts, wrapRuntime };
}

test("each settled turn releases its conversation, and a later turn opens it again", async () => {
  const { counts, wrapRuntime } = countDisposals();
  const harness = createHarness([textCompletion("First answer."), textCompletion("Second answer.")], { wrapRuntime });

  assert.equal((await harness.run("First question", { messageId: "message_1" })).status, "completed");
  assert.deepEqual(counts, { opened: 1, disposed: 1 }, "a finished turn keeps no runtime conversation open");
  assert.equal((await harness.run("Second question", { messageId: "message_2" })).status, "completed");
  assert.deepEqual(counts, { opened: 2, disposed: 2 });
  assert.deepEqual(assistantMessages(harness.streamEvents), ["First answer.", "Second answer."]);
});

test("a conversation stays open until the last of its overlapping turns settles", async () => {
  const { counts, wrapRuntime } = countDisposals();
  const firstChunk = Promise.withResolvers();
  const continueResponse = Promise.withResolvers();
  async function* held() {
    yield { choices: [{ delta: { content: "Held answer." } }] };
    firstChunk.resolve();
    await continueResponse.promise;
    yield { choices: [{ delta: {}, finish_reason: "stop" }] };
  }
  const harness = createHarness([held()], { wrapRuntime });

  const first = harness.run("First question", { messageId: "message_1" });
  await firstChunk.promise;
  // A second tab sends while the first answer is still running; the runtime refuses it.
  assert.equal((await harness.run("Second question", { messageId: "message_2" })).status, "failed");
  assert.equal(counts.disposed, 0, "the refused turn must not close the conversation the first turn still uses");
  continueResponse.resolve();
  assert.equal((await first).status, "completed");
  assert.deepEqual(counts, { opened: 2, disposed: 1 });
});

for (const failure of ["rejects", "throws"]) {
  test(`a conversation whose disposal ${failure} is released like any failed disposal`, async () => {
    const counts = { opened: 0, disposed: 0 };
    let openError = null;
    const wrapRuntime = (runtime) => ({ ...runtime, async open(input) {
      if (openError) throw openError;
      const handle = await runtime.open(input);
      counts.opened += 1;
      return { ...handle, dispose() {
        counts.disposed += 1;
        const error = new Error("The conversation could not be saved.");
        if (failure === "throws") throw error;
        return Promise.reject(error);
      } };
    } });
    const harness = createHarness([textCompletion("First answer.")], { wrapRuntime });

    assert.equal((await harness.run("First question", { messageId: "message_1" })).status, "completed",
      "a failed disposal does not change the settled turn's outcome");
    openError = new Error("The conversation runtime is closing.");
    await assert.rejects(harness.run("Second question", { messageId: "message_2" }), /runtime is closing/u);
    assert.deepEqual(counts, { opened: 1, disposed: 1 }, "a later turn never reuses or disposes the released turn's handle");
  });
}
