import { AppError } from "@jskit-ai/kernel/server/runtime";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import {
  ASSISTANT_CONVERSATIONS_TRANSPORT,
  ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT,
  assistantConversationOutputValidator,
  assistantResource,
  resolveAssistantApiBasePath
} from "@jskit-ai/assistant-core/shared";
import {
  endNdjson,
  mapStreamError,
  setNdjsonHeaders,
  writeNdjson
} from "@jskit-ai/assistant-core/server";
import { actionIds } from "./actionIds.js";
import {
  assistantConversationIdInputValidator,
  assistantConversationGoalBodyValidator,
  assistantConversationMessageIdInputValidator,
  assistantConversationReadQueryValidator,
  conversationConfigureBodyValidator,
  conversationSelectBodyValidator,
  conversationReplaceBodyValidator,
  conversationSendBodyValidator,
  assistantSurfaceRouteParamsValidator
} from "./inputSchemas.js";
import { registerSettingsRoutes } from "./registerSettingsRoutes.js";
import { requireWorkspaceAssistantRouteParams, resolveRouteRequestState } from "./support/assistantRouteContext.js";

function shouldExposeAppErrorDetails(errorCode = "") {
  return String(errorCode || "").trim() !== "ACTION_PERMISSION_DENIED";
}

function sendPreStreamErrorResponse(reply, error) {
  const statusCode = Number(error?.status || error?.statusCode || 500);
  const safeStatusCode = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;

  if (error instanceof AppError) {
    const appErrorCode = String(error?.code || "app_error").trim() || "app_error";
    const payload = {
      error: error.message,
      code: appErrorCode
    };

    if (error.details && shouldExposeAppErrorDetails(appErrorCode)) {
      payload.details = error.details;
      if (error.details.fieldErrors) {
        payload.fieldErrors = error.details.fieldErrors;
      }
    }

    if (error.headers && typeof error.headers === "object") {
      Object.entries(error.headers).forEach(([name, value]) => {
        reply.header(name, value);
      });
    }

    reply.code(safeStatusCode).send(payload);
    return;
  }

  reply.code(safeStatusCode).send({
    error: safeStatusCode >= 500 ? "Internal server error." : String(error?.message || "Request failed.")
  });
}

function buildChatStreamActionInput(routeInput = {}, requestBody = {}) {
  const actionInput = {
    ...routeInput,
    messageId: requestBody.messageId,
    input: requestBody.input
  };

  for (const key of ["conversationId", "history", "clientContext"]) {
    if (Object.prototype.hasOwnProperty.call(requestBody, key)) {
      actionInput[key] = requestBody[key];
    }
  }

  return actionInput;
}

function resolveAssistantConversationMessagesRecordId(record = {}) {
  const conversationId = String(record?.conversation?.id || "").trim();
  if (!conversationId) {
    throw new Error("Assistant conversation messages JSON:API response requires conversation.id.");
  }

  return conversationId;
}

