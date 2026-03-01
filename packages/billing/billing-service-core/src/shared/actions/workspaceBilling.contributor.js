import { hasPermission } from "@jskit-ai/action-runtime-core/actionContributorHelpers";
import { buildAssistantInputJsonSchema } from "./assistantInputSchema.js";

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeText(value) {
  return String(value || "").trim();
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

function resolveUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || context?.requestMeta?.request?.user || context?.actor || null;
}

function resolveWorkspace(context, input) {
  const payload = normalizeObject(input);
  return payload.workspace || context?.requestMeta?.request?.workspace || context?.workspace || null;
}

function resolveIdempotencyKey(context, input) {
  const payload = normalizeObject(input);
  return (
    normalizeText(payload.idempotencyKey) ||
    normalizeText(context?.requestMeta?.idempotencyKey) ||
    normalizeText(context?.requestMeta?.commandId)
  );
}

function resolveRequest(context, input) {
  const fromContext = context?.requestMeta?.request || null;
  if (fromContext) {
    return fromContext;
  }

  const payload = normalizeObject(input);
  const workspace = resolveWorkspace(context, payload);
  const workspaceSelector = normalizeText(workspace?.slug) || normalizeText(workspace?.id);
  const headers = normalizeObject(payload.headers);

  if (!headers["x-workspace-slug"] && workspaceSelector) {
    headers["x-workspace-slug"] = workspaceSelector;
  }

  return {
    headers,
    query: normalizeObject(payload.query),
    params: normalizeObject(payload.params),
    user: resolveUser(context, payload),
    workspace
  };
}

function requireAuthenticated(context) {
  return toPositiveInteger(context?.actor?.id) > 0;
}

function requireWorkspaceBillingManageOrSelf(context, input) {
  if (!requireAuthenticated(context)) {
    return false;
  }

  const workspace = resolveWorkspace(context, input);
  const workspaceSelected =
    toPositiveInteger(workspace?.id) > 0 || normalizeText(workspace?.slug).length > 0 || normalizeText(workspace?.name).length > 0;
  if (!workspaceSelected) {
    return true;
  }

  return hasPermission(context?.permissions, "workspace.billing.manage");
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

// Keep this explicit so contract drift is visible in code review.
const WORKSPACE_BILLING_ACTION_IDEMPOTENCY = Object.freeze({
  "workspace.billing.plan_state.get": "none",
  "workspace.billing.plans.list": "none",
  "workspace.billing.products.list": "none",
  "workspace.billing.purchases.list": "none",
  "workspace.billing.payment_methods.list": "none",
  "workspace.billing.payment_methods.sync": "optional",
  "workspace.billing.payment_methods.default.set": "required",
  "workspace.billing.payment_methods.detach": "required",
  "workspace.billing.payment_methods.remove": "required",
  "workspace.billing.limitations.get": "none",
  "workspace.billing.timeline.list": "none",
  "workspace.billing.checkout.start": "required",
  "workspace.billing.plan_change.request": "required",
  "workspace.billing.plan_change.cancel_pending": "optional",
  "workspace.billing.portal.create": "required",
  "workspace.billing.payment_link.create": "required"
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
        description: "Must be true to confirm this command."
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

const WORKSPACE_BILLING_ASSISTANT_TOOL_CONFIG = Object.freeze({
  "workspace.billing.payment_methods.default.set": Object.freeze({
    description: "Set one payment method as the default for the selected billable entity.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        paymentMethodId: { type: "string" }
      },
      required: ["paymentMethodId"]
    })
  }),
  "workspace.billing.payment_methods.detach": Object.freeze({
    description: "Detach an existing payment method from the selected billable entity.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        paymentMethodId: { type: "string" }
      },
      required: ["paymentMethodId"]
    })
  }),
  "workspace.billing.payment_methods.remove": Object.freeze({
    description: "Remove a payment method from local billing records after provider mutation.",
    inputJsonSchema: buildConfirmedCommandInputJsonSchema({
      properties: {
        paymentMethodId: { type: "string" }
      },
      required: ["paymentMethodId"]
    })
  })
});

