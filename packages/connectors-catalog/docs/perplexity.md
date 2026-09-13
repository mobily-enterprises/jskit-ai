# Perplexity

Import `perplexityProvider` from
`@jskit-ai/connectors-catalog/server/perplexity`.
The adapter verifies credentials with async-request summaries. The app-owned native-client recipe below uses this same saved slot for cited answers and streaming.

## Configure access

1. Sign into the Perplexity API console. Open **Projects** and create or select
   the project that should own these credentials.
2. Open **API Keys**, generate the initial key, and copy its value before
   navigating away. Store it in backend Env as `PERPLEXITY_API_KEY`.
3. Save provider `perplexity`, mode `shared` or `assistant`, `scopes: []`, and
   authentication
   `{ "method": "api-key", "secretRef": "env:PERPLEXITY_API_KEY" }`.
4. Run `connectApiKey` to verify the authenticated async-request listing.
   Provider revocation remains separate from local disconnect.
   [Key management](https://docs.perplexity.ai/docs/admin/api-key-management).

## Runtime and AI composition

`requests.list` calls `GET https://api.perplexity.ai/v1/async/sonar` using
Bearer authorization. The result contains `requests` and may contain
`next_token`. This fragment exposes the initial page only: the reference read
in this pass did not specify a continuation query parameter, so none is
invented. It does not submit or resume a generation job.
[Async list](https://docs.perplexity.ai/api-reference/async-sonar-get).

`models.list` calls `GET /v1/models` and returns the provider's `object: list`
envelope. That endpoint is public and therefore is not used to verify the key.
Both operations accept no input. Model names remain provider data rather than
hard-coded choices. [Model list](https://docs.perplexity.ai/api-reference/models-get).

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with this
provider and the private file store. AI-written source can present model
choices or previous request statuses. For answer generation and streaming, use the supplied app-owned recipe below.

## Automation and application ownership

After the console project and initial key exist, an authorized AI can create
additional keys with `POST /generate_auth_token`, Bearer auth and
`{ "token_name": "application-name" }`. Capture `auth_token` once into Env.
`POST /revoke_auth_token` accepts the old `auth_token` for retirement after
replacement. These administrative operations are not invoked by the fragment.
[Provisioning API](https://docs.perplexity.ai/docs/admin/api-key-management).

The application owner supplies its own token and checks overlapping project and
account limits. Token labels alone do not isolate capacity. Billing remains
between that owner and Perplexity; this adapter does not assign platform credits.

Tests verify authenticated checking, request paths, result validation, key
rotation, restart, isolation and HTTP errors without live service use.

## Complete native-client recipe

Use [perplexity-answer.js](../patterns/ai-connections/example/perplexity-answer.js)
from the existing AI-connections pattern. Your app supplies its native SDK factory:

```js
import OpenAI from "openai"; // installed and owned by the application
import { createPerplexityAnswers } from "./perplexity-answer.js";
const answer = createPerplexityAnswers({ configuration, authorize,
  createClient: options => new OpenAI(options) });
const response = await answer({ context, integrationId: "research",
  model: "sonar", question: "What does the source report?" });
// response.choices[0].message.content, response.citations, response.search_results
const chunks = await answer({ context, integrationId: "research", model: "sonar",
  question: "Summarize the source", stream: true, signal });
for await (const chunk of chunks) { /* render delta text; retain final citations */ }
```

The slot is provider perplexity, authentication api-key and your own secretRef;
there is no second AI configuration or model catalogue to maintain. The app's
policy authorizes the exact question/model/mode before Env access. Keys resolve
on every call, so rotation applies without rewriting source. CLI apps use the
same recipe; other frameworks read the slot and use their native SDK directly.

**LIMITATIONS:** No premade research/chat screen, persistent conversation, budget
manager, Agent API orchestration or automatic coding-chat attachment. Example:
a backend can request a cited answer; the app owns rendering and spending rules.
The adapter's async-history listing still only reads its initial page. Live
provider behavior and generated-app execution are unproven.

[Native compatibility](https://docs.perplexity.ai/docs/sonar/openai-compatibility)
and [streaming](https://docs.perplexity.ai/docs/sonar/pro-search/stream-mode).
