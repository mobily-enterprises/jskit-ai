# Workday

This adapter connects each application's authenticated user to their own
Workday account and reads workers, organizations, time off and custom reports.
It uses a customer-owned confidential OAuth client, Staffing v7, Absence
Management v5 and tenant RaaS JSON reports. The user's Workday security profile determines the
records returned. Saving configuration does not authorize or contact Workday.

## Portable configuration

```json
{
  "schemaVersion": 1,
  "registrations": {
    "workday-tenant": {
      "source": "own",
      "clientId": "replace-with-workday-client-id",
      "clientSecretRef": "env:WORKDAY_CLIENT_SECRET",
      "callbackUrlRef": "env:WORKDAY_CALLBACK_URL"
    }
  },
  "integrations": {
    "workday": {
      "provider": "workday",
      "accountMode": "per-user",
      "settings": {
        "restApiEndpoint": "https://wd5-services1.myworkday.com/ccx/api/v1/acme_corp",
        "tokenEndpoint": "https://wd5-services1.myworkday.com/ccx/oauth2/acme_corp/token",
        "authorizationEndpoint": "https://acme.wd5.myworkday.com/acme_corp/authorize"
      },
      "scopes": [],
      "authentication": { "method": "oauth2", "registrationRef": "workday-tenant" }
    }
  }
}
```

The editor and CLI use this same schema. Optional `displayName` and `access`
use the core configuration contract; access to configuring a registration is
separate from ownership of each connected user's tokens. Store the real secret
and callback in the application's environment. Keep encrypted runtime files and
their durable encryption key outside exported source.

The REST endpoint accepts the captured `/ccx/api/v1/{tenant}` base or an explicit
`/ccx/api/staffing/v7/{tenant}` base. It also accepts these API paths without the
`/ccx` prefix, as documented in Workday's current REST fundamentals. Worker URLs
retain the configured host, prefix and tenant and select Staffing v7. No host
discovery or retry on another base path occurs. Check the copied endpoint for
your tenant before use; these forms have fixture coverage, not live-tenant proof.
Token URLs must match the REST host and tenant. Authorization may use a different
Workday host, but must name the same tenant. HTTPS subdomains of `myworkday.com`
are supported; custom gateways, ports, URL credentials, queries and fragments
are excluded from this initial adapter.

## Register the provider client

These are tenant administrator tasks, not Workday Developer Site/Extend client
registration. Task availability depends on the administrator's permissions.

1. Sign into the intended production or sandbox Workday tenant. Confirm its name
   and environment; sandbox credentials must not be copied into production.
2. If OAuth clients are disabled, have the security administrator open **Edit
   Tenant Setup – Security**, enable **OAuth 2.0 Clients Enabled**, and apply the
   organization's normal security-change process.
3. Search for **Register API Client**. Enter a recognizable client name such as
   `DogAndGroom — production` or `DogAndGroom — sandbox`.
   Choose **Authorization Code Grant** and **Bearer** access tokens.
4. Leave **Support Proof Key for Code Exchange (PKCE)** disabled for this
   confidential setup. The captured Workday connector expects the client secret
   issued by that flow. This adapter explicitly omits PKCE; other providers keep
   the core's S256 default. Public clients without a secret are unsupported here.
5. Set **Redirection URI** to the exact backend callback owned by your app. For
   an ordinary CLI, run that same backend flow with a callback accepted by Workday;
   do not embed the client secret in browser code or invent a device-code flow.
6. In **Scope (Functional Areas)**, select **Staffing** for these worker reads.
   Follow the tenant's policy for Workday-owned scopes; additional functional
   areas do not add operations to this adapter. No scope strings are sent in
   the authorization request: functional areas are configured in Workday.
7. Retain a refresh-token timeout approved by the tenant administrator. Workday
   exposes **Non-Expiring Refresh Tokens**, but enabling it is not required by
   this library and does not prevent manual revocation or other access changes.
