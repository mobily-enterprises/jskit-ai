import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { posthogDefinition } from "../shared/posthog.js";
import { jsonOperation } from "./jsonOperation.js";

const origin = (settings) => `https://${settings.region}.i.posthog.com`;
const distinctId = { type: "string", required: true, minLength: 1, maxLength: 200 };
const posthogProvider = Object.freeze({
  ...posthogDefinition,
  apiOrigins: (settings) => [origin(settings)],
  apiKey: { bodyParameter: "api_key", headers: (token) => {
    if (!/^phc_[a-zA-Z0-9_-]+$/u.test(token)) {
      throw new ConnectorError("connector_binding_missing", "Use the public PostHog project token starting with phc_.");
    }
    return { "User-Agent": "jskit-connectors/0.1.0 (posthog-node/compatible)" };
  } },
  checkOperation: "flags.evaluate",
  operations: {
    "flags.evaluate": jsonOperation((settings) => `${origin(settings)}/flags?v=2`, {
      distinct_id: distinctId,
      groups: { type: "object", additionalProperties: true },
      person_properties: { type: "object", additionalProperties: true }
    }, (result) => {
      if (!result?.flags || typeof result.flags !== "object" || Array.isArray(result.flags) ||
        typeof result.errorsWhileComputingFlags !== "boolean" ||
        (result.quotaLimited !== undefined && (!Array.isArray(result.quotaLimited) || !result.quotaLimited.every((item) => typeof item === "string")))) return false;
      if (result.quotaLimited?.includes("feature_flags")) {
        throw new ConnectorError("connector_quota_limited", "PostHog's feature flag quota has been reached.", { statusCode: 429 });
      }
      if (result.errorsWhileComputingFlags) {
        throw new ConnectorError("connector_provider_failed", "PostHog could not evaluate all requested flags.", { statusCode: 502 });
      }
      return Object.values(result.flags).every((flag) => flag && typeof flag.enabled === "boolean" &&
        (flag.variant === undefined || typeof flag.variant === "string"));
    }, "POST"),
    "events.capture": jsonOperation((settings) => `${origin(settings)}/i/v0/e/`, {
      event: { type: "string", required: true, minLength: 1, maxLength: 200 },
      distinct_id: distinctId,
      properties: { type: "object", additionalProperties: true, defaultTo: {},
        validator: (value) => !Object.hasOwn(value, "token") && !Object.hasOwn(value, "distinct_id") || "Set the event identity through distinct_id; properties cannot override its token or identity." }
    }, (result) => result?.status === "Ok" &&
      (result.quota_limited === undefined || Array.isArray(result.quota_limited) && result.quota_limited.every((item) => typeof item === "string")), "POST")
  }
});
export { posthogProvider };
