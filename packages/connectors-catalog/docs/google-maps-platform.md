# Google Maps Platform

Import `googleMapsPlatformProvider` from
`@jskit-ai/connectors-catalog/server/google-maps-platform`. The runtime uses Geocoding v3, Places API (New) and Routes API. An optional
browser composition helper uses the Google Maps JavaScript SDK loaded by the app.

## Manual provider setup

1. Sign into Google Cloud Console and select or create the project that will
   own this application's usage. Link billing for Maps usage.
2. Open **APIs & Services → Library**, find **Geocoding API**, and choose
   **Enable**. Enable browser APIs separately if the app will render maps.
   [API setup](https://developers.google.com/maps/documentation/geocoding/guides-v3/get-api-key),
   [enabling services](https://docs.cloud.google.com/service-usage/docs/enable-disable).
3. Open **APIs & Services → Credentials → Create credentials → API key**.
   Name the key for server geocoding. Edit it, restrict allowed APIs to
   **Geocoding API**, and configure suitable server IP restrictions. For the
   additional operations, enable **Places API (New)** and **Routes API** in Library
   and allow those APIs on this server key as well. Save.
4. Store that key as `GOOGLE_MAPS_SERVER_KEY`. In Vibe64, add Google Maps
   Platform and enter `env:GOOGLE_MAPS_SERVER_KEY` in **Server API key reference**.
5. For browser maps, create a different key, enable only the browser APIs the
   app uses, and apply **Websites** restrictions for the deployed and preview
   origins. Store it as `GOOGLE_MAPS_BROWSER_KEY`; enter its optional reference.
   Server keys must not use browser-referrer restrictions or be published in
   client code. [Key restrictions](https://developers.google.com/maps/api-security-best-practices).
6. For advanced map markers enable **Maps JavaScript API**, open **Google Maps
   Platform → Map management → Create map ID**, select **JavaScript**, create it
   and copy its public ID into **Map ID**. `DEMO_MAP_ID` is for development only.
7. Open **Google Maps Platform → Quotas**, select the API and set suitable
   limits. Save source configuration; actual connection verification is a
   separate geocoding request and can incur usage charges. After saving, use
   **Set credential in Env** for `GOOGLE_MAPS_SERVER_KEY`. Save the optional
   browser key separately in Env. Return, enter **Verification address** and
   choose **Connect account**.
   [Quotas and billing](https://developers.google.com/maps/documentation/geocoding/usage-and-billing).

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "maps": {
      "provider": "google-maps-platform",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:GOOGLE_MAPS_SERVER_KEY"
      },
      "settings": { "browserKeyRef": "env:GOOGLE_MAPS_BROWSER_KEY" }
    }
  }
}
```

Use the [API-key source pattern](../patterns/api-key-connection/PATTERN.md)
with this provider, the application's authorization policy and its reference
resolver. File-backed state remains outside source. No database or editor
process is required for CLI use.

```js
await connections.connectApiKey({
  context, integrationId: "maps",
  verificationInput: { address: "Perth WA, Australia" }
});
const locations = await connections.invoke({
  context, integrationId: "maps", operation: "geocoding.forward",
  input: { address: "Perth WA, Australia", language: "en", region: "au" }
});
const addresses = await connections.invoke({
  context, integrationId: "maps", operation: "geocoding.reverse",
  input: { latitude: -31.95, longitude: 115.86 }
});
```

Supply the verification address deliberately. There is no hidden default query;
an omitted address fails before HTTP transport. Verification checks server
geocoding only. It never resolves or verifies the optional browser key. An app
that renders browser maps resolves and publishes that separate key explicitly.
Clearing the optional reference removes it from saved source.

Forward input accepts an address or plus code, optional language and region
bias. Reverse input accepts latitude/longitude and optional language. The
adapter preserves the provider result, including components, geometry and
partial-match indicators. It accepts `ZERO_RESULTS` with an empty list as a
successful lookup, without claiming an address exists.
[Forward response](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding),
[reverse response](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-reverse-geocoding).

Local input limits are 1,000 address characters, latitude ±90 and longitude ±180.
Language codes and two-letter region codes receive syntax checks; the provider
decides availability. Advanced filters, extra computations and v4 operations
are outside this initial adapter.

HTTP-200 `OVER_QUERY_LIMIT`, `REQUEST_DENIED`, `INVALID_REQUEST` and
`UNKNOWN_ERROR` responses become safe failures. `OVER_DAILY_LIMIT` can mean
invalid key, missing billing or a usage cap, so its error asks the operator to
check all three. Provider diagnostic text is not echoed. Ordinary non-2xx errors
use the common transport handling. An HTTP 401 marks an existing connection
as requiring reconnection.
[Status definitions](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding).

## API provisioning and application ownership

An authorized AI can prepare Cloud project creation and API enablement with
Resource Manager/Service Usage or `gcloud`. Account access, billing authority
and provider terms remain operator decisions.
[Project and service preparation](https://docs.cloud.google.com/service-usage/docs/enable-disable).

The API Keys API can create a key at
`POST /v2/projects/{projectNumber}/locations/global/keys`, configure restrictions,
and retrieve its key string. Poll the returned operation to completion before
using the result. This requires authorized Cloud credentials; a Maps API key
cannot create sibling keys. Save resulting values in secret bindings, not
configuration files or command output logs. This package does not execute
provisioning. [API key management](https://docs.cloud.google.com/api-keys/docs/create-manage-api-keys).

The application owner provisions its Cloud project and supplies the appropriate
keys. Two differently named keys in one project still share its project quota.
Billing and usage limits remain the application owner's responsibilities.
[Project quotas](https://developers.google.com/maps/documentation/geocoding/usage-and-billing).

Google additionally recommends separating client and server usage into projects
when their quota needs differ. Choose the application's projects according to
its browser/server usage. Website restrictions use
the application domain, such as its hosting subdomain or custom domain. Server
restrictions use actual outbound IPs, including any configured proxy egress. A per-user
editor VM URL does not substitute for either. These API keys are unrelated to
Google login or OAuth callback registration.
[Client/server restrictions](https://developers.google.com/maps/api-security-best-practices).

## Focused evidence

Six fixture tests cover explicit verification input, file restart, rotation,
owner isolation, separate browser references, input bounds, empty responses,
HTTP-200 errors and transport failures. Editor browser tests cover both
reference fields, invalid values, reload and optional-field removal. The runtime
does not automatically retain geocoding results; applications own display and
retention behavior under the provider's requirements. No live provider use or
sample-app generation is part of this evidence.


## Places, routes and browser composition

- `places.search`: textQuery, optional pageSize (1–20, default 10), pageToken and
  languageCode. Keep the query the same for subsequent pages. Returns places and
  nextPageToken; an absent places array is a legitimate empty result.
- `places.get`: placeId. Both operations request fixed ID, display name, formatted
  address, location, attribution and Google Maps URI fields. These are **billable
  fields** (including Pro-tier fields for Text Search); no free-usage assumption
  or wildcard mask is made. Review current pricing and show required attribution.
- `routes.compute`: originLatitude/originLongitude and destinationLatitude/
  destinationLongitude, with DRIVE (default), WALK or BICYCLE. Returns distance,
  duration and GeoJSON line coordinates. An absent routes array means no route;
  don't display zero minutes as a successful trip. No traffic, waypoint ordering
  or turn-by-turn navigation system is supplied.

The app authorizes/rate-limits requests and resolves only its server key for
backend calls. Places/Routes use a header key; the optional browser key is never
resolved by these operations. Restrict each key and enabled APIs separately.
Geocoding verification does not establish that Places, Routes or browser maps work.

For JavaScript frontends import `mountGoogleMap` from
`@jskit-ai/connectors-catalog/client/google-maps-platform`. First use the
framework's normal [Google SDK loader](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)
with the separately resolved **public browser key**. Wait for SDK readiness and
surface loading/key/billing errors. Give the map container a nonzero height.
Resolve `settings.mapId` as public text. Never pass the server key to this helper.

```js
// After the app's loader resolves Google Maps SDK readiness:
const mounted = await mountGoogleMap({
  element: document.querySelector("#map"), maps: google.maps,
  center: { lat: -31.95, lng: 115.86 }, zoom: 12,
  mapId: configuredMapId,
  markers: [{ position: { lat: -31.95, lng: 115.86 }, title: "DogAndGroom" }],
  path: routeCoordinates.map(([lng, lat]) => ({ lat, lng })),
  signal: componentAbortController.signal
});
// On component removal:
mounted.dispose();
```

`routeCoordinates` is `routes[0].polyline.geoJsonLinestring.coordinates` when a
route exists; pass [] otherwise. The helper creates a native interactive map,
AdvancedMarkerElement markers and an optional route polyline. Marker titles are
text, not HTML. Limits are 100 markers/10,000 route points. It validates inputs,
waits for map/marker libraries and removes overlays/listeners on disposal or
abort. The application owns the container and must dispose before remounting;
it also owns place selection, viewport/route updates and readable error/empty UI.
No SDK or API request is made before the app explicitly loads and invokes it.

Other frameworks use their own browser/native Google Maps tools and the same
config/Env split; they do not need this JavaScript helper or a Vibe64 service.
Keep Google attribution and data-retention/display requirements intact.

**Limitations:** no embedded map designer, SDK loader, autocomplete/session-token
widget, Places photos/reviews, route optimization, transit or navigation product.
For example, a generated app can find a groomer and display its location and a
route, but cannot provide live voice navigation. Editor assistant attachment is
deferred. Controlled HTTP/SDK fixtures do not prove live tiles, routes or billing.

Sources: [Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search),
[Routes reference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes),
[advanced markers](https://developers.google.com/maps/documentation/javascript/advanced-markers/start).
