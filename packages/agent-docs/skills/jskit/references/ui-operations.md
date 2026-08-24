# UI operations

Read this for routes, pages, surfaces, placements, responsive UI, and browser
verification.

## Pages, surfaces, and placements

Take the surface and navigation role from the request, product context, and
current app. They control routes, access, placement visibility, and often
ownership. Inspect `app/shell-foundation` plus the narrow UI pattern that
matches the requested outcome before authoring source.

Create route files and placement declarations as normal application code.
Use semantic placement ids and shell public helpers; use concrete outlet ids
only when defining or diagnosing topology. Resolve current dynamic parameters
to an absolute URL or route object for sibling/child links—never bind a route
template or relative string raw to Vue Router `to`.

## Application-owned files

Pattern source is ordinary customizable application source. When replacing a
starter route, adapt its smoke test to the new canonical route instead of
discarding browser coverage. Do not retain a generated-file marker, template
hash, pattern receipt, or tool-owned source declaration.

## Screen behavior

- Keep screens phone/task-first with drawer-independent primary actions and
  at least 48 CSS-pixel targets.
- Use a page header and direct surfaces instead of needless nested cards.
- Render all meaningful loading, empty, error, permission, and retry states.
- Use structure-matching Material skeletons for visible loading; never use a
  generic spinner or circular progress indicator.
- Keep read failures local when the screen cannot render. Present transient
  command success/failure through shared toast/snackbar feedback so the page
  does not jump.
- Extend shared CRUD screens through public slots and composables.
- Keep row actions and filters near the screen unless the framework owns them.
- Import neutral request and CRUD UI APIs from `@jskit-ai/http-web`. Install
  `users-web` only for actual account/profile/user UI.

## Adaptive shell drawer

Use Vuetify Material navigation. Compact close dismisses the temporary drawer;
wide layouts default to `desktopDrawerClosedMode="rail"`. Use `hidden` only
when another navigation affordance remains.

The drawer omits the app bar's surface label. Open and rail icons share a
centreline. It uses a 12px outer item inset; `navigationItemSpacing` controls
icon/label and label/end gaps. The normal 80px rail centres 48px targets;
`railWidth` and `drawerWidth` are public density/width controls. Do not override
the shell's private implementation CSS.

## Browser verification

Exercise user-facing changes with Playwright at compact, medium, and expanded
widths. Check overflow, clipped text, duplicate navigation, route placement,
actions, skeleton replacement, error feedback, and target sizes. Use relative
URLs. When `PLAYWRIGHT_BASE_URL` is provided, start no duplicate server.

Vibe64 owns its managed browser and may provide
`VIBE64_PLAYWRIGHT_STORAGE_STATE`; never print or commit that value, bypass it,
or install another browser. For explicitly enabled direct-local auth, use
`loginAsExistingUser()` from `@jskit-ai/auth-web/test/playwright`; never expose
the exchange secret to browser code, URLs, or client environment.

Run the narrow test directly:

```bash
npx playwright test <test-file> -g "<changed behavior>"
```
