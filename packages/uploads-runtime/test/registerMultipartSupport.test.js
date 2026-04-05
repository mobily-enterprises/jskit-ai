import test from "node:test";
import assert from "node:assert/strict";
import { registerMultipartSupport } from "../src/server/multipart/registerMultipartSupport.js";

function createAppStub({ hasFastify = true, fastify = null } = {}) {
  const resolvedFastify =
    fastify ||
    {
      register: async () => {},
      hasContentTypeParser: () => false
    };

  return {
    has(token) {
      if (token === "jskit.fastify") {
        return hasFastify;
      }
      return false;
    },
    make(token) {
      if (token === "jskit.fastify") {
        return resolvedFastify;
      }
      return null;
    }
  };
}

test("registerMultipartSupport returns early when Fastify is not available", async () => {
  const app = createAppStub({ hasFastify: false });
  await assert.doesNotReject(async () => registerMultipartSupport(app));
});

test("registerMultipartSupport registers multipart parser only once", async () => {
  let registerCount = 0;
  const fastify = {
    register: async () => {
      registerCount += 1;
    },
    hasContentTypeParser: () => false
  };
  const app = createAppStub({ fastify });

  await registerMultipartSupport(app);
  await registerMultipartSupport(app);

  assert.equal(registerCount, 1);
});

test("registerMultipartSupport skips registration when parser already exists", async () => {
  let registerCount = 0;
  const fastify = {
    register: async () => {
      registerCount += 1;
    },
    hasContentTypeParser: (contentType) => String(contentType || "").trim().toLowerCase() === "multipart"
  };
  const app = createAppStub({ fastify });

  await registerMultipartSupport(app);

  assert.equal(registerCount, 0);
});
