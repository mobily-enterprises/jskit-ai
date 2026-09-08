import { AppError } from "@jskit-ai/kernel/server/runtime";
import { normalizeObject, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveWorkspaceSlug } from "@jskit-ai/assistant-core/server";
import {
  ASSISTANT_STREAM_EVENT_TYPES
} from "@jskit-ai/assistant-core/shared";
import { resolveAssistantSurfaceConfig } from "../../shared/assistantSurfaces.js";
import { isAssistantProgressOnlyText } from "../../shared/assistantResponseText.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_INPUT_CHARS = 8000;
const MAX_TOOL_ROUNDS = 16;
const MAX_RECOVERY_PASSES = 3;
const MAX_TOOL_RESULT_FALLBACK_CHARS = 4000;
const CURRENT_TIME_PREFLIGHT_INTENT = "current-time";
const CLOCK_INSTRUCTION = "For current or relative date and time questions, first use any available authoritative workspace clock action; never infer the current date or time from model knowledge.";
const COMPLETION_INSTRUCTION = "Do not narrate future work or describe what you are about to do. Either call the required available tool now or provide the completed final answer.";

function normalizeConversationId(value) {
  return normalizeRecordId(value, { fallback: null });
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
      if (!content || (role === "assistant" && isAssistantProgressOnlyText(content))) {
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

  return String(error.name || "").trim() === "AbortError";
}

function requiresCurrentTime(value = "") {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }

  return [
    /\b(?:now|today|tomorrow|yesterday|tonight)\b/iu,
    /\b(?:current|local)\s+(?:date|day|time|date\s+and\s+time)\b/iu,
    /\bwhat(?:'s|\s+is)\s+(?:the\s+)?(?:date|day|time)\b/iu,
    /\b(?:this|next|last)\s+(?:day|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/iu
  ].some((pattern) => pattern.test(text));
}

function resolvePreflightTools(toolDescriptors = [], input = "") {
  if (!requiresCurrentTime(input)) {
    return [];
  }

  const currentTimeTool = toolDescriptors.find((tool) => {
    const intents = Array.isArray(tool?.preflight) ? tool.preflight : [];
    const requiredParameters = Array.isArray(tool?.parameters?.required)
      ? tool.parameters.required
      : [];
    return requiredParameters.length < 1 && intents.includes(CURRENT_TIME_PREFLIGHT_INTENT);
  });

  return currentTimeTool ? [currentTimeTool] : [];
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

function buildSystemPrompt({ targetSurfaceId = "", toolDescriptors = [], workspaceSlug = "", customSystemPrompt = "" } = {}) {
  const toolSummary = toolDescriptors.length > 0
    ? `Available tools: ${toolDescriptors.map((entry) => entry.name).join(", ")}.`
    : "No tools are currently available for this user/session.";
  const toolContracts = toolDescriptors.length > 0
    ? `Tool contracts: ${toolDescriptors.map((entry) => buildToolContractLine(entry)).filter(Boolean).join(" | ")}.`
    : "Tool contracts: none.";
  const normalizedWorkspaceSlug = normalizeText(workspaceSlug).toLowerCase();
  const workspaceLine = normalizedWorkspaceSlug
    ? `Current workspace slug: ${normalizedWorkspaceSlug}.`
    : "No workspace context is active for this assistant.";
  const normalizedCustomSystemPrompt = String(customSystemPrompt || "").trim();

  const promptSegments = [
    `You are the assistant for the ${normalizeText(targetSurfaceId) || "assistant"} surface.`,
    "Use tools when they are necessary and only when available.",
    "Do not mention tools that are not available.",
    "When answering schema questions, rely only on tool contracts and tool results.",
    CLOCK_INSTRUCTION,
    workspaceLine,
    toolSummary,
    toolContracts
  ];
  if (toolDescriptors.length > 0) {
    promptSegments.push(
      "For counts or summaries, first look for a suitable count, aggregate, or report action before reading individual records. Use collection reads when no such action can answer the request. For requests to read several records, compare records, or examine all records, look for a collection action such as list, search, or query.",
      "Match the user's current scope. When the user broadens a request, find the underlying collection and remove earlier date or other filters that no longer apply; a previous result subset is not the full collection.",
      "Inspect the action's input and output contracts, use supported filters and field selection, and follow returned pagination until the requested number or scope is covered. For all records or a comparison across the whole collection, cover every relevant page unless a suitable aggregate action answers the request. Never present a partial page or sample as complete; state any incomplete coverage."
    );
  }
  if (toolDescriptors.some((tool) => tool.name === "assistant_action_search")) {
    promptSegments.push(
      "The directly exposed tools are entry points into a larger authorized action catalog. Additional application capabilities are available through assistant_action_search, assistant_action_contract, and assistant_action_execute.",
      "Before claiming an operation or dataset is unavailable or asking the user for access, discover relevant actions with assistant_action_search. Search for the resource and the requested operation: list/search/query for reading records, count/aggregate/report for totals or summaries. Search matches literal words, not meanings: use short resource or operation terms, try broader terms such as list or query when wording differs, or omit query to browse. Continue through catalog nextCursor pages when needed to find a relevant action; one empty search or unrelated page does not establish that a capability is absent.",
      "Choose an action by its returned description and exact contract, then load assistant_action_contract before assistant_action_execute. Use discovered action IDs and contract fields; do not invent them. Catalog pagination discovers actions; a collection action's pagination retrieves records."
    );
  }
  if (normalizedCustomSystemPrompt) {
    promptSegments.push(`Additional instructions for this surface: ${normalizedCustomSystemPrompt}`);
  }

  return promptSegments.join(" ");
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
    return `One or more tool calls may fail. Continue with available successful results. Do not output function-call markup. Do not mention failed operations unless explicitly asked. ${COMPLETION_INSTRUCTION}${failureSuffix}${successSuffix}`;
  }

  return `Tool-call rounds were exhausted. Provide the best direct answer with available context and successful results only. ${COMPLETION_INSTRUCTION}${failureSuffix}${successSuffix}`;
}

function buildRecoveryFallbackAnswer({ reason = "", toolFailures = [], toolSuccesses = [] } = {}) {
  if (normalizeText(reason).toLowerCase() === "max_tool_rounds") {
    return "Limit reached. Start a new conversation.";
  }

  return buildToolOutcomeFallbackAnswer({
    toolFailures,
    toolSuccesses
  });
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
  const successfulResults = (Array.isArray(toolSuccesses) ? toolSuccesses : [])
    .filter((entry) => normalizeText(entry?.name));
  const hasFailures = Array.isArray(toolFailures) && toolFailures.length > 0;

  if (successfulResults.length > 0) {
    const latestSuccess = successfulResults.at(-1);
    const answer = `Latest successful result from ${normalizeText(latestSuccess.name)}:\n${toSafeToolResultText(latestSuccess.result)}`;
    if (answer.length <= MAX_TOOL_RESULT_FALLBACK_CHARS) {
      return answer;
    }

    const suffix = "\n…[truncated]";
    return `${answer.slice(0, MAX_TOOL_RESULT_FALLBACK_CHARS - suffix.length)}${suffix}`;
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
    /<[^>\n]*invoke\b[^>\n]*>[\s\S]*?<\/[^>\n]*invoke>/gi,
    /<(?:analysis|reasoning|think)>[\s\S]*?<\/(?:analysis|reasoning|think)>/gi
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

function buildAssistantToolCallMessage(toolCalls = []) {
  return {
    role: "assistant",
    content: "",
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

async function consumeCompletionStream(stream) {
  let assistantText = "";
  const toolCallsByIndex = new Map();

  for await (const chunk of stream) {
    const choice = chunk?.choices?.[0] || {};
    const delta = choice?.delta || {};

    const textDelta = extractTextDelta(delta.content);
    if (textDelta) {
      assistantText += textDelta;
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

function requireAssistantSurface(appConfig = {}, targetSurfaceId = "") {
  const assistantSurface = resolveAssistantSurfaceConfig(appConfig, targetSurfaceId);
  if (assistantSurface) {
    return assistantSurface;
  }

  throw new AppError(404, "Assistant not found.");
}

function buildAssistantActionContext(context = {}, assistantSurface = {}) {
  return {
    ...normalizeObject(context),
    surface: assistantSurface.targetSurfaceId
  };
}

function createChatService({
  aiClientFactory,
  transcriptService,
  serviceToolCatalog,
  assistantConfigService,
  appConfig = {},
  resolveAppConfig = null,
  workspaceScopeSupport = null
} = {}) {
  if (!aiClientFactory || typeof aiClientFactory.resolveClient !== "function" || !transcriptService || !serviceToolCatalog || !assistantConfigService) {
    throw new Error(
      "createChatService requires aiClientFactory.resolveClient(), transcriptService, serviceToolCatalog, and assistantConfigService."
    );
  }

  const resolveCurrentAppConfig =
    typeof resolveAppConfig === "function" ? resolveAppConfig : () => appConfig;

  function resolveRuntimeWorkspace(assistantSurface, context = {}, input = {}) {
    if (assistantSurface?.runtimeSurfaceRequiresWorkspace !== true) {
      return null;
    }

    if (!workspaceScopeSupport || typeof workspaceScopeSupport.resolveWorkspace !== "function") {
      throw new Error("assistant.chat.service requires workspace server scope support for workspace-scoped assistant surfaces.");
    }

    return workspaceScopeSupport.resolveWorkspace(context, input);
  }

  async function streamChat(payload = {}, options = {}) {
    const assistantSurface = requireAssistantSurface(resolveCurrentAppConfig(), payload?.targetSurfaceId);
    const aiClient = aiClientFactory.resolveClient(assistantSurface.targetSurfaceId);
    if (!aiClient.enabled) {
      throw new AppError(503, "Assistant provider is not configured.");
    }

    const context = normalizeObject(options.context);
    const assistantContext = buildAssistantActionContext(context, assistantSurface);
    const workspace = resolveRuntimeWorkspace(assistantSurface, assistantContext, payload);
    const source = normalizeStreamInput(payload);
    const streamWriter = options.streamWriter;
    if (!hasStreamWriter(streamWriter)) {
      throw new Error("assistant.chat.stream requires streamWriter methods.");
    }

    const actor = context.actor;

    const conversationResult = await transcriptService.createConversationForTurn(
      assistantSurface,
      workspace,
      actor,
      {
        conversationId: source.conversationId,
        provider: aiClient.provider,
        model: aiClient.defaultModel,
        surfaceId: assistantSurface.targetSurfaceId,
        messageId: source.messageId
      },
      {
        context: assistantContext
      }
    );

    const conversation = conversationResult.conversation;
    const conversationId = conversation?.id;
    if (!conversationId) {
      throw new AppError(500, "Assistant failed to create conversation.");
    }

    await transcriptService.appendMessage(
      assistantSurface,
      conversationId,
      {
        role: "user",
        kind: "chat",
        clientMessageSid: source.messageId,
        contentText: source.input,
        metadata: {
          surfaceId: assistantSurface.targetSurfaceId
        }
      },
      {
        context: assistantContext,
        workspace
      }
    );

    const toolSet = serviceToolCatalog.resolveToolSet(assistantContext);
    const customSystemPrompt = await assistantConfigService.resolveSystemPrompt(
      assistantSurface,
      workspace,
      {
        surface: assistantSurface.targetSurfaceId
      },
      {
        context: assistantContext,
        input: payload
      }
    );
    const systemPrompt = buildSystemPrompt({
      targetSurfaceId: assistantSurface.targetSurfaceId,
      toolDescriptors: toolSet.tools,
      workspaceSlug: resolveWorkspaceSlug(assistantContext, payload),
      customSystemPrompt
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
        assistantSurface,
        conversationId,
        {
          role: "assistant",
          kind: "chat",
          contentText: normalizedAssistantMessageText
        },
        {
          context: assistantContext,
          workspace
        }
      );

      await transcriptService.completeConversation(
        assistantSurface,
        conversationId,
        {
          status: "completed",
          metadata
        },
        {
          context: assistantContext,
          workspace
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
          assistantSurface,
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
            context: assistantContext,
            workspace
          }
        );

        const toolResult = await serviceToolCatalog.executeToolCall({
          toolName: toolCall.name,
          argumentsText: toolCall.arguments,
          context: assistantContext,
          toolSet
        });

        await transcriptService.appendMessage(
          assistantSurface,
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
            context: assistantContext,
            workspace
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
        const completion = await consumeCompletionStream(completionStream);

        const recoveryToolCalls = completion.toolCalls.filter((entry) => entry.name);
        if (recoveryToolCalls.length > 0) {
          continue;
        }

        const assistantMessageText = normalizeText(sanitizeAssistantMessageText(completion.assistantText));
        if (assistantMessageText && !isAssistantProgressOnlyText(assistantMessageText)) {
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

      const preflightTools = resolvePreflightTools(toolSet.tools, source.input);
      for (const [index, tool] of preflightTools.entries()) {
        const toolCall = {
          id: `assistant_preflight_${index + 1}`,
          name: tool.name,
          arguments: "{}"
        };
        messages.push(buildAssistantToolCallMessage([toolCall]));
        const preflightFailures = await executeToolCalls([toolCall], {
          toolFailures,
          toolSuccesses
        });
        for (const failure of preflightFailures) {
          const toolName = normalizeText(failure?.name);
          if (toolName) {
            excludedToolNames.add(toolName);
          }
        }
      }

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

        const completion = await consumeCompletionStream(completionStream);

        const toolCalls = completion.toolCalls.filter((entry) => entry.name);
        if (toolCalls.length < 1) {
          const finalMessageText = normalizeText(sanitizeAssistantMessageText(completion.assistantText));
          if (finalMessageText && !isAssistantProgressOnlyText(finalMessageText)) {
            return completeWithAssistantMessage(finalMessageText, {
              metadata: toolFailures.length > 0
                ? {
                    recoveryReason: "tool_failure",
                    toolFailureCount: toolFailures.length
                  }
                : {}
            });
          }

          messages.push({
            role: "system",
            content: COMPLETION_INSTRUCTION
          });
          continue;
        }

        messages.push(buildAssistantToolCallMessage(toolCalls));

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

      if (streamed) {
        await transcriptService.completeConversation(
          assistantSurface,
          conversationId,
          {
            status
          },
          {
            context: assistantContext,
            workspace
          }
        );

        streamWriter.sendError({
          type: ASSISTANT_STREAM_EVENT_TYPES.ERROR,
          messageId: source.messageId,
          code: aborted ? "assistant_stream_aborted" : String(error?.code || "assistant_stream_failed"),
          message: aborted ? "Assistant request was cancelled." : String(error?.message || "Assistant request failed."),
          status: aborted ? 499 : Number(error?.status || error?.statusCode || 500)
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
    const assistantSurface = requireAssistantSurface(resolveCurrentAppConfig(), options?.input?.targetSurfaceId);
    const context = normalizeObject(options.context);
    const assistantContext = buildAssistantActionContext(context, assistantSurface);
    const workspace = resolveRuntimeWorkspace(assistantSurface, assistantContext, options.input || {});
    return transcriptService.listConversationsForUser(assistantSurface, workspace, assistantContext.actor, query, {
      context: assistantContext
    });
  }

  async function getConversationMessages(conversationId, query = {}, options = {}) {
    const assistantSurface = requireAssistantSurface(resolveCurrentAppConfig(), options?.input?.targetSurfaceId);
    const context = normalizeObject(options.context);
    const assistantContext = buildAssistantActionContext(context, assistantSurface);
    const workspace = resolveRuntimeWorkspace(assistantSurface, assistantContext, options.input || {});
    return transcriptService.getConversationMessagesForUser(
      assistantSurface,
      workspace,
      assistantContext.actor,
      conversationId,
      query,
      {
        context: assistantContext
      }
    );
  }

  return Object.freeze({
    streamChat,
    listConversations,
    getConversationMessages
  });
}

export { createChatService };