function registerRuntimeRoutes(
  router,
  resolveCurrentAppConfig,
  { requiresWorkspace = false, workspaceScopeSupport = null } = {}
) {
  const routeBase = resolveAssistantApiBasePath({
    requiresWorkspace
  });
  const visibility = requiresWorkspace ? "workspace" : "public";
  const surfaceRouteBase = `${routeBase}/:surfaceId`;
  const params = requiresWorkspace === true
    ? requireWorkspaceAssistantRouteParams(workspaceScopeSupport)
    : assistantSurfaceRouteParamsValidator;
  const conversationMessagesParams = composeSchemaDefinitions(
    [params, assistantResource.operations.conversationMessagesList.params],
    {
      mode: "patch",
      context: requiresWorkspace === true
        ? "assistant-runtime workspace conversation messages route params"
        : "assistant-runtime conversation messages route params"
    }
  );

  router.register(
    "POST",
    `${surfaceRouteBase}/chat/stream`,
    {
      auth: "required",
      visibility,
      params,
      meta: {
        tags: ["assistant"],
        summary: "Stream assistant response."
      },
      body: assistantResource.operations.chatStream.body
    },
    async function assistantChatStreamRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig,
        kind: "runtime",
        requiresWorkspace,
        workspaceScopeSupport
      });
      const abortController = new AbortController();
      const requestBody = request?.input?.body && typeof request.input.body === "object" ? request.input.body : {};
      const closeListener = () => {
        abortController.abort();
      };

      let streamStarted = false;

      function ensureStreamStarted() {
        if (streamStarted) {
          return;
        }

        setNdjsonHeaders(reply);
        reply.code(200);
        reply.hijack();
        if (typeof reply.raw.flushHeaders === "function") {
          reply.raw.flushHeaders();
        }
        streamStarted = true;
      }

      const streamWriter = Object.freeze({
        sendMeta(payload = {}) {
          ensureStreamStarted();
          writeNdjson(reply, payload);
        },
        sendAssistantDelta(payload = {}) {
          ensureStreamStarted();
          writeNdjson(reply, payload);
        },
        sendAssistantMessage(payload = {}) {
          ensureStreamStarted();
          writeNdjson(reply, payload);
        },
        sendToolCall(payload = {}) {
          ensureStreamStarted();
          writeNdjson(reply, payload);
        },
        sendToolResult(payload = {}) {
          ensureStreamStarted();
          writeNdjson(reply, payload);
        },
        sendError(payload = {}) {
          ensureStreamStarted();
          writeNdjson(reply, payload);
        },
        sendDone(payload = {}) {
          ensureStreamStarted();
          writeNdjson(reply, payload);
        }
      });

      try {
        request.raw.on("close", closeListener);

        await request.executeAction({
          actionId: actionIds.chatStream,
          surface: routeState.hostSurfaceId,
          input: buildChatStreamActionInput(routeState.actionInput, requestBody),
          deps: {
            streamWriter,
            abortSignal: abortController.signal
          }
        });

        if (streamStarted) {
          endNdjson(reply);
          return;
        }

        reply.code(204).send();
      } catch (error) {
        if (!streamStarted) {
          sendPreStreamErrorResponse(reply, error);
          return;
        }

        const streamError = mapStreamError(error);
        writeNdjson(reply, {
          type: "error",
          ...streamError
        });
        writeNdjson(reply, {
          type: "done",
          status: "failed"
        });
        endNdjson(reply);
      } finally {
        request.raw.off("close", closeListener);
      }
    }
  );

  router.register(
    "GET",
    `${surfaceRouteBase}/conversations`,
    {
      auth: "required",
      visibility,
      params,
      meta: {
        tags: ["assistant"],
        summary: "List assistant conversations."
      },
      ...createJsonApiResourceRouteContract({
        ...ASSISTANT_CONVERSATIONS_TRANSPORT,
        query: assistantResource.operations.conversationsList.query,
        output: assistantConversationOutputValidator,
        outputKind: "collection"
      })
    },
    async function assistantConversationsRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig,
        kind: "runtime",
        requiresWorkspace,
        workspaceScopeSupport
      });

      const response = await request.executeAction({
        actionId: actionIds.conversationsList,
        surface: routeState.hostSurfaceId,
        input: {
          ...routeState.actionInput,
          query: request.input.query
        }
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${surfaceRouteBase}/conversations/:conversationId/messages`,
    {
      auth: "required",
      visibility,
      params: conversationMessagesParams,
      meta: {
        tags: ["assistant"],
        summary: "List assistant conversation messages."
      },
      ...createJsonApiResourceRouteContract({
        ...ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT,
        query: assistantResource.operations.conversationMessagesList.query,
        output: assistantResource.operations.conversationMessagesList.output,
        outputKind: "record",
        getRecordId: resolveAssistantConversationMessagesRecordId
      })
    },
    async function assistantConversationMessagesRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig,
        kind: "runtime",
        requiresWorkspace,
        workspaceScopeSupport
      });

      const response = await request.executeAction({
        actionId: actionIds.conversationMessagesList,
        surface: routeState.hostSurfaceId,
        input: {
          ...routeState.actionInput,
          conversationId: request.input.params.conversationId,
          query: request.input.query
        }
      });

      reply.code(200).send(response);
    }
  );
}

function registerConversationRoutes(
  router,
  resolveCurrentAppConfig,
  { requiresWorkspace = false, workspaceScopeSupport = null, conversationDataSchema = null,
    conversationConfigurationSchema = null, conversationSelectionSchema = null, conversationReplacementSchema = null } = {}
) {
  const routeBase = `${resolveAssistantApiBasePath({ requiresWorkspace })}/:surfaceId/conversations/:conversationId`;
  const visibility = requiresWorkspace ? "workspace" : "public";
  const surfaceParams = requiresWorkspace
    ? requireWorkspaceAssistantRouteParams(workspaceScopeSupport)
    : assistantSurfaceRouteParamsValidator;
  const params = composeSchemaDefinitions([surfaceParams, assistantConversationIdInputValidator], {
    mode: "patch",
    context: "assistant-runtime conversation route params"
  });

  router.register("GET", routeBase, {
    auth: "required", visibility, params,
    query: assistantConversationReadQueryValidator,
    meta: { tags: ["assistant"], summary: "Read assistant conversation state." }
  }, async function assistantConversationReadRoute(request, reply) {
    const routeState = resolveRouteRequestState(request, {
      resolveCurrentAppConfig, requiresWorkspace, workspaceScopeSupport
    });
    const input = { ...routeState.actionInput, conversationId: request.input.params.conversationId };
    for (const key of ["beforeTurnId", "limit"]) {
      if (Object.hasOwn(request.input.query || {}, key)) input[key] = request.input.query[key];
    }
    const response = await request.executeAction({
      actionId: actionIds.conversationRead,
      surface: routeState.hostSurfaceId,
      input
    });
    reply.code(200).send(response);
  });

  router.register("POST", `${routeBase}/messages`, {
    auth: "required", visibility, params,
    body: conversationSendBodyValidator(conversationDataSchema),
    meta: { tags: ["assistant"], summary: "Send an assistant conversation message." }
  }, async function assistantConversationSendRoute(request, reply) {
    const routeState = resolveRouteRequestState(request, {
      resolveCurrentAppConfig, requiresWorkspace, workspaceScopeSupport
    });
    const body = request.input.body;
    const response = await request.executeAction({
      actionId: actionIds.conversationSend,
      surface: routeState.hostSurfaceId,
      input: {
        ...routeState.actionInput,
        conversationId: request.input.params.conversationId,
        messageId: body.messageId,
        text: body.text,
        ...(conversationDataSchema && Object.hasOwn(body, "data") ? { data: body.data } : {}),
        ...(Object.hasOwn(body, "attachmentIds") ? { attachmentIds: body.attachmentIds } : {}),
        ...(Object.hasOwn(body, "steer") ? { steer: body.steer } : {})
      }
    });
    reply.code(202).send(response);
  });

  router.register("POST", `${routeBase}/cancel`, {
    auth: "required", visibility, params,
    meta: { tags: ["assistant"], summary: "Cancel the active assistant conversation turn." }
  }, async function assistantConversationCancelRoute(request, reply) {
    const routeState = resolveRouteRequestState(request, {
      resolveCurrentAppConfig, requiresWorkspace, workspaceScopeSupport
    });
    const response = await request.executeAction({
      actionId: actionIds.conversationCancel,
      surface: routeState.hostSurfaceId,
      input: { ...routeState.actionInput, conversationId: request.input.params.conversationId }
    });
    reply.code(200).send(response);
  });

  router.register("POST", `${routeBase}/deliveries/:messageId/inspect`, {
    auth: "required", visibility,
    params: composeSchemaDefinitions([params, assistantConversationMessageIdInputValidator], {
      mode: "patch", context: "assistant-runtime conversation delivery inspection route params"
    }),
    meta: { tags: ["assistant"], summary: "Inspect assistant message delivery without resubmitting it." }
  }, async function assistantConversationInspectDeliveryRoute(request, reply) {
    const routeState = resolveRouteRequestState(request, {
      resolveCurrentAppConfig, requiresWorkspace, workspaceScopeSupport
    });
    const response = await request.executeAction({
      actionId: actionIds.conversationInspectDelivery,
      surface: routeState.hostSurfaceId,
      input: { ...routeState.actionInput, conversationId: request.input.params.conversationId,
        messageId: request.input.params.messageId }
    });
    reply.code(200).send(response);
  });

  for (const method of ["GET", "POST"]) {
    router.register(method, `${routeBase}/goal`, {
      auth: "required", visibility, params,
      ...(method === "POST" ? { body: assistantConversationGoalBodyValidator } : {}),
      meta: { tags: ["assistant"], summary: method === "GET" ? "Read the current conversation goal." : "Update the conversation goal." }
    }, async function assistantConversationGoalRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig, requiresWorkspace, workspaceScopeSupport
      });
      const input = { ...routeState.actionInput, conversationId: request.input.params.conversationId };
      if (method === "POST") {
        for (const key of ["action", "expectedSegmentId", "expectedGoalId", "messageId", "objective", "tokenBudget", "attachmentIds"]) {
          if (Object.hasOwn(request.input.body, key)) input[key] = request.input.body[key];
        }
      }
      const response = await request.executeAction({
        actionId: method === "GET" ? actionIds.conversationGoalRead : actionIds.conversationGoalUpdate,
        surface: routeState.hostSurfaceId, input
      });
      reply.code(response === null ? 204 : 200).send(response);
    });
  }

  if (conversationConfigurationSchema) {
    router.register("PATCH", `${routeBase}/configuration`, {
      auth: "required", visibility, params,
      body: conversationConfigureBodyValidator(conversationConfigurationSchema),
      meta: { tags: ["assistant"], summary: "Apply the application's declared conversation settings." }
    }, async function assistantConversationConfigureRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig, requiresWorkspace, workspaceScopeSupport
      });
      const response = await request.executeAction({
        actionId: actionIds.conversationConfigure,
        surface: routeState.hostSurfaceId,
        input: { ...routeState.actionInput, conversationId: request.input.params.conversationId,
          configuration: request.input.body.configuration }
      });
      reply.code(200).send(response);
    });
  }

  if (conversationSelectionSchema) {
    router.register("POST", `${routeBase}/selection`, {
      auth: "required", visibility, params,
      body: conversationSelectBodyValidator(conversationSelectionSchema),
      meta: { tags: ["assistant"], summary: "Apply an authorized application conversation selection." }
    }, async function assistantConversationSelectRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig, requiresWorkspace, workspaceScopeSupport
      });
      const response = await request.executeAction({
        actionId: actionIds.conversationSelect,
        surface: routeState.hostSurfaceId,
        input: { ...routeState.actionInput, conversationId: request.input.params.conversationId,
          selection: request.input.body.selection }
      });
      reply.code(200).send(response);
    });
  }

  if (conversationReplacementSchema) {
    router.register("POST", `${routeBase}/replacement`, {
      auth: "required", visibility, params,
      body: conversationReplaceBodyValidator(conversationReplacementSchema),
      meta: { tags: ["assistant"], summary: "Apply an authorized application conversation replacement." }
    }, async function assistantConversationReplaceRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig, requiresWorkspace, workspaceScopeSupport
      });
      const response = await request.executeAction({
        actionId: actionIds.conversationReplace,
        surface: routeState.hostSurfaceId,
        input: { ...routeState.actionInput, conversationId: request.input.params.conversationId,
          replacement: request.input.body.replacement }
      });
      reply.code(200).send(response);
    });
  }
}

function registerRoutes(router, {
  config = {},
  workspaceScopeSupport = null,
  conversationRuntime = null,
  conversationAccess = null,
  conversationDataSchema = null,
  conversationConfigurationSchema = null,
  conversationSelectionSchema = null,
  conversationReplacementSchema = null,
  assistantConfigService = null
} = {}) {
  if (!router || typeof router.register !== "function") {
    throw new Error("registerRoutes requires an HTTP router.");
  }
  if (conversationRuntime && typeof conversationRuntime.open !== "function") {
    throw new TypeError("Assistant conversation routes require conversationRuntime.open().");
  }
  const resolveCurrentAppConfig = () => config;
  const registerAssistantRuntimeRoutes = conversationRuntime ? registerConversationRoutes : registerRuntimeRoutes;
  const runtimeRouter = conversationRuntime && conversationAccess ? conversationAccess.router : router;
  const includeSettings = !conversationRuntime || Boolean(assistantConfigService);

  if (includeSettings) registerSettingsRoutes(router, resolveCurrentAppConfig, {
    requiresWorkspace: false
  });
  registerAssistantRuntimeRoutes(runtimeRouter, resolveCurrentAppConfig, {
    requiresWorkspace: false,
    conversationDataSchema,
    conversationConfigurationSchema,
    conversationSelectionSchema,
    conversationReplacementSchema
  });

  if (workspaceScopeSupport) {
    if (includeSettings) registerSettingsRoutes(router, resolveCurrentAppConfig, {
      requiresWorkspace: true,
      workspaceScopeSupport
    });
    registerAssistantRuntimeRoutes(runtimeRouter, resolveCurrentAppConfig, {
      requiresWorkspace: true,
      workspaceScopeSupport,
      conversationDataSchema,
      conversationConfigurationSchema,
      conversationSelectionSchema,
      conversationReplacementSchema
    });
  }
}

export { registerRoutes };
