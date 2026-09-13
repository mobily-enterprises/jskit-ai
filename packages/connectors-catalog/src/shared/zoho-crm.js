import { createSchema } from "json-rest-schema";
import { zohoRegions } from "./zoho-regions.js";

const zohoCrmRegions = Object.freeze(zohoRegions.filter(({ value }) => value !== "sa"));

const zohoCrmDefinition = Object.freeze({
  id: "zoho-crm", name: "Zoho CRM", description: "Read the connected CRM user and pages of leads, contacts, accounts and deals.",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  oauthClientAuthenticationMethods: ["client_secret_post"],
  scopes: [
    { value: "ZohoCRM.users.READ", label: "Read the connected CRM user", recommended: true },
    { value: "ZohoCRM.modules.leads.READ", label: "Read leads", recommended: true },
    { value: "ZohoCRM.modules.contacts.READ", label: "Read contacts", recommended: true },
    { value: "ZohoCRM.modules.accounts.READ", label: "Read accounts", recommended: true },
    { value: "ZohoCRM.modules.deals.READ", label: "Read deals", recommended: true },
    { value: "ZohoCRM.modules.READ", label: "Read all CRM modules" },
    { value: "ZohoCRM.users.ALL", label: "Full CRM user access" },
    { value: "ZohoCRM.modules.leads.ALL", label: "Full lead access" },
    { value: "ZohoCRM.modules.contacts.ALL", label: "Full contact access" },
    { value: "ZohoCRM.modules.accounts.ALL", label: "Full account access" },
    { value: "ZohoCRM.modules.deals.ALL", label: "Full deal access" },
    { value: "ZohoCRM.modules.ALL", label: "Full access to all CRM modules" }
  ],
  settingsSchema: createSchema({
    region: { type: "string", enum: zohoCrmRegions.map(({ value }) => value), defaultTo: "us" },
    environment: { type: "string", enum: ["production", "sandbox", "developer"], defaultTo: "production" }
  }),
  settingsFields: [
    { name: "region", label: "Data center", hint: "Choose the data center containing your CRM account. Canada uses accounts.zohocloud.ca for OAuth.", items: zohoCrmRegions.map(({ value, title }) => ({ value, title })) },
    { name: "environment", label: "CRM environment", hint: "Choose the same environment and organisation during Zoho consent. Tokens cannot be moved between environments.", items: [
      { value: "production", title: "Production" }, { value: "sandbox", title: "Sandbox" }, { value: "developer", title: "Developer" }
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
