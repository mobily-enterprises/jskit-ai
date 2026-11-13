import { isDeepStrictEqual } from "node:util";
import { resolveActor } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { AppError, createValidationError, hideDatabaseError } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { normalizeObject, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveWorkspaceSlug } from "@jskit-ai/assistant-core/server";
import { conversationAttachmentIds } from "@jskit-ai/assistant-core/server/conversation";
import { ASSISTANT_STREAM_EVENT_TYPES, MAX_INPUT_CHARS } from "@jskit-ai/assistant-core/shared";
import { errorMessageFields, exposedAppErrorDetails, errorStatus } from "../support/assistantErrors.js";
import { requireAssistantSurface } from "../support/assistantSurface.js";

const CLOCK_INSTRUCTION = "For current or relative date and time questions, use the current time in the system's state note, or an available authoritative workspace clock action for another time zone; never infer the current date or time from model knowledge.";

function normalizeStreamInput(payload = {}) {
  const source = normalizeObject(payload);
  const messageId = normalizeText(source.messageId);
  const input = normalizeText(source.input).slice(0, MAX_INPUT_CHARS);
  if (!messageId || messageId.length > 128) {
    throw createValidationError({
      messageId: { code: "assistant.runtime.request.messageIdInvalid", message: "messageId is required and must be at most 128 characters." }
    });
  }
  if (!input) {
    throw createValidationError({
      input: { code: "assistant.runtime.request.inputRequired", message: "input is required." }
    });
  }

  return {
    messageId,
    conversationId: normalizeRecordId(source.conversationId, { fallback: null }),
    input,
    attachmentIds: source.attachmentIds
  };
}

// A saved failure keeps its translation fields, except where the kernel would
// withhold them, so a replay shows the same message in the user's language.
function savedMessageFields(error) {
  if (!error?.message) return { messageCode: "assistant.runtime.request.failed", messageParams: {} };
  const { params, ...fields } = errorMessageFields(error, { expose: error.code !== "ACTION_PERMISSION_DENIED" });
  return { ...(Object.keys(params).length ? { params } : {}), ...fields };
}

