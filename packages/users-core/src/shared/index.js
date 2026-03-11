import {
  OWNER_ROLE_ID,
  ADMIN_ROLE_ID,
  MEMBER_ROLE_ID,
  ROLE_CATALOG,
  ASSIGNABLE_ROLE_IDS,
  resolveRolePermissions,
  listRoleDescriptors,
  hasPermission
} from "./roles.js";

import {
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_USER_SETTINGS,
  coerceWorkspaceColor
} from "./settings.js";

const USERS_SHARED_API = Object.freeze({
  OWNER_ROLE_ID,
  ADMIN_ROLE_ID,
  MEMBER_ROLE_ID,
  ROLE_CATALOG,
  ASSIGNABLE_ROLE_IDS,
  resolveRolePermissions,
  listRoleDescriptors,
  hasPermission,
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_USER_SETTINGS,
  coerceWorkspaceColor
});

export {
  OWNER_ROLE_ID,
  ADMIN_ROLE_ID,
  MEMBER_ROLE_ID,
  ROLE_CATALOG,
  ASSIGNABLE_ROLE_IDS,
  resolveRolePermissions,
  listRoleDescriptors,
  hasPermission,
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_USER_SETTINGS,
  coerceWorkspaceColor,
  USERS_SHARED_API
};
