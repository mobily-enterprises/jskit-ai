import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { replicateDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const identifier = { type: "string", required: true, minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9_-]+$" };
const modelFields = { owner: identifier, name: identifier };
const modelInput = { type: "object", required: true, additionalProperties: true,
  validator: (value) => Buffer.byteLength(JSON.stringify(value)) <= 262144 || "Model input must fit within 256 KiB; use file URLs for larger inputs." };
const predictionResult = (result) => typeof result?.id === "string" &&
  ["starting", "processing", "succeeded", "failed", "canceled"].includes(result.status);
function predictionOperation(fields, method, destination, validateResult = predictionResult) {
  const schema = createSchema(fields);
  return { scopes: [], request(input) {
    const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    const { owner, name, id, ...body } = values;
    return { method, url: `https://api.replicate.com/v1/${destination(values)}`,
      ...(method === "POST" ? { body } : {}) };
  }, validateResult };
}

const replicateProvider = Object.freeze({
  ...replicateDefinition, apiOrigins: ["https://api.replicate.com"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "account.read",
  operations: {
    "account.read": jsonOperation("https://api.replicate.com/v1/account", {},
      (result) => ["user", "organization"].includes(result?.type) && typeof result.username === "string"),
    "models.get": predictionOperation(modelFields, "GET", ({ owner, name }) => `models/${owner}/${name}`,
      (result) => typeof result?.name === "string" && typeof result.owner === "string"),
    "predictions.create": predictionOperation({ version: { type: "string", required: true,
      pattern: "^(?:[A-Za-z0-9_-]+/[A-Za-z0-9_-]+:)?[a-f0-9]{64}$" }, input: modelInput },
      "POST", () => "predictions"),
    "models.predict": predictionOperation({ ...modelFields, input: modelInput }, "POST",
      ({ owner, name }) => `models/${owner}/${name}/predictions`),
    "predictions.get": predictionOperation({ id: identifier }, "GET", ({ id }) => `predictions/${id}`),
    "predictions.cancel": predictionOperation({ id: identifier }, "POST", ({ id }) => `predictions/${id}/cancel`),
    "hardware.list": jsonOperation("https://api.replicate.com/v1/hardware", {},
      (result) => Array.isArray(result) && result.every((item) => typeof item?.name === "string" && typeof item.sku === "string"))
  }
});
export { replicateProvider };
