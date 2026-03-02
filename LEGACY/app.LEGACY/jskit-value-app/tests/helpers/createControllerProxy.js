function createControllerProxy() {
  const fallbackHandler = new Proxy(
    async (_request, reply) => {
      if (reply && typeof reply.code === "function") {
        reply.code(200).send({ ok: true });
      }
    },
    {
      get() {
        return fallbackHandler;
      }
    }
  );

  return new Proxy(
    {},
    {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }
        return fallbackHandler;
      }
    }
  );
}

export { createControllerProxy };
