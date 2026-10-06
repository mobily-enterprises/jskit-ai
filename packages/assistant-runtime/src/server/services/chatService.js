import { isDeepStrictEqual } from "node:util";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { normalizeObject, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveWorkspaceSlug } from "@jskit-ai/assistant-core/server";
import { ASSISTANT_STREAM_EVENT_TYPES, isAssistantProgressOnlyText } from "@jskit-ai/assistant-core/shared";
import { resolveAssistantSurfaceConfig } from "../../shared/assistantSurfaces.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_INPUT_CHARS = 8000;
const CLOCK_INSTRUCTION = "For current or relative date and time questions, first use any available authoritative workspace clock action; never infer the current date or time from model knowledge.";

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
        content,
        attachmentIds: role === "user" ? item.attachmentIds : []
      };
    })
    .filter(Boolean);
}

function normalizeStreamInput(payload = {}) {
  const source = normalizeObject(payload);
  const messageId = normalizeText(source.messageId);
  const input = normalizeText(source.input).slice(0, MAX_INPUT_CHARS);
  if (!messageId || messageId.length > 128) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          messageId: "messageId is required and must be at most 128 characters."
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
    attachmentIds: source.attachmentIds,
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
  conversationRuntime,
  aiClientFactory,
  turnRequests,
  attachments,
  transcriptService,
  serviceToolCatalog,
  assistantConfigService,
  appConfig = {},
  resolveAppConfig = null,
  workspaceScopeSupport = null
} = {}) {
  if (!aiClientFactory || typeof aiClientFactory.resolveClient !== "function" || !turnRequests || !transcriptService || !serviceToolCatalog || !assistantConfigService) {
    throw new Error(
      "createChatService requires aiClientFactory.resolveClient(), turnRequests, transcriptService, serviceToolCatalog, and assistantConfigService."
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

  function replayRequest(record, request, writer) {
    if (!isDeepStrictEqual(record.request, JSON.parse(JSON.stringify(request)))) {
      throw new AppError(409, "This message ID belongs to a different request.");
    }
    const response = record.response || {};
    if (record.status === "running") {
      if (response.meta) writer.sendMeta(response.meta);
      writer.sendError({ type: ASSISTANT_STREAM_EVENT_TYPES.ERROR, code: "assistant_request_unconfirmed",
        message: "This message was already submitted. Its completion is not confirmed; check conversation history before sending new work." });
      writer.sendDone({ type: ASSISTANT_STREAM_EVENT_TYPES.DONE, messageId: request.messageId, status: "unconfirmed" });
      return { conversationId: response.meta?.conversationId, messageId: request.messageId, status: "unconfirmed" };
    }
    if (response.failure && !response.meta) throw new AppError(response.failure.status, response.failure.message);
    if (response.meta) writer.sendMeta(response.meta);
    if (response.answer) writer.sendAssistantMessage(response.answer);
    if (response.error) writer.sendError(response.error);
    if (response.failure) writer.sendError({ type: ASSISTANT_STREAM_EVENT_TYPES.ERROR, ...response.failure });
    writer.sendDone(response.done || { type: ASSISTANT_STREAM_EVENT_TYPES.DONE, messageId: request.messageId, status: record.status });
    return { conversationId: response.meta?.conversationId, messageId: request.messageId, status: record.status };
  }

  async function streamChat(payload = {}, options = {}) {
    const assistantSurface = requireAssistantSurface(resolveCurrentAppConfig(), payload?.targetSurfaceId);
    const context = normalizeObject(options.context);
    const assistantContext = buildAssistantActionContext(context, assistantSurface);
    const workspace = resolveRuntimeWorkspace(assistantSurface, assistantContext, payload);
    const source = normalizeStreamInput(payload);
    const actor = context.actor;
    const actorUserId = normalizeRecordId(actor?.id, { fallback: null });
    if (!actorUserId) throw new AppError(401, "Authentication required.");
    if (!hasStreamWriter(options.streamWriter)) throw new Error("assistant.chat.stream requires streamWriter methods.");
    const scope = { actorUserId, surfaceId: assistantSurface.targetSurfaceId,
      workspaceId: normalizeRecordId(workspace?.id || workspace, { fallback: null }) };
    const request = { ...source, integrationId: normalizeText(payload.integrationId) };
    const existing = await turnRequests.find(scope, source.messageId);
    if (existing) return replayRequest(existing, request, options.streamWriter);
    const aiClient = await aiClientFactory.resolveClient(assistantSurface.targetSurfaceId, {
      context: assistantContext, integrationId: payload.integrationId
    });
    if (!aiClient.enabled) throw new AppError(503, "Assistant provider is not configured.");
    const claim = await turnRequests.claim(scope, request);
    if (!claim.acquired) return replayRequest(claim, request, options.streamWriter);
    const response = {};
    const output = options.streamWriter;
    const streamWriter = {
      sendToolCall: event => output.sendToolCall(event),
      sendToolResult: event => output.sendToolResult(event),
      sendMeta(event) { response.meta = event; output.sendMeta(event); },
      sendAssistantDelta(event) {
        response.answer = { type: ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_MESSAGE,
          text: `${response.answer?.text || ""}${event.delta || ""}`, status: "streaming" };
        output.sendAssistantDelta(event);
      },
      sendAssistantMessage(event) { response.answer = event; output.sendAssistantMessage(event); },
      sendError(event) { response.error = event; output.sendError(event); },
      sendDone(event) { response.done = event; }
    };
    let result;
    try {
      result = await executeTurn();
    } catch (error) {
      response.failure = { message: String(error?.message || "Assistant request failed."),
        status: Number(error?.status || error?.statusCode || 500) };
      await turnRequests.update(claim, response, "failed");
      throw error;
    }
    await turnRequests.update(claim, response, result.status);
    if (response.done) output.sendDone(response.done);
    return result;

    async function executeTurn() {
      if (typeof conversationRuntime?.open !== "function") throw new TypeError("Assistant streaming requires its common conversation runtime.");
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

      const resolvedAttachments = [];
      async function prepareAttachments(attachmentIds) {
        if (attachmentIds === undefined || (Array.isArray(attachmentIds) && !attachmentIds.length)) return;
        if (!Array.isArray(attachmentIds) || attachmentIds.length > 10 ||
            attachmentIds.some(id => typeof id !== "string" || !id || id.length > 256)) {
          throw new AppError(400, "Invalid attachment identifiers.");
        }
        if (!attachments?.resolve || !aiClient.supportsAttachments) {
          throw new AppError(400, "File attachments are not configured for this assistant.");
        }
        // Preserve the facade's existing pre-admission authorization order.
        // Only these server-resolved materials reach the common file reader.
        const files = await attachments.resolve({ attachmentIds, context: assistantContext, workspace, conversation });
        resolvedAttachments.push({ attachmentIds: [...attachmentIds], files });
      }
      await prepareAttachments(source.attachmentIds);
      for (const message of source.history) await prepareAttachments(message.attachmentIds);
      const toolSet = serviceToolCatalog.resolveToolSet(assistantContext);
      const customSystemPrompt = await assistantConfigService.resolveSystemPrompt(
        assistantSurface, workspace, { surface: assistantSurface.targetSurfaceId },
        { context: assistantContext, input: payload }
      );
      const configuration = { systemPrompt: buildSystemPrompt({
        targetSurfaceId: assistantSurface.targetSurfaceId, toolDescriptors: toolSet.tools,
        workspaceSlug: resolveWorkspaceSlug(assistantContext, payload), customSystemPrompt
      }), ...(request.integrationId ? { integrationId: request.integrationId } : {}) };
      const runtimeContext = { ...assistantContext, assistantRequest: {
        conversation, workspace, history: source.history, resolvedAttachments
      } };
      let handle;
      try { handle = await conversationRuntime.open({ id: conversationId, context: runtimeContext, configuration }); }
      catch (error) {
        if (error.code !== "conversation_configuration_mismatch") throw error;
        handle = await conversationRuntime.open({ id: conversationId, context: runtimeContext });
        await handle.configure(configuration);
      }
      let turnId = null;
      let displayedId = null;
      let displayedText = "";
      const release = await handle.subscribe(event => {
        if (event.type === "accepted" && event.messageId === source.messageId) turnId = event.turnId;
        if (!turnId || event.turnId !== turnId) return;
        if (event.type === "message" && ["assistant", "commentary"].includes(event.role)) {
          if (displayedId !== event.messageId) {
            if (displayedText) streamWriter.sendAssistantMessage({ type: ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_MESSAGE, text: "", status: "streaming" });
            displayedId = event.messageId;
            displayedText = "";
          }
          if (event.text === displayedText) return;
          if (event.text.startsWith(displayedText)) streamWriter.sendAssistantDelta({ type: ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_DELTA, delta: event.text.slice(displayedText.length) });
          else streamWriter.sendAssistantMessage({ type: ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_MESSAGE, text: event.text, status: "streaming" });
          displayedText = event.text;
        } else if (event.type === "tool") {
          const call = event.call;
          if (call.status === "running") streamWriter.sendToolCall({ type: ASSISTANT_STREAM_EVENT_TYPES.TOOL_CALL,
            toolCallId: call.id, name: call.name, arguments: call.arguments });
          else if (call.result) streamWriter.sendToolResult({ type: ASSISTANT_STREAM_EVENT_TYPES.TOOL_RESULT,
            toolCallId: call.id, name: call.name, ok: call.result.ok === true,
            ...(call.result.ok ? { result: call.result.result } : { error: call.result.error }) });
        }
      });
      let cancellation;
      const cancel = () => { cancellation ||= handle.cancel(); cancellation.catch(() => {}); };
      let streamed = false;
      try {
        const meta = { type: ASSISTANT_STREAM_EVENT_TYPES.META, messageId: source.messageId, conversationId,
          provider: aiClient.provider, model: aiClient.defaultModel };
        await turnRequests.update(claim, { meta });
        streamWriter.sendMeta(meta);
        streamed = true;
        options.abortSignal?.addEventListener("abort", cancel, { once: true });
        options.abortSignal?.throwIfAborted();
        const receipt = await handle.send({ messageId: source.messageId, text: source.input,
          ...(source.attachmentIds !== undefined ? { attachmentIds: source.attachmentIds } : {}) });
        turnId = receipt.turnId;
        const snapshot = await handle.wait();
        const turn = snapshot.conversationLog.find(entry => entry.turnId === turnId);
        const status = turn?.metadata?.runtime?.status;
        if (status !== "complete") {
          const error = new Error(turn?.metadata?.runtime?.error || snapshot.error || "Assistant request failed.");
          if (status === "cancelled") error.name = "AbortError";
          throw error;
        }
        const text = normalizeText(turn.assistant?.text);
        if (!text) throw new AppError(502, "Assistant returned no output.");
        await transcriptService.completeConversation(assistantSurface, conversationId,
          { status: "completed", metadata: turn.metadata?.completion || {} }, { context: assistantContext, workspace });
        streamWriter.sendAssistantMessage({ type: ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_MESSAGE, text });
        streamWriter.sendDone({ type: ASSISTANT_STREAM_EVENT_TYPES.DONE, messageId: source.messageId, status: "completed" });
        return { conversationId, messageId: source.messageId, status: "completed" };
      } catch (error) {
        const aborted = isAbortError(error) || options.abortSignal?.aborted;
        const status = aborted ? "aborted" : "failed";
        if (!streamed) throw error;
        await transcriptService.completeConversation(assistantSurface, conversationId, { status }, { context: assistantContext, workspace });
        streamWriter.sendError({ type: ASSISTANT_STREAM_EVENT_TYPES.ERROR, messageId: source.messageId,
          code: aborted ? "assistant_stream_aborted" : String(error?.code || "assistant_stream_failed"),
          message: aborted ? "Assistant request was cancelled." : String(error?.message || "Assistant request failed."),
          status: aborted ? 499 : Number(error?.status || error?.statusCode || 500) });
        streamWriter.sendDone({ type: ASSISTANT_STREAM_EVENT_TYPES.DONE, messageId: source.messageId, status });
        return { conversationId, messageId: source.messageId, status };
      } finally {
        options.abortSignal?.removeEventListener("abort", cancel);
        release();
        await cancellation;
      }
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
    close: () => conversationRuntime?.close(),
    streamChat,
    listConversations,
    getConversationMessages
  });
}

export { createChatService };
