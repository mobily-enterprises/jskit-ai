import {
  CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS,
  CONSOLE_BILLING_PERMISSIONS,
  CONSOLE_MANAGEMENT_PERMISSIONS,
  CONSOLE_AI_TRANSCRIPTS_PERMISSIONS
} from "@jskit-ai/workspace-console-core/consoleRoles";

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

function splitUpdateInput(input, idField) {
  const payload = normalizeObject(input);

  if (payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)) {
    return {
      params: {
        [idField]: payload[idField] || payload.params?.[idField]
      },
      payload: payload.payload
    };
  }

  const nextPayload = {
    ...payload
  };
  delete nextPayload[idField];
  delete nextPayload.params;

  return {
    params: {
      [idField]: payload[idField] || payload.params?.[idField]
    },
    payload: nextPayload
  };
}

function createConsoleActionContributor({ consoleService, aiTranscriptsService = null } = {}) {
  const contributorId = "workspace.console";

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
  requireServiceMethod(consoleService, "getBillingSettings", contributorId);
  requireServiceMethod(consoleService, "updateBillingSettings", contributorId);
  requireServiceMethod(consoleService, "listBillingEvents", contributorId);
  requireServiceMethod(consoleService, "listBillingPlans", contributorId);
  requireServiceMethod(consoleService, "listBillingProducts", contributorId);
  requireServiceMethod(consoleService, "createBillingPlan", contributorId);
  requireServiceMethod(consoleService, "createBillingProduct", contributorId);
  requireServiceMethod(consoleService, "listBillingProviderPrices", contributorId);
  requireServiceMethod(consoleService, "updateBillingPlan", contributorId);
  requireServiceMethod(consoleService, "updateBillingProduct", contributorId);

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
    },
    {
      id: "console.billing.settings.read",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: "none",
      audit: {
        actionName: "console.billing.settings.read"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.getBillingSettings(resolveUser(context, input));
      }
    },
    {
      id: "console.billing.settings.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: "optional",
      audit: {
        actionName: "console.billing.settings.update"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.updateBillingSettings(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.billing.events.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.READ_ALL],
      idempotency: "none",
      audit: {
        actionName: "console.billing.events.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listBillingEvents(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.billing.plans.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: "none",
      audit: {
        actionName: "console.billing.plans.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listBillingPlans(resolveUser(context, input));
      }
    },
    {
      id: "console.billing.products.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: "none",
      audit: {
        actionName: "console.billing.products.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listBillingProducts(resolveUser(context, input));
      }
    },
    {
      id: "console.billing.plan.create",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: "optional",
      audit: {
        actionName: "console.billing.plan.create"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.createBillingPlan(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.billing.product.create",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: "optional",
      audit: {
        actionName: "console.billing.product.create"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.createBillingProduct(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.billing.provider_prices.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: "none",
      audit: {
        actionName: "console.billing.provider_prices.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listBillingProviderPrices(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.billing.plan.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: "optional",
      audit: {
        actionName: "console.billing.plan.update"
      },
      observability: {},
      async execute(input, context) {
        const parsed = splitUpdateInput(input, "planId");
        return consoleService.updateBillingPlan(resolveUser(context, input), parsed.params, parsed.payload);
      }
    },
    {
      id: "console.billing.product.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: "optional",
      audit: {
        actionName: "console.billing.product.update"
      },
      observability: {},
      async execute(input, context) {
        const parsed = splitUpdateInput(input, "productId");
        return consoleService.updateBillingProduct(resolveUser(context, input), parsed.params, parsed.payload);
      }
    }
  ];

  if (
    aiTranscriptsService &&
    typeof aiTranscriptsService.listConsoleConversations === "function" &&
    typeof aiTranscriptsService.getConsoleConversationMessages === "function" &&
    typeof aiTranscriptsService.exportConsoleMessages === "function"
  ) {
    actions.push(
      {
        id: "console.ai.transcripts.list",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: [CONSOLE_AI_TRANSCRIPTS_PERMISSIONS.READ_ALL],
        idempotency: "none",
        audit: {
          actionName: "console.ai.transcripts.list"
        },
        observability: {},
        async execute(input, context) {
          return aiTranscriptsService.listConsoleConversations(resolveUser(context, input), normalizeObject(input));
        }
      },
      {
        id: "console.ai.transcript.messages.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: [CONSOLE_AI_TRANSCRIPTS_PERMISSIONS.READ_ALL],
        idempotency: "none",
        audit: {
          actionName: "console.ai.transcript.messages.get"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          const conversationId = payload.conversationId || payload.params?.conversationId;
          return aiTranscriptsService.getConsoleConversationMessages(resolveUser(context, payload), conversationId, payload);
        }
      },
      {
        id: "console.ai.transcripts.export",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: [CONSOLE_AI_TRANSCRIPTS_PERMISSIONS.EXPORT_ALL],
        idempotency: "none",
        audit: {
          actionName: "console.ai.transcripts.export"
        },
        observability: {},
        async execute(input, context) {
          return aiTranscriptsService.exportConsoleMessages(resolveUser(context, input), normalizeObject(input));
        }
      }
    );
  }

  return {
    contributorId,
    domain: "console",
    actions: Object.freeze(actions)
  };
}

export { createConsoleActionContributor };
