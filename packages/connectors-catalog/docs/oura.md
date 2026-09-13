# Oura

Import `ouraProvider` from `@jskit-ai/connectors-catalog/server/oura`. This
fragment connects each app user's Oura account and reads daily sleep summaries
and permitted profile fields. It uses OAuth2; personal access tokens were
deprecated in December 2025. [Current API](https://cloud.ouraring.com/v2/docs).

## Register and configure

1. For new registrations, sign into https://developer.ouraring.com with the
   account that will own the integration and create an API application. Existing
   registrations remain editable through Oura Cloud → My Applications at
   https://cloud.ouraring.com/oauth/applications. Oura's current
   [support guide](https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API)
   distinguishes these portals. The new portal's authenticated form labels
   were not inspected; the required registration values below are documented.
2. Enter a name and website describing the application. Configure the exact
   redirect URI served by the application's backend, including scheme and path.
3. Copy the assigned Client ID into the integration form. Store the Client
   Secret in backend Env as `OURA_CLIENT_SECRET`; store the callback URL as
   `OURA_CALLBACK_URL`.
4. New applications have a ten-user limit. When ready for a wider audience,
   submit the application for approval from its application page.
   [Application registration](https://cloud.ouraring.com/docs/).
5. Save this configuration, then start consent. The form selects per-user mode
   and `daily` permission by default. Add `personal` or `email` only when the
   corresponding profile data is needed. Save configuration, then use the Env
   links to populate those references. Connect account invokes the configured
   application setup command; its runtime performs consent and stores grants.
   Gen3 and later users need active Oura Membership to retrieve API data.

```json
{
  "schemaVersion": 1,
  "registrations": {
    "oura": {
      "source": "own",
      "clientId": "YOUR_OURA_CLIENT_ID",
      "clientSecretRef": "env:OURA_CLIENT_SECRET",
      "callbackUrlRef": "env:OURA_CALLBACK_URL"
    }
  },
  "integrations": {
    "oura": {
      "provider": "oura",
      "displayName": "My Oura data",
      "accountMode": "per-user",
      "scopes": ["daily"],
      "authentication": { "method": "oauth2", "registrationRef": "oura" }
    }
  }
}
```

Consent uses `https://cloud.ouraring.com/oauth/authorize` and exchanges the code
at `https://api.ouraring.com/oauth/token`. The runtime submits client credentials
in the form-encoded token request. It retains reduced callback scopes when the
token response omits them, and serializes refresh because Oura refresh tokens
are single-use. A declined `daily` permission prevents verification. The runtime
sends state and an S256 PKCE challenge; Oura's documentation does not establish
server-side PKCE enforcement, which has not been tested against a live account.
[OAuth protocol](https://cloud.ouraring.com/docs/authentication).

## Runtime and AI composition

Use ordinary application modules; no template, generator or database is needed:

```js
import { readFile } from "node:fs/promises";
import { parseIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { createConnectionService, createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import { createFileConnectionStore, createCredentialProtection } from "@jskit-ai/connectors-core/server/file-storage";
import { ouraProvider } from "@jskit-ai/connectors-catalog/server/oura";

const providers = [ouraProvider];
const configuration = parseIntegrationConfiguration(await readFile("integrations.json", "utf8"), { providers });
const protection = createCredentialProtection({
  keys: { current: Buffer.from(process.env.CONNECTOR_STORAGE_KEY, "base64") },
  activeKeyId: "current"
});
const connections = createConnectionService({
  configuration, providers,
  store: createFileConnectionStore({ directory: process.env.CONNECTOR_STATE_DIRECTORY, protection }),
  resolveReference: createEnvironmentReferenceResolver(),
  authorize: applicationConnectionPolicy
});
```

`applicationConnectionPolicy` is the existing application's authenticated policy.
It derives the application ID and subject ID from trusted session/operator
context. Never accept these owner identifiers directly from request input.
Keep the runtime directory outside exported source and the encryption key stable
across restarts and backups. A CLI uses the same imports, JSON and local operator
policy with its registered callback listener.

Call `beginAuthorization({ context, integrationId: "oura" })` to obtain the URL.
After the user approves, the backend callback supplies the same authenticated
context and exact callback URL to `completeAuthorization`. Redirect to the
application after success; never put provider tokens in the browser or chat.
Use `cancelAuthorization` when abandoning a pending attempt and `disconnect`
to remove local access. Neither revokes other applications' provider grants.

`invoke({ context, integrationId: "oura", operation: "dailySleep.list", input })`
reads `/v2/usercollection/daily_sleep`. Inputs are optional `start_date` and
`end_date` as valid `YYYY-MM-DD` dates, plus opaque `next_token`. Preserve the
same date range when paging and stop when the returned token is absent or null.
This fragment supports dates, not date-time input or selectable response fields.
`personalInfo.read` reads `/v2/usercollection/personal_info` with `personal` or
`email` consent. It returns only the fields Oura permits. Other Oura permission
families and operations are outside this fragment.
[Endpoint schemas](https://cloud.ouraring.com/v2/static/json/openapi-1.37.json).

An Oura grant provides data access; implement application login through the
application's identity system. The six simulated runtime tests cover consent
reduction, cancellation, token-response precedence, file persistence, owner
isolation, refresh rotation, input validation, provider errors and disconnect.
No live user data or generated application was exercised.

## Application ownership, callbacks and capacity

The documented initial registration workflow is the dashboard. No supported
public API for creating OAuth client registrations was established in this pass.
An AI can prepare JSON, callback handlers and runtime composition after an owner
creates and authorizes the registration; approval remains a provider process.

The application owner creates the provider registration and stores its secret
in the application's private Env. Public Vibe64, Vibe64 Online and CLI users use
this same ownership model. The configuration file holds the client ID and Env
references; the editor does not own the application's grants.

Register the exact callback implemented by the application. For a hosted project,
start with its assigned application URL and append the implemented callback path.
Save that same URL through the application's callback Env reference. On a domain
or host change, update both the provider registration and callback Env if the URL
changes. Preserve the application's identity and persistent grant store when
moving it; neither a new editor URL nor a new hosting address creates a new owner.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md) and
[application setup command](../../connectors-core/docs/setup-command.md).

Separate client IDs do not guarantee isolation from user/account limits; verify
those limits for the approved applications.


## Accepted data coverage

The project-owned adapter provides dailySleep.list, sleep.list,
dailyReadiness.list and dailyActivity.list under daily permission. Supply
start_date/end_date (YYYY-MM-DD). heartRate.list separately requires heartrate;
use start_datetime/end_datetime with an explicit timezone. Optional next_token
is opaque; invoke again explicitly until it is absent. Start cannot exceed end.
A user may decline heart-rate permission without preventing daily sleep access.

The same service.invoke/configuration/Env/store contract works from a CLI app.
Other frameworks use their native OAuth client and these Oura V2 endpoints,
with per-user grants; Vibe64 holds no health-data gateway. The app owns charts,
refresh scheduling, user access policy and private storage.

**LIMITATIONS:** No continuous sync/webhooks, health dashboard, workouts, tags,
sessions or SpO2 operations; no coding-chat attachment. Example: fetch sleep and
readiness history, then build the chart in the app. No live/generated-app proof.
Source: [Oura V2 API and linked OpenAPI1.37](https://cloud.ouraring.com/v2/docs).
