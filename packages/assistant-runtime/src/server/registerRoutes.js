import { AppError } from "@jskit-ai/kernel/server/runtime";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/users-core/server/support/workspaceRouteInput";
import { workspaceSlugParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import {
  assistantConfigResource,
  assistantResource,
  resolveAssistantApiBasePath
} from "@jskit-ai/assistant-core/shared";
import {
  endNdjson,
  mapStreamError,
  setNdjsonHeaders,
  writeNdjson
} from "@jskit-ai/assistant-core/server";
import { resolveAssistantSurfaceConfig } from "../shared/assistantSurfaces.js";
import { actionIds } from "./actionIds.js";
import { assistantSurfaceRouteParamsValidator } from "./inputValidators.js";

function buildRouteParamsValidator(requiresWorkspace) {
  if (requiresWorkspace === true) {
    return [workspaceSlugParamsValidator, assistantSurfaceRouteParamsValidator];
  }

  return assistantSurfaceRouteParamsValidator;
}

function buildConversationMessagesRouteParamsValidator(requiresWorkspace) {
  const validators = buildRouteParamsValidator(requiresWorkspace);
  if (Array.isArray(validators)) {
    return validators.concat(assistantResource.operations.conversationMessagesList.paramsValidator);
  }

  return [validators, assistantResource.operations.conversationMessagesList.paramsValidator];
}

function readWorkspaceInput(request, requiresWorkspace) {
  if (requiresWorkspace !== true) {
    return {};
  }

  return buildWorkspaceInputFromRouteParams(request?.input?.params);
}

function requireAssistantSurface(appConfig = {}, targetSurfaceId = "") {
  const assistantSurface = resolveAssistantSurfaceConfig(appConfig, targetSurfaceId);
  if (assistantSurface) {
    return assistantSurface;
  }

  throw new AppError(404, "Assistant not found.");
}

function requireHostSurfaceId(request) {
  const headerValue = Array.isArray(request?.headers?.["x-jskit-surface"])
    ? request.headers["x-jskit-surface"][0]
    : request?.headers?.["x-jskit-surface"];
  const hostSurfaceId = normalizeSurfaceId(headerValue);
  if (hostSurfaceId) {
    return hostSurfaceId;
  }

  throw new AppError(400, "Assistant surface header x-jskit-surface is required.");
}

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

function resolveRouteRequestState(request, { resolveCurrentAppConfig = () => ({}), kind = "runtime", requiresWorkspace = false } = {}) {
  const appConfig = resolveCurrentAppConfig();
  const targetSurfaceId = normalizeSurfaceId(request?.input?.params?.surfaceId);
  const assistantSurface = requireAssistantSurface(appConfig, targetSurfaceId);
  const hostSurfaceId = requireHostSurfaceId(request);
  const expectsWorkspace = kind === "settings"
    ? assistantSurface.settingsSurfaceRequiresWorkspace
    : assistantSurface.runtimeSurfaceRequiresWorkspace;
  const expectedHostSurfaceId = kind === "settings"
    ? assistantSurface.settingsSurfaceId
    : assistantSurface.targetSurfaceId;

  if (expectsWorkspace !== (requiresWorkspace === true)) {
    throw new AppError(404, "Assistant route not found.");
  }
  if (hostSurfaceId !== expectedHostSurfaceId) {
    throw new AppError(403, "Assistant route is not available on this surface.");
  }

  return Object.freeze({
    assistantSurface,
    hostSurfaceId,
    actionInput: Object.freeze({
      targetSurfaceId: assistantSurface.targetSurfaceId,
      ...readWorkspaceInput(request, requiresWorkspace)
    })
  });
}

function registerSettingsRoutes(router, resolveCurrentAppConfig, { requiresWorkspace = false } = {}) {
  const routeBase = resolveAssistantApiBasePath({
    requiresWorkspace
  });
  const visibility = requiresWorkspace ? "workspace" : "public";
  const routePath = `${routeBase}/:surfaceId/settings`;
  const paramsValidator = buildRouteParamsValidator(requiresWorkspace);

  router.register(
    "GET",
    routePath,
    {
      auth: "required",
      visibility,
      paramsValidator,
      meta: {
        tags: ["assistant", "settings"],
        summary: "Get assistant settings."
      },
      responseValidators: withStandardErrorResponses({
        200: assistantConfigResource.operations.view.outputValidator
      })
    },
    async function assistantSettingsReadRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig,
        kind: "settings",
        requiresWorkspace
      });

      const response = await request.executeAction({
        actionId: actionIds.settingsRead,
        context: {
          surface: routeState.hostSurfaceId
        },
        input: routeState.actionInput
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "PATCH",
    routePath,
    {
      auth: "required",
      visibility,
      paramsValidator,
      meta: {
        tags: ["assistant", "settings"],
        summary: "Update assistant settings."
      },
      bodyValidator: assistantConfigResource.operations.patch.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: assistantConfigResource.operations.patch.outputValidator
        },
        {
          includeValidation400: true
        }
      )
    },
    async function assistantSettingsPatchRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig,
        kind: "settings",
        requiresWorkspace
      });

      const response = await request.executeAction({
        actionId: actionIds.settingsUpdate,
        context: {
          surface: routeState.hostSurfaceId
        },
        input: {
          ...routeState.actionInput,
          patch: request.input.body
        }
      });

      reply.code(200).send(response);
    }
  );
}

