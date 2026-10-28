import { createSchema } from "json-rest-schema";

const shopifyDefinition = Object.freeze({
  id: "shopify", name: "Shopify", description: "jskit.connectors.shopify.description",
  accountModes: ["shared", "assistant"], authenticationMethods: ["oauth2", "api-key"],
  oauthGrantTypes: ["client_credentials"], oauthClientAuthenticationMethods: ["client_secret_post"],
  authenticationLabels: { oauth2: "jskit.connectors.shopify.authenticationLabels.oauth2", "api-key": "jskit.connectors.shopify.authenticationLabels.apiKey" },
  authenticationHint: "jskit.connectors.shopify.authenticationHint",
  apiKeyReferenceLabel: "jskit.connectors.shopify.apiKeyReferenceLabel",
  apiKeyReferenceHint: "jskit.connectors.shopify.apiKeyReferenceHint",
  settingsSchema: createSchema({
    shopDomain: { type: "string", required: true, noTrim: true, maxLength: 77,
      validator: (value) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u.test(value) ||
        "Enter the store's permanent name.myshopify.com domain without a protocol, path or port." }
  }),
  settingsFields: [{ name: "shopDomain", label: "jskit.connectors.shopify.fields.shopDomain.label", placeholder: "your-store.myshopify.com",
    hint: "jskit.connectors.shopify.fields.shopDomain.hint" }],
  scopes: [
    { value: "read_products", label: "jskit.connectors.shopify.scopes.readProducts.label", recommended: true },
    { value: "write_products", label: "jskit.connectors.shopify.scopes.writeProducts.label" }
  ],
  permissionsHint: "jskit.connectors.shopify.permissionsHint",
  assistantActions: [
    { value: "enable", label: "jskit.connectors.shopify.assistantActions.enable.label" },
    { value: "connect", label: "jskit.connectors.shopify.assistantActions.connect.label" },
    { value: "claim", label: "jskit.connectors.shopify.assistantActions.claim.label" },
    { value: "products.list", label: "jskit.connectors.shopify.assistantActions.productsList.label" },
    { value: "products.create", label: "jskit.connectors.shopify.assistantActions.productsCreate.label" },
    { value: "products.update", label: "jskit.connectors.shopify.assistantActions.productsUpdate.label" },
    { value: "products.delete", label: "jskit.connectors.shopify.assistantActions.productsDelete.label" },
    { value: "variants.create", label: "jskit.connectors.shopify.assistantActions.variantsCreate.label" },
    { value: "variants.update", label: "jskit.connectors.shopify.assistantActions.variantsUpdate.label" },
    { value: "variants.delete", label: "jskit.connectors.shopify.assistantActions.variantsDelete.label" },
    { value: "discountCodes.create", label: "jskit.connectors.shopify.assistantActions.discountCodesCreate.label" },
    { value: "discountCodes.update", label: "jskit.connectors.shopify.assistantActions.discountCodesUpdate.label" },
    { value: "discountCodes.delete", label: "jskit.connectors.shopify.assistantActions.discountCodesDelete.label" },
    { value: "priceRules.create", label: "jskit.connectors.shopify.assistantActions.priceRulesCreate.label" },
    { value: "priceRules.update", label: "jskit.connectors.shopify.assistantActions.priceRulesUpdate.label" },
    { value: "priceRules.delete", label: "jskit.connectors.shopify.assistantActions.priceRulesDelete.label" }
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
