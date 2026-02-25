import { createService as createDeg2radModuleService } from "../../../modules/deg2rad/index.js";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../../shared/eventTypes.js";
import { publishUserScopedRealtimeEvent } from "./realtimePublishHelpers.js";

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
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

function resolveWorkspaceId(context, input) {
  const payload = normalizeObject(input);
  const workspace = payload.workspace || resolveRequest(context)?.workspace || context?.workspace || null;
  return toPositiveInteger(workspace?.id);
}

function resolveWorkspace(context, input) {
  const payload = normalizeObject(input);
  const workspace = payload.workspace || resolveRequest(context)?.workspace || context?.workspace || null;
  if (!workspace || typeof workspace !== "object") {
    return null;
  }

  return {
    id: toPositiveInteger(workspace.id) || null,
    slug: String(workspace.slug || "").trim() || null
  };
}

function resolveUsageEventKey(context) {
  return normalizeHeaderValue(context?.requestMeta?.idempotencyKey) || normalizeHeaderValue(context?.requestMeta?.commandId);
}

function resolveRequestId(context) {
  return normalizeHeaderValue(context?.requestMeta?.commandId) || normalizeHeaderValue(context?.requestMeta?.idempotencyKey);
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

const DEG2RAD_CALCULATE_TOOL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
  required: ["degrees"],
  properties: {
    degrees: {
      anyOf: [{ type: "number" }, { type: "string" }],
      description: "Degree value to convert to radians."
    }
  }
});

const HISTORY_LIST_TOOL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
  properties: {
    page: {
      type: "integer",
      minimum: 1
    },
    pageSize: {
      type: "integer",
      minimum: 1,
      maximum: 100
    }
  }
});

function createDeg2radHistoryActionContributor({
  deg2radService = null,
  deg2radHistoryService,
  billingService = null,
  realtimeEventsService = null
} = {}) {
  const contributorId = "app.deg2rad_history";
  const resolvedDeg2radService =
    deg2radService && typeof deg2radService === "object" ? deg2radService : createDeg2radModuleService().service;

  requireServiceMethod(resolvedDeg2radService, "validateAndNormalizeInput", contributorId);
  requireServiceMethod(resolvedDeg2radService, "calculateDeg2rad", contributorId);
  requireServiceMethod(deg2radHistoryService, "appendCalculation", contributorId);
  requireServiceMethod(deg2radHistoryService, "listForUser", contributorId);

  const executeWithEntitlementConsumption =
    billingService && typeof billingService.executeWithEntitlementConsumption === "function"
      ? billingService.executeWithEntitlementConsumption.bind(billingService)
      : null;

  return {
    contributorId,
    domain: "deg2rad_history",
    actions: Object.freeze([
      {
        id: "deg2rad.calculate",
        version: 1,
        kind: "command",
        channels: ["api", "assistant_tool", "internal"],
        surfaces: ["app"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["history.write"],
        idempotency: "optional",
        audit: {
          actionName: "deg2rad.calculate"
        },
        observability: {},
        assistantTool: {
          description: "Convert degrees to radians and store the calculation in history.",
          inputJsonSchema: DEG2RAD_CALCULATE_TOOL_SCHEMA
        },
        async execute(input, context) {
          const user = resolveUser(context, input);
          const workspaceId = resolveWorkspaceId(context, input);
          const workspace = resolveWorkspace(context, input);
          const normalizedInput = resolvedDeg2radService.validateAndNormalizeInput(normalizeObject(input));

          const runCalculation = async ({ trx = null } = {}) => {
            const result = resolvedDeg2radService.calculateDeg2rad(normalizedInput);
            const historyEntry = await deg2radHistoryService.appendCalculation(
              workspaceId,
              user?.id,
              result,
              trx ? { trx } : {}
            );

            return {
              result: {
                ...result,
                historyId: historyEntry.id
              }
            };
          };

          const execution = executeWithEntitlementConsumption
            ? await executeWithEntitlementConsumption({
                request: resolveRequest(context),
                user,
                capability: "deg2rad.calculate",
                usageEventKey: resolveUsageEventKey(context),
                requestId: resolveRequestId(context),
                metadataJson: {
                  capability: "deg2rad.calculate",
                  workspaceId: workspaceId || null,
                  calculator: "DEG2RAD"
                },
                action: ({ trx } = {}) => runCalculation({ trx })
              })
            : await runCalculation();

          const result = execution.result;
          publishUserScopedRealtimeEvent({
            realtimeEventsService,
            context,
            input,
            topic: REALTIME_TOPICS.HISTORY,
            eventType: REALTIME_EVENT_TYPES.USER_HISTORY_UPDATED,
            entityType: "history",
            entityId: Number(result?.historyId || 0) > 0 ? String(result.historyId) : "none",
            workspace,
            targetUserId: toPositiveInteger(user?.id),
            payload: {
              actionId: "deg2rad.calculate",
              historyId: Number(result?.historyId || 0) || null
            }
          });

          return result;
        }
      },
      {
        id: "history.list",
        version: 1,
        kind: "query",
        channels: ["api", "assistant_tool", "internal"],
        surfaces: ["app"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["history.read"],
        idempotency: "none",
        audit: {
          actionName: "history.list"
        },
        observability: {},
        assistantTool: {
          description: "List recent DEG2RAD calculation history.",
          inputJsonSchema: HISTORY_LIST_TOOL_SCHEMA
        },
        async execute(input, context) {
          const payload = normalizeObject(input);
          return deg2radHistoryService.listForUser(resolveWorkspaceId(context, payload), resolveUser(context, payload), {
            page: Number(payload.page || 1),
            pageSize: Number(payload.pageSize || 10)
          });
        }
      }
    ])
  };
}

export { createDeg2radHistoryActionContributor };
