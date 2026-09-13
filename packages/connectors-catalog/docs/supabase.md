# Supabase

Import `supabaseProvider` from `@jskit-ai/connectors-catalog/server/supabase`.
This fragment lists project metadata through the Management API. It does not
install storage, connect to Postgres, configure login or execute SQL.

## Configure access

1. Open Supabase's [account token settings](https://supabase.com/dashboard/account/tokens)
   and generate a personal access token for this application.
2. Where available, choose a scoped token with the intended resources and
   project-read permission. Scoped tokens are in a gradual alpha rollout;
   classic tokens instead inherit the account's full access. Review that choice
   before supplying a token. [Token guide](https://supabase.com/docs/guides/platform/personal-access-tokens).
3. Put the token into backend Env as `SUPABASE_ACCESS_TOKEN`. Project anon,
   publishable, secret and service-role keys are different from Management API
   credentials. [API authentication](https://supabase.com/docs/reference/api/introduction).
4. Save provider `supabase`, mode `shared` or `assistant`, `scopes: []`, and
   authentication
   `{ "method": "api-key", "secretRef": "env:SUPABASE_ACCESS_TOKEN" }`.
5. Run `connectApiKey`. The project-list endpoint requires `projects_read` for
   a fine-grained token; its corresponding OAuth scope is `projects:read`.
   Empty accessible-project lists are valid.
   [Project endpoint](https://supabase.com/docs/reference/api/v1-list-all-projects).

## Runtime and AI composition

`projects.list` performs `GET https://api.supabase.com/v1/projects` with
Bearer authorization and no inputs. It returns the array of project metadata.
The fragment contains no project-creation or database-mutation operation.

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md), supplying
this provider and the JSON file store. Configuration and runtime state remain
files for the editor. A separate application may explicitly install a database
for its own purpose; this integration does not make that decision.

## Automation and application ownership

The Management API offers further provisioning endpoints after authentication,
so an AI can prepare API requests and application wiring with suitable owner
authority. This pass verifies token bootstrap through account settings, not an
API for creating the first personal token. OAuth registration for other users
is a distinct flow.

Personal tokens act for their owner and allowed resources. Each application
owner supplies its authorized token through private Env. Separate token names
are not sufficient evidence of independent organization limits or billing.

Fixtures cover project records, empty results, invalid payloads, credential
replacement, file-store restart, isolation and provider errors. No Supabase
project or database is created or accessed during these tests.
