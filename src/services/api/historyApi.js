function createHistoryApi({ request }) {
  return {
    history(page, pageSize) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/history?${params.toString()}`);
    }
  };
}

export { createHistoryApi };
