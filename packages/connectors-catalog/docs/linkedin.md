# LinkedIn

Import `linkedinProvider` from `@jskit-ai/connectors-catalog/server/linkedin`.
This adapter reads the connected member's profile through `profile.read` and publishes approved text with `posts.create`.
Configuration preserves `openid`, `profile`, `email` and `w_member_social`.
Only OpenID and profile are required and selected by default. Publishing requires the Share on LinkedIn product and a grant with `w_member_social`.

## Register and configure

1. Sign into [LinkedIn Developers](https://www.linkedin.com/developers/apps).
   Choose **My apps → Create app**. Supply the requested name, LinkedIn Page,
   privacy-policy URL and logo; complete Page-owner verification when prompted.
2. Open **Products** and request **Sign In with LinkedIn using OpenID Connect**.
   Once approved, check **Auth** for `openid`, `profile` and `email`.
   Email fields may be absent even when profile retrieval succeeds.
   [Product and profile documentation](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2).
3. Open **Auth → OAuth 2.0 settings → Authorized redirect URLs** and add the
   project's exact **Suggested callback URL**, using HTTPS. Copy **Client ID** into the configuration.
   Save **Client Secret** only in backend Env as `LINKEDIN_CLIENT_SECRET`.
   Set `LINKEDIN_CALLBACK_URL` to the registered URL without query or fragment.
   [Confidential authorization flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow).
4. For text publishing, request **Share on LinkedIn** under Products and
   confirm `w_member_social` is provisioned in Auth before selecting it.
   [Share product](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin).
5. In Vibe64 choose **Add LinkedIn**, enter display name, ownership, Client ID
   and the two Env references. Open **Permissions** for optional email/publishing.
   Choose **Save configuration**, then **Set credential in Env** to store the
   Client Secret. Use **Open Env** to set the same registered callback. Return
   and choose **Connect account** for shared/assistant access. Each-user access
   starts in the generated application's authenticated account screen. Its
   backend must implement the callback; saving fields does not create that route
   or complete provider consent.

```json
{
  "schemaVersion": 1,
  "integrations": {
    "linkedin": {
      "provider": "linkedin",
      "displayName": "My LinkedIn profile",
      "accountMode": "per-user",
      "scopes": ["openid", "profile"],
      "authentication": { "method": "oauth2", "registrationRef": "linkedin" }
    }
  },
  "registrations": {
    "linkedin": {
      "source": "own",
      "clientId": "YOUR_LINKEDIN_CLIENT_ID",
      "clientSecretRef": "env:LINKEDIN_CLIENT_SECRET",
      "callbackUrlRef": "env:LINKEDIN_CALLBACK_URL"
    }
  }
}
```

## Runtime and AI composition

Use the [OAuth file composition pattern](../patterns/oauth-connection/PATTERN.md)
with `providers: [linkedinProvider]` and this JSON. Core owns configuration,
Env resolution, consent attempts, encrypted file storage, refresh and disconnect.
No generator or editor database is needed.

```js
import { readFile } from "node:fs/promises";
import { parseIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { createConnectionService, createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import { createFileConnectionStore, createCredentialProtection } from "@jskit-ai/connectors-core/server/file-storage";
import { linkedinProvider } from "@jskit-ai/connectors-catalog/server/linkedin";

const providers = [linkedinProvider];
const configuration = parseIntegrationConfiguration(await readFile("integrations.json", "utf8"), { providers });
const protection = createCredentialProtection({
  keys: { current: Buffer.from(process.env.CONNECTOR_STORAGE_KEY, "base64") }, activeKeyId: "current"
});
const connections = createConnectionService({
  configuration, providers,
  store: createFileConnectionStore({ directory: process.env.CONNECTOR_STATE_DIRECTORY, protection }),
  resolveReference: createEnvironmentReferenceResolver(), authorize: applicationConnectionPolicy
});
```

`applicationConnectionPolicy` derives `{ applicationId, subjectId }` from
trusted app authentication or a CLI operator and checks each requested operation.
Per-user mode keeps individual grants; shared mode needs a stable shared subject
and membership checks. Assistant mode requires explicit host authorization too.
Keep runtime files outside exported source and preserve the encryption key
across restarts. No client secret or provider token belongs in project JSON.

Call `beginAuthorization({ context, integrationId: "linkedin" })` and open the
returned URL. Recover the same authenticated owner in the callback, then call
`completeAuthorization({ context, integrationId: "linkedin", callbackUrl })`.
Success includes a read-only profile check. Later call
`invoke({ context, integrationId: "linkedin", operation: "profile.read" })`.
The operation accepts no input and calls only
`GET https://api.linkedin.com/v2/userinfo`. It requires a nonempty `sub` and
accepts absent optional name/email fields. Do not infer a missing email or
fetch picture URLs automatically.

`cancelAuthorization` abandons a pending attempt; failed replacement consent
preserves the old grant. `disconnect` removes local access and attempts, not
provider-wide consent. For provider revocation, open **Me → Settings & Privacy → Data privacy → Other
applications → Permitted services**, choose **Change**, then **Remove** beside
the application. [LinkedIn's access-removal instructions](https://www.linkedin.com/help/linkedin/answer/a522690/log-in-with-linkedin-credentials?lang=en).

The provider normalizes the documented omission of `token_type` to Bearer.
It discards ID tokens and never uses them as proof of application login.
The host's existing identity implementation remains responsible for login.
Core sends state and S256 PKCE parameters with confidential Web OAuth; the Web
flow documentation does not establish PKCE enforcement. LinkedIn's separate
native flow needs enablement and a loopback callback. It is not implemented
here; never embed a client secret in an installed editor or browser. CLI users
can compose the same server runtime with their registered callback owner.
[Native flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow-native).

## Expiry, failures and verification

Ordinary grants may have no refresh token. Expiry then requires reconnect.
If LinkedIn enables programmatic refresh and supplies a refresh token, core
serializes refresh under the file lock and retains rotation. Reduced permissions
never expand during refresh. Approval is provider-controlled; refresh expiry
or revocation can still require consent again.
[Refresh availability and protocol](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens).

Missing required permissions, invalid responses and failed profile checks prevent
Connected. API 401 requires reconnect; 403 means permission denied; 429 means
rate limited. Errors omit provider text. Changing the OAuth client ID invalidates
access through the previous client. Requests are bounded and cancellable.
Organization access, analytics and application login are outside this adapter. Focused tests use controlled HTTP and encrypted temporary files,
including this exact JSON. Editor checks use file-backed browser fixtures.
No live consent, provider token issuance or generated application is proven.

## Automation and application registrations

An AI can prepare JSON, Env names, callback handlers and runtime wiring. This
pass established no supported public API for creating developer apps or granting
product access. Registration, Page verification and approval remain operator
steps. Do not promise unattended provisioning from a client ID alone.

Each application owns its provider registration, callback route, credentials
and grants. Hosted and installed editors configure the same app-owned setup;
neither supplies a shared Vibe64 registration or token gateway. Use the app's
assigned public URL as the initial callback origin, append the route the backend
actually implements, and register the exact URL with the provider. Keep the
client secret and callback binding in the application's Env.

A custom-domain or hosting move that changes the callback requires updating both
the provider registration and the app's Env. Preserve the application's identity
and private connection store, validate callback state and initiator, and allow
only application-approved return destinations. The editor's address is not the
provider callback. See the [callback contract](../../connectors-core/docs/oauth-callbacks.md)
and [setup command](../../connectors-core/docs/setup-command.md).

Separate client IDs do not establish independent quotas or permission to serve
unrelated applications. Register and obtain product approval for the actual app.
Managed assignments are invalid configuration in this runtime.


## Credential guidance review (2026-09-12)

The inline setup steps now name the developer portal, product approval, exact
callback registration and project Env handoff before connection. Current OIDC,
authorization-code and refresh documentation were checked. The existing adapter
was retained; no provider-login or publishing implementation was added. Ten
focused runtime fixtures pass, including expiry without refresh, approved
refresh, cancellation/replay, encryption, missing permissions and host isolation.
The cancellation test now expects the callback URL exposed by connection status,
while retaining the complete assertion that declined replacement consent keeps
the previous grant. Rendered guidance passed the controlled public-editor journey: saved Client ID/callback, Env links, reload, simulated consent/cancellation/reconnect and disconnect. All six steps were visually reviewed at 496px width. No live provider consent or fresh phone review is claimed.

## Text publishing acceptance — 2026-09-13

Use `posts.create` with `{ text, visibility: "PUBLIC" }` or `"CONNECTIONS"` after
app authorization of the exact message and audience. Text is locally limited to
1–3000 characters. The operation reads the connected member identity, constructs
the Person URN itself and posts once to `/v2/ugcPosts`. Callers cannot choose a
different author. The result contains the post URN from the confirmed 201 response.
[Provider sharing contract](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin).

```js
const post = await connections.invoke({ context: authorizedContext,
  integrationId: "linkedin", operation: "posts.create",
  input: { text: approvedText, visibility: approvedVisibility } });
```

The app supplies these variables and its approval policy. CLI uses the same config,
Env and library; other frameworks can implement the same provider request with
their native HTTP/OAuth tools. Add the provider product, select Publish posts in
configuration and reconnect before invoking it. No publishing occurs during
connection verification. Check LinkedIn before manually repeating an uncertain
request; a timeout does not prove the post was never created.

**LIMITATIONS:** Text only. No images/video, organization posts, scheduling, post
editing/deletion, analytics or editor-assistant attachment. Example: publish an
approved announcement, but not a photo campaign. Prior September12 review above
is historical. Current tests use simulated provider responses, not live publishing.
