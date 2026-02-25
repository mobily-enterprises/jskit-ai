import { ACTION_IDS } from "../../../../shared/actionIds.js";

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
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

function resolveUser(context) {
  return resolveRequest(context)?.user || context?.actor || null;
}

function requireAuthenticated(context) {
  return toPositiveInteger(context?.actor?.id) > 0;
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

function createAlertsActionContributor({ alertsService } = {}) {
  const contributorId = "app.alerts";

  requireServiceMethod(alertsService, "listForUser", contributorId);
  requireServiceMethod(alertsService, "markAllReadForUser", contributorId);

  return {
    contributorId,
    domain: "settings",
    actions: Object.freeze([
      {
        id: ACTION_IDS.SETTINGS_ALERTS_LIST,
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "none",
        audit: {
          actionName: "settings.alerts.list"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return alertsService.listForUser(resolveUser(context), {
            page: Number(payload.page || 1),
            pageSize: Number(payload.pageSize || 20)
          });
        }
      },
      {
        id: ACTION_IDS.SETTINGS_ALERTS_READ_ALL,
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.alerts.read_all"
        },
        observability: {},
        async execute(input, context) {
          void input;
          return alertsService.markAllReadForUser(resolveUser(context));
        }
      }
    ])
  };
}

export { createAlertsActionContributor };
