import { fireworksAiDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const fireworksAiProvider = Object.freeze({
  ...fireworksAiDefinition, apiOrigins: ["https://api.fireworks.ai"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }) },
  checkOperation: "accounts.list",
  operations: {
    "accounts.list": jsonOperation("https://api.fireworks.ai/v1/accounts", {
      pageSize: { type: "integer", min: 1, max: 200, defaultTo: 50 },
      pageToken: { type: "string", maxLength: 4096 },
      filter: { type: "string", maxLength: 2048 }
    }, (result) => Array.isArray(result?.accounts))
  }
});
export { fireworksAiProvider };
