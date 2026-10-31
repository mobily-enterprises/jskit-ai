import fastifyMultipart from "@fastify/multipart";

const MULTIPART_MARKER = "jskit.uploads-runtime.multipart.support";

/** @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} fastify */
async function registerMultipartSupport(fastify) {
  // readable-check: allow method-probe - a test asserts this error; input validation: the application passes its own Fastify instance
  if (!fastify || typeof fastify.register !== "function") {
    throw new Error("registerMultipartSupport requires Fastify.");
  }

  if (fastify[MULTIPART_MARKER] === true) {
    return;
  }

  if (!fastify.hasContentTypeParser("multipart")) {
    await fastify.register(fastifyMultipart);
  }
  Object.defineProperty(fastify, MULTIPART_MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

export { registerMultipartSupport };
