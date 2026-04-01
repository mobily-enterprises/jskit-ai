import {
  hasPermission,
  normalizePermissionList
} from "@jskit-ai/kernel/shared/support";

const OWNER_ROLE_ID = "owner";
const ADMIN_ROLE_ID = "admin";
const MEMBER_ROLE_ID = "member";

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeRoleId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function createRoleDescriptor(roleSid, configuredDefinition) {
  const source = asRecord(configuredDefinition);
  const assignable = roleSid === OWNER_ROLE_ID ? false : source.assignable === true;
  const permissions = normalizePermissionList(source.permissions);

  return Object.freeze({
    id: roleSid,
    assignable,
    permissions: Object.freeze([...permissions])
  });
}

function listConfiguredRoleIds(appConfig = {}) {
  const configuredRoles = normalizeConfiguredRoles(appConfig);
  return Object.freeze(Object.keys(configuredRoles));
}

function resolveConfiguredDefaultInviteRole(appConfig = {}) {
  return normalizeRoleId(appConfig?.workspaceRoles?.defaultInviteRole);
}

function normalizeConfiguredRoles(appConfig = {}) {
  const workspaceRoles = asRecord(appConfig?.workspaceRoles);
  const configuredRoles = asRecord(workspaceRoles.roles);
  const normalizedRoles = {};

  for (const [roleSid, roleDefinition] of Object.entries(configuredRoles)) {
    const normalizedRoleId = normalizeRoleId(roleSid);
    if (!normalizedRoleId) {
      continue;
    }
    normalizedRoles[normalizedRoleId] = roleDefinition;
  }

  return normalizedRoles;
}

function createWorkspaceRoleCatalog(appConfig = {}) {
  const configuredRoles = normalizeConfiguredRoles(appConfig);
  const roleIds = listConfiguredRoleIds(appConfig);
  const roles = roleIds.map((roleSid) => createRoleDescriptor(roleSid, configuredRoles[roleSid]));
  const assignableRoleIds = roles.filter((role) => role.assignable).map((role) => role.id);
  const configuredDefaultInviteRole = resolveConfiguredDefaultInviteRole(appConfig);
  const defaultInviteRole = assignableRoleIds.includes(configuredDefaultInviteRole)
    ? configuredDefaultInviteRole
    : assignableRoleIds[0] || "";

  return Object.freeze({
    collaborationEnabled: assignableRoleIds.length > 0 && Boolean(defaultInviteRole),
    defaultInviteRole,
    roles: Object.freeze(
      roles.map((role) =>
        Object.freeze({
          id: role.id,
          assignable: role.assignable,
          permissions: Object.freeze([...role.permissions])
        })
      )
    ),
    assignableRoleIds: Object.freeze([...assignableRoleIds])
  });
}

function cloneWorkspaceRoleCatalog(roleCatalog = null) {
  const source = asRecord(roleCatalog);

  return {
    collaborationEnabled: source.collaborationEnabled === true,
    defaultInviteRole: String(source.defaultInviteRole || ""),
    roles: Array.isArray(source.roles)
      ? source.roles.map((role) => ({
          id: normalizeRoleId(role?.id),
          assignable: role?.assignable === true,
          permissions: Array.isArray(role?.permissions) ? [...role.permissions] : []
        }))
      : [],
    assignableRoleIds: Array.isArray(source.assignableRoleIds) ? [...source.assignableRoleIds] : []
  };
}

function listRoleDescriptors(appConfig = {}) {
  const roleCatalog = createWorkspaceRoleCatalog(appConfig);
  return roleCatalog.roles.map((role) => ({
    id: role.id,
    assignable: role.assignable,
    permissions: [...role.permissions]
  }));
}

function resolveRolePermissions(roleSid, appConfig = {}) {
  const normalizedRoleId = normalizeRoleId(roleSid);
  if (!normalizedRoleId) {
    return [];
  }

  const roleCatalog = createWorkspaceRoleCatalog(appConfig);
  const role = roleCatalog.roles.find((entry) => entry.id === normalizedRoleId);
  if (!role) {
    return [];
  }

  return [...role.permissions];
}

export {
  OWNER_ROLE_ID,
  ADMIN_ROLE_ID,
  MEMBER_ROLE_ID,
  resolveRolePermissions,
  listRoleDescriptors,
  createWorkspaceRoleCatalog,
  cloneWorkspaceRoleCatalog,
  hasPermission
};
