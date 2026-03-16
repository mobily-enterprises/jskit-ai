import test from "node:test";
import assert from "node:assert/strict";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerAvatarMultipartSupport } from "../src/server/accountProfile/registerAvatarMultipartSupport.js";

function createAppStub({ hasFastify = true, fastify = null } = {}) {
  const resolvedFastify =
    fastify ||
    {
      register: async () => {},
      hasContentTypeParser: () => false
    };

  return {
    has(token) {
      if (token === KERNEL_TOKENS.Fastify) {
        return hasFastify;
      }
      return false;
    },
    make(token) {
      if (token === KERNEL_TOKENS.Fastify) {
        return resolvedFastify;
      }
      return null;
    }
  };
}

test("registerAvatarMultipartSupport returns early when Fastify is not available", async () => {
  const app = createAppStub({ hasFastify: false });
  await assert.doesNotReject(async () => registerAvatarMultipartSupport(app));
});

test("registerAvatarMultipartSupport registers multipart parser only once", async () => {
  let registerCount = 0;
  const fastify = {
    register: async () => {
      registerCount += 1;
    },
    hasContentTypeParser: () => false
  };
  const app = createAppStub({ fastify });

  await registerAvatarMultipartSupport(app);
  await registerAvatarMultipartSupport(app);

  assert.equal(registerCount, 1);
});

test("registerAvatarMultipartSupport skips registration when parser already exists", async () => {
  let registerCount = 0;
  const fastify = {
    register: async () => {
      registerCount += 1;
    },
    hasContentTypeParser: (contentType) => String(contentType || "").trim().toLowerCase() === "multipart"
  };
  const app = createAppStub({ fastify });

  await registerAvatarMultipartSupport(app);

  assert.equal(registerCount, 0);
});
