# AI connections and a static model catalogue

This integration supplies configuration and authorized connection parameters.
The application's AI library makes requests directly to its chosen provider.
There is no JSKIT or Vibe64 inference gateway, token resale, conversation engine,
coding-agent runtime, or automatic paid fallback.

## Ownership

| Owner | Responsibility |
| --- | --- |
| JSKIT `connectors-catalog` | Static provider/model data, settings schema, free-access classification and Node credential resolver |
| JSKIT `connectors-web` | Reusable Vue configuration fields, including searchable model selection |
| Vibe64 | Edit the project's portable `integrations.json`; manage administrator secrets through its existing Env system |
| Vibe64 Online | Supply the same editor and Env facilities; it supplies no AI credit or shared commercial AI identity |
| Generated application | Authenticate and authorize its users, own credentials and individual connection screens, choose its AI SDK, execute requests and handle provider failures |
| Other frameworks | Read the same configuration or map it into their native configuration; use their own libraries and private credential storage |

JSKIT is a JavaScript library for Node applications. A Laravel application does
not install JSKIT, Node, OpenCode or Vibe64. Its backend can read the selected
model and `env:NAME` reference and use its own environment/configuration and AI
client. Framework-independent facts in this guide are usable by its coding AI;
PHP code and a parallel PHP package are not part of JSKIT.

## Default and catalogue

Import `aiCatalogue`, `listAiModels`, `getAiModel`, `aiAccessLabels` and
`DEFAULT_AI_MODEL` from `@jskit-ai/connectors-catalog/shared/ai`.

The one-time 10 September 2026 extraction contains 213 provider records and
7,614 model records from models.dev, the catalogue used by OpenCode. There is
no runtime fetch, synchronization job, subprocess or OpenCode dependency.
The raw-source hashes and source URLs are in the bundled `ai-models.json`;
[upstream MIT notices](ai-upstream-notices.md) accompany it. Updates require
deliberate review and a new package release.

`listAiModels()` hides deprecated entries and sorts free choices first, with
`opencode/big-pickle` first. `includeDeprecated: true` exposes retained upstream
history; `providerId`, `access` and `configurableOnly` filter the list.
Models retain limits, modality and cost metadata as dated information, not a
promise of current availability or a billing calculator. An explicit unknown
or deprecated model fails validation; it is never replaced automatically.

| Classification | Meaning |
| --- | --- |
| `free-no-setup` | Active Zen entry with zero declared input, output and other cost fields, covered by OpenCode's published public access rule |
| `free-with-connection` | Zero declared costs, but a connection is required or no public access rule has been established |
| `paid` | Declared positive input or output charges |
| `unknown` | Insufficient pricing information; check the provider |

The snapshot's seven active public choices are Big Pickle, MiMo-V2.5 Free,
Ling3.0 FlashFin Free, Nemotron 3 Ultra Free, Nemotron 3.5 Lightning Free,
Muse Spark 1.2 Contributor Free and Muse Spark 1.3 Contributor Free.
This is a source-derived eligibility list, **not live inference verification**.
Provider capacity, free offers and data-use terms can change. A failure stays
with the selected provider/model; the application decides how to explain it.

Zen's no-account protocol uses the fixed string `public` in its API-key
position. The resolver supplies it. Nobody needs to enter it, create an account
or create an environment variable for this mode. The Muse models use the
OpenAI Responses SDK route, whereas Big Pickle uses OpenAI-compatible chat;
the model's `sdkPackage` preserves that distinction.

The initial configuration form and resolver support regular direct API-key
routes for OpenCode Zen, Z.AI, OpenAI, Anthropic, DeepSeek, Google, OpenRouter,
Groq, Mistral, xAI, Cerebras, Together AI and Perplexity. Other upstream records
remain available as `connection: "framework"` metadata. Cloud identity,
regional endpoints, coding subscriptions and special authentication require
their framework's own configuration; their presence in the catalogue does not
claim that a URL and API key can configure them.

## Portable configuration and Env

