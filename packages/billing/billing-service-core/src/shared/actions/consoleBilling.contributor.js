import { applyRealtimePublishToCommandAction } from "@jskit-ai/action-runtime-core/realtimePublish";
import { CONSOLE_BILLING_PERMISSIONS } from "@jskit-ai/workspace-console-core/consoleRoles";
import { buildAssistantInputJsonSchema } from "./assistantInputSchema.js";

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

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

function resolveParamFromInput(input, idField) {
  const payload = normalizeObject(input);
  return payload[idField] || payload.params?.[idField];
}

function resolveBodyInput(input) {
  const payload = normalizeObject(input);
  if (payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)) {
    return payload.payload;
  }

  return payload;
}

function resolveIdempotencyKey(context, input) {
  const payload = normalizeObject(input);
  const fromPayload = String(payload.idempotencyKey || "").trim();
  if (fromPayload) {
    return fromPayload;
  }

  const fromRequestMeta = String(context?.requestMeta?.idempotencyKey || "").trim();
  if (fromRequestMeta) {
    return fromRequestMeta;
  }

  const fromCommand = String(context?.requestMeta?.commandId || "").trim();
  return fromCommand || "";
}

function splitUpdateInput(input, idField) {
  const payload = normalizeObject(input);

  if (payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)) {
    return {
      params: {
        [idField]: resolveParamFromInput(payload, idField)
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
      [idField]: resolveParamFromInput(payload, idField)
    },
    payload: nextPayload
  };
}

// Keep this explicit so contract drift is visible in code review.
const CONSOLE_BILLING_ACTION_IDEMPOTENCY = Object.freeze({
  "console.billing.settings.read": "none",
  "console.billing.settings.update": "optional",
  "console.billing.events.list": "none",
  "console.billing.plans.list": "none",
  "console.billing.products.list": "none",
  "console.billing.plan.create": "optional",
  "console.billing.product.create": "optional",
  "console.billing.provider_prices.list": "none",
  "console.billing.plan.update": "optional",
  "console.billing.product.update": "optional",
  "console.billing.entitlement_definitions.list": "none",
  "console.billing.entitlement_definition.get": "none",
  "console.billing.entitlement_definition.create": "optional",
  "console.billing.entitlement_definition.update": "optional",
  "console.billing.entitlement_definition.delete": "required",
  "console.billing.plan.archive": "required",
  "console.billing.plan.unarchive": "required",
  "console.billing.plan.delete": "required",
  "console.billing.product.archive": "required",
  "console.billing.product.unarchive": "required",
  "console.billing.product.delete": "required",
  "console.billing.purchases.list": "none",
  "console.billing.purchase.refund": "required",
  "console.billing.purchase.void": "required",
  "console.billing.purchase.correction.create": "required",
  "console.billing.plan_assignments.list": "none",
  "console.billing.plan_assignment.create": "required",
  "console.billing.plan_assignment.update": "required",
  "console.billing.plan_assignment.cancel": "required",
  "console.billing.subscriptions.list": "none",
  "console.billing.subscription.change_plan": "required",
  "console.billing.subscription.cancel": "required",
  "console.billing.subscription.cancel_at_period_end": "required"
});

const DEFAULT_REALTIME_TOPICS = Object.freeze({
  CONSOLE_BILLING: "console_billing"
});

const DEFAULT_REALTIME_EVENT_TYPES = Object.freeze({
  CONSOLE_BILLING_UPDATED: "console.billing.updated"
});

function buildConfirmedCommandInputJsonSchema({ properties = {}, required = [] } = {}) {
  return buildAssistantInputJsonSchema({
    properties: {
      ...properties,
      reason: {
        type: "string",
        minLength: 3,
        maxLength: 500,
        description: "Human-readable reason for audit."
      },
      confirm: {
        type: "boolean",
        const: true,
        description: "Must be true to confirm this destructive command."
      }
    },
    required: [...required, "reason", "confirm"]
  });
}

function withAssistantToolChannel(channels) {
  const currentChannels = Array.isArray(channels) ? channels : [];
  if (currentChannels.includes("assistant_tool")) {
    return currentChannels;
  }
  return [...currentChannels, "assistant_tool"];
}

