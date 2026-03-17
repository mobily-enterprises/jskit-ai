function createApi({ request }) {
  return {
    listBrowserErrors(page, pageSize) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/console/errors/browser?${params.toString()}`);
    },
    getBrowserError(errorId) {
      const encodedErrorId = encodeURIComponent(String(errorId || "").trim());
      return request(`/api/console/errors/browser/${encodedErrorId}`);
    },
    listServerErrors(page, pageSize) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/console/errors/server?${params.toString()}`);
    },
    getServerError(errorId) {
      const encodedErrorId = encodeURIComponent(String(errorId || "").trim());
      return request(`/api/console/errors/server/${encodedErrorId}`);
    },
    simulateServerError(payload) {
      return request("/api/console/simulate/server-error", { method: "POST", body: payload || {} });
    },
    reportBrowserError(payload) {
      return request("/api/console/errors/browser", { method: "POST", body: payload });
    }
  };
}

export { createApi };
