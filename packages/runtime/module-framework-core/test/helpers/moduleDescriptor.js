import { MODULE_TIERS } from "../../src/shared/descriptor.js";

function moduleDescriptor(overrides = {}) {
  return {
    id: "module-a",
    version: "1.0.0",
    tier: MODULE_TIERS.feature,
    ...overrides
  };
}

export { moduleDescriptor };
