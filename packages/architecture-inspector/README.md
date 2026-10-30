# Architecture Inspector

`@jskit-ai/architecture-inspector/vue` exports
`inspectVueArchitecture({ projectRoot, input, aliases, httpScope, apiBasePath, calls, apiPrefixAliases })`
for finite static architecture inspection, and ships the `jskit-inspect-vue`
command and the Vue Preview locator `src/previewLocator.js`. It is a plain tool
package, not a JSKIT framework runtime package.

## Architecture inspection

Imported assets remain file-import evidence. The Vue adapter parses only its
supported JavaScript, TypeScript and Vue modules; binary images do not block
route discovery. Asset-to-component transformations require their own adapter
and remain explicitly unsupported here.

Run `jskit-inspect-vue` in the project directory. It reads one bounded JSON
document from stdin and writes one `genesis.architecture-observations.v1` JSON
document to stdout. Errors use stderr and a failing exit status. It does not
import application code, start a server, generate router declarations or retain
a watcher. The package has no Genesis or Vibe64 dependency. The command runs the
inspection in a child Node process whose old generation is bounded by the size
of the declared scripts (192 MB plus 56 MB per MiB), so memory stays near what
the inspection holds; a caller that starts Node with its own
`--max-old-space-size` keeps that bound and runs in place.

Input supplies `schema: "vibe64.architecture-inspection-input.v1"`, indexed
`files: [{ path, hash }]` and `uiDiscovery.discoveries`. Optional `packages`
carry `id`, `name`, `manifest`, `declarations`, `root`, `opaque` and public
`entryPoints: [{ importPath, file }]`; `packageIdentity` binds observations to
the same inspected public boundaries. Paths are project-relative
and hashes use `sha256:<hex>`. Only declared, hash-matching UTF-8 files are read;
symlinks and files over 4 MiB are rejected. Optional `stackHash` and
`cacheDirectory` serve the call cache below; other unknown fields are ignored.

Each discovery supplies `id`, `adapter`, `surface`, `mode`, `registrations`,
`pageRoots` and `componentRoots`. Supported adapters are `jskit`,
`vue-registered-router` and `vue-filesystem-router`.

- Registered mode reads literal Vue Router `createRouter({ routes })` declarations
  from the registration files. Static local arrays and literal child routes work.
- Filesystem mode reads literal `VueRouter(...)` options from the registration
  files and uses Vue Router's own scanner with declarations and watchers disabled.
  Its actual `routesFolder` determines pages; a directory alone is not proof.
  Sibling routes are visited in `fullPath` order, so registration ids do not
  depend on filesystem scan order.
- Template component uses come from actual referenced imports. Shared definitions
  retain their source identity. Unused imports create no composition relationship.
- Imported external elements retain the declared package/import-path/symbol owner.
  Their implementation files are not read. Project-owned workspace exports can
  resolve to indexed source files.
- Static imports from indexed JavaScript, TypeScript and Vue files also provide
  optional `imports` observations. The framework resolver owns declared aliases,
  root-relative paths and file resolution. Each record retains the source range,
  current input hashes, target file and imported names, including aliases,
  `default`, namespace `*` and type-only classification. These are import facts,
  not evidence of runtime calls. Coverage remains partial; namespace use does
  not establish which individual exports are consumed.
- An HTTP scope names the application's operations and enables scoped literal
  `fetch` uses and receivers registered through JSKIT's `defineFeature` setup
  `http.router.register`. It is the root `package.json` `name`, or
  `--http-scope shop` when the operations should carry another name; without
  either, HTTP observations stay unconfigured. `--api-base-path /api` prefixes
  `http.router.register` paths. Use `--alias @=src` for declared project aliases.
- Actual `CrudListScreen` / `CrudAddEditScreen` uses whose bound screen comes from
  the matching JSKIT composable can connect to exported `defineCrudJsonApiFeature`
  controller declarations. The resource must resolve through indexed imports and
  named re-exports to a literal `defineCrudResource` namespace and enabled
  operations. Scope includes the explicit HTTP application identity, declared
  surface and API suffix; the key uses `jskit.crud` resource operations rather
  than claiming a fully expanded runtime URL. Custom clients, transport/resource
  overrides, dynamic operations and disabled routes do not create guessed links.
  This shows declared entry points; runtime provider activation is not proven.

- Routes registered through the kernel's `createActionRouteScope` become entry
  operations with their full path and, for `actionRoute`, their `actionId`.
  The scope options must be string literals or imported constant strings;
  each route's method, suffix and `actionId` must be literals, template
  literals or elements of an enclosing literal array's `.map` or `for...of`
  (at most 64). Anything else is reported as `ACTION_ROUTE_UNRESOLVED` or
  `ACTION_ROUTE_SCOPE_UNBOUND`, never guessed.

