import test from "node:test";
import assert from "node:assert/strict";
import { UploadsRuntimeServiceProvider } from "../src/server/providers/UploadsRuntimeServiceProvider.js";

function createAppStub({ hasFastify = true, fastify = null } = {}) {
  const singletons = new Map();
  const singletonInstances = new Map();
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
      return singletons.has(token) || singletonInstances.has(token);
    },
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    make(token) {
      if (token === "jskit.fastify") {
        return resolvedFastify;
      }
      if (singletonInstances.has(token)) {
        return singletonInstances.get(token);
      }
      const factory = singletons.get(token);
      if (!factory) {
        throw new Error(`Unknown token ${String(token)}`);
      }
      const instance = factory(this);
      singletonInstances.set(token, instance);
      return instance;
    }
  };
}

test("UploadsRuntimeServiceProvider registers runtime uploads api", async () => {
  const app = createAppStub();
  const provider = new UploadsRuntimeServiceProvider();

  provider.register(app);

  assert.equal(app.has("runtime.uploads"), true);
  const runtimeUploads = app.make("runtime.uploads");
  assert.equal(typeof runtimeUploads.registerMultipartSupport, "function");
  assert.equal(typeof runtimeUploads.readSingleMultipartFile, "function");
  assert.equal(typeof runtimeUploads.createUploadStorageService, "function");
});

test("UploadsRuntimeServiceProvider boots multipart support once", async () => {
  let registerCount = 0;
  const app = createAppStub({
    fastify: {
      register: async () => {
        registerCount += 1;
      },
      hasContentTypeParser: () => false
    }
  });

  const provider = new UploadsRuntimeServiceProvider();
  provider.register(app);
  await provider.boot(app);
  await provider.boot(app);

  assert.equal(registerCount, 1);
});
