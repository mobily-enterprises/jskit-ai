import { createSchema } from "json-rest-schema";
import { httpsSiteUrlField } from "./siteUrl.js";

const prestashopDefinition = Object.freeze({
  id: "prestashop", name: "PrestaShop", description: "Read products and orders from your PrestaShop store.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "Webservice API key reference",
  apiKeyReferenceHint: "Store the Webservice key outside source. Grant GET for products, and for orders if the application needs order reads.",
  settingsSchema: createSchema({ siteUrl: httpsSiteUrlField }),
  settingsFields: [{ name: "siteUrl", label: "Store URL", placeholder: "https://shop.example.com",
    hint: "Use the HTTPS store address before /api, keeping any installation subdirectory." }],
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
