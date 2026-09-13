import { createHash, randomUUID } from "node:crypto";
import { PaymentError } from "./service.js";

const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const priceFields = (plan) => ({ amount: plan.amount, currency: plan.currency, interval: plan.interval });
const samePrice = (a, b) => fingerprint(priceFields(a)) === fingerprint(priceFields(b));

// Trusted application service. Hosts must authorize catalogue management before
// invoking it. No provider mutation happens while merely reading configuration.
function createPaymentCatalogue({ store, adapter, scope, configuration }) {
  const plans = structuredClone(configuration.plans);
  const merchant = structuredClone(scope);
  const environment = configuration.environments[merchant.environment];
  if (!environment || environment.integrationId !== merchant.integrationId || environment.providerAccountId !== merchant.providerAccountId) {
    throw new PaymentError("payment_scope_invalid", "Catalogue scope does not match its configured environment.", 403);
  }
  async function preview() {
    const state = await store.inspectCatalogue(merchant);
    const changes = [];
    const drift = [];
    for (const [planId, plan] of Object.entries(plans)) {
      const binding = state.plans[planId];
      if (!binding) changes.push({ action: "create-product", planId, name: plan.name });
      else {
        const actualProduct = await adapter.readProduct(binding.productId);
        if (actualProduct.name !== binding.name) drift.push({ planId, reason: "The product name changed in the provider dashboard." });
        if (binding.name !== plan.name) changes.push({ action: "rename-product", planId, productId: binding.productId, name: plan.name });
        if (binding.priceId) {
          const actual = await adapter.readPrice(binding.priceId);
          if (actual.productId !== binding.productId || !samePrice(actual, binding) || actual.active !== true) drift.push({ planId, reason: "The provider price differs from its saved binding." });
        }
      }
      if (!binding?.priceId || !samePrice(binding, plan)) changes.push({ action: "create-price", planId, ...priceFields(plan) });
    }
    const removed = Object.keys(state.plans).filter((planId) => !Object.hasOwn(plans, planId));
    const result = { environment: merchant.environment, providerAccountId: merchant.providerAccountId, changes, drift, removed, revision: state.revision || 0,
      pending: state.pending || null };
    return { ...result, reviewId: fingerprint(result) };
  }
  async function publish({ reviewId }) {
    const review = await preview();
    if (review.reviewId !== reviewId || review.drift.length || review.pending) throw new PaymentError("payment_catalogue_review_required", "Review the current catalogue and resolve provider drift or unfinished requests first.", 409);
    const completed = [];
    let expectedRevision = review.revision;
    for (const change of review.changes) {
      const token = randomUUID();
      const pending = await store.withCatalogue(merchant, async (state) => {
        if (state.pending) throw new PaymentError("payment_catalogue_pending", "Another catalogue request needs resolution.", 409);
        if ((state.revision || 0) !== expectedRevision) throw new PaymentError("payment_catalogue_review_required", "Another publication changed the catalogue; review again.", 409);
        const current = state.plans[change.planId];
        // Reject another publisher changing this plan after the reviewed read.
        if (change.action === "create-product" && current) throw new PaymentError("payment_catalogue_review_required", "This plan changed; review again.", 409);
        if (change.action === "rename-product" && current?.productId !== change.productId) throw new PaymentError("payment_catalogue_review_required", "This product changed; review again.", 409);
        if (change.action === "create-price" && (!current?.productId || (current.priceId && samePrice(current, change)))) throw new PaymentError("payment_catalogue_review_required", "This price changed; review again.", 409);
        const operation = { ...change, token, productId: current?.productId };
        state.pending = operation;
        return operation;
      });
      let result;
      try {
        if (pending.action === "create-product") result = await adapter.createProduct({ name: pending.name, requestId: token });
        else if (pending.action === "rename-product") result = await adapter.renameProduct({ id: pending.productId, name: pending.name, requestId: token });
        else result = await adapter.createPrice({ ...pending, requestId: token });
      } catch {
        throw new PaymentError("payment_catalogue_uncertain", "Catalogue publication stopped. Inspect the pending provider request before retrying; completed items are preserved.", 409);
      }
      await finish(pending, result);
      expectedRevision++;
      completed.push({ ...change, id: result.id });
    }
    return { completed, removed: review.removed };
  }
  async function finish(pending, result) {
    if (typeof result?.id !== "string" || !result.id) throw new PaymentError("payment_provider_result_invalid", "The provider did not return an object ID.", 502);
    await store.withCatalogue(merchant, async (state) => {
      if (state.pending?.token !== pending.token) throw new PaymentError("payment_catalogue_review_required", "The pending catalogue request changed.", 409);
      const current = state.plans[pending.planId];
      if (pending.action === "create-product") state.plans[pending.planId] = { productId: result.id, name: pending.name };
      else if (pending.action === "rename-product") current.name = pending.name;
      else {
        if (current.priceId) state.history.push({ planId: pending.planId, ...current });
        state.plans[pending.planId] = { ...current, priceId: result.id, ...priceFields(pending) };
      }
      state.revision = (state.revision || 0) + 1;
      delete state.pending;
    });
  }
  async function recover({ reviewId, providerId, confirmedNotCreated = false }) {
    const review = await preview();
    if (review.reviewId !== reviewId) throw new PaymentError("payment_catalogue_review_required", "The recovery review changed. Inspect the current pending operation first.", 409);
    const pending = review.pending;
    if (!pending) return { pending: false };
    if (confirmedNotCreated) {
      // Trusted app administrator must supply actual provider inspection evidence.
      // This parameter must not be exposed as an unauthenticated browser command.
      await store.withCatalogue(merchant, async (current) => {
        if (current.pending?.token !== pending.token) throw new PaymentError("payment_catalogue_review_required", "The pending request changed.", 409);
        delete current.pending;
      });
      return { pending: false, retryAllowed: true };
    }
    if (typeof providerId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(providerId)) {
      throw new PaymentError("payment_input_invalid", "Supply the exact provider object ID to recover.");
    }
    const result = pending.action === "create-price" ? await adapter.readPrice(providerId) : await adapter.readProduct(providerId);
    if (!result || result.id !== providerId || (pending.action === "create-price" && (result.active !== true || result.productId !== pending.productId || !samePrice(result, pending))) ||
        (pending.action !== "create-price" && result.name !== pending.name) ||
        (pending.action === "rename-product" && providerId !== pending.productId)) {
      throw new PaymentError("payment_catalogue_review_required", "The provider object does not match the pending operation.", 409);
    }
    await finish(pending, { id: providerId });
    return { pending: false };
  }
  return Object.freeze({ preview, publish, recover });
}

export { createPaymentCatalogue };
