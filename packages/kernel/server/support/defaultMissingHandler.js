function defaultMissingHandler(_request, reply) {
  reply.code(501).send({
    error: "Route handler is not available in this runtime profile."
  });
}

export { defaultMissingHandler };
