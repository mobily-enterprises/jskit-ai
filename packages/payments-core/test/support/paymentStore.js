import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { ResourceRuntimeProvider } from "@jskit-ai/resource-runtime/server";
import { PaymentStoreFeature } from "../../src/server/storage.js";

/**
 * The payment store on a test's own Knex, as an application gets it: PaymentStoreFeature owning the payment tables
 * through the resource runtime and providing `payments.store`. The runtime holds no timers or connections of its own,
 * and the Knex stays the test's.
 * @param {import("knex").Knex} knex
 * @returns {Promise<import("../../src/server/types.js").PaymentStore>}
 */
export async function createTestPaymentStore(knex) {
  let store = null;
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider,
      ActionProvider,
      defineProvider({ id: "test.database", provides: { database: "runtime.database" }, setup: () => ({ database: { knex } }) }),
      ResourceRuntimeProvider,
      PaymentStoreFeature,
      defineProvider({
        id: "test.payments",
        requires: { payments: "payments.store" },
        setup({ payments }) {
          store = payments;
        }
      })
    ]
  });
  await runtime.start();
  return store;
}
