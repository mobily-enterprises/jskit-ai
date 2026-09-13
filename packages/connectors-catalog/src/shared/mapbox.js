import { createSchema } from "json-rest-schema";
import { secretReference } from "@jskit-ai/connectors-core/shared/configuration";

const mapboxDefinition = Object.freeze({
  id: "mapbox", name: "Mapbox", description: "Validate a backend access token and look up places or coordinates.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key", "none"], scopes: [],
  authenticationMethodsForSettings: settings => settings?.usage === "browser" ? ["none"] : ["api-key"],
  configurationOnlyForSettings: settings => settings?.usage === "browser",
  apiKeyReferenceLabel: "Backend access token reference",
  apiKeyReferenceHint: "Use a reference to a token for backend requests. It may be a public (pk.) or secret (sk.) token; browser URL restrictions can block backend geocoding.",
  settingsSchema: settings => createSchema({
    usage: { type: "string", enum: ["backend", "browser"], defaultTo: "backend" },
    publicTokenRef: { ...secretReference, required: settings?.usage === "browser" }
  }),
  settingsFields: [{ name: "usage", label: "Mapbox usage", credentialScope: value => value,
    items: [{ title: "Backend geocoding and optional browser maps", value: "backend" }, { title: "Browser maps only", value: "browser" }] }, { name: "publicTokenRef", environmentCredential: { label: "Public browser token", public: true }, label: "Public browser token reference", placeholder: "env:MAPBOX_PUBLIC_TOKEN",
    hint: "Required for browser-only mode; optional with backend geocoding. Separate pk. token for Mapbox in your browser. The application may publish this value; backend verification does not verify its restrictions." }],
  setup: {
    url: "https://docs.mapbox.com/accounts/guides/tokens/",
    stepsForSettings(settings) { return settings?.usage === "browser" ? [
      "In Mapbox Developer Console > Access Tokens > Create a token, create a public pk. token with styles:read and fonts:read for your map. Never use a secret sk. token in browser code.",
      "Choose Browser maps only here, enter env:MAPBOX_PUBLIC_TOKEN in Public browser token reference and Save configuration. Store that pk. value in project Env. Your app deliberately exposes only this public token to its map SDK. No backend token, account verification or OAuth callback is needed.",
      "Restrict the token to the actual app hosting/custom and preview URLs. Include localhost only for development. Default public tokens cannot be URL-restricted; create a new token. Wildcards and missing Referer headers do not work with these restrictions.",
      "Use the framework's Mapbox GL JS integration, import its CSS, give the map container a height and preserve attribution. Set accessToken from this public Env binding; handle SDK errors and call map.remove when the view closes. Saving configuration does not install the SDK or test the token's domain restrictions.",
      "LIMITATIONS: no map editor, turn-by-turn navigation UI, offline tiles or automatic SDK installation. Example: your app can display a map using its native SDK, but saving this form does not create a map page. Rotate the token in Mapbox and update/redeploy the public configuration."
    ] : this.steps; },
    steps: [
      "Sign into Mapbox Developer Console → Access Tokens → Create a token. Name it for this application and environment. Select only the scopes your APIs need; geocoding can use a public pk. token. Copy a secret sk. token immediately: it is shown only once.",
      "For backend geocoding, enter env:MAPBOX_BACKEND_TOKEN in Backend access token reference. Use a token without browser URL restrictions: backend requests have no browser referrer. Never publish a secret sk. token in browser code.",
      "For browser maps, create a separate public pk. token with the SDK’s map scopes, including styles:read and fonts:read. Enter env:MAPBOX_PUBLIC_TOKEN in Public browser token reference. The application must deliberately load this public value; this connector does not render a map.",
      "Restrict the browser token to the deployed application URLs, adding preview, custom domains and localhost when needed. Create a new token rather than using the default public token, which cannot be URL-restricted. Wildcards are unsupported; blocking the Referer header can cause 403 errors.",
      "Save configuration, then use Set credential in Env for MAPBOX_BACKEND_TOKEN and Open Env for MAPBOX_PUBLIC_TOKEN if supplied. Store token values there, not in reference fields. Connect account verifies only the backend token’s validity; it does not test geocoding entitlement or the optional browser token. No OAuth app or callback URL is needed.",
      "For routes, directions.get accepts driving, driving-traffic, walking or cycling with 2–25 longitude/latitude waypoints. It returns GeoJSON, metres and seconds. Handle NoRoute/NoSegment as unavailable routes and draw successful geometry using your app's native map SDK. No map editor, offline tiles, navigation UI or automatic SDK installation is included.",
      "To rotate, create a replacement token, update its Env value and verify again before deleting the old token in Mapbox. Update and redeploy browser configuration when its public token changes. Disconnect removes the local connection; it does not delete either Mapbox token."
    ]
  }
});
export { mapboxDefinition };
