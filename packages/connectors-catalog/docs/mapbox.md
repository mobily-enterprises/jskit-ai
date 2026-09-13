# Mapbox

Import `mapboxProvider` from `@jskit-ai/connectors-catalog/server/mapbox`.
This fragment verifies a backend token and performs forward/reverse geocoding.
Browser maps may use a separate public-token reference in the same configuration.

## Manual provider setup

1. Sign into Mapbox and open **Access Tokens** in Developer Console.
2. Choose **Create a token** and name it for the application/environment.
   Copy a secret token immediately: Mapbox shows it only once.
   Select only the scopes needed by the intended APIs. Geocoding accepts a
   public token; secret scopes produce a private token that stays on the server.
3. Store the backend token as `MAPBOX_BACKEND_TOKEN`. In Vibe64, enter
   `env:MAPBOX_BACKEND_TOKEN` in **Backend access token reference**.
4. For browser maps, create a separate public token with the map scopes the
   chosen SDK requires, including `styles:read` and `fonts:read` for styled maps. Add its allowed application URLs and store it as
   `MAPBOX_PUBLIC_TOKEN`; enter `env:MAPBOX_PUBLIC_TOKEN` in the optional field.
5. **Save configuration**, then use **Set credential in Env** for
   `MAPBOX_BACKEND_TOKEN`. Use **Open Env** to store `MAPBOX_PUBLIC_TOKEN` if
   supplied. Token values belong in Env, not the reference fields.
6. **Connect account** verifies the backend token through the application runtime.
   It does not render a map, test geocoding entitlement or validate the optional
   browser token. No OAuth registration or callback is involved.
7. To rotate, create a replacement token, update Env and verify again before
   deleting the old token in Mapbox. Redeploy browser configuration when its
   public token changes. Local disconnect does not delete provider tokens.

