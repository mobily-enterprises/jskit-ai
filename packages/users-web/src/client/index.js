import { UsersWebClientProvider } from "./providers/UsersWebClientProvider.js";

export {
  UsersWebClientProvider,
  USERS_WEB_WORKSPACE_SELECTOR_TOKEN,
  USERS_WEB_WORKSPACE_TOOLS_WIDGET_TOKEN,
  USERS_WEB_SHELL_MENU_LINK_ITEM_TOKEN,
  USERS_WEB_SURFACE_AWARE_MENU_LINK_ITEM_TOKEN,
  USERS_WEB_WORKSPACE_SETTINGS_MENU_ITEM_TOKEN,
  USERS_WEB_WORKSPACE_MEMBERS_MENU_ITEM_TOKEN,
  USERS_WEB_PROFILE_ELEMENT_TOKEN,
  USERS_WEB_MEMBERS_ADMIN_ELEMENT_TOKEN,
  USERS_WEB_WORKSPACE_SETTINGS_ELEMENT_TOKEN
} from "./providers/UsersWebClientProvider.js";

export { default as UsersWorkspaceSelector } from "./components/UsersWorkspaceSelector.vue";
export { default as UsersWorkspaceToolsWidget } from "./components/UsersWorkspaceToolsWidget.vue";
export { default as UsersShellMenuLinkItem } from "./components/UsersShellMenuLinkItem.vue";
export { default as UsersSurfaceAwareMenuLinkItem } from "./components/UsersSurfaceAwareMenuLinkItem.vue";
export { default as UsersWorkspaceSettingsMenuItem } from "./components/UsersWorkspaceSettingsMenuItem.vue";
export { default as UsersWorkspaceMembersMenuItem } from "./components/UsersWorkspaceMembersMenuItem.vue";
export { default as ProfileClientElement } from "./components/ProfileClientElement.vue";
export { default as MembersAdminClientElement } from "./components/MembersAdminClientElement.vue";
export { default as WorkspaceSettingsClientElement } from "./components/WorkspaceSettingsClientElement.vue";
export { usersWebHttpClient } from "./lib/httpClient.js";
export { USERS_WEB_QUERY_KEYS } from "./lib/queryKeys.js";
export {
  buildBootstrapApiPath,
  normalizeWorkspaceEntry,
  normalizeWorkspaceList,
  findWorkspaceBySlug
} from "./lib/bootstrap.js";
export {
  normalizePermissionList,
  hasPermission
} from "./lib/permissions.js";
export { useUsersWebBootstrapQuery } from "./composables/useUsersWebBootstrapQuery.js";
export { useUsersWebAccess } from "./composables/useUsersWebAccess.js";
export { useUsersWebWorkspaceRouteContext } from "./composables/useUsersWebWorkspaceRouteContext.js";
export { useUsersWebWorkspaceAccess } from "./composables/useUsersWebWorkspaceAccess.js";
export { useAddEditScreen } from "./composables/useAddEditScreen.js";
export { useUsersWebEndpointResource } from "./composables/useUsersWebEndpointResource.js";
export { useUsersWebListResource } from "./composables/useUsersWebListResource.js";
export { useUsersWebUiFeedback } from "./composables/useUsersWebUiFeedback.js";
export { useUsersWebFieldErrorBag } from "./composables/useUsersWebFieldErrorBag.js";
export { useUsersWebSettingsResource } from "./composables/useUsersWebSettingsResource.js";

const USERS_WEB_CLIENT_API = Object.freeze({
  clientProviders: Object.freeze([UsersWebClientProvider])
});

export { USERS_WEB_CLIENT_API };
