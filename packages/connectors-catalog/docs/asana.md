# Asana

Import `asanaProvider` from `@jskit-ai/connectors-catalog/server/asana`.
This adapter discovers workspaces/projects/tasks and creates or updates projects
and tasks through a personal access token.

## Configure access

1. Sign into the intended Asana account and open the developer console. The
   official developer guide links it under **My apps**.
2. Create a personal access token and provide a description identifying this
   application. Copy the generated token while available.
3. Store it in backend Env as `ASANA_TOKEN`. Treat it as opaque; there is no
   local prefix/length assumption about Asana's token format.
4. Save provider `asana`, mode `shared` or `assistant`, `scopes: []`, and
   authentication `{ "method": "api-key", "secretRef": "env:ASANA_TOKEN" }`.
5. In Vibe64 use **Set credential in Env** to save the token, then
   **Connect account** or **Verify again**. **Check connection** only reads
   status. CLI applications verify with `connectApiKey`. Manage/deauthorize personal tokens from the
   developer console. Organization policy can limit personal-token access.
   [Token instructions](https://developers.asana.com/docs/personal-access-token).

## Runtime and AI composition

`workspaces.list` calls `GET https://app.asana.com/api/1.0/workspaces` using
Bearer authorization. It accepts `limit` (1–100, default 50) and optional
`offset`. Results contain compact workspace records under `data` and may
include `next_page.offset`; pass that opaque offset to request another page.
The verifier uses this list operation. If extended to OAuth, this endpoint's
documented read scope is `workspaces:read`.
[Workspace endpoint](https://developers.asana.com/reference/getworkspaces).

The [API-key pattern](../patterns/api-key-connection/PATTERN.md) supplies the
same portable JSON and server library wiring for CLI and editor consumers.
The backend owns whether its users may access the shared account's workspaces.

## Automation and application registrations

An AI can prepare the configuration and runtime calls after a token is supplied.
The verified personal-token creation path is the developer console; no API that
creates the initial personal token was established in this pass. Asana recommends
OAuth for applications acting for other users. That application-registration and
consent flow remains separate from this personal-token fragment.

Each application supplies its owner's token. Differently named personal tokens
may still share workspace/user limits. Apps requiring individual user consent
must implement the supported OAuth flow with their own registration.
Automated fixtures cover authorization headers, pagination, file-store restart,
credential replacement, cross-application isolation, disconnect and controlled
provider failures. No workspace was accessed with a real token.

## Project and task workflow

The adapter uses these documented endpoints with Bearer authentication and
`{ data: ... }` JSON for writes. A successful list of workspaces proves neither
write permission nor access to every private project. Your backend authorizer
must enforce who may invoke each operation for the shared account.

| Operation | Required inputs and result |
| --- | --- |
| `projects.list` | `workspace`, optional `archived`, `limit`, opaque `offset`; returns project records. |
| `projects.get` | Project `gid`; includes name, notes, owner, privacy, archive and dates. |
| `projects.create` | `workspace`, `name`, explicit `privacy_setting` (`private` or `public_to_workspace`); optional owner, notes and dates. |
| `projects.update` | Project `gid` and only changed fields; supports archive/unarchive. |
| `users.list` / `teams.list` | `workspace`, page inputs; identifiers for assignment/sharing. Teams apply to organization workspaces. |
| `projectMembers.add` | `project`, `member` (team or user GID), explicit `access_level` (`admin`, `editor`, `commenter`). |
| `tasks.list` | `project`, page inputs, optional `completed_since` (date-time or `now` for incomplete tasks). |
| `tasks.get` | Task `gid`; includes assignment, completion, due/start dates, notes and project IDs. |
| `tasks.create` | `workspace`, `name`; optional `projects` GIDs, parent task, assignee GID, notes, dates and completed flag. |
| `tasks.update` | Task `gid` plus changed work-tracking fields; omitted fields are not overwritten. |

1. Choose a workspace from `workspaces.list` and a project from `projects.list`,
   or explicitly create a project with the desired privacy setting. Persist its
   returned `data.gid` before granting membership. Organization policy may deny
   a privacy level or sharing action. If sharing fails after creation, show the
   existing project and retry only the intended sharing action after resolution.
2. For team sharing, use `teams.list` and `projectMembers.add` after the user
   confirms the member and access level. The old project `team` argument and
   `private_to_team` setting are deprecated; this adapter uses the documented
   membership endpoint and `access_level`, not the deprecated membership `role`.
3. Choose an assignee using `users.list`, then create a task in the workspace
   and selected project. This adapter accepts user GIDs for assignment; use null
   to unassign. Persist the returned task GID for subsequent changes.
4. Change only the intended fields. `completed: true` completes a task; false
   reopens it. Empty notes clear the description. Null dates clear dates. When
   sending `start_on`, also send `due_on`; dates must be real `YYYY-MM-DD` values.
   Project start must precede its due date; task start cannot follow its due date.
   A task's workspace cannot change. The creation-only `projects` list is not
   accepted by task update; native addProject/removeProject APIs handle moves.
5. Request each next page using `next_page.offset`, not a returned URL. Read/list
   operations request the task/project fields used for work tracking rather than
   relying on Asana's compact default response. Stop when `next_page` is null.

```js
const created = await connections.invoke({ context, integrationId: "work",
  operation: "tasks.create", input: { workspace: workspaceGid,
    projects: [projectGid], name: "Review release", assignee: ownerGid,
    due_on: "2026-12-31" } });
await connections.invoke({ context, integrationId: "work", operation: "tasks.update",
  input: { gid: created.data.gid, completed: true } });
```

A lost create response has an uncertain outcome. Inspect the project/task list
before retrying; the adapter does not replay writes. Display permission failures,
missing resources, invalid values and rate limits distinctly in the application.
The same ordinary Node library works in CLI-built applications without Vibe64;
other frameworks read the configuration/Env reference and use their native HTTP
client for these endpoints. No Vibe64 server is needed at application runtime.

Sources: [projects](https://developers.asana.com/reference/getprojects),
[create project](https://developers.asana.com/reference/createproject),
[update project](https://developers.asana.com/reference/updateproject),
[membership](https://developers.asana.com/reference/createmembership),
[project tasks](https://developers.asana.com/reference/gettasksforproject),
[create task](https://developers.asana.com/reference/createtask),
[update task](https://developers.asana.com/reference/updatetask),
[official request/response schemas](https://github.com/Asana/openapi/blob/master/defs/asana_oas.yaml).

## Limitations

Editor coding-assistant attachment is deferred. For example, a generated app can
create a release project, assign a task and mark it complete, but asking Vibe64's
coding assistant to inspect your Asana backlog does not give it this connection.
The app owns its work-tracking screens and resource permissions. OAuth user consent,
attachments, comments, custom fields, task moves and destructive deletion are not
implemented here. Live Asana access and generated-app execution were not exercised.
