import assert from "node:assert/strict";
import test from "node:test";

import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { HttpClientProvider } from "../src/server/providers/HttpClientProvider.js";

test("HttpClientProvider provides the server HTTP client API", async () => {
  let httpClient;
  const consumer = defineProvider({
    id: "test.http-client.consumer",
    requires: { value: "runtime.http-client" },
    setup({ value }) {
      httpClient = value;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({ providers: [HttpClientProvider, consumer] });
  await runtime.start();
  assert.equal(typeof httpClient.createHttpClient, "function");
  assert.equal(typeof httpClient.shouldRetryForCsrfFailure, "function");
  await runtime.shutdown();
});
