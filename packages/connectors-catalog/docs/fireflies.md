# Fireflies

Import `firefliesProvider` from `@jskit-ai/connectors-catalog/server/fireflies`.
The provider reads the key owner profile, meeting lists, transcript content and summaries, and searches titles/spoken words.

## Configure access

1. Sign into the intended Fireflies account and open **Integrations**, then
   **Fireflies API**.
2. Copy the displayed API key into backend Env as `FIREFLIES_API_KEY`. The key
   follows the user's access and team permissions; admin access may include
   team data. [Authorization](https://docs.fireflies.ai/fundamentals/authorization).
3. Save provider `fireflies`, mode `shared` or `assistant`, `scopes: []`, and
   authentication
   `{ "method": "api-key", "secretRef": "env:FIREFLIES_API_KEY" }`.
4. In Vibe64, enter `env:FIREFLIES_API_KEY` as **API key reference**, click
   **Save configuration**, then **Set credential in Env**. Store the real key
   as `FIREFLIES_API_KEY` and return to connect. CLI applications invoke
   `connectApiKey` to verify the profile. Token replacement belongs in Env.
   Disconnect clears local state; it does not revoke the provider key.

## Runtime and AI composition

All operations POST fixed GraphQL queries to
`https://api.fireflies.ai/graphql` using Bearer authorization.
`profile.read` requests `user { user_id name email }` without an ID, so the
provider returns the key owner's profile.
[User query](https://docs.fireflies.ai/graphql-api/query/user).

`transcripts.list` requests only `id` and `title`. Inputs are `limit` (1–50,
default 25), `skip` (nonnegative GraphQL integer, default 0) and `mine`
(default true). `mine` restricts results to meetings organized by the key owner;
it does not mean every meeting they attended. Explicit false requests the
broader set the account is authorized to see. Advance `skip` for another page.
No transcript audio, recording request or meeting-join mutation is performed.
[Transcript query](https://docs.fireflies.ai/graphql-api/query/transcripts).

The runtime rejects GraphQL errors even with HTTP 200 and partial data. Queries
are fixed source; application inputs are variables. Compose the
[API-key pattern](../patterns/api-key-connection/PATTERN.md) with the private
JSON store. The application must authorize who may use this shared account.

## Automation and application ownership

An AI can prepare the configuration and query wiring once the owner supplies a
key. The established bootstrap is the Integrations screen; no API for issuing
the initial user key was verified. Account and team membership remain provider
administration tasks.

This credential represents a particular user, not a universal registration for
every app visitor. The application owner supplies that user's authorized key
and checks account/team capacity. Two labels do not create independent provider
budgets. Per-user OAuth remains additional work.

Tests verify query variables, default meeting ownership, integer limits,
partial errors, HTTP failures, credential rotation, private persistence and
application isolation. They do not access real meetings.

Setup rechecked against the official authorization and quickstart guides on
12 September 2026. The captured Lovable form was an empty shell; exact input
parity remains unproven. No signed-in Fireflies console was inspected.

## Transcript content and search

`transcripts.get({id})` returns sentence text, speaker attribution, timestamps,
participants, title/date/duration, calendar/meeting links and summary keywords,
action items, outline and overview. Missing/inaccessible transcripts fail;
null sentences or summaries remain unavailable content, not a completed
summary. Fireflies processing and plan permissions determine availability.

`transcripts.search({keyword, scope, limit, skip, mine})` searches `all` by
default, or `title`/`sentences`. Keyword length is 1–255. Pagination and `mine`
use the same limits as listing. Retrieve selected IDs with `transcripts.get`.
The app must restrict which callers can read team meetings even with a valid
shared key. Do not render returned Markdown as untrusted raw HTML.

CLI apps use the same file and private Env with the API-key pattern. Other
frameworks use their native HTTP client to POST the fixed query/variables to
Fireflies; JSKIT and Vibe64 are optional. The app owns its digest schedules,
cache, task tracking and CRM writes through their respective APIs.

**LIMITATIONS:** editor assistant attachment remains deferred. Example: a
published app can show a sales call's action items; the Vibe64 coding assistant
does not gain meeting access from this configuration. Recording, transcript
mutation, incoming webhooks and per-user OAuth are not supplied (the Lovable
reference also describes these as excluded). Exact signed-in screen placement
was not captured; current official instructions establish API-key setup.

Rechecked 13 September 2026 against [transcript detail](https://docs.fireflies.ai/graphql-api/query/transcript),
[search](https://docs.fireflies.ai/graphql-api/query/transcripts),
[authorization](https://docs.fireflies.ai/fundamentals/authorization) and
[Lovable's current fields/capabilities](https://docs.lovable.dev/integrations/fireflies).
The latter resolves the empty original form: display name and an API key are
required inputs for its shared connection. Vibe64 stores a private Env reference
instead of putting the key in the source file. No live meetings were read.
