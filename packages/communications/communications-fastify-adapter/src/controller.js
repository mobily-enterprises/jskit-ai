function createController({ communicationsService }) {
  if (!communicationsService) {
    throw new Error("communicationsService is required.");
  }

  async function sendSms(request, reply) {
    const response = await communicationsService.sendSms(request.body || {});
    reply.code(200).send(response);
  }

  async function sendEmail(request, reply) {
    if (typeof communicationsService.sendEmail !== "function") {
      throw new Error("communicationsService.sendEmail is required.");
    }

    const response = await communicationsService.sendEmail(request.body || {});
    reply.code(200).send(response);
  }

  return {
    sendSms,
    sendEmail
  };
}

export { createController };
