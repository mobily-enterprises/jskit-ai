# WordPress (self-hosted)

Import `wordpressSelfHostedProvider` from
`@jskit-ai/connectors-catalog/server/wordpress-self-hosted`. It verifies an
authenticated WordPress user and manages posts, pages, media and users under that
account. It does not implement
WordPress.com OAuth or application-user login.

## Manual setup

1. Sign into the HTTPS site's dashboard. Open **Users**, then edit the intended
   user's profile. Record that user's login name.
2. Find **Application Passwords**, enter a name such as `my-app-reader`, and
   choose **Add New Application Password**. Copy the displayed password.
3. Store it as `WORDPRESS_APPLICATION_PASSWORD` in the backend environment.
   In the editor enter **Site URL**, **Username** and **Application password
   reference** (`env:WORDPRESS_APPLICATION_PASSWORD`). Save configuration.

Application Passwords authenticate through HTTPS Basic authentication and are
available in WordPress core from 5.6. Use an Application Password rather than
the user's interactive login password.
[Authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/).

The profile shows each password's name and revocation control. Hosting or
plugins can disable this facility; the administrator must enable the intended
access if it is unavailable. The owning user's role remains relevant to which
resources are accessible.
[Application Passwords integration guide](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/).

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "publishing": {
      "provider": "wordpress-self-hosted",
      "displayName": "Company posts",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:WORDPRESS_APPLICATION_PASSWORD"
      },
      "settings": {
        "siteUrl": "https://publisher.example/blog/",
        "username": "editor"
      }
    }
  }
}
```

`api-key` is the common credential-reference configuration method; the provider
runtime turns this username/password pair into the correct Basic header. It
never inserts the password into a URL or source file. The site URL includes
the installation path but excludes `/wp-json`. Usernames reject colons and
control characters and are limited to 60 characters by this fragment.

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with
`providers: [wordpressSelfHostedProvider]`, environment resolution and the file
connection store. CLI and editor share the same schema and JSON. Runtime state
uses encrypted text files outside source. No database or editor is required
by the consuming application.

```js
await connections.connectApiKey({ context, integrationId: "publishing" });
const posts = await connections.invoke({
  context, integrationId: "publishing", operation: "posts.list",
  input: { page: 1, per_page: 20, status: "publish", context: "view" }
});
```

Verification uses `GET /wp-json/wp/v2/users/me`, requiring a user object with
an ID, name and slug. An unauthenticated public-post response cannot verify
the account. `users.me` is also callable without input after connection.
[User endpoints](https://developer.wordpress.org/rest-api/reference/users/).

`posts.list` reads `/wp-json/wp/v2/posts`. Its default is ten published posts,
page 1 and view context. Optional `search` filters results; draft/private reads
require the owning user's access. Select `context: "edit"` explicitly when
needed. The response includes provider fields such as rendered titles/content.
[Posts](https://developer.wordpress.org/rest-api/reference/posts/).

This fragment bounds `per_page` to 1–100, `page` to 1–100000 and search to 500
characters. It accepts statuses publish/future/draft/pending/private and
contexts view/edit/embed. It returns one array; pagination headers and automatic
traversal are not exposed. An empty array is valid; malformed records and error
objects fail validation. Returned HTML and links are data. The application owns
safe HTML rendering and does not automatically fetch embedded links.

The configured destination may be an operator-owned private HTTPS host or use
a nondefault port. Embedded URL credentials, query strings, fragments and
parent-path segments are rejected. This validation is not DNS/SSRF filtering:
the application controls who can edit destinations and its outbound-network
policy. Operations cannot supply another host; redirects fail instead of
forwarding credentials. Changing site, path or username requires verification
again. Updating the environment binding rotates the password. Disconnect
removes local state; revoke the provider password separately.

## Posts and pages publishing

Both `posts` and `pages` expose `.get`, `.create`, `.update` and `.trash`.
`pages.list` accepts the same page/per_page/search/context inputs as posts,
with publish/draft/pending/private status filters. All requests use the configured
site and installation path, authenticate with its Application Password and rely
on WordPress to enforce that user's capabilities. A successful `users.me` check
does not establish permission to edit or publish.

- `.get`: positive integer `id` and optional view/edit/embed `context`.
- `.create`: nonempty `title`, optional `content`, `excerpt`, `slug`, `status`,
  `featured_media`, `comment_status`; omitted status creates a draft.
- `.update`: `id` and at least one of those fields. Omitted fields remain
  untouched. Empty content/excerpt clears it; `featured_media: 0` removes the
  featured image. Page operations also accept `parent` (0 for none) and
  `menu_order` (signed integer).
- `.trash`: `id`; sends DELETE with `force=false`. Permanent deletion cannot be
  requested through this operation. A site with trash disabled can reject it.

Supported write statuses are draft/pending/private/publish. Scheduling, custom
post types/fields, taxonomy editing and permanent deletion are not provided by
these operations. Raw content and excerpt whitespace is preserved, including
block markup. The framework must handle authoring/rendering HTML appropriately;
these methods are not a visual editor or HTML sanitizer.
[Posts](https://developer.wordpress.org/rest-api/reference/posts/),
[pages](https://developer.wordpress.org/rest-api/reference/pages/).

For a simple publishing workflow, create a draft, show the returned content and
link to an authorized reviewer, then make an explicit publish request:

```js
const draft = await connections.invoke({ context, integrationId: "publishing",
  operation: "posts.create", input: { title, content } });
// The application obtains the reviewer's decision and checks their authority.
await connections.invoke({ context, integrationId: "publishing",
  operation: "posts.update", input: { id: draft.id, status: "publish" } });
