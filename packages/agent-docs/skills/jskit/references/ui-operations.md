# UI operations

Read this for routes, pages, surfaces, placements, responsive UI, and browser
verification.

## Pages, surfaces, and placements

Take the surface from the request/app authority; it controls routes, access,
placement visibility, and often ownership. For a normal non-CRUD page:

```bash
npx --no-install jskit show ui-generator --details
npx --no-install jskit list-placements
npx --no-install jskit generate ui-generator page <route-file> --name <name>
```

Choose the truthful `--navigation-role`. Override with semantic
`--link-placement <area.slot>` when needed; use concrete placements only for
diagnosis. Let the generator create the route and placement before adapting
app-owned output. State why before hand-writing a normal page.

## App-owned files

App-owned generated files are customizable. Adapt infrastructure tests in place.
When replacing a starter route, update its smoke
test to the new canonical route instead of deleting baseline browser coverage.
Doctor must continue to report a missing managed test.

## Screen behavior

- Keep screens phone/task-first with drawer-independent primary actions and
  48 px targets. Use a page header and direct `v-sheet`, not nested cards.
- Provide named loading, empty, error, permission, and retry states. Generated
  lists use searchable compact cards and medium/expanded tables where suitable.
- Extend shared CRUD screens through slots. For custom sibling/child links,
  resolve current dynamic params with their runtime to an absolute URL/route
  object; never bind its route-template/relative string raw to Vue Router `to`.
- Use page-local row-action/filter definitions. Keep read failures local; use
  `useCommand()` or `useUiFeedback()` for user-triggered action feedback.
- Import neutral request, operation, permission, and generated CRUD UI APIs from
  `@jskit-ai/http-web`. Do not install `users-web` unless the application uses
  account, profile, or user-specific shell UI.

## Adaptive shell drawer

Use Vuetify Material navigation. Compact close dismisses the temporary drawer;
wide layouts default to `desktopDrawerClosedMode="rail"`. Use `hidden` only
with another navigation affordance.

The drawer omits the app bar's surface label. Open and rail icons share a
centreline. It uses a 12px outer item inset; `navigationItemSpacing` (12px)
controls icon/label and label/end gaps. The 80px rail centres 48px targets; set
`railWidth` (for example, `64`) for a denser rail or `drawerWidth` for a fixed
drawer. The wrapper forwards these props; never override its CSS.

Existing apps: commit work and run `npm run jskit:update`. Keep and adapt
the app-owned shell wrapper and smoke test; do not copy or delete them.

## Browser verification

Exercise user-facing changes with Playwright at compact, medium, and expanded
widths. Check overflow, clipped text, duplicate navigation, route placement,
actions, and target sizes. Use relative URLs; shared JSKIT config owns base URL,
server, and storage state. With `PLAYWRIGHT_BASE_URL`, start no server. Never
print/commit `VIBE64_PLAYWRIGHT_STORAGE_STATE`, use a local bypass with it, or
install a browser when a managed runner supplies one.

For explicitly enabled direct-local auth, use `loginAsExistingUser()` from
`@jskit-ai/auth-web/test/playwright`; never expose its secret to browser code,
URLs, or client env. Run the focused test directly:

```bash
npx playwright test <test-file> -g "<changed behavior>"
```
