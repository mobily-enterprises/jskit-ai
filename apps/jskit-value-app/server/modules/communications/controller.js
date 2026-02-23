function createController({ communicationsService }) {
  if (!communicationsService) {
    throw new Error("communicationsService is required.");
  }

  async function sendSms(request, reply) {
    const response = await communicationsService.sendSms(request.body || {});
    reply.code(200).send(response);
  }

  return {
    sendSms
  };
}

export { createController };
