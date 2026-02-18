function createAnnuityApi({ request }) {
  return {
    calculateAnnuity(payload) {
      return request("/api/annuityCalculator", { method: "POST", body: payload });
    }
  };
}

export { createAnnuityApi };
