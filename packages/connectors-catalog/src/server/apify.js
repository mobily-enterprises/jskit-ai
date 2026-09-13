import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { apifyDefinition } from "../shared/tokens.js";
import { jsonOperation, validatedOperation } from "./jsonOperation.js";

const id = { type: "string", required: true, minLength: 1, maxLength: 250, pattern: "^[A-Za-z0-9_~-]+$" };
const runResult = value => typeof value?.data?.id === "string" && typeof value.data.status === "string";
const apifyProvider = Object.freeze({
  ...apifyDefinition, apiOrigins: ["https://api.apify.com"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "actors.list",
  async exchange(url, options, { request, fetchImpl }) {
    if (!new URL(url).pathname.startsWith("/v2/key-value-stores/")) return request(url, options);
    const response = await fetchImpl(url, { ...options, credentials: "omit", redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error("Apify storage request failed."), { status: response.status });
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new ConnectorError("connector_response_too_large", "Use the framework's native Apify client to stream records larger than 8 MiB.", { statusCode: 413 });
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return { contentType: response.headers.get("content-type") || "application/octet-stream",
      bodyBase64: Buffer.concat(chunks).toString("base64"), size };
  },
  operations: {
    "actors.get": validatedOperation({ actorId: id }, ({ actorId }) => ({ method: "GET", url: `https://api.apify.com/v2/actors/${actorId}` }),
      result => typeof result?.data?.id === "string"),
    "runs.start": validatedOperation({ actorId: id,
      input: { type: "object", required: true, additionalProperties: true },
      timeout: { type: "integer", required: true, min: 1, max: 86400 },
      maxTotalChargeUsd: { type: "number", required: true, min: 0.01, max: 100000 },
      build: { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9_.-]+$" }
    }, ({ actorId, input, ...options }) => {
      const url = new URL(`https://api.apify.com/v2/actors/${actorId}/runs`);
      for (const [name, value] of Object.entries(options)) url.searchParams.set(name, String(value));
      url.searchParams.set("restartOnError", "false");
      url.searchParams.set("waitForFinish", "0");
      return { method: "POST", url: url.href, body: input };
    }, runResult),
    "runs.get": validatedOperation({ runId: id }, ({ runId }) => ({ method: "GET", url: `https://api.apify.com/v2/actor-runs/${runId}` }), runResult),
    "runs.abort": validatedOperation({ runId: id }, ({ runId }) => ({ method: "POST", url: `https://api.apify.com/v2/actor-runs/${runId}/abort?gracefully=true` }), runResult),
    "datasets.items": validatedOperation({ datasetId: id,
      offset: { type: "integer", min: 0, defaultTo: 0 }, limit: { type: "integer", min: 1, max: 1000, defaultTo: 100 }
    }, ({ datasetId, offset, limit }) => ({ method: "GET",
      url: `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&offset=${offset}&limit=${limit}` }), Array.isArray),
    "stores.record": validatedOperation({ storeId: id, key: { type: "string", required: true, minLength: 1, maxLength: 250,
      validator: value => ![".", ".."].includes(value) || "Enter a storage key." }
    }, ({ storeId, key }) => ({ method: "GET", url: `https://api.apify.com/v2/key-value-stores/${storeId}/records/${encodeURIComponent(key)}` }),
      result => typeof result?.bodyBase64 === "string" && typeof result.contentType === "string"),
    "actors.list": jsonOperation("https://api.apify.com/v2/actors", {
      limit: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
      offset: { type: "integer", min: 0, defaultTo: 0 },
      desc: { type: "boolean", defaultTo: false }
    }, (result) => Array.isArray(result?.data?.items) && Number.isInteger(result.data.total) && Number.isInteger(result.data.offset))
  }
});
export { apifyProvider };
