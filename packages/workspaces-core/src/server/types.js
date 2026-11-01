// The type of the `workspaces.core` capability, for features that require it.

/** @typedef {ReturnType<typeof import("./workspacesRuntime.js").createWorkspacesRuntime>} WorkspacesCore */

/** @typedef {ReturnType<typeof import("./common/services/workspaceContextService.js").createService>} WorkspaceDirectoryService The workspace directory service: `services.directory` of `workspaces.core`. */
/** @typedef {ReturnType<typeof import("./workspaceMembers/workspaceMembersService.js").createService>} WorkspaceMembersService The workspace members service: `services.members` of `workspaces.core`. */
/** @typedef {ReturnType<typeof import("./workspacePendingInvitations/workspacePendingInvitationsService.js").createService>} WorkspacePendingInvitationsService The pending invitations service: `services.pendingInvitations` of `workspaces.core`. */
/** @typedef {ReturnType<typeof import("./workspaceSettings/workspaceSettingsService.js").createService>} WorkspaceSettingsService The workspace settings service: `services.settings` of `workspaces.core`. */

/** @typedef {ReturnType<typeof import("./common/repositories/workspacesRepository.js").createRepository>} WorkspacesRepository */
/** @typedef {ReturnType<typeof import("./common/repositories/workspaceMembershipsRepository.js").createRepository>} WorkspaceMembershipsRepository */
/** @typedef {ReturnType<typeof import("./common/repositories/workspaceInvitesRepository.js").createRepository>} WorkspaceInvitesRepository */
/** @typedef {ReturnType<typeof import("./workspaceSettings/workspaceSettingsRepository.js").createRepository>} WorkspaceSettingsRepository */
/** @typedef {ReturnType<typeof import("../shared/roles.js").createWorkspaceRoleCatalog>} WorkspaceRoleCatalog */
/** @typedef {ReturnType<typeof import("../shared/tenancyProfile.js").resolveTenancyProfile>} WorkspaceTenancyProfile */

/**
 * The `workspaces.invite-mailer` capability: a feature that provides it sends
 * workspace invitation email. Its result is the delivery outcome; the status
 * defaults to "sent".
 * @typedef {object} WorkspaceInviteMailer
 * @property {(message: { email: string, inviteUrl: string, workspace: object, inviter: object | null, roleSid: string, expiresAt: string, locale: string, message: object }, options?: object) => Promise<{ status?: string, message?: string, messageCode?: string, messageParams?: object, providerMessageId?: string } | void>} sendWorkspaceInvite
 */

/**
 * The `workspaces.invite-email-template` capability: renders an invitation
 * email's `{ subject, text, html }`.
 * @typedef {(input: { email: string, inviteUrl: string, workspace: object, inviter: object | null, roleSid: string, roleLabel?: string, expiresAt: string, locale: string, t: (key: string, params?: object) => string }) => object | Promise<object>} WorkspaceInviteEmailTemplate
 */

/**
 * The `workspaces.invite-acceptance-participant` capability: the application's
 * writes for an accepted invitation. It runs after the membership is activated,
 * inside the uncommitted acceptance transaction (`trx`), and a failure rolls the
 * acceptance back.
 * @typedef {(acceptance: { invite: object, user: object }, options: { trx: unknown, context?: object }) => Promise<void>} WorkspaceInviteAcceptanceParticipant
 */

/**
 * The `workspaces.personal-workspace-name` capability: names the personal
 * workspace provisioned for a user. An empty name falls back to the default.
 * @typedef {(user: object) => string} PersonalWorkspaceName
 */

export {};
