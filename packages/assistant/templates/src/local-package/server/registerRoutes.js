import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/users-core/server/support/workspaceRouteInput";
import { workspaceSlugParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import {
  assistantConfigResource,
  assistantResource,
  resolveAssistantApiBasePath,
  resolveAssistantSettingsApiPath
} from "@jskit-ai/assistant-core/shared";
import {
  endNdjson,
  mapStreamError,
  setNdjsonHeaders,
  writeNdjson
} from "@jskit-ai/assistant-core/server";
import { assistantRuntimeConfig } from "../shared/assistantRuntimeConfig.js";
import { actionIds } from "./actionIds.js";

const runtimeVisibility = assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace ? "workspace" : "public";
const settingsVisibility = assistantRuntimeConfig.settingsSurfaceRequiresWorkspace ? "workspace" : "public";
const runtimeRouteBase = resolveAssistantApiBasePath({
  requiresWorkspace: assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace
});
const settingsRouteBase = resolveAssistantSettingsApiPath({
  requiresWorkspace: assistantRuntimeConfig.settingsSurfaceRequiresWorkspace
});

function buildWorkspaceRouteConfig(requiresWorkspace, baseConfig = {}) {
  if (requiresWorkspace !== true) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    paramsValidator: workspaceSlugParamsValidator
  };
}

function readWorkspaceInput(request, requiresWorkspace) {
  if (requiresWorkspace !== true) {
    return {};
  }

  return buildWorkspaceInputFromRouteParams(request?.input?.params);
}

function registerRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");

  router.register(
    "GET",
    settingsRouteBase,
    buildWorkspaceRouteConfig(assistantRuntimeConfig.settingsSurfaceRequiresWorkspace, {
      auth: "required",
      surface: assistantRuntimeConfig.settingsSurfaceId,
      visibility: settingsVisibility,
      meta: {
        tags: ["assistant", "settings"],
        summary: "Get assistant settings."
      },
      responseValidators: withStandardErrorResponses({
        200: assistantConfigResource.operations.view.outputValidator
      })
    }),
    async function assistantSettingsReadRoute(request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.settingsRead,
        input: {
          ...readWorkspaceInput(request, assistantRuntimeConfig.settingsSurfaceRequiresWorkspace)
        }
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "PATCH",
    settingsRouteBase,
    buildWorkspaceRouteConfig(assistantRuntimeConfig.settingsSurfaceRequiresWorkspace, {
      auth: "required",
      surface: assistantRuntimeConfig.settingsSurfaceId,
      visibility: settingsVisibility,
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
    }),
    async function assistantSettingsPatchRoute(request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.settingsUpdate,
        input: {
          ...readWorkspaceInput(request, assistantRuntimeConfig.settingsSurfaceRequiresWorkspace),
          patch: request.input.body
        }
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    `${runtimeRouteBase}/chat/stream`,
    buildWorkspaceRouteConfig(assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace, {
      auth: "required",
      surface: assistantRuntimeConfig.runtimeSurfaceId,
      visibility: runtimeVisibility,
      meta: {
        tags: ["assistant"],
        summary: "Stream assistant response."
      },
      bodyValidator: assistantResource.operations.chatStream.bodyValidator
    }),
    async function assistantChatStreamRoute(request, reply) {
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
          input: {
            ...readWorkspaceInput(request, assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace),
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
          const statusCode = Number(error?.status || error?.statusCode || 500);
          const safeStatusCode = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
          reply.code(safeStatusCode).send({
            error: safeStatusCode >= 500 ? "Internal server error." : String(error?.message || "Request failed.")
          });
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
    `${runtimeRouteBase}/conversations`,
    buildWorkspaceRouteConfig(assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace, {
      auth: "required",
      surface: assistantRuntimeConfig.runtimeSurfaceId,
      visibility: runtimeVisibility,
      meta: {
        tags: ["assistant"],
        summary: "List assistant conversations."
      },
      queryValidator: assistantResource.operations.conversationsList.queryValidator,
      responseValidators: withStandardErrorResponses({
        200: assistantResource.operations.conversationsList.outputValidator
      })
    }),
    async function assistantConversationsRoute(request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.conversationsList,
        input: {
          ...readWorkspaceInput(request, assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace),
          query: request.input.query
        }
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${runtimeRouteBase}/conversations/:conversationId/messages`,
    buildWorkspaceRouteConfig(assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace, {
      auth: "required",
      surface: assistantRuntimeConfig.runtimeSurfaceId,
      visibility: runtimeVisibility,
      meta: {
        tags: ["assistant"],
        summary: "List assistant conversation messages."
      },
      paramsValidator: assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace
        ? [workspaceSlugParamsValidator, assistantResource.operations.conversationMessagesList.paramsValidator]
        : assistantResource.operations.conversationMessagesList.paramsValidator,
      queryValidator: assistantResource.operations.conversationMessagesList.queryValidator,
      responseValidators: withStandardErrorResponses({
        200: assistantResource.operations.conversationMessagesList.outputValidator
      })
    }),
    async function assistantConversationMessagesRoute(request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.conversationMessagesList,
        input: {
          ...readWorkspaceInput(request, assistantRuntimeConfig.runtimeSurfaceRequiresWorkspace),
          conversationId: request.input.params.conversationId,
          query: request.input.query
        }
      });

      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
