const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/;

function normalizeWorkspaceSlug(workspaceSlugValue) {
  const workspaceSlug = String(workspaceSlugValue || "")
    .trim()
    .toLowerCase();
  if (!workspaceSlug || !WORKSPACE_SLUG_PATTERN.test(workspaceSlug)) {
    return "";
  }

  return workspaceSlug;
}

function buildSubscribeContextRequest(request, workspaceSlugValue) {
  const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlugValue);

  const headers = {
    ...(request?.headers || {}),
    "x-surface-id": "admin",
    "x-workspace-slug": normalizedWorkspaceSlug
  };

  const params = {
    ...(request?.params || {}),
    workspaceSlug: normalizedWorkspaceSlug
  };

  const query = {
    ...(request?.query || {}),
    workspaceSlug: normalizedWorkspaceSlug
  };

  const url = `/admin/w/${normalizedWorkspaceSlug || "none"}`;

  return {
    ...request,
    headers,
    params,
    query,
    url,
    raw: {
      ...(request?.raw || {}),
      url
    }
  };
}

export { normalizeWorkspaceSlug, buildSubscribeContextRequest };
