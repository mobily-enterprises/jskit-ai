# Connector catalogue

Browser-safe definitions are exported from `@jskit-ai/connectors-catalog/shared`.
Import a provider individually from `@jskit-ai/connectors-catalog/server/<id>`;
the id is the linked guide's filename without `.md`.
HTTP and MCP providers compose with `createConnectionService` from connectors-core; each
contains request validation and a small useful operation set, not application
business workflows. There is no automatic provider installation or activation.

Each application owns its registration, callback, credentials and grants. Read
the core package's [callback guide](../connectors-core/docs/oauth-callbacks.md)
and [application setup contract](../connectors-core/docs/online-setup.md), which
apply to hosted editors, installed editors and CLI use. There is no shared
Vibe64 provider registration or token gateway.

## Finding setup instructions from a CLI or coding agent

Start with the selected provider's guide in `docs/<provider-id>.md`, linked
below. It describes credential acquisition, required permissions, environment
choices and the adapter's supported operations. Read only the selected
provider's recipe and shared contracts it references. A configured credential
is not proof that the application's requested feature is implemented.

`integrations.json` is application-owned source; secret values belong in the
application's Env or private grant storage. The same files can be authored by
hand, by a coding agent or by an editor. Genesis is optional: when used, selected
Stack guidance should lead to these same documents, while the application
records its actual environment requirements and implemented commands.

For full Stripe/Paddle checkout, subscriptions, features and usage credits,
continue to [application-owned payments](../payments-core/README.md) and its
[standalone composition](../payments-core/docs/standalone.md). The narrow
catalogue connector alone does not implement billing. Other technologies can
read the [static payment contract](../payments-core/docs/contract.md), schema
and examples without executing JavaScript; their own framework owns runtime
implementation. An editor management command is optional for standalone CLI
use, and does not replace application authorization.

Definitions can expose `verificationFields` with `name`, `label`, `hint` and `required` for
non-secret text inputs used by a provider's check operation. Sheets, Docs and
Slides expose their resource IDs this way. Excel supplies a workbook drive item
ID, SharePoint a site-search term, PostHog a flag-evaluation identity, Maps an
address and X a public username. Maps and X field hints identify provider usage
charges before the explicit check. A UI passes entered values through
`verificationInput` on Connect; CLI callers supply the same operation input.
These are check parameters, separate from source configuration and credentials.
Provider request validation remains authoritative.

