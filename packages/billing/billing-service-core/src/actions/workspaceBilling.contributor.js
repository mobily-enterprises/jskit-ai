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

function hasPermission(permissionSet, permission) {
  const requiredPermission = normalizeText(permission);
  if (!requiredPermission) {
    return true;
  }

  const permissions = Array.isArray(permissionSet) ? permissionSet : [];
  return permissions.includes("*") || permissions.includes(requiredPermission);
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

function createWorkspaceBillingActionContributor({ billingService } = {}) {
  const contributorId = "billing.workspace";

  requireServiceMethod(billingService, "getPlanState", contributorId);
  requireServiceMethod(billingService, "listPlans", contributorId);
  requireServiceMethod(billingService, "listProducts", contributorId);
  requireServiceMethod(billingService, "listPurchases", contributorId);
  requireServiceMethod(billingService, "listPaymentMethods", contributorId);
  requireServiceMethod(billingService, "syncPaymentMethods", contributorId);
  requireServiceMethod(billingService, "getLimitations", contributorId);
  requireServiceMethod(billingService, "listTimeline", contributorId);
  requireServiceMethod(billingService, "startCheckout", contributorId);
  requireServiceMethod(billingService, "requestPlanChange", contributorId);
  requireServiceMethod(billingService, "cancelPendingPlanChange", contributorId);
  requireServiceMethod(billingService, "createPortalSession", contributorId);
  requireServiceMethod(billingService, "createPaymentLink", contributorId);

  return {
    contributorId,
    domain: "billing",
    actions: Object.freeze([
      {
        id: "workspace.billing.plan_state.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireWorkspaceBillingManageOrSelf,
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "optional",
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
        id: "workspace.billing.limitations.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireWorkspaceBillingManageOrSelf,
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "required",
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
        idempotency: "required",
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
        idempotency: "optional",
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
        idempotency: "required",
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
        idempotency: "required",
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
    ])
  };
}

export { createWorkspaceBillingActionContributor };
