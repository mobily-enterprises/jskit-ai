import { AppError, parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { ASSISTANT_STREAM_EVENT_TYPES } from "../../shared/streamEvents.js";
import { resolveWorkspaceSlug } from "../lib/resolveWorkspaceSlug.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_INPUT_CHARS = 8000;
const MAX_TOOL_ROUNDS = 4;

function normalizeConversationId(value) {
  const parsed = parsePositiveInteger(value);
  return parsed > 0 ? parsed : null;
}

function normalizeHistory(history = []) {
  const source = Array.isArray(history) ? history : [];
  return source
    .slice(0, MAX_HISTORY_MESSAGES)
    .map((entry) => {
      const item = normalizeObject(entry);
      const role = normalizeText(item.role).toLowerCase();
      if (role !== "user" && role !== "assistant") {
        return null;
      }

      const content = normalizeText(item.content).slice(0, MAX_INPUT_CHARS);
      if (!content) {
        return null;
      }

      return {
        role,
        content
      };
    })
    .filter(Boolean);
}

function normalizeStreamInput(payload = {}) {
  const source = normalizeObject(payload);
  const messageId = normalizeText(source.messageId);
  const input = normalizeText(source.input).slice(0, MAX_INPUT_CHARS);
  if (!messageId) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          messageId: "messageId is required."
        }
      }
    });
  }
  if (!input) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          input: "input is required."
        }
      }
    });
  }

  return {
    messageId,
    conversationId: normalizeConversationId(source.conversationId),
    input,
    history: normalizeHistory(source.history)
  };
}

function hasStreamWriter(streamWriter) {
  return Boolean(
    streamWriter &&
      typeof streamWriter.sendMeta === "function" &&
      typeof streamWriter.sendAssistantDelta === "function" &&
      typeof streamWriter.sendAssistantMessage === "function" &&
      typeof streamWriter.sendToolCall === "function" &&
      typeof streamWriter.sendToolResult === "function" &&
      typeof streamWriter.sendError === "function" &&
      typeof streamWriter.sendDone === "function"
  );
}

function isAbortError(error) {
  if (!error) {
    return false;
  }

  const errorName = String(error.name || "").trim();
  if (errorName === "AbortError") {
    return true;
  }

  return false;
}

function extractTextDelta(deltaContent) {
  if (typeof deltaContent === "string") {
    return deltaContent;
  }

  if (!Array.isArray(deltaContent)) {
    return "";
  }

  return deltaContent
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (!entry || typeof entry !== "object") {
        return "";
      }
      return String(entry.text || "");
    })
    .join("");
}