| Provider | Export | Initial operations | Authentication |
|---|---|---|---|
| [AI](docs/ai.md) | `createAiConnectionResolver` | Static catalogue and authorized SDK parameters; app-owned inference | Free public Zen default, administrator Env key or private individual grant |
| [Wiz](docs/wiz.md) | `createWizScanner` | Authorised source-directory scan, policy verdict and report; separate CLI runtime | Own Cognito service account; installed Wiz v1 CLI |
| [Shopify](docs/shopify.md) | `shopifyProvider` | `products.list`, `products.create`, `products.update`, `products.delete`; assistant policies | Organization client credentials or existing Admin API token |
| [Confidence Flags](docs/confidence-flags.md) | `confidenceFlagsProvider`, `registerConfidenceClient` | `tools.list`, `tools.call`; explicit client setup | Assistant OAuth for flag management |
| [Confidence Exp](docs/confidence-exp.md) | `confidenceExpProvider`, `registerConfidenceClient` | `tools.list`, `tools.call`; explicit client setup | Assistant OAuth for experiment analysis |
| [Lightspeed](docs/lightspeed.md) | `lightspeedProvider` | `products.list`, `customers.list`, `outlets.list`, `sales.list`, `inventory.list` | Own X-Series OAuth registration and store prefix |
| [Microsoft Fabric](docs/microsoft-fabric.md) | `microsoftFabricProvider` | `connection.check`, `schema.types`, `graphql.execute` | Tenant-specific user consent or service principal; one GraphQL endpoint |
| [X (Twitter)](docs/x-twitter.md) | `xTwitterProvider` | `users.lookup`, `users.posts` | App-only bearer token; public reads |
| [Snowflake](docs/snowflake.md) | `snowflakeProvider` | `databases.list` | Account-specific custom OAuth; optional role and bounded metadata pages |
| [Workday](docs/workday.md) | `workdayProvider` | `workers.me`, `workers.list` | Per-user confidential tenant OAuth; Staffing v7 worker reads |
| [Gemini Enterprise](docs/gemini-enterprise.md) | `geminiEnterpriseProvider` | `engine.get`, `search` | Google OAuth; configured project, region and engine; shared search identity |
| [Wix](docs/wix.md) | `wixProvider` | `sites.list` | Own account API key; explicit site pages |
| [TikTok](docs/tiktok.md) | `tiktokProvider` | `profile.read`, `profile.extended`, `profile.stats`, `videos.list` | Own confidential Web OAuth; optional profile/statistics/video permissions |
| [LinkedIn](docs/linkedin.md) | `linkedinProvider` | `profile.read`, `posts.create` | Own OAuth; approved member text publishing; reconnect unless refresh is approved |
| [Google Ads](docs/google-ads.md) | `googleAdsProvider` | `customers.listAccessible`, `customers.listClients`, `reports.search` | Own Google OAuth plus developer token or approved Cloud organization |
| [Salesforce](docs/salesforce.md) | `salesforceProvider` | `limits.read`, `objects.list`, `objects.describe`, `query.read`, `query.next` | Own confidential OAuth, My Domain and production/sandbox settings |
| [Firebase Cloud Messaging](docs/firebase-cloud-messaging.md) | `firebaseCloudMessagingProvider` | `connection.check`, `messages.validate`, `messages.send`; public web configuration helper | Explicit service-account JSON reference and target project; optional web push |
| [dbt Semantic Layer](docs/dbt-semantic-layer.md) | `dbtSemanticLayerProvider` | `environment.read`, `metrics.list`, `dimensions.list`, `savedQueries.list` | Customer service token, GraphQL host and exact text Environment ID; metadata only |
| [Databricks](docs/databricks.md) | `databricksProvider` | `jobs.list`, `jobs.get` | Custom user OAuth application or service principal; per-workspace URL |
| [Hex](docs/hex.md) | `hexProvider`, `registerHexClient` | `tools.list`, `tools.call`; explicit client setup | Assistant OAuth; standard, EU and HIPAA endpoints |
| [Granola](docs/granola.md) | `granolaProvider` | `notes.list`, `notes.get`, `folders.list`, `transcripts.list` | Own personal/workspace API key; MCP is separate |
| [Zoho Books](docs/zoho-books.md) | `zohoBooksProvider` | `organizations.list`, `contacts.list`, `invoices.list` | Own regional web OAuth registration; explicit organisation selection |
| [Zoho CRM](docs/zoho-crm.md) | `zohoCrmProvider` | `users.current`, `leads.list`, `contacts.list`, `accounts.list`, `deals.list` | Own regional web OAuth registration |
| [Wave](docs/wave.md) | `waveProvider` | `user.read`, `businesses.list`, `customers.list`, `invoices.list` | Own web OAuth registration |
| [Semrush](docs/semrush.md) | `semrushProvider` | `projects.list`, `projects.get` | Own V4 API key with read permission |
| [Xero](docs/xero.md) | `xeroProvider` | `connections.list`, `organisation.read`, `contacts.list`, `invoices.list` | Own web OAuth registration, Basic client authentication |
| [Resend](docs/resend.md) | `resendProvider` | Domains, transactional sending, contacts/segments and draft/review/send broadcasts | Own API key, Full access |
| [Firecrawl](docs/firecrawl.md) | `firecrawlProvider` | `credits.read`, `pages.scrape` | Own team API key |
| [Gmail](docs/gmail.md) | `gmailProvider` | `profile.read`, `messages.list`, `messages.get` | Own OAuth registration |
| [Google Drive](docs/google-drive.md) | `googleDriveProvider` | `files.list` | Own OAuth registration |
| [Google Sheets](docs/google-sheets.md) | `googleSheetsProvider` | `spreadsheets.get`, `values.get` | Own OAuth registration |
| [Google Docs](docs/google-docs.md) | `googleDocsProvider` | `documents.get` | Own OAuth registration |
| [Google Slides](docs/google-slides.md) | `googleSlidesProvider` | `presentations.get` | Own OAuth registration |
| [Google Search Console](docs/google-search-console.md) | `googleSearchConsoleProvider` | `sites.list` | Own OAuth registration |
| [Airtable](docs/airtable.md) | `airtableProvider` | `bases.list` | Own personal access token |
| [Notion](docs/notion.md) | `notionProvider` | Search, page/block reads and writes, data-source queries; separate MCP tools | Own internal token, REST OAuth or separate MCP client |
| [Brevo](docs/brevo.md) | `brevoProvider` | `contacts.list` | Own API key |
| [ElevenLabs](docs/elevenlabs.md) | `elevenlabsProvider` | `account.read`, `voices.list` | Own API key |
| [GitHub API](docs/github-api.md) | `githubApiProvider` | `account.read`, `repositories.list` | Own personal access token |
| [Apify](docs/apify.md) | `apifyProvider` | `actors.list` | Own API token |
| [Calendly](docs/calendly.md) | `calendlyProvider` | `profile.read`, `eventTypes.list` | Own personal access token |
| [HubSpot](docs/hubspot.md) | `hubspotProvider` | Contact/deal list/get/create/update, relationships and pipeline reads | Own private/static token or project OAuth |
| [Linear](docs/linear.md) | `linearProvider` | `profile.read`, `issues.list` | Own personal API key |
| [Pipedrive](docs/pipedrive.md) | `pipedriveProvider` | Profile; deals, people, organizations, activities, leads and pipeline reads; basic record create/update | Own user/company API token |
| [GitLab API](docs/gitlab-api.md) | `gitlabApiProvider` | `profile.read`, `projects.list` | Own GitLab.com personal access token |
| [Tally](docs/tally.md) | `tallyProvider` | `forms.list` | Own API key |
| [Contentful](docs/contentful.md) | `contentfulProvider` | `entries.list` | Own Content Delivery key, space and environment |
| [Asana](docs/asana.md) | `asanaProvider` | `workspaces.list` | Own personal access token |
| [Microsoft Outlook](docs/microsoft-outlook.md) | `microsoftOutlookProvider` | `folders.list`, `inbox.list` | Own delegated OAuth registration |
| [Microsoft OneDrive](docs/microsoft-onedrive.md) | `microsoftOneDriveProvider` | `items.list/get`, `files.upload` | Own delegated OAuth registration |
| [Microsoft Excel](docs/microsoft-excel.md) | `microsoftExcelProvider` | `worksheets.list`, `ranges.get/update`, `sessions.create/close` | Own delegated OAuth registration |
| [Microsoft Teams](docs/microsoft-teams.md) | `microsoftTeamsProvider` | Team/channel/chat reads and message/reply sends | Own organizational OAuth registration |
| [Microsoft OneNote](docs/microsoft-onenote.md) | `microsoftOneNoteProvider` | `notebooks.list`, `sections.list`, `pages.list/content/create/append` | Own delegated OAuth registration |
| [Microsoft Word](docs/microsoft-word.md) | `microsoftWordProvider` | `items.list`, `items.get` | Own delegated OAuth registration |
| [Microsoft PowerPoint](docs/microsoft-powerpoint.md) | `microsoftPowerPointProvider` | `items.list`, `items.get` | Own delegated OAuth registration |
| [Microsoft SharePoint](docs/microsoft-sharepoint.md) | `microsoftSharePointProvider` | `sites.search` | Own organizational OAuth registration |

