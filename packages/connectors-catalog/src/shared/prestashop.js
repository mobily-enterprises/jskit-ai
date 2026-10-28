import { createSchema } from "json-rest-schema";
import { httpsSiteUrlField } from "./siteUrl.js";

const prestashopDefinition = Object.freeze({
  id: "prestashop", name: "PrestaShop", description: "jskit.connectors.prestashop.description",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "jskit.connectors.prestashop.apiKeyReferenceLabel",
  apiKeyReferenceHint: "jskit.connectors.prestashop.apiKeyReferenceHint",
  settingsSchema: createSchema({ siteUrl: httpsSiteUrlField }),
  settingsFields: [{ name: "siteUrl", label: "jskit.connectors.prestashop.fields.siteUrl.label", placeholder: "https://shop.example.com",
    hint: "jskit.connectors.prestashop.fields.siteUrl.hint" }],
  setup: {
    url: "https://devdocs.prestashop-project.org/9/webservice/tutorials/creating-access/",
    steps: [
      "Open Advanced Parameters, Webservice in your store's back office. Enable PrestaShop Webservice and save.",
      "Choose Add new webservice key, Generate, enter a description and enable the key. Grant GET for products and any required orders access.",
      "In multistore mode select the intended shop association, then save. Store the key in Env and enter its reference here.",
      "Use the final HTTPS store URL. The runtime verifies a product read; it does not verify order permissions or modify store data."
    ]
  }
});

export { prestashopDefinition };