function applyWorkspaceBillingAssistantToolConfig(action) {
  const definition = action && typeof action === "object" ? action : null;
  if (!definition) {
    return definition;
  }

  const assistantConfig = WORKSPACE_BILLING_ASSISTANT_TOOL_CONFIG[definition.id];
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

function createWorkspaceBillingActionContributor({ billingService } = {}) {
  const contributorId = "billing.workspace";

  requireServiceMethod(billingService, "getPlanState", contributorId);
  requireServiceMethod(billingService, "listPlans", contributorId);
  requireServiceMethod(billingService, "listProducts", contributorId);
  requireServiceMethod(billingService, "listPurchases", contributorId);
  requireServiceMethod(billingService, "listPaymentMethods", contributorId);
  requireServiceMethod(billingService, "syncPaymentMethods", contributorId);
  requireServiceMethod(billingService, "setDefaultPaymentMethod", contributorId);
  requireServiceMethod(billingService, "detachPaymentMethod", contributorId);
  requireServiceMethod(billingService, "removePaymentMethod", contributorId);
  requireServiceMethod(billingService, "getLimitations", contributorId);
  requireServiceMethod(billingService, "listTimeline", contributorId);
  requireServiceMethod(billingService, "startCheckout", contributorId);
  requireServiceMethod(billingService, "requestPlanChange", contributorId);
  requireServiceMethod(billingService, "cancelPendingPlanChange", contributorId);
  requireServiceMethod(billingService, "createPortalSession", contributorId);
  requireServiceMethod(billingService, "createPaymentLink", contributorId);

  const actions = [
    {
      id: "workspace.billing.plan_state.get",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.plan_state.get"],
      audit: {
        actionName: "workspace.billing.plan_state.get"
      },
      observability: {},
      async execute(input, context) {
        return billingService.getPlanState({
          request: resolveRequest(context, input),
          user: resolveUser(context, input)
        });
      }
    },
    {
      id: "workspace.billing.plans.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.plans.list"],
      audit: {
        actionName: "workspace.billing.plans.list"
      },
      observability: {},
      async execute(input, context) {
        return billingService.listPlans({
          request: resolveRequest(context, input),
          user: resolveUser(context, input)
        });
      }
    },
    {
      id: "workspace.billing.products.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.products.list"],
      audit: {
        actionName: "workspace.billing.products.list"
      },
      observability: {},
      async execute(input, context) {
        return billingService.listProducts({
          request: resolveRequest(context, input),
          user: resolveUser(context, input)
        });
      }
    },
    {
      id: "workspace.billing.purchases.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.purchases.list"],
      audit: {
        actionName: "workspace.billing.purchases.list"
      },
      observability: {},
      async execute(input, context) {
        return billingService.listPurchases({
          request: resolveRequest(context, input),
          user: resolveUser(context, input)
        });
      }
    },
    {
      id: "workspace.billing.payment_methods.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.payment_methods.list"],
      audit: {
        actionName: "workspace.billing.payment_methods.list"
      },
      observability: {},
      async execute(input, context) {
        return billingService.listPaymentMethods({
          request: resolveRequest(context, input),
          user: resolveUser(context, input)
        });
      }
    },
    {
      id: "workspace.billing.payment_methods.sync",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.payment_methods.sync"],
      audit: {
        actionName: "workspace.billing.payment_methods.sync"
      },
      observability: {},
      async execute(input, context) {
        return billingService.syncPaymentMethods({
          request: resolveRequest(context, input),
          user: resolveUser(context, input)
        });
      }
    },
    {
      id: "workspace.billing.payment_methods.default.set",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.payment_methods.default.set"],
      audit: {
        actionName: "workspace.billing.payment_methods.default.set"
      },
      observability: {},
      async execute(input, context) {
        return billingService.setDefaultPaymentMethod({
          request: resolveRequest(context, input),
          user: resolveUser(context, input),
          paymentMethodId: resolveParamFromInput(input, "paymentMethodId"),
          payload: resolveBodyInput(input),
          clientIdempotencyKey: resolveIdempotencyKey(context, input)
        });
      }
    },
    {
      id: "workspace.billing.payment_methods.detach",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.payment_methods.detach"],
      audit: {
        actionName: "workspace.billing.payment_methods.detach"
      },
      observability: {},
      async execute(input, context) {
        return billingService.detachPaymentMethod({
          request: resolveRequest(context, input),
          user: resolveUser(context, input),
          paymentMethodId: resolveParamFromInput(input, "paymentMethodId"),
          payload: resolveBodyInput(input),
          clientIdempotencyKey: resolveIdempotencyKey(context, input)
        });
      }
    },
    {
      id: "workspace.billing.payment_methods.remove",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.payment_methods.remove"],
      audit: {
        actionName: "workspace.billing.payment_methods.remove"
      },
      observability: {},
      async execute(input, context) {
        return billingService.removePaymentMethod({
          request: resolveRequest(context, input),
          user: resolveUser(context, input),
          paymentMethodId: resolveParamFromInput(input, "paymentMethodId"),
          payload: resolveBodyInput(input),
          clientIdempotencyKey: resolveIdempotencyKey(context, input)
        });
      }
    },
    {
      id: "workspace.billing.limitations.get",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.limitations.get"],
      audit: {
        actionName: "workspace.billing.limitations.get"
      },
      observability: {},
      async execute(input, context) {
        return billingService.getLimitations({
          request: resolveRequest(context, input),
          user: resolveUser(context, input)
        });
      }
    },
    {
      id: "workspace.billing.timeline.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.timeline.list"],
      audit: {
        actionName: "workspace.billing.timeline.list"
      },
      observability: {},
      async execute(input, context) {
        return billingService.listTimeline({
          request: resolveRequest(context, input),
          user: resolveUser(context, input),
          query: normalizeObject(input)
        });
      }
    },
    {
      id: "workspace.billing.checkout.start",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.checkout.start"],
      audit: {
        actionName: "workspace.billing.checkout.start"
      },
      observability: {},
      async execute(input, context) {
        return billingService.startCheckout({
          request: resolveRequest(context, input),
          user: resolveUser(context, input),
          payload: normalizeObject(input),
          clientIdempotencyKey: resolveIdempotencyKey(context, input)
        });
      }
    },
    {
      id: "workspace.billing.plan_change.request",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.plan_change.request"],
      audit: {
        actionName: "workspace.billing.plan_change.request"
      },
      observability: {},
      async execute(input, context) {
        return billingService.requestPlanChange({
          request: resolveRequest(context, input),
          user: resolveUser(context, input),
          payload: normalizeObject(input),
          clientIdempotencyKey: resolveIdempotencyKey(context, input)
        });
      }
    },
    {
      id: "workspace.billing.plan_change.cancel_pending",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.plan_change.cancel_pending"],
      audit: {
        actionName: "workspace.billing.plan_change.cancel_pending"
      },
      observability: {},
      async execute(input, context) {
        return billingService.cancelPendingPlanChange({
          request: resolveRequest(context, input),
          user: resolveUser(context, input)
        });
      }
    },
    {
      id: "workspace.billing.portal.create",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.portal.create"],
      audit: {
        actionName: "workspace.billing.portal.create"
      },
      observability: {},
      async execute(input, context) {
        return billingService.createPortalSession({
          request: resolveRequest(context, input),
          user: resolveUser(context, input),
          payload: normalizeObject(input),
          clientIdempotencyKey: resolveIdempotencyKey(context, input)
        });
      }
    },
    {
      id: "workspace.billing.payment_link.create",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceBillingManageOrSelf,
      idempotency: WORKSPACE_BILLING_ACTION_IDEMPOTENCY["workspace.billing.payment_link.create"],
      audit: {
        actionName: "workspace.billing.payment_link.create"
      },
      observability: {},
      async execute(input, context) {
        return billingService.createPaymentLink({
          request: resolveRequest(context, input),
          user: resolveUser(context, input),
          payload: normalizeObject(input),
          clientIdempotencyKey: resolveIdempotencyKey(context, input)
        });
      }
    }
  ];

  for (let index = 0; index < actions.length; index += 1) {
    actions[index] = applyWorkspaceBillingAssistantToolConfig(actions[index]);
  }

  return {
    contributorId,
    domain: "billing",
    actions: Object.freeze(actions)
  };
}

export { createWorkspaceBillingActionContributor };
