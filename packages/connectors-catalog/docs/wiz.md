# Wiz source scanning

Wiz is a project source scanner. Its initial runtime runs an installed Wiz v1 CLI
against a host-authorised directory and returns a policy verdict plus the report.
It works independently of application generation, an editor database or a managed
gateway. It does not connect each application's customer to a personal Wiz account.

## Configuration shared by the CLI and editor

```json
{
  "schemaVersion": 1,
  "registrations": {
    "wiz-own": {
      "source": "own",
      "grantType": "client_credentials",
      "clientId": "your-wiz-service-account-id",
      "clientSecretRef": "env:WIZ_CLIENT_SECRET"
    }
  },
  "integrations": {
    "security": {
      "provider": "wiz",
      "displayName": "Workspace source scan",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "oauth2", "registrationRef": "wiz-own" },
      "settings": {
        "tokenUrl": "https://auth.app.wiz.io/oauth/token",
        "byPolicyHits": "BLOCK"
      }
    }
  }
}
```

The optional `settings.policies` string contains comma-separated policy names.
Omit it to use tenant defaults. `byPolicyHits` accepts `BLOCK`, `AUDIT` or
`DISABLED`. It controls reported findings, not whether a blocking verdict passes.
The form stores the display name, service-account ID, secret reference, endpoint,
policy names and findings filter in ordinary JSON. It also preserves the captured
Auth0 endpoint `https://auth.wiz.io/oauth/token`, but execution in that mode
explicitly fails: a compatible CLI authentication mapping has not been verified.
No arbitrary token URL is accepted or silently substituted.

## Manual provider setup

