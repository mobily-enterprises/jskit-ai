const PROJECTS_QUERY_KEY_PREFIX = Object.freeze(["workspace-projects"]);
const PROJECT_QUERY_KEY_PREFIX = Object.freeze(["workspace-project"]);

const PROJECTS_PAGE_QUERY_KEY = "projectsPage";
const PROJECTS_PAGE_SIZE_QUERY_KEY = "projectsPageSize";

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
  PROJECTS_PAGE_QUERY_KEY,
  PROJECTS_PAGE_SIZE_QUERY_KEY,
  projectsScopeQueryKey,
  projectsListQueryKey,
  projectDetailQueryKey
};
