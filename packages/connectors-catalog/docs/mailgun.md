# Mailgun

Import `mailgunProvider` from `@jskit-ai/connectors-catalog/server/mailgun`.
The adapter verifies an account API key, sends transactional messages, creates
and verifies sending domains, returns their DNS records, and queries delivery logs.
DNS records are installed at the domain owner’s DNS host, not at Vibe64.

## Configure access

1. Sign into the intended Mailgun account as an administrator. Open the profile
   menu at the top right, then **API Security → Add new key**.
2. Enter a description and select **Developer** for sending and domain management. Select **Analyst**
   only for a deliberately read-only connection. Click **Create Key** and copy the secret while it is visible.
   Free/Basic accounts expose Admin only; that restriction comes from Mailgun.
   Existing key roles cannot be edited: create a replacement to change roles.
   [Key roles and dashboard steps](https://help.mailgun.com/hc/en-us/articles/26016288026907-API-Key-Roles).
3. Enter `env:MAILGUN_API_KEY` in **API key reference**. Domain Sending
   Keys and SMTP passwords do not provide this account domain-listing access.
   [Credential types](https://help.mailgun.com/hc/en-us/articles/203380100-Where-can-I-find-my-API-keys-and-SMTP-credentials).
4. Save provider `mailgun`, mode `shared` or `assistant`, `scopes: []`, and
   authentication `{ "method": "api-key", "secretRef": "env:MAILGUN_API_KEY" }`.
   Choose `settings.region: "us"` (default) or `"eu"`, corresponding to the
   intended domains. The editor calls this **API region**.
5. Choose **Save configuration**, then **Set credential in Env**. Store the real
   account key as `MAILGUN_API_KEY`, return, and choose **Connect account**.
   CLI apps call `connectApiKey`. Requests use HTTP Basic authentication with username
   `api` and the resolved key as password. US requests go to
   `https://api.mailgun.net`; EU requests go to `https://api.eu.mailgun.net`.
   Changing region requires verification again.
   [Authentication](https://documentation.mailgun.com/docs/mailgun/api-reference/authentication/).

## Runtime and AI composition

`domains.list` reads `GET /v4/domains`. It accepts `limit` (1–1000, default
100), `skip` (default 0), optional `state` (`active`, `unverified`, `disabled`),
`sort` (`name`, `name:asc`, `name:desc`), `search`, and `include_subaccounts`
(default false). Results contain `items` and `total_count`. Advance `skip` by
the number of received items to retrieve another page.
[Domain listing](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/domains/get-v4-domains).

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with the file
store. Application code can use the operations below with the same configured connection. Local disconnect does not revoke the account key. Replace
the Env value when rotating credentials, and delete obsolete keys in Mailgun.
Tests cover both regional origins, HTTP Basic headers, pagination, re-verification,
file restart and rejected responses without accessing a real mailbox or account.

## Automation and application ownership

After administrator credential bootstrap, an AI can automate key creation
through `POST /v1/keys` using multipart form fields: `kind=user`, a required
`role` (`basic` is the API value for Analyst), a `description`, and optionally
positive `expiration` seconds. Persist the returned `key.secret` directly in
secret storage. The runtime fragment does not expose this administrative
operation. [Key creation API](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/keys/post-v1-keys).

Each application supplies credentials for its intended Mailgun account. Keys
within one account may share capacity and billing. The application operator
owns account selection and budgets; key names alone do not isolate quotas.


## Credential guidance review (2026-09-12)

Current provider key-role, credential-type and domain-list documentation were
checked against the captured private key and US/EU fields. Inline setup now
explains the exact dashboard flow, admin requirement, Analyst where available,
one-time secret display, account-key distinction, region and named Env handoff.
Verification remains a domain-list read; it sends no email and changes no DNS.
Three focused test cases passed (1.15s), including the shared regional-destination
regression: changing region requires verification before credentials reach the
new allowed origin. No runtime change was needed. The controlled browser review passed: the EU region and MAILGUN_API_KEY reference persist after reload, Env and provider guide links are present, and simulated connect/verify/disconnect work. All six steps were visually inspected at 496px width. No live account, email sending or generated application was exercised.

## Sending and domain setup

1. In Mailgun, open **Send → Sending → Domains → Add new domain**. Enter a
   domain you control, commonly a dedicated subdomain such as `mail.example.com`,
   and select its region. Alternatively call `domains.create` with `{ domain }`.
2. Open the domain's **Domain Verification & DNS** page. At your DNS host, add
   the exact sending records shown by Mailgun. `domains.get` returns the same
   sending/receiving record sets for application-owned setup screens. Do not
   invent SPF/DKIM values. Some hosts append your root domain automatically.
   Receiving MX records are separate from outbound sending: do not replace
   existing business-mail MX records just to send through Mailgun.
3. Check DNS status in Mailgun or call `domains.verify` with `{ domain }`.
   A successful HTTP response can still contain `domain.state: "unverified"`;
   display each DNS record's status and allow the operator to retry after DNS
   propagation. A successful key check alone does not prove DNS readiness.
4. Choose a sender address at that domain in your application's mail settings.
   Keep recipient selection behind the application's authorization/business rules.
   Sandbox domains can send only to authorized recipients; use a verified custom
   domain for production.

[Domain setup](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-custom)
[DNS verification](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify)
[Domain API](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/domains)

The runtime operations accept `{ domain }` for `domains.create`, `domains.get`,
and `domains.verify`. Creation and verification are explicit mutations; connecting
never performs them. Developer keys support these operations; Analyst keys do not.
[Current role matrix](https://documentation.mailgun.com/docs/mailgun/user-manual/api-key-mgmt/rbac-mgmt).

```js
const queued = await connections.invoke({
  context, integrationId: "mail", operation: "messages.send",
  input: {
    domain: "mail.example.com", from: "Support <support@mail.example.com>",
    to: ["customer@example.com"], subject: "Your receipt",
    text: "Thank you for your purchase.", html: "<p>Thank you for your purchase.</p>"
  }
});
```

`messages.send` requires `domain`, `from`, `to`, `subject`, and plain `text`;
HTML is optional. It sends multipart data to the configured US/EU region and
returns Mailgun's queued message ID. It does not claim inbox delivery. This
operation does not support attachments or templates yet. A timeout after sending
has an uncertain outcome: do not blindly retry or fabricate an idempotency header.
Keep the queued ID with your application's delivery record when available.
[Send API](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages).

## Delivery logs and failures

Call `logs.list` with `{ domain, duration: "1d", limit: 50 }`. It queries the
current `/v1/analytics/logs` API (the older Events API is deprecated). Results
preserve event type, recipient, severity and delivery status. Pass the returned
`pagination.next` as `token` to fetch another page. For stable traversal, supply
an RFC 2822 `end` timestamp on the first request and reuse it for subsequent
pages. Poll with a bounded schedule owned by your app; retain event IDs to avoid
processing overlapping results twice. The domain filter is mandatory and
subaccount aggregation is disabled. A sending key is not sufficient for this
account-level connector; it requires an account API key.

A queued/accepted event differs from delivered; a temporary failure differs from
a permanent rejection. Surface the provider's status instead of marking every
queued message delivered. Log retention and available results depend on the
Mailgun account. No automatic resend is performed. HTTP 401 requires reconnecting
with corrected credentials; HTTP 429 should be surfaced for application-managed
backoff. [Logs API](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/logs).

## Repair proof and remaining acceptance

`test/mailgun.test.js` exercises the actual connection service with controlled HTTP:
US/EU multipart sends, repeated recipients, domain creation/read/verification,
DNS status preservation, delivery failures, pagination, app isolation, denied
operations, invalid inputs, 401/429 and uncertain writes. Three tests pass.
No Mailgun account or actual email delivery was used. The inline credential guide
must be reviewed in the public editor before provider acceptance is closed.

**LIMITATIONS:** No attachments, stored templates, campaign/mailing-list UI, inbound
routes, webhook receiver or editor-assistant attachment. Example: send and track
a receipt email, but not attach its PDF through this adapter. Application-native
mail settings/business rules own sender and recipient authorization, content,
polling and duplicate prevention. CLI apps use the same configuration and Env;
other frameworks compose these requests with their own HTTP/mail tools.
