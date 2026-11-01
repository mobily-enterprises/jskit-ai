/**
 * The JSON:API record id of a workspace response: the workspace's id, or the
 * route's workspace slug.
 * @param {{ id?: unknown, workspace?: { id?: unknown } }} record
 * @param {{ request?: { params?: { workspaceSlug?: unknown } } }} context
 */
function resolveWorkspaceRecordId(record = {}, context = {}) {
  const workspaceId = record?.workspace?.id ?? record?.id;
  if (workspaceId != null && String(workspaceId).trim()) {
    return workspaceId;
  }

  const workspaceSlug = context?.request?.params?.workspaceSlug;
  if (workspaceSlug != null && String(workspaceSlug).trim()) {
    return workspaceSlug;
  }

  throw new Error("Workspace JSON:API response requires workspace id.");
}

export { resolveWorkspaceRecordId };
