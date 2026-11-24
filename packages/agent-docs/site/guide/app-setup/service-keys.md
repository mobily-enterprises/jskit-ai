# Service keys (local auth)

A service key lets another application's server, such as an assistant that
works for the people of a household or a team, call this app's bearer routes
(the [MCP endpoint](/guide/app-extras/assistant#mcp-endpoint) among them) as one
of the app's users at a time. Each call names the user it acts as and runs with
exactly that user's rights: what they may see and do, in their workspaces,
recorded as done by them through the key. The key never acts as itself, and no
person signs in anywhere for it.

## Making a key

A key belongs to a dedicated service user, an ordinary local auth account
(enabled, with no password anyone uses) whose display name names the key in
what the app records, such as "Mercbot (Smith home)". An administrator makes the
key with the app's own tooling, which writes one row of the sessions store:

```js
import { createServiceKeyRecord } from "@jskit-ai/auth-provider-local-core/server/lib/index";

const { key, record } = createServiceKeyRecord({ userId: serviceUser.id, days: 365 });
await backend.withTransaction((tx) => tx.sessions.create(record));
// Show `key` once: the store keeps only its hash.
```

`record` is a session with purpose `service-key` (`SERVICE_KEY_PURPOSE`),
lasting `days` whole days (365 unless given, at most 3650). No table or column
changes: a key is a row of the table local auth already keeps sessions in.
Revoking that row (`tx.sessions.revoke(record.id)`) ends the key from the next
call, and so does disabling the service user, which ends all its keys. A key
never signs in a browser: cookie authentication takes only ordinary sessions.

## Calling as a user

```http
POST /api/w/acme/mcp
Authorization: Bearer svk_…
Act-As-User: 42
Content-Type: application/json
```

`Act-As-User` names the user by id, or by email (any value with an `@`). An
email names a user only when exactly one enabled account has it: in an app
whose accounts may share an email, more than one enabled account with it names
no one, and the caller acts by the user's id instead. The MCP endpoint answers
the id it acted as in `Acting-As-User`, so a caller that started from an email
names the id from then on.

A backend answers every account with an email through
`users.findAllByEmail(email)`, the disabled ones too; one whose emails are
unique answers one or none. The file and database backends do; an app's own
backend adds it, and without it acting by email fails naming the fix.

Only routes that declare `config: { credentials: "bearer" }` take a key. Every
other route ignores `Authorization` and signs in by cookies alone, and a cookie
never signs in a bearer route, so a key never becomes a browser session and a
browser session never acts as anyone. A bearer route takes no CSRF token, since
it reads no cookies. The call's sign-in has no address and no second factor, so
a route that asks for either refuses it.

## Refusals

Each refusal says why, with its code, and none falls back to the key's own
service user:

| Status | Code | When |
| --- | --- | --- |
| 401 | `auth.serviceKey.required` | No `Authorization` header. |
| 401 | `auth.serviceKey.invalid` | The key is unknown, revoked or expired, or its service user is disabled. |
| 403 | `auth.serviceKey.notServiceKey` | A person's own sign-in token instead of a key. |
| 400 | `auth.serviceKey.actAsRequired` | No `Act-As-User`. |
| 403 | `auth.serviceKey.actAsUnknown` | No user has that id or email. |
| 403 | `auth.serviceKey.actAsInactive` | That user is disabled. |
| 403 | `auth.serviceKey.actAsAmbiguous` | More than one enabled account has that email. |
| 403 | `auth.serviceKey.actAsSelf` | It names the key's own service user. |

A 401 carries `WWW-Authenticate: Bearer`, with `error="invalid_token"` when a
token was sent. The answer's body is the usual `{ error, code }`.

## Who did it

The action context of a key's call has the user it acts as as `actor`, as any
signed-in request does, and the key as `actingVia: { userId, name }` (the
service user's id and display name). An app's audit records the actor as who
did it and `actingVia.name` as how, for example "Anna Smith, via Mercbot (Smith
home)".

## A bearer route of your own

```js
router.register("POST", "/api/books/export", {
  auth: "required",
  config: { credentials: "bearer" },
  meta: { tags: ["books"], summary: "Export the books of the user the key acts as." }
}, handler);
```

It needs an auth provider that signs bearer requests in: local auth does with
service keys; another provider's answer is refused.
