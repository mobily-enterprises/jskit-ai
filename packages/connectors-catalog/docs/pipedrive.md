# Pipedrive

Import `pipedriveProvider` from `@jskit-ai/connectors-catalog/server/pipedrive`.
The adapter reads the authenticated profile using an API token or project-owned
OAuth registration, and provides the CRM operations listed below.

## Configure access

1. Sign into Pipedrive and switch to the intended company. A user has a distinct
   token in each company.
2. Open the top-right account menu, **Company settings → Personal preferences → API**.
3. Copy the existing API token. If the API section is missing, follow Pipedrive's
   enablement guidance with the company administrator.
4. Store it in backend Env as `PIPEDRIVE_API_KEY`. Only one active user token
   exists for that company; regenerating it can affect other connected tools.
5. Save provider `pipedrive`, mode `shared` or `assistant`, `scopes: []`, and
   authentication `{ "method": "api-key", "secretRef": "env:PIPEDRIVE_API_KEY" }`.
6. Verify with `connectApiKey`. Manage the original credential through the API
   settings page. [Token setup](https://pipedrive.readme.io/docs/how-to-find-the-api-token).

## OAuth setup

1. Use a developer sandbox account. Open the account menu → Developer Hub →
   Create an app. Choose private for an unlisted integration or public for a
   Marketplace listing; the type cannot be changed later.
2. In Basic info enter the app name and exact project callback, then Save.
   Pipedrive permits one callback per registration. The generated application
   must serve it; its initial hosting URL is the suggested origin.
3. OAuth & access scopes contains Client ID and Client secret. Copy the ID
   into the project registration and store the secret in private Env, for
   example `PIPEDRIVE_CLIENT_SECRET`. Store the registered callback in
   `PIPEDRIVE_CALLBACK_URL`. Registration authentication is `client_secret_basic`.
4. This adapter needs only the default `base` permission. Leave configuration
   `scopes: []`: permissions are selected in Pipedrive's registration rather
   than dynamically selected here. CRM reads/writes require the corresponding
   implementation and provider permissions.
5. A private draft is limited to its own company. Use Change to live to allow
   other companies to install it. Public Marketplace publication has a separate
   review process. [Private registration](https://pipedrive.readme.io/docs/marketplace-registering-a-private-app),
   [Developer Hub states](https://pipedrive.readme.io/docs/developer-hub).
6. Save authentication `{ "method": "oauth2", "registrationRef": "pipedrive" }`
   and an own registration with Client ID, the two Env references and Basic
   authentication. Use `per-user` for independent application-user grants,
   `shared` for a shared application account, or `assistant` for assistant use.
7. Start `beginAuthorization`, redirect to consent, and complete the exact
   callback with `completeAuthorization`. The user selects their company and
   allows installation. This connects CRM access, not application login.

The provider's [OAuth contract](https://pipedrive.readme.io/docs/marketplace-oauth-authorization)
uses confidential Basic authentication and form-encoded token requests. The
adapter uses the existing runtime's non-PKCE confidential flow. Each grant
retains the validated `api_domain` returned by the provider. Only a bare HTTPS
company subdomain of `pipedrive.com` is accepted. API calls use that company's
`/api/v1/users/me` with a bearer token. Refresh must return the same domain;
a change requires reconnection. A custom project domain changes the registered
callback, not the connected Pipedrive company.

## Runtime and CLI composition

In API-token mode, `profile.read` sends `GET https://api.pipedrive.com/v1/users/me` with
`x-api-token`. It takes no operation inputs and returns the `success`/`data`
envelope, including user and available company metadata. The verifier requires
`success: true` and a numeric user ID; malformed successful HTTP responses are
not accepted as connections. The global discovery endpoint is documented by
Pipedrive's [company-domain guide](https://pipedrive.readme.io/docs/how-to-get-the-company-domain).

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with this
provider. Do not send the token in query parameters or store it in source JSON.
Connection metadata belongs to the runtime's private file directory.

## Automation and application registrations

An AI can prepare files and validate requests after the owner supplies their
token or OAuth registration. No ordinary-account API for
unattended app registration was established in this pass.

The application owner supplies its authorized user token through private Env.
Separate configuration names still reference the same user/company capacity.
The project owns its registration, callback handler, Env secrets and private
grants. Vibe64 configures these values; it does not operate a central gateway.
JSKIT supplies the JavaScript runtime; Laravel implements the same provider
contract with its own framework. Disconnect deletes the local grant; revoke
provider access separately by uninstalling the app in Pipedrive.
OAuth fixtures cover two-company routing, refresh rotation after restart,
callback replay, rejected API destinations and company changes on refresh.
Local fixtures cover headers, file-store restart, rotation, tenant isolation,
invalid responses, forbidden requests and rate limits. No Pipedrive account or
record was accessed.
## CRM operations

Set settings.companyDomain for API-token record calls: copy `acme` from
`https://acme.pipedrive.com`. OAuth instead uses its stored provider-issued company
address; settings cannot override that grant. Changing settings requires recheck.
Missing domain fails before sending CRM traffic; profile checking remains global.

Use list/get/create/update for deals, persons, organizations, activities and
leads. Pipelines support list/get only. Standard objects use v2; leads use v1.
List inputs limit/cursor (v2) or limit/start (leads); preserve additional_data
and explicitly request subsequent pages. Creation requires title (deal/lead),
name (person/organization), subject (activity). Leads also need person_id or
organization_id. Update takes numeric id (lead UUID) and changed fields.
Persons support emails/phones arrays of value, primary and label. Deals accept
value/currency/status, owner/person/org/stage IDs; activities accept links,
done and due_date/due_time. Provider validates actual company IDs/field values.

In Developer Hub OAuth & access scopes choose deals:read/full, contacts:read/full,
activities:read/full for the selected operations, then reconnect. These are
registration-controlled capabilities, not dynamically selected scope checkboxes.
Provider permissions and the app's own record/write policy both apply. Verification
never creates a CRM record; uncertain writes are not automatically replayed.

CLI uses service.invoke with the same JSON/Env and authorized local operator.
Other frameworks use these endpoints with their native client and company-bound
OAuth grant. No central Vibe64 credential gateway.
**LIMITATIONS:** No full CRM UI, pipeline administration, custom fields/bulk import,
attachments, webhooks or coding-chat attachment. Example: create a contact and
follow-up deal; build the sales dashboard in the application. No live/generated-app proof.
[Records](https://developers.pipedrive.com/docs/api/v1/Deals),
[permissions](https://pipedrive.readme.io/docs/marketplace-scopes-and-permissions-explanations),
[company routing](https://developers.pipedrive.com/tutorials/get-deals-pipedrive-api).
