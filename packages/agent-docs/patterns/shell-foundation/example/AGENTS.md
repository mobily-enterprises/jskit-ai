# App Agent Instructions

<!-- jskit:begin app guidance (written by npx jskit agents; edit outside this block) -->
## JSKIT

This app is built on JSKIT. Its guide,
`https://mobily-enterprises.github.io/jskit-ai/guide/`, and its pattern
library, `https://mobily-enterprises.github.io/jskit-ai/patterns/`, describe
the current JSKIT release. `@jskit-ai/agent-docs` is not an app dependency, so
the guide has no copy under `node_modules`. Keep the app on the current release
(`npm run jskit:update`) so the two agree. A pattern whose owner runtime package
is installed is also in that package's `patterns/` folder, at the app's
version. Never install a runtime package only to read its documentation.

Read the guide's page before the work it covers:

- code that reads or writes a database table:
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/data-access`
- server code (a feature, provider, action, service, repository, route, error
  or test):
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features`
- client code (a composable, component, client factory or client provider):
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/client-features`
- code that sends email, SMS, push notifications or payments, calls another
  system, or depends on where the app runs (`APP_ENV`):
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/environments`
- a screen:
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/material-3`
- tests:
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#test-files-run-in-parallel`,
  and browser tests:
  `https://mobily-enterprises.github.io/jskit-ai/guide/framework/ui-operations#browser-verification`
- a new capability: the pattern library; read the narrow pattern completely
  before implementing.

`npm run verify` runs the checks listed in
`https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#running-the-checks`.
`npm test` runs every Node test file; `npm test -- <file>` runs exactly that
file. Each finding links the guide section that explains it: fix it in the
code, and excuse one only with the guide's `readable-check: allow` comment and
reason prefix.

Where the host provides a managed browser runner, such as Vibe64's, every
Playwright suite runs through it from the first run, on a declared test target:
give the runner the package script (on Vibe64,
`vibe64-helper playwright --target test-app npm-run test:e2e`), and never start
`npx playwright test`, `playwright test` or `npm run test:e2e` yourself. Specs
that write run only on a test target with its own database, never on the
person's development target or database. The browser tests guide above shows
the test target's declaration.
<!-- jskit:end app guidance -->

## This app

Write this app's own rules here, outside the JSKIT block, which
`npm run jskit:update` rewrites.
