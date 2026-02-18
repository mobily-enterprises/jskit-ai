const GOD_ROLE_ID = "god";
const DEVOP_ROLE_ID = "devop";
const MODERATOR_ROLE_ID = "moderator";

const GOD_ROLE_DEFINITIONS = Object.freeze({
  [GOD_ROLE_ID]: Object.freeze({
    assignable: false,
    permissions: Object.freeze(["*"])
  }),
  [DEVOP_ROLE_ID]: Object.freeze({
    assignable: true,
    permissions: Object.freeze(["god.errors.browser.read", "god.errors.server.read"])
  }),
  [MODERATOR_ROLE_ID]: Object.freeze({
    assignable: true,
    permissions: Object.freeze(["god.content.moderate"])
  })
});

const GOD_MANAGEMENT_PERMISSIONS = Object.freeze({
  MEMBERS_VIEW: "god.members.view",
  MEMBERS_INVITE: "god.members.invite",
  MEMBERS_MANAGE: "god.members.manage",
  INVITES_REVOKE: "god.invites.revoke",
  ROLES_VIEW: "god.roles.view"
});

function toUniqueStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function normalizeRoleId(roleId) {
  return String(roleId || "")
    .trim()
    .toLowerCase();
}

function listRoleDescriptors() {
  return Object.entries(GOD_ROLE_DEFINITIONS).map(([roleId, role]) => ({
    id: roleId,
    assignable: role.assignable === true,
    permissions: toUniqueStringArray(role.permissions)
  }));
}

function resolveAssignableRoleIds() {
  return listRoleDescriptors()
    .filter((role) => role.assignable)
    .map((role) => role.id);
}

function resolveRolePermissions(roleId) {
  const normalizedRoleId = normalizeRoleId(roleId);
  if (!normalizedRoleId) {
    return [];
  }

  const role = GOD_ROLE_DEFINITIONS[normalizedRoleId];
  if (!role) {
    return [];
  }

  return toUniqueStringArray(role.permissions);
}

function hasPermission(permissionSet, permission) {
  const required = String(permission || "").trim();
  if (!required) {
    return true;
  }

  const permissions = toUniqueStringArray(permissionSet);
  return permissions.includes("*") || permissions.includes(required);
}

function getRoleCatalog() {
  return {
    defaultInviteRole: MODERATOR_ROLE_ID,
    roles: listRoleDescriptors(),
    assignableRoleIds: resolveAssignableRoleIds()
  };
}

export {
  GOD_ROLE_ID,
  DEVOP_ROLE_ID,
  MODERATOR_ROLE_ID,
  GOD_ROLE_DEFINITIONS,
  GOD_MANAGEMENT_PERMISSIONS,
  normalizeRoleId,
  resolveRolePermissions,
  resolveAssignableRoleIds,
  hasPermission,
  getRoleCatalog
};
