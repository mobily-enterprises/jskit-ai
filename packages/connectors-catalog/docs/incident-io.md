# incident.io

Import `incidentIoProvider` from
`@jskit-ai/connectors-catalog/server/incident-io`.
The adapter reads and manages incidents, follow-ups and catalogue entries,
resolves alerts and reads schedules using an organization's API key.

## Configure access

1. Select the intended incident.io organization. Open **Settings**, then
   **API keys**, and create a key named for this application.
2. Grant `viewer` access to the relevant incidents. Review account and team
   permissions before creating the key; for writes add Create incidents / Edit incidents, for alert/schedule
   reads choose View on-call resources / Read schedules, and for catalogue
   access choose View catalog / Manage catalog. Inspect each permission
   scopes badge: follow-up writes require `follow_ups.create` and
   `follow_ups.update`; alert resolution requires `alerts.resolve`. Restrict
   team-scoped permissions to intended teams. The token cannot exceed your
   own authority.
3. Copy its value into backend Env as `INCIDENT_IO_API_KEY`.
4. Save provider `incident-io`, mode `shared` or `assistant`, `scopes: []`,
   authentication
   `{ "method": "api-key", "secretRef": "env:INCIDENT_IO_API_KEY" }`.
5. In the form Save configuration, choose Set credential in Env and store the
   key, then return to Connect account. CLI apps run `connectApiKey`. It verifies incident access by reading the list, not by
   creating an incident. Manage or revoke the provider key from API keys;
   local disconnect does not revoke it remotely.
   [API introduction](https://docs.incident.io/api-reference/introduction).

## Runtime and AI composition

`incidents.list` uses `GET https://api.incident.io/v2/incidents` with Bearer
authorization. Inputs are `page_size` (1–500, default 25), optional `after`,
and `sort_by` (`created_at_newest_first`, the default, or
`created_at_oldest_first`). The response retains incident records and optional
`pagination_meta`. Pass its `after` value for the next page; absence of paging
metadata is valid. The fragment does not implement all server-side filters.
[Endpoint schema](https://docs.incident.io/openapi/tags/incidents-v2.json).

The [API-key pattern](../patterns/api-key-connection/PATTERN.md) supplies
configuration, connection-service and JSON file-store composition for CLI or
editor consumers. The application decides which users can read its shared
incident data.

## Automation and application ownership

After an administrator creates a bootstrap key with `api_keys_manage`, an AI
can provision additional keys through `POST /v1/api_keys`. Supply a name,
account `role_names`, and any intended team IDs/team roles. The caller may
delegate only a subset of its own authority; the API cannot delegate
`api_keys_manage`. Capture the returned secret in the backend environment.
Key creation is an administrative action, not part of connection verification.
[Key API schema](https://docs.incident.io/openapi/tags/api-keys-v1.json).

Application keys can be provisioned and revoked independently, but shared
provider limits may still apply. Renaming keys is insufficient proof of isolated
capacity. The application owner supplies its authorized key through private Env.

Tests cover ordering, paging, omitted metadata, malformed results, restart,
rotation, isolation and 401/403/429 failures without live incident access.

## Incident recovery and catalogue operations

Contracts reviewed 2026-09-13 from the provider's OpenAPI:
[incidents](https://docs.incident.io/openapi/tags/incidents-v2.json),
[follow-ups](https://docs.incident.io/openapi/tags/follow-ups-v2.json),
[alerts](https://docs.incident.io/openapi/tags/alerts-v2.json),
[schedules](https://docs.incident.io/openapi/tags/schedules-v2.json),
[catalogue](https://docs.incident.io/openapi/tags/catalog-v3.json).

- `incidents.get({id})`, `.create({idempotency_key, visibility, name?, summary?,
  severity_id?, incident_status_id?, incident_type_id?, mode?})`; mode defaults
  to standard. Set public/private visibility explicitly. Standard incidents can
  create Slack announcements. Retain the event's idempotency key across retries.
- `incidents.update({id, incident, notify_incident_channel})` edits only supplied
  name, summary, severity_id or incident_status_id. The notification choice is
  mandatory. Copy status/severity IDs from your account's records/API, not labels.
- `followUps.list({incident_id?, incident_mode?, assignee_team_id?})`, `.get({id})`,
  `.create({incident_id,title,description?,assignee_id?,assignee_team_id?,
  follow_up_category_id?,follow_up_priority_option_id?})`; `.update` takes `id`,
  required current title and status, plus those optional editable fields.
  Status is outstanding/completed/deleted/not_doing. Fetch the current record
  before updating; this is the provider's PUT contract, not a partial PATCH.
- `alerts.list({page_size?,after?})` (maximum 50), `.get({id})`, `.resolve({id})`.
  Already-resolved alerts are a provider no-op. Externally resolved sources can
  return 422; resolve those in their source system. Private alerts need provider
  permission and may otherwise appear as 404.
- `schedules.list({page_size?,after?})` caps pages at 25 to retain next_shifts;
  `.get({id})` reads a schedule. No rota creation or override management.
- `catalog.types()`, `.list({catalog_type_id,page_size?,after?,identifier?})`
  (maximum 250), `.get({id})`, `.create({catalog_type_id,name,attribute_values,
  external_id?})`, `.update({id,name,attribute_values,external_id?})`.
  Bind attribute IDs to `{value:{literal:"..."}}` or
  `{array_value:[{literal:"..."}]}`. Maximum 250 attributes / 100KB, with up to
  100 array values. Fetch existing values and send the intended full map when
  updating. Matching external_id/catalog_type_id on creation can update an
  existing entry; authorize that target first. Provider schemas determine which
  attribute IDs/types are valid.

For example, an app receives its own outage event, creates an incident with a
stable idempotency key, assigns a follow-up, reads the next on-call shift and
updates the recovery summary. After recovery it explicitly resolves an eligible
alert and marks the follow-up completed. All triggers, authorization, correlation
IDs and retry/reconciliation decisions belong to that app. The connector performs
one requested operation at a time; verification never creates incidents.

The UI, CLI and AI-written Node apps use the same JSON/Env and exported runtime.
Other frameworks use their native HTTP client with the same configuration and
provider contracts. No editor or JSKIT process is required in their deployment.
No OAuth registration/callback is needed. AI may prepare configuration and key
provisioning after an authorized bootstrap key; the owner supplies initial access.

**LIMITATIONS:** No incident dashboard, scheduling/paging engine, alert ingestion,
workflow engine, webhook receiver, postmortem importer, custom-field/role editing,
catalogue schema editing or bulk synchronizer. Example: an app can show the next
shift and resolve an alert, but cannot generate a rota or start monitoring servers
just by connecting. Editor-assistant attachment is deferred. Fixture tests do not
prove live delivery, role entitlement or provider-side workflow effects.
