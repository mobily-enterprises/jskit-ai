import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { registerMultipartSupport } from "../multipart/registerMultipartSupport.js";
import { createUploadsRuntime } from "../uploadsRuntime.js";

const UploadsProvider = defineProvider({
  id: "runtime.uploads",
  requires: {
    fastify: "runtime.fastify"
  },
  provides: {
    uploads: "runtime.uploads"
  },
  setup() {
    return { uploads: createUploadsRuntime() };
  },
  async boot({ fastify }) {
    await registerMultipartSupport(fastify);
  }
});

export { UploadsProvider };
