import { createSchema } from "json-rest-schema";

const chargebeeDefinition = Object.freeze({
  id: "chargebee", name: "Chargebee", description: "Manage customers and subscriptions, read invoices and launch hosted checkout for a Chargebee site.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  settingsSchema: createSchema({
    siteName: { type: "string", required: true, minLength: 1, maxLength: 63,
      validator: (value) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(value) || "Enter the site name without .chargebee.com, a URL or spaces." }
  }),
  settingsFields: [{ name: "siteName", label: "Site name", placeholder: "acme-test",
    hint: "Your Chargebee site name, without .chargebee.com. Test and live sites use different keys." }],
  setup: {
    url: "https://www.chargebee.com/docs/billing/2.0/site-configuration/api_keys",
    steps: [
      "Sign into the intended test or live Chargebee site as an owner or administrator. Copy its site name without .chargebee.com.",
      "Open Settings > Configure Chargebee > API Keys and Events (called API Keys and Webhooks in some views), then API keys.",
      "Choose Add API Key. For reading only, select Read-Only Key with transactional-data and product-catalog reads, or Read-only: All. For customer changes, subscriptions, hosted checkout or portal sessions, choose Full-Access Key with Write access. Name it and click Create Key.",
      "Copy the issued key. Enter the site name here and env:CHARGEBEE_API_KEY in API key reference, then save. Choose Set credential in Env, paste the key as CHARGEBEE_API_KEY and save it there. A publishable or product-catalog-only key cannot read customers.",
      "Return here and choose Connect account or Verify again. Check connection only reads saved status. Verification lists customers without changing billing data. No OAuth registration or callback URL is needed.",
      "This adapter uses Product Catalog 2.0 item prices. Prepare the product and recurring price in Chargebee first, then let the app choose that item_price_id; the first checkout item must be a plan. Test and live catalogue IDs are separate.",
      "Creating a hosted checkout URL does not prove payment or an active subscription. The app must retrieve the hosted page and verify its customer, subscription and invoice state before granting access. Portal URLs grant access to a customer’s billing account and must be issued only after authenticating that customer.",
      "If access fails, check that the site and key belong to the same test or live environment and that the key allows transactional-data reads. To rotate, create a replacement key and update Env before revoking the old key in Chargebee. Disconnect only removes the application connection; it does not revoke the provider key."
    ]
  }
});
export { chargebeeDefinition };
