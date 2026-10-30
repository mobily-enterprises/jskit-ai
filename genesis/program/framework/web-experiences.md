# Web application experiences

Provides Vue components, composables, shell placements, responsive resource
screens, authenticated account and workspace surfaces, billing, uploads, and
shared action feedback.

## Sources

- Main: `packages/shell-web/src/client/index.js`
- `packages/http-web/src/client/index.js`
- `packages/auth-web/src/client/index.js`
- `packages/users-web/src/client/index.js`
- `packages/workspaces-web/src/client/index.js`
- `packages/uploads-image-web/src/client/index.js`
- `packages/architecture-inspector/src/inspectVueArchitecture.js`
- `packages/architecture-inspector/src/calls/index.js`
- `packages/architecture-inspector/src/previewLocator.js`

## Public contract

Applications compose public exports and placements into their own routes and
themes. Standard resource screens expose loading, empty, error, permission,
filtering, navigation, and mutation states through shared composables. The
shared selection field never titles a value with its stored id: an unresolved
value stays hidden while options load and reads as unavailable afterwards. The
application remains responsible for route policy, product vocabulary, and the
server authorization behind every visible action.

When realtime is installed, the shell compares the build its page loaded with
the build the server announces on each connection. A page running an older
build shows an `app-recoverable` notice, "*Title* was updated. Reload to get the
latest version.", with **Reload**, once per served build. It never reloads by
itself; **Reload** returns to the same address once the server answers.

`@jskit-ai/architecture-inspector`, a plain tool package outside the framework
runtime, ships `jskit-inspect-vue`, an optional static inspector for the
portable architecture-inspection command contract. It reads
one `vibe64.architecture-inspection-input.v1` request on stdin and prints one
`genesis.architecture-observations.v1` document: routed pages, the components
their templates use, literal `fetch` and JSKIT CRUD screen operation uses,
`defineFeature` and `defineCrudJsonApiFeature` entry operations, and source
imports. It parses only indexed, hash-matching project files, never imports
application code or Genesis or Vibe64, and reports dynamic declarations as
diagnostics instead of guessing. Filesystem-routed siblings are visited in
route path order, so registration ids are stable between runs. HTTP operations
carry the root `package.json` name as their scope unless `--http-scope` names
another; a project without a named root manifest gets no HTTP observations.
`@jskit-ai/shell-web/architecture` and its `src/architecture/cli.js` re-export
the package for existing consumers; the re-exported command takes the same
flags.

Routes registered through `createActionRouteScope` become entry operations with
their path and `actionId` when their options are written in the recognised
literal forms. With `--calls` the document also lists every function (module
code as `fn:<path>#module`), each call with its certainty (exact from the
TypeScript checker, `defineFeature` injection, `executeAction` or `this`;
probable from argument flow or receiver names), action entry points, and
operation uses from `useEndpointResource`, `useCommand`,
`getHttpWebClient().request` and `fetch` with the function that makes them.
Only declared project scripts and TypeScript's own libraries are analysed, and
provably external calls are left out. `--api-prefix-alias` rewrites client path
prefixes before they are matched to routes. A cache directory in the input lets
an unchanged rerun reuse its result and a changed file re-resolve only itself
and its direct importers. The package also ships a Vue Preview locator that
names the project component that rendered an element without reading its
content.
