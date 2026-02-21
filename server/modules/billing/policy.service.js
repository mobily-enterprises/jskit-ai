import { AppError } from "../../lib/errors.js";

const BILLING_MANAGE_PERMISSION = "workspace.billing.manage";
const BILLABLE_ENTITY_ID_HEADER = "x-billable-entity-id";
const BILLABLE_ENTITY_TYPE_WORKSPACE = "workspace";
const BILLABLE_ENTITY_TYPE_USER = "user";
const BILLABLE_ENTITY_TYPE_ORGANIZATION = "organization";
const BILLABLE_ENTITY_TYPE_EXTERNAL = "external";
const BILLABLE_ENTITY_TYPE_SET = new Set([
  BILLABLE_ENTITY_TYPE_WORKSPACE,
  BILLABLE_ENTITY_TYPE_USER,
  BILLABLE_ENTITY_TYPE_ORGANIZATION,
  BILLABLE_ENTITY_TYPE_EXTERNAL
]);

function normalizeWorkspaceSelector(request) {
  const fromHeader = String(request?.headers?.["x-workspace-slug"] || "").trim();
  if (fromHeader) {
    return fromHeader;
  }

  const fromParams = String(request?.params?.workspaceSlug || "").trim();
  if (fromParams) {
    return fromParams;
  }

  const fromQuery = String(request?.query?.workspaceSlug || "").trim();
  if (fromQuery) {
    return fromQuery;
  }

  return "";
}

function normalizeBillableEntitySelector(request) {
  const fromHeader = String(request?.headers?.[BILLABLE_ENTITY_ID_HEADER] || "").trim();
  if (fromHeader) {
    return fromHeader;
  }

  const fromParams = String(request?.params?.billableEntityId || "").trim();
  if (fromParams) {
    return fromParams;
  }

  const fromQuery = String(request?.query?.billableEntityId || "").trim();
  if (fromQuery) {
    return fromQuery;
  }

  return "";
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function normalizeBillableEntityType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return BILLABLE_ENTITY_TYPE_SET.has(normalized) ? normalized : BILLABLE_ENTITY_TYPE_WORKSPACE;
}

function hasPermission(permissionSet, permission) {
  const list = Array.isArray(permissionSet) ? permissionSet : [];
  const required = String(permission || "").trim();
  if (!required) {
    return true;
  }

  return list.includes("*") || list.includes(required);
}

function mapWorkspaceSelection(workspace) {
  return {
    id: Number(workspace.id),
    slug: String(workspace.slug || ""),
    name: String(workspace.name || ""),
    ownerUserId: Number(workspace.ownerUserId),
    roleId: String(workspace.roleId || "")
  };
}

