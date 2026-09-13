# Resend setup and implementation

Documentation checked: 8 September 2026. Console navigation is documented from
public guidance, not tested in a signed-in account. Tests use simulated API
responses; no email is sent.

## Initial capability and input ownership

`resendProvider` verifies an API key by listing sending domains. `domains.list`
returns domain status and cursor pagination (`limit`, `after`, `has_more`,
`data`). Use the last returned domain ID as `after` for the next page. The limit
is 1–100. The separate `emails.send` operation sends transactional plain-text
messages. Contacts, segments and draft broadcasts are supported below. Incoming mail, attachments and a hosted-template catalogue are not implemented.

| Input | Destination | Rule |
|---|---|---|
| Display name | integration `displayName` | Optional, 1–200 characters when present |
| API key | Server environment/secret store | Never include the raw value in application source |
| API key reference | `authentication.secretRef` | For example `env:RESEND_API_KEY` |
| Shared account / assistant | `accountMode` | Existing application policy authorizes the caller |
| People with access | Host's membership/grant policy | Checked by `authorize`; a source field cannot grant workspace membership |
| Billing and quota | Application administrator’s Resend account | Editor edition does not supply account capacity |

## Manual setup

1. Sign in at [Resend](https://resend.com/) and select the account/team that should
   own the application's usage. Account creation, payment and domain ownership
   remain operator decisions.
2. Open **API Keys** in the dashboard, then **Create API key**. The official
   [key guide](https://resend.com/docs/dashboard/api-keys/introduction) describes
   the permission choices and one-time key display.
3. Give the key a recognizable environment/application name. Choose **Full
   access** for domain verification and marketing operations. **Sending access** cannot
   perform the verification read. Domain-limited sending keys belong to a later
   sending-only fragment; do not silently broaden a supplied key.
4. Create the key and immediately store its value in the application's secret
   store or private environment as `RESEND_API_KEY`. If the value is lost,
   create a replacement rather than placing it in chat or source.
5. In the integration form, set the display name and account use, and enter
   `env:RESEND_API_KEY` as the key reference. Save the configuration. A CLI user
   writes the same `authentication: { method: "api-key", secretRef: "env:RESEND_API_KEY" }`.
6. Authorize the application caller and invoke `connectApiKey`. A successful
   [domain-list response](https://resend.com/docs/api-reference/domains/list-domains)
   has `object: "list"`, `data` and `has_more`; an empty list is valid. This read
   needs no recipient, callback URL, OAuth app, client secret or verified domain.
7. If denied, check the selected account, key value and Full access permission.
   A 401 requires reconnecting; a 403 is permission denied; a 429 is rate
   limited. Fix the cause and retry explicitly. The runtime does not resend or
   retry writes automatically.
8. Rotate by creating a replacement key, updating the same secret binding and
   verifying it before revoking the previous key in **API Keys**. Disconnect
   removes the application's local connection; revoking a provider key affects
   every caller that shares it. Treat the provider's expiration rules as
   authoritative; the runtime does not invent an expiration time.

## Automation and application ownership

Classification: **assisted API automation**. An authorized operator supplies an
existing administrative key. The official [create-key API](https://resend.com/docs/api-reference/api-keys/create-api-key)
accepts a name and permission and returns the new key. Use `GET /api-keys` to
find a previously provisioned named key before considering `POST /api-keys`;
the secret cannot be reconstructed from the list. Save returned secrets once
and do not print response bodies. If a named key exists without its stored
secret, report it for rotation rather than silently creating duplicates.

The API recipe is: resolve the administrative key privately, list keys, find the
application's stored key ID/name, create only when absent, and persist the new ID
and secret through the operator's secret store. Key creation does not automate
account signup, billing or domain verification. DNS records must be installed at your DNS host and verified by Resend; the editor does not change DNS.

Each application administrator supplies its own Resend key through the app's
private Env. Hosted and installed editors use the same configuration and runtime;
neither supplies shared sending capacity. Independent keys in one Resend account
do not prove independent quotas. Check the provider's [usage limits](https://resend.com/docs/api-reference/rate-limit)
before promising isolation. Moving the app to another host requires preserving
its Env and runtime connection state, not an editor gateway.

For CLI or editor setup, compose the existing connection service with the
[application-owned setup command](../../connectors-core/docs/setup-command.md).
The app owns operator authorization; JSKIT supplies JavaScript libraries. Other
frameworks implement their own command and runtime through native tooling.

## Transactional email and recovery wiring

Sending contract checked against the official
[send API](https://resend.com/docs/api-reference/emails/send-email) and
[idempotency guide](https://resend.com/docs/dashboard/emails/idempotency-keys)
on 11 September 2026. `emails.send` requires `from`, `to` (an array of 1–50 email
addresses), `subject`, `text` and `idempotencyKey`. This adapter bounds text at
1,000,000 characters and requires an ASCII key of 1–256 characters using letters,
numbers, underscores, dots, slashes, colons or hyphens. These are adapter limits,
not a claim to implement every Resend sending option.

The request goes to `POST /emails`; the key goes in `Idempotency-Key`, not the
message body. The application owns verified sender/domain setup, recipients,
content and authorization. Connection verification remains a domain read and
never sends a test message. This connection mode still requires a Full access
key for that read; sending-only keys need a separately designed verification
mode and are not silently accepted as fully verified here.

Resend retains idempotency keys for 24 hours. Reuse the same key and identical
body when deliberately retrying an uncertain result within that window. Do not
reuse the key for a changed message. The library makes one request and does not
automatically retry; a successful API response is acceptance, not proof of inbox
delivery. The application owns any durable delivery workflow.

An application can provide local auth's recovery sender using its existing
connection service and a fixed, trusted administrator context:

```js
import { createHash } from "node:crypto";

function createRecoverySender({ connections, context, integrationId, from }) {
  return async ({ email, recoveryUrl }) => {
    // Stable for this exact recovery message; do not put the token in a header.
    const idempotencyKey = `recovery/${createHash("sha256")
      .update(JSON.stringify([from, email, recoveryUrl])).digest("hex")}`;
    await connections.invoke({
      context, integrationId, operation: "emails.send",
      input: {
        from, to: [email], subject: "Reset your password",
        text: `Open this link to reset your password:\n\n${recoveryUrl}\n`,
        idempotencyKey
      }
    });
  };
}
```

Supply the returned function as `auth.local.recovery-sender` or the direct
`createLocalAuthService({ recoverySender, ... })` argument. This snippet belongs
in the application; auth does not import Resend or connectors. The context must
come from trusted backend composition, never from the public password-reset
request. Do not log recovery content or provider request bodies.

`test/resend.test.js` uses controlled HTTP to verify the read-only connection
check, explicit POST/body/header, input rejection, application isolation and
absence of automatic retries on uncertain delivery. No email is sent.

## Marketing workflow (current segments API)

1. In **Domains → Add domain**, enter your sender domain. Copy the displayed SPF/DKIM records exactly into your DNS host, then return to Resend and verify. Use a From address on that verified domain. `domains.get({id})` retrieves status and records; a saved key does not establish domain readiness.
2. In **Contacts**, create a **Segment** for recipients who opted into this communication. Older instructions call these Audiences; this adapter uses current segments. Use `segments.list({limit,after})` or `segments.create({name})`. Lists use the last item's ID as the next `after`; preserve `has_more` when supplied.
3. `contacts.create({email,first_name,last_name,unsubscribed,segments:[{id}]})` requires an explicit subscription decision. `contacts.list({limit,after,segment_id})`, `contacts.get({id})`, `contacts.update({id,unsubscribed,...names})`, `contacts.addSegment({id,segmentId})` and `contacts.removeSegment({id,segmentId})` manage ordinary recipients. Never reset an existing opt-out merely because somebody signs in again. The app owns consent and tenant-to-contact authorization.
4. Render your template to HTML using your framework or write it in Resend's **Broadcasts** editor. Include an actual unsubscribe link, e.g. `<a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>`. Provider variables such as `{{{contact.first_name|there}}}` are resolved by Resend. No hosted template ID is required for this HTML path.
5. Call `broadcasts.create({segment_id,from,subject,html,name?,text?,preview_text?})`. It always saves `send:false`; it cannot silently send. Read back with `broadcasts.get({id})`, list with `broadcasts.list({limit,after})`, or replace the editable content with `broadcasts.update({id,segment_id,from,subject,html,...})`. Review sender, recipient segment and rendered content in the app or Resend dashboard. For preview, use your framework's renderer; use a separate segment containing only your test addresses for an explicit test send.
6. After the operator approves the selected recipients/content, invoke `broadcasts.send({id})`. This affects the whole selected segment. The application must authorize this operation separately from draft editing and restrict IDs to its tenant. API acceptance is not delivery proof. Creation/sending each make one request, with no automatic retries; inspect provider status after an uncertain outcome rather than creating duplicate campaigns.

JSKIT uses the same connection slot and backend Env for these operations through `connections.invoke`. CLI apps compose that service directly; other frameworks use their own Resend client/HTTP implementation with the same project-owned configuration. Vibe64 edits setup; it does not run a shared sending service or own recipient lists.

**LIMITATIONS:** No visual campaign builder, hosted-template catalogue, topic/custom-property administration, automation engine, scheduling UI, inbound mail, attachments, delivery-webhook processor, analytics dashboard or automatic coding-assistant attachment. Example: the app can create a newsletter draft and explicitly send it to a reviewed segment, but its own UI or Resend dashboard supplies preview and reporting. Transactional `emails.send` remains plain text with the existing idempotency-key contract. The unsubscribe marker check cannot verify the quality/visibility of rendered HTML; review the actual content.

Sources checked 13 September 2026: [segments](https://resend.com/docs/api-reference/segments/create-segment), [contacts](https://resend.com/docs/api-reference/contacts/create-contact), [broadcast creation](https://resend.com/docs/api-reference/broadcasts/create-broadcast), [explicit send](https://resend.com/docs/api-reference/broadcasts/send-broadcast), [provider OpenAPI](https://github.com/resend/resend-openapi/blob/main/resend.yaml). Controlled tests exercise this journey; no real emails or generated applications were run.
