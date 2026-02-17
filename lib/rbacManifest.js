import fs from "node:fs/promises";

const OWNER_ROLE_ID = "owner";

function toUniqueStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function buildOwnerRole() {
  return {
    assignable: false,
    permissions: ["*"]
  };
}

function createOwnerOnlyManifest() {
  return {
    version: 1,
    defaultInviteRole: null,
    roles: {
      [OWNER_ROLE_ID]: buildOwnerRole()
    },
    collaborationEnabled: false,
    assignableRoleIds: []
  };
}

function assertValidOwnerRole(role) {
  if (!role || typeof role !== "object") {
    throw new Error('RBAC manifest must define roles.owner.');
  }
  if (role.assignable !== false) {
    throw new Error('RBAC manifest roles.owner must be non-assignable.');
  }

  const permissions = toUniqueStringArray(role.permissions);
  if (!permissions.includes("*")) {
    throw new Error('RBAC manifest roles.owner.permissions must include "*".');
  }
}

function normalizeRole(role) {
  const roleObject = role && typeof role === "object" ? role : {};
  return {
    assignable: Boolean(roleObject.assignable),
    permissions: toUniqueStringArray(roleObject.permissions)
  };
}

function normalizeManifest(rawManifest) {
  const manifest = rawManifest && typeof rawManifest === "object" ? rawManifest : null;
  if (!manifest) {
    throw new Error("RBAC manifest must be a JSON object.");
  }

  const rawRoles = manifest.roles && typeof manifest.roles === "object" ? manifest.roles : {};
  const normalizedRoles = {};
  for (const [roleId, roleValue] of Object.entries(rawRoles)) {
    const normalizedRoleId = String(roleId || "").trim();
    if (!normalizedRoleId) {
      continue;
    }
    normalizedRoles[normalizedRoleId] = normalizeRole(roleValue);
  }

  if (!normalizedRoles[OWNER_ROLE_ID]) {
    normalizedRoles[OWNER_ROLE_ID] = buildOwnerRole();
  }

  assertValidOwnerRole(normalizedRoles[OWNER_ROLE_ID]);

  const assignableRoleIds = Object.entries(normalizedRoles)
    .filter(([roleId, role]) => roleId !== OWNER_ROLE_ID && role.assignable)
    .map(([roleId]) => roleId);

  const defaultInviteRole = String(manifest.defaultInviteRole || "").trim() || null;
  const canUseDefaultInviteRole = Boolean(defaultInviteRole && normalizedRoles[defaultInviteRole]?.assignable);
  const collaborationEnabled = assignableRoleIds.length > 0 && canUseDefaultInviteRole;

  return {
    version: Number.isInteger(Number(manifest.version)) ? Number(manifest.version) : 1,
    defaultInviteRole: canUseDefaultInviteRole ? defaultInviteRole : null,
    roles: normalizedRoles,
    collaborationEnabled,
    assignableRoleIds
  };
}

async function loadRbacManifest(manifestPath) {
  let rawText;
  try {
    rawText = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read RBAC manifest at "${manifestPath}": ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`RBAC manifest at "${manifestPath}" is not valid JSON: ${error.message}`);
  }

  return normalizeManifest(parsed);
}

function resolveRolePermissions(manifest, roleId) {
  const normalizedRoleId = String(roleId || "").trim().toLowerCase();
  if (normalizedRoleId === OWNER_ROLE_ID) {
    return ["*"];
  }

  const role = manifest?.roles?.[normalizedRoleId];
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

  if (!Array.isArray(permissionSet)) {
    return false;
  }
  return permissionSet.includes("*") || permissionSet.includes(required);
}

export { OWNER_ROLE_ID, createOwnerOnlyManifest, loadRbacManifest, normalizeManifest, resolveRolePermissions, hasPermission };