const CONSOLE_BILLING_ASSISTANT_TOOL_CONFIG = Object.freeze({
  "console.billing.entitlement_definitions.list": Object.freeze({
    description: "List entitlement definitions for console billing catalog administration.",
    inputJsonSchema: buildAssistantInputJsonSchema({
      properties: {
        includeInactive: { type: "boolean" },
        code: { type: "string" },
        codes: {
          type: "array",
          items: { type: "string" }
        }
      }
    })
  }),
  "console.billing.entitlement_definition.get": Object.freeze({
    description: "Get one entitlement definition by id.",
    inputJsonSchema: buildAssistantInputJsonSchema({
      properties: {
        definitionId: { type: "string" }
      },
      required: ["definitionId"]
    })
  }),
  "console.billing.entitlement_definition.create": Object.freeze({
    description: "Create an entitlement definition in the billing catalog.",
    inputJsonSchema: buildAssistantInputJsonSchema({
      properties: {
        code: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        entitlementType: { type: "string" },
        unit: { type: "string" },
        windowInterval: { type: ["string", "null"] },
        enforcementMode: { type: "string" },
        isActive: { type: "boolean" }
      },
      required: ["code", "name", "entitlementType", "unit", "enforcementMode"]
    })
  }),
  "console.billing.entitlement_definition.update": Object.freeze({
    description: "Update fields on an entitlement definition.",
    inputJsonSchema: buildAssistantInputJsonSchema({
      properties: {
        definitionId: { type: "string" },
        code: { type: "string" },
        name: { type: "string" },
        description: { type: ["string", "null"] },
        entitlementType: { type: "string" },
        unit: { type: "string" },
        windowInterval: { type: ["string", "null"] },
        enforcementMode: { type: "string" },
        isActive: { type: "boolean" }
      },
      required: ["definitionId"]
    })
  }),
  "console.billing.entitlement_definition.delete": Object.freeze({
    description: "Delete an entitlement definition after dependency checks pass.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        definitionId: { type: "string" }
      },
      required: ["definitionId"]
    })
  }),
  "console.billing.plan.archive": Object.freeze({
    description: "Archive a billing plan so it is no longer offered.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        planId: { type: "string" }
      },
      required: ["planId"]
    })
  }),
  "console.billing.plan.unarchive": Object.freeze({
    description: "Unarchive a billing plan and restore it to active catalog operations.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        planId: { type: "string" }
      },
      required: ["planId"]
    })
  }),
  "console.billing.plan.delete": Object.freeze({
    description: "Hard-delete a billing plan when dependency checks allow it.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        planId: { type: "string" }
      },
      required: ["planId"]
    })
  }),
  "console.billing.product.archive": Object.freeze({
    description: "Archive a billing product so it is no longer offered.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        productId: { type: "string" }
      },
      required: ["productId"]
    })
  }),
  "console.billing.product.unarchive": Object.freeze({
    description: "Unarchive a billing product and restore it to active catalog operations.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        productId: { type: "string" }
      },
      required: ["productId"]
    })
  }),
  "console.billing.product.delete": Object.freeze({
    description: "Hard-delete a billing product when dependency checks allow it.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        productId: { type: "string" }
      },
      required: ["productId"]
    })
  }),
  "console.billing.purchases.list": Object.freeze({
    description: "List billing purchases across billable entities for console operations.",
    inputJsonSchema: buildAssistantInputJsonSchema({
      properties: {
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 200 },
        status: { type: "string" },
        provider: { type: "string" },
        purchaseKind: { type: "string" },
        workspaceSlug: { type: "string" },
        billableEntityId: { type: ["integer", "string"] },
        operationKey: { type: "string" },
        providerInvoiceId: { type: "string" },
        providerPaymentId: { type: "string" }
      }
    })
  }),
  "console.billing.purchase.refund": Object.freeze({
    description: "Issue a purchase refund and persist an auditable adjustment row.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        purchaseId: { type: "string" },
        reasonCode: { type: "string" },
        metadataJson: { type: "object", additionalProperties: true }
      },
      required: ["purchaseId"]
    })
  }),
  "console.billing.purchase.void": Object.freeze({
    description: "Void a purchase when provider/state constraints allow it.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        purchaseId: { type: "string" },
        reasonCode: { type: "string" },
        metadataJson: { type: "object", additionalProperties: true }
      },
      required: ["purchaseId"]
    })
  }),
  "console.billing.purchase.correction.create": Object.freeze({
    description: "Create a manual purchase correction adjustment entry.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        purchaseId: { type: "string" },
        amountMinor: { type: "integer" },
        currency: { type: "string" },
        reasonCode: { type: "string" },
        providerReference: { type: ["string", "null"] },
        metadataJson: { type: "object", additionalProperties: true }
      },
      required: ["purchaseId", "amountMinor", "currency"]
    })
  }),
  "console.billing.plan_assignments.list": Object.freeze({
    description: "List plan assignments across entities for console operators.",
    inputJsonSchema: buildAssistantInputJsonSchema({
      properties: {
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 200 },
        billableEntityId: { type: ["integer", "string"] },
        workspaceSlug: { type: "string" },
        status: { type: "string" },
        from: { type: "string" },
        to: { type: "string" }
      }
    })
  }),
  "console.billing.plan_assignment.create": Object.freeze({
    description: "Create a plan assignment for an explicit billable entity target.",
    inputJsonSchema: buildAssistantInputJsonSchema({
      properties: {
        billableEntityId: { type: ["integer", "string"] },
        workspaceSlug: { type: "string" },
        planCode: { type: "string" },
        source: { type: "string" },
        periodStartAt: { type: "string" },
        periodEndAt: { type: ["string", "null"] },
        metadataJson: { type: "object", additionalProperties: true },
        requestedByUserId: { type: ["integer", "null"] }
      },
      required: ["planCode"]
    })
  }),
  "console.billing.plan_assignment.update": Object.freeze({
    description: "Patch an existing plan assignment.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        assignmentId: { type: "string" },
        planCode: { type: "string" },
        periodStartAt: { type: "string" },
        periodEndAt: { type: ["string", "null"] },
        status: { type: "string" },
        metadataJson: { type: "object", additionalProperties: true }
      },
      required: ["assignmentId"]
    })
  }),
  "console.billing.plan_assignment.cancel": Object.freeze({
    description: "Cancel an existing plan assignment.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        assignmentId: { type: "string" },
        canceledAt: { type: "string" },
        metadataJson: { type: "object", additionalProperties: true }
      },
      required: ["assignmentId"]
    })
  }),
  "console.billing.subscriptions.list": Object.freeze({
    description: "List provider subscriptions across billable entities.",
    inputJsonSchema: buildAssistantInputJsonSchema({
      properties: {
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 200 },
        provider: { type: "string" },
        status: { type: "string" },
        workspaceSlug: { type: "string" },
        billableEntityId: { type: ["integer", "string"] }
      }
    })
  }),
  "console.billing.subscription.change_plan": Object.freeze({
    description: "Change a provider subscription to a different plan.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        providerSubscriptionId: { type: "string" },
        planCode: { type: "string" },
        prorationBehavior: { type: "string" },
        billingCycleAnchor: { type: "string" },
        paymentBehavior: { type: ["string", "null"] }
      },
      required: ["providerSubscriptionId", "planCode"]
    })
  }),
  "console.billing.subscription.cancel": Object.freeze({
    description: "Cancel a provider subscription immediately.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        providerSubscriptionId: { type: "string" },
        metadataJson: { type: "object", additionalProperties: true }
      },
      required: ["providerSubscriptionId"]
    })
  }),
  "console.billing.subscription.cancel_at_period_end": Object.freeze({
    description: "Mark a provider subscription to cancel at period end.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        providerSubscriptionId: { type: "string" },
        metadataJson: { type: "object", additionalProperties: true }
      },
      required: ["providerSubscriptionId"]
    })
  })
});

