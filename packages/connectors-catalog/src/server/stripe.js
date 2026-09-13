import { stripeDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const stripeProvider = Object.freeze({
  ...stripeDefinition, apiOrigins: ["https://api.stripe.com"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "balance.read",
  operations: {
    "balance.read": jsonOperation("https://api.stripe.com/v1/balance", {},
      (result) => result?.object === "balance" && Array.isArray(result.available) && Array.isArray(result.pending) && typeof result.livemode === "boolean")
  }
});
export { stripeProvider };
