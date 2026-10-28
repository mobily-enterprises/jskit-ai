import { PaymentError } from "./errors.js";

const DEFAULT_CHECKS = Object.freeze([
  { id: "credentials", status: "unknown", detail: "Check the provider credentials for this environment." },
  { id: "account", status: "unknown", detail: "Confirm the configured merchant owns these credentials." },
  { id: "charges", status: "manual", detail: "Confirm payment acceptance is enabled in the provider dashboard." },
  { id: "payouts", status: "manual", detail: "Confirm payout eligibility in the provider dashboard." },
  { id: "catalogue", status: "unknown", detail: "Inspect the saved products and prices." },
  { id: "webhook", status: "unknown", detail: "Verify the deployed webhook route, signing secret and subscribed events." },
  { id: "checkout", status: "unknown", detail: "Verify app checkout and portal routes, authorization and return handling." },
  { id: "site", status: "manual", detail: "Review required site content and provider domain or website approval." },
  { id: "deployment", status: "unknown", detail: "Verify the intended release uses this configuration and environment." }
]);
// Only these checks take their result from the application's own evidence.
const APPLICATION_CHECKS = ["webhook", "checkout", "site", "deployment"];

// App-server inspection, invoked only after the host authorizes management.
// Missing app evidence stays unknown; provider errors never become display text.
function createPaymentReadiness({ adapter, catalogue, scope, inspectApplication }) {
  const merchant = structuredClone(scope);
  if (!["sandbox", "live"].includes(merchant?.environment) || !merchant.providerAccountId) throw new TypeError("Supply the configured payment merchant scope.");
  async function inspect() {
    const checks = new Map(DEFAULT_CHECKS.map((check) => [check.id, { ...check }]));
    const set = (id, status, detail) => Object.assign(checks.get(id), { status, detail });
    let provider;
    try { provider = await adapter.verifyAccount(); }
    catch { set("credentials", "failed", "Provider verification failed. Check the account, credentials and environment."); }
    if (provider) {
      if (provider.environment !== merchant.environment || (provider.accountId && provider.accountId !== merchant.providerAccountId)) {
        throw new PaymentError("payment_scope_invalid", "Readiness returned a different payment account or environment.", 403, {
          messageCode: "payments.scope.readinessMismatch"
        });
      }
      const verified = provider.credentialsVerified === true || provider.accountId === merchant.providerAccountId;
      set("credentials", verified ? "passed" : "unknown", verified
        ? "The provider accepted credential verification for this environment." : "The provider returned no affirmative credential verification.");
      const accountMatches = provider.accountId === merchant.providerAccountId;
      set("account", accountMatches ? "passed" : "manual", accountMatches
        ? "The provider account matches the saved merchant identity." : "This provider check does not establish merchant identity. Confirm it in the provider dashboard.");
      for (const [id, property] of [["charges", "chargesEnabled"], ["payouts", "payoutsEnabled"]]) {
        if (typeof provider[property] === "boolean") {
          set(id, provider[property] ? "passed" : "failed", `The provider reports ${id} ${provider[property] ? "enabled" : "not enabled"}.`);
        }
      }
      try {
        const review = await catalogue.preview();
        if (review.environment !== merchant.environment || review.providerAccountId !== merchant.providerAccountId) throw new Error("scope");
        const unresolved = Boolean(review.pending || review.changes.length || review.drift.length || review.removed.length);
        set("catalogue", unresolved ? "failed" : "passed",
          unresolved ? "Catalogue changes, drift, removed plans or an unresolved write need review." : "Saved plans match their published provider products and prices.");
      } catch { set("catalogue", "failed", "Catalogue inspection failed. Review the application's catalogue command and provider access."); }
    }
    if (inspectApplication) {
      let evidence;
      try { evidence = await inspectApplication(); } catch { evidence = {}; }
      for (const id of APPLICATION_CHECKS) {
        const value = evidence?.[id];
        if (value === undefined) continue;
        if (!value || !["passed", "failed", "unknown", "manual"].includes(value.status) || typeof value.detail !== "string" ||
          !value.detail.trim() || value.detail.length > 500 || /[\p{Cc}\p{Cf}]/u.test(value.detail)) {
          throw new PaymentError("payment_readiness_invalid", "App readiness checks must return bounded status and safe explanatory text.");
        }
        set(id, value.status, value.detail);
      }
    }
    return { paymentEnvironment: merchant.environment, providerAccountId: merchant.providerAccountId, checks: [...checks.values()] };
  }
  return Object.freeze({ inspect });
}

export { createPaymentReadiness };
