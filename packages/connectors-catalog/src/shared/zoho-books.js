import { createSchema } from "json-rest-schema";
import { zohoRegions } from "./zoho-regions.js";

const zohoBooksIdentifier = (value) => typeof value === "string" && /^[1-9][0-9]{0,29}$/u.test(value);
const zohoBooksOrganizationField = { type: "string", noTrim: true,
  validator: (value) => zohoBooksIdentifier(value) || "Use an organisation ID containing digits only." };

const zohoBooksDefinition = Object.freeze({
  id: "zoho-books", name: "Zoho Books", description: "jskit.connectors.zohoBooks.description",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  oauthClientAuthenticationMethods: ["client_secret_post"],
  scopes: [
    { value: "ZohoBooks.settings.READ", label: "jskit.connectors.zohoBooks.scopes.zohoBooksSettingsREAD.label", recommended: true },
    { value: "ZohoBooks.contacts.READ", label: "jskit.connectors.zohoBooks.scopes.zohoBooksContactsREAD.label", recommended: true },
    { value: "ZohoBooks.invoices.READ", label: "jskit.connectors.zohoBooks.scopes.zohoBooksInvoicesREAD.label", recommended: true },
    ...[
      ["contacts", "jskit.connectors.zohoBooks.scopes.contactsAll.label"], ["invoices", "jskit.connectors.zohoBooks.scopes.invoicesAll.label"], ["customerpayments", "jskit.connectors.zohoBooks.scopes.customerpaymentsAll.label"],
      ["creditnotes", "jskit.connectors.zohoBooks.scopes.creditnotesAll.label"], ["estimates", "jskit.connectors.zohoBooks.scopes.estimatesAll.label"], ["salesorders", "jskit.connectors.zohoBooks.scopes.salesordersAll.label"],
      ["purchaseorders", "jskit.connectors.zohoBooks.scopes.purchaseordersAll.label"], ["bills", "jskit.connectors.zohoBooks.scopes.billsAll.label"], ["expenses", "jskit.connectors.zohoBooks.scopes.expensesAll.label"], ["projects", "jskit.connectors.zohoBooks.scopes.projectsAll.label"]
    ].map(([name, label]) => ({ value: `ZohoBooks.${name}.ALL`, label }))
  ],
  settingsSchema: createSchema({
    region: { type: "string", enum: zohoRegions.map(({ value }) => value), defaultTo: "eu" },
    organizationId: zohoBooksOrganizationField
  }),
  settingsFields: [
    { name: "region", label: "jskit.connectors.zohoBooks.fields.region.label", hint: "jskit.connectors.zohoBooks.fields.region.hint", items: zohoRegions.map(({ value, title }) => ({ value, title })) },
    { name: "organizationId", label: "jskit.connectors.zohoBooks.fields.organizationId.label", hint: "jskit.connectors.zohoBooks.fields.organizationId.hint" }
  ],
  setup: { url: "https://www.zoho.com/books/api/v3/oauth/", steps: [
    "Open the Zoho API Console, add a Server-based Application, and enter its name, homepage and exact backend redirect URI.",
    "Copy the Client ID. Store the selected data center's Client Secret and callback URL in the referenced Env variables. Enable additional regions in the client's Multi DC settings if needed.",
    "Optionally copy an Organization ID from Zoho Books: open the organisation-name menu, then Manage Organizations. Leaving it empty allows discovery after consent; the runtime never chooses the first organisation automatically.",
    "Save configuration and start consent through your application's runtime. Read organisations and settings is needed to verify the connection. Contacts and invoice reads are selected initially.",
    "A shared connection shares its accounting access. Choose each app user's own account when every user must connect separately. Additional scope choices do not add write operations."
  ] }
});

export { zohoBooksDefinition, zohoBooksIdentifier, zohoBooksOrganizationField };