### Function calls (`--calls`)

`--calls` (library option `calls: true`) adds `functions`, `calls` and
`entryPoints` and their capabilities. Without it the output is unchanged.

- **Functions.** Every function-like with a body, plus each file's top-level
  code as `fn:<path>#module`. Other ids are `fn:<path>#<line>:<column>` at the
  syntax node's start after decorators, `export` and comments, the same
  position Genesis's syntax sites use. `exported: true` marks exported
  top-level functions; `container` names an enclosing class or object.
- **Calls.** One TypeScript program over the declared scripts and Vue script
  blocks only, plus TypeScript's own libraries; nothing under `node_modules` is
  loaded. Each call is `exact` (`checker`, `di-binding`, `self` or
  `route-action`), `probable` (`argument-flow`, `receiver-name`, or several
  candidates) or `unresolved`.
  - `defineFeature` injection binds `requires` tokens to the `setup` outputs
    that `provides` them: one provider is exact, several are ambiguous.
  - Argument flow follows the caller. A function passed to a parameter that
    the callee calls while it runs (in its own body, in callbacks it passes
    on, or by forwarding it to a function that does) is an `argument-flow`
    call of the function that passes it, recorded at that call. The callee's
    own call of the parameter is `unresolved`, so one caller's callback is
    never reached through another caller. A parameter called only from a
    closure the callee stores or returns keeps every value its callers pass.
  - Action definitions (`{ id, execute }` in a feature's `actions`, also through
    pass-through wrappers and literal-array `.map`) become `action` entry
    points; `request.executeAction({ actionId: "..." })` reaches their execute
    function, and each action route's `controllerFunctionId` names it.
  - Calls that are provably external are left out: package imports, builtins,
    values produced by them (including `let` assignments, `for...of`,
    destructuring and callbacks they call), Vue's `<script setup>` macros and
    `emit`. A name that is also a builtin member is never exact.
  - At most 2,000 call records per file; beyond that `CALLS_TRUNCATED` and a
    `partial` calls capability.
- **Transports.** With an HTTP scope, `useEndpointResource`, `useCommand`,
  `getHttpWebClient().request` and client `fetch` become operation uses that
  carry `fromFunctionId`; `parentId` is set only in page and component files.
  Paths are partially evaluated (template literals, constants, imports,
  parameter defaults, `usePaths().api`, `resolveScopedApiBasePath`). A key is
  `keyCertainty: "exact"` when every route literal is matched; two or three
  candidate routes give one `probable` use each, with ids suffixed per
  candidate. `--api-prefix-alias /api/x=/api/app/:slug/x` (repeatable) rewrites
  client prefixes before matching.
- **Cache.** With an absolute, existing `cacheDirectory` outside the project,
  the command keeps `jskit-calls.json` there. An unchanged rerun reuses the
  whole result. Otherwise a file keeps its calls when its own and its directly
  imported sources are unchanged and every target still exists. Any change to a
  manifest, lockfile, `tsconfig`/`jsconfig`, the inspector version, packages,
  UI discovery, options or `stackHash` rebuilds everything. An absent, unusable
  or corrupt cache means a cold run.

### Preview locator

`src/previewLocator.js` is a classic script a Preview can inline. It defines
`globalThis.__vibe64LocateElement(element)`, which returns `{ file, name? }` for
the nearest component with a source file (Vue development builds record it as
`__file`) that rendered the element, or `null` for plain DOM. It reads only
Vue's component bookkeeping, never text content or values.

Dynamic routing, template component tokens, runtime placement predicates,
application request wrappers and dispatcher conventions require more evidence or
an application-owned inspector. They remain partial or unsupported, never
guessed. This command does not claim complete runtime call analysis. Protocols
other than HTTP can use the same observation contract through their own inspector.

Example consumer-owned Stack operation:

```markdown

### Inspector `vue`: Inspect Vue pages and function calls

- Runtime: `nodejs`
- Directory: `.`
- Command: `node` `node_modules/@jskit-ai/architecture-inspector/src/cli.js` `--alias` `@=src` `--calls`
- Timeout seconds: `90`
- Max output bytes: `67108864`
- Preview locator: `node_modules/@jskit-ai/architecture-inspector/src/previewLocator.js`
```

The consumer owns command admission, runtime selection, cancellation, publication
and validation against the indexed snapshot. It must retain the last valid
snapshot when an inspector fails or source changes.
