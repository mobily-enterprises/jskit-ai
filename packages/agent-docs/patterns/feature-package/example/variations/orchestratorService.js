/** The availability engine: orchestration with no persistence of its own. */
function createService() {
  async function getStatus(input) {
    return {
      ok: true,
      feature: "availability-engine",
      mode: "orchestrator",
      input
    };
  }

  async function execute(input) {
    return {
      accepted: false,
      feature: "availability-engine",
      mode: "orchestrator",
      input,
      message: "Replace this example with calls to the feature's injected collaborators."
    };
  }

  return Object.freeze({ getStatus, execute });
}

export { createService };
