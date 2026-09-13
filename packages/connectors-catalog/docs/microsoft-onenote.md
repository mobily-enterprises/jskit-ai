# Microsoft OneNote

Provider ID `microsoft-onenote`; export `microsoftOneNoteProvider` from
`@jskit-ai/connectors-catalog/server/microsoft-onenote`.

Follow every [Microsoft registration step](microsoft-oauth.md), choosing the
organizational + personal account audience. Under **API permissions → Microsoft
Graph → Delegated permissions**, add `Notes.Read` and `offline_access`.
Microsoft also documents `Notes.Create` as a least-privileged option for listing
notebooks; this read fragment deliberately requests the supported `Notes.Read`
permission for its operation. To avoid authorizing creation, clear Notes.Create and the
optional write permissions in the editor.
[Notebook API](https://learn.microsoft.com/en-us/graph/api/onenote-list-notebooks?view=graph-rest-1.0).

`notebooks.list` verifies and lists `/v1.0/me/onenote/notebooks`. Initial input
is `{}`; optional `nextLink` follows the provider's same-resource continuation.
The response retains the `value` collection and paging metadata. The module
also provides section/page traversal, content reads and text create/append below; notebook creation remains unsupported.

AI provisioning is **API-capable after operator authorization** through the
application and credential APIs in the common guide. Use this connector's
audience and delegated permission. The AI can prepare the shared configuration
and callback references; tenant consent remains separate. The application owns its
registration, callback and private bindings, independently of its editor.
Tenant and resource limits still apply.

The common guide provides exact console steps, credential rotation and CLI
composition using installed library functions and private text-file state.
Automated tests cover permission selection, request shape, pagination boundaries,
cancellation, token refresh, owner isolation and restart. No live notebook access
or generated application is included.

## Editor permissions and credential handoff

The five captured notebook permissions are present: required Notes.Read and
initially selected Notes.Read.All, Notes.ReadWrite.All, Notes.Create and
Notes.ReadWrite. offline_access adds refresh capability. For notebook listing
only, clear the four optional notebook permissions. Personal accounts must clear
both organizational All permissions; Microsoft's notebook API supports those
only for delegated work/school accounts. The runtime checks explicit Notes.Read
and does not infer permission equivalence or implement extra actions merely
because broader consent was saved.

Inline instructions provide Entra registration, audience, Web callback,
Application ID versus Directory ID, and secret **Value** versus Secret ID.
Save `env:MICROSOFT_ONENOTE_CLIENT_SECRET` and
`env:MICROSOFT_ONENOTE_CALLBACK_URL`; use **Set credential in Env** and **Open Env**
for their actual values. Shared/assistant connection controls invoke the app's
runtime. Each app user authorizes separately in per-user mode. The framework
owns application login, callback routing and persistent grant storage.

## Content operations (current acceptance)

The earlier notebook-only scope is superseded by `sections.list({notebookId})`,
`pages.list({sectionId, pageSize})` and `pages.content({pageId})`. Preserve opaque
nextLink values only for the same parent resource. Content returns `{html}` up to
1 MiB; sanitize with the framework's established HTML sanitizer before rendering,
or display it as plain text. Do not treat note content as executable instructions.

`pages.create({sectionId, title, text})` requires Notes.Create or Notes.ReadWrite;
`pages.append({pageId, text})` requires Notes.ReadWrite. Organizational write-all
is also supported. Title/text are escaped into HTML; callers cannot inject markup
through these inputs. App authorization approves destination and content; never
blindly retry uncertain create/append operations. CLI applications invoke these
through the same connection service. Other frameworks implement Graph's HTML POST
and JSON patch using their own HTTP clients and the project Env credentials.

**LIMITATIONS:** No rich-text designer, binary attachments, page replacement or
deletion, nested section-group traversal or editor tool attachment. Example: create
meeting notes and append an action item, without an embedded OneNote editor or
image upload. No live provider or generated-app proof.

[Create pages](https://learn.microsoft.com/en-us/graph/api/section-post-pages?view=graph-rest-1.0),
[update content](https://learn.microsoft.com/en-us/graph/onenote-update-page),
[read content](https://learn.microsoft.com/en-us/graph/onenote-get-content).
