import test from "node:test";
import assert from "node:assert/strict";
import { StorageRuntimeServiceProvider } from "../src/server/providers/StorageRuntimeServiceProvider.js";

function createSingletonApp() {
  const singletons = new Map();

  return {
    has(token) {
      return singletons.has(token);
    },
    singleton(token, factory) {
      singletons.set(token, factory(this));
    },
    make(token) {
      if (!singletons.has(token)) {
        throw new Error(`Token ${String(token)} is not registered.`);
      }
      return singletons.get(token);
    }
  };
}

test("StorageRuntimeServiceProvider registers runtime storage api and storage binding", async () => {
  const app = createSingletonApp();
  app.singleton("jskit.env", () => ({
    JSKIT_STORAGE_DRIVER: "memory"
  }));

  const provider = new StorageRuntimeServiceProvider();
  provider.register(app);

  assert.equal(app.has("runtime.storage"), true);
  assert.equal(app.has("jskit.storage"), true);

  const runtimeStorageApi = app.make("runtime.storage");
  assert.equal(typeof runtimeStorageApi.createStorageBinding, "function");

  const storage = app.make("jskit.storage");
  assert.equal(typeof storage.setItemRaw, "function");
  assert.equal(typeof storage.getItemRaw, "function");

  await storage.setItemRaw("tests/storage-runtime", Buffer.from("ok"));
  const value = await storage.getItemRaw("tests/storage-runtime");
  assert.equal(Buffer.from(value).toString(), "ok");
});
