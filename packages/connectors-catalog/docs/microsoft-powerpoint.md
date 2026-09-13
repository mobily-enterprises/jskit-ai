# Microsoft PowerPoint

Provider ID `microsoft-powerpoint`; export `microsoftPowerPointProvider` from
`@jskit-ai/connectors-catalog/server/microsoft-powerpoint`. This initial adapter browses
presentation files and folders in the connected account's default drive, and reads
file metadata. It does not read or edit presentation contents, download files,
execute macros, create files or change sharing. A filename extension identifies
a candidate file; it is not a check of the file's actual format.

## Registration and configuration

Follow the complete [Microsoft registration steps](microsoft-oauth.md).
Use **Any Entra ID Tenant + Personal Microsoft accounts** with `common`, or the
matching organizational, personal-only or single-directory option in that guide.
For one directory, copy **Directory (tenant) ID** into `settings.tenantId`.
Under **API permissions → Add a permission → Microsoft Graph → Delegated
permissions**, select `Files.Read` and `offline_access`. Then configure the
Web callback, create a client secret and store its Value through the referenced
Env variable. Use an account with an existing drive; JSKIT does not provision it.

```json
{
  "schemaVersion": 1,
  "integrations": {
    "files": {
      "provider": "microsoft-powerpoint",
      "accountMode": "per-user",
      "scopes": [
        "Files.Read",
        "offline_access"
      ],
      "settings": {
        "tenantId": "common"
      },
      "authentication": {
        "method": "oauth2",
        "registrationRef": "microsoft"
      }
    }
  },
  "registrations": {
    "microsoft": {
      "source": "own",
      "clientId": "YOUR_APPLICATION_CLIENT_ID",
      "clientSecretRef": "env:MICROSOFT_CLIENT_SECRET",
      "callbackUrlRef": "env:MICROSOFT_CALLBACK_URL"
    }
  }
}
```

The same values are editable in Vibe64: display name, account ownership, tenant,
Client ID, secret/callback references and the two permission choices. Saving the
file does not open provider consent. The [OAuth composition pattern](../patterns/oauth-connection/PATTERN.md)
uses the library for consent, private encrypted text storage and runtime access.
A per-user slot uses the app's authenticated subject. A shared slot uses the
host's membership policy and stable shared subject; it is a shared account.

## Runtime operations

- `items.list`: optional `folderId`, `pageSize` (1–100, default 25) and `nextLink`.
  Without `folderId`, reads `/v1.0/me/drive/root/children`; otherwise reads
  `/v1.0/me/drive/items/{folderId}/children`. Keeps folders and files whose
  extensions are ppt, pptx, pptm, pot, potx, potm, pps, ppsx, ppsm, case-insensitively.
- `items.get`: required `itemId`, reading `/v1.0/me/drive/items/{itemId}`.
  Returns a matching file's metadata. Other file types and folders produce
  `connector_document_type_invalid`.

Both operations require `Files.Read`. IDs must be opaque item IDs, not paths or
URLs. Selected metadata includes ID, name, size, web URL, file/folder facets,
parent reference, last modification time and ETag. The adapter does not follow
returned URLs. [Graph children API](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0),
[Graph item API](https://learn.microsoft.com/en-us/graph/api/driveitem-get?view=graph-rest-1.0).

`items.list` verifies a new connection with input `{}`. Its page size bounds the
upstream page before local file filtering. A filtered page can be empty and
still have `@odata.nextLink`: retain that link and pass it with the same folder
input to continue. It is not a recursive search or an automatic full-drive scan.
Next links cannot change Graph origin or the selected resource path.

## Application registration and AI provisioning

AI provisioning is **API-capable after operator authorization** using the
application and credential endpoints in the common guide. Registration remains
separate from account consent and tenant administrator policy.

Register the callback served by this application's backend. Store its exact URL
and client secret in application environment bindings. The same setup works with
a CLI, installed editor or hosted editor; none supplies a shared registration.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md) for domain
changes and reconnect behavior. Keep the selected Microsoft tenant/audience
consistent with the provider registration.

## Evidence and limits

Focused fixtures cover consent, cancellation, encrypted restart, refresh,
reduced permissions, owner isolation, tenant changes, folder paging, empty
filtered pages, metadata validation and controlled provider failures. Provider
HTTP is simulated. No live account, provider registration or generated app is
used. Provider-console administration and live account acceptance remain
outside this fixture evidence.

## Editor credential handoff

The inline guide supplies Entra registration, account audience, Web callback,
delegated permissions, secret Value and expiry steps. Save
`env:MICROSOFT_POWERPOINT_CLIENT_SECRET` and
`env:MICROSOFT_POWERPOINT_CALLBACK_URL`; use **Set credential in Env** and
**Open Env** to store the values. Shared/assistant **Connect account** invokes
the prepared application runtime. Per-user connections belong to individual
users inside that application. No Vibe64 gateway or shared registration is used.

## Existing-scope closeout — 13 September 2026

Delegated project-owned OAuth browses default-drive folders and PowerPoint candidate filenames and fetches selected file metadata, with bounded paging, tenant/audience configuration and refreshed private grants.

No slide/presentation content reading, creation/editing, upload/download, conversion, macros, sharing, recursive search, arbitrary drive/site selection or file format validation. Filename extension filtering is not content inspection; filtered empty pages can still have a continuation. No app-only/client-credentials or device-code grant, application login or automatic remote consent revocation. The app owns callback routes, account connection UI, authorization and file-picker/pagination behavior. Exact Lovable shared-form fields/scopes remain unverified because the saved shared-form reference is a loading placeholder. To extend: use supported native presentation tooling and file transfer, proving actual slide changes, conflict handling and format preservation; no invented Graph slide-editing endpoint. No live provider account, provider registration, paid request or generated-application execution was tested. No new editor coding-assistant tool attachment is claimed. Other frameworks use the same project configuration and their own native tools; JSKIT is optional.

7 provider-specific source and 7 installed-package cases passed, plus 2 shared Microsoft tenant checks in each 16-test Word/PowerPoint run on September 13. September 12 rendered guidance/form/lifecycle evidence at 496px is retained; no new phone or browser run.
