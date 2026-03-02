import { allowPublic } from "@jskit-ai/action-runtime-core/actionContributorHelpers";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../../shared/eventTypes.js";
import { publishUserScopedRealtimeEvent, toPositiveInteger } from "./realtimePublishHelpers.js";

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function requireServiceMethod(service, methodName, contributorId) {
  if (!service || typeof service[methodName] !== "function") {
    throw new Error(`${contributorId} requires ${methodName}().`);
  }
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

function resolveUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || resolveRequest(context)?.user || context?.actor || null;
}

function resolveErrorId(input) {
  const payload = normalizeObject(input);
  return payload.errorId || payload.params?.errorId || null;
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

function createConsoleErrorsActionContributor({ consoleErrorsService, realtimeEventsService = null } = {}) {
  const contributorId = "app.console_errors";

  requireServiceMethod(consoleErrorsService, "listBrowserErrors", contributorId);
  requireServiceMethod(consoleErrorsService, "getBrowserError", contributorId);
  requireServiceMethod(consoleErrorsService, "listServerErrors", contributorId);
  requireServiceMethod(consoleErrorsService, "getServerError", contributorId);
  requireServiceMethod(consoleErrorsService, "recordBrowserError", contributorId);
  requireServiceMethod(consoleErrorsService, "simulateServerError", contributorId);

  return {
    contributorId,
    domain: "console",
    actions: Object.freeze([
      {
        id: "console.errors.browser.list",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["console.errors.browser.read"],
        idempotency: "none",
        audit: {
          actionName: "console.errors.browser.list"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return consoleErrorsService.listBrowserErrors(resolveUser(context, payload), {
            page: Number(payload.page || 1),
            pageSize: Number(payload.pageSize || 20)
          });
        }
      },
      {
        id: "console.errors.browser.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["console.errors.browser.read"],
        idempotency: "none",
        audit: {
          actionName: "console.errors.browser.get"
        },
        observability: {},
        async execute(input, context) {
          return consoleErrorsService.getBrowserError(resolveUser(context, input), resolveErrorId(input));
        }
      },
      {
        id: "console.errors.server.list",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["console.errors.server.read"],
        idempotency: "none",
        audit: {
          actionName: "console.errors.server.list"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return consoleErrorsService.listServerErrors(resolveUser(context, payload), {
            page: Number(payload.page || 1),
            pageSize: Number(payload.pageSize || 20)
          });
        }
      },
      {
        id: "console.errors.server.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["console.errors.server.read"],
        idempotency: "none",
        audit: {
          actionName: "console.errors.server.get"
        },
        observability: {},
        async execute(input, context) {
          return consoleErrorsService.getServerError(resolveUser(context, input), resolveErrorId(input));
        }
      },
      {
        id: "console.errors.browser.record",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: {
          actionName: "console.errors.browser.record"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          await consoleErrorsService.recordBrowserError({
            payload,
            user: resolveUser(context, input)
          });
          const actorUserId = toPositiveInteger(resolveUser(context, payload)?.id);
          publishUserScopedRealtimeEvent({
            realtimeEventsService,
            context,
            input: payload,
            topic: REALTIME_TOPICS.CONSOLE_ERRORS,
            eventType: REALTIME_EVENT_TYPES.CONSOLE_ERRORS_UPDATED,
            entityType: "console_error",
            entityId: "browser",
            targetUserId: actorUserId || null,
            payload: {
              actionId: "console.errors.browser.record"
            }
          });

          return {
            ok: true
          };
        }
      },
      {
        id: "console.errors.server.simulate",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["console.errors.server.read"],
        idempotency: "none",
        audit: {
          actionName: "console.errors.server.simulate"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          const result = await consoleErrorsService.simulateServerError({
            user: resolveUser(context, input),
            payload
          });
          publishUserScopedRealtimeEvent({
            realtimeEventsService,
            context,
            input: payload,
            topic: REALTIME_TOPICS.CONSOLE_ERRORS,
            eventType: REALTIME_EVENT_TYPES.CONSOLE_ERRORS_UPDATED,
            entityType: "console_error",
            entityId: "server",
            targetUserId: toPositiveInteger(resolveUser(context, payload)?.id) || null,
            payload: {
              actionId: "console.errors.server.simulate"
            }
          });
          return result;
        }
      }
    ])
  };
}

export { createConsoleErrorsActionContributor };
