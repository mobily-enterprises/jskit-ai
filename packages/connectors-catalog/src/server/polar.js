import { polarDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const origins = { sandbox: "https://sandbox-api.polar.sh", production: "https://api.polar.sh" };
const polarProvider = Object.freeze({
  ...polarDefinition, apiOrigins: Object.values(origins),
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "products.list",
  operations: {
    "products.list": jsonOperation((settings) => `${origins[settings.environment]}/v1/products/`, {
      page: { type: "integer", min: 1, max: 2147483647, defaultTo: 1 },
      limit: { type: "integer", min: 1, max: 100, defaultTo: 10 },
      query: { type: "string", maxLength: 1024 },
      is_archived: { type: "boolean" },
      is_recurring: { type: "boolean" }
    }, (result) => Array.isArray(result?.items) && Number.isInteger(result.pagination?.total_count) &&
      result.pagination.total_count >= 0 && Number.isInteger(result.pagination.max_page) && result.pagination.max_page >= 0)
  }
});
export { polarProvider };
