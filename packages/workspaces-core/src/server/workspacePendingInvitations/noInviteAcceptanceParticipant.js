/**
 * The `workspaces.invite-acceptance-participant` default when no feature
 * provides one: accepting an invitation activates the membership only.
 * @type {import("../types.js").WorkspaceInviteAcceptanceParticipant}
 */
async function noInviteAcceptanceParticipant() {}

export { noInviteAcceptanceParticipant };
