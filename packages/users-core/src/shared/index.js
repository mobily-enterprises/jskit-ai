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
import { WORKSPACE_SETTINGS_CHANGED_EVENT } from "./events/workspaceEvents.js";

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
  coerceWorkspaceColor,
  WORKSPACE_SETTINGS_CHANGED_EVENT
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
  WORKSPACE_SETTINGS_CHANGED_EVENT,
  USERS_SHARED_API
};
