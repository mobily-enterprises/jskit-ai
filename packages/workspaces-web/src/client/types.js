// The values workspaces-web's client hands out and receives across files.

/**
 * The placement context the shell keeps and workspaces-web writes its workspace values into.
 * @typedef {Record<string, any>} WorkspacePlacementContext
 */

/**
 * The part of shell-web's placement runtime workspaces-web uses.
 * @typedef {object} WorkspacePlacementRuntime
 * @property {() => WorkspacePlacementContext} getContext
 * @property {(patch: object, options: { source: string }) => WorkspacePlacementContext} setContext
 * @property {(listener: (event: { type?: string, source?: string }) => void) => () => void} subscribe Returns the unsubscribe.
 */

/**
 * The part of shell-web's bootstrap runtime workspaces-web uses.
 * @typedef {object} ShellBootstrapRuntime
 * @property {(reason: string) => Promise<unknown>} refresh
 */

/**
 * The part of shell-web's `client.shell` capability workspaces-web uses.
 * @typedef {object} WorkspaceShell
 * @property {ShellBootstrapRuntime} bootstrap
 * @property {{ register: (handler: object) => void }} bootstrapHandlers
 * @property {WorkspacePlacementRuntime} placement
 */

/**
 * The part of realtime's `client.realtime` capability workspaces-web uses.
 * @typedef {object} WorkspaceRealtime
 * @property {{ on: (event: string, listener: () => void) => unknown, off: (event: string, listener: () => void) => unknown }} socket
 */

/**
 * What decides whether the shell lets a route open: true or nothing allows it, false or `{ allow: false }` denies it.
 * @typedef {(input: { guard?: unknown, phase?: string, context?: object }) => unknown} ShellGuardEvaluator
 */

/**
 * What a route's workspace is read from, as `useSurfaceRouteContext()` returns it.
 * @typedef {object} WorkspaceRouteScopeContext
 * @property {import("vue").MaybeRef<WorkspacePlacementContext>} placementContext
 * @property {import("vue").MaybeRef<string>} currentSurfaceId
 * @property {import("vue").MaybeRef<string>} routePath
 */

/** @typedef {ReturnType<typeof import("./runtime/bootstrapPlacementRuntime.js").createBootstrapPlacementRuntime>} WorkspaceBootstrapRuntime */
/** @typedef {ReturnType<typeof import("./support/workspaceScopeSupport.js").createWorkspaceScopeSupport>} WorkspaceScopeSupport */

/**
 * The `client.workspaces` capability.
 * @typedef {object} WorkspacesClient
 * @property {WorkspaceBootstrapRuntime} bootstrap
 * @property {WorkspaceScopeSupport} scopeSupport
 */

/** @typedef {ReturnType<typeof import("./composables/useWorkspaceRouteContext.js").useWorkspaceRouteContext>} WorkspaceRouteContext */
/** @typedef {ReturnType<typeof import("./composables/useWorkspaceSurfaceId.js").useWorkspaceSurfaceId>} WorkspaceSurfaceIds */
/** @typedef {ReturnType<typeof import("./composables/useWorkspaceMembersPage.js").useWorkspaceMembersPage>} WorkspaceMembersPage */
/** @typedef {ReturnType<typeof import("./composables/useWorkspaceMembersActions.js").useWorkspaceMembersActions>} WorkspaceMembersActions */
/** @typedef {ReturnType<typeof import("./composables/useWorkspacesLanding.js").useWorkspacesLanding>} WorkspacesLanding */
/** @typedef {ReturnType<typeof import("./account-settings/useAccountSettingsInvitesSectionRuntime.js").useAccountSettingsInvitesSectionRuntime>} AccountSettingsInvites */
/** @typedef {ReturnType<typeof import("./lib/workspaceLinkResolver.js").useWorkspaceLinkResolver>} WorkspaceLinkResolver */

/**
 * An invitation the person can answer.
 * @typedef {object} PendingInvite
 * @property {string} id
 * @property {string} token
 * @property {string} workspaceId
 * @property {string} workspaceSlug
 * @property {string} workspaceName
 * @property {string} workspaceAvatarUrl
 * @property {string} roleSid
 * @property {string} roleLabel
 * @property {string} status
 * @property {string} expiresAt
 */

/**
 * The answer being given to an invitation; both empty when there is none.
 * @typedef {object} InviteAction
 * @property {string} token
 * @property {string} decision
 */

/**
 * One message the account page shows through the shell.
 * @typedef {object} WorkspaceFeedback
 * @property {string} message
 * @property {string} [severity]
 * @property {string} [channel]
 * @property {string} [dedupeKey]
 */

/**
 * The members page's forms.
 * @typedef {object} MembersAdminForms
 * @property {{ email: string, roleSid: string }} invite
 * @property {{ invitesEnabled: boolean, invitesAvailable: boolean }} workspace
 */

/**
 * The members page's role choices and formatters.
 * @typedef {object} MembersAdminOptions
 * @property {{ title: string, value: string }[]} inviteRoleOptions
 * @property {{ title: string, value: string }[]} memberRoleOptions
 * @property {Record<string, string>} roleLabels
 * @property {(roleSid: string, fallback?: string) => string} formatRole
 * @property {(value: string) => string} formatDateTime
 */

/**
 * A workspace member as the members page lists it.
 * @typedef {ReturnType<typeof import("./lib/workspaceMembersPayloads.js").normalizeMembers>[number]} WorkspaceMember
 */

/**
 * An invitation as the members page lists it.
 * @typedef {ReturnType<typeof import("./lib/workspaceMembersPayloads.js").normalizeInvites>[number]} WorkspaceMemberInvite
 */

/**
 * The members page's rows.
 * @typedef {object} MembersAdminCollections
 * @property {WorkspaceMember[]} members
 * @property {WorkspaceMemberInvite[]} invites
 */

/**
 * What the person may do on the members page.
 * @typedef {object} MembersAdminPermissions
 * @property {boolean} canViewMembers
 * @property {boolean} canInviteMembers
 * @property {boolean} canManageMembers
 * @property {boolean} canRevokeInvites
 */

/**
 * What the members page is doing and has loaded.
 * @typedef {object} MembersAdminStatus
 * @property {boolean} isCreatingInvite
 * @property {boolean} isRevokingInvite
 * @property {boolean} isRemovingMember
 * @property {boolean} isCopyingInviteLink
 * @property {string} createdInviteUrl
 * @property {string} createdInviteDeliveryStatus
 * @property {boolean} hasLoadedWorkspaceSettings
 * @property {boolean} hasLoadedMembersList
 * @property {boolean} hasLoadedInviteList
 * @property {boolean} isRefreshingWorkspaceSettings
 * @property {boolean} isRefreshingMembersList
 * @property {boolean} isRefreshingInviteList
 */

/**
 * What the members page lets a person do.
 * @typedef {object} MembersAdminActions
 * @property {() => Promise<void>} submitInvite
 * @property {() => Promise<void>} copyCreatedInviteLink
 * @property {(inviteId: string) => Promise<void>} submitRevokeInvite
 * @property {(member: WorkspaceMember, roleSid: string) => Promise<void>} submitMemberRoleUpdate
 * @property {(member: WorkspaceMember) => Promise<void>} submitRemoveMember
 */

export {};
