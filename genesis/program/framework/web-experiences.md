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

## Public contract

Applications compose public exports and placements into their own routes and
themes. Standard resource screens expose loading, empty, error, permission,
filtering, navigation, and mutation states through shared composables. The
application remains responsible for route policy, product vocabulary, and the
server authorization behind every visible action.
