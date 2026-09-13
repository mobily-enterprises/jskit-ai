# Microsoft Outlook

Provider ID `microsoft-outlook`; export `microsoftOutlookProvider` from
`@jskit-ai/connectors-catalog/server/microsoft-outlook`.

Follow every step in [Microsoft registration](microsoft-oauth.md), choosing the
organizational + personal account audience. Under **API permissions → Add a
permission → Microsoft Graph → Delegated permissions**, select `Mail.Read`
and `offline_access`. The account needs an accessible mailbox.

`folders.list` verifies the connection by reading root mail folders at
`/v1.0/me/mailFolders`. Inputs: optional `pageSize` (1–100, default 25),
`includeHiddenFolders` (default false) and `nextLink`. This does not recursively
traverse nested folders. [Folder API](https://learn.microsoft.com/en-us/graph/api/user-list-mailfolders?view=graph-rest-1.0).

`inbox.list` reads `/v1.0/me/mailFolders/inbox/messages`; inputs are `pageSize`
and `nextLink`. Its initial request selects ID, subject, sender, received time
and read state. The inbox list itself does not fetch message bodies or attachments, send email,
or change folders. The 100-item limit is this fragment's bound.
[Message API](https://learn.microsoft.com/en-us/graph/api/mailfolder-list-messages?view=graph-rest-1.0).

Verification input is `{}`. Both operations preserve the `value` collection and
paging link. In an application, choose a per-user connection for each person's
inbox, or an explicitly authorized shared mailbox owner. Connecting the builder
does not connect the application's other users.

AI provisioning is **API-capable after authorization**: create the application
and credentials with the Graph operations in the common guide, using these
delegated permissions. The application owner supplies its registration and
private Env bindings. Directory consent and mailbox policy remain human/provider
decisions. The common guide contains exact console steps, portable JSON,
library wiring and the limitations of app-ID quota separation.

Automated fixtures verify this endpoint, scopes, refresh, encrypted restart,
isolation, invalid paging destinations and controlled failures. Live mailbox use
is excluded. Saving configuration is separate from the editor Connect action, which invokes
the prepared application runtime’s own-registration OAuth lifecycle.

## Captured permission choices and credential handoff

The form includes required Mail.Read, initially selected Mail.ReadWrite, Mail.Send
and Calendars.ReadWrite, and optional Mail.ReadBasic and Calendars.Read.
offline_access requests refresh capability. For reading only, clear optional
write/send/calendar permissions. Microsoft supports narrower Mail.ReadBasic for
these list endpoints, but this form follows the captured required Mail.Read and
the runtime explicitly checks that grant. No permission equivalence is inferred.
Current inbox requests still select basic metadata only; broader permission does
not itself execute the separate body, send and calendar operations described below.

Inline instructions cover Entra registration, audience/tenant, Web callback,
secret Value versus Secret ID and exact Env handoff. Save
`env:MICROSOFT_OUTLOOK_CLIENT_SECRET` and
`env:MICROSOFT_OUTLOOK_CALLBACK_URL`, then use **Set credential in Env** and
**Open Env** for the values. Shared/assistant Connect uses the application's
account; per-user mode requires each application user to connect separately.
The app owns callbacks and grants. This fragment addresses the signed-in account's
mailbox via /me; accessing a different Exchange shared mailbox is not implemented.

## Current mailbox and calendar operations

The original metadata-only scope is superseded. `messages.get({messageId})`
requests text body content. `attachments.list({messageId})` lists attachments;
`attachments.get({messageId, attachmentId})` reads file attachments with bounded
Base64 content (about 5 MB). Treat returned content as untrusted; sanitize any
HTML before rendering and never execute attachments automatically.

`messages.setRead({messageId,isRead})` and `messages.move({messageId,destinationId})`
require Mail.ReadWrite. Keep the new ID returned after moving. `messages.send`
requires Mail.Send and `{subject,text,to:["recipient@example.com"]}` (1–20 recipients).
It sends as the connected account and saves Sent Items. `{accepted:true}` means
HTTP202, not successful delivery. App authorization must approve recipients and
content; no automatic send retry after uncertainty.

`calendars.list({})` and `events.list({calendarId,pageSize})` support Calendars.Read
or Calendars.ReadWrite. `events.create({calendarId,subject,start,end})` requires
Calendars.ReadWrite; start/end are UTC ISO strings ending in Z, with end after start.
It creates an appointment with no attendees/invitations. The app owns time-zone
presentation and event selection, not Vibe64.

CLI uses the same connections.invoke operations; other frameworks call these
Graph endpoints with their own HTTP client and project-owned Env/grant store.
**LIMITATIONS:** No email-client UI, outgoing attachments, draft/reply flows,
shared-mailbox delegation, recurrence, meeting invitations or editor attachment.
Embedded-item/large attachments need native Graph wiring. Example: send a receipt
and create an appointment, but no Outlook replacement. No live/generated-app proof.

[Send mail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0),
[move](https://learn.microsoft.com/en-us/graph/api/message-move?view=graph-rest-1.0),
[attachments](https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0),
[events](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0).
