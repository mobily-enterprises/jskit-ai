# Storyblok

Import `storyblokProvider` from `@jskit-ai/connectors-catalog/server/storyblok`.
The fragment reads Content Delivery API space metadata and stories. It supports
the Public and Preview token types and all five standard space regions.

## Configure access

1. Sign into Storyblok and select the space whose content the application uses.
   Open **Settings → Access Tokens**.
2. Create a named **Public** token for published content, or a **Preview** token
   for draft and published content. Copy its value into backend Env as
   `STORYBLOK_TOKEN`. Keep Preview tokens on the server. Management API personal
   tokens, Asset tokens and Release tokens serve different purposes.
   [Token types and settings](https://www.storyblok.com/docs/concepts/access-tokens).
3. Add this integration to the ordinary `integrations.json` document. The UI
   edits the same fields; only the reference goes in source:

   ```json
   {
     "provider": "storyblok",
     "displayName": "Website content",
     "accountMode": "shared",
     "scopes": [],
     "authentication": { "method": "api-key", "secretRef": "env:STORYBLOK_TOKEN" },
     "settings": { "region": "eu" }
   }
   ```

4. Set **Space region** to match the space: `eu` (default), `us`, `ca`, `ap`, or
   `cn`. Their API hosts are `api.storyblok.com`, `api-us.storyblok.com`,
   `api-ca.storyblok.com`, `api-ap.storyblok.com`, and `app.storyblokchina.cn`.
   All use `/v2/cdn`. Enterprise-specific hosts are not part of this fragment.
   [Content Delivery endpoints](https://www.storyblok.com/docs/api/content-delivery/v2).
5. Use `connectApiKey` to verify space access. A region or reference change
   requires verification again. Local disconnect removes the runtime connection;
   revoke an obsolete token in Storyblok when it should stop working everywhere.

## Runtime and AI composition

Compose the provider with the [API-key pattern](../patterns/api-key-connection/PATTERN.md)
and file store. `space.read` calls `GET /v2/cdn/spaces/me`, returning the space's
ID, name, languages and available cache-version metadata. Verification proves
space access; it does not establish that the token can read drafts.
[Space endpoint](https://www.storyblok.com/docs/api/content-delivery/v2/spaces/retrieve-current-space).

`stories.list` calls `GET /v2/cdn/stories`. Inputs are `version` (`published` by
default or explicit `draft`), `page` (starting at 1), `per_page` (1–100, default
25), optional `starts_with`, `search_term`, `content_type`, `language`, and `cv`.
Results retain the stories and other response-body metadata. Increment page
until a short or empty page; this runtime does not expose the API's pagination
headers. Draft access requires a Preview token; it never falls back silently
to published content. Content writing is outside this Delivery API connector. The application owns
rendering and cache policy.
[Story listing](https://www.storyblok.com/docs/api/content-delivery/v2/stories/retrieve-multiple-stories).

The core inserts the resolved token into the authenticated query string. Do not
pass tokens as operation inputs or log full request URLs in application HTTP
instrumentation. Preview content also needs application access controls; selecting
`shared` makes the credential shared, not the resulting content public.

## Automation and application ownership

After an authorized human supplies Management API access, an AI can create
Content Delivery tokens with `POST /v1/spaces/{space_id}/api_keys/` on the
appropriate Management API host. The request body includes
`api_key: { access: "public", name: "Application content" }`, and the result
contains `api_key`. EU management uses `mapi.storyblok.com`. This is a setup API,
not an operation exposed by this read fragment.
[Token creation](https://www.storyblok.com/docs/api/management/access-tokens/create-an-access-token).

Space creation and configuration are also available through the Management API;
account creation, billing and initial authorization still require the account
owner. [Space APIs](https://www.storyblok.com/docs/api/management/spaces).

The application owner supplies a token for its Storyblok space. Two token names
in one space do not guarantee quota isolation; confirm space/organization plan
limits. This Content Delivery flow needs no OAuth client ID or callback, so
editor VM and hosted-application domains need no per-domain OAuth registrations.

Automated tests use simulated responses: all five destinations, published/draft
selection, page limits, encoded credentials, rotation, file-store restart,
authorization isolation, invalid responses and failures. No live space was
created or read, and no sample application was generated or executed.


## Page retrieval and rendering

`stories.get({ id, find_by?, version?, language?, cv?, resolve_relations?,
resolve_links?, resolve_assets? })` reads one page by numeric ID or full slug.
Pass a UUID with `find_by: "uuid"`. Slugs are encoded as path segments; do not
pass an API URL. Relative or empty path segments are rejected.

Both get and list accept `resolve_relations` as comma-separated component.field
names, `resolve_links` as url/link/story, and `resolve_assets` as 0/1. The response
retains relation, link and asset metadata. Additional relations beyond the
provider's expansion limit require explicit subsequent reads; no automatic crawl
or remote asset fetch occurs. Use asset filename and alt values when rendering
approved images; private asset access still follows Storyblok's access policy.
[Single story contract](https://www.storyblok.com/docs/api/content-delivery/v2/stories/retrieve-a-single-story).

An application-owned page route maps its slug to stories.get and supplies an
authenticated owner context. Render content.component through an explicit map
of framework components; render field strings as escaped text. Use the chosen
framework's Storyblok rich-text renderer for rich-text documents, with reviewed
link and embedded-component rules. Do not inject arbitrary content as HTML.
Return an ordinary not-found page when published content is absent. JSKIT
provides data operations, not a page builder or preview-editor subsystem.

Use a Public token for public routes. If the project also needs preview, keep
a Preview token in a separate server-side integration, require editor access
before requesting draft, and mark preview responses private/no-store. The
application policy receives the requested version before provider transport.
Never let an unauthenticated request parameter select the preview integration.
Cache published pages by space/integration, language, slug, version and cache
version; do not mix draft and published results. Use returned cv consistently
while paginating and refresh the space version when revalidating after publish.
The app owns its revalidation trigger and scheduler.

A CLI-only or non-JSKIT app uses the same token Env and region with its native
HTTP/Storyblok client. Keep the same published-default and preview authorization
rules; it does not need Vibe64 or a JSKIT server.

Current focused source proof: four Storyblok cases pass, covering all regions,
credential rotation/restart, page/list results, linked content and assets,
invalid paths/results, policy-denied draft access and provider failures. No
live space or generated application was used. The same four cases pass through
installed package exports in a disposable CLI consumer. Public configuration and
API-key connection/disconnect checks pass at compact, medium and expanded widths,
including region persistence, inline instructions and horizontal-overflow checks.
