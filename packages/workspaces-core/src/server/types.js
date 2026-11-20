// The types of the workspaces capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./workspacesRuntime.js").createWorkspacesRuntime>} WorkspacesCore */
/** @typedef {ReturnType<typeof import("./common/repositories/workspacesRepository.js").createRepository>} Workspaces The workspaces table's records: `workspaces`. */
/** @typedef {ReturnType<typeof import("./common/repositories/workspaceMembershipsRepository.js").createRepository>} WorkspacesMemberships The workspace memberships table's records: `workspaces.memberships`. */

/** @typedef {ReturnType<typeof import("./common/services/workspaceDirectoryService.js").createService>} WorkspaceDirectoryService The workspace directory service: `services.directory` of `workspaces.core`. */
/** @typedef {ReturnType<typeof import("./workspaceMembers/workspaceMembersService.js").createService>} WorkspaceMembersService The workspace members service: `services.members` of `workspaces.core`. */
/** @typedef {ReturnType<typeof import("./workspacePendingInvitations/workspacePendingInvitationsService.js").createService>} WorkspacePendingInvitationsService The pending invitations service: `services.pendingInvitations` of `workspaces.core`. */
/** @typedef {ReturnType<typeof import("./workspaceSettings/workspaceSettingsService.js").createService>} WorkspaceSettingsService The workspace settings service: `services.settings` of `workspaces.core`. */

/**
 * The handles of the tables `workspaces.core` owns, by resource name.
 * @typedef {{
 *   workspaces: import("@jskit-ai/resource-runtime/server/types").ResourceHandle,
 *   workspaceMemberships: import("@jskit-ai/resource-runtime/server/types").ResourceHandle,
 *   workspaceInvites: import("@jskit-ai/resource-runtime/server/types").ResourceHandle,
 *   workspaceSettings: import("@jskit-ai/resource-runtime/server/types").ResourceHandle
 * }} WorkspacesResources
 */
/** @typedef {ReturnType<typeof import("./common/repositories/workspacesRepository.js").createRepository>} WorkspacesRepository */
/** @typedef {ReturnType<typeof import("./common/repositories/workspaceMembershipsRepository.js").createRepository>} WorkspaceMembershipsRepository */
/** @typedef {ReturnType<typeof import("./common/repositories/workspaceMemberPagesRepository.js").createRepository>} WorkspaceMemberPagesRepository */
/** @typedef {ReturnType<typeof import("./common/repositories/workspaceInvitesRepository.js").createRepository>} WorkspaceInvitesRepository */
/** @typedef {ReturnType<typeof import("./workspaceSettings/workspaceSettingsRepository.js").createRepository>} WorkspaceSettingsRepository */
/** @typedef {ReturnType<typeof import("../shared/roles.js").createWorkspaceRoleCatalog>} WorkspaceRoleCatalog */
/** @typedef {ReturnType<typeof import("../shared/tenancyProfile.js").resolveTenancyProfile>} WorkspaceTenancyProfile */
/** @typedef {ReturnType<typeof import("./workspaceMembers/workspaceInviteUrls.js").createWorkspaceInviteUrlBuilder>} WorkspaceInviteUrlBuilder The invitation URL a token opens, from the app's public URL and invite path. */
/** @typedef {ReturnType<typeof import("./i18n.js").createWorkspacesServerI18n>} WorkspacesServerI18n The workspace texts rendered on the server, in a recipient's language. */

/**
 * The `workspaces.invite-mailer` capability: a feature that provides it sends
 * workspace invitation email. It is told which saved invitation it sends
 * (`inviteId`, its `workspace_invites` row, in `workspace.id`'s workspace).
 * Its result is the delivery outcome; the status defaults to "sent". The
 * members panel words its own notice for `sent`, `simulated` (logged outside production),
 * `held` (an email the mailer keeps until the application's email is set up,
 * and sends then) and `failed`; for any other status it shows the result's
 * `message` (translated by `messageCode` when given), else a neutral notice.
 *
 * Its optional `sendInviteAcceptedByOtherAddress` tells an inviter that an
 * account whose email is not the invited address accepted their invitation
 * (where `config.workspaceInvitations.anyAccount` lets one). It is called once
 * the acceptance committed, never inside its transaction; its failure is logged
 * and the acceptance stands. A mailer without it sends no such notice.
 * `message` is the notice's `{ subject, text, html }` in the inviter's language.
 * @typedef {object} WorkspaceInviteMailer
 * @property {(message: { inviteId: string, email: string, inviteUrl: string, workspace: { id: string, slug: string, name: string, ownerUserId: string, avatarUrl: string }, inviter: object | null, roleSid: string, expiresAt: string, locale: string, message: object }, options?: object) => Promise<{ status?: string, message?: string, messageCode?: string, messageParams?: object, providerMessageId?: string } | void>} sendWorkspaceInvite
 * @property {(notice: { inviteId: string, invite: { id: string, email: string, roleSid: string }, inviter: { id: string, email: string, displayName: string }, member: { id: string, email: string, displayName: string }, workspace: { id: string, slug: string, name: string }, locale: string, message: { subject: string, text: string, html: string } }, options?: object) => Promise<unknown>} [sendInviteAcceptedByOtherAddress]
 */

/**
 * The `workspaces.invite-email-template` capability: renders an invitation
 * email's `{ subject, text, html }`.
 * @typedef {(input: { email: string, inviteUrl: string, workspace: object, inviter: object | null, roleSid: string, roleLabel?: string, expiresAt: string, locale: string, timeZone: string, t: (key: string, params?: object) => string }) => object | Promise<object>} WorkspaceInviteEmailTemplate
 */

/**
 * An accepted invitation: the invitation as read before it was marked accepted
 * (with at least these fields), the user who accepted it (the signed-in actor,
 * with at least these) and the workspace they joined. `invite.email` is the
 * invited address and `user.email` the account's, which differ when another
 * account accepted it.
 * @typedef {{
 *   invite: { id: string, email: string, workspaceId: string, invitedByUserId: string | null, roleSid: string, [field: string]: unknown },
 *   user: { id: string, email: string, displayName: string, [field: string]: unknown },
 *   workspace: { id: string, slug: string, name: string, ownerUserId: string }
 * }} WorkspaceInviteAcceptance
 */

/**
 * The `workspaces.invite-acceptance-participant` capability: the application's
 * writes for an accepted invitation. It runs after the membership is activated,
 * inside the uncommitted acceptance transaction, and a failure rolls the
 * acceptance back. Its options join that transaction: pass them to every call,
 * such as `workspaces.core`'s `services.directory.deleteWorkspace`.
 * @typedef {(acceptance: WorkspaceInviteAcceptance, options: { trx: unknown, context?: object }) => Promise<void>} WorkspaceInviteAcceptanceParticipant
 */

/**
 * The `workspaces.workspace-created-participant` capability: the application's
 * writes for a new workspace, personal (provisioned at sign-in) or created by
 * `workspace.workspaces.create`. It runs after the workspace, its owner's
 * membership and its settings are written, inside the uncommitted creation
 * transaction, and a failure rolls the whole creation back. `owner` is the user
 * who owns the workspace. Its options join that transaction: pass them to every call.
 * @typedef {(created: { workspace: object, owner: object }, options: { trx: unknown, context?: object }) => Promise<void>} WorkspaceCreatedParticipant
 */

/**
 * The `workspaces.personal-workspace-name` capability: names the personal
 * workspace provisioned for a user. An empty name falls back to the default.
 * @typedef {(user: object) => string} PersonalWorkspaceName
 */

export {};