1. Sign into your [Wiz portal](https://app.wiz.io/) with permission to create a
   service account. Open **Settings → Access Management → Service Accounts**;
   some portal layouts show **Service Accounts** directly under Settings.
2. Select **Add Service Account**. Enter a meaningful name and select the Wiz
   projects this account is allowed to scan. Use the account type approved by
   your Wiz administrator for CLI scanning.
3. Grant `create:security_scans`. Add `read:scan_policies` if the operator needs
   to inspect the relevant policies. These are permissions on the Wiz account;
   the empty local `scopes` array does not grant them.
4. Create the account, copy its **Client ID** and **Client Secret** from the
   credential dialog, then finish. Store the secret value in the worker's
   environment; put only its reference in source.
5. Confirm the tenant token endpoint with your Wiz administrator. Select Cognito
   in this runtime. An Auth0 tenant needs the remaining compatible-runner work.
6. Ask the administrator for any existing CI/CD policy names that must apply.
   Enter those names exactly, separated by commas, or leave the field blank.
7. Install an approved Wiz v1 CLI on a Linux/macOS scan worker. Use its absolute
   executable path in host configuration. This library never downloads a binary
   or installs scanner dependencies while handling a scan request.
8. Save the JSON through the CLI or editor. Compose the scanner below and invoke
   a scan explicitly. Saving the form does not verify credentials or start scans.

Portal credential navigation is documented in the
[ServiceNow Wiz setup guide](https://www.servicenow.com/docs/r/servicenow-platform/service-graph-connectors/sgc-cmdb-wiz-setup.html).
Use the scanner permissions above, rather than that integration's inventory-read
permissions. Wiz's own [Azure extension](https://marketplace.visualstudio.com/items?itemName=WizCloud.wiz-task)
documents the CLI service-account permissions. Tenant-specific documentation and
entitlements still require a Wiz login.

## Runtime and ownership

Import `createWizScanner` from `@jskit-ai/connectors-catalog/server/wiz`. It is a
separate runtime; do not pass its definition to `createConnectionService` and
manufacture an HTTP Connected receipt.

```js
const scanner = createWizScanner({
  configuration,
  executable: installedWizCliPath,
  authorize,
  resolveReference,
  resolveScanTarget,
  timeoutMs: 600_000
});
const result = await scanner.scan({ context, integrationId: "security", signal });
```

The host's `authorize(context, request)` checks `source.scan` access and returns
trusted `applicationId` and `subjectId`. Rejecting returns no identity. Those IDs
must come from the CLI's established local authority or the server's authenticated
workspace/project policy, never from browser assertions.

`resolveScanTarget(owner, { integrationId, signal })` then supplies
`{ directory, revision }`: an absolute directory containing an immutable snapshot
and its revision identifier. The returned result retains this revision so the host
can mark findings stale after source changes. Creating and releasing the snapshot
belongs to the host. Symlink access, source mounts, outbound networking, disk and
resource limits belong to that worker's sandbox; a realpath check is not a sandbox.

`resolveReference(reference, owner)` retrieves the client secret. A scan resolves
it again, so rotation does not require a persisted token grant. The CLI receives
the account ID and secret through its isolated environment, never command-line
arguments. It uses a private temporary HOME/cache and working directory, avoiding
implicit use of the project's `.wiz` configuration. Only host-supplied PATH,
proxy and CA variables may be added. The application/agent environment is not
copied into the child process.

The runtime's deadline and AbortSignal terminate the POSIX process group and wait
for process closure before deleting temporary state. Windows applications can
dispatch to a Linux scan worker; this initial runtime does not implement a native
Windows process-tree controller. The scanner may contact Wiz and publish findings
to its portal. Running it is therefore a deliberate provider operation, not local
configuration validation. Cancellation does not retract already submitted data.

The returned value contains `provider`, `integrationId`, `revision`, `policyStatus`
and `report`. `policyStatus` is `passed`, `warning` or `blocked`; these describe Wiz
policy results, not a claim that the source is vulnerability-free. The report is
sensitive source/security data. Present only to authorised readers; escape report
text and validate any links before rendering. Raw CLI stdout/stderr are not exposed.

Authentication failure, runner failure, timeout and cancellation are errors.
A successful exit without a readable report, unsupported verdict, oversized
report, symlink output or inconsistent failure exit cannot produce a passed result.
The report limit defaults to 16 MiB, with a configurable maximum of 64 MiB.
There are no automatic retries. A new scan is a separate explicit operation.

## Application ownership and custom domains

**Provider callback: not applicable.** Service-account CLI authentication has no
browser redirect. Do not register `https://connect.vibe64.dev/oauth/wiz/callback`
or each customer's VPS/custom domain as a Wiz callback for this mode.

The application or scanning workflow owner supplies an authorized Wiz service
account scoped to the intended Wiz projects. Store its credentials in private
worker Env and enforce permission to scan the selected source directory. Public
Vibe64 and Online do not supply a universal scanning credential. The runtime
rejects managed registration assignments; there is no hosted universal scan
endpoint.

Separate service-account names or credentials do not prove independent scan
capacity, billing or tenant quotas. Establish the permitted service/tenant/project
arrangement with Wiz before promising isolation or offering scans for arbitrary
customers. The supported path today uses the customer's own Wiz account. An app's
custom domain does not alter that account or the worker's stable application ID.

Workspace connection availability and granting access to everyone are host-owned
policies. A project-local JSON slot does not automatically confer workspace-wide
access. Vibe64's workspace scanner orchestration, automatic scan inclusion,
findings display/aggregation, stale-result UI and connection removal propagation
remain unfinished. The initial editor surface edits the configuration only.

## Automation feasibility and proof

AI can author and validate the JSON, wire the runtime, prepare a worker command
and use an already authorised service account to scan. There is no verified public
API in this packet for creating Wiz tenants, obtaining a licence, or silently
provisioning the two platform service accounts. An operator must establish those
accounts and permissions. Any future provisioning automation should use the
tenant's documented API and a separately authorised administrative identity.

The command/report contract was checked against Wiz's own Azure extension 0.5.15
(v1 task) and the official Linux CLI v1.74.0-96726fc, built 7 September 2026.
The runner uses the extension's `--assist-migration` report mode; CLI help accepted
that flag and rejected a deliberately unknown flag. Tests use a controlled
executable to exercise real subprocess creation, flags, environment, file reports,
policy outcomes, ownership, credential rotation, cancellation and cleanup.
No provider scan, authentication, real tenant or generated application was run.
Live compatibility, actual permissions/policies and portal delivery still need
an authorised Wiz account. Auth0 and host workspace workflows
remain open.
