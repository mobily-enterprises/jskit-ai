function createApi({ request }) {
  return {
    calculate(payload) {
      return request("/api/annuityCalculator", { method: "POST", body: payload });
    }
  };
}

export { createApi };
