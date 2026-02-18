function createProjectsApi({ request }) {
  return {
    workspaceProjects(page, pageSize) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/workspace/projects?${params.toString()}`);
    },
    workspaceProject(projectId) {
      const encodedProjectId = encodeURIComponent(String(projectId || "").trim());
      return request(`/api/workspace/projects/${encodedProjectId}`);
    },
    createWorkspaceProject(payload) {
      return request("/api/workspace/projects", { method: "POST", body: payload });
    },
    updateWorkspaceProject(projectId, payload) {
      const encodedProjectId = encodeURIComponent(String(projectId || "").trim());
      return request(`/api/workspace/projects/${encodedProjectId}`, { method: "PATCH", body: payload });
    }
  };
}

export { createProjectsApi };
