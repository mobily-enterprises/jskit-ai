const CONSOLE_ROLE_ID = "console";
const DEVOP_ROLE_ID = "devop";
const MODERATOR_ROLE_ID = "moderator";
const CONSOLE_AI_TRANSCRIPTS_PERMISSIONS = Object.freeze({
  READ_ALL: "console.ai.transcripts.read_all",
  EXPORT_ALL: "console.ai.transcripts.export_all"
});
const CONSOLE_BILLING_PERMISSIONS = Object.freeze({
  READ_ALL: "console.billing.events.read_all",
  CATALOG_MANAGE: "console.billing.catalog.manage"
});
const CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS = Object.freeze({
  MANAGE: "console.assistant.settings.manage"
});

const CONSOLE_ROLE_DEFINITIONS = Object.freeze({
  [CONSOLE_ROLE_ID]: Object.freeze({
    assignable: false,
    permissions: Object.freeze(["*"])
  }),
  [DEVOP_ROLE_ID]: Object.freeze({
    assignable: true,
    permissions: Object.freeze([
      "console.errors.browser.read",
      "console.errors.server.read",
      CONSOLE_BILLING_PERMISSIONS.READ_ALL,
      CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE,
      CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS.MANAGE,
      CONSOLE_AI_TRANSCRIPTS_PERMISSIONS.READ_ALL,
      CONSOLE_AI_TRANSCRIPTS_PERMISSIONS.EXPORT_ALL
    ])
  }),
  [MODERATOR_ROLE_ID]: Object.freeze({
    assignable: true,
    permissions: Object.freeze(["console.content.moderate"])
  })
});

const CONSOLE_MANAGEMENT_PERMISSIONS = Object.freeze({
  MEMBERS_VIEW: "console.members.view",
  MEMBERS_INVITE: "console.members.invite",
  MEMBERS_MANAGE: "console.members.manage",
  INVITES_REVOKE: "console.invites.revoke",
  ROLES_VIEW: "console.roles.view"
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
  return Object.entries(CONSOLE_ROLE_DEFINITIONS).map(([roleId, role]) => ({
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

  const role = CONSOLE_ROLE_DEFINITIONS[normalizedRoleId];
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
  CONSOLE_ROLE_ID,
  DEVOP_ROLE_ID,
  MODERATOR_ROLE_ID,
  CONSOLE_AI_TRANSCRIPTS_PERMISSIONS,
  CONSOLE_BILLING_PERMISSIONS,
  CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS,
  CONSOLE_ROLE_DEFINITIONS,
  CONSOLE_MANAGEMENT_PERMISSIONS,
  normalizeRoleId,
  resolveRolePermissions,
  resolveAssignableRoleIds,
  hasPermission,
  getRoleCatalog
};
