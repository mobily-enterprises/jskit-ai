function createMissingHandler() {
  return async (_request, reply) => {
    reply.code(501).send({
      error: "missing"
    });
  };
}

export { createMissingHandler };