8. Save and copy the **Client ID** and **Client Secret**. Store the secret in Env
   and its reference in the file. Workday may show the secret only at creation.
9. Open **View API Clients**, find this client and copy **Workday REST API
   Endpoint**, **Token Endpoint** and **Authorization Endpoint** exactly. The
   authorization host normally differs from the REST/token host.
10. Grant the intended users **View** in the **Report/Task Permissions** of the
    domains securing `GET /workers` and `GET /workers/{ID}`. Staffing v7 lists
    FLW Service, Self-Service: Current Staffing Information and Worker Data:
    Public Worker Reports. Select the appropriate tenant security groups and
    activate approved pending policy changes. SOAP Integration Permissions do
    not substitute for REST Report/Task Permissions.
11. Save the file or editor form. From the application's authenticated connection
    screen, start consent. Workday signs in each person; `workers.me` verifies
    their worker resource before the connection is marked connected. A user
    without an accessible worker record cannot pass this initial check.

## Runtime composition and operations

Import `workdayProvider` from `@jskit-ai/connectors-catalog/server/workday` and
register it in `parseIntegrationConfiguration` and `createConnectionService`.
Use the packaged OAuth connection pattern for file storage, reference resolution,
`beginAuthorization`, `completeAuthorization`, cancellation and disconnect.
The host authenticates callers and derives a stable application/user identity;
never accept that ownership from a callback query or request body.

| Operation | Inputs | Result |
| --- | --- | --- |
| `workers.me` | None | The connected person's worker object; used for verification. |
| `workers.list` | `limit` 1–100 (default 20), `offset` nonnegative safe integer (default 0), optional `search` 1–512 characters, `includeTerminatedWorkers`, `filterByOrgVisibility` | One `{ data, total }` page, preserved with provider metadata. |

`search` is Workday's name/worker-ID search, not a general query language.
`filterByOrgVisibility` needs the corresponding Workday tenant setting. Empty
pages are valid. The library validates worker identifiers and the page envelope;
the application still chooses which returned personal data it displays or stores.
Provider `href` values remain data and are never followed automatically. No
operation accepts an alternate host, tenant or token endpoint. The absence reads
require an explicit worker ID; the app must authorize that selection and Workday
still applies the connected user's permissions.

The confidential client defaults to `client_secret_post`; the optional registration
setting `tokenEndpointAuthMethod: "client_secret_basic"` selects HTTP Basic.
State is random, time-limited, one-use and bound to owner, configuration and
callback. Provider metadata alone cannot switch that attempt to another flow.
When Workday supplies an expiry, the core refreshes before expiry and retains
rotated refresh tokens. Without expiry metadata, a later HTTP 401 requires
reconnection; this fragment does not guess a tenant session lifetime. HTTP 403
reports missing Workday access, 429 rate limiting, and provider failures expose
sanitized errors. Cancellation consumes only the pending attempt. Local
disconnect removes local credentials; revoke the client/grant in Workday when
provider-side revocation is required.

This implements data connections, not application login, shared ISU access,
Workday Extend, Agent Gateway, Live Data Query, SOAP, custom report creation, payroll
updates, employment changes, bulk sync or automatic pagination.

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

Each Workday tenant administrator must register and approve the application's
client. There is no universal credential that accesses arbitrary customer tenants.
Separate clients can separate credentials and revocation within a tenant; their
names alone do not split tenant API capacity, licensing or rate limits. Keep
sandbox and production credentials and grants separate.

## What AI can provision

AI can generate and validate this file, compose existing JSKIT APIs, explain
functional-area/domain requirements and prepare project-specific production/sandbox
client names and callback values. With explicitly authorized browser access, it may
assist an administrator through the visible Workday tasks. A general public API
for creating these tenant OAuth clients has not been established by this packet;
do not promise autonomous registration, licensing or security-policy activation.
An authorized administrator owns tenant access, consent and policy decisions.

## Evidence and testing boundary

