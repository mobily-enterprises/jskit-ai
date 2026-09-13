# Ashby

Import `ashbyProvider` from `@jskit-ai/connectors-catalog/server/ashby`.
This adapter verifies an organization key by reading jobs, preserves explicit
cursor/incremental sync, and supports candidate/application hiring workflows.

## Provider setup

1. Sign into the intended Ashby organization as an administrator. Open
   **Admin → Integrations → API Keys → + New**. Name the key, leave the
   optional integration partner unset unless applicable, then **Create API Key**.
2. Enable **Jobs: Read** (`jobsRead`) for verification. Add `candidatesRead`
   for candidate/application reads, `candidatesWrite` for edits and stage changes,
   `interviewsRead` for plans/stages and `hiringProcessMetadataRead` for archive
   reasons. Hover the module information icon to check its endpoint list. Leave
   confidential jobs/private fields and other extra permissions off unless needed.
   Choose **Save and Continue**. Copy the key before closing the wizard.
3. Copy the issued key into the backend environment as `ASHBY_API_KEY`.
   In Vibe64, add Ashby and enter `env:ASHBY_API_KEY` in **API key reference**.
   Save, choose **Set credential in Env** to enter the key, then **Connect account**
   or **Verify again**. **Check connection** reads status only. CLI uses the same
   file and `connectApiKey`. To revoke, open the key by name and choose **Disable**;
   disconnecting locally does not disable it. For rotation, create a replacement,
   update Env and verify before disabling the old key.

Ashby uses Basic authentication: key as username, empty password. Keys belong
on a server. This adapter sends `Accept: application/json; version=1`.
Missing credentials can return 401; invalid/deactivated keys and insufficient
permissions can both return 403.
[Authentication and permissions](https://developers.ashbyhq.com/reference/authentication),
[Key setup and disabling](https://docs.ashbyhq.com/how-do-i-generate-an-api-key).

## Configuration and library calls

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "hiring": {
      "provider": "ashby",
      "displayName": "Hiring jobs",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "api-key", "secretRef": "env:ASHBY_API_KEY" }
    }
  }
}
```

Use the [API-key composition pattern](../patterns/api-key-connection/PATTERN.md)
with `providers: [ashbyProvider]`, an authenticated application policy and the
file connection store. Portable configuration and durable runtime state remain
text files. The key is resolved from the environment for requests.

```js
await connections.connectApiKey({ context, integrationId: "hiring" });
const page = await connections.invoke({
  context, integrationId: "hiring", operation: "jobs.list",
  input: { limit: 25 }
});
```

`jobs.list` sends `POST /job.list`; this is a read despite the HTTP method.
The fragment accepts integer `limit` 1–100 (default 25) and optional opaque
`cursor` and `syncToken` strings, each up to 8192 characters. Positive page sizes
and token-length caps are local validation choices. It returns the original
`results`, `moreDataAvailable`, `nextCursor` and `syncToken` envelope.
Additional date/status filters and job writes are not implemented.
[Job listing](https://developers.ashbyhq.com/reference/joblist).

For a full scan, begin without a cursor or sync token. While
`moreDataAvailable` is true, explicitly request the next page with `nextCursor`.
Retain the final page's `syncToken` for a later incremental scan. During that
scan, send the same starting sync token alongside subsequent cursors; replace
the stored sync token only after the scan finishes. Ashby documents cursor
expiry after 14 days and may report errors in an HTTP-200 response.
[Pagination and incremental sync](https://developers.ashbyhq.com/docs/pagination-and-incremental-sync).

The application owns its synchronization checkpoint, scoped to the authorized
connection. This library does not silently reset it or traverse all pages.
`success: false` becomes a generic provider failure without exposing provider
error payloads. An expired cursor therefore needs explicit recovery by the
application. The common 403 classification is permission denied; it cannot
distinguish a deactivated key from missing permissions. Check the provider key
and reverify after correction. Disconnect removes local state; it does not
revoke the organization key.

## Automation and application ownership

An AI can write the configuration, environment reference, library wiring and
checkpoint logic. The reviewed API documents expose inspection of an existing
key, not a key-creation workflow. Initial organization access and key creation
remain administrator steps; do not invent an API for those steps.
[Current-key inspection](https://developers.ashbyhq.com/reference/apikeyinfo).

Each application uses an authorized key stored in its private Env. These keys
are not OAuth registrations and do not connect unrelated organizations.
Customer-owned data requires that customer's authorized key. The key guide documents a per-key request limit; it does not reserve independent
organization capacity or change licensed product access. Application owners
must arrange the capacity needed for their usage. No callback is used, so editor VM and deployed app
domains do not change this flow. A jobs result does not establish user login.

## Focused evidence

Simulated provider tests cover Basic headers, POST bodies, explicit paging,
empty results, invalid envelopes, HTTP-200 failures, input boundaries, real
temporary file-store restart, rotation, ownership and disconnect. Editor
automation verifies reference-only configuration and save/reload. Live provider
use, organization signup and sample-app generation are excluded.

## Recruiter workflow operations

All calls use the fixed `https://api.ashbyhq.com` origin, Basic key authentication
and POST JSON. Lists are reads despite POST. Responses retain Ashby's `success`
and `results` envelope; HTTP-200 `success: false` is a failure, not completion.

