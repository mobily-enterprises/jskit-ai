import { createSchema } from "json-rest-schema";
import { zohoRegions } from "./zoho-regions.js";

const zohoCrmRegions = Object.freeze(zohoRegions.filter(({ value }) => value !== "sa"));

const zohoCrmDefinition = Object.freeze({
  id: "zoho-crm", name: "Zoho CRM", description: "jskit.connectors.zohoCrm.description",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  oauthClientAuthenticationMethods: ["client_secret_post"],
  scopes: [
    { value: "ZohoCRM.users.READ", label: "jskit.connectors.zohoCrm.scopes.zohoCRMUsersREAD.label", recommended: true },
    { value: "ZohoCRM.modules.leads.READ", label: "jskit.connectors.zohoCrm.scopes.zohoCRMModulesLeadsREAD.label", recommended: true },
    { value: "ZohoCRM.modules.contacts.READ", label: "jskit.connectors.zohoCrm.scopes.zohoCRMModulesContactsREAD.label", recommended: true },
    { value: "ZohoCRM.modules.accounts.READ", label: "jskit.connectors.zohoCrm.scopes.zohoCRMModulesAccountsREAD.label", recommended: true },
    { value: "ZohoCRM.modules.deals.READ", label: "jskit.connectors.zohoCrm.scopes.zohoCRMModulesDealsREAD.label", recommended: true },
    { value: "ZohoCRM.modules.READ", label: "jskit.connectors.zohoCrm.scopes.zohoCRMModulesREAD.label" },
    { value: "ZohoCRM.users.ALL", label: "jskit.connectors.zohoCrm.scopes.zohoCRMUsersALL.label" },
    { value: "ZohoCRM.modules.leads.ALL", label: "jskit.connectors.zohoCrm.scopes.zohoCRMModulesLeadsALL.label" },
    { value: "ZohoCRM.modules.contacts.ALL", label: "jskit.connectors.zohoCrm.scopes.zohoCRMModulesContactsALL.label" },
    { value: "ZohoCRM.modules.accounts.ALL", label: "jskit.connectors.zohoCrm.scopes.zohoCRMModulesAccountsALL.label" },
    { value: "ZohoCRM.modules.deals.ALL", label: "jskit.connectors.zohoCrm.scopes.zohoCRMModulesDealsALL.label" },
    { value: "ZohoCRM.modules.ALL", label: "jskit.connectors.zohoCrm.scopes.zohoCRMModulesALL.label" }
  ],
  settingsSchema: createSchema({
    region: { type: "string", enum: zohoCrmRegions.map(({ value }) => value), defaultTo: "us" },
    environment: { type: "string", enum: ["production", "sandbox", "developer"], defaultTo: "production" }
  }),
  settingsFields: [
    { name: "region", label: "jskit.connectors.zohoCrm.fields.region.label", hint: "jskit.connectors.zohoCrm.fields.region.hint", items: zohoCrmRegions.map(({ value, title }) => ({ value, title })) },
    { name: "environment", label: "jskit.connectors.zohoCrm.fields.environment.label", hint: "jskit.connectors.zohoCrm.fields.environment.hint", items: [
      { value: "production", title: "jskit.connectors.zohoCrm.fields.environment.items.production.title" }, { value: "sandbox", title: "jskit.connectors.zohoCrm.fields.environment.items.sandbox.title" }, { value: "developer", title: "jskit.connectors.zohoCrm.fields.environment.items.developer.title" }
    ] }
  ],
  setup: { url: "https://www.zoho.com/crm/developer/docs/api/v8/register-client.html", steps: [
    "Open the Zoho API Console, choose Server-based Applications, then Create Now. Enter a client name, homepage and the exact backend redirect URI.",
    "Copy the Client ID. Store the Client Secret and callback URL in the referenced Env variables. Use the secret assigned to the selected data center.",
    "For users in other data centers, enable Multi DC in the client's Settings and configure each required region before connecting.",
    "Save configuration, then start consent through your application's runtime. Choose the intended CRM organisation and environment; verification reads the current CRM user.",
    "This adapter only reads the current user, leads, contacts, accounts and deals. Full-access scope choices do not add create, update or delete operations. Read permissions are selected initially. Sharing one connection shares its CRM access; each app user's own account requires a separate authorised connection."
  ] }
});

export { zohoCrmDefinition, zohoCrmRegions };
