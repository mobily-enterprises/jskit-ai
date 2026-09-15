import assert from "node:assert/strict";
import test from "node:test";
import { createChatService } from "../src/server/services/chatService.js";

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
}

function createHarness(completions, { executeToolCall = null, tools: configuredTools = null, attachments, supportsAttachments = true } = {}) {
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

  const chatService = createChatService({
    attachments,
    aiClientFactory: {
      resolveClient() {
        return {
          enabled: true,
          supportsAttachments,
          provider: "test",
          defaultModel: "test-model",
          async createChatCompletionStream(request) {
            completionRequests.push({
              messages: structuredClone(request.messages),
              tools: structuredClone(request.tools)
            });
            const completion = pendingCompletions.shift();
            assert.ok(completion, "Expected a queued assistant completion.");
            return completion[Symbol.asyncIterator] ? completion : completionStream(completion);
          }
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
      async appendMessage(_surface, _conversationId, message) {
        transcriptMessages.push(structuredClone(message));
      },
      async completeConversation(_surface, _conversationId, completion) {
        completedConversations.push(structuredClone(completion));
      }
    },
    serviceToolCatalog: {
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
  });

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
            id: "user_1"
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
  assert.deepEqual(request.tools, []);
  assert.match(request.messages[0].content, /No tools are currently available for this user\/session/u);
  assert.doesNotMatch(request.messages[0].content, /assistant_action_search|collection action/u);
});

test("progress-only output is replaced on retry and current-time prompts require a workspace clock", async () => {
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
        outputSchema: { type: "object" },
        preflight: ["current-time"]
      }],
      executeToolCall() {
        return {
          ok: true,
          result: {
            localDateTime: "2026-08-25T11:15:00+08:00",
            timeZone: "Australia/Perth"
          }
        };
      }
    }
  );

  const result = await harness.run("What day is it today?");

  assert.equal(result.status, "completed");
  assert.deepEqual(harness.executedTools.map((request) => request.toolName), ["workspace_clock"]);
  assert.equal(
    harness.completionRequests[0].messages.some((message) => (
      message.role === "tool" && /Australia\/Perth/u.test(message.content)
    )),
    true
  );
  assert.deepEqual(assistantMessages(harness.streamEvents), ["It is Tuesday in the workspace timezone."]);
  assert.ok(harness.streamEvents.some((event) => event.method === "sendAssistantDelta"));
  assert.match(
    harness.completionRequests[0].messages[0].content,
    /first use any available authoritative workspace clock action/u
  );
  assert.equal(
    harness.completionRequests[1].messages.some((message) => message.content === "Let me query the current time."),
    false
  );
  assert.equal(
    harness.completionRequests[1].messages.some((message) => /Either call the required available tool now/u.test(message.content)),
    true
  );
  assert.deepEqual(
    harness.transcriptMessages
      .filter((message) => message.kind === "chat")
      .map((message) => message.contentText),
    ["What day is it today?", "It is Tuesday in the workspace timezone."]
  );
});

test("current-time preflight does not run for unrelated prompts", async () => {
  const harness = createHarness(
    [textCompletion("There are three active bookings.")],
    {
      tools: [{
        name: "workspace_clock",
        parameters: { type: "object", properties: {} },
        outputSchema: { type: "object" },
        preflight: ["current-time"]
      }]
    }
  );

  await harness.run("How many active bookings are there?");

  assert.deepEqual(harness.executedTools, []);
  assert.deepEqual(assistantMessages(harness.streamEvents), ["There are three active bookings."]);
});

test("current-time preflight does not invent required tool input", async () => {
  const harness = createHarness(
    [textCompletion("Choose a timezone before asking for its local time.")],
    {
      tools: [{
        name: "timezone_clock",
        parameters: {
          type: "object",
          required: ["timeZone"],
          properties: {
            timeZone: { type: "string" }
          }
        },
        outputSchema: { type: "object" },
        preflight: ["current-time"]
      }]
    }
  );

  await harness.run("What time is it now?");

  assert.deepEqual(harness.executedTools, []);
  assert.deepEqual(assistantMessages(harness.streamEvents), ["Choose a timezone before asking for its local time."]);
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
  const assistantToolMessages = harness.completionRequests
    .flatMap((request) => request.messages)
    .filter((message) => Array.isArray(message.tool_calls));
  assert.ok(assistantToolMessages.length > 0);
  assert.equal(assistantToolMessages.every((message) => message.content === ""), true);
});

test("tool-loop exhaustion gives the concise new-conversation instruction", async () => {
  const mainRounds = Array.from({ length: 16 }, (_, index) =>
    toolCompletion("action_execute", index + 1)
  );
  const harness = createHarness(
    [
      ...mainRounds,
      textCompletion("Let me prepare the answer."),
      textCompletion("I'll summarize the result."),
      textCompletion("Checking the final output.")
    ],
    {
      executeToolCall(_request, sequence) {
        return {
          ok: true,
          result: {
            sequence,
            payload: sequence === 16 ? "x".repeat(10_000) : "ok"
          }
        };
      }
    }
  );

  await harness.run();

  const finalMessages = assistantMessages(harness.streamEvents);
  assert.equal(harness.executedTools.length, 16);
  assert.equal(harness.completionRequests.length, 19);
  assert.deepEqual(finalMessages, ["Limit reached. Start a new conversation."]);
  assert.ok(harness.streamEvents.some((event) => event.method === "sendAssistantDelta"));
});

