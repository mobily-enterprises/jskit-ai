function createController({ healthService }) {
  if (!healthService) {
    throw new Error("healthService is required.");
  }

  async function getHealth(_request, reply) {
    const payload = await healthService.health();
    reply.code(200).send(payload);
  }

  async function getReadiness(_request, reply) {
    const payload = await healthService.readiness();
    reply.code(payload.ok ? 200 : 503).send(payload);
  }

  return {
    getHealth,
    getReadiness
  };
}

export { createController };
