import { perplexityDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const perplexityProvider = Object.freeze({
  ...perplexityDefinition, apiOrigins: ["https://api.perplexity.ai"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "requests.list",
  operations: {
    "requests.list": jsonOperation("https://api.perplexity.ai/v1/async/sonar", {},
      (result) => Array.isArray(result?.requests) && (result.next_token === undefined || result.next_token === null || typeof result.next_token === "string")),
    "models.list": jsonOperation("https://api.perplexity.ai/v1/models", {},
      (result) => result?.object === "list" && Array.isArray(result.data))
  }
});
export { perplexityProvider };