| [Stripe](docs/stripe.md) | `stripeProvider` | `balance.read` | Own restricted/secret API key |
| [Replicate](docs/replicate.md) | `replicateProvider` | Account/hardware, model schema, prediction submit/poll/cancel | Own API token |
| [Sentry](docs/sentry.md) | `sentryProvider` | `organizations.list` | Own Sentry.io personal token |
| [incident.io](docs/incident-io.md) | `incidentIoProvider` | Incidents/follow-ups, alert resolution, schedule reads, catalogue entries | Own API key |
| [Fireflies](docs/fireflies.md) | `firefliesProvider` | `profile.read`, `transcripts.list` | Own API key |

| [HeyGen](docs/heygen.md) | `heygenProvider` | `profile.read`, `voices.list` | Own API key |
| [Perplexity](docs/perplexity.md) | `perplexityProvider` | `requests.list`, `models.list` | Own project API key |
| [Supabase](docs/supabase.md) | `supabaseProvider` | `projects.list` | Own Management API personal token |
| [Google Analytics](docs/google-analytics.md) | `googleAnalyticsDefinition` (shared configuration) | Framework-owned Google tag | Public Measurement ID |
| [BigQuery](docs/bigquery.md) | `bigqueryProvider` | `projects.list` | Own OAuth registration |
| [Paddle](docs/paddle.md) | `paddleProvider` | `products.list` | Own sandbox/live API key |
| [Mailgun](docs/mailgun.md) | `mailgunProvider` | `domains.list` | Own US/EU account API key |
| [Fireworks AI](docs/fireworks-ai.md) | `fireworksAiProvider` | `accounts.list` | Own API key with account read access |
| [GatewayAPI](docs/gatewayapi.md) | `gatewayApiProvider` | `balance.read` | Own Global/EU API token |
| [Polar](docs/polar.md) | `polarProvider` | `products.list` | Own sandbox/production organization token |
| [Storyblok](docs/storyblok.md) | `storyblokProvider` | `space.read`, `stories.list` | Own public/preview space token, five regions |
| [Twitch](docs/twitch.md) | `twitchProvider` | `token.validate`, `profile.read`, `channels.followed` | Own application-specific confidential OAuth registration |
| [Slack](docs/slack.md) | `slackProvider` | `auth.test`, `channels.list`, `groups.list`, `directMessages.list`, `groupMessages.list` | Own OAuth registration, connected user or installed bot |
| [Oura](docs/oura.md) | `ouraProvider` | Daily/detailed sleep, readiness, activity, heart rate and profile reads | Own per-user OAuth registration |
| [Algolia](docs/algolia.md) | `algoliaProvider` | `indices.list`, `index.search` | Own application ID and backend API key; optional frontend key reference |
| [Twilio](docs/twilio.md) | `twilioProvider` | `calls.list` | Own regional Account SID, Standard API Key SID and secret |
| [Gong](docs/gong.md) | `gongProvider` | `users.list` | Own company access key and secret, optional company API origin |
| [PostHog](docs/posthog.md) | `posthogProvider` | `flags.evaluate`, `events.capture` | Own public project token, numeric project ID and EU/US region; explicit verification subject |
| [Chargebee](docs/chargebee.md) | `chargebeeProvider` | `customers.list` | Own site name and API key with transactional-data read access |
| [Ashby](docs/ashby.md) | `ashbyProvider` | `jobs.list` | Own organization key with Jobs: Read access |
| [Lexware](docs/lexware.md) | `lexwareProvider` | Accounting resource reads, article/voucher pages, `invoices.createDraft` | Own private Public API key with selected read/create permissions |
| [Sevdesk](docs/sevdesk.md) | `sevdeskProvider` | `contacts.list` | Own account API token, raw Authorization header |
| [Apollo.io](docs/apollo-io.md) | `apolloIoProvider` | `accounts.search` | Own workspace API key scoped to saved-account search |
| [Attention](docs/attention.md) | `attentionProvider` | `conversations.list` | Own organization API key |
| [Telegram](docs/telegram.md) | `telegramProvider` | `profile.read`, `webhook.read` | Own bot token |
| [KLIPY](docs/klipy.md) | `klipyProvider` | Clip/GIF/sticker/existing-emoji trending and search | Own app key; generation unavailable |
| [Mapbox](docs/mapbox.md) | `mapboxProvider` | `token.read`, `geocoding.forward`, `geocoding.reverse`, `directions.get` | Backend token or browser-only public-token configuration |
| [Logo.dev](docs/logo-dev.md) | `createLogoDevImageUrl` (client export) | Public image URL construction | Publishable image key; no server connection grant |
| [Google Maps Platform](docs/google-maps-platform.md) | `googleMapsPlatformProvider` | `geocoding.forward`, `geocoding.reverse` | Server API key, optional browser-key reference and an explicit verification address |
| [WooCommerce](docs/woocommerce.md) | `woocommerceProvider` | `products.list`, `orders.list` | Own HTTPS store, consumer key and secret reference |
| [PrestaShop](docs/prestashop.md) | `prestashopProvider` | `products.list`, `orders.list` | Own HTTPS store and Webservice API key reference |
| [ClickHouse](docs/clickhouse.md) | `clickhouseProvider` | `connection.check`, `tables.list`, `columns.list`, `rows.list` | Own HTTPS endpoint; Basic database credentials or explicit no-credentials mode |
| [WordPress (self-hosted)](docs/wordpress-self-hosted.md) | `wordpressSelfHostedProvider` | `users.me`, `posts.list` | Own HTTPS site, username and Application Password reference |
| [WordPress.com](docs/wordpress-com.md) | `wordpressComProvider` | `profile.read`, `sites.list`, `posts.list` | Own OAuth registration, verified client and permissions |
| [n8n](docs/n8n.md) | `n8nProvider` | `tools.list`, `tools.call` | Assistant MCP access token, own instance URL |
| [Sanity](docs/sanity.md) | `sanityProvider` | `tools.list`, `tools.call` | Assistant API token, hosted MCP endpoint |
| [Inngest](docs/inngest.md) | `inngestProvider` | `apps.list`, `functions.list`, `events.send` | Separate Signing Key and Event Key references |
| [Canva](docs/canva.md) | `canvaProvider`, shared `createCanvaClientMetadata` | `tools.list`, `tools.call`; public metadata builder | Assistant OAuth, metadata URL, approved callback, no client secret |
| [Clay](docs/clay.md) | `clayProvider` | `identity.read`, `searches.create`, `searches.next` | User/workspace Public API key |
| [Figma](docs/figma.md) | `figmaProvider` | `tools.list`, `tools.call`; explicit `registerFigmaClient` setup | Approved confidential OAuth client |
| [Miro](docs/miro.md) | `miroProvider` | `tools.list`, `tools.call`; explicit `registerMiroClient` setup | Own MCP OAuth client, selected team |
| [Atlassian](docs/atlassian.md) | `atlassianProvider`, `registerAtlassianClient` | `tools.list`, `tools.call`; explicit client setup | Assistant OAuth, Rovo MCP v2, own confidential client |
| [Amplitude](docs/amplitude.md) | `amplitudeProvider`, `registerAmplitudeClient` | `tools.list`, `tools.call`; explicit client setup | Assistant OAuth, US/EU, own confidential client |
| [AWS S3](docs/aws-s3.md) | `awsS3Provider` | `objects.list`, `objects.downloadUrl`, `objects.uploadUrl` | Explicit AWS key/optional STS token |
| [AWS Athena](docs/aws-athena.md) | `awsAthenaProvider` | `workgroup.get`, `query.start`, `query.status`, `query.results`, `query.cancel` | Explicit AWS key/optional STS token |
| [Amazon Redshift](docs/amazon-redshift.md) | `amazonRedshiftProvider` | `tables.list`, `table.describe`, `query.start`, `query.status`, `query.results`, `query.cancel` | Explicit AWS key/optional STS token; serverless or provisioned |

