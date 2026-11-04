// The values users-web's client hands out and receives across files.

/**
 * The part of shell-web's placement runtime the bootstrap handler writes the signed-in user into.
 * @typedef {object} UsersPlacementRuntime
 * @property {() => Record<string, any>} getContext
 * @property {(patch: Record<string, any>, options?: { source?: string }) => void} setContext
 */

/**
 * The part of shell-web's placement runtime the account settings sections read.
 * @typedef {object} AccountSectionsPlacementRuntime
 * @property {() => number} getRevision
 * @property {(listener: (event?: { revision?: number }) => void) => () => void} subscribe
 * @property {(query: { surface: string, target: string, context: unknown }) => readonly Record<string, any>[]} getPlacements
 */

/**
 * What shell-web's bootstrap hands a payload handler.
 * @typedef {object} UsersBootstrapContext
 * @property {Record<string, any>} [payload]
 * @property {unknown} [error]
 * @property {UsersPlacementRuntime} placementRuntime
 * @property {string} [source]
 */

/**
 * The part of the `client.shell` capability users-web uses.
 * @typedef {object} UsersShell
 * @property {{ register: (handler: ReturnType<typeof import("./bootstrap/user-bootstrap-handler.js").createUsersBootstrapUserHandler>) => void }} bootstrapHandlers
 */

/**
 * One line of feedback about an account action.
 * @typedef {object} AccountFeedback
 * @property {string} message
 * @property {string} [severity]
 * @property {string} [channel]
 * @property {string} [dedupeKey]
 */

/**
 * What `ProfileClientElement` shows and edits.
 * @typedef {object} ProfileElementState
 * @property {{ displayName: string, email: string }} profileForm
 * @property {{ avatarSize: number }} preferencesForm
 * @property {{ effectiveUrl: string, hasUploadedAvatar: boolean }} profileAvatar
 * @property {string} profileInitials
 * @property {string} selectedAvatarFileName
 * @property {{ displayName?: string }} profileFieldErrors
 * @property {{ isPending: import("vue").Ref<boolean> }} profileMutation
 * @property {{ isPending: import("vue").Ref<boolean> }} avatarDeleteMutation
 */

/**
 * What `ProfileClientElement` calls.
 * @typedef {object} ProfileElementActions
 * @property {(payload: { displayName: string }) => unknown} submitProfile
 * @property {() => unknown} openAvatarEditor
 * @property {() => unknown} submitAvatarDelete
 */

/** @typedef {ReturnType<typeof import("./composables/useAccountSettingsRuntime.js").useAccountSettingsRuntime>} AccountSettingsRuntime */

export {};
