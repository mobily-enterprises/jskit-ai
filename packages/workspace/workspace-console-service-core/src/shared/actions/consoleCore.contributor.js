import {
  CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS,
  CONSOLE_MANAGEMENT_PERMISSIONS
} from "@jskit-ai/workspace-console-core/consoleRoles";
import { applyRealtimePublishToCommandAction } from "@jskit-ai/action-runtime-core/realtimePublish";

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

function resolveUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || resolveRequest(context)?.user || context?.actor || null;
}

function requireAuthenticated(context) {
  return toPositiveInteger(context?.actor?.id) > 0;
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

const DEFAULT_REALTIME_TOPICS = Object.freeze({
  CONSOLE_SETTINGS: "console_settings",
  CONSOLE_MEMBERS: "console_members",
  CONSOLE_INVITES: "console_invites"
});

const DEFAULT_REALTIME_EVENT_TYPES = Object.freeze({
  CONSOLE_SETTINGS_UPDATED: "console.settings.updated",
  CONSOLE_MEMBERS_UPDATED: "console.members.updated",
  CONSOLE_INVITES_UPDATED: "console.invites.updated"
});

function resolveRealtimePublishConfig(actionId, { realtimeTopics, realtimeEventTypes }) {
  const normalizedActionId = String(actionId || "").trim();
  if (!normalizedActionId) {
    return null;
  }

  if (normalizedActionId.startsWith("console.member.")) {
    return {
      topic: String(realtimeTopics?.CONSOLE_MEMBERS || ""),
      eventType: String(realtimeEventTypes?.CONSOLE_MEMBERS_UPDATED || "")
    };
  }

  if (normalizedActionId.startsWith("console.settings.")) {
    return {
      topic: String(realtimeTopics?.CONSOLE_SETTINGS || ""),
      eventType: String(realtimeEventTypes?.CONSOLE_SETTINGS_UPDATED || "")
    };
  }

  if (normalizedActionId.startsWith("console.invite.") || normalizedActionId.startsWith("console.invitations.")) {
    return {
      topic: String(realtimeTopics?.CONSOLE_INVITES || ""),
      eventType: String(realtimeEventTypes?.CONSOLE_INVITES_UPDATED || "")
    };
  }

  return null;
}

function createConsoleCoreActionContributor({
  consoleService,
  realtimeEventsService = null,
  realtimeTopics = null,
  realtimeEventTypes = null
} = {}) {
  const contributorId = "workspace.console.core";

  requireServiceMethod(consoleService, "buildBootstrapPayload", contributorId);
  requireServiceMethod(consoleService, "listRoles", contributorId);
  requireServiceMethod(consoleService, "getAssistantSettings", contributorId);
  requireServiceMethod(consoleService, "updateAssistantSettings", contributorId);
  requireServiceMethod(consoleService, "listMembers", contributorId);
  requireServiceMethod(consoleService, "updateMemberRole", contributorId);
  requireServiceMethod(consoleService, "listInvites", contributorId);
  requireServiceMethod(consoleService, "createInvite", contributorId);
  requireServiceMethod(consoleService, "revokeInvite", contributorId);
  requireServiceMethod(consoleService, "listPendingInvitesForUser", contributorId);
  requireServiceMethod(consoleService, "respondToPendingInviteByToken", contributorId);

  const actions = [
    {
      id: "console.bootstrap.read",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "console.bootstrap.read"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.buildBootstrapPayload({
          user: resolveUser(context, input)
        });
      }
    },
    {
      id: "console.roles.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "console.roles.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listRoles(resolveUser(context, input));
      }
    },
    {
      id: "console.settings.read",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "console.settings.read"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.getAssistantSettings(resolveUser(context, input));
      }
    },
    {
      id: "console.settings.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS.MANAGE],
      idempotency: "optional",
      audit: {
        actionName: "console.settings.update"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.updateAssistantSettings(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.members.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_MANAGEMENT_PERMISSIONS.MEMBERS_VIEW],
      idempotency: "none",
      audit: {
        actionName: "console.members.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listMembers(resolveUser(context, input));
      }
    },
    {
      id: "console.member.role.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_MANAGEMENT_PERMISSIONS.MEMBERS_MANAGE],
      idempotency: "optional",
      audit: {
        actionName: "console.member.role.update"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.updateMemberRole(resolveUser(context, payload), {
          memberUserId: payload.memberUserId || payload.userId || payload.params?.memberUserId,
          roleId: payload.roleId
        });
      }
    },
    {
      id: "console.invites.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_MANAGEMENT_PERMISSIONS.MEMBERS_VIEW],
      idempotency: "none",
      audit: {
        actionName: "console.invites.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listInvites(resolveUser(context, input));
      }
    },
    {
      id: "console.invite.create",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_MANAGEMENT_PERMISSIONS.MEMBERS_INVITE],
      idempotency: "optional",
      audit: {
        actionName: "console.invite.create"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.createInvite(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.invite.revoke",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_MANAGEMENT_PERMISSIONS.INVITES_REVOKE],
      idempotency: "optional",
      audit: {
        actionName: "console.invite.revoke"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.revokeInvite(resolveUser(context, payload), payload.inviteId || payload.params?.inviteId);
      }
    },
    {
      id: "console.invitations.pending.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "console.invitations.pending.list"
      },
      observability: {},
      async execute(input, context) {
        return {
          pendingInvites: await consoleService.listPendingInvitesForUser(resolveUser(context, input))
        };
      }
    },
    {
      id: "console.invite.redeem",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "optional",
      audit: {
        actionName: "console.invite.redeem"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.respondToPendingInviteByToken({
          user: resolveUser(context, payload),
          inviteToken: payload.token || payload.inviteToken,
          decision: payload.decision
        });
      }
    }
  ];

  const resolvedRealtimeTopics = {
    ...DEFAULT_REALTIME_TOPICS,
    ...(realtimeTopics && typeof realtimeTopics === "object" ? realtimeTopics : {})
  };
  const resolvedRealtimeEventTypes = {
    ...DEFAULT_REALTIME_EVENT_TYPES,
    ...(realtimeEventTypes && typeof realtimeEventTypes === "object" ? realtimeEventTypes : {})
  };

  for (let index = 0; index < actions.length; index += 1) {
    actions[index] = applyRealtimePublishToCommandAction(actions[index], {
      realtimeEventsService,
      resolvePublishConfig(actionId) {
        return resolveRealtimePublishConfig(actionId, {
          realtimeTopics: resolvedRealtimeTopics,
          realtimeEventTypes: resolvedRealtimeEventTypes
        });
      },
      resolveActorUserId({ input, context }) {
        return toPositiveInteger(resolveUser(context, input)?.id);
      },
      resolveEntityType() {
        return "console";
      },
      resolvePayload({ actionId }) {
        return {
          actionId: String(actionId || "")
        };
      }
    });
  }

  return {
    contributorId,
    domain: "console",
    actions: Object.freeze(actions)
  };
}

export { createConsoleCoreActionContributor };
