import { createSchema } from "json-rest-schema";
import { secretReference } from "@jskit-ai/connectors-core/shared/configuration";

const googleMapsPlatformDefinition = Object.freeze({
  id: "google-maps-platform", name: "Google Maps Platform", description: "Geocode addresses, find places, compute routes and configure browser maps.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "Server API key reference",
  verificationFields: [{ name: "address", required: true, label: "Verification address",
    hint: "Enter an address or plus code. Connecting performs one geocoding request and can incur provider usage charges." }],
  apiKeyReferenceHint: "Reference a server key authorized for Geocoding API. Verification performs one geocoding request using an address you supply and can incur provider usage charges.",
  settingsSchema: createSchema({ browserKeyRef: { ...secretReference, required: false }, mapId: { type: "string", maxLength: 100, validator: value => /^[A-Za-z0-9_-]+$/.test(value) || "Use the map ID from Google Cloud." } }),
  settingsFields: [{ name: "mapId", label: "Map ID (optional)", hint: "Public JavaScript map ID for advanced markers. Create it in Google Maps Platform > Map management. DEMO_MAP_ID is only for development." }, { name: "browserKeyRef", label: "Browser API key reference (optional)", placeholder: "env:GOOGLE_MAPS_BROWSER_KEY",
    hint: "A separate key for browser maps. Restrict it to the actual application websites and APIs. Backend verification does not verify this key." }],
  setup: {
    url: "https://developers.google.com/maps/documentation/geocoding/guides-v3/get-api-key",
    steps: [
      "Select a Google Cloud project with billing and enable Geocoding API. Open APIs & Services > Credentials > Create credentials > API key for server geocoding.",
      "Restrict the server key to Geocoding API and the backend's outbound IPs. Enter env:GOOGLE_MAPS_SERVER_KEY in Server API key reference, Save configuration, then Set credential in Env. Save the real key as GOOGLE_MAPS_SERVER_KEY.",
      "For places and routes, also enable Places API (New) and Routes API in Library, then add them to the server key API restrictions. Place names/address/location use billable data fields; set quotas and review current pricing. Geocoding verification does not test these additional APIs.",
      "For browser maps, enable Maps JavaScript API. Open Google Maps Platform > Map management > Create map ID, select JavaScript and copy the ID into Map ID. The app loads Google's SDK with its separate browser key and gives the map container a height. Advanced markers require a map ID.",
      "For browser maps, create a separate key restricted to the required browser APIs and Websites, including the actual preview and custom domains. Enter env:GOOGLE_MAPS_BROWSER_KEY in Browser API key reference and save that value separately in Env. The app publishes this browser key; never publish the server key.",
      "Save configuration, enter Verification address, then Connect account. This performs one potentially billable geocoding request. It verifies only the server key, not browser maps. No OAuth registration or callback is needed.",
      "Update Env when replacing a key. Disconnect removes local connection state; delete or restrict the key in Google Cloud to revoke provider access. Check existing usage before deleting a key used by other applications."
    ]
  }
});

export { googleMapsPlatformDefinition };