function applyConsoleBillingAssistantToolConfig(action) {
  const definition = action && typeof action === "object" ? action : null;
  if (!definition) {
    return definition;
  }

  const assistantConfig = CONSOLE_BILLING_ASSISTANT_TOOL_CONFIG[definition.id];
  if (!assistantConfig) {
    return definition;
  }

  return {
    ...definition,
    channels: withAssistantToolChannel(definition.channels),
    assistantTool: {
      description: assistantConfig.description,
      inputJsonSchema: assistantConfig.inputJsonSchema
    }
  };
}

function resolveRealtimePublishConfig(actionId, { realtimeTopics, realtimeEventTypes }) {
  const normalizedActionId = String(actionId || "").trim();
  if (!normalizedActionId.startsWith("console.billing.")) {
    return null;
  }

  return {
    topic: String(realtimeTopics?.CONSOLE_BILLING || ""),
    eventType: String(realtimeEventTypes?.CONSOLE_BILLING_UPDATED || "")
  };
}

function createConsoleBillingActionContributor({
  consoleService,
  realtimeEventsService = null,
  realtimeTopics = null,
  realtimeEventTypes = null
} = {}) {
  const contributorId = "billing.console";

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
  requireServiceMethod(consoleService, "listEntitlementDefinitions", contributorId);
  requireServiceMethod(consoleService, "getEntitlementDefinition", contributorId);
  requireServiceMethod(consoleService, "createEntitlementDefinition", contributorId);
  requireServiceMethod(consoleService, "updateEntitlementDefinition", contributorId);
  requireServiceMethod(consoleService, "deleteEntitlementDefinition", contributorId);
  requireServiceMethod(consoleService, "archiveBillingPlan", contributorId);
  requireServiceMethod(consoleService, "unarchiveBillingPlan", contributorId);
  requireServiceMethod(consoleService, "deleteBillingPlan", contributorId);
  requireServiceMethod(consoleService, "archiveBillingProduct", contributorId);
  requireServiceMethod(consoleService, "unarchiveBillingProduct", contributorId);
  requireServiceMethod(consoleService, "deleteBillingProduct", contributorId);
  requireServiceMethod(consoleService, "listPurchasesForConsole", contributorId);
  requireServiceMethod(consoleService, "refundPurchaseForConsole", contributorId);
  requireServiceMethod(consoleService, "voidPurchaseForConsole", contributorId);
  requireServiceMethod(consoleService, "createPurchaseCorrectionForConsole", contributorId);
  requireServiceMethod(consoleService, "listPlanAssignmentsForConsole", contributorId);
  requireServiceMethod(consoleService, "createPlanAssignmentForConsole", contributorId);
  requireServiceMethod(consoleService, "updatePlanAssignmentForConsole", contributorId);
  requireServiceMethod(consoleService, "cancelPlanAssignmentForConsole", contributorId);
  requireServiceMethod(consoleService, "listSubscriptionsForConsole", contributorId);
  requireServiceMethod(consoleService, "changeSubscriptionPlanForConsole", contributorId);
  requireServiceMethod(consoleService, "cancelSubscriptionForConsole", contributorId);
  requireServiceMethod(consoleService, "cancelSubscriptionAtPeriodEndForConsole", contributorId);

  const actions = [
    {
      id: "console.billing.settings.read",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.settings.read"],
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
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.settings.update"],
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
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.events.list"],
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
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plans.list"],
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
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.products.list"],
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
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan.create"],
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
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.product.create"],
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
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.provider_prices.list"],
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
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan.update"],
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
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.product.update"],
      audit: {
        actionName: "console.billing.product.update"
      },
      observability: {},
      async execute(input, context) {
        const parsed = splitUpdateInput(input, "productId");
        return consoleService.updateBillingProduct(resolveUser(context, input), parsed.params, parsed.payload);
      }
    },
    {
      id: "console.billing.entitlement_definitions.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.entitlement_definitions.list"],
      audit: {
        actionName: "console.billing.entitlement_definitions.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listEntitlementDefinitions(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.billing.entitlement_definition.get",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.entitlement_definition.get"],
      audit: {
        actionName: "console.billing.entitlement_definition.get"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.getEntitlementDefinition(resolveUser(context, payload), {
          definitionId: resolveParamFromInput(payload, "definitionId")
        });
      }
    },
    {
      id: "console.billing.entitlement_definition.create",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.entitlement_definition.create"],
      audit: {
        actionName: "console.billing.entitlement_definition.create"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.createEntitlementDefinition(resolveUser(context, input), resolveBodyInput(input));
      }
    },
    {
      id: "console.billing.entitlement_definition.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.entitlement_definition.update"],
      audit: {
        actionName: "console.billing.entitlement_definition.update"
      },
      observability: {},
      async execute(input, context) {
        const parsed = splitUpdateInput(input, "definitionId");
        return consoleService.updateEntitlementDefinition(resolveUser(context, input), parsed.params, parsed.payload);
      }
    },
    {
      id: "console.billing.entitlement_definition.delete",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.entitlement_definition.delete"],
      audit: {
        actionName: "console.billing.entitlement_definition.delete"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.deleteEntitlementDefinition(
          resolveUser(context, payload),
          {
            definitionId: resolveParamFromInput(payload, "definitionId")
          },
          resolveBodyInput(payload)
        );
      }
    },
    {
      id: "console.billing.plan.archive",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan.archive"],
      audit: {
        actionName: "console.billing.plan.archive"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.archiveBillingPlan(
          resolveUser(context, payload),
          {
            planId: resolveParamFromInput(payload, "planId")
          },
          resolveBodyInput(payload)
        );
      }
    },
    {
      id: "console.billing.plan.unarchive",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan.unarchive"],
      audit: {
        actionName: "console.billing.plan.unarchive"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.unarchiveBillingPlan(
          resolveUser(context, payload),
          {
            planId: resolveParamFromInput(payload, "planId")
          },
          resolveBodyInput(payload)
        );
      }
    },
    {
      id: "console.billing.plan.delete",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan.delete"],
      audit: {
        actionName: "console.billing.plan.delete"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.deleteBillingPlan(
          resolveUser(context, payload),
          {
            planId: resolveParamFromInput(payload, "planId")
          },
          resolveBodyInput(payload)
        );
      }
    },
    {
      id: "console.billing.product.archive",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.product.archive"],
      audit: {
        actionName: "console.billing.product.archive"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.archiveBillingProduct(
          resolveUser(context, payload),
          {
            productId: resolveParamFromInput(payload, "productId")
          },
          resolveBodyInput(payload)
        );
      }
    },
    {
      id: "console.billing.product.unarchive",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.product.unarchive"],
      audit: {
        actionName: "console.billing.product.unarchive"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.unarchiveBillingProduct(
          resolveUser(context, payload),
          {
            productId: resolveParamFromInput(payload, "productId")
          },
          resolveBodyInput(payload)
        );
      }
    },
    {
      id: "console.billing.product.delete",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.product.delete"],
      audit: {
        actionName: "console.billing.product.delete"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.deleteBillingProduct(
          resolveUser(context, payload),
          {
            productId: resolveParamFromInput(payload, "productId")
          },
          resolveBodyInput(payload)
        );
      }
    },
    {
      id: "console.billing.purchases.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.purchases.list"],
      audit: {
        actionName: "console.billing.purchases.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listPurchasesForConsole(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.billing.purchase.refund",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.purchase.refund"],
      audit: {
        actionName: "console.billing.purchase.refund"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        const body = resolveBodyInput(payload);
        return consoleService.refundPurchaseForConsole(
          resolveUser(context, payload),
          {
            purchaseId: resolveParamFromInput(payload, "purchaseId")
          },
          {
            ...body,
            clientIdempotencyKey: resolveIdempotencyKey(context, payload)
          }
        );
      }
    },
    {
      id: "console.billing.purchase.void",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.purchase.void"],
      audit: {
        actionName: "console.billing.purchase.void"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        const body = resolveBodyInput(payload);
        return consoleService.voidPurchaseForConsole(
          resolveUser(context, payload),
          {
            purchaseId: resolveParamFromInput(payload, "purchaseId")
          },
          {
            ...body,
            clientIdempotencyKey: resolveIdempotencyKey(context, payload)
          }
        );
      }
    },
    {
      id: "console.billing.purchase.correction.create",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.purchase.correction.create"],
      audit: {
        actionName: "console.billing.purchase.correction.create"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        const body = resolveBodyInput(payload);
        return consoleService.createPurchaseCorrectionForConsole(
          resolveUser(context, payload),
          {
            purchaseId: resolveParamFromInput(payload, "purchaseId")
          },
          {
            ...body,
            clientIdempotencyKey: resolveIdempotencyKey(context, payload)
          }
        );
      }
    },
    {
      id: "console.billing.plan_assignments.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan_assignments.list"],
      audit: {
        actionName: "console.billing.plan_assignments.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listPlanAssignmentsForConsole(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.billing.plan_assignment.create",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan_assignment.create"],
      audit: {
        actionName: "console.billing.plan_assignment.create"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.createPlanAssignmentForConsole(resolveUser(context, input), resolveBodyInput(input));
      }
    },
    {
      id: "console.billing.plan_assignment.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan_assignment.update"],
      audit: {
        actionName: "console.billing.plan_assignment.update"
      },
      observability: {},
      async execute(input, context) {
        const parsed = splitUpdateInput(input, "assignmentId");
        return consoleService.updatePlanAssignmentForConsole(resolveUser(context, input), parsed.params, parsed.payload);
      }
    },
    {
      id: "console.billing.plan_assignment.cancel",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.plan_assignment.cancel"],
      audit: {
        actionName: "console.billing.plan_assignment.cancel"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.cancelPlanAssignmentForConsole(
          resolveUser(context, payload),
          {
            assignmentId: resolveParamFromInput(payload, "assignmentId")
          },
          resolveBodyInput(payload)
        );
      }
    },
    {
      id: "console.billing.subscriptions.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.subscriptions.list"],
      audit: {
        actionName: "console.billing.subscriptions.list"
      },
      observability: {},
      async execute(input, context) {
        return consoleService.listSubscriptionsForConsole(resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "console.billing.subscription.change_plan",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.subscription.change_plan"],
      audit: {
        actionName: "console.billing.subscription.change_plan"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.changeSubscriptionPlanForConsole(
          resolveUser(context, payload),
          {
            providerSubscriptionId: resolveParamFromInput(payload, "providerSubscriptionId")
          },
          resolveBodyInput(payload)
        );
      }
    },
    {
      id: "console.billing.subscription.cancel",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.subscription.cancel"],
      audit: {
        actionName: "console.billing.subscription.cancel"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.cancelSubscriptionForConsole(
          resolveUser(context, payload),
          {
            providerSubscriptionId: resolveParamFromInput(payload, "providerSubscriptionId")
          },
          resolveBodyInput(payload)
        );
      }
    },
    {
      id: "console.billing.subscription.cancel_at_period_end",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["console"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: [CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE],
      idempotency: CONSOLE_BILLING_ACTION_IDEMPOTENCY["console.billing.subscription.cancel_at_period_end"],
      audit: {
        actionName: "console.billing.subscription.cancel_at_period_end"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return consoleService.cancelSubscriptionAtPeriodEndForConsole(
          resolveUser(context, payload),
          {
            providerSubscriptionId: resolveParamFromInput(payload, "providerSubscriptionId")
          },
          resolveBodyInput(payload)
        );
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
    actions[index] = applyConsoleBillingAssistantToolConfig(actions[index]);
    actions[index] = applyRealtimePublishToCommandAction(actions[index], {
      realtimeEventsService,
      resolvePublishConfig(actionId) {
        return resolveRealtimePublishConfig(actionId, {
          realtimeTopics: resolvedRealtimeTopics,
          realtimeEventTypes: resolvedRealtimeEventTypes
        });
      },
      resolveActorUserId({ context, input }) {
        return toPositiveInteger(resolveUser(context, input)?.id);
      },
      resolveEntityType() {
        return "console";
      },
      resolveEntityId({ actionId }) {
        return String(actionId || "none");
      }
    });
  }

  return {
    contributorId,
    domain: "console",
    actions: Object.freeze(actions)
  };
}

export { createConsoleBillingActionContributor };
