# Gemini Enterprise

Initial fragment: Google OAuth, engine metadata and document search. The editor
and CLI use the same file, validation and runtime. Saving configuration makes no
Google requests. These operations use the connected Google account's permissions;
shared and assistant ownership do not establish an identity for each app user.

## Configuration

```json
{
  "schemaVersion": 1,
  "registrations": {
    "google-search": {
      "source": "own",
      "clientId": "example.apps.googleusercontent.com",
      "clientSecretRef": "env:GEMINI_ENTERPRISE_SECRET",
      "callbackUrlRef": "env:GEMINI_ENTERPRISE_CALLBACK"
    }
  },
  "integrations": {
    "enterprise-search": {
      "provider": "gemini-enterprise",
      "displayName": "Company search",
      "accountMode": "shared",
      "settings": {
        "projectId": "my-gcp-project",
        "location": "global",
        "engineId": "my-search-engine"
      },
      "scopes": ["https://www.googleapis.com/auth/cloud-platform"],
      "authentication": { "method": "oauth2", "registrationRef": "google-search" }
    }
  }
}
```

`projectId` is the project identifier, not a numeric project number. `engineId`
is 1–63 lowercase letters, digits, underscores or hyphens, starting with a letter
or digit. `location` defaults to `global` and supports `us` and `eu`. The engine
must already exist under `default_collection`; searches use
`default_serving_config`. Other collections, serving configurations and locations
are not included in this fragment. The editor renders location as a select to
prevent unsupported values. The display name only labels this connection.

The captured Cloud Platform permission is broad. Both implemented operations
require it locally, while Google separately checks IAM and source permissions.
The implementation exposes no resource writes despite the scope. Narrower Google
scope variants and per-user connections are not yet provided. The host's
`authorize` callback must control access to the shared connection and its results.
Never accept a shared subject or application ID directly from an untrusted caller.

## Provider setup: clicks and responsibilities

