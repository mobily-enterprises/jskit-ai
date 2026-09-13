# GitLab API

Import `gitlabApiProvider` from `@jskit-ai/connectors-catalog/server/gitlab-api`.
This fragment supports access tokens and confidential OAuth using a configured
HTTPS GitLab origin (GitLab.com by default). CI job tokens, subpath installations
and DPoP proof generation are not implemented. Configuration and connection
screens were reviewed with simulated setup responses; no live GitLab access
or generated application was used.

## Configure an access token

Set **Instance URL** to the HTTPS origin of the trusted GitLab server that issued
the token; leave `https://gitlab.com` for GitLab.com. This destination receives
the credential. Do not include a path, query, fragment or URL credentials.

1. On that GitLab instance, open your avatar and choose **Edit profile**.
2. Select **Access → Personal access tokens → Generate token → Legacy token**.
3. Enter a name, optional description and expiration date. Select `read_api`
   for projects and `read_user` for the profile verifier.
4. Generate the token and copy it while visible. Save it in backend Env as
   `GITLAB_API_KEY`.
5. Save provider `gitlab-api`, mode `shared` or `assistant`, `scopes: []`, and
   authentication `{ "method": "api-key", "secretRef": "env:GITLAB_API_KEY" }`.
6. Verify with `connectApiKey`. Rotate or revoke through the token list's menu;
   update Env when rotating. [Token instructions](https://docs.gitlab.com/user/profile/personal_access_tokens/),
   [scope meanings](https://docs.gitlab.com/security/tokens/access_token_scopes/).

## Runtime and AI composition

The API origin comes from `settings.instanceUrl`, defaulting to
`https://gitlab.com`. Token requests use `PRIVATE-TOKEN`; OAuth uses Bearer.
`profile.read` calls `/api/v4/user`. `projects.list` calls `/api/v4/projects`
with `per_page` (1–100, default 20), `page` (starting at 1), and fixed true
`membership` and `simple` flags. It returns a compact array of member projects.
Continue numbered pages until a short/empty page. This fragment does not expose
response pagination headers or support traversing beyond the provider's offset
pagination ceiling. [Projects API](https://docs.gitlab.com/api/projects/).

Compose the [API-key pattern](../patterns/api-key-connection/PATTERN.md); no
Git repository clone or application generation is required. Files hold portable
configuration and private runtime metadata separately.

## Automation and application registrations

An AI can prepare a token-creation URL with name, description and scopes already
filled; the user still creates the personal token. GitLab documents administrator
token provisioning for self-managed systems and separate service-account token
APIs, but those privileges must not be inferred for ordinary GitLab.com users.
The setup guide above links these supported alternatives.

The application owner supplies its authorized personal key through private Env.
Two keys owned by one user do not establish separate capacity. OAuth registration
is another credential mode. Tests cover profile validation, restricted project
queries, pagination, file persistence, rotation, isolation and provider errors.
## Configure OAuth

1. Set **Instance URL** to your trusted GitLab HTTPS origin. On that same
   instance, open `/user_settings/applications` to register an application.
2. Give it a recognizable name, keep **Confidential** selected, and register
   the exact **Suggested callback URL** shown for this project. Choose
   `read_user` and `read_api` for this fragment's profile and project reads.
   [GitLab application registration](https://docs.gitlab.com/integration/oauth_provider/).
3. Select **OAuth** in the connector form. Copy the registration's Application
   ID into **Client ID**. Keep the secret and callback as Env references;
   save configuration, then use **Set credential in Env** for the secret
   and callback values. The callback value must equal the registered URL.
4. Choose **One shared account** for a project business account, or
   **Each app user's own account** when individuals authorize their own access.
   Shared setup uses **Connect account** after the app backend is running.
   Per-user setup requires the application's own authenticated connection screen;
   the editor does not connect all users on their behalf.
5. The app implements the callback with the shared
   [OAuth connection pattern](../patterns/oauth-connection/PATTERN.md), binds it
   to its authenticated user and completes the original attempt. Its backend
   owns the tokens and refresh lifecycle. Laravel uses its own framework;
   this JavaScript runtime does not introduce a Vibe64 dependency.
6. Verify the profile. After changing the instance, client or callback,
   reconnect. **Disconnect** removes the local connection; revoke the grant
   in GitLab as well when provider-side revocation is intended.

Refresh includes the original redirect URI and uses the shared runtime's token
rotation. Changing `settings.instanceUrl` invalidates the existing connection
before credentials can be sent to the new origin. OAuth grant handling is
separate from the editor's Git repository authentication.

## Project content and collaboration

All targeted operations take `project`: a numeric ID as a string or full
`group/subgroup/project` path. The entire path is URL-encoded as one project
identifier. The app must authorize this target for its caller before using a
shared connection. Item `iid` is the issue/MR's project-local number, not its
global `id`.

| Operation | Additional inputs |
|---|---|
| `projects.get` | None; full project metadata |
| `branches.list`, `commits.list`, `pipelines.list` | `page`, `per_page` |
| `files.get` | `filePath`, `ref` (branch/tag/commit); base64 file envelope |
| `issues.list` | Pagination, opened/closed/all `state`, optional `search` |
| `mergeRequests.list` | Pagination, opened/closed/merged/all `state` |
| `issues.get`, `mergeRequests.get` | `iid`; full content |
| `issues.notes`, `mergeRequests.notes` | `iid` and pagination; comments |
| `issues.create` | `title`, optional `description` |
| `mergeRequests.create` | `title`, `source_branch`, `target_branch`, optional `description` |
| `issues.update`, `mergeRequests.update` | `iid`, at least one title/description/state_event (close/reopen) |

Reads use `read_api` and profile verification `read_user`. **Writes need `api`
and the appropriate project role**. Select that scope in OAuth and reconnect;
for a token, issue the appropriate token in GitLab and update private Env.
Local configuration cannot expand a token's provider permissions. No operation
writes during verification. Existing source/target branches are required for
MR creation; this connector does not create commits, merge or run pipelines.

```js
const issue = await connections.invoke({ context, integrationId: "gitlab",
  operation: "issues.create", input: { project: "team/feedback",
    title: "Booking feedback", description: "App-authorized feedback" } });
// Store issue.iid and web_url against the initiating app record.
```

Page size defaults to 20 and is bounded to 100. Continue until a short/empty
page, respecting the instance's offset limits. Decode files only with a supported
encoding and handle provider size limits. Treat Markdown as untrusted content.
A write may succeed before a network failure: no automatic replay occurs;
reconcile with the project's issue/MR list before retrying.

CLI users use the same configuration and Env with the optional Node runtime.
Other frameworks use native HTTP and their own grants against GitLab's
[issues](https://docs.gitlab.com/api/issues/),
[merge requests](https://docs.gitlab.com/api/merge_requests/) and
[repository files](https://docs.gitlab.com/api/repository_files/) APIs.

**LIMITATIONS:** no source synchronization, automatic merges, pipeline execution,
file writes or editor assistant attachment. CI tokens, DPoP and subpath instances
remain unsupported. Example: an app can create feedback issues and show MR
comments and pipeline status; it does not push its own code or start CI jobs.
Controlled tests cover content, writes and OAuth/token lifecycle; live GitLab
and generated-app execution remain untested.
