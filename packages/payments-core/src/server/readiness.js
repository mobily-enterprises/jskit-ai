import { PaymentError } from "./service.js";

// App-server inspection, invoked only after the host authorizes management.
// Missing app evidence stays unknown; provider errors never become display text.
function createPaymentReadiness({ adapter, catalogue, scope, inspectApplication }) {
  const merchant = structuredClone(scope);
  if (!["sandbox", "live"].includes(merchant?.environment) || !merchant.providerAccountId) throw new TypeError("Supply the configured payment merchant scope.");
  async function inspect() {
    const checks = [
      { id: "credentials", status: "unknown", detail: "Check the provider credentials for this environment." },
      { id: "account", status: "unknown", detail: "Confirm the configured merchant owns these credentials." },
      { id: "charges", status: "manual", detail: "Confirm payment acceptance is enabled in the provider dashboard." },
      { id: "payouts", status: "manual", detail: "Confirm payout eligibility in the provider dashboard." },
      { id: "catalogue", status: "unknown", detail: "Inspect the saved products and prices." },
      { id: "webhook", status: "unknown", detail: "Verify the deployed webhook route, signing secret and subscribed events." },
      { id: "checkout", status: "unknown", detail: "Verify app checkout and portal routes, authorization and return handling." },
      { id: "site", status: "manual", detail: "Review required site content and provider domain or website approval." },
      { id: "deployment", status: "unknown", detail: "Verify the intended release uses this configuration and environment." }
    ];
    let provider;
    try { provider = await adapter.verifyAccount(); }
    catch { checks[0] = { id: "credentials", status: "failed", detail: "Provider verification failed. Check the account, credentials and environment." }; }
    if (provider) {
      if (provider.environment !== merchant.environment || (provider.accountId && provider.accountId !== merchant.providerAccountId)) {
        throw new PaymentError("payment_scope_invalid", "Readiness returned a different payment account or environment.", 403);
      }
      const verified = provider.credentialsVerified === true || provider.accountId === merchant.providerAccountId;
      checks[0] = { id: "credentials", status: verified ? "passed" : "unknown", detail: verified
        ? "The provider accepted credential verification for this environment." : "The provider returned no affirmative credential verification." };
      checks[1] = { id: "account", status: provider.accountId === merchant.providerAccountId ? "passed" : "manual",
        detail: provider.accountId === merchant.providerAccountId ? "The provider account matches the saved merchant identity." : "This provider check does not establish merchant identity. Confirm it in the provider dashboard." };
      for (const [index, property] of [[2, "chargesEnabled"], [3, "payoutsEnabled"]]) {
        if (typeof provider[property] === "boolean") checks[index] = { id: checks[index].id, status: provider[property] ? "passed" : "failed",
          detail: `The provider reports ${checks[index].id} ${provider[property] ? "enabled" : "not enabled"}.` };
      }
      try {
        const review = await catalogue.preview();
        if (review.environment !== merchant.environment || review.providerAccountId !== merchant.providerAccountId) throw new Error("scope");
        const unresolved = Boolean(review.pending || review.changes.length || review.drift.length || review.removed.length);
        checks[4] = { id: "catalogue", status: unresolved ? "failed" : "passed",
          detail: unresolved ? "Catalogue changes, drift, removed plans or an unresolved write need review." : "Saved plans match their published provider products and prices." };
      } catch { checks[4] = { id: "catalogue", status: "failed", detail: "Catalogue inspection failed. Review the application's catalogue command and provider access." }; }
    }
    if (inspectApplication) {
      let evidence;
      try { evidence = await inspectApplication(); } catch { evidence = {}; }
      for (const check of checks.slice(5)) {
        const value = evidence?.[check.id];
        if (value === undefined) continue;
        if (!value || !["passed", "failed", "unknown", "manual"].includes(value.status) || typeof value.detail !== "string" ||
          !value.detail.trim() || value.detail.length > 500 || /[\p{Cc}\p{Cf}]/u.test(value.detail)) {
          throw new PaymentError("payment_readiness_invalid", "App readiness checks must return bounded status and safe explanatory text.");
        }
        check.status = value.status;
        check.detail = value.detail;
      }
    }
    return { paymentEnvironment: merchant.environment, providerAccountId: merchant.providerAccountId, checks };
  }
  return Object.freeze({ inspect });
}

export { createPaymentReadiness };
