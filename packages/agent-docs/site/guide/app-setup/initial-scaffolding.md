---
title: Application foundations
description: Understand and adapt JSKIT's tested minimal and adaptive-shell source patterns.
---

# Application foundations

JSKIT publishes tested source patterns instead of constructing an application
through a questionnaire. A foundation is a concrete reference application an
agent can copy, adapt, compose, or use as evidence.

## The adaptive-shell foundation

[`app/shell-foundation`](/patterns/app/shell-foundation) is the normal
browser-product baseline. It includes:

- Fastify server and health endpoint
- Vue/Vite client bootstrap
- app-local provider package
- responsive JSKIT shell
- surfaces, placements, topology, and settings
- lint, unit, client, build, and browser configuration

It has no accounts. Adding authentication through `auth/auth-surface` also adds
the standard managed-preview login (`tools/preview-identity` and its
`#### Preview identity` Outputs block).

Use it when navigation and settings are real product requirements. Replace its
home content and vocabulary; do not preserve the concrete `reading-room` name
when it is wrong for the product.

## The minimal foundation

[`app/minimal-foundation`](/patterns/app/minimal-foundation) keeps the same
server/client/package boundaries but does not install the full adaptive shell.
Use it for deliberately small or unusual products, not as a temporary hurdle
before installing what was already known to be required.

## Safe realization inside an existing repository

Read the entire selected `PATTERN.md` first. Each public pattern page links its
complete example source tree. Copy or author files directly in the initialized
project. Always preserve `.git`; when present, also preserve
existing project and agent context, including roots such as:

```text
.git/
.agents/
.codex/
```

Inspect every collision. A direct pattern copy must never need `--force` and
must never work through a temporary directory. Rename the packaged `gitignore`
asset to `.gitignore` when using it.

Keep the foundation's `packages/*` npm workspace declaration. Root and local
workspace manifests depend on app-local packages by their exact package
versions, not through `file:` paths. This lets npm resolve one coherent graph
and lets `npm run jskit:update` and `npm run jskit:check` inspect every manifest.

## Development modules and service-worker caching

Keep Vite's default `resolve.preserveSymlinks: false`. Linked application
packages under `node_modules/@local/` must resolve through their real
`/packages/` source paths during development. This keeps them watched as
mutable source and served with revalidation instead of a dependency `?v=` URL
and one-year immutable browser caching. The JSKIT client bootstrap plugin also
restores this safe setting for existing applications that still specify
`preserveSymlinks: true`.

The plugin adds the resolved client entries behind its virtual bootstrap to
Vite's dependency scan. Keep local packages as source rather than listing their
roots in `optimizeDeps.exclude`: excluding them also hides their transitive
browser dependencies from the scan and can trigger dependency rebuilds while a
page is loading. Explicit package-owned exclusions remain supported and their
client entries are scanned separately. Keep Vuetify's auto-imported components
and directives in `optimizeDeps.include`, as shown in the foundation configs;
those imports are introduced after scanning.

The foundations do not install a service worker. If an application adds PWA
caching, register it only for production and never cache development module
paths beginning with `/@fs/`, `/@id/`, `/@vite/`, `/node_modules/`,
`/packages/`, or `/src/`. Cache production JavaScript and CSS only through
content-hashed `/assets/` URLs. Fonts, images, and explicitly selected shell
files may use their own deliberate production policies.

## Ownership after copying

All copied files are ordinary application source. The pattern package does not
own future edits. There is no generated-file header, pattern receipt, template
hash, completion record, or replay journal. Framework packages continue to own
their public runtime APIs; the application owns its product source.

## Loading and errors

The adaptive example demonstrates structure-matching skeletons for visible
loading. Do not replace them with generic spinners. Keep failures local when a
resource cannot render; use shared toast/snackbar feedback for transient user
commands so errors do not push the working page down.

## Health endpoint

Both foundations register `GET /api/health` after `createInstalledRuntime` and
answer from the installed runtime's `health.check()`: `200` with
`{ ok: true, checks, app }` when every check the installed packages register
passes, and `503` with `ok: false` when one fails. `@jskit-ai/database-runtime`
registers a `database` check that runs `select 1`. Each check has two seconds;
a failure is logged on the server and the response only names which checks
passed, so the route can stay public for load balancers and uptime monitors.
Requests that arrive while a check runs share it. An application that adopted
an older foundation, where the route answered `ok: true` before the runtime was
created, moves the route after `createInstalledRuntime` in the same way.

A package adds its own check through the optional `runtime.health`
capability: `optional: { health: "runtime.health" }`, then
`health?.register("queue", () => queue.ping())` in `setup()`. The check resolves
when healthy and rejects or hangs when not.

## Security headers

`createInstalledRuntime` adds security headers to every response its Fastify
server sends, including error and not-found responses. A route that sets one of
these headers itself keeps its own value.

| Header | When | Default |
| --- | --- | --- |
| `X-Content-Type-Options: nosniff` | always | on |
| `Referrer-Policy` | always | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | staging, production | `max-age=31536000` |
| `Content-Security-Policy: frame-ancestors` | staging, production | `'self'` |
| `Content-Security-Policy-Report-Only` | staging, production | the content policy below |

Staging and production are `APP_ENV=staging` and `APP_ENV=production` (see
[Environments](/guide/framework/environments)), which the host sets beside
`NODE_ENV=production`, for example `env APP_ENV=production NODE_ENV=production
npm start`. Development and test send only nosniff and the Referrer-Policy, so
an editor's preview, such as Vibe64's, can frame the application and inject its
bridge script.

The content policy allows JSKIT's client: the application's own scripts and
WebAssembly, inline styles (Vuetify and the loading shell use them), images
from the application, `data:`, `blob:` and any HTTPS source, fonts and media
from the application and `data:`, same-origin requests and sockets, and no
plugins, foreign base URLs or foreign form posts. It is reported, not enforced,
by default: browsers log violations in the console without blocking anything,
because an application's own additions, such as a sign-in provider, an
analytics script or a map, are not known to JSKIT. Enforce it once the
application's pages run without violations. Framing is always enforced, since
browsers ignore `frame-ancestors` in a report-only policy.

Change the defaults in `config/server.js`:

```js
export const config = {
  securityHeaders: {
    // Another site that frames production, such as the editor that previews it.
    frameAncestors: ["'self'", "https://editor.example.com"],
    contentSecurityPolicy: {
      mode: "enforce", // "report-only" (default), "enforce" or "off"
      directives: {
        "connect-src": ["'self'", "https://auth.example.com"],
        "form-action": false // false leaves a directive out
      }
    }
  }
};
```

`noSniff: false`, `referrerPolicy: false`, `strictTransportSecurity: false` and
`frameAncestors: false` leave that header out; `referrerPolicy` and
`strictTransportSecurity` also take their own header value. A directive's
sources replace JSKIT's for that directive; framing is set only through
`frameAncestors`. An invalid value stops the server from starting. A server
composed without `createInstalledRuntime` calls
`registerSecurityHeaders(fastify, { config, env })` from
`@jskit-ai/kernel/server/http` before it registers any plugin.

## Verification

Pattern contract tests keep both examples concrete, parseable, npm-published,
free from interpolation tokens, and aligned with their public dependencies.
After adapting a foundation, verify the actual application rather than
comparing it byte-for-byte with the example.
