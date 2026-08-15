import assert from "node:assert/strict";
import test from "node:test";

import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { StorageProvider } from "../src/server/providers/StorageProvider.js";

test("StorageProvider provides the configured storage instance directly", async () => {
  let storage;
  const consumer = defineProvider({
    id: "test.storage.consumer",
    requires: { value: "runtime.storage" },
    setup({ value }) {
      storage = value;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.app-root": process.cwd(),
      "runtime.env": { JSKIT_STORAGE_DRIVER: "memory" }
    },
    providers: [StorageProvider, consumer]
  });

  await runtime.start();
  assert.equal(typeof storage.setItemRaw, "function");
  assert.equal(typeof storage.getItemRaw, "function");
  await storage.setItemRaw("tests/storage-runtime", Buffer.from("ok"));
  assert.equal(Buffer.from(await storage.getItemRaw("tests/storage-runtime")).toString(), "ok");
  await runtime.shutdown();
});