This is enough to select the no-setup default:

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "suggestions": {
      "provider": "ai",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "none" },
      "settings": { "model": "opencode/big-pickle" }
    }
  }
}
```

For an administrator-funded model, select `authentication.method: "api-key"`
and `authentication.secretRef: "env:APP_AI_API_KEY"`. Store the **value** in the
existing Env screen or the application's normal private environment. Vibe64's
existing launch/deployment environment mechanism supplies it to the backend;
this integration adds no token delivery service. Do not use `VITE_` or another
browser-exposed environment prefix. The JSON and source control contain only
the variable's name.

`createAiConnectionResolver({ configuration, authorize, resolveReference? })`
is imported from `@jskit-ai/connectors-catalog/server/ai`. It uses the existing
environment-reference resolver by default. `resolve({ context, integrationId })`
returns `{ providerId, model, sdkPackage, baseURL?, apiKey, access }` **to backend
code only**. An absent `baseURL` means use the named provider SDK's normal
endpoint. Pass the result to an explicitly installed SDK adapter; never
dynamically install a package or send the result through a browser route.

The application must implement `authorize(context, request)` and return a
trusted `{ applicationId, subjectId }`, or deny access. It receives operation
`ai.resolve`, the integration ID and the configured account mode. Derive
identity from a server-authenticated session or trusted CLI operator, never
from request-supplied owner IDs. Check who can consume the shared account.
Authorize edits to the configuration and Env separately as administrator work.

Secrets are resolved on every call, so rotation or deletion takes effect without
changing source. Missing or invalid bindings fail without leaking their values.
Saving the form means **configured**, not **connected** or **verified**.

## Individual app accounts

Use `accountMode: "per-user"` and a reference such as `account:personal-ai`.
The app supplies `resolveReference(reference, owner, slot)`, where `owner` is
the authorized application/user identity and `slot` includes integration ID,
account mode and provider ID. Look up only that user's grant for that provider
and integration. Bind stored keys to all those identities; do not resolve a
reference against another app's or another provider's credentials.

The app owns authenticated key entry, verification, encrypted private storage,
replacement and disconnect. JSKIT's existing encrypted file store is available
to Node apps that choose file storage; this resolver creates no database or
second store. A shared `env:` reference is rejected in individual-account mode.
Disconnect removes that user's grant; it must not affect another user.

Changing providers in the form removes the previous key reference. Existing
editor coding-agent credentials are never inherited. A provider-supported
OAuth-to-key flow can be implemented by the app before storing its own grant;
this initial integration does not implement OAuth or a login screen for every
AI service. Do not repurpose Codex or Claude coding-subscription OAuth tokens
as general app-inference credentials.

## Provider setup and automation

There are no `vibe64-online`/`vibe64-public` OAuth registrations or universal
callbacks for this AI integration. Regular keys belong to the app administrator
or individual app user and are billed directly by that provider.

For the no-setup default: choose AI, keep Big Pickle selected and save. No
provider-side action is needed. For API-key routes, follow the provider's current
dashboard documentation linked in `aiCatalogue.providers[].documentationUrl`:

1. The account owner signs in to the provider and selects the organization or
   project that should own usage. This is a human account/terms/billing step.
2. Open the provider's API-key management screen and create a dedicated key
   for this application. Choose applicable project restrictions and limits.
3. Copy the value directly into the app's Env or authenticated personal-key
   screen. Save only its reference in the integration configuration.
4. Choose a model on that same provider route. Configure the app's SDK using
   the selected model's protocol. Verification and inference belong to the app.

For **Z.AI**, open [API keys](https://z.ai/manage-apikey/apikey-list), create a
regular API key, store it in Env, and select `zai/glm-4.7-flash`. Its regular API
base is `https://api.z.ai/api/paas/v4`. GLM-4.7-Flash is listed free but needs a
key; full GLM-4.7 is paid. The Coding Plan endpoint is not this app-inference
route.

For **Zen paid access**, follow [Zen setup](https://opencode.ai/docs/zen/),
create an account/key and meet its billing requirements before choosing a paid
model. For **OpenRouter**, the app may separately implement the provider's
[OAuth PKCE key-creation flow](https://openrouter.ai/docs/guides/overview/auth/oauth);
it still stores the resulting user-owned key privately. Other dashboards may
offer administrative provisioning APIs, but this slice does not assume or
automate them. AI can wire environment names, configuration and native SDKs;
it cannot create somebody's account, accept terms or supply their billing
authorization merely by editing this JSON.

## Evidence and limits

Focused tests cover snapshot integrity, free/default classification, strict
selection, authorized environment and individual-key resolution, rotation,
disconnect, redacted failures and SDK parameter handoff. Browser fixtures cover
the editor's default, searchable model change, credential ownership, persistence
and responsive layout. These tests perform no live inference, provider login,
account creation or generated-application execution.

## Existing-scope closeout — 13 September 2026

A static, attributed September 10 provider/model catalogue, searchable free/paid model configuration and a backend-only authorized credential/SDK-parameter resolver. The default is the snapshot's Zen Big Pickle no-account route; administrator keys resolve through Env, and individual keys through an app-supplied user/provider-scoped reference resolver.

No inference engine, streaming, tools, conversation storage, provider OAuth/login screens, account/key provisioning, live credential verification, usage metering, billing, token resale or Vibe64 AI gateway. No automatic SDK installation, catalogue updates, model replacement or paid fallback. Only the 13 explicitly supported direct-key routes are configurable; other catalogue entries are framework metadata, not implemented cloud/coding-subscription authentication. Model availability, pricing/free classification and endpoint operation are dated source information, not live proof; even no-setup choices can be unavailable or capacity-limited. Detailed provider-specific personal-key entry, verification, encrypted storage, rotation/disconnect and authorization remain application work; the resolver only consumes those bindings. The app/framework owns SDK installation, protocol selection, requests, errors and UI. Generic key-creation guidance and linked provider documentation are supplied; bespoke audited login/key-creation screens for every catalogue provider are not. To extend: deliberately refresh the static snapshot, improve selected provider-specific instructions, and wire any desired app-native key-entry/inference features. This intentionally differs from Lovable managed AI; Vibe64 coding-agent credentials and runtime remain separate.

10 source and 10 installed-package tests passed on September 13, proving snapshot/default selection, rejected unsupported modes, no-network public parameters, authorized Env and individual references, rotation/deletion, redaction and SDK handoff. Historical September 10 compact/medium/expanded UI evidence is retained; no fresh browser, live inference, provider account, generated-app execution or release was performed.
