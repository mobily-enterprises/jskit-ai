/**
 * The `workspaces.workspace-created-participant` default when no feature
 * provides one: creating a workspace writes the workspace, its owner
 * membership and its settings only.
 * @type {import("../types.js").WorkspaceCreatedParticipant}
 */
async function noWorkspaceCreatedParticipant() {}

export { noWorkspaceCreatedParticipant };