function streamErrorMessageFields(error, aborted) {
  if (aborted) return { params: {}, messageCode: "assistant.runtime.request.cancelled", messageParams: {} };
  return error?.message ? errorMessageFields(error) : { params: {}, messageCode: "assistant.runtime.request.failed", messageParams: {} };
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

/**
 * The system prompt of a surface's turn: the surface, its workspace, the tools it
 * offers and the surface's own instructions.
 * @param {{ targetSurfaceId?: string, toolDescriptors: Array<{ name: string, parameters?: unknown, outputSchema?: unknown }>, workspaceSlug?: string, customSystemPrompt?: string }} prompt
 */
function buildSystemPrompt({ targetSurfaceId = "", toolDescriptors, workspaceSlug = "", customSystemPrompt = "" }) {
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

function buildAssistantActionContext(context = {}, assistantSurface = {}) {
  return {
    ...normalizeObject(context),
    surface: assistantSurface.targetSurfaceId
  };
}

/** @typedef {import("../types.js").AssistantAiClientFactory} AssistantAiClientFactory */
/** @typedef {import("../types.js").AssistantAttachments} AssistantAttachments */
/** @typedef {import("../types.js").AssistantConfigService} AssistantConfigService */
/** @typedef {import("../types.js").ConversationRuntime} ConversationRuntime */
/** @typedef {import("../types.js").PersonContextPrompt} PersonContextPrompt */
/** @typedef {import("../types.js").SqlConversationStorage} SqlConversationStorage */
/** @typedef {import("../types.js").SurfaceAwareToolCatalog} SurfaceAwareToolCatalog */
/** @typedef {import("../types.js").TranscriptService} TranscriptService */
/** @typedef {import("../types.js").TurnAdmission} TurnAdmission */
/** @typedef {import("../types.js").TurnRequestsRepository} TurnRequestsRepository */
/** @typedef {import("../types.js").WorkspaceScopeSupport} WorkspaceScopeSupport */

/**
 * The chat stream and transcripts of the package's own tables. Each chat turn is
 * recorded once per message id, so a repeated request replays its saved outcome.
 * @param {object} dependencies
 * @param {ConversationRuntime} dependencies.conversationRuntime
 * @param {SqlConversationStorage} dependencies.conversationStorage The storage under the conversation runtime.
 * @param {AssistantAiClientFactory} dependencies.aiClientFactory
 * @param {TurnRequestsRepository} dependencies.turnRequests
 * @param {AssistantAttachments | null} [dependencies.attachments]
 * @param {TranscriptService} dependencies.transcriptService
 * @param {SurfaceAwareToolCatalog} dependencies.serviceToolCatalog
 * @param {AssistantConfigService} dependencies.assistantConfigService
 * @param {PersonContextPrompt} dependencies.personContextPrompt
 * @param {TurnAdmission} dependencies.turnAdmission
 * @param {Record<string, any>} dependencies.appConfig
 * @param {WorkspaceScopeSupport | null} [dependencies.workspaceScopeSupport]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [dependencies.logger]
 */
function createChatService({
  conversationRuntime,
  conversationStorage,
  aiClientFactory,
  turnRequests,
  attachments,
  transcriptService,
  serviceToolCatalog,
  assistantConfigService,
  personContextPrompt,
  turnAdmission,
  appConfig,
  workspaceScopeSupport,
  logger = silentLogger
}) {
  function resolveRuntimeWorkspace(assistantSurface, context = {}, input = {}) {
    if (assistantSurface?.runtimeSurfaceRequiresWorkspace !== true) {
      return null;
    }

    if (!workspaceScopeSupport) {
      throw new Error("assistant.chat.service requires workspace server scope support for workspace-scoped assistant surfaces.");
    }

    return workspaceScopeSupport.resolveWorkspace(context, input);
  }

  function replayRequest(record, request, writer) {
    if (!isDeepStrictEqual(record.request, JSON.parse(JSON.stringify(request)))) {
      throw new AppError(409, "This message ID belongs to a different request.", { code: "assistant.runtime.request.messageIdConflict" });
    }
    const response = record.response || {};
    if (record.status === "running") {
      if (response.meta) writer.sendMeta(response.meta);
      writer.sendError({ type: ASSISTANT_STREAM_EVENT_TYPES.ERROR, code: "assistant_request_unconfirmed",
        message: "This message was already submitted. Its completion is not confirmed; check conversation history before sending new work.",
        messageCode: "assistant.runtime.request.unconfirmed", messageParams: {} });
      writer.sendDone({ type: ASSISTANT_STREAM_EVENT_TYPES.DONE, messageId: request.messageId, status: "unconfirmed" });
      return { conversationId: response.meta?.conversationId, messageId: request.messageId, status: "unconfirmed" };
    }
    if (response.failure && !response.meta) throw new AppError(response.failure.status, response.failure.message, {
      code: response.failure.code, params: response.failure.params, details: response.failure.details,
      messageCode: response.failure.messageCode, messageParams: response.failure.messageParams
    });
    if (response.meta) writer.sendMeta(response.meta);
    if (response.answer) writer.sendAssistantMessage(response.answer);
    if (response.error) writer.sendError(response.error);
    if (response.failure) writer.sendError({ type: ASSISTANT_STREAM_EVENT_TYPES.ERROR, ...response.failure });
    writer.sendDone(response.done || { type: ASSISTANT_STREAM_EVENT_TYPES.DONE, messageId: request.messageId, status: record.status });
    return { conversationId: response.meta?.conversationId, messageId: request.messageId, status: record.status };
  }

  // Turns on one conversation share its runtime entry. The last of them to
  // settle disposes it, so a finished chat keeps no runtime state; a turn that
  // starts while that disposal runs waits for it and opens the entry again.
  const conversationTurns = new Map();
  async function openConversationTurn(conversationId, open) {
    while (conversationTurns.get(conversationId)?.releasing) await conversationTurns.get(conversationId).releasing;
    const turns = conversationTurns.get(conversationId) || { count: 0, handle: null, releasing: null };
    conversationTurns.set(conversationId, turns);
    turns.count += 1;
    try {
      turns.handle = await open();
      return turns.handle;
    } catch (error) {
      await releaseConversationTurn(conversationId);
      throw error;
    }
  }
  async function releaseConversationTurn(conversationId) {
    const turns = conversationTurns.get(conversationId);
    turns.count -= 1;
    if (turns.count > 0) return;
    // A failed disposal, thrown or rejected, leaves the runtime entry open: the
    // next turn reuses it and runtime close retries its save.
    turns.releasing = Promise.try(() => turns.handle?.dispose()).catch(() => {})
      .finally(() => conversationTurns.delete(conversationId));
    await turns.releasing;
  }

  /**
   * Streams one chat turn through its writer, or replays the saved turn with the same message id.
   * @param {object} payload The validated chat stream input.
   * @param {{ context: object, streamWriter: import("../support/assistantStreamWriter.js").AssistantStreamWriter,
   *   abortSignal?: AbortSignal }} options
   */
  async function streamChat(payload, options) {
    const assistantSurface = requireAssistantSurface(appConfig, payload.targetSurfaceId);
    const context = normalizeObject(options.context);
    const assistantContext = buildAssistantActionContext(context, assistantSurface);
    const workspace = resolveRuntimeWorkspace(assistantSurface, assistantContext, payload);
    const source = normalizeStreamInput(payload);
    const actor = resolveActor(context);
    const actorUserId = normalizeRecordId(actor?.id, { fallback: null });
    if (!actorUserId) throw new AppError(401, "Authentication required.", { code: "assistant.runtime.authenticationRequired" });
    const scope = { actorUserId, surfaceId: assistantSurface.targetSurfaceId,
      // readable-check: allow no-dual-shape - data: the workspace scope resolves the workspace from the action input or context, which may carry the record or its id
      workspaceId: normalizeRecordId(workspace?.id || workspace, { fallback: null }) };
    const request = { ...source, integrationId: normalizeText(payload.integrationId) };
    const existing = await turnRequests.find(scope, source.messageId);
    if (existing) return replayRequest(existing, request, options.streamWriter);
    // The application's turn guard decides each new turn before anything is saved or sent. Its
    // fixed reply answers the turn without the model, so that turn needs no AI connection.
    const fixedReply = await turnAdmission.fixedReply({ targetSurfaceId: assistantSurface.targetSurfaceId, context: assistantContext,
      input: source.input, conversationId: source.conversationId, messageId: source.messageId });
    const aiClient = fixedReply === null ? await resolveEnabledClient() : null;
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
      result = fixedReply === null ? await executeTurn() : await executeFixedReply(fixedReply);
    } catch (thrown) {
      // A database error is saved, so replayed, only as its stand-in; the route answers and logs the error itself.
      const error = hideDatabaseError(thrown);
      response.failure = { message: String(error?.message || "Assistant request failed."),
        status: errorStatus(error),
        ...(error instanceof AppError ? { code: error.code,
          ...(exposedAppErrorDetails(error) ? { details: error.details } : {}) } : {}),
        ...savedMessageFields(error) };
      await turnRequests.update(claim, response, "failed");
      throw thrown;
    }
    await turnRequests.update(claim, response, result.status);
    if (response.done) output.sendDone(response.done);
    return result;

    async function resolveEnabledClient() {
      const client = await aiClientFactory.resolveClient(assistantSurface.targetSurfaceId, {
        context: assistantContext, integrationId: payload.integrationId
      });
      if (!client.enabled) throw new AppError(503, "Assistant provider is not configured.", { code: "assistant.runtime.provider.notConfigured" });
      return client;
    }

    // The turn's conversation: the one the request names, or a new one.
    async function openTurnConversation({ provider, model }) {
      const conversationResult = await transcriptService.createConversationForTurn(
        assistantSurface,
        workspace,
        actor,
        {
          conversationId: source.conversationId,
          provider,
          model,
          surfaceId: assistantSurface.targetSurfaceId,
          messageId: source.messageId
        },
        {
          context: assistantContext
        }
      );

      const conversation = conversationResult.conversation;
      if (!conversation?.id) {
        throw new AppError(500, "Assistant failed to create conversation.", { code: "assistant.runtime.conversation.createFailed" });
      }
      return conversation;
    }

    // A completed turn's answer and its end, which names the turn's two saved messages.
    async function sendCompletedAnswer(conversationId, text) {
      const storedMessageIds = await conversationStorage.storedMessageIds(conversationId, source.messageId);
      streamWriter.sendAssistantMessage({ type: ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_MESSAGE, text });
      streamWriter.sendDone({ type: ASSISTANT_STREAM_EVENT_TYPES.DONE, messageId: source.messageId, status: "completed", storedMessageIds });
      return { conversationId, messageId: source.messageId, status: "completed" };
    }

    // The turn guard's reply answers the turn: the message and the reply are saved as one
    // completed turn, and the model is never called.
    async function executeFixedReply(reply) {
      const { id: conversationId } = await openTurnConversation({ provider: "", model: "" });
      await conversationStorage.recordReply(conversationId, { messageId: source.messageId, text: source.input, reply });
      await transcriptService.completeConversation(assistantSurface, conversationId, { status: "completed" },
        { context: assistantContext, workspace });
      streamWriter.sendMeta({ type: ASSISTANT_STREAM_EVENT_TYPES.META, messageId: source.messageId, conversationId });
      return sendCompletedAnswer(conversationId, reply);
    }

    async function executeTurn() {
      const conversation = await openTurnConversation({ provider: aiClient.provider, model: aiClient.defaultModel });
      const conversationId = conversation.id;

      const resolvedAttachments = [];
      async function prepareAttachments(attachmentIds) {
        if (attachmentIds === undefined || (Array.isArray(attachmentIds) && !attachmentIds.length)) return;
        try { conversationAttachmentIds(attachmentIds); }
        catch { throw new AppError(400, "Invalid attachment identifiers.", { code: "assistant.runtime.attachments.invalidIds" }); }
        if (!attachments?.resolve || !aiClient.supportsAttachments) {
          throw new AppError(400, "File attachments are not configured for this assistant.", {
            code: "assistant.runtime.attachments.notConfigured"
          });
        }
        // Attachments are authorized before admission, as the facade orders it.
        // Only these server-resolved materials reach the common file reader.
        const files = await attachments.resolve({ attachmentIds, context: assistantContext, workspace, conversation });
        resolvedAttachments.push({ attachmentIds: [...attachmentIds], files });
      }
      await prepareAttachments(source.attachmentIds);
      // The tools this surface's API conversation offers, its unsaved ones among them: the
      // runtime owns that engine's whole history.
      const toolSet = serviceToolCatalog.resolveToolSet(assistantContext, { offerUnsaved: true });
      const customSystemPrompt = await assistantConfigService.resolveSystemPrompt(
        assistantSurface, workspace, { surface: assistantSurface.targetSurfaceId },
        { context: assistantContext, input: payload }
      );
      // The facts about the person follow the saved prompt in the conversation's
      // instructions. Unchanged facts give the same configuration, so only a real
      // change reconfigures the conversation below.
      const systemPrompt = await personContextPrompt.compose(buildSystemPrompt({
        targetSurfaceId: assistantSurface.targetSurfaceId, toolDescriptors: toolSet.tools,
        workspaceSlug: resolveWorkspaceSlug(assistantContext, payload), customSystemPrompt
      }), { conversationId, targetSurfaceId: assistantSurface.targetSurfaceId, context: assistantContext, workspace });
      const configuration = { systemPrompt, ...(request.integrationId ? { integrationId: request.integrationId } : {}) };
      const runtimeContext = { ...assistantContext, assistantRequest: {
        conversation, workspace, resolvedAttachments
      } };
      const handle = await openConversationTurn(conversationId, async () => {
        try { return await conversationRuntime.open({ id: conversationId, context: runtimeContext, configuration }); }
        catch (error) {
          if (error.code !== "conversation_configuration_mismatch") throw error;
          const opened = await conversationRuntime.open({ id: conversationId, context: runtimeContext });
          await opened.configure(configuration);
          return opened;
        }
      });
      try {
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
          // The finished turn alone: waiting never reads the rest of the conversation.
          const snapshot = await handle.wait({ turnId });
          const turn = snapshot.conversationLog.find(entry => entry.turnId === turnId);
          const status = turn?.metadata?.runtime?.status;
          if (status !== "complete") {
            const reason = turn?.metadata?.runtime?.error || snapshot.error;
            const error = reason ? new Error(reason) : Object.assign(new Error("Assistant request failed."), {
              messageCode: "assistant.runtime.request.failed", messageParams: {} });
            if (status === "cancelled") error.name = "AbortError";
            throw error;
          }
          const text = normalizeText(turn.assistant?.text);
          if (!text) throw new AppError(502, "Assistant returned no output.", { code: "assistant.runtime.request.noOutput" });
          await transcriptService.completeConversation(assistantSurface, conversationId,
            { status: "completed", metadata: turn.metadata?.completion || {} }, { context: assistantContext, workspace });
          return await sendCompletedAnswer(conversationId, text);
        } catch (thrown) {
          const aborted = isAbortError(thrown) || options.abortSignal?.aborted;
          const status = aborted ? "aborted" : "failed";
          if (!streamed) throw thrown;
          // A database error streams only as its stand-in (a generic 409 or 500), and its detail goes to the log.
          const error = hideDatabaseError(thrown);
          if (error !== thrown) logger.error({ err: thrown }, "Assistant turn failed on a database error.");
          await transcriptService.completeConversation(assistantSurface, conversationId, { status }, { context: assistantContext, workspace });
          streamWriter.sendError({ type: ASSISTANT_STREAM_EVENT_TYPES.ERROR, messageId: source.messageId,
            code: aborted ? "assistant_stream_aborted" : String(error?.code || "assistant_stream_failed"),
            message: aborted ? "Assistant request was cancelled." : String(error?.message || "Assistant request failed."),
            ...streamErrorMessageFields(error, aborted),
            status: aborted ? 499 : errorStatus(error) });
          streamWriter.sendDone({ type: ASSISTANT_STREAM_EVENT_TYPES.DONE, messageId: source.messageId, status });
          return { conversationId, messageId: source.messageId, status };
        } finally {
          options.abortSignal?.removeEventListener("abort", cancel);
          release();
          await cancellation;
        }
      } finally {
        await releaseConversationTurn(conversationId);
      }
    }
  }

  async function listConversations(query = {}, options = {}) {
    const assistantSurface = requireAssistantSurface(appConfig, options.input?.targetSurfaceId);
    const context = normalizeObject(options.context);
    const assistantContext = buildAssistantActionContext(context, assistantSurface);
    const workspace = resolveRuntimeWorkspace(assistantSurface, assistantContext, options.input || {});
    return transcriptService.listConversationsForUser(assistantSurface, workspace, assistantContext.actor, query, {
      context: assistantContext
    });
  }

  async function getConversationMessages(conversationId, query = {}, options = {}) {
    const assistantSurface = requireAssistantSurface(appConfig, options.input?.targetSurfaceId);
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

  function close() {
    return conversationRuntime.close();
  }

  return Object.freeze({
    close,
    streamChat,
    listConversations,
    getConversationMessages
  });
}

export { createChatService };
