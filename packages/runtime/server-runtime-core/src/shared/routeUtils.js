function defaultMissingHandler(_request, reply) {
  reply.code(501).send({
    error: "Endpoint is not available in this server wiring."
  });
}

export { defaultMissingHandler };
