# Twilio

Import `twilioProvider` from `@jskit-ai/connectors-catalog/server/twilio`.
This adapter verifies a Standard API key by listing call records for one
account in one region. It also sends SMS, initiates voice calls and reads
individual message/call status, with a signed POST-form callback verifier.
Phone-number provisioning, TwiML handlers and business workflows are owned by
the application/operator; the connector supplies operations and configuration.

## Create the regional API key

1. Sign into Twilio Console and select the intended account or subaccount.
   Copy its **Account SID** from the account dashboard. It starts with `AC`.
2. In the new Console, open **Settings → Account settings → API keys & auth
   tokens**. Select the region, then **Create API key**. Select **US1**, **IE1**
   or **AU1** to match where the call records are held.
3. Enter an **API key name**, choose **Standard**, and click **Next**. Copy
   the **API Key SID**, starting with `SK`, into the editor. Save the secret
   immediately in the application environment as `TWILIO_API_SECRET`; it is
   shown only during creation. Enter `env:TWILIO_API_SECRET` in the editor's
   **API key secret reference** field, then check **Got it!** and **Finish**
   in Twilio. Never put the secret value in `integrations.json`.
4. In the legacy Console, the equivalent path is **Admin → Account management
   → Keys & credentials → API keys & tokens → Create API key**. Set
   **Friendly name**, **Region** and **Standard**, choose **Create**, save the
   credentials, then acknowledge them and choose **Done**.
