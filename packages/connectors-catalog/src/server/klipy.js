import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { klipyDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const mediaFields = {
  page: { type: "integer", min: 1, max: 100000, defaultTo: 1 },
  per_page: { type: "integer", min: 1, max: 50, defaultTo: 24 },
  customer_id: { type: "string", minLength: 1, maxLength: 256 },
  locale: { type: "string", validator: (value) => /^[A-Za-z]{2}$/.test(value) || "Use a two-letter locale such as us." },
  content_filter: { type: "string", enum: ["off", "low", "medium", "high"], defaultTo: "high" }
};

function mediaResult(response) {
  if (response?.result === false) {
    throw new ConnectorError("connector_provider_failed", "KLIPY rejected the operation.", { statusCode: 502 });
  }
  return response?.result === true && Array.isArray(response.data?.data);
}

const klipyProvider = Object.freeze({
  ...klipyDefinition,
  apiOrigins: ["https://api.klipy.com"],
  apiKey: { pathPrefix: (key) => `/api/v1/${encodeURIComponent(key)}` },
  checkOperation: "clips.trending",
  operations: Object.fromEntries(["clips", "gifs", "stickers", "emojis"].flatMap((family) => [
    [`${family}.trending`, jsonOperation(`https://api.klipy.com/${family}/trending`, mediaFields, mediaResult)],
    [`${family}.search`, jsonOperation(`https://api.klipy.com/${family}/search`, {
      ...mediaFields,
      per_page: { type: "integer", min: 8, max: 50, defaultTo: 24 },
      q: { type: "string", required: true, minLength: 1, maxLength: 500 }
    }, mediaResult)]
  ]))
});
export { klipyProvider };