function toCompactJson(value, fallback = "{}") {
  try {
    if (!value || typeof value !== "object") {
      return fallback;
    }
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function buildToolContractLine(toolDescriptor = {}) {
  const name = normalizeText(toolDescriptor.name);
  if (!name) {
    return "";
  }

  const inputSchema = toolDescriptor.parameters;
  const outputSchema = toolDescriptor.outputSchema;
  return `${name}: input=${toCompactJson(inputSchema)} output=${toCompactJson(outputSchema, "null")}`;
}

function buildSystemPrompt({ toolDescriptors = [], workspaceSlug = "" } = {}) {
  const toolSummary = toolDescriptors.length > 0
    ? `Available tools: ${toolDescriptors.map((entry) => entry.name).join(", ")}.`
    : "No tools are currently available for this user/session.";
  const toolContracts = toolDescriptors.length > 0
    ? `Tool contracts: ${toolDescriptors.map((entry) => buildToolContractLine(entry)).filter(Boolean).join(" | ")}.`
    : "Tool contracts: none.";
  const normalizedWorkspaceSlug = normalizeText(workspaceSlug).toLowerCase();
  const workspaceLine = normalizedWorkspaceSlug
    ? `Current workspace slug: ${normalizedWorkspaceSlug}.`
    : "Current workspace slug is unavailable.";

  return [
    "You are the workspace assistant.",
    "Use tools when they are necessary and only when available.",
    "Do not mention tools that are not available.",
    "When answering schema questions, rely only on tool contracts and tool results.",
    workspaceLine,
    toolSummary,
    toolContracts
  ].join(" ");
}

function buildRecoveryPrompt({ reason = "", toolFailures = [], toolSuccesses = [] } = {}) {
  const normalizedReason = normalizeText(reason).toLowerCase();
  const failureSummary = (Array.isArray(toolFailures) ? toolFailures : [])
    .slice(0, 3)
    .map((entry) => {
      const toolName = normalizeText(entry?.name) || "unknown_tool";
      const errorCode = normalizeText(entry?.error?.code) || "tool_failed";
      return `${toolName}:${errorCode}`;
    })
    .filter(Boolean)
    .join(", ");
  const successSummary = (Array.isArray(toolSuccesses) ? toolSuccesses : [])
    .slice(0, 3)
    .map((entry) => normalizeText(entry?.name))
    .filter(Boolean)
    .join(", ");

  const failureSuffix = failureSummary ? ` Recent tool failures: ${failureSummary}.` : "";
  const successSuffix = successSummary ? ` Successful tools: ${successSummary}.` : "";
  if (normalizedReason === "tool_failure") {
    return `One or more tool calls may fail. Continue with available successful results. Do not output function-call markup. Do not mention failed operations unless explicitly asked.${failureSuffix}${successSuffix}`;
  }

  return `Tool-call rounds were exhausted. Provide the best direct answer with available context and successful results only.${failureSuffix}${successSuffix}`;
}

function buildRecoveryFallbackAnswer({ reason = "", toolFailures = [], toolSuccesses = [] } = {}) {
  const normalizedReason = normalizeText(reason).toLowerCase();
  if (normalizedReason === "tool_failure") {
    return buildToolOutcomeFallbackAnswer({
      toolFailures,
      toolSuccesses
    });
  }

  return "I reached the tool-call limit for this request. Please narrow the request and I will continue.";
}

function toSafeToolResultText(value) {
  if (value == null) {
    return "null";
  }
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    return normalized || "\"\"";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "\"<unserializable>\"";
  }
}

function buildToolOutcomeFallbackAnswer({ toolFailures = [], toolSuccesses = [] } = {}) {
  const successNames = [...new Set(
    (Array.isArray(toolSuccesses) ? toolSuccesses : [])
      .map((entry) => normalizeText(entry?.name))
      .filter(Boolean)
  )];
  const hasFailures = Array.isArray(toolFailures) && toolFailures.length > 0;

  if (successNames.length > 0) {
    const summaryLines = (Array.isArray(toolSuccesses) ? toolSuccesses : [])
      .filter((entry) => normalizeText(entry?.name))
      .map((entry) => {
        const name = normalizeText(entry.name);
        const payload = toSafeToolResultText(entry.result);
        return `- ${name}:\n\`\`\`json\n${payload}\n\`\`\``;
      });

    return [
      "I used the available successful results:",
      ...summaryLines
    ].join("\n");
  }

  if (hasFailures) {
    return "I could not gather additional information from successful operations.";
  }

  return "I could not gather additional information from the available operations.";
}

function sanitizeAssistantMessageText(value) {
  let source = String(value || "");
  if (!source) {
    return "";
  }

  const blockPatterns = [
    /<[^>\n]*function_calls[^>\n]*>[\s\S]*?<\/[^>\n]*function_calls>/gi,
    /<[^>\n]*tool_calls?[^>\n]*>[\s\S]*?<\/[^>\n]*tool_calls?[^>\n]*>/gi,
    /<[^>\n]*invoke\b[^>\n]*>[\s\S]*?<\/[^>\n]*invoke>/gi
  ];
  for (const pattern of blockPatterns) {
    source = source.replace(pattern, " ");
  }

  const inlineTagPatterns = [
    /<[^>\n]*invoke\b[^>]*\/>/gi,
    /<\/?[^>\n]*invoke[^>\n]*>/gi,
    /<\/?[^>\n]*function_calls[^>\n]*>/gi,
    /<\/?[^>\n]*tool_calls?[^>\n]*>/gi,
    /<\/?[^>\n]*DSML[^>\n]*>/gi
  ];
  for (const pattern of inlineTagPatterns) {
    source = source.replace(pattern, " ");
  }

  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function buildAssistantToolCallMessage({ assistantText = "", toolCalls = [] } = {}) {
  return {
    role: "assistant",
    content: assistantText || "",
    tool_calls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments
      }
    }))
  };
}

