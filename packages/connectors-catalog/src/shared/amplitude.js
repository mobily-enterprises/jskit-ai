import { createSchema } from "json-rest-schema";

const amplitudeDefinition = Object.freeze({
  id: "amplitude", name: "Amplitude", description: "jskit.connectors.amplitude.description",
  accountModes: ["assistant"], authenticationMethods: ["oauth2"],
  scopes: [
    { value: "mcp:read", label: "jskit.connectors.amplitude.scopes.mcpRead.label", recommended: true },
    { value: "mcp:write", label: "jskit.connectors.amplitude.scopes.mcpWrite.label" },
    { value: "offline_access", label: "jskit.connectors.amplitude.scopes.offlineAccess.label", recommended: true }
  ],
  settingsSchema: createSchema({ region: { type: "string", enum: ["us", "eu"], defaultTo: "us" } }),
  settingsFields: [{ name: "region", label: "jskit.connectors.amplitude.fields.region.label", hint: "jskit.connectors.amplitude.fields.region.hint",
    items: [{ value: "us", title: "jskit.connectors.amplitude.fields.region.items.us.title" }, { value: "eu", title: "jskit.connectors.amplitude.fields.region.items.eu.title" }] }],
  setup: {
    clientRegistrationEndpoint: (settings = {}) => settings.region === "eu"
      ? "https://mcp.eu.amplitude.com/register" : "https://mcp.amplitude.com/register",
    url: "https://amplitude.com/docs/amplitude-ai/amplitude-mcp/other-clients",
    steps: [
      "Select the account's US or EU region and the permissions needed. Set the Suggested callback URL to the route your application actually serves. With a new Client ID, choose Register client and connect: the connection host saves the returned client ID in configuration and the secret and callback in development Env. There is no developer-console app form in this flow.",
      "For an existing client, enter its Client ID and store its secret and exact registered callback in the referenced Env variables. The manual registration request below remains available for CLI users. If registration fails, inspect the provider and Env before retrying; a client may already exist.",
      "Keep Read Amplitude content selected so registration and verification can succeed. Save configuration, begin consent and sign into Amplitude. If access is blocked, an administrator opens Settings → Content Access → MCP to check organization access, then Org Settings → Role Management → AI Features to grant Use MCP (read) and, only when needed, Use MCP (write) to the intended user and projects.",
      "The runtime verifies tool discovery without calling a tool. The assistant host must authorize each tool name and its arguments separately.",
      "This connects the assistant owner's account. It does not send analytics events, attach tools automatically or implement app-user login."
    ]
  }
});

export { amplitudeDefinition };
