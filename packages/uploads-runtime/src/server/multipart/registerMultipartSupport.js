import fastifyMultipart from "@fastify/multipart";

const MULTIPART_MARKER = "jskit.uploads-runtime.multipart.support";

async function registerMultipartSupport(fastify) {
  if (!fastify || typeof fastify.register !== "function") {
    throw new Error("registerMultipartSupport requires Fastify.");
  }

  if (fastify[MULTIPART_MARKER] === true) {
    return;
  }

  const hasMultipartParser = typeof fastify.hasContentTypeParser === "function" && fastify.hasContentTypeParser("multipart");
  if (!hasMultipartParser) {
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