URL-restricted tokens can return 403 for backend or CLI requests with no
matching referrer. Use a backend token appropriate for server calls; the runtime
does not fabricate a browser referrer. The default public token cannot have URL
restrictions added. Create a separate token for a restricted browser deployment.
[Token management](https://docs.mapbox.com/accounts/guides/tokens/).

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "maps": {
      "provider": "mapbox",
      "displayName": "Places",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "api-key", "secretRef": "env:MAPBOX_BACKEND_TOKEN" },
      "settings": { "publicTokenRef": "env:MAPBOX_PUBLIC_TOKEN" }
    }
  }
}
```

Compose the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with
this provider and an application authorization policy. The file store uses
private text files outside source; the CLI does not need an editor or database.

```js
await connections.connectApiKey({ context, integrationId: "maps" });
const places = await connections.invoke({
  context, integrationId: "maps", operation: "geocoding.forward",
  input: { q: "Perth", limit: 5 }
});
const address = await connections.invoke({
  context, integrationId: "maps", operation: "geocoding.reverse",
  input: { longitude: 115.86, latitude: -31.95 }
});
```

`token.read` calls `GET /tokens/v2?access_token=...`. Mapbox returns a parsed
token and a validity code. Invalid, expired or revoked tokens can arrive with
HTTP 200; the adapter rejects those codes and records reconnection when an
existing connection becomes invalid. Token validity does not establish access
to every Mapbox API. The returned token description is not an application login.
[Token verification](https://docs.mapbox.com/api/accounts/tokens/).

Geocoding uses `/search/geocode/v6/forward` and `/reverse`, preserving the
GeoJSON feature collection and attribution. Forward queries have a 256-character,
20-word/number limit and cannot contain semicolons. The result limit is 1–10.
Reverse queries require longitude and latitude. `permanent: true` declares an
intent to retain results and requires the appropriate provider account terms;
temporary results must not be stored as permanent application data.
[Geocoding API](https://docs.mapbox.com/api/search/geocoding/).

Local defaults are limit 5, autocomplete off and permanent off. Reverse inputs
are bounded to longitude ±180 and latitude ±90. Empty feature collections are
valid. This fragment omits batch requests, structured addresses, routing,
map rendering and advanced filters. It performs no geocoding during token
verification and does not automatically store query results.

Only the primary backend reference is resolved by connection verification and
operations. The optional browser reference is preserved in source and never
silently resolved, checked or substituted by this service. A public token can
be the primary backend token if its restrictions permit server calls, so a
secret token is not mandatory. An application that renders maps deliberately
resolves and publishes its separate browser token; it must never publish a
secret token. Clearing the optional reference removes it from saved JSON.

The runtime retains references, not token values. Rotation updates the binding;
a configuration change requires verification again. Failures use safe connector
errors and do not expose credential query strings. Disconnect is local and does
not delete Mapbox tokens. Redact authenticated URLs in HTTP logs.

## API provisioning and application ownership

The Tokens API supports creating tokens with `POST /tokens/v2/{username}`,
using an existing token with `tokens:write`. Supply a descriptive `note`, the
needed `scopes` and, for browser tokens, `allowedUrls`. The creating credential
cannot grant scopes it does not hold. An AI can prepare creation/update/rotation
requests after an authorized operator supplies bootstrap access. Account signup
and billing are separate; the normal geocoding adapter exposes no token-writing
operation. [Token creation](https://docs.mapbox.com/api/accounts/tokens/).

Use separate browser and backend tokens owned by the application. Mapbox's API guide
describes rate limits per access token; account billing and contractual capacity
are still separate concerns. Application budgets and the desired account-level
isolation must be explicit. Two token names do not create two billing accounts.
[API limits](https://docs.mapbox.com/api/guides/).

For browser restrictions, allow the actual deployed application and preview
origins. A per-user editor VM domain is not necessarily the origin of the app
that loads the map. Mapbox does not accept wildcard characters in these
restrictions; consult its matching rules when adding subdomains or custom
domains. No OAuth callback is involved in these token operations.

## Focused evidence

Six fixture tests cover file restart, rotation, ownership, optional references,
HTTP-200 validity failures, coordinates, query bounds, attribution, permanent
intent and permission/quota failures. The editor test covers both reference
fields, invalid raw values, save/reload and removing the optional value.
No live Mapbox account, geocoding use or generated application is exercised.

## Browser-only maps and native SDK composition

Select **Browser maps only** for `settings.usage: "browser"`, authentication
`{ "method": "none" }` and required `settings.publicTokenRef`. This means no
server account grant: the public token still comes from that project Env reference.
Backend mode uses `settings.usage: "backend"` and its normal API-key reference.
The editor omits connection commands in browser-only mode. Resolve only the
selected public reference, reject a value that does not start with `pk.`, and
expose it as deliberate browser configuration. Do not copy all Env values.

The app installs Mapbox GL JS using its framework package workflow, imports
`mapbox-gl/dist/mapbox-gl.css`, and supplies a visible container with a height.
The following goes in its existing mount/unmount lifecycle, not in Vibe64:

```js
const map = new mapboxgl.Map({ container: mapElement,
  accessToken: publicConfiguration.mapboxToken,
  center: [115.86, -31.95], zoom: 12 });
map.on("error", showMapError);
// On view teardown: map.remove();
```

The app supplies the SDK import, element, public configuration and error handler.
Preserve SDK attribution. JSKIT CLI apps and other frameworks use the same source
contract with native frontend composition; neither requires an editor runtime.
[Map composition](https://docs.mapbox.com/mapbox-gl-js/example/simple-map/).

## Routes

Backend `directions.get` accepts `profile` (driving, driving-traffic, walking or
cycling), 2–25 `coordinates` objects with longitude/latitude, and optional `steps`.
It returns GeoJSON route geometry, distance in metres and duration in seconds.
Treat `NoRoute` and `NoSegment` as unavailable routes, not successful directions.
Draw successful geometry with the app's existing GeoJSON line layer; the app
controls destination input, location permission and route refresh frequency.
[Directions API](https://docs.mapbox.com/api/navigation/directions/).

**LIMITATIONS:** No map editor, navigation UI, offline tiles, automatic SDK install
or editor-tool attachment. Example: calculate a walking route and draw it in an
app-owned map, but not run a turn-by-turn navigation product from this connector.
Native map mounting is documented, not executed as a generated app.