function registerRuntimeRoutes(router, resolveCurrentAppConfig, { requiresWorkspace = false } = {}) {
  const routeBase = resolveAssistantApiBasePath({
    requiresWorkspace
  });
  const visibility = requiresWorkspace ? "workspace" : "public";
  const surfaceRouteBase = `${routeBase}/:surfaceId`;
  const paramsValidator = buildRouteParamsValidator(requiresWorkspace);

  router.register(
    "POST",
    `${surfaceRouteBase}/chat/stream`,
    {
      auth: "required",
      visibility,
      paramsValidator,
      meta: {
        tags: ["assistant"],
        summary: "Stream assistant response."
      },
      bodyValidator: assistantResource.operations.chatStream.bodyValidator
    },
    async function assistantChatStreamRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig,
        kind: "runtime",
        requiresWorkspace
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
          context: {
            surface: routeState.hostSurfaceId
          },
          input: {
            ...routeState.actionInput,
            messageId: requestBody.messageId,
            conversationId: requestBody.conversationId,
            input: requestBody.input,
            history: requestBody.history,
            clientContext: requestBody.clientContext
          },
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
      paramsValidator,
      meta: {
        tags: ["assistant"],
        summary: "List assistant conversations."
      },
      queryValidator: assistantResource.operations.conversationsList.queryValidator,
      responseValidators: withStandardErrorResponses({
        200: assistantResource.operations.conversationsList.outputValidator
      })
    },
    async function assistantConversationsRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig,
        kind: "runtime",
        requiresWorkspace
      });

      const response = await request.executeAction({
        actionId: actionIds.conversationsList,
        context: {
          surface: routeState.hostSurfaceId
        },
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
      paramsValidator: buildConversationMessagesRouteParamsValidator(requiresWorkspace),
      meta: {
        tags: ["assistant"],
        summary: "List assistant conversation messages."
      },
      queryValidator: assistantResource.operations.conversationMessagesList.queryValidator,
      responseValidators: withStandardErrorResponses({
        200: assistantResource.operations.conversationMessagesList.outputValidator
      })
    },
    async function assistantConversationMessagesRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig,
        kind: "runtime",
        requiresWorkspace
      });

      const response = await request.executeAction({
        actionId: actionIds.conversationMessagesList,
        context: {
          surface: routeState.hostSurfaceId
        },
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

function registerRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");
  const resolveCurrentAppConfig = () => resolveAppConfig(app);

  registerSettingsRoutes(router, resolveCurrentAppConfig, {
    requiresWorkspace: false
  });
  registerSettingsRoutes(router, resolveCurrentAppConfig, {
    requiresWorkspace: true
  });
  registerRuntimeRoutes(router, resolveCurrentAppConfig, {
    requiresWorkspace: false
  });
  registerRuntimeRoutes(router, resolveCurrentAppConfig, {
    requiresWorkspace: true
  });
}

export { registerRoutes };