test("tool-failure recovery retains the bounded latest successful result", async () => {
  const mainRounds = Array.from({ length: 16 }, (_, index) =>
    toolCompletion(index === 1 ? "action_search" : "action_execute", index + 1)
  );
  const harness = createHarness(
    [
      ...mainRounds,
      textCompletion("Let me prepare the answer."),
      textCompletion("I'll summarize the result."),
      textCompletion("Checking the final output.")
    ],
    {
      executeToolCall(request, sequence) {
        if (request.toolName === "action_search") {
          return {
            ok: false,
            error: {
              code: "assistant_tool_failed",
              message: "Tool call failed."
            }
          };
        }
        return {
          ok: true,
          result: {
            sequence,
            payload: sequence === 16 ? "x".repeat(10_000) : "ok"
          }
        };
      }
    }
  );

  await harness.run();

  const [fallback] = assistantMessages(harness.streamEvents);
  assert.equal(harness.executedTools.length, 16);
  assert.ok(fallback.length <= 4000);
  assert.match(fallback, /Latest successful result from action_execute/u);
  assert.match(fallback, /"sequence": 16/u);
  assert.match(fallback, /…\[truncated\]$/u);
  assert.doesNotMatch(fallback, /Limit reached/u);
});


test("answer text reaches the client before the provider finishes, then persists once", async () => {
  const firstChunk = Promise.withResolvers();
  const continueResponse = Promise.withResolvers();
  async function* response() {
    yield { choices: [{ delta: { content: "The first sentence." } }] };
    firstChunk.resolve();
    await continueResponse.promise;
    yield { choices: [{ delta: { content: " The second sentence." } }] };
  }
  const harness = createHarness([response()]);
  const running = harness.run();
  await firstChunk.promise;
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

test("split internal tags and tool arguments never become answer deltas", async () => {
  async function* response() {
    for (const content of ["<th", "ink>private reasoning", "</thi", "nk>", "<｜DSML｜function_", "calls><｜DSML｜invoke name=\"action_search\">", '{"secret":"private arguments"}', "</｜DSML｜invoke></｜DSML｜function_calls>"]) {
      yield { choices: [{ delta: { content } }] };
    }
  }
  const harness = createHarness([response(), textCompletion("The search is complete.")]);
  await harness.run();
  assert.deepEqual(harness.executedTools.map(request => request.toolName), ["action_search"]);
  assert.deepEqual(harness.streamEvents.filter(event => event.method === "sendAssistantDelta").map(event => event.payload.delta), ["The search is complete."]);
  assert.deepEqual(assistantMessages(harness.streamEvents), ["The search is complete."]);
});


test("application-authorized attachments reach the model and survive transcript restore", async () => {
  const calls = [];
  const receipt = { attachmentId: "file-one", fileName: "notes.txt", size: 12 };
  const attachments = { async resolve(request) {
    calls.push(request);
    assert.equal(request.context.actor.id, "user_1");
    assert.equal(request.conversation.id, "conversation_1");
    if (request.attachmentIds[0] !== "file-one") throw new Error("Attachment access denied");
    return { attachments: [receipt], content: [{ type: "text", text: "Authorized file bytes" }] };
  } };
  const harness = createHarness([textCompletion("I read your notes.")], { attachments });
  await harness.run("Read this", { attachmentIds: ["file-one"], history: [
    { role: "user", content: "Previous file", attachmentIds: ["file-one"] }
  ] });
  assert.equal(calls.length, 2, "Both current and historical files must be authorized");
  assert.deepEqual(harness.transcriptMessages[0].metadata.attachments, [receipt]);
  assert.deepEqual(harness.completionRequests[0].messages.at(-1).content, [
    { type: "text", text: "Read this" }, { type: "text", text: "Authorized file bytes" }
  ]);
  const denied = createHarness([textCompletion("Must not run")], { attachments });
  await assert.rejects(denied.run("Read this", { attachmentIds: ["another-users-file"] }), /access denied/);
  assert.deepEqual(denied.completionRequests, []);
  assert.deepEqual(denied.transcriptMessages, []);
  const disabled = createHarness([textCompletion("Must not run")]);
  await assert.rejects(disabled.run("Read this", { attachmentIds: ["file-one"] }), /not configured/);
  const legacy = createHarness([textCompletion("Must not run")], { attachments, supportsAttachments: false });
  await assert.rejects(legacy.run("Read this", { attachmentIds: ["file-one"] }), /not configured/);
});
