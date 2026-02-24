function createApi({ request }) {
  return {
    list(page, pageSize) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/v1/workspace/projects?${params.toString()}`);
    },
    get(projectId) {
      const encodedProjectId = encodeURIComponent(String(projectId || "").trim());
      return request(`/api/v1/workspace/projects/${encodedProjectId}`);
    },
    create(payload) {
      return request("/api/v1/workspace/projects", { method: "POST", body: payload });
    },
    update(projectId, payload) {
      const encodedProjectId = encodeURIComponent(String(projectId || "").trim());
      return request(`/api/v1/workspace/projects/${encodedProjectId}`, { method: "PATCH", body: payload });
    },
    replace(projectId, payload) {
      const encodedProjectId = encodeURIComponent(String(projectId || "").trim());
      return request(`/api/v1/workspace/projects/${encodedProjectId}`, { method: "PUT", body: payload });
    }
  };
}

export { createApi };
