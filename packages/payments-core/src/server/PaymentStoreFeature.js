import { defineFeature } from "@jskit-ai/kernel/server/features";
import { PAYMENT_TABLES } from "./paymentResources.js";
import { createPaymentStore } from "./paymentStore.js";

const PAYMENT_STORE_FEATURE = "payments.store";
const PAYMENT_STORE_SYSTEM_SCOPE = "payment rows are keyed by their merchant and billable subject, which is their scope, not by a workspace or user";

// The owner of the payment tables in a JSKIT application: it provides the payment store on their handles as
// `payments.store`. An application that keeps payments elsewhere passes its own store and leaves this feature out.
const PaymentStoreFeature = defineFeature({
  id: PAYMENT_STORE_FEATURE,
  domain: "payments",
  owns: PAYMENT_TABLES,
  systemScope: PAYMENT_STORE_SYSTEM_SCOPE,
  provides: {
    store: "payments.store"
  },
  /**
   * @param {object} dependencies
   * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
   * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
   */
  setup({ resources, systemContext }) {
    return { store: createPaymentStore({ resources, systemContext }) };
  }
});

export { PAYMENT_STORE_FEATURE, PAYMENT_STORE_SYSTEM_SCOPE, PaymentStoreFeature };
