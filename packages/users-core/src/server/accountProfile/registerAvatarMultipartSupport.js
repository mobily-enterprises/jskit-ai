import fastifyMultipart from "@fastify/multipart";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";

const AVATAR_MULTIPART_SUPPORT_FLAG = Symbol.for("jskit.users-core.avatar.multipart.support");

async function registerAvatarMultipartSupport(app) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    throw new Error("registerAvatarMultipartSupport requires application has()/make().");
  }

  if (!app.has(KERNEL_TOKENS.Fastify)) {
    return;
  }

  const fastify = app.make(KERNEL_TOKENS.Fastify);
  if (!fastify || typeof fastify.register !== "function") {
    throw new Error("registerAvatarMultipartSupport requires Fastify register().");
  }

  if (fastify[AVATAR_MULTIPART_SUPPORT_FLAG] === true) {
    return;
  }

  if (typeof fastify.hasContentTypeParser === "function" && fastify.hasContentTypeParser("multipart")) {
    Object.defineProperty(fastify, AVATAR_MULTIPART_SUPPORT_FLAG, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
    return;
  }

  await fastify.register(fastifyMultipart);
  Object.defineProperty(fastify, AVATAR_MULTIPART_SUPPORT_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

export { registerAvatarMultipartSupport };
