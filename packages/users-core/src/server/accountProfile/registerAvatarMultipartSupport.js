import fastifyMultipart from "@fastify/multipart";

async function registerAvatarMultipartSupport(app) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    throw new Error("registerAvatarMultipartSupport requires application has()/make().");
  }

  if (!app.has("jskit.fastify")) {
    return;
  }

  const fastify = app.make("jskit.fastify");
  if (!fastify || typeof fastify.register !== "function") {
    throw new Error("registerAvatarMultipartSupport requires Fastify register().");
  }

  if (fastify["jskit.users-core.avatar.multipart.support"] === true) {
    return;
  }

  if (typeof fastify.hasContentTypeParser === "function" && fastify.hasContentTypeParser("multipart")) {
    Object.defineProperty(fastify, "jskit.users-core.avatar.multipart.support", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
    return;
  }

  await fastify.register(fastifyMultipart);
  Object.defineProperty(fastify, "jskit.users-core.avatar.multipart.support", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

export { registerAvatarMultipartSupport };
