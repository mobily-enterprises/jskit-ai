import { createSchema } from "json-rest-schema";

const hexHosts = Object.freeze({ standard: "app.hex.tech", eu: "eu.hex.tech", hipaa: "hc.hex.tech" });
const hexEndpointField = { type: "string", enum: Object.keys(hexHosts), defaultTo: "standard" };
const hexDefinition = Object.freeze({
  id: "hex", name: "Hex", description: "Search projects and use Hex Threads through the assistant owner's MCP connection.",
  accountModes: ["assistant"], authenticationMethods: ["oauth2"],
  scopes: [
    { value: "openid", label: "Identify the connected Hex account", recommended: true },
    { value: "profile", label: "Read account profile", recommended: true },
    { value: "email", label: "Read account email", recommended: true },
    { value: "offline_access", label: "Refresh access without repeating sign-in", recommended: true }
  ],
  settingsSchema: createSchema({ endpoint: hexEndpointField }),
  settingsFields: [{ name: "endpoint", label: "Hex workspace endpoint", hint: "Use the endpoint where your Hex workspace lives; register the OAuth client at that endpoint.",
    items: [{ value: "standard", title: "Standard (app.hex.tech)" }, { value: "eu", title: "Europe (eu.hex.tech)" }, { value: "hipaa", title: "HIPAA (hc.hex.tech)" }] }],
  setup: { clientRegistrationEndpoint: (settings) => `https://auth.${hexHosts[settings.endpoint || "standard"]}/oauth2/register`, url: "https://learn.hex.tech/docs/api-integrations/mcp-server", steps: [
    "Confirm your Hex workspace has MCP access and your role is Explorer or higher. Hex currently requires a Team or Enterprise plan.",
    "Choose Standard, Europe or HIPAA in Hex workspace endpoint to match where you sign into Hex. Confirm the Suggested callback URL is the exact route your assistant host will serve. Keep the identity, profile, email and refresh permissions selected.",
    "Choose Register client and connect to create the client for this endpoint and save its credentials privately in development Env. Alternatively copy the endpoint/request from OAuth client registration into your HTTP client. CLI users can call registerHexClient. Register once per host and endpoint; inspect Env before retrying uncertain registration.",
    "For manual registration, copy client_id from the registration response into Client ID and Save configuration. Choose Set credential in Env to store client_secret under the displayed Client secret reference. Choose Set callback in Env to save the exact registered callback. A personal or workspace API token cannot replace these OAuth credentials.",
    "Return, save and choose Connect account. Sign into Hex, select the intended workspace when prompted and approve consent. Verification lists tools without starting a Thread or editing a project.",
    "The host must authorize each tool and its arguments. Identity scopes are not read-only tool permissions; Thread tools can run analysis and consume credits; project editing tools require Editor or higher and the appropriate project permission.",
    "Single-tenant custom Hex domains require separate endpoint verification and are not supported by this initial adapter. Changing endpoint requires a new matching registration and reconnection. Disconnect removes this local grant; the Hex workspace API-access switch and personal-token revocation do not disable MCP access. Saving does not register a client or attach tools."
  ] }
});

export { hexDefinition, hexHosts, hexEndpointField };
