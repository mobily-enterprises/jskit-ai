function createApi({ request }) {
  return {
    list({ page = 1, pageSize = 20 } = {}) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/alerts?${params.toString()}`);
    },
    markAllRead() {
      return request("/api/alerts/read-all", {
        method: "POST"
      });
    }
  };
}

export { createApi };