| Operation | Endpoint | Relevant inputs |
| --- | --- | --- |
| `jobs.get` | `job.info` | Job `id`. |
| `candidates.list` | `candidate.list` | `limit`, cursor, syncToken. |
| `candidates.get` | `candidate.info` | Candidate `id`. |
| `candidates.create` | `candidate.create` | Required `name`; optional email and phoneNumber. |
| `candidates.update` | `candidate.update` | `candidateId` and at least one name/email/phone change; notifications default off. |
| `applications.list` | `application.list` | Page inputs, optional `jobId` and Hired/Archived/Active/Lead status. |
| `applications.get` | `application.info` | `applicationId`. |
| `applications.create` | `application.create` | `candidateId`, `jobId`; optional interviewPlanId and interviewStageId. |
| `applications.changeStage` | `application.changeStage` | `applicationId`, `interviewStageId`; archiveReasonId for an Archived stage. |
| `interviewPlans.list` | `interviewPlan.list` | Page inputs, optional includeArchived (default false). |
| `interviewStages.list` | `interviewStage.list` | `interviewPlanId`. |
| `archiveReasons.list` | `archiveReason.list` | Optional includeArchived (default false). |

Use the same explicit cursor/checkpoint procedure for candidate, application and
interview-plan lists. Keep a separate checkpoint for each endpoint/filter/connection;
finish the scan before replacing it. Stage and archive-reason lists are unpaged.
UUID inputs come from provider records; names or display labels cannot replace IDs.

1. Select an authorized job and candidate. Create a candidate only after checking
   existing records to avoid accidental duplicates. Profile updates send only
   provided fields. They set `sendNotifications: false` by default; enabling it
   explicitly can notify users subscribed to that candidate.
2. Source that candidate into the selected job with `applications.create`.
   This is a recruiter action. A public careers form uses Ashby's separate
   `applicationForm.submit` API and its form requirements, not this shortcut.
3. Read the application's interview plan; list published plans/stages if needed.
   Choose a stage from the job's actual plan, not one with a similar name in
   another plan. The provider rejects invalid plan/stage combinations.
4. After application authorization and confirmation, call `applications.changeStage`.
   For an Archived stage, choose an active reason from `archiveReasons.list` and
   send its ID. This adapter does not accept `archiveEmail` or send an archive
   message. Read the application again to show the resulting stage/status.
5. Persist returned IDs. If a creation/stage change times out, inspect Ashby before
   retrying; the adapter makes one attempt and cannot prove a lost response means
   nothing happened. HTTP-200 provider errors and 403/429 remain visible failures.

```js
const application = await connections.invoke({ context, integrationId: "hiring",
  operation: "applications.create", input: { candidateId, jobId } });
// After an authorized recruiter chooses a stage from this application's plan:
await connections.invoke({ context, integrationId: "hiring",
  operation: "applications.changeStage",
  input: { applicationId: application.results.id, interviewStageId } });
```

The generated application owns recruiter authorization, job/candidate visibility,
consent to changes and UI. The organization API key is not a tenant/user identity.
The optional Node runtime works without Vibe64 using the same JSON and Env
reference. Other frameworks can use their own HTTP client for these documented
endpoints, preserving the same ownership and connection configuration.

Sources: [candidates](https://developers.ashbyhq.com/reference/candidatelist),
[create candidate](https://developers.ashbyhq.com/reference/candidatecreate),
[update candidate](https://developers.ashbyhq.com/reference/candidateupdate),
[applications](https://developers.ashbyhq.com/reference/applicationlist),
[source candidate](https://developers.ashbyhq.com/reference/applicationcreate),
[change stage](https://developers.ashbyhq.com/reference/applicationchangestage),
[plans](https://developers.ashbyhq.com/reference/interviewplanlist),
[stages](https://developers.ashbyhq.com/reference/interviewstagelist),
[archive reasons](https://developers.ashbyhq.com/reference/archivereasonlist-1).

## Limitations

Editor coding-assistant attachment is deferred. For example, a generated hiring
app can display candidates and advance a recruiter-selected application, but
asking Vibe64's assistant to inspect your candidates does not give it access.
The app owns its hiring screens and policies. Public careers forms, scheduling,
offer management, file upload, messages and custom fields are not supplied here.
Live hiring changes, real credentials and generated-app execution were not tested.
