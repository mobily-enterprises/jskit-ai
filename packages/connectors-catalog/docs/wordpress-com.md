# WordPress.com

Import `wordpressComProvider` from
`@jskit-ai/connectors-catalog/server/wordpress-com`. This fragment uses an own
OAuth web registration for profile/site reads, post/page publishing and media management. It is distinct from
self-hosted WordPress Application Password authentication.

## Register and configure

1. Sign into WordPress.com. Open the [Applications Manager](https://developer.wordpress.com/apps/)
   and choose **Create New Application**.
2. Enter its name and description and the exact backend **Redirect URL**, then
   choose **Create**. Retain the Client ID and store the Client Secret privately.
   [Provider's registration walkthrough](https://github.com/Automattic/rest-api-console#configuring-the-console).
3. Put the secret in `WORDPRESS_COM_CLIENT_SECRET` and the full callback URL in
   `WORDPRESS_COM_CALLBACK_URL`. Enter the ID and these references in the editor.
4. Keep `users` for verification. Select `sites` for site listing and `posts` for
   post reads and publishing. Save configuration, then start consent through the runtime.

Server-to-server requests do not require each editor VM to be a JavaScript
origin. Browser API access instead has its own configured-origin requirements;
this fragment keeps provider tokens on the backend.
[Browser access](https://developer.wordpress.com/docs/api/rest-api-javascript/).

The OAuth flow uses `public-api.wordpress.com/oauth2/authorize` and
`/oauth2/token`, with an exact registered redirect URI. It requests granular
permissions rather than `global`; provider selection limits site access. The
`posts` permission allows both reads and management; the application must authorize each publishing action.
[OAuth and scopes](https://developer.wordpress.com/docs/api/oauth2/).

```json
{
  "schemaVersion": 1,
  "registrations": {
    "wordpress": {
      "source": "own",
      "clientId": "YOUR_ASSIGNED_CLIENT_ID",
      "clientSecretRef": "env:WORDPRESS_COM_CLIENT_SECRET",
      "callbackUrlRef": "env:WORDPRESS_COM_CALLBACK_URL"
    }
  },
  "integrations": {
    "publishing": {
      "provider": "wordpress-com",
      "displayName": "Publishing account",
      "accountMode": "per-user",
      "scopes": ["users", "sites", "posts"],
      "authentication": { "method": "oauth2", "registrationRef": "wordpress" }
    }
  }
}
```

The editor offers shared, per-user and assistant ownership. Choose per-user
when each application user connects independently. Select media permission to upload and manage attachments. Comments enables discussion and moderation operations. Stats provides the site summary; taxonomy provides category/tag management.
Batch enables bounded read batches; each underlying resource remains subject to provider permissions.
All five optional permission families default off. Configuration
does not itself grant access or implement login.

## Runtime and AI composition

Use the [OAuth file-connection pattern](../patterns/oauth-connection/PATTERN.md).
The provider adapter and connection lifecycle are imported JSKIT code. CLI and
editor use the same JSON, with encrypted text runtime files outside source;
no editor, database or generator is needed.

Verification reads `/rest/v1.1/me` with a limited fields selection, including
`token_scope`, `token_client_id` and `token_site_id`. These fields describe the
issued token's permissions and ownership.
[Profile response](https://developer.wordpress.com/docs/api/1.1/get/me/).
The adapter rejects a mismatched client and retains only permissions present
in the request, token response when supplied, and verified profile. Missing
`users` permission fails verification without replacing an existing grant.
It does not use a successful public post listing to authenticate the account.

The runtime sends comma-separated scopes following the provider examples.
It sends state and PKCE parameters; provider-side PKCE enforcement has not been
established by these local tests. The documented code-token example has no
expiry or refresh token. This adapter does not invent either: an explicit
expiry without refresh or a later 401 requires consent again. An absent expiry
does not promise permanent access. Local disconnect does not revoke the
provider grant; manage provider access separately.

`sites.list` accepts `site_visibility` (all/visible/hidden) and `site_activity`
(all/active/inactive), both defaulting to all. It returns the accessible `sites`
array in its provider envelope; no all-sites `global` grant is requested.
[Sites](https://developer.wordpress.com/docs/api/1.1/get/me/sites/).

```js
const sites = await connections.invoke({ context, integrationId: "publishing", operation: "sites.list" });
const page = await connections.invoke({
  context, integrationId: "publishing", operation: "posts.list",
  input: { siteId: 81, number: 20, status: "publish", context: "display" }
});
// If page.meta.next_page is present, pass it as page_handle on an explicit next call.
```

`posts.list` accepts a numeric site ID, `number` (1–100, default 20), an opaque
`page_handle`, `search`, `status` and display/edit `context`. The result retains
`found`, `posts` and `meta.next_page`; no next page is fetched automatically.
[Post listing](https://developer.wordpress.com/docs/api/1.1/get/sites/$site/posts/).
The fragment bounds cursor length to 4096 and search to 500 characters. Site
domains/URLs are deliberately excluded from operation input. All authenticated
requests stay on `public-api.wordpress.com`, redirects fail, and returned site
URLs remain data. Applications own authorization and safe rendering of HTML.

## Application ownership, callbacks and capacity

An AI can prepare configuration, callback wiring and library composition.
The reviewed registration instructions establish a dashboard flow, not a
supported public API for provisioning OAuth clients. Initial registration and
provider consent remain owner steps; do not invent a client-creation endpoint.

The application owner creates the provider registration and stores its secret
in the application's private Env. Public Vibe64, Vibe64 Online and CLI users use
this same ownership model. The configuration file holds the client ID and Env
references; the editor does not own the application's grants.

Register the exact callback implemented by the application. For a hosted project,
start with its assigned application URL and append the implemented callback path.
Save that same URL through the application's callback Env reference. On a domain
or host change, update both the provider registration and callback Env if the URL
changes. Preserve the application's identity and persistent grant store when
moving it; neither a new editor URL nor a new hosting address creates a new owner.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md) and
[application setup command](../../connectors-core/docs/setup-command.md).

Separate client IDs distinguish registration ownership and revocation. They do
not prove independent quota pools: provider limits can include shared user/site
or infrastructure boundaries. Automattic's guidelines prohibit excessive API
traffic and allow access limits.
[API usage guidance](https://developer.wordpress.com/docs/api/guidelines-for-responsible-use-of-automattics-apis/).

## Focused evidence

Six provider tests use simulated HTTP and real encrypted JSON files. They cover
client verification, reduced scopes, cancellation, replay, persistence, owner
isolation, post paging, malformed replies and reconnect/error behavior. The
shared OAuth test additionally proves that refresh cannot restore permissions
removed during verification. Editor proof covers registration references,
permission selections and reload. No live signup, consent, provider calls or
sample-app generation are included. Login is not supplied. Publishing, media, comments, statistics, taxonomy and bounded batches have additional controlled fixtures; final package/UI acceptance is recorded separately.

## Post and page publishing

`posts.get` retrieves one numeric `siteId`/`postId`, defaulting to `context: edit`.
`posts.create` takes a title plus optional content, excerpt, slug, status, type,
parent, featured_image and publicize. Creation explicitly defaults to `draft`,
`type: post` and `publicize: false`; `type: page` creates a page. `posts.list` can
filter either type. The same update/delete/restore operations apply to both.

`posts.update` requires a post ID and at least one changed field. It sends only
the supplied changes, preserving empty content/excerpts and an empty
`featured_image` to clear the attachment. Supply the attachment ID as a string
to set it. Scheduling/custom types and combined upload-and-publish are not yet
supplied. Publishing is explicit; the application owns who may publish and
whether publicizing through external services is allowed.

```js
const draft = await connections.invoke({
  context, integrationId: "publishing", operation: "posts.create",
  input: { siteId: 81, type: "page", title: "Opening hours", content: "<p>9–5</p>" }
});
// After the application obtains the author's approval:
await connections.invoke({
  context, integrationId: "publishing", operation: "posts.update",
  input: { siteId: 81, postId: draft.ID, status: "publish", publicize: false }
});
```

A native framework makes authenticated form-encoded POSTs to
`/rest/v1.1/sites/{siteId}/posts/new` and `/posts/{postId}` using the app-owned
token. It must explicitly choose draft status at creation: the provider's own
default is publish. Preserve text/HTML exactly in transport and apply suitable
HTML handling in the application UI.
[Create](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/posts/new/),
[edit](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/posts/$post_ID/).

`posts.delete` requires `confirmDeletion: true`. This is deliberately called
delete, not trash: with trash enabled it normally trashes a post, but a second
call can permanently delete it; sites without trash can delete immediately.
Inspect the returned status and never blindly repeat an uncertain request.
`posts.restore` returns a trashed post to its previous status, which may be
published. The runtime performs no automatic write retries or rollback.
[Delete](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/posts/$post_ID/delete/),
[restore](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/posts/$post_ID/restore/).

## Media workflow

Select `media` before consent (reconnect if the current grant lacks it).
`media.list` supports bounded `number`, opaque `page_handle`, `search`, `post_ID`
and `mime_type`. It retains the provider envelope and `meta.next_page`; pass that
value as a cursor, never fetch it as a URL. `post_ID: 0` finds unattached items.
`media.get` takes a numeric mediaId. Returned media URLs are data, not automatically
downloaded. The app owns access checks and safe image/HTML presentation.
[Media listing](https://developer.wordpress.com/docs/api/1.1/get/sites/$site/media/).

`media.upload` accepts one filename, MIME type and canonical `contentBase64`
(up to 5 MiB decoded), plus title, caption, description, alt and parent_id. It
encodes `media[0]` and `attrs[0][field]` multipart fields. It does not fetch file
paths or supplied URLs. The provider enforces allowed types, account storage and
upload permissions; this limit is the helper's memory bound, not a provider limit.
A native framework can use its multipart HTTP client with these same field names
and its app-owned Bearer token.

```js
const result = await connections.invoke({
  context, integrationId: "publishing", operation: "media.upload",
  input: { siteId: 81, filename: "hours.png", mimeType: "image/png",
    contentBase64: imageBytes.toString("base64"), alt: "Opening hours" }
});
// Persist returned media IDs before any later operation, and present errors.
if (Object.keys(result.media_errors ?? {}).length || result.media.length !== 1) {
  // Let the author review partial results; do not automatically upload again.
  return result;
}
await connections.invoke({
  context, integrationId: "publishing", operation: "posts.update",
  input: { siteId: 81, postId: draft.ID, featured_image: String(result.media[0].ID) }
});
```

The result keeps `media` and `media_errors`, including a failed upload represented
by an empty media array. A valid HTTP response alone does not mean every file
was uploaded. If attachment succeeds and updating the draft fails, the app can
retry only the post update or explicitly remove the orphan attachment; no
automatic rollback is performed.
[Upload](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/media/new/).

`media.update` edits metadata sparsely; an empty alt/caption clears it and
parent_id changes the attached post. `media.delete` requires
`confirmDeletion: true` and permanently removes the item. It is not a trash
action. No automatic retry, binary download, URL sideloading, multiple-file
request or video-specific settings are supplied. The app may compose repeated
explicit uploads and inspect each outcome.
[Edit](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/media/$media_ID/),
[delete](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/media/$media_ID/delete/).

## Comments and moderation

Select `comments` and reconnect if an existing grant lacks it. The provider
still enforces the site's commenting and moderation permissions. The app owns
its discussion screen, spam policy and which people can act as the connected
account. A shared account does not identify every app user as a WordPress author.

`comments.list` supports number (1–100), page, order and approved/unapproved/spam/
trash/all status, returning the provider's count and comment records.
`comments.get` reads one commentId. `comments.create` takes postId/content;
`comments.reply` takes commentId/content. Both send the exact content using
form encoding, and return the resulting moderation status. Creation may become
public immediately under the site's rules; there is no local draft queue.
[Listing](https://developer.wordpress.com/docs/api/1.1/get/sites/$site/comments/),
[post reply](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/posts/$post_ID/replies/new/),
[comment reply](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/comments/$comment_ID/replies/new/).

`comments.update` requires an explicit status even when editing content, because
the provider defaults to approval. Use unapproved to keep a comment under review,
approved to publish, spam/unspam or trash/untrash for moderation. Unspam/untrash
can restore visibility. `comments.delete` requires confirmDeletion: true; inspect
the returned status because deletion may be permanent. Neither operation retries
automatically. Author identity edits, hierarchical listing and likes are not
supplied. The native-framework equivalent uses the same comments routes and
form fields with the application's token.
[Edit/moderate](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/comments/$comment_ID/),
[delete](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/comments/$comment_ID/delete/).

```js
const queue = await connections.invoke({
  context, integrationId: "publishing", operation: "comments.list",
  input: { siteId: 81, status: "unapproved", number: 20, page: 1 }
});
// After an authorized moderator selects a comment:
await connections.invoke({
  context, integrationId: "publishing", operation: "comments.update",
  input: { siteId: 81, commentId: selectedCommentId, status: "approved" }
});
```

## Statistics and taxonomy

Select `stats` and reconnect to read `stats.read({siteId})`. It preserves the
provider's date, statistics and visits structures, including zero counts. The
app should label the returned reporting date and render the returned metric
keys; this is not live tracking, a scheduled collector or an analytics dashboard.
Site/account entitlements still apply. Native frameworks use an authenticated
GET to `/rest/v1.1/sites/{siteId}/stats`.
[Site statistics](https://developer.wordpress.com/docs/api/1.1/get/sites/$site/stats/).

Select `taxonomy` for `categories` and `tags` operations. Each supports list, get,
create, update and delete. Lists accept number (1–1000), page and search. Get,
update and delete use the returned termSlug, encoded as one path segment.
Creation requires name, with optional description and a numeric parent for
categories. Updates are sparse; deletion requires confirmDeletion: true. The
provider owns default-category constraints and the effect on existing posts.
Renaming may change the returned slug; use that new value for later requests.
No automatic deletion recovery or term synchronization is supplied.

```js
const category = await connections.invoke({
  context, integrationId: "publishing", operation: "categories.create",
  input: { siteId: 81, name: "Opening hours", description: "Business news" }
});
await connections.invoke({
  context, integrationId: "publishing", operation: "posts.update",
  input: { siteId: 81, postId: draft.ID, categories: [category.ID] }
});
```

Post create/update accepts existing numeric category/tag IDs, at most 100 each.
These replace the supplied taxonomy selection; omitted fields stay untouched.
Empty lists request clearing, subject to the site's default-category behavior.
The app owns selecting IDs and retaining desired existing assignments. This
post operation needs posts permission; managing the terms themselves needs
taxonomy permission. Custom taxonomies are not supplied.

Native frameworks use the same category/tag routes, form-encoded writes and
`slug:{encodedSlug}` targets. Retain successful term creation if a later post
assignment fails; retry the assignment explicitly instead of creating duplicates.
[Category list](https://developer.wordpress.com/docs/api/1.1/get/sites/$site/categories/),
[create](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/categories/new/),
[edit](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/categories/slug:$category/),
[tag and taxonomy reference](https://developer.wordpress.com/docs/api/rest-api-reference/).

## Read batches

`batch.read` accepts siteId and one to six distinct resources selected from posts,
media, comments, categories, tags and stats. It builds GET-only endpoint paths for
one numeric site and requests 20 records per collection. It never accepts a URL,
write action, arbitrary endpoint or cross-site batch. Use individual list calls
for pagination/filtering and explicit writes for publishing. No transactional
write batch exists in this helper.

Select `batch` and the permissions for the resources you intend to read, then
reconnect. Local invocation checks batch permission; WordPress.com checks access
to each nested resource. The app must also authorize its resource selection and
siteId; do not expose an unrestricted batch route to app users. The returned
object keeps each endpoint's result or error. An outer success does not mean all
reads succeeded, and this operation does not normalize or retry individual errors.

```js
const results = await connections.invoke({
  context, integrationId: "publishing", operation: "batch.read",
  input: { siteId: 81, resources: ["posts", "media"] }
});
for (const [endpoint, result] of Object.entries(results)) {
  // Route provider errors to the app's feedback UI and render successful data.
  if (result.error) showResourceError(endpoint, result.error);
  else showResourceData(endpoint, result);
}
```

Native frameworks send authenticated GET `/rest/v1.3/batch/` with repeated
`urls[]` query values such as `/sites/81/posts?context=edit&number=20`. Paths are
relative endpoints, not external URLs. The provider client returns results keyed
by endpoint.
[Batch API](https://developer.wordpress.com/docs/api/1.1/get/batch/),
[current client](https://github.com/Automattic/wp-calypso/blob/trunk/packages/wpcom.js/src/lib/batch.js),
[official archived composition test](https://github.com/Automattic/wpcom.js/blob/master/test/test.wpcom.batch.js).
