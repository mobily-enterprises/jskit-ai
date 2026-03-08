const OWNER_ROLE_ID = "owner";
const ADMIN_ROLE_ID = "admin";
const MEMBER_ROLE_ID = "member";

const ROLE_CATALOG = Object.freeze([
  Object.freeze({
    id: OWNER_ROLE_ID,
    assignable: false,
    permissions: ["*"]
  }),
  Object.freeze({
    id: ADMIN_ROLE_ID,
    assignable: true,
    permissions: [
      "workspace.roles.view",
      "workspace.settings.view",
      "workspace.settings.update",
      "workspace.members.view",
      "workspace.members.invite",
      "workspace.members.manage",
      "workspace.invites.revoke"
    ]
  }),
  Object.freeze({
    id: MEMBER_ROLE_ID,
    assignable: true,
    permissions: [
      "workspace.settings.view"
    ]
  })
]);

const ROLE_BY_ID = Object.freeze(
  ROLE_CATALOG.reduce((accumulator, role) => {
    accumulator[role.id] = role;
    return accumulator;
  }, {})
);

function resolveRolePermissions(roleId) {
  const normalized = String(roleId || "").trim().toLowerCase();
  const role = ROLE_BY_ID[normalized] || null;
  if (!role) {
    return [];
  }
  return [...role.permissions];
}

function listRoleDescriptors() {
  return ROLE_CATALOG.map((role) => ({
    id: role.id,
    assignable: role.assignable,
    permissions: [...role.permissions]
  }));
}

function resolveAssignableRoleIds() {
  return ROLE_CATALOG.filter((role) => role.assignable).map((role) => role.id);
}

function hasPermission(permissions = [], permission = "") {
  const required = String(permission || "").trim();
  if (!required) {
    return true;
  }

  const source = Array.isArray(permissions) ? permissions : [];
  return source.includes("*") || source.includes(required);
}

export {
  OWNER_ROLE_ID,
  ADMIN_ROLE_ID,
  MEMBER_ROLE_ID,
  ROLE_CATALOG,
  resolveRolePermissions,
  listRoleDescriptors,
  resolveAssignableRoleIds,
  hasPermission
};
