import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createResourceRuntime } from "@jskit-ai/resource-runtime/server";
import { createResourceHost } from "@jskit-ai/resource-runtime/server/resourceHost";
import { PAYMENT_STORE_FEATURE, PAYMENT_STORE_SYSTEM_SCOPE } from "./PaymentStoreFeature.js";
import { PAYMENT_TABLES } from "./paymentResources.js";
import { createPaymentStore } from "./paymentStore.js";

/**
 * The payment store for code outside a JSKIT server, such as a script or a hand-written composition: it owns the
 * payment tables through a resource runtime of its own on the application's Knex and answers what PaymentStoreFeature's
 * store answers. A JSKIT application uses PaymentStoreFeature instead, so its tables have one owner.
 * @param {{ knex: import("@jskit-ai/database-runtime/server/types").RuntimeKnex }} dependencies
 * @returns {import("./types.js").PaymentStore}
 */
function createKnexPaymentStore({ knex }) {
  // readable-check: allow method-probe - input validation: the application passes its own Knex instance
  if (typeof knex !== "function" || typeof knex.transaction !== "function") {
    throw new TypeError("createKnexPaymentStore requires the application's Knex instance.");
  }
  let ready = null;
  async function compose() {
    const runtime = createResourceRuntime({ api: await createResourceHost({ knex, logger: silentLogger }) });
    const resources = await runtime.own(PAYMENT_STORE_FEATURE, PAYMENT_TABLES);
    const systemContext = (reason) => runtime.createSystemContext({ feature: PAYMENT_STORE_FEATURE, systemScope: PAYMENT_STORE_SYSTEM_SCOPE, reason });
    return createPaymentStore({ resources, systemContext });
  }
  // The handles are built once, on the first call; a failed build is tried again on the next one.
  function store() {
    ready ||= compose().catch((error) => {
      ready = null;
      throw error;
    });
    return ready;
  }

  async function inspect(scope) {
    return (await store()).inspect(scope);
  }
  async function withAccount(scope, work) {
    return (await store()).withAccount(scope, work);
  }
  async function bindCustomer(scope, customerId, subjectId) {
    return (await store()).bindCustomer(scope, customerId, subjectId);
  }
  async function resolveCustomer(scope, customerId) {
    return (await store()).resolveCustomer(scope, customerId);
  }
  async function inspectCatalogue(scope) {
    return (await store()).inspectCatalogue(scope);
  }
  async function withCatalogue(scope, work) {
    return (await store()).withCatalogue(scope, work);
  }

  return Object.freeze({
    inspect,
    withAccount,
    bindCustomer,
    resolveCustomer,
    inspectCatalogue,
    withCatalogue
  });
}

export { createKnexPaymentStore };
