const PROJECTS_QUERY_KEY_PREFIX = Object.freeze(["workspace-projects"]);
const PROJECT_QUERY_KEY_PREFIX = Object.freeze(["workspace-project"]);

function normalizeWorkspaceSlug(workspaceSlug) {
  return String(workspaceSlug || "").trim() || "none";
}

function projectsScopeQueryKey(workspaceSlug) {
  return [...PROJECTS_QUERY_KEY_PREFIX, normalizeWorkspaceSlug(workspaceSlug)];
}

function projectsListQueryKey(workspaceSlug, page, pageSize) {
  return [...projectsScopeQueryKey(workspaceSlug), page, pageSize];
}

function projectDetailQueryKey(workspaceSlug, projectId) {
  return [...PROJECT_QUERY_KEY_PREFIX, normalizeWorkspaceSlug(workspaceSlug), String(projectId || "none")];
}

export {
  PROJECTS_QUERY_KEY_PREFIX,
  PROJECT_QUERY_KEY_PREFIX,
  projectsScopeQueryKey,
  projectsListQueryKey,
  projectDetailQueryKey
};
