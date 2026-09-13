# Firecrawl setup and implementation

Documentation checked: 13 September 2026. Signed-in console steps and live
provider requests have not been exercised. Automated tests simulate the
provider and do not scrape a real site.

## Capability and input ownership

`credits.read` verifies the team key without starting paid work. The application
explicitly authorizes each operation below; the runtime never automatically
replays paid work or polls jobs in the background.

| Operation | Inputs and result |
|---|---|
| `pages.scrape` | HTTP(S) URL, optional `onlyMainContent`; Markdown and metadata |
| `pages.search` | `query`, optional `limit` (1–100, default 5), `includeContent`; web results, optionally scraped Markdown |
| `sites.map` | URL, required `limit` (1–1000), optional `search`; discovered links |
| `pages.extract` | URL, required JSON `schema`, optional `prompt`; `data.json` |
| `crawls.start` | URL, required page `limit` (1–1000), optional `maxDiscoveryDepth` (0–10, default 2); job ID |
| `crawls.get` | Job `id`, optional returned `next` URL; status, counts, content and next page |
| `crawls.errors` | Job ID; failed pages and blocked URLs |
| `crawls.cancel` | Job ID; cancellation acknowledgement |

Crawls exclude external links and subdomains. Store each result page and follow
`next` until absent: a completed job does not mean the first response contains
all content. Only next URLs on the exact same Firecrawl job path are accepted.
Inspect errors before describing an import as complete; cancellation does not
refund work already performed. The app owns job IDs, its users' authorization,
recurring schedules, result retention and search/index storage.

| Input | Destination | Rule |
|---|---|---|
| Display name | integration `displayName` | Optional, 1–200 characters when present |
| Own API key | Server environment/secret store | Value never goes into `integrations.json` |
| API key reference | `authentication.secretRef` | For example `env:FIRECRAWL_API_KEY` |
| Shared account / assistant | `accountMode` | Caller authorized by application policy |
| People with access | Host membership/connection grants | Not granted merely by editing application source |

## Manual setup

1. Open [Firecrawl](https://www.firecrawl.dev/) and sign in. Choose the team that
   should pay for the application's requests. Check its available credits and
   plan before enabling application operations.
2. Open [API Keys](https://www.firecrawl.dev/app/api-keys), the direct destination
   linked from the official introduction, and create or copy a team key. The
   [introduction](https://docs.firecrawl.dev/introduction) and
   [authentication guide](https://docs.firecrawl.dev/api-reference/v2-introduction)
   identify the dashboard as the source of the API key. Exact signed-in menu
   labels may differ; these have not been inspected for this implementation.
3. Store the value in the private environment or secret store as
   `FIRECRAWL_API_KEY`. In the form enter the reference
   `env:FIRECRAWL_API_KEY`, click **Save configuration**, then follow **Set
   credential in Env** to store the real key. Return and connect. This saves
   the same file a CLI user would author, with
   `authentication.method: "api-key"`, empty scopes and no OAuth registration.
4. Wire the runtime using the shared API-key pattern. Invoke `connectApiKey`;
   its [credit-usage read](https://docs.firecrawl.dev/api-reference/endpoint/credit-usage)
   succeeds when `success` is true and `data.remainingCredits` is numeric. Zero
   credits still identifies a valid account; it does not promise that a scrape
   can proceed.
5. For an explicitly authorized operation call `pages.scrape` with a page URL.
   The [scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape)
   returns `data.markdown` and metadata. The connector sends the URL as JSON to
   Firecrawl, not as the destination of the authenticated HTTP request. It
   rejects non-HTTP URLs and embedded URL credentials locally.
6. A 401 means the key must be corrected and reconnected; a 403 means denied
   permissions. Rate limits, exhausted credits, scrape failures and unexpected
   bodies must remain visible failures. Do not report Connected for an invalid
   verification result or automatically repeat a paid scrape.
7. To rotate, create another team key if supported or use the dashboard's key
   rotation facility; update the secret binding and verify the replacement
   before removing the old key. Revocation can affect other apps sharing that
   key. Local disconnect only removes this application's connection state.
   OAuth consent, redirect URLs, refresh tokens and client IDs do not apply.

## Automation and application credentials

Classification: **console-assisted own-key setup; API provisioning for approved
partners**. Additional public documentation checked on 9 September 2026:
[Partner Integration API](https://docs.firecrawl.dev/partner-integration).
Firecrawl must approve the platform and supply a distinct server-only partner
key. After the user accepts Firecrawl's terms, an authorized backend can call
`POST https://integrations.firecrawl.dev/partner/v1/accounts` with their email.
It returns `apiKey` and `alreadyExisted`; an existing partner team is reused.
Store the returned key privately, never in chat, source or browser config.
The same partner API documents key validation and destructive key rotation.
None of these partner operations is implemented or exercised by this fragment.

An AI can prepare the JSON/environment reference, validate it, compose the
library calls and check the key through the documented credit endpoint after
an operator supplies it. Account/team selection, billing and key issuance are
operator steps for own-key setup. Online can implement partner provisioning
after approval; a standard API key cannot substitute for the partner key.

The application owner supplies its Firecrawl key through private Env. Keys for
one team use its shared credits; creating two keys does not split that balance.
The application owner arranges the required subscription and usage limits.
This adapter does not sell credits or provision a subscription.

OAuth callback: **not applicable** to these API-key modes. Normal server API
requests do not use the customer's browser origin. A custom web domain does
not change the team/key binding; VPS changes must preserve the authorized
application identity. Follow the [Online setup contract](../../connectors-core/docs/online-setup.md)
for application-owned readiness and failure states. This fragment does not configure
crawl/job webhooks; those would require their own verified receiving endpoint.

## CLI and other frameworks

Use the shared API-key runtime pattern with `firecrawlProvider`, the same
`integrations.json` and private `FIRECRAWL_API_KEY`; Vibe64 is not required.
After the application has connected and authorized the caller:

```js
const job = await connections.invoke({ context, integrationId: "firecrawl",
  operation: "crawls.start", input: { url: "https://example.com", limit: 20 } });
// Persist job.id with its owner; a later application request checks progress.
const page = await connections.invoke({ context, integrationId: "firecrawl",
  operation: "crawls.get", input: { id: job.id } });
// Persist page.data; if page.next exists, request it with the same job.id.
```

Other frameworks use their native HTTP client with the same private bearer key
and [Search](https://docs.firecrawl.dev/api-reference/endpoint/search),
[Map](https://docs.firecrawl.dev/api-reference/endpoint/map),
[Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape),
[Crawl](https://docs.firecrawl.dev/api-reference/endpoint/crawl-post),
[results](https://docs.firecrawl.dev/api-reference/endpoint/crawl-get),
[errors](https://docs.firecrawl.dev/api-reference/endpoint/crawl-get-errors) and
[cancel](https://docs.firecrawl.dev/api-reference/endpoint/crawl-delete) endpoints.
No JSKIT or Vibe64 execution service is required.

**LIMITATIONS:** no managed Firecrawl account/credits provisioning, browser
sessions, monitor service or editor coding-assistant attachment. For example,
your app can import twenty documentation pages and display their Markdown;
automatically refreshing that import every night requires its own scheduler.
Selecting this connector does not give the editor assistant those documents.
Own-key setup deliberately requires a Firecrawl account and available credits.
