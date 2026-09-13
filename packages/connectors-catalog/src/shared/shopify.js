import { createSchema } from "json-rest-schema";

const shopifyDefinition = Object.freeze({
  id: "shopify", name: "Shopify", description: "Connect a Shopify store and control what the assistant may change.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["oauth2", "api-key"],
  oauthGrantTypes: ["client_credentials"], oauthClientAuthenticationMethods: ["client_secret_post"],
  authenticationLabels: { oauth2: "App in your Shopify organization", "api-key": "Existing Admin API access token" },
  authenticationHint: "Client credentials require the app and store in the same Shopify organization. Connecting another merchant requires a separate Shopify installation flow.",
  apiKeyReferenceLabel: "Admin API access token reference",
  apiKeyReferenceHint: "Use env:SHOPIFY_ADMIN_TOKEN. A Storefront token, client secret or App Automation Token cannot be used here.",
  settingsSchema: createSchema({
    shopDomain: { type: "string", required: true, noTrim: true, maxLength: 77,
      validator: (value) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u.test(value) ||
        "Enter the store's permanent name.myshopify.com domain without a protocol, path or port." }
  }),
  settingsFields: [{ name: "shopDomain", label: "Shopify store domain", placeholder: "your-store.myshopify.com",
    hint: "Use the permanent myshopify.com address, including when your storefront uses a custom domain." }],
  scopes: [
    { value: "read_products", label: "Read products", recommended: true },
    { value: "write_products", label: "Create, update and delete products" }
  ],
  permissionsHint: "Match the scopes approved for the installed Shopify app. Write access includes reads. Assistant permission choices do not grant Shopify scopes or staff permissions.",
  assistantActions: [
    { value: "enable", label: "Enable Shopify" },
    { value: "connect", label: "Connect your Shopify store" },
    { value: "claim", label: "Claim your store" },
    { value: "products.list", label: "Read products" },
    { value: "products.create", label: "Create product" },
    { value: "products.update", label: "Update product" },
    { value: "products.delete", label: "Delete product" },
    { value: "variants.create", label: "Add product variant" },
    { value: "variants.update", label: "Update product variant" },
    { value: "variants.delete", label: "Delete product variant" },
    { value: "discountCodes.create", label: "Create discount code" },
    { value: "discountCodes.update", label: "Update discount code" },
    { value: "discountCodes.delete", label: "Delete discount code" },
    { value: "priceRules.create", label: "Create price rule" },
    { value: "priceRules.update", label: "Update price rule" },
    { value: "priceRules.delete", label: "Delete price rule" }
  ],
  setup: { url: "https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant", steps: [
    "Open the Shopify Dev Dashboard, choose your organization, open Apps and create an app for your store.",
    "Create and release an app version with read_products; add write_products only for product changes. Install the app on the store.",
    "Open the app's Settings and copy its Client ID. Put the Client Secret in Env and enter its reference here.",
    "Use the store's permanent myshopify.com domain. The client-credentials mode requires both app and store to belong to the same Shopify organization.",
    "An existing Admin API token can be supplied through Env instead. It grants access as the installed app, not as each shopper or staff member.",
    "Assistant permissions govern requests made through an assistant runtime. Store creation, claiming, additional merchant consent, variants and discounts require the remaining Shopify flows."
  ] }
});

export { shopifyDefinition };
