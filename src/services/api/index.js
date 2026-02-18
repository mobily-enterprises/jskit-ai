import { createApi as createAuthApi } from "./authApi.js";
import { createApi as createWorkspaceApi } from "./workspaceApi.js";
import { createApi as createProjectsApi } from "./projectsApi.js";
import { createApi as createSettingsApi } from "./settingsApi.js";
import { createApi as createAnnuityApi } from "./annuityApi.js";
import { createApi as createHistoryApi } from "./historyApi.js";
import { request, clearCsrfTokenCache, __testables } from "./transport.js";

const authApi = createAuthApi({ request });
const workspaceApi = createWorkspaceApi({ request });
const projectsApi = createProjectsApi({ request });
const settingsApi = createSettingsApi({ request });
const annuityApi = createAnnuityApi({ request });
const historyApi = createHistoryApi({ request });

const settings = Object.assign(() => settingsApi.get(), settingsApi);
const history = Object.assign((page, pageSize) => historyApi.list(page, pageSize), historyApi);

const api = {
  auth: authApi,
  workspace: workspaceApi,
  projects: projectsApi,
  settings,
  annuity: annuityApi,
  history,
  session: () => authApi.session(),
  register: (payload) => authApi.register(payload),
  login: (payload) => authApi.login(payload),
  requestOtpLogin: (payload) => authApi.requestOtp(payload),
  verifyOtpLogin: (payload) => authApi.verifyOtp(payload),
  oauthStartUrl: (provider, options) => authApi.oauthStartUrl(provider, options),
  oauthComplete: (payload) => authApi.oauthComplete(payload),
  requestPasswordReset: (payload) => authApi.requestPasswordReset(payload),
  completePasswordRecovery: (payload) => authApi.completePasswordRecovery(payload),
  resetPassword: (payload) => authApi.resetPassword(payload),
  logout: () => authApi.logout(),
  bootstrap: () => workspaceApi.bootstrap(),
  workspaces: () => workspaceApi.list(),
  selectWorkspace: (payload) => workspaceApi.select(payload),
  pendingWorkspaceInvites: () => workspaceApi.listPendingInvites(),
  redeemWorkspaceInvite: (payload) => workspaceApi.redeemInvite(payload),
  workspaceSettings: () => workspaceApi.getSettings(),
  updateWorkspaceSettings: (payload) => workspaceApi.updateSettings(payload),
  workspaceRoles: () => workspaceApi.listRoles(),
  workspaceMembers: () => workspaceApi.listMembers(),
  updateWorkspaceMemberRole: (memberUserId, payload) => workspaceApi.updateMemberRole(memberUserId, payload),
  workspaceInvites: () => workspaceApi.listInvites(),
  createWorkspaceInvite: (payload) => workspaceApi.createInvite(payload),
  revokeWorkspaceInvite: (inviteId) => workspaceApi.revokeInvite(inviteId),
  workspaceProjects: (page, pageSize) => projectsApi.list(page, pageSize),
  workspaceProject: (projectId) => projectsApi.get(projectId),
  createWorkspaceProject: (payload) => projectsApi.create(payload),
  updateWorkspaceProject: (projectId, payload) => projectsApi.update(projectId, payload),
  updateProfileSettings: (payload) => settingsApi.updateProfile(payload),
  uploadProfileAvatar: (payload) => settingsApi.uploadAvatar(payload),
  deleteProfileAvatar: () => settingsApi.deleteAvatar(),
  updatePreferencesSettings: (payload) => settingsApi.updatePreferences(payload),
  updateNotificationSettings: (payload) => settingsApi.updateNotifications(payload),
  changePassword: (payload) => settingsApi.changePassword(payload),
  setPasswordMethodEnabled: (payload) => settingsApi.setPasswordMethodEnabled(payload),
  settingsOAuthLinkStartUrl: (provider, options) => settingsApi.oauthLinkStartUrl(provider, options),
  unlinkSettingsOAuthProvider: (provider) => settingsApi.unlinkOAuthProvider(provider),
  logoutOtherSessions: () => settingsApi.logoutOtherSessions(),
  calculateAnnuity: (payload) => annuityApi.calculate(payload),
  clearCsrfTokenCache
};

export { api, __testables };
