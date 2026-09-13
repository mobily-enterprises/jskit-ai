# Gmail setup and runtime

Documentation checked: 8 September 2026. Automated tests use simulated provider
responses and real private JSON state; live provider use is outside this delivery.

## Registration and manual setup

Follow all numbered steps in [Google registration setup](google-oauth.md).
For this connector, choose **Gmail API** in APIs & Services → Library and enable
`gmail.googleapis.com` in the selected Cloud project. Create a Web application client
with the exact backend callback URI. Set the client ID, secret reference and
callback URL reference in the same registration fields used by the CLI.

In Google Auth Platform → Data Access, select
`https://www.googleapis.com/auth/gmail.readonly` (required by this connector).
The captured defaults also select `gmail.send`, `gmail.compose` and `gmail.modify`.
Remove optional permissions your application does not need; verification only reads the profile; writes require explicit app operations.
The UI exposes additional documented scopes for applications that need them;
those scopes do not add operations to this fragment. Use External plus explicit
test users while testing outside an eligible internal Workspace audience.

## Fields and useful fragment

Provider ID: `gmail`. Import its provider from
`@jskit-ai/connectors-catalog/server/gmail`. Display name, scopes, account mode,
Client ID/secret and callback references follow the shared field mapping.
Membership and project access are enforced by the host/application policy,
not by storing untrusted people IDs in application source.

Operations include profile, message/search/attachment reads, drafts, explicit send, labels and reversible mailbox actions listed below.
Verification input: `{}`.

The profile read returns the authenticated mailbox address and message count. Message listing accepts maxResults (1–500), pageToken and repeated labelIds; pass nextPageToken to continue. Message get reads headers using format=metadata and requires a message id. Use messages.read for full/raw content, attachments.get for external MIME parts and messages.search for q. These operations exclude gmail.metadata, which cannot authorize bodies or search.

The first read must succeed before Connected is returned. Invalid resource
identifiers fail before opening consent. Denied scopes, wrong account context,
replayed callbacks and provider rate limits are covered by the automated tests.
See the [official operation reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile) for the response and resource
permission requirements; the implementation also checks Google's public API
discovery document for request paths and supported scope strings.

## Automation and application setup

Classification: **assisted**, as detailed in the common Google guide. An
operator-authorized AI can check/create the Cloud project and enable
`gmail.googleapis.com` with Service Usage or gcloud. It can prepare this connector's
JSON and callback/scope values. Web-client creation, branding, audience,
provider review and account consent remain the documented console/operator
steps; this adapter does not invent an API for them.

The application owns the Cloud project selection, registration, callback and
private secret bindings. It uses the same setup from a CLI or either editor.
Follow the common guide for rotation, revocation, domain changes and recovery.
Provider quotas belong to the selected Cloud project and resources; editor
subscription level does not allocate a shared registration.

## AI/CLI wiring

Use the file-store composition from the [connection pattern](../patterns/api-key-connection/PATTERN.md),
replace the API-key authentication with `oauth2` plus a registrationRef, and
register this provider. Use beginAuthorization / completeAuthorization instead
of connectApiKey, with the verification input above. The existing application
owns authenticated callback routes and its permission policy. Configuration,
OAuth, refresh, provider requests and storage remain library imports.

## Mailbox workflows and permission boundaries

| Operations | Inputs and required permission alternatives |
|---|---|
| `messages.read` | `id`, optional full/raw `format`; readonly, modify or full-mail |
| `messages.search` | `q`, maxResults/pageToken/labelIds/includeSpamTrash; same body-read permissions |
| `attachments.get` | `messageId`, attachment `id` from a MIME part; same body-read permissions |
| `messages.send` | base64url MIME `raw`, optional `threadId`; send, compose, modify or full-mail |
| `messages.modify` | `id`, addLabelIds/removeLabelIds (up to 100 each); modify or full-mail |
| `messages.trash`, `messages.untrash` | `id`; modify or full-mail |
| `drafts.list`, `drafts.get` | Pagination or draft `id`; readonly, compose, modify or full-mail |
| `drafts.create`, `drafts.update` | `raw`, optional threadId; update also draft `id`; compose, modify or full-mail |
| `drafts.send`, `drafts.delete` | draft `id`; compose, modify or full-mail |
| `labels.list` | No input; readonly, metadata, labels, modify or full-mail |
| `labels.create`, `labels.update`, `labels.delete` | `name`, id+name, or id; labels, modify or full-mail |

The runtime checks both configured and actually granted OAuth scopes before
sending an operation. Adding a scope in configuration requires a new consent.
An app user's connection uses `users/me`: the app cannot select another mailbox
by passing an email address. Shared connections still require app authorization
before exposing mail to visitors.

Read the returned MIME tree recursively. Inline body parts and attachment
responses carry base64url data; attachments may be separate parts. The app's
framework should parse MIME, sanitize HTML, control remote images and supply
safe download filenames. The connector does not render email or write files.
`messages.get` remains the explicitly metadata-only operation; `messages.read`
returns full/raw content. Listing and search return IDs, followed by reads as
needed; follow nextPageToken, not resultSizeEstimate, for pagination.

```js
const page = await connections.invoke({ context, integrationId: "gmail",
  operation: "messages.search", input: { q: "in:inbox is:unread", maxResults: 20 } });
const message = await connections.invoke({ context, integrationId: "gmail",
  operation: "messages.read", input: { id: page.messages[0].id } });
// After explicit app authorization, mark read and archive:
await connections.invoke({ context, integrationId: "gmail",
  operation: "messages.modify", input: { id: message.id,
    removeLabelIds: ["UNREAD", "INBOX"] } });
```

Handle an empty messages array before choosing an item. Build outgoing MIME
using your framework's mail library, then encode it as base64url in `raw`.
This adapter bounds raw input to 14 million characters; use a framework-native
upload flow for larger messages. The From address must be authorized for the
connected mailbox. Replies need valid In-Reply-To/References headers, matching
subject and threadId; setting threadId alone does not guarantee threading.
Draft updates replace the draft's message. Deleting a draft or label is explicit;
label deletion removes that label, not its messages. Trash is reversible here;
permanent message deletion is not implemented.

A send response identifies an accepted message, not final delivery. Do not
blindly retry an uncertain send: inspect Sent and reconcile using your app's
record first. The app owns duplicate prevention and any delivery/bounce handling.

CLI users use the same JSON and private Env with optional JSKIT libraries.
Other frameworks use their native OAuth and MIME tools with the same settings
and [Gmail REST methods](https://developers.google.com/workspace/gmail/api/reference/rest).
An AI can wire those operations using the provider schema and this guide without
Vibe64 running. There is no shared Vibe64 mailbox or Google registration.

**LIMITATIONS:** no background/history sync, push watch service, mail-client UI,
permanent message deletion or mailbox-settings administration. MIME composition
and rendering belong to the framework; editor assistant attachment is deferred.
Example: a booking app can read a customer's message, draft a reply, explicitly
send it and archive the thread's selected message; installing the connector does
not build the inbox UI or keep a local mailbox synchronized. Google approval,
real delivery and live mailbox permissions remain untested.
