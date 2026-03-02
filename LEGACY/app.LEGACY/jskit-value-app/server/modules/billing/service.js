import { createService as createBillingProvidersService } from "./lib/providers/index.js";

function createService(options = {}) {
  const billingProvidersService = createBillingProvidersService(options);
  return {
    billingProvidersService
  };
}

export { createService };
