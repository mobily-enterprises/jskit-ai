import { sevdeskDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const sevdeskProvider = Object.freeze({
  ...sevdeskDefinition,
  apiOrigins: ["https://my.sevdesk.de"],
  apiKey: { headers: (key) => ({ Authorization: key }) },
  checkOperation: "contacts.list",
  operations: {
    "contacts.list": jsonOperation("https://my.sevdesk.de/api/v1/Contact", {
      limit: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
      offset: { type: "integer", min: 0, max: 1000000, defaultTo: 0 },
      countAll: { type: "boolean", defaultTo: false },
      depth: { type: "integer", enum: [0, 1], defaultTo: 1 }
    }, (result) => Array.isArray(result?.objects) &&
      (result.total === undefined || Number.isInteger(result.total) && result.total >= 0 ||
        typeof result.total === "string" && /^[0-9]+$/u.test(result.total)))
  }
});
export { sevdeskProvider };
