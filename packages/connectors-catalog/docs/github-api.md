# GitHub API

Import `githubApiProvider` from `@jskit-ai/connectors-catalog/server/github-api`.
This GitHub.com adapter supports personal access tokens (PAT) and an
application-owned OAuth app. GitHub App installation tokens and Enterprise
Server hosts are not implemented here. It does not replace the editor's repository login.

## Set up access

1. Open your GitHub **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens**.
2. Choose **Generate new token**. Enter its name, expiration, and resource owner.
3. Select the repositories the application needs. Metadata read access covers
   the repository-list operation. Add Contents read for file/commit/release access, Actions read for workflow runs, Issues read/write and Pull requests read/write only as needed for the app operations.
4. Complete any organization approval or account verification. A pending token
   may identify its user without accessing the intended private repositories.
5. Generate/copy the token, then keep it outside source as `GITHUB_API_KEY`.
   Configure provider `github-api`, account mode `shared` or `assistant`, empty
   `scopes`, and the `api-key` secret reference `env:GITHUB_API_KEY`.
6. Call `connectApiKey`, then list repositories to check the intended access.
   See [GitHub PAT management](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

## Runtime and AI composition

`account.read` calls `GET /user`. `repositories.list` calls `GET /user/repos`
with `per_page` (1–100, default 30), `page` (starting at 1), `sort` and `direction`.
The caller advances the page number. The library returns the response array;
it does not expose the HTTP Link header. A short page indicates completion;
a full final page can be followed by an empty one.

Requests use Bearer authentication, a User-Agent, GitHub's JSON media type and
API version `2026-03-10`. See [Authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
and [Repositories](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user).
Apply the [API-key source pattern](../patterns/api-key-connection/PATTERN.md)
with this provider. The application supplies its own repository-access policy.

## Provisioning automation and capacity

An AI can prepare token settings and library configuration, then use approved
API access. Ordinary PAT issuance remains a console action in this guide; no
automated equivalent was verified. A GitHub App manifest is a different future
registration flow and must not be described as an installed PAT feature.

Two PATs issued by one user share relevant user limits. The application owner
supplies its authorized PAT through private Env; separate tokens or application
names do not create independent capacity. GitHub Apps are a separate option for
installation-based distribution, requiring their own adapter and permissions.

Tests use simulated API responses and real temporary runtime files to verify
headers, paging, restart, rotation, disconnect and owner isolation.

## OAuth setup

Open GitHub Settings > Developer settings > OAuth Apps > New OAuth App. Set the
name and application homepage, and copy Vibe64's Suggested callback URL into
Authorization callback URL. Register the app, copy Client ID, and generate a
client secret. Save configuration and follow the Env links for client secret
and callback references. The application owns the callback route and grants.
Use shared ownership for an administrator connection or per-user ownership for
connections started inside each application's account screen. This connects API
access; the framework still owns application login and account linking.

The captured scope choices are available; request only required permissions.
Optional offline_access requests expiring access with refresh credentials on
GitHub.com. The adapter normalizes comma-separated returned scopes without
changing authorization-request scope formatting. OAuth API requests retain the
same GitHub headers as PAT requests. Disconnect is local; revoke authorization
in GitHub separately. The app's OAuth registration, secret and provider quotas
are not supplied by Vibe64.

Focused OAuth fixtures cover confidential S256 exchange, cancellation,
denial, replay, refresh rotation, file restart, PAT coexistence, per-user and
application isolation, non-expiring grants and malformed scope responses.
Controlled editor review covers OAuth/PAT switching, connection controls and
the per-user setup boundary. No live GitHub consent or generated app was tested.

## Repository and collaboration operations

All targeted operations require `owner` and `repo`. The application authorizes
these values against its allowed repositories before invoking the shared
connection; a valid shared token alone must not authorize an arbitrary visitor.

| Operation | Additional inputs and result |
|---|---|
| `repositories.get` | Repository metadata |
| `branches.list`, `commits.list`, `releases.list` | `page`, `per_page`; arrays |
| `workflows.runs` | Pagination; workflow_runs and total_count |
| `contents.get` | Repository-relative `path`, optional branch/tag/commit `ref`; file envelope or directory entries |
| `issues.list`, `pulls.list` | Pagination and open/closed/all `state` |
| `issues.get`, `pulls.get` | `number`; full issue/PR including body/state |
| `issues.comments`, `pulls.reviews` | `number` and pagination; comments/review states |
| `issues.create` | `title`, optional `body`; created issue |
| `issues.update`, `pulls.update` | `number` and at least one of title/body/state |
| `pulls.create` | title/head/base, optional body/draft; created PR |

Page size is 1–100, default 30. Follow pages until a short/empty result. GitHub's
issue list also includes pull requests: filter entries with `pull_request` if
the app wants issues only. PR head/base refer to existing branches; this does
not create commits or synchronize code. Creation is not retried automatically
on uncertain network outcomes; reconcile against the repository before retrying.

Small file content is returned in GitHub's base64 envelope. Decode only when
`encoding === "base64"`; large files may have unavailable content, and directory
listing has provider limits. Do not blindly fetch a returned download URL with
the account token. Display unavailable/large-file state or use the native GitHub
file/media API with the correct resource policy. Never treat Markdown as trusted
HTML. Review and workflow status are provider data, not proof it is safe to merge.

```js
const issue = await connections.invoke({ context, integrationId: "github",
  operation: "issues.create", input: { owner: "my-org", repo: "feedback",
    title: "Booking feedback", body: "The app-authorized feedback text" } });
// Persist issue.number/html_url with the originating app record.
```

CLI users use the same JSON, Env and optional Node provider. Other frameworks
use native HTTP with their OAuth grant/PAT against the documented
[issues](https://docs.github.com/en/rest/issues/issues),
[pulls](https://docs.github.com/en/rest/pulls/pulls),
[contents](https://docs.github.com/en/rest/repos/contents) and
[workflow runs](https://docs.github.com/en/rest/actions/workflow-runs) endpoints.
OAuth `repo` covers private repository operations; `public_repo` can cover
public-only writes. Fine-grained PAT permissions are configured in GitHub,
not granted by an empty local scopes array. Account verification alone does
not establish access to a selected repository.

**LIMITATIONS:** no GitHub App installation flow, Enterprise Server API host,
repository synchronization, automatic merges or editor assistant attachment.
Example: the generated app can create a feedback issue and show PR review
status; adding this connector does not sync the app's source or let the editor
assistant inspect GitHub. Branch creation, file writes and workflow dispatch
remain native app operations beyond this subset. Existing OAuth/PAT UI and
private configuration are shared across these operations.
