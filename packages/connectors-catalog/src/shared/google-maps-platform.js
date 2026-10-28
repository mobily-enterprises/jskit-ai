import { createSchema } from "json-rest-schema";
import { secretReference } from "@jskit-ai/connectors-core/shared/configuration";

const googleMapsPlatformDefinition = Object.freeze({
  id: "google-maps-platform", name: "Google Maps Platform", description: "jskit.connectors.googleMapsPlatform.description",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "jskit.connectors.googleMapsPlatform.apiKeyReferenceLabel",
  verificationFields: [{ name: "address", required: true, label: "jskit.connectors.googleMapsPlatform.verificationFields.address.label",
    hint: "jskit.connectors.googleMapsPlatform.verificationFields.address.hint" }],
  apiKeyReferenceHint: "jskit.connectors.googleMapsPlatform.apiKeyReferenceHint",
  settingsSchema: createSchema({ browserKeyRef: { ...secretReference, required: false }, mapId: { type: "string", maxLength: 100, validator: value => /^[A-Za-z0-9_-]+$/.test(value) || "Use the map ID from Google Cloud." } }),
  settingsFields: [{ name: "mapId", label: "jskit.connectors.googleMapsPlatform.fields.mapId.label", hint: "jskit.connectors.googleMapsPlatform.fields.mapId.hint" }, { name: "browserKeyRef", label: "jskit.connectors.googleMapsPlatform.fields.browserKeyRef.label", placeholder: "env:GOOGLE_MAPS_BROWSER_KEY",
    hint: "jskit.connectors.googleMapsPlatform.fields.browserKeyRef.hint" }],
  setup: {
    url: "https://developers.google.com/maps/documentation/geocoding/guides-v3/get-api-key",
    steps: [
      "Select a Google Cloud project with billing and enable Geocoding API. Open APIs & Services > Credentials > Create credentials > API key for server geocoding.",
      "Restrict the server key to Geocoding API and the backend's outbound IPs. Enter env:GOOGLE_MAPS_SERVER_KEY in Server API key reference, Save configuration, then Set credential in Env. Save the real key as GOOGLE_MAPS_SERVER_KEY.",
      "For places and routes, also enable Places API (New) and Routes API in Library, then add them to the server key API restrictions. Place names/address/location use billable data fields; set quotas and review current pricing. Geocoding verification does not test these additional APIs.",
      "For browser maps, enable Maps JavaScript API. Open Google Maps Platform > Map management > Create map ID, select JavaScript and copy the ID into Map ID. The app loads Google's SDK with its separate browser key and gives the map container a height. Advanced markers require a map ID.",
      "For browser maps, create a separate key restricted to the required browser APIs and Websites, including the actual preview and custom domains. Enter env:GOOGLE_MAPS_BROWSER_KEY in Browser API key reference and save that value separately in Env. The app exposes this browser key; never expose the server key.",
      "Save configuration, enter Verification address, then Connect account. This performs one potentially billable geocoding request. It verifies only the server key, not browser maps. No OAuth registration or callback is needed.",
      "Update Env when replacing a key. Disconnect removes local connection state; delete or restrict the key in Google Cloud to revoke provider access. Check existing usage before deleting a key used by other applications."
    ]
  }
});

export { googleMapsPlatformDefinition };
