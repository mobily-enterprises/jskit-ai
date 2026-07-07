import { WorkspacesWebClientProvider } from "./providers/WorkspacesWebClientProvider.js";

const clientProviders = Object.freeze([WorkspacesWebClientProvider]);

export { WorkspacesWebClientProvider } from "./providers/WorkspacesWebClientProvider.js";
export { default as WorkspaceMembersClientElement } from "./components/WorkspaceMembersClientElement.vue";
export { default as WorkspaceInviteLanding } from "./components/WorkspaceInviteLanding.vue";
export { clientProviders };
