function createService() {
  return Object.freeze({
    async getStatus(input = {}) {
      return {
        ok: true,
        feature: "availability-engine",
        mode: "orchestrator",
        input
      };
    },
    async execute(input = {}) {
      return {
        accepted: false,
        feature: "availability-engine",
        mode: "orchestrator",
        input,
        message: "Replace this example with calls to the feature's injected collaborators."
      };
    }
  });
}

export { createService };
