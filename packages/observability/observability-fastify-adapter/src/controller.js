function createController({ observabilityService }) {
  if (!observabilityService || typeof observabilityService.getMetricsPayload !== "function") {
    throw new Error("observabilityService.getMetricsPayload is required.");
  }

  async function getMetrics(request, reply) {
    const payload = observabilityService.getMetricsPayload({
      authorizationHeader: request?.headers?.authorization
    });

    reply.header("content-type", payload.contentType);
    reply.header("cache-control", "no-store");
    reply.code(200).send(payload.body);
  }

  return {
    getMetrics
  };
}

export { createController };
