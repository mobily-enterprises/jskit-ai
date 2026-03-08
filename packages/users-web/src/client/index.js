import { UsersWebClientProvider } from "./providers/UsersWebClientProvider.js";

export {
  UsersWebClientProvider,
  USERS_WEB_WORKSPACE_SELECTOR_TOKEN,
  USERS_WEB_SHELL_MENU_LINK_ITEM_TOKEN,
  USERS_WEB_WORKSPACE_SETTINGS_MENU_ITEM_TOKEN,
  USERS_WEB_WORKSPACE_MEMBERS_MENU_ITEM_TOKEN,
  USERS_WEB_PROFILE_ELEMENT_TOKEN,
  USERS_WEB_MEMBERS_ADMIN_ELEMENT_TOKEN,
  USERS_WEB_WORKSPACE_SETTINGS_ELEMENT_TOKEN
} from "./providers/UsersWebClientProvider.js";

export { default as UsersWorkspaceSelector } from "./components/UsersWorkspaceSelector.vue";
export { default as UsersShellMenuLinkItem } from "./components/UsersShellMenuLinkItem.vue";
export { default as UsersWorkspaceSettingsMenuItem } from "./components/UsersWorkspaceSettingsMenuItem.vue";
export { default as UsersWorkspaceMembersMenuItem } from "./components/UsersWorkspaceMembersMenuItem.vue";
export { default as ProfileClientElement } from "./components/ProfileClientElement.vue";
export { default as MembersAdminClientElement } from "./components/MembersAdminClientElement.vue";
export { default as WorkspaceSettingsClientElement } from "./components/WorkspaceSettingsClientElement.vue";

const USERS_WEB_CLIENT_API = Object.freeze({
  clientProviders: Object.freeze([UsersWebClientProvider])
});

export { USERS_WEB_CLIENT_API };
