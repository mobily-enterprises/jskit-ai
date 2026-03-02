import { ACTION_IDS } from "../../../../shared/actionIds.js";
import {
  normalizeObject,
  requireAuthenticated,
  requireServiceMethod,
  resolveUser,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/action-runtime-core/actionContributorHelpers";

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
        idempotency: "none",
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
