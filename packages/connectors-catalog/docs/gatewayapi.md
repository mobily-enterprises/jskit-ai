# GatewayAPI

Import `gatewayApiProvider` from
`@jskit-ai/connectors-catalog/server/gatewayapi`.
Connection verification reads credit/currency without sending. Explicit application operations send single or batched SMS/RCS through the current Messaging API.

## Configure access

1. Sign into the intended Global or EU GatewayAPI account. In the left menu,
   choose **API → API Keys → ADD API KEY** and give the credential a name.
   Copy its API token into backend Env as `GATEWAYAPI_TOKEN`.
   [Dashboard instructions](https://gatewayapi.com/help-center/webhooks-and-api-keys/).
2. Save provider `gatewayapi`, mode `shared` or `assistant`, `scopes: []`, and
   authentication `{ "method": "api-key", "secretRef": "env:GATEWAYAPI_TOKEN" }`.
3. Set `settings.region` to `global` (default) or `eu`, matching the platform
   that issued the token. The form labels this **API domain** and limits it to
   `gatewayapi.com` and `gatewayapi.eu`. The EU platform uses a different host;
   changing hosts requires verification again.
   [Platform routing](https://gatewayapi.com/docs/apis/legacy/rest/).
4. In Vibe64 enter `env:GATEWAYAPI_TOKEN` as **API key reference**, click
   **Save configuration**, then **Set credential in Env**. Store the real token
   as `GATEWAYAPI_TOKEN` and return to connect. CLI apps call `connectApiKey`.
   Requests use `Authorization: Token <token>`.
   A legacy OAuth key/secret pair is a different credential. No webhook or
   callback registration is needed for this read operation.
   [Token authentication](https://gatewayapi.com/docs/authentication/).

## Runtime and AI composition

`balance.read` accepts no operation inputs and reads `GET /rest/me`. The result
contains the integer account `id`, string `credit` and string `currency`.
Retain credit as a decimal string when displaying or processing it; avoid
rounding through binary floating-point arithmetic in financial workflows.
[Balance endpoint](https://gatewayapi.com/docs/apis/prices-balance/).

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with the file
store. `messages.send` submits a single message and `messages.sendBatch` accepts 1–1000 `messages`. Each needs sender, integer recipient (international country code, no plus), message and an app-owned reference. Optional label and normal/urgent priority are supported. Sender is 3–11 alphanumeric or 3–15 numeric characters. Save each returned msg_id and reference: HTTP acceptance is not delivery. Batches preserve individual receipts; do not automatically retry an uncertain send. RCS routing and SMS fallback depend on the account, approved agent and recipient.

## Automation and application ownership

The documented bootstrap creates an account and provides dashboard token
management. This research does not establish a public API for creating the
initial account or issuing tokens. An AI can prepare Env references, configuration
and library wiring after the account owner supplies access.

Keys in one account can share its credit and limits. Use the
provider's account arrangements and explicit spending controls when provisioning
independent pools; selecting Global versus EU is a hosting choice, not a quota
partition. The application owner supplies its authorized key through private Env.

Replace the Env token on rotation and revoke the obsolete token in the dashboard.
Local disconnect removes local state only. Tests cover both fixed hosts, verified
state across restarts, changed-region re-verification and provider errors, using
simulated HTTP and no message delivery.

## Delivery and inbound replies: application-owned webhook

Official API checked 13 September 2026:
[Messaging API](https://gatewayapi.com/docs/message/overview/) and
[OpenAPI](https://messaging.gatewayapi.com/openapi.json).
Messaging requests use `messaging.gatewayapi.com` or `.eu`; balance reads use
the existing account host. Sending is billed by GatewayAPI. Check sender
registration, destination restrictions and credits in the account; arrange an
approved RCS agent with GatewayAPI before expecting RCS delivery. Urgent SMS
may have a higher price. The current API chooses the transport, not the app.

1. Add a public HTTPS route to the generated application, for example
   `/integrations/gatewayapi/webhook`. Preserve its raw request bytes.
2. In the matching Global/EU dashboard open API webhook settings, create the
   callback, paste that application URL, select delivery/incoming events and
   configure a private authentication/signature secret. Save the same secret
   in application Env as `GATEWAYAPI_WEBHOOK_SECRET` (not the API token).
3. Current Messaging callbacks use **Signature: v1=<HMAC-SHA256 hex>**. This
   differs from the legacy REST `X-Gwapi-Signature` JWT described by older
   guidance, including the current Lovable page. Do not mix verifiers.
4. Use `verifyGatewayApiEvent` below, then transactionally persist each event
   once using `event_id` as a unique key. For delivery events verify `msg_id`,
   recipient and reference against an app-owned send record. Inbound messages
   have no existing send reference; route them only to the configured leased
   number or RCS agent. Never authorize them through arbitrary claimed users.
5. Acknowledge with 2xx after persistence, promptly (within 5 seconds). Provider
   retries must not create duplicate inbox messages or repeated side effects.
   Apply your retention/replay policy to timestamp and stored event IDs; do not
   discard legitimate delayed delivery simply using a tiny timestamp window.
6. Incoming SMS needs the required leased number/keyword and callback routing;
   RCS inbound needs agent configuration. The app owns these provider steps.

```js
import { verifyGatewayApiEvent } from "@jskit-ai/connectors-catalog/server/gatewayapi";
const event = verifyGatewayApiEvent({ rawBody, signature: request.headers.signature,
  secret: process.env.GATEWAYAPI_WEBHOOK_SECRET });
// Your framework validates destination ownership and atomically inserts event_id.
// Only after that transaction commits, acknowledge the callback.
```

The verifier authenticates up to 1 MiB of raw bytes and checks the common event
envelope. It does not store, deduplicate or apply business state transitions.
Unknown valid event types should be persisted/ignored safely; native status
and text/location/file payloads remain available in `event`. Avoid fetching
untrusted file URLs automatically. The current API offers no status polling;
keep webhook history if the app needs delivery reporting.

CLI apps use identical configuration, Env and these optional Node exports.
Other frameworks use native HTTP and HMAC-SHA256 verification of raw bytes;
no Vibe64 service is required. Disconnect does not remove provider webhooks;
deactivate them in GatewayAPI when retiring the application.

**LIMITATIONS:** no automatic webhook registration, number leasing, RCS agent
approval or editor assistant attachment. Example: sending a booking reminder
is provided; its delivered badge needs the app's webhook route and durable event
store. That is also the ownership described in Lovable's connector guidance.
Advanced RCS cards and an inbox UI are not supplied. Tests use controlled HTTP
and signed callback fixtures, not real messages or provider provisioning.
