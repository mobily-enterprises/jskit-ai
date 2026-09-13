# Microsoft SharePoint

Provider ID `microsoft-sharepoint`; export `microsoftSharePointProvider` from
`@jskit-ai/connectors-catalog/server/microsoft-sharepoint`.

Follow all [Microsoft registration steps](microsoft-oauth.md), choosing
**Multiple Entra ID tenants**. The module uses the `organizations` authority;
personal Microsoft accounts are unsupported. Under **API permissions → Microsoft
Graph → Delegated permissions**, add `Sites.Read.All`, `User.Read` and `offline_access`.
The form requires site read and profile read; site search itself uses only
`Sites.Read.All`. Optional site write and file read start selected. Clear them
for a search-only application. Site manage, full control and file write are
also available, but selecting permissions does not implement those operations.
Site access remains limited by the signed-in user's rights and tenant policy.

`sites.search` calls `/v1.0/sites?search={query}`. Pass
`{ "search": "your site search text" }` as verification input before consent.
The required nonempty search has a 1024-character fragment bound. Results retain
the site `value` collection and any paging metadata; use optional `nextLink`
for same-resource continuation with the original search input. Empty results
are a successful authorized search, not proof of a particular site's existence.
This fragment does not edit sites, crawl documents or implement selected-site
application permissions. [Site search API](https://learn.microsoft.com/en-us/graph/api/site-search?view=graph-rest-1.0).

AI provisioning is **API-capable after operator authorization**, using the
application/credential APIs and these delegated permissions. The common guide
details console navigation, application-owned client ID and private secret/callback
references, and limitations of quota separation. Creating an app does not grant
the user access to additional sites.

Compose the same library operations and private file store from a CLI or an
application backend, using an authenticated application/subject policy.
Automated fixtures verify required search input, query encoding, organizational
OAuth, permission failure, paging boundaries, cancellation, refresh and restart.
No live tenant access or generated application is used.

## Editor credential handoff

The inline guide covers Entra registration, organizational audience, exact Web
callback, delegated permissions and secret Value. Save the configuration with
`env:MICROSOFT_SHAREPOINT_CLIENT_SECRET` and
`env:MICROSOFT_SHAREPOINT_CALLBACK_URL`. Use **Set credential in Env** and
**Open Env** to store their values, then enter **Site search** and connect.
Shared/assistant connections belong to this project; per-user connections belong
to authenticated users of the generated app. No editor-owned registration or
gateway is involved. Rotate secrets before expiry and reconnect after consent
changes. Local disconnect does not revoke Microsoft consent.

## Current document and list operations

From `sites.search`, pass the returned siteId to `libraries.list` or `lists.list`.
`files.list({driveId,folderId?,pageSize?})` browses libraries. `files.get({driveId,itemId})`
returns metadata and a private temporary download URL. Download through the native
browser/client without the Microsoft Authorization header; do not log/cache the URL.
`files.upload({driveId,parentId,name,bodyBase64,conflictBehavior?})` reuses the OneDrive
binary-transfer implementation, capped at 5 MB, default conflict fail. Replacing
existing files requires explicit app approval. Sites.ReadWrite.All is required.

`listItems.list({siteId,listId,pageSize?})` expands fields; retain the item ETag.
`listItems.create({siteId,listId,fields})` and
`listItems.update({siteId,listId,itemId,fields,eTag})` use Sites.ReadWrite.All.
Fields use internal column names, up to 100 scalar values/64 KiB. Update sends
If-Match; on 412 reload and review the competing change. Do not automatically
repeat uncertain writes. CLI uses the same connection service; other frameworks
call Graph with their own HTTP clients and the same project Env ownership.

**LIMITATIONS:** No site-collection creation, admin UI, complex field editors,
sharing/permission editor or editor tool attachment. Native downloads and large
resumable transfers are documented composition, not executed here. Example: update
a status list/upload a report, without a SharePoint site builder. No live/generated-app proof.

[Libraries](https://learn.microsoft.com/en-us/graph/api/drive-list?view=graph-rest-1.0),
[list items](https://learn.microsoft.com/en-us/graph/api/listitem-list?view=graph-rest-1.0),
[create](https://learn.microsoft.com/en-us/graph/api/listitem-create?view=graph-rest-1.0),
[update](https://learn.microsoft.com/en-us/graph/api/listitem-update?view=graph-rest-1.0).