function createService({ workspacesRepository, billingRepository, resolvePermissions }) {
  if (!workspacesRepository || typeof workspacesRepository.listByUserId !== "function") {
    throw new Error("workspacesRepository.listByUserId is required.");
  }
  if (!billingRepository || typeof billingRepository.ensureBillableEntity !== "function") {
    throw new Error("billingRepository.ensureBillableEntity is required.");
  }
  if (typeof billingRepository.findBillableEntityById !== "function") {
    throw new Error("billingRepository.findBillableEntityById is required.");
  }

  const resolveRolePermissions =
    typeof resolvePermissions === "function" ? resolvePermissions : () => [];

  async function listAccessibleWorkspacesForUser(user) {
    const userId = Number(user?.id);
    if (!Number.isInteger(userId) || userId < 1) {
      throw new AppError(401, "Authentication required.");
    }

    const workspaces = await workspacesRepository.listByUserId(userId);
    if (!Array.isArray(workspaces)) {
      return [];
    }

    return workspaces
      .filter((workspace) => {
        const workspaceId = Number(workspace?.id);
        return Number.isInteger(workspaceId) && workspaceId > 0;
      })
      .map(mapWorkspaceSelection);
  }

  function pickWorkspaceFromSelector({ workspaces, selector }) {
    const normalizedSelector = String(selector || "").trim();
    if (!normalizedSelector) {
      return null;
    }

    return (
      workspaces.find((workspace) => String(workspace.slug || "") === normalizedSelector) ||
      workspaces.find((workspace) => String(workspace.id) === normalizedSelector) ||
      null
    );
  }

  async function resolveWorkspaceSelection({ request, user, strictSelector }) {
    const workspaces = await listAccessibleWorkspacesForUser(user);
    const selector = normalizeWorkspaceSelector(request);
    if (selector) {
      const selected = pickWorkspaceFromSelector({ workspaces, selector });
      if (!selected) {
        throw new AppError(403, "Forbidden.", {
          code: "BILLING_WORKSPACE_FORBIDDEN"
        });
      }
      return selected;
    }

    if (strictSelector && workspaces.length > 1) {
      throw new AppError(409, "Workspace selection required.", {
        code: "BILLING_WORKSPACE_SELECTION_REQUIRED"
      });
    }

    if (workspaces.length === 1) {
      return workspaces[0];
    }

    if (workspaces.length < 1) {
      throw new AppError(403, "Forbidden.", {
        code: "BILLING_WORKSPACE_FORBIDDEN"
      });
    }

    throw new AppError(409, "Workspace selection required.", {
      code: "BILLING_WORKSPACE_SELECTION_REQUIRED"
    });
  }

  async function ensureBillableEntityForWorkspace(workspace) {
    const workspaceId = Number(workspace?.id);
    const ownerUserId = Number(workspace?.ownerUserId);
    if (!Number.isInteger(workspaceId) || workspaceId < 1) {
      throw new AppError(500, "Billing workspace resolution failed.");
    }
    if (!Number.isInteger(ownerUserId) || ownerUserId < 1) {
      throw new AppError(500, "Billing workspace owner resolution failed.");
    }

    if (typeof billingRepository.ensureBillableEntityByScope === "function") {
      return billingRepository.ensureBillableEntityByScope({
        entityType: BILLABLE_ENTITY_TYPE_WORKSPACE,
        workspaceId,
        ownerUserId
      });
    }

    return billingRepository.ensureBillableEntity({ workspaceId, ownerUserId });
  }

  function ensureUserScopedEntityAccess(user, billableEntity) {
    const userId = parsePositiveInteger(user?.id);
    const ownerUserId = parsePositiveInteger(billableEntity?.ownerUserId);
    if (!userId || !ownerUserId || userId !== ownerUserId) {
      throw new AppError(403, "Forbidden.", {
        code: "BILLING_ENTITY_FORBIDDEN"
      });
    }
  }

  async function resolveBillableEntityFromSelector({ request, user, forWrite }) {
    const selector = normalizeBillableEntitySelector(request);
    const billableEntityId = parsePositiveInteger(selector);
    if (!billableEntityId) {
      return null;
    }

    const billableEntity = await billingRepository.findBillableEntityById(billableEntityId);
    if (!billableEntity) {
      throw new AppError(403, "Forbidden.", {
        code: "BILLING_ENTITY_FORBIDDEN"
      });
    }

    const entityType = normalizeBillableEntityType(billableEntity.entityType);
    if (entityType === BILLABLE_ENTITY_TYPE_WORKSPACE) {
      const workspaces = await listAccessibleWorkspacesForUser(user);
      const workspace = workspaces.find((candidate) => Number(candidate.id) === Number(billableEntity.workspaceId)) || null;
      if (!workspace) {
        throw new AppError(403, "Forbidden.", {
          code: "BILLING_ENTITY_FORBIDDEN"
        });
      }

      const permissions = forWrite ? assertBillingWritePermission(workspace) : resolveRolePermissions(workspace.roleId);
      return {
        workspace,
        billableEntity,
        permissions
      };
    }

    if (entityType === BILLABLE_ENTITY_TYPE_USER) {
      ensureUserScopedEntityAccess(user, billableEntity);
      return {
        workspace: null,
        billableEntity,
        permissions: []
      };
    }

    throw new AppError(403, "Forbidden.", {
      code: "BILLING_ENTITY_FORBIDDEN"
    });
  }

  function assertBillingWritePermission(workspace) {
    const roleId = String(workspace?.roleId || "").trim();
    if (!roleId) {
      throw new AppError(403, "Forbidden.");
    }

    const permissions = resolveRolePermissions(roleId);
    if (!hasPermission(permissions, BILLING_MANAGE_PERMISSION)) {
      throw new AppError(403, "Forbidden.", {
        code: "BILLING_PERMISSION_REQUIRED"
      });
    }

    return permissions;
  }

  async function resolveBillableEntityForReadRequest(requestContext = {}) {
    const request = requestContext.request || requestContext;
    const user = requestContext.user || request?.user;
    const selectedBillableEntity = await resolveBillableEntityFromSelector({
      request,
      user,
      forWrite: false
    });
    if (selectedBillableEntity) {
      return selectedBillableEntity;
    }

    const workspace = await resolveWorkspaceSelection({
      request,
      user,
      strictSelector: false
    });
    const billableEntity = await ensureBillableEntityForWorkspace(workspace);

    return {
      workspace,
      billableEntity,
      permissions: resolveRolePermissions(workspace.roleId)
    };
  }

  async function resolveBillableEntityForWriteRequest(requestContext = {}) {
    const request = requestContext.request || requestContext;
    const user = requestContext.user || request?.user;
    const selectedBillableEntity = await resolveBillableEntityFromSelector({
      request,
      user,
      forWrite: true
    });
    if (selectedBillableEntity) {
      return selectedBillableEntity;
    }

    const workspace = await resolveWorkspaceSelection({
      request,
      user,
      strictSelector: true
    });

    const permissions = assertBillingWritePermission(workspace);
    const billableEntity = await ensureBillableEntityForWorkspace(workspace);

    return {
      workspace,
      billableEntity,
      permissions
    };
  }

  return {
    resolveBillableEntityForReadRequest,
    resolveBillableEntityForWriteRequest,
    listAccessibleWorkspacesForUser
  };
}

const __testables = {
  normalizeWorkspaceSelector,
  normalizeBillableEntitySelector,
  normalizeBillableEntityType,
  parsePositiveInteger,
  hasPermission,
  mapWorkspaceSelection
};

export { BILLING_MANAGE_PERMISSION, createService, __testables };