function parseDsmlToolCallsFromText(value = "") {
  const source = String(value || "");
  if (!source) {
    return [];
  }

  const functionCallsMatch = source.match(
    /<[^>\n]*function_calls[^>\n]*>([\s\S]*?)<\/[^>\n]*function_calls>/i
  );
  if (!functionCallsMatch) {
    return [];
  }

  const blockText = String(functionCallsMatch[1] || "");
  if (!blockText) {
    return [];
  }

  const calls = [];
  const invokePattern = /<[^>\n]*invoke\b([^>]*)>([\s\S]*?)<\/[^>\n]*invoke>/gi;
  let match = invokePattern.exec(blockText);
  while (match) {
    const attributes = String(match[1] || "");
    const body = normalizeText(String(match[2] || ""));
    const quotedNameMatch =
      attributes.match(/\bname\s*=\s*"([^"]+)"/i) || attributes.match(/\bname\s*=\s*'([^']+)'/i);
    const bareNameMatch = attributes.match(/\bname\s*=\s*([^\s"'/>]+)/i);
    const name = normalizeText(quotedNameMatch?.[1] || bareNameMatch?.[1]);
    if (name) {
      calls.push({
        id: `dsml_tool_call_${calls.length + 1}`,
        name,
        arguments: body && /^[\[{]/.test(body) ? body : "{}"
      });
    }

    match = invokePattern.exec(blockText);
  }

  return calls;
}

async function consumeCompletionStream({ stream, streamWriter, emitDeltas = true } = {}) {
  let assistantText = "";
  const toolCallsByIndex = new Map();

  for await (const chunk of stream) {
    const choice = chunk?.choices?.[0] || {};
    const delta = choice?.delta || {};

    const textDelta = extractTextDelta(delta.content);
    if (textDelta) {
      assistantText += textDelta;
      if (emitDeltas) {
        streamWriter.sendAssistantDelta({
          type: ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_DELTA,
          delta: textDelta
        });
      }
    }

    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const partialToolCall of toolCalls) {
      const index = Number(partialToolCall?.index || 0);
      const existing =
        toolCallsByIndex.get(index) ||
        {
          id: normalizeText(partialToolCall?.id) || `tool_call_${index + 1}`,
          name: "",
          arguments: ""
        };

      if (partialToolCall?.id) {
        existing.id = normalizeText(partialToolCall.id) || existing.id;
      }
      if (partialToolCall?.function?.name) {
        existing.name += String(partialToolCall.function.name || "");
      }
      if (partialToolCall?.function?.arguments) {
        existing.arguments += String(partialToolCall.function.arguments || "");
      }

      toolCallsByIndex.set(index, existing);
    }
  }

  let toolCalls = [...toolCallsByIndex.values()].map((toolCall, index) => ({
    id: normalizeText(toolCall.id) || `tool_call_${index + 1}`,
    name: normalizeText(toolCall.name),
    arguments: String(toolCall.arguments || "")
  }));

  if (toolCalls.length < 1) {
    const parsedDsmlCalls = parseDsmlToolCallsFromText(assistantText);
    if (parsedDsmlCalls.length > 0) {
      toolCalls = parsedDsmlCalls;
      assistantText = normalizeText(sanitizeAssistantMessageText(assistantText));
    }
  }

  return {
    assistantText,
    toolCalls
  };
}

function mapStreamError(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;

  return {
    code: String(error?.code || "assistant_stream_failed").trim() || "assistant_stream_failed",
    message: safeStatus >= 500 ? "Assistant stream failed." : String(error?.message || "Request failed."),
    status: safeStatus
  };
}

function createChatService({ aiClient, transcriptService, serviceToolCatalog } = {}) {
  if (!aiClient || !transcriptService || !serviceToolCatalog) {
    throw new Error("createChatService requires aiClient, transcriptService, and serviceToolCatalog.");
  }

  async function streamChat(payload = {}, options = {}) {
    if (!aiClient.enabled) {
      throw new AppError(503, "Assistant provider is not configured.");
    }

    const source = normalizeStreamInput(payload);
    const context = normalizeObject(options.context);
    const streamWriter = options.streamWriter;
    if (!hasStreamWriter(streamWriter)) {
      throw new Error("assistant.chat.stream requires streamWriter methods.");
    }

    const actor = context.actor;
    const workspace = context.workspace;

    const conversationResult = await transcriptService.createConversationForTurn(
      workspace,
      actor,
      {
        conversationId: source.conversationId,
        provider: aiClient.provider,
        model: aiClient.defaultModel,
        surfaceId: context.surface,
        messageId: source.messageId
      },
      {
        context
      }
    );

    const conversation = conversationResult.conversation;
    const conversationId = conversation?.id;
    if (!conversationId) {
      throw new AppError(500, "Assistant failed to create conversation.");
    }

    await transcriptService.appendMessage(
      conversationId,
      {
        role: "user",
        kind: "chat",
        clientMessageId: source.messageId,
        contentText: source.input,
        metadata: {
          surfaceId: normalizeText(context.surface)
        }
      },
      {
        context
      }
    );

    const toolSet = serviceToolCatalog.resolveToolSet(context);
    const systemPrompt = buildSystemPrompt({
      toolDescriptors: toolSet.tools,
      workspaceSlug: resolveWorkspaceSlug(context, source)
    });

    const messages = [
      {
        role: "system",
        content: systemPrompt
      },
      ...source.history,
      {
        role: "user",
        content: source.input
      }
    ];

    async function completeWithAssistantMessage(assistantMessageText, { metadata = {} } = {}) {
      const normalizedAssistantMessageText = normalizeText(sanitizeAssistantMessageText(assistantMessageText));
      if (!normalizedAssistantMessageText) {
        throw new AppError(502, "Assistant returned no output.");
      }

      await transcriptService.appendMessage(
        conversationId,
        {
          role: "assistant",
          kind: "chat",
          contentText: normalizedAssistantMessageText
        },
        {
          context
        }
      );

      await transcriptService.completeConversation(
        conversationId,
        {
          status: "completed",
          metadata
        },
        {
          context
        }
      );

      streamWriter.sendAssistantMessage({
        type: ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_MESSAGE,
        text: normalizedAssistantMessageText
      });
      streamWriter.sendDone({
        type: ASSISTANT_STREAM_EVENT_TYPES.DONE,
        messageId: source.messageId,
        status: "completed"
      });

      return {
        conversationId,
        messageId: source.messageId,
        status: "completed"
      };
    }

    async function executeToolCalls(toolCalls = [], { toolFailures = [], toolSuccesses = [] } = {}) {
      const roundFailures = [];

      for (const toolCall of toolCalls) {
        streamWriter.sendToolCall({
          type: ASSISTANT_STREAM_EVENT_TYPES.TOOL_CALL,
          toolCallId: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        });

        await transcriptService.appendMessage(
          conversationId,
          {
            role: "assistant",
            kind: "tool_call",
            contentText: toolCall.arguments,
            metadata: {
              toolCallId: toolCall.id,
              tool: toolCall.name
            }
          },
          {
            context
          }
        );

        const toolResult = await serviceToolCatalog.executeToolCall({
          toolName: toolCall.name,
          argumentsText: toolCall.arguments,
          context,
          toolSet
        });

        await transcriptService.appendMessage(
          conversationId,
          {
            role: "assistant",
            kind: "tool_result",
            contentText: JSON.stringify(toolResult),
            metadata: {
              toolCallId: toolCall.id,
              tool: toolCall.name,
              ok: toolResult.ok === true
            }
          },
          {
            context
          }
        );

        if (toolResult.ok) {
          toolSuccesses.push({
            name: toolCall.name,
            result: toolResult.result
          });
          streamWriter.sendToolResult({
            type: ASSISTANT_STREAM_EVENT_TYPES.TOOL_RESULT,
            toolCallId: toolCall.id,
            name: toolCall.name,
            ok: true,
            result: toolResult.result
          });

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult.result ?? null)
          });
          continue;
        }

        const failure = {
          name: toolCall.name,
          error: toolResult.error
        };
        roundFailures.push(failure);
        toolFailures.push(failure);

        streamWriter.sendToolResult({
          type: ASSISTANT_STREAM_EVENT_TYPES.TOOL_RESULT,
          toolCallId: toolCall.id,
          name: toolCall.name,
          ok: false,
          error: toolResult.error
        });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: toolResult.error
          })
        });
      }

      return roundFailures;
    }

    async function recoverWithoutTools({ reason = "", toolFailures = [], toolSuccesses = [] } = {}) {
      const MAX_RECOVERY_PASSES = 3;
      for (let pass = 0; pass < MAX_RECOVERY_PASSES; pass += 1) {
        const recoveryMessages = [
          ...messages,
          {
            role: "system",
            content: buildRecoveryPrompt({
              reason,
              toolFailures,
              toolSuccesses
            })
          }
        ];

        const completionStream = await aiClient.createChatCompletionStream({
          messages: recoveryMessages,
          tools: [],
          signal: options.abortSignal
        });
        const completion = await consumeCompletionStream({
          stream: completionStream,
          streamWriter,
          emitDeltas: false
        });

        const recoveryToolCalls = completion.toolCalls.filter((entry) => entry.name);
        if (recoveryToolCalls.length > 0) {
          messages.push(
            buildAssistantToolCallMessage({
              assistantText: completion.assistantText,
              toolCalls: recoveryToolCalls
            })
          );
          await executeToolCalls(recoveryToolCalls, {
            toolFailures,
            toolSuccesses
          });
          continue;
        }

        const assistantMessageText = normalizeText(sanitizeAssistantMessageText(completion.assistantText));
        if (assistantMessageText) {
          return completeWithAssistantMessage(assistantMessageText, {
            metadata: {
              recoveryReason: reason || "unknown",
              toolFailureCount: Array.isArray(toolFailures) ? toolFailures.length : 0
            }
          });
        }
      }

      const fallbackText = buildRecoveryFallbackAnswer({
        reason,
        toolFailures,
        toolSuccesses
      });
      return completeWithAssistantMessage(fallbackText, {
        metadata: {
          recoveryReason: reason || "unknown",
          toolFailureCount: Array.isArray(toolFailures) ? toolFailures.length : 0
        }
      });
    }

    let streamed = false;

    try {
      streamWriter.sendMeta({
        type: ASSISTANT_STREAM_EVENT_TYPES.META,
        messageId: source.messageId,
        conversationId,
        provider: aiClient.provider,
        model: aiClient.defaultModel
      });
      streamed = true;

      const excludedToolNames = new Set();
      const toolFailures = [];
      const toolSuccesses = [];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const roundToolDescriptors = toolSet.tools.filter(
          (tool) => !excludedToolNames.has(normalizeText(tool.name))
        );
        const roundToolSchemas = roundToolDescriptors.map((tool) => serviceToolCatalog.toOpenAiToolSchema(tool));

        const completionStream = await aiClient.createChatCompletionStream({
          messages,
          tools: roundToolSchemas,
          signal: options.abortSignal
        });

        const completion = await consumeCompletionStream({
          stream: completionStream,
          streamWriter
        });

        const toolCalls = completion.toolCalls.filter((entry) => entry.name);
        if (toolCalls.length < 1) {
          const finalMessageText = normalizeText(sanitizeAssistantMessageText(completion.assistantText));
          if (finalMessageText) {
            return completeWithAssistantMessage(finalMessageText, {
              metadata: toolFailures.length > 0
                ? {
                    recoveryReason: "tool_failure",
                    toolFailureCount: toolFailures.length
                  }
                : {}
            });
          }

          if (toolFailures.length > 0) {
            return recoverWithoutTools({
              reason: "tool_failure",
              toolFailures,
              toolSuccesses
            });
          }

          return completeWithAssistantMessage(completion.assistantText);
        }

        messages.push(
          buildAssistantToolCallMessage({
            assistantText: completion.assistantText,
            toolCalls
          })
        );

        const roundFailures = await executeToolCalls(toolCalls, {
          toolFailures,
          toolSuccesses
        });

        if (roundFailures.length > 0) {
          for (const failure of roundFailures) {
            const toolName = normalizeText(failure?.name);
            if (toolName) {
              excludedToolNames.add(toolName);
            }
          }
        }
      }

      return recoverWithoutTools({
        reason: toolFailures.length > 0 ? "tool_failure" : "max_tool_rounds",
        toolFailures,
        toolSuccesses
      });
    } catch (error) {
      const aborted = isAbortError(error);
      const status = aborted ? "aborted" : "failed";
      const streamError = mapStreamError(error);

      if (streamed) {
        await transcriptService.completeConversation(
          conversationId,
          {
            status
          },
          {
            context
          }
        );

        streamWriter.sendError({
          type: ASSISTANT_STREAM_EVENT_TYPES.ERROR,
          messageId: source.messageId,
          code: aborted ? "assistant_stream_aborted" : streamError.code,
          message: aborted ? "Assistant request was cancelled." : streamError.message,
          status: aborted ? 499 : streamError.status
        });

        streamWriter.sendDone({
          type: ASSISTANT_STREAM_EVENT_TYPES.DONE,
          messageId: source.messageId,
          status
        });

        return {
          conversationId,
          messageId: source.messageId,
          status
        };
      }

      throw error;
    }
  }

  async function listConversations(query = {}, options = {}) {
    const context = normalizeObject(options.context);
    return transcriptService.listConversationsForUser(context.workspace, context.actor, query, {
      context
    });
  }

  async function getConversationMessages(conversationId, query = {}, options = {}) {
    const context = normalizeObject(options.context);
    return transcriptService.getConversationMessagesForUser(context.workspace, context.actor, conversationId, query, {
      context
    });
  }

  return Object.freeze({
    streamChat,
    listConversations,
    getConversationMessages
  });
}

export {
  createChatService
};