5. To revoke access at Twilio, return to the key list, open the key and choose
   **Delete key**, then confirm. Local connector disconnect only removes local
   connection state. Standard keys have broader provider permissions than the
   operations exposed here. The application's authorization policy must restrict
   operation access and permitted destinations.
   [Console key guide](https://www.twilio.com/docs/iam/api-keys/keys-in-console).

The API Key SID and its secret belong to a particular account and region.
They are distinct from the Account SID and Auth Token used in some Twilio
tutorials. Runtime HTTP Basic authentication uses **API Key SID:API key secret**.
[Authentication](https://www.twilio.com/docs/usage/requests-to-twilio),
[regional credentials](https://www.twilio.com/docs/global-infrastructure/manage-regional-api-credentials).

## Portable configuration

The editor and a manually composed CLI use the same file:

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "voice": {
      "provider": "twilio",
      "displayName": "Support call records",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:TWILIO_API_SECRET"
      },
      "settings": {
        "region": "us1",
        "accountSid": "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "apiKeySid": "SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    }
  }
}
```

Replace both illustrative SIDs with the actual values. Validation requires
`AC` or `SK` followed by 32 hexadecimal characters. Region defaults to `us1`;
the other accepted values are `ie1` and `au1`. The form presents Region, Account
SID and Standard API Key SID, with a separate reference to the secret. These
same settings and defaults apply to CLI edits. Raw secrets are rejected by the
reference field. Changing either SID or the region requires verification again;
rotating the secret under the same reference is picked up on the next request.

The runtime binds credentials to these fixed destinations:

| Region | API origin |
|---|---|
| US1 | `https://api.twilio.com` |
| IE1 | `https://api.dublin.ie1.twilio.com` |
| AU1 | `https://api.sydney.au1.twilio.com` |

Non-US requests include both region and edge in the hostname. Region-only
domains such as `api.ie1.twilio.com` are deprecated. Selecting an edge does not
move the call records between regions. There is no fallback to a different
region on failure, and not every Twilio product is available in every region.
[Regional requests](https://www.twilio.com/docs/global-infrastructure/using-the-twilio-rest-api-in-a-non-us-region),
[edge domain migration](https://www.twilio.com/docs/global-infrastructure/understanding-edge-locations).

## Runtime and AI composition

Apply the [API-key source pattern](../patterns/api-key-connection/PATTERN.md)
with `providers: [twilioProvider]`, the encrypted file connection store, the
application's environment reference resolver and its authorization policy.
Configuration and runtime state are text files. The runtime needs neither the
Vibe64 editor nor a database.

```js
await connections.connectApiKey({ context, integrationId: "voice" });
const result = await connections.invoke({
  context, integrationId: "voice", operation: "calls.list",
  input: { PageSize: 25, Status: "completed" }
});
```

`calls.list` requests
`GET /2010-04-01/Accounts/{AccountSid}/Calls.json` at the selected origin.
Verification uses its default first page; an empty call list is valid.
The response retains the call records and Twilio's pagination metadata.
[Call resource](https://www.twilio.com/docs/voice/api/call-resource).

Supported inputs are `PageSize` (1–1000, default 50), `Page` (zero or greater,
default zero), `PageToken`, `To`, `From` and `Status`. The local maximum page is
2147483647 and maximum token length is 4096. To/From accept 1–256 characters,
including phone numbers and supported non-phone identifiers. Status accepts
`queued`, `ringing`, `in-progress`, `canceled`, `completed`, `failed`, `busy`
and `no-answer`. Date filters are not implemented by this fragment.

For another page, extract `PageToken` and `Page` from `next_page_uri` and pass
them as structured input; continue using the desired filters and page size.
The runtime never follows that returned URL or accepts a caller-supplied URL,
account SID or region as operation input. It encodes query values and rebuilds
the request against the configured account and origin. It returns one page per
call and does not automatically retry or fetch all pages. A rejected key marks
the local connection as needing reconnection; errors do not return the provider
response body or the secret to callers.

## Provisioning automation and application ownership

### SMS and outbound voice

`messages.send` accepts `To`, `Body` (1–1600 characters, whitespace preserved),
exactly one of `From` or `MessagingServiceSid`, and optional `StatusCallback`.
Phone numbers use E.164 format (`+` followed by country code and number).
The service SID begins with `MG`. The configured account must own a capable
sender or Messaging Service; trial recipients, geographic permissions and
sender registration must already be configured in Twilio. This operation is
text SMS, not MMS, WhatsApp, RCS or Twilio Verify.

`calls.create` accepts E.164 `To` and `From`, exactly one of `Url` or `Twiml`,
optional `StatusCallback`, and `Timeout` (5–600 seconds, default 60). The
application owns the call-control endpoint or supplies valid TwiML (maximum
4000 characters). Return TwiML XML from that endpoint; escape dynamic values
using the framework's XML tools. Callback and call-control URLs must be HTTPS
without URL credentials or fragments. Inline TwiML is passed to Twilio as XML
text, not executed or rendered by JSKIT.

```js
const message = await connections.invoke({
  context, integrationId: "voice", operation: "messages.send",
  input: { To: recipient, From: sender, Body: "Your appointment is tomorrow." }
});
const delivery = await connections.invoke({
  context, integrationId: "voice", operation: "messages.get",
  input: { resourceSid: message.sid }
});
```

`messages.get` takes an `SM` resource SID. `calls.get` takes a `CA` resource
SID. Both return one provider record, including status and available error
details. A queued response does not prove delivery or a completed call.
The application must authorize the requested resource against its own stored
message/call ownership, and authorize destination, sender, content and call
control before invoking a write. Authentication alone does not authorize all
users to send to arbitrary numbers.

Writes use form-encoded POST requests to the configured account's Messages or
Calls endpoint; reads use GET on that resource SID. No automatic write retries
or automatic polling occur. A timeout, malformed success or server failure can
leave the send outcome unknown: reconcile provider records before deciding
whether to send again. A retry can cause duplicate communication and charges.
Product availability depends on region and account access; there is no silent
fallback to another region. Other frameworks can perform these same native
HTTP operations with the same account, regional credentials and Env references.

References: [Message API](https://www.twilio.com/docs/messaging/api/message-resource),
[Call API](https://www.twilio.com/docs/voice/api/call-resource),
[regional availability](https://www.twilio.com/docs/global-infrastructure/regional-product-and-feature-availability).

### Incoming messages, delivery and call control

Store the account's **Auth Token** separately from the Standard API key secret,
using private Env `TWILIO_AUTH_TOKEN` and optional configuration setting
`authTokenRef: "env:TWILIO_AUTH_TOKEN"`. The Auth Token is available on the
Twilio Console account dashboard. Never expose either secret to a browser.
The application resolves that reference through its private Env resolver;
the verifier receives the value, not the reference string.

Configure the phone number's **A message comes in** and/or **A call comes in**
handler to the application's public HTTPS URL, with **HTTP POST**. For Messaging
Services configure inbound handling in the service's Integration settings.
For outbound delivery/call completion supply `StatusCallback` when sending.
The app owns all these routes and their configured public URLs. Custom-domain
changes require updating Twilio and the expected URL used by verification.

```js
import { verifyTwilioRequest } from "@jskit-ai/connectors-catalog/server/twilio";

const event = verifyTwilioRequest({
  rawBody, // Uint8Array captured before the framework's form parser
  signature: request.headers["x-twilio-signature"],
  contentType: request.headers["content-type"],
  authToken: await resolveReference(integration.settings.authTokenRef),
  accountSid: integration.settings.accountSid,
  url: process.env.TWILIO_INBOUND_URL // exact URL configured at Twilio
});
```

Choose the expected integration/URL through trusted route configuration, never
from an unverified AccountSid or forwarded Host header. The verifier binds the
signature to that exact URL (including query), all form fields and expected
account. It preserves unknown fields. Its scope is UTF-8 POST form bodies,
maximum 1 MiB and 256 distinct fields; repeated fields, JSON, GET and WebSocket
callbacks are not supported by this helper. Configure POST accordingly or use
Twilio's native SDK for other callback formats. Other application frameworks
should use their own Twilio SDK request validator with the same Env token,
expected account, exact URL and all received fields.

After authentication, the application validates its expected event type and
fields. An inbound SMS normally includes MessageSid, From, To and Body. Store
the message under the authorized account/number and deduplicate by MessageSid.
Return an XML `<Response/>` acknowledgement or a framework-generated TwiML reply.
Delivery callbacks include MessageSid and status; map only to messages owned by
this integration. Voice handlers return native TwiML XML; call status callbacks
map CallSid to the app's call record. Authentication does not define business
behavior or permit an arbitrary user to redirect a call.

Twilio's form signatures have no timestamp expiry. The app must handle repeat
callbacks and out-of-order statuses idempotently, retaining progress instead of
regressing terminal delivery states. Disconnecting the sending key does not
remove Twilio's webhook configuration or revoke its separate account Auth Token.
See [Twilio request security](https://www.twilio.com/docs/usage/security).

### Account and key provisioning

Twilio uses accounts, subaccounts and API keys here, rather than Google-style
OAuth app registrations. A human must establish the parent account, access and
any required billing or verification. An authorized operator or AI can then
create Standard keys through
`POST /2010-04-01/Accounts/{AccountSid}/Keys.json`, with an
`application/x-www-form-urlencoded` body containing `FriendlyName`. The request
requires an appropriate bootstrap credential, such as the account Auth Token
or a Main API key. Standard keys cannot create more keys. Store the returned
`sid` and one-time `secret` through the same settings and environment bindings
above. Use the matching regional host and regional bootstrap credentials.
[Key creation API](https://www.twilio.com/docs/iam/api-keys/key-resource-v2010).

The application owner selects its account or subaccount and issues a key in
each required region. The Account API supports subaccount
creation through `POST /2010-04-01/Accounts.json` with `FriendlyName`, after
authorization with the parent account. Subaccounts separate resources and
credentials, but their usage is billed to the parent account. Two keys in the
same account do not establish separate billing or guaranteed quota isolation.
[Subaccounts](https://www.twilio.com/docs/iam/api/subaccounts).

The application operator selects its account, key and region and owns usage
limits. This adapter does not provision capacity or enforce a budget. Use
separate parent accounts where independent billing is required, subject to
Twilio's account arrangements. Online, installed editor and CLI users configure
the same application-owned credentials.

There is no OAuth callback in this API-key flow, so editor VM URLs and custom
application domains do not add OAuth redirect registrations. Twilio Verify and
SMS login are separate products and are outside this adapter. The application
owns access policy; connections are project-owned. Editor coding-assistant
attachment is deferred and not enabled by saving this connector.

## Proof

Ten focused tests use simulated provider responses and real temporary
encrypted JSON state. They cover all three origins, Basic credential pairing,
restart, key rotation, ownership, disconnect, required settings, reverification,
query encoding, paging, malformed responses and denied credentials without
regional fallback. The two added tests cover useful SMS/call writes and status
reads, form encoding, ambiguous/invalid inputs, operation policy and uncertain
writes without automatic retry. An independent HMAC fixture tests signed inbound
content, unknown fields, URL/account/token binding and tampering rejection.
Public editor browser checks cover SID errors, separate API-key and callback
token references, all region choices, setup instructions, persistence and
connect/disconnect at compact, medium and expanded sizes.
Provider signup, real API use and generated applications are outside the test
scope. The same ten tests pass using normal exports from an installed package
in a disposable Node consumer, independently of Vibe64.
