function createApi({ request }) {
  return {
    list(page, pageSize) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/v1/history?${params.toString()}`);
    }
  };
}

export { createApi };
