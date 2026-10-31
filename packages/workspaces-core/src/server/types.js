// The type of the `workspaces.core` capability, for features that require it.

/** @typedef {ReturnType<typeof import("./workspacesRuntime.js").createWorkspacesRuntime>} WorkspacesCore */

/**
 * The `workspaces.invite-mailer` capability: a feature that provides it sends
 * workspace invitation email. Its result is the delivery outcome; the status
 * defaults to "sent".
 * @typedef {object} WorkspaceInviteMailer
 * @property {(message: { email: string, inviteUrl: string, workspace: object, inviter: object | null, roleSid: string, expiresAt: string, locale: string, message: object }, options?: object) => Promise<{ status?: string, message?: string, messageCode?: string, messageParams?: object, providerMessageId?: string } | void>} sendWorkspaceInvite
 */

/**
 * Renders an invitation email's `{ subject, text, html }`.
 * @typedef {(input: { email: string, inviteUrl: string, workspace: object, inviter: object | null, roleSid: string, roleLabel?: string, expiresAt: string, locale: string, t: (key: string, params?: object) => string }) => object | Promise<object>} WorkspaceInviteEmailTemplate
 */

export {};
