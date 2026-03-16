import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { routeParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { resolveAssistantApiBasePath } from "../shared/assistantPaths.js";
import { assistantResource } from "../shared/assistantResource.js";
import { actionIds } from "./actionIds.js";
import { endNdjson, mapStreamError, setNdjsonHeaders, writeNdjson } from "./lib/ndjson.js";

function registerRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const visibility = "workspace";
  const routeBase = resolveAssistantApiBasePath({
    visibility
  });

  router.register(
    "POST",
    `${routeBase}/chat/stream`,
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["assistant"],
        summary: "Stream assistant response for workspace user."
      },
      paramsValidator: routeParamsValidator,
      bodyValidator: assistantResource.operations.chatStream.bodyValidator
    },
    async function assistantChatStreamRoute(request, reply) {
      const abortController = new AbortController();
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
            surface: "admin"
          },
          input: (() => {
            const body = request.input.body;
            const input = {
              workspaceSlug: request.input.params.workspaceSlug,
              messageId: body.messageId,
              input: body.input
            };
            if (Object.hasOwn(body, "conversationId")) {
              input.conversationId = body.conversationId;
            }
            if (Object.hasOwn(body, "history")) {
              input.history = body.history;
            }
            if (Object.hasOwn(body, "clientContext")) {
              input.clientContext = body.clientContext;
            }
            return input;
          })(),
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
    `${routeBase}/conversations`,
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["assistant"],
        summary: "List assistant conversations for current workspace user."
      },
      paramsValidator: routeParamsValidator,
      queryValidator: assistantResource.operations.conversationsList.queryValidator,
      responseValidators: withStandardErrorResponses({
        200: assistantResource.operations.conversationsList.outputValidator
      })
    },
    async function assistantConversationsRoute(request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.conversationsList,
        context: {
          surface: "admin"
        },
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          ...request.input.query
        }
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/conversations/:conversationId/messages`,
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["assistant"],
        summary: "List messages for one assistant conversation."
      },
      paramsValidator: [routeParamsValidator, assistantResource.operations.conversationMessagesList.paramsValidator],
      queryValidator: assistantResource.operations.conversationMessagesList.queryValidator,
      responseValidators: withStandardErrorResponses({
        200: assistantResource.operations.conversationMessagesList.outputValidator
      })
    },
    async function assistantConversationMessagesRoute(request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.conversationMessagesList,
        context: {
          surface: "admin"
        },
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          conversationId: request.input.params.conversationId,
          ...request.input.query
        }
      });

      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