- [Workday REST API fundamentals](https://developer.workday.com/documentation/GUID-85810465-bcfb-4fdf-a26d-55eaff3968a8-enHYPHENus/) documents tenant base paths, paging and worker identifiers.
- [Workday REST API security](https://developer.workday.com/documentation/dan1370797986071/) distinguishes REST Report/Task policies from SOAP permissions.
- [Official Staffing v7 specification](https://community.workday.com/sites/default/files/file-hosting/restapi/staffing_v7_20260905_oas2.json) defines the implemented worker endpoints and functional areas.
- [Workday's tenant token exchange example](https://doc.workday.com/admin-guide/en-us/workday-ai/agents/external-agents/register-and-define-your-agent-through-an-api.html) documents the `/ccx/oauth2/{tenant}/token` client-secret exchange; its ASOR operations are not implemented here.
- [Workday OAuth client setup example](https://doc.workday.com/peakon/en-us/workday-peakon-employee-voice/integrations/workday-integration/nfa1667304944189.html) describes tenant OAuth enablement and registration.
- [Lovable's Workday setup](https://docs.lovable.dev/integrations/workday) documents the captured per-user fields and non-PKCE confidential registration.

Protocol, storage, ownership, validation and editor tests use controlled fixtures.
No live Workday account, administrator task, provider consent or generated app is
part of this proof. The host application must still compose its authentication,
callback and connection screens using its framework; saving the editor form does
not generate or run those screens.

## Organization directory and reporting relationships

`organizations.list` accepts `limit`, `offset` and `includeInactive` and returns
one native `{ data, total }` page. `organizations.get({ id })` reads one
supervisory organization. `organizations.members({ id, limit, offset })` returns
member job data; `organizations.orgChart({ id, limit, offset })` returns superior
and subordinate organization relationships. No recursive tree traversal occurs.
The app owns rendering the directory/chart and requesting additional pages.

Use a returned Workday ID or `Organization_Reference_ID=value`. Identifiers are
encoded as a single path segment. All requests retain the configured API host,
prefix and tenant, using `/api/staffing/v7/{tenant}/supervisoryOrganizations`.
The connected person's grant is used; the adapter never switches to an ISU or
administrator account when permission is denied.

In Register API Client, enable **Organizations and Roles** in functional areas.
Organization list/details require a permitted domain such as **View: Supervisory
Organization**; members and org chart require **Reports: Organization**. Ask the
tenant security administrator to assign suitable Report/Task permissions and
activate approved changes. A successful workers.me connection check is not an
organization authorization check. A 403 must be shown as missing access.

Other frameworks call these same GET routes with the app user's bearer token,
validate the page envelope, preserve returned relationships and perform their
own application authorization. Provider links in results are data, not a reason
to forward credentials to another host. The operation contract is documented in
[Staffing v7](https://community.workday.com/sites/default/files/file-hosting/restapi/staffing_v7_20260912_oas2.json).

## Time-off balances and entries

Enable **Time Off and Leave** in the tenant client's functional areas. The
security administrator grants the appropriate **Self-Service: Time Off Balances**
and **Self-Service: Time Off** domains, or the corresponding **Worker Data: Time
Off** domains for the intended role. Activate approved Report/Task security
changes. Worker or organization access does not establish absence access.

- `timeOff.balances({ worker, effective, category, limit, offset })` reads
  `/api/absenceManagement/v5/{tenant}/balances`. `worker` is required: use a
  returned 32-character Workday worker ID, including the ID from `workers.me`.
  `effective` is an optional YYYY-MM-DD date; category is an optional returned
  Workday ID. Quantities retain their native units; do not assume days or hours.
- `timeOff.details({ worker, fromDate, toDate, status, timeOffType, limit, offset })`
  reads `/workers/{worker}/timeOffDetails` under that absence base. Optional date
  bounds must be valid and ordered. Status/type filters contain Workday IDs,
  encoded as repeated query parameters. No comma-joined filter or guessed status
  label is sent. Limits are 20 statuses and 100 time-off types.
- `timeOff.statuses()` reads `/values/timeOff/status/`. Use its returned IDs for
  status filters. Workday omits canceled/denied entries from the details endpoint;
  status filters can select a historical version of a corrected entry. Do not
  present these results as a complete audit history.

Paged reads use limit 1–100 and offset, preserving native `{ data, total }`.
The application decides whether to request another page, renders status/units
and authorizes the selected worker. Requests always use the connected user's
grant and configured tenant; Workday enforces its own data access. These are
reads only, with no submission, approval, cancellation or balance adjustment.
Other frameworks use the same bearer-token routes and repeated query encoding.
See the official [Absence Management v5 contract](https://community.workday.com/sites/default/files/file-hosting/restapi/absenceManagement_v5_20260912_oas2.json).

## Tenant-owned custom reports

`reports.read({ owner, report, prompts })` reads a RaaS JSON report at the configured
API host's `/ccx/service/customreport2/{tenant}/{owner}/{report}` path. It uses
the current app user's bearer token; it never acquires the report owner's grant.
The report owner identifies the report location, not the identity executing it.

For RaaS, select **Tenant Non-Configurable** and **Include Workday Owned Scope**
on the API client, in addition to the functional areas for the report's data.
The tenant administrator must also authorize report execution and its underlying
data for the intended users. This does not replace report sharing or widen a
user's own access. Reconnect after changing the client permissions.

The report owner enables the custom report as a web service and shares access
with the intended users. In its related actions, choose **Web Services → View
URLs**, supply required prompts and copy the JSON output URL. Confirm its host
and tenant match the configured connection. Pass its decoded owner and report
name as input (spaces in report names are normally underscores). This operation
supports the tenant RaaS path above; an Extend API gateway URL is not interchangeable.
Do not change credentials or silently follow a different host to make a report run.

Each prompt is `{ name, value }`, using the report's **Label for Prompt XML Alias**,
not a guessed application field. For instance prompts, use a name ending `!WID`;
join multiple WIDs in its value with `!`. The adapter encodes query values and
fixes format to JSON. Each alias is supplied once. Limits are 50 prompts, 4096
characters per value and a 16384-character request URL.

The result preserves the native `Report_Entry` objects and any result/facet
metadata. Column meanings, required prompts and filtering belong to the report
and application. There is no universal report schema or automatic pagination;
large reports must be bounded through the report's own filters and the runtime's
response limit. An empty Report_Entry array is valid. Missing access, incompatible
report output and provider failures remain errors, never empty successful reports.

The app authorizes which reports/prompts a visitor may request. Workday also
checks the user's report/data permissions and tenant OAuth policy; a worker probe
cannot certify RaaS access. This has controlled request/response proof, not live
tenant OAuth interoperability proof. Other frameworks use the same HTTPS GET,
user token, prompt encoding and report-defined schema. Report creation, Basic/ISU
fallback, CSV/XML output and asynchronous report execution are not implemented.

References: [Workday RaaS output and prompts](https://doc.workday.com/admin-guide/en-us/reporting-and-analytics/custom-reports-and-analytics/reports-as-a-service-raas-/dan1370797813643.html),
[RaaS report enablement](https://doc.workday.com/admin-guide/en-us/reporting-and-analytics/custom-reports-and-analytics/reports-as-a-service-raas-/dan1370796320263.html),
[official JSON report example](https://developer.workday.com/documentation/rpv1519338225087),
and [Microsoft's tenant RaaS setup example](https://learn.microsoft.com/en-us/viva/learning/workday-create-raas-report).

The [OpenAI Workday integration example](https://github.com/openai/openai-cookbook/blob/main/examples/chatgpt/gpt_actions_library/gpt_action_workday.md)
documents these OAuth functional-area settings and a RaaS report evaluated as
the authenticated user. It supports the registration guidance; the operation
schemas here follow the Workday contracts above, not its illustrative schema.
