import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../../shared/realtime/eventTypes.js";

function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeWorkspaceName(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          name: "Name is required."
        }
      }
    });
  }

  if (normalized.length > 160) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          name: "Name must be at most 160 characters."
        }
      }
    });
  }

  return normalized;
}

function createWorkspaceRenameTool({ workspaceAdminService, realtimeEventsService = null } = {}) {
  if (!workspaceAdminService || typeof workspaceAdminService.updateWorkspaceSettings !== "function") {
    throw new Error("workspaceAdminService.updateWorkspaceSettings is required.");
  }

  const publishWorkspaceEvent =
    realtimeEventsService && typeof realtimeEventsService.publishWorkspaceEvent === "function"
      ? realtimeEventsService.publishWorkspaceEvent
      : null;

  function publishWorkspaceEventSafely({ request, workspace, topic, eventType, payload }) {
    if (!publishWorkspaceEvent) {
      return;
    }

    try {
      publishWorkspaceEvent({
        eventType,
        topic,
        workspace,
        entityType: "workspace",
        entityId: workspace?.id,
        commandId: normalizeHeaderValue(request?.headers?.["x-command-id"]),
        sourceClientId: normalizeHeaderValue(request?.headers?.["x-client-id"]),
        actorUserId: request?.user?.id,
        payload
      });
    } catch (error) {
      const warnLogger = request?.log && typeof request.log.warn === "function" ? request.log.warn.bind(request.log) : null;
      if (warnLogger) {
        warnLogger({ err: error }, "ai.workspace_rename.realtime_publish_failed");
      }
    }
  }

  return {
    name: "workspace_rename",
    description: "Rename the active workspace.",
    inputJsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 160,
          description: "New workspace display name."
        }
      }
    },
    requiredPermissions: ["workspace.settings.update"],
    async execute({ args, context }) {
      const workspace = context?.workspace;
      const workspaceId = parsePositiveInteger(workspace?.id);
      if (!workspaceId) {
        throw new AppError(409, "Workspace selection required.");
      }

      const name = normalizeWorkspaceName(args?.name);
      const response = await workspaceAdminService.updateWorkspaceSettings(workspace, {
        name
      });

      const workspaceSlug = String(response?.workspace?.slug || workspace?.slug || "").trim();
      const nextName = String(response?.workspace?.name || name).trim();

      const eventPayload = {
        operation: "updated",
        workspaceId,
        workspaceSlug
      };

      publishWorkspaceEventSafely({
        request: context?.request,
        workspace,
        topic: REALTIME_TOPICS.WORKSPACE_SETTINGS,
        eventType: REALTIME_EVENT_TYPES.WORKSPACE_SETTINGS_UPDATED,
        payload: eventPayload
      });

      publishWorkspaceEventSafely({
        request: context?.request,
        workspace,
        topic: REALTIME_TOPICS.WORKSPACE_META,
        eventType: REALTIME_EVENT_TYPES.WORKSPACE_META_UPDATED,
        payload: eventPayload
      });

      return {
        workspaceId,
        workspaceSlug,
        name: nextName
      };
    }
  };
}

export { createWorkspaceRenameTool };
