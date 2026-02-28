import { resolveScopedServiceOptions as resolveScopedServiceOptionsBase } from "../../../shared/scopedServiceOptions.js";

function resolveScopedServiceOptions(options = {}) {
  return resolveScopedServiceOptionsBase(options, ["chatServiceOptions", "chatRealtimeServiceOptions"]);
}

export { resolveScopedServiceOptions };
