# UI operations

Read this reference for routes, pages, surfaces, placements, responsive UI, or
browser verification.

## Pages, surfaces, and placements

Take the intended surface from the request and app authority; do not silently
default new functionality to `app`. Surface choice controls routes, access,
placement visibility, and often ownership.

For a normal app-owned non-CRUD page, first inspect the generator and semantic
placements, then generate the page:

```bash
npx --no-install jskit show ui-generator --details
npx --no-install jskit list-placements
npx --no-install jskit generate ui-generator page <route-file> --name <name>
```

Use `--navigation-role primary` for main destinations and `secondary`,
`detail`, `workflow`, or `none` as appropriate for other routes. Use
`--link-placement <semantic-id>` when the link belongs in a non-default slot.
Use `npx --no-install jskit list-placements --concrete` only when diagnosing
concrete outlets. Author normal app UI against semantic placements such as
`shell.primary-nav` or `page.section-nav`, not raw `host:position` outlets.

Let the generator create both the route and placement entry before adapting
app-owned output. If a normal page cannot use the generator, state the concrete
reason before hand-writing it.

## Managed app-owned files

“App-owned” means customizable; it does not mean disposable while the package
that installed the path remains installed. Never delete or rename a path
recorded in `.jskit/lock.json`. Adapt generated or managed infrastructure tests
in place.

When a starter product route is replaced, update its scaffold smoke test to
exercise the new canonical route instead of deleting baseline browser
coverage. JSKIT Doctor must continue to report a managed test that is missing.

## Screen behavior

- Keep app screens phone/task-first, primary actions drawer-independent, and
  48 px tap targets.
- Use a page header and direct `v-sheet`, not nested-card architecture.
- Provide resource-named loading, empty, error, permission, and retry states.
- Use compact searchable cards and medium/expanded tables for generated CRUD
  lists where appropriate.
- Extend shared CRUD screens through slots. For custom sibling/child links,
  resolve current dynamic params with their runtime to an absolute URL/route
  object; never bind its route-template/relative string raw to Vue Router `to`.
- Use `defineCrudListRowActions(...)` and the generated page-local row-action
  seam for row commands. Use shared filter definitions for structured filters.
- Keep ordinary read failures local with runtime `loadError` and retry state.
  Use `useCommand()` or `useUiFeedback()` for user-triggered action feedback.

## Adaptive shell drawer

The shell uses Vuetify's Material navigation components. On compact layouts,
closing the drawer hides the temporary modal drawer. On wider layouts, the
default `desktopDrawerClosedMode="rail"` keeps primary navigation reachable as
a navigation rail; set `desktopDrawerClosedMode="hidden"` only when the
product deliberately requires a fully hidden wide drawer and another
navigation affordance remains available. Do not implement a second app-owned
drawer or hide the Vuetify rail with CSS.

## Browser verification

Any change to user-facing behavior needs a Playwright flow exercising that
behavior. Check compact, medium, and expanded widths for generated/template UI
changes, including overflow, clipped text, duplicate navigation, route
placement, primary actions, and tap targets.

Use relative URLs in tests. The shared JSKIT Playwright config owns the base
URL, server lifecycle, and storage state. When `PLAYWRIGHT_BASE_URL` is set,
do not start another server. When `VIBE64_PLAYWRIGHT_STORAGE_STATE` is supplied,
do not print, commit, or retain it and do not use local login bypasses. Do not
install a browser when the environment supplies a managed runner.

For a direct localhost app with development auth bypass explicitly enabled,
use `loginAsExistingUser()` from `@jskit-ai/auth-web/test/playwright`; never
send the bypass secret through browser globals, query parameters, or client
environment variables.

After a successful UI test, record the verification when the app supports it:

```bash
npx --no-install jskit app verify-ui \
  --command "<exact successful Playwright command>" \
  --feature "<changed behavior>" \
  --auth-mode <dev-auth-login-as|session-bootstrap>
```