1. Sign into [Google Cloud Console](https://console.cloud.google.com/) using the
   account authorized to administer the target project. Select the project in
   the top project picker. Confirm the project ID and billing with its owner.
2. Open **APIs & Services → Library**, search for **Discovery Engine API**, open
   it and click **Enable** if needed. This is `discoveryengine.googleapis.com`.
3. Open **Gemini Enterprise → Apps**. Select the existing search app. If an
   appropriate app does not exist, use **Create app**, choose the search setup,
   enter its name, review the generated app ID, select its location and click
   **Create**. Configure the intended data stores separately. Use Google's
   [app creation instructions](https://docs.cloud.google.com/gemini/enterprise/docs/create-app)
   for the applicable edition. Copy the engine/app ID and location, not its title.
   Importing source content, configuring identities and any required licenses are
   separate prerequisites; creating an OAuth client does not complete them.
4. In **IAM & Admin**, have the project administrator create or select a role
   with `discoveryengine.engines.get` and
   `discoveryengine.servingConfigs.search`, and grant it to the Google account
   that will connect. Apply the intended source permissions as well. Avoid
   granting project Owner merely to make connection checking pass.
5. Open **Google Auth Platform**. Configure **Branding**, **Audience** and
   **Data Access** for this application's actual users. Add
   `https://www.googleapis.com/auth/cloud-platform`. For an external application
   in testing, add the connecting account under test users. Publishing or
   verification, and organization restrictions, remain operator/provider work.
6. Open **Clients → Create Client**, choose **Web application**, give it a name
   and add the exact backend callback under **Authorized redirect URIs**. Click
   **Create** and securely save the displayed client ID and secret. Enter only
   the ID and secret reference in the integration file. Google documents this
   confidential flow in its [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).
7. In Vibe64, copy **Suggested callback URL** into the Google redirect URI
   registration. **Save configuration**, then use the Env links for the secret
   and callback references. For the example above, set `GEMINI_ENTERPRISE_SECRET`
   and `GEMINI_ENTERPRISE_CALLBACK` in the
   application's server environment. The callback handler must already exist
   and call the shared connection service; a value in a file creates no route.
8. Save the configuration. In the application, start OAuth, choose the intended
   Google account and approve access. The runtime verifies `engine.get` before
   storing the connection. A successful metadata check does not prove search
   permission, source ingestion, relevance or app-user access isolation.

Google describes [engine access](https://docs.cloud.google.com/gemini/enterprise/docs/reference/rest/v1/projects.locations.collections.engines/get),
[search permissions](https://docs.cloud.google.com/gemini/enterprise/docs/reference/rest/v1/projects.locations.collections.engines.servingConfigs/search)
and [source access control](https://docs.cloud.google.com/generative-ai-app-builder/docs/data-source-access-control)
separately. This fragment sends the shared account's OAuth token; it supplies no
caller-selected source identity, impersonation header or Workforce Identity token.

## Application ownership, callbacks and capacity

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

Record the target engine's Google Cloud project as well as the registration's
project. Two client IDs in one project do not isolate project quotas. Engine
consumption and billing depend on the project hosting that engine; changing the
OAuth registration does not move the engine's costs or capacity. The application
owner supplies the registration and target-project permissions needed for its
own users and resources.

## AI-assisted provisioning

An authorized AI can prepare JSON, IAM role definitions and API enablement steps,
and can use Google resource APIs/CLI for permitted project and engine operations.
For example, the engine [create API](https://docs.cloud.google.com/gemini/enterprise/docs/reference/rest/v1/projects.locations.collections.engines/create)
exists. Provisioning must be explicitly authorized; this adapter exposes no such
write operation. It can inspect supplied identifiers and help troubleshoot
configuration without reading documents.

Plan on operator setup for the standard Google Auth Platform web clients,
branding/audience, verification, billing and source-identity decisions. This
fragment provides no OAuth-client provisioning API or claim that an AI can
complete those controls unattended. Prepare an application-owned registration
and callback for each independent application; hosted and installed editors use
the same ownership model. Copying IDs does not duplicate user consent or source
permissions. Keep secrets out of chat, examples and source control.

## Runtime and CLI wiring

```js
import { geminiEnterpriseProvider } from "@jskit-ai/connectors-catalog/server/gemini-enterprise";
// Include geminiEnterpriseProvider in createConnectionService({ providers, ... }).
const page = await connections.invoke({
  context,
  integrationId: "enterprise-search",
  operation: "search",
  input: { query: "holiday policy", pageSize: 10 }
});
```

The app supplies configuration loading, reference resolution, authorization,
encrypted file storage and callback routes, as described in the core package.
`engine.get` accepts no input. `search` accepts a required nonempty `query`
(adapter limit 4096 characters), `pageSize` 1–25 (default 10) and an optional
`pageToken` (adapter limit 16000 characters). Reuse the same query and page size
when requesting the next page. No automatic pagination occurs. The 25-result
limit works across Google's documented search data types.

The runtime uses Google's standard authorization and token endpoints with S256
PKCE, offline consent and confidential client authentication. API requests use
`discoveryengine.googleapis.com`, `us-discoveryengine.googleapis.com` or
`eu-discoveryengine.googleapis.com` according to the configured location; see
[Google's locations](https://docs.cloud.google.com/gemini/enterprise/docs/locations).
Engine changes require reconnection. OAuth refresh, local disconnect, cancellation
and bounded transport errors are owned by the existing core service.

The original JSON search envelope is returned, including result document fields,
attribution and pagination. Empty protobuf JSON result arrays may be omitted.
A provider `redirectUri` is returned as data and is never followed; the consuming
app must decide how to present it. Treat document text, URLs and snippets as
untrusted content. See [SearchResponse](https://docs.cloud.google.com/gemini/enterprise/docs/reference/rest/v1/SearchResponse)
and [SearchResult](https://docs.cloud.google.com/gemini/enterprise/docs/reference/rest/v1/SearchResult).

No standalone answer API, chat sessions, ingestion, API-key search, service accounts,
Workforce Identity Federation, per-user Google identity, widget or application
login is implemented here. Disconnect removes the local grant; it does not call
Google's revocation endpoint. Controlled fixtures cover protocol and file/UI
behavior; real IAM, licenses, consent, source ACLs and search quality are untested.

## Optional snippets and cited summaries

The search operation now accepts the documented `contentSearchSpec` subset:

```js
const result = await connections.invoke({ context, integrationId: "enterprise-search",
  operation: "search", input: { query: "How do I request leave?", pageSize: 10,
    contentSearchSpec: {
      snippetSpec: { returnSnippet: true },
      summarySpec: { summaryResultCount: 3, includeCitations: true }
    }
  }
});
// Render result.summary.summaryText as escaped text/sanitized Markdown.
// Keep the returned result order: Google's [1] citation refers to result 1.
// Show summarySkippedReasons when no summary was generated.
```

Summary count is 1–10. Citation inclusion and filters for adversarial,
non-summary and low-relevance queries default true for this option. Omitting
`summarySpec` does not request generation; verification never requests it.
The engine's Google project pays applicable search/generation costs. The app
must authorize that use and source disclosure. A shared connection does not
provide per-visitor source ACLs. Do not pass a visitor's email as an invented
impersonation identity or assume administrator-visible documents are public.

Snippets are in document-derived fields; preserve their status, source links
and attribution. If Google cannot provide a snippet, display that absence.
The app may instead send permitted snippets to its own chosen native AI
library, with its own credentials and data-sharing policy. This connector
neither chooses that library nor operates an inference gateway.

Other frameworks POST the same JSON body to the region's Discovery Engine
search endpoint using the application's stored OAuth grant. The administrator
still owns ingestion, source permissions and licensing. JSKIT is optional.

Checked against [Google ContentSearchSpec](https://docs.cloud.google.com/gemini/enterprise/docs/reference/rest/v1/ContentSearchSpec)
on 13 September 2026. **LIMITATIONS:** no source provisioning, per-user source
identity, standalone chat UI or editor assistant attachment. Example: an
internal app can answer leave-policy questions with Google citations, but
configuring it does not import company files or grant every employee access.
Controlled fixtures prove request/response handling; real ACLs, licensing,
relevance and summary quality remain untested.