```

The app must authorize each resource and action before invoking it. Shared
credentials act as the connected WordPress user for every permitted app caller.
WordPress may reject creation, editing another author's content, publishing or
trashing under that user's role. Return that failure; do not reconnect as an
administrator or silently change roles. Updating published content can take
effect immediately and may trigger site plugins/notifications. There is no
transaction spanning multiple calls and no blind retry of an uncertain write;
inspect the site's content before deciding whether to repeat it.

A non-Node framework uses its own HTTPS client, the same site URL/Env username
and password binding, and these native `/wp-json/wp/v2/posts` or `/pages` routes.
Use GET for reads, JSON POST for create/update, and DELETE with force=false for
trash. There is no Vibe64 runtime or JSKIT service requirement for that framework.

## Media and user operations

`media.list` accepts page/per_page/search/context and an optional `media_type`
(image/video/text/application/audio). `media.get` takes `id` and optional context.
Both return metadata, including the media URL; they do not fetch the linked file
or forward credentials to a CDN. `media.update` accepts `id` and one or more of
`title`, `caption`, `description`, `alt_text`, `post` (0 detaches the attachment).

`media.upload` accepts `filename`, `mimeType`, canonical `contentBase64` and those
optional metadata fields. The runtime decodes at most **5 MiB** into an ordinary
multipart `file` upload; WordPress enforces allowed types, upload_files capability
and any smaller site limit. No filesystem path or source URL is fetched by the
connector. The framework validates its incoming upload and size before encoding
it. A Node backend can use `Buffer.from(fileBytes).toString("base64")`; another
framework can send its native multipart upload to the same media endpoint.

```js
const attachment = await connections.invoke({ context, integrationId: "publishing",
  operation: "media.upload", input: { filename: "cover.png", mimeType: "image/png",
    contentBase64: Buffer.from(fileBytes).toString("base64"), alt_text: "Cover image" } });
await connections.invoke({ context, integrationId: "publishing",
  operation: "posts.update", input: { id: draft.id, featured_media: attachment.id } });
```

These are separate writes. If attaching the image fails, the uploaded attachment
can still exist. Show that outcome and allow explicit recovery; do not silently
repeat uploads or delete the attachment. `media.delete` requires `id` and
`force: true`, returns WordPress's deletion response, and **permanently removes**
the attachment/file. It is deliberately different from post/page trash. The app
must obtain the intended user's confirmation and authorize that exact resource.
[Media endpoint reference](https://developer.wordpress.org/rest-api/reference/media/).

`users.list` takes page/per_page/search/context; `users.get` takes id/context.
Public view may expose only authors; edit context and full lists require the
connected account's capabilities. `users.create` requires username, email,
password and explicit roles; it never uses an implicit site's default role.
Supported optional profile fields are name, first_name, last_name, nickname and
description. `users.update` takes id and at least one profile/email/password/roles
field; omitted fields remain unchanged. Role IDs may be custom site roles;
WordPress checks whether the actor is allowed to assign them. There is no local
role elevation or change to the application's own login system.

Passwords here are transient **server-side operation input**, not fields in
integrations.json or the connection store. The framework must keep them out of
chat, URL parameters, logs and client responses. Prefer the site's own onboarding
and password-reset flow when an administrator should not handle new passwords.
Returned user records cannot include a password. Changing the credential owner's
profile or deleting that owner may interrupt subsequent connector use.

`users.delete` requires id, force:true and an explicit positive `reassign` user ID
for the removed user's content. It is permanent, not a trash action. The app
must authorize this administrative action; multisite and site plugins may impose
additional restrictions or trigger notifications. Failures are returned without
automatic retries. No batch transaction, role provisioning or multisite network
administration is implemented.
[Users endpoint reference](https://developer.wordpress.org/rest-api/reference/users/).

For read-only public content a framework can make its own unauthenticated REST
reads. This connector always authenticates; it never falls back to anonymous
access after denial. Shared-account operations must remain behind application
permissions even when some records happen to be public.

## Automation and application ownership

An AI can prepare the files and library composition. An authorized operator
with shell access can provision a password using
`wp user application-password create <user> <app-name> --porcelain`.
The command prints the new credential; an automation must capture it directly
into the secret store and keep it out of logs.
[WP-CLI password creation](https://developer.wordpress.org/cli/commands/user/application-password/create/).

The REST API also supports creating and deleting passwords at
`/wp-json/wp/v2/users/{userId}/application-passwords`. It requires an already
authorized identity, so it does not bootstrap an unknown site's credentials.
The fragment does not expose these administrative operations.
[Application Passwords API](https://developer.wordpress.org/rest-api/reference/application-passwords/).

These are passwords owned by a user on a particular site, not global OAuth
registrations. Use a recognizable application name for revocation and
attribution. Separate passwords do not provide independent site capacity. The
application selects its private Env binding and enforces its own access policy;
the connected site remains owned by that customer.

Manual authentication has no callback, so editor VM and deployed-app domains
do not need registration. Use the site's final HTTPS address. Moving that site
or changing its installation path requires configuration and verification again.
The adapter does not configure per-password scopes, generate passwords, install
plugins, change WordPress roles or enable disabled REST routes.

## Focused proof and limits

The WordPress-family suite uses simulated provider replies and actual encrypted
JSON persistence. It covers authenticated verification, posts/drafts, Basic
headers, site paths, field/input validation, rotation, restart, ownership,
disconnect, changed destinations and failure responses. Editor checks cover
fields, error feedback, references, setup links and reload. Live administration,
provider use and sample-app generation are excluded. Post/page writes, exact multipart upload bytes, media management and user
administration have controlled fixtures. Custom post types, scheduling, taxonomy
editing, binary downloads and alternative authentication plugins are not supplied.
