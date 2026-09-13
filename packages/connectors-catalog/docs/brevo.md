# Brevo

Import `brevoProvider` from `@jskit-ai/connectors-catalog/server/brevo`.
The adapter uses an ordinary Brevo API key for contacts, transactional email/SMS,
marketing campaigns, sender/domain setup and automation events.

## Set up access

1. Sign in to the intended Brevo account with API-key management permission.
2. Open the account dropdown and choose **Settings → SMTP & API → API Keys & MCP**.
3. Generate a new API key and give it a name identifying the application and
   environment. Copy the full value while it is shown.
4. Store it outside source, for example as `BREVO_API_KEY` in the backend's
   environment. An SMTP key is a different credential.
5. In `integrations.json`, choose provider `brevo`, mode `shared` or `assistant`,
   empty `scopes`, and `authentication: { "method": "api-key", "secretRef":
   "env:BREVO_API_KEY" }`. This slot needs no OAuth registration.
6. In Vibe64 save configuration, choose **Set credential in Env**, save the key,
   return and choose **Connect account** or **Verify again**. **Check connection**
   reloads status only. CLI apps call `connectApiKey`. Manage/revoke keys through
   the same console; disconnect only removes the local runtime grant.
   See [Brevo key management](https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys).

## Runtime and AI composition

`contacts.list` calls `GET /v3/contacts` with the `api-key` header. Inputs are
`limit` (1–1000, default 50), `offset` (nonnegative, default 0), and `sort`
(`asc`/`desc`, default `desc`). The result keeps `contacts` and `count`; advance
the offset in application code when another page is needed. The verifier uses
this operation, avoiding an account-details response that may contain unrelated
provider credentials. See [Get contacts](https://developers.brevo.com/reference/get-contacts).

Use the [API-key source pattern](../patterns/api-key-connection/PATTERN.md).
The application owns access to contact information and sending
workflows. A CLI and Vibe64 configure the same slot and reference; connection
metadata lives in the chosen runtime file directory.

## Provisioning automation and capacity

An AI can wire the adapter and read contacts after an operator supplies a key.
No API for ordinary-account key creation was verified in this pass. Enterprise
subaccount provisioning must not be assumed available to normal accounts.
Operator setup therefore follows the console steps above.

Each application supplies its own account credentials. Two API keys under
one account do not establish separate sending credits or capacity. Reading contacts does not prove sending readiness; authenticate the sender
domain and complete the account/sender requirements before sending.

Fixtures verify headers, pagination, invalid inputs, storage restart, key
rotation, isolation, disconnect and provider failures. No contacts were read
from a real account.

## Sender and delivery setup

For email, open **Settings → Senders, Domains, IPs → Domains → Add a domain**.
Add the sending domain you control. Use automatic authentication when offered,
or copy every displayed DNS record into that domain's DNS provider. Keep the
exact host, type and value: DKIM may use TXT or multiple CNAME records. Return
and choose **Authenticate this email domain** after manual setup. DNS propagation
may take time; recheck status. Never replace an existing DMARC policy blindly.
[Domain setup](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC).

Then open **Settings → Senders, Domains, IPs → Senders → Add a sender**, enter
From name/email and Save. If prompted, enter the six-digit code emailed to that
address and choose **Verify sender**. The adapter can create/read sender/domain
records, but it does not edit DNS or approve your account.
[Sender setup](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email).

For SMS, inspect your account's recipient-country sender requirements. The
registration UI, when available for your account, is **Settings → Campaigns →
SMS Sender ID → Configure → Request Sender ID**. Choose the country, provide
company/Sender ID and message details, submit and wait for approval. Check SMS
credits before enabling sending. The API key alone does not establish readiness.
[Country Sender ID setup](https://help.brevo.com/hc/en-us/articles/28255350696466-Register-a-Sender-ID-to-send-SMS-messages).

## App operations

The [official API description](https://api.brevo.com/v3/swagger_definition_v3.yml)
was inspected on 12 September 2026. Paths below are relative to
`https://api.brevo.com/v3`; all requests use the backend's `api-key` header.

| Operations | Path / behavior |
|---|---|
| email.send | POST /smtp/email. sender, to, and either templateId/params or subject plus htmlContent/textContent. Returns messageId, not proof of delivery. |
| sms.send | POST /transactionalSMS/sms. Explicit sender, recipient with country code, type transactional/marketing, and content or templateId/params. Long/Unicode content can consume multiple credits. |
| contacts.get/create/update | GET/PUT /contacts/{email}, POST /contacts. Existing defined attributes, list membership, email/SMS blacklist flags. Create defaults updateEnabled false; no automatic force merge or unsubscription reset. |
| folders.list; lists.list/create | GET /contacts/folders, GET/POST /contacts/lists. Creating a list needs its parent folderId. |
| lists.addContacts/removeContacts | POST /contacts/lists/{id}/contacts/add or remove; 1–150 email addresses. Preserve successes and failures separately. Removing list membership does not erase or unsubscribe a contact. |
| senders.list/create | GET/POST /senders. Creation takes name/email; retain returned SPF/DKIM error flags and complete provider verification. |
| domains.create/get/authenticate | POST /senders/domains, GET /senders/domains/{domain}, PUT /senders/domains/{domain}/authenticate. Preserve DNS records and actual verified/authenticated flags. Authentication request is followed by a status read. |
| campaigns.list/get/create | GET/POST /emailCampaigns, GET /emailCampaigns/{id}. Create a draft with name, sender, content/template and explicit recipient lists; exclusions supported. No automatic send/schedule. |
| campaigns.sendTest/sendNow | POST /emailCampaigns/{id}/sendTest with emailTo, or /sendNow. The app must authorize either send explicitly; test recipients may need to be configured in Brevo. |
| email.events / sms.events | GET /smtp/statistics/events or /transactionalSMS/statistics/events. Offset pagination, days and messageId/email or phoneNumber filters. Preserve bounce/rejection details. |
| events.create | POST /events. event_name, identifiers.email_id and optional event/contact properties/date. Events can trigger existing active automations; they do not create a workflow. |

Call path IDs are passed as `resource` (number for lists/campaigns; email for
contacts; bare domain for domains). The same key and configuration are used
from CLI through the [API-key pattern](../patterns/api-key-connection/PATTERN.md).
Other frameworks use their native HTTP, Env and app authorization with these
contracts; Vibe64 and a Node service are not required at runtime.

For an appointment reminder, confirm sender readiness, authorize the recipient,
call email.send, save messageId and read email.events later. For a newsletter,
maintain consenting contacts/lists, create a draft, review a test, then explicitly
sendNow. For automation, configure and activate the matching event-triggered
workflow in Brevo before sending events.create from the application. The app owns
scheduling, consent/unsubscribe UI, delivery reporting and duplicate-send prevention.
No ambiguous send or creation request is automatically retried.

## LIMITATIONS

Editor coding-assistant attachment is deferred. For example, the app can send a
booking email and show its bounce status, but Vibe64's Codex/OpenCode cannot inspect
Brevo merely because this connector is configured. The app owns message content,
recipient authorization and scheduling. This does not supply a template/automation
visual designer, webhook receiver, SMTP service, WhatsApp integration or account
approval. Advanced batch sends and attachments use native provider wiring.
No real messages, domain changes, purchased credits or generated apps were tested.

Focused fixtures cover sends, draft/test/sendNow separation, contacts/list results,
DNS pending state, delivery failures, organization policy denial and no replay after
an uncertain send, alongside existing file restart/rotation/disconnect tests.
