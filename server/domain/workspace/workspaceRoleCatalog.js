import { OWNER_ROLE_ID } from "../../lib/rbacManifest.js";

function toRoleDescriptor(roleId, role) {
  const normalizedRole = role && typeof role === "object" ? role : {};
  const permissions = Array.isArray(normalizedRole.permissions)
    ? Array.from(
        new Set(normalizedRole.permissions.map((permission) => String(permission || "").trim()).filter(Boolean))
      )
    : [];

  return {
    id: String(roleId || ""),
    assignable: Boolean(normalizedRole.assignable),
    permissions
  };
}

function listRoleDescriptors(rbacManifest) {
  const roles = rbacManifest && typeof rbacManifest.roles === "object" ? rbacManifest.roles : {};

  return Object.entries(roles)
    .map(([roleId, role]) => toRoleDescriptor(roleId, role))
    .filter((role) => role.id)
    .sort((left, right) => {
      if (left.id === OWNER_ROLE_ID) {
        return -1;
      }
      if (right.id === OWNER_ROLE_ID) {
        return 1;
      }

      return left.id.localeCompare(right.id);
    });
}

function resolveAssignableRoleIds(rbacManifest) {
  return listRoleDescriptors(rbacManifest)
    .filter((role) => role.id !== OWNER_ROLE_ID && role.assignable)
    .map((role) => role.id);
}

export { toRoleDescriptor, listRoleDescriptors, resolveAssignableRoleIds };