The MCP providers use the official MCP SDK through a server-only transport.
They initialize and list tools to verify transport access, then expose explicit
tool calls under the existing connection policy. Discovery does not prove
permission to execute every tool. Read the [assistant OAuth pattern](patterns/assistant-mcp-oauth/PATTERN.md) for
Amplitude/Atlassian/Canva setup and the [assistant MCP pattern](patterns/assistant-mcp/PATTERN.md)
before exposing calls. These definitions cannot select shared or per-user
application mode. OAuth discovery, assistant attachment, resources, prompts and
local stdio are not part of these initial fragments.

The definitions provide names, account modes, permissions and setup text to the
shared configuration fields. API-key values belong in the environment or secret
store; `integrations.json` stores references. Use the file connection store for
text-based runtime persistence. SQL is an explicit application choice.

See the [API-key connection pattern](patterns/api-key-connection/PATTERN.md) for
library wiring usable from ordinary Node code and a manually composed CLI.
The [OAuth file-connection pattern](patterns/oauth-connection/PATTERN.md) covers
consent and callbacks with the same text-based runtime storage.
The [Microsoft guide](docs/microsoft-oauth.md) adds delegated OAuth wiring,
registration automation and provider-specific account/permission requirements.
Focused runtime tests cover the providers' requests, result validation,
credential changes, isolation, errors and disconnect. Provider calls in those
tests are simulated; live service use and sample-app generation are outside
this delivery's test scope. Managed service credentials and sharing grants
remain host-owned capabilities; an own key is not a managed subscription.

Logo.dev uses the [public-image pattern](patterns/public-image/PATTERN.md) and
its client library export. Its `runtimeKind: "public-resource"` metadata
distinguishes URL construction from the server adapters above. Image delivery
is observed in the browser; constructing a URL never records Connected.

The [AWS pattern](patterns/aws-storage-queries/PATTERN.md) composes the signed S3 and Athena libraries with the same file configuration and host authorization.
