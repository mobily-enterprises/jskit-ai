import fastifyMultipart from "@fastify/multipart";

async function registerMultipartSupport(app) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    throw new Error("registerMultipartSupport requires application has()/make().");
  }

  if (!app.has("jskit.fastify")) {
    return;
  }

  const fastify = app.make("jskit.fastify");
  if (!fastify || typeof fastify.register !== "function") {
    throw new Error("registerMultipartSupport requires Fastify register().");
  }

  if (fastify["jskit.uploads-runtime.multipart.support"] === true) {
    return;
  }

  if (typeof fastify.hasContentTypeParser === "function" && fastify.hasContentTypeParser("multipart")) {
    Object.defineProperty(fastify, "jskit.uploads-runtime.multipart.support", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
    return;
  }

  await fastify.register(fastifyMultipart);
  Object.defineProperty(fastify, "jskit.uploads-runtime.multipart.support", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

export { registerMultipartSupport };
