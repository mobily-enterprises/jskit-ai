import assert from "node:assert/strict";
import test from "node:test";

import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { UploadsProvider } from "../src/server/providers/UploadsProvider.js";

test("UploadsProvider provides upload operations and boots multipart support", async () => {
  let registerCount = 0;
  let uploads;
  const fastify = {
    async register() {
      registerCount += 1;
    },
    hasContentTypeParser() {
      return false;
    }
  };
  const consumer = defineProvider({
    id: "test.uploads.consumer",
    requires: { value: "runtime.uploads" },
    setup({ value }) {
      uploads = value;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.fastify": fastify },
    providers: [UploadsProvider, consumer]
  });

  await runtime.start();
  assert.equal(registerCount, 1);
  assert.equal(typeof uploads.readSingleMultipartFile, "function");
  assert.equal(typeof uploads.createUploadStorageService, "function");
  assert.equal(Object.hasOwn(uploads, "make"), false);
  await runtime.shutdown();
});
