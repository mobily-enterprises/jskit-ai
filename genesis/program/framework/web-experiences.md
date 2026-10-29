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

## Public contract

Applications compose public exports and placements into their own routes and
themes. Standard resource screens expose loading, empty, error, permission,
filtering, navigation, and mutation states through shared composables. The
shared selection field never titles a value with its stored id: an unresolved
value stays hidden while options load and reads as unavailable afterwards. The
application remains responsible for route policy, product vocabulary, and the
server authorization behind every visible action.

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
route path order, so registration ids are stable between runs.
`@jskit-ai/shell-web/architecture` and its `src/architecture/cli.js` re-export
the package for existing consumers.
