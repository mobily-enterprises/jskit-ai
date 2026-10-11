# Shell Web

The existing client exports provide the JSKIT web shell, navigation and outlet
placements. `@jskit-ai/shell-web/architecture` also exports
`inspectVueArchitecture({ projectRoot, input, aliases, httpScope, apiBasePath })`
for finite static architecture inspection.

## Architecture inspection

Run `jskit-inspect-vue` in the project directory. It reads one bounded JSON
document from stdin and writes one `genesis.architecture-observations.v1` JSON
document to stdout. Errors use stderr and a failing exit status. It does not
import application code, start a server, generate router declarations or retain
a watcher. The framework package has no Genesis or Vibe64 dependency.

Input supplies `schema: "vibe64.architecture-inspection-input.v1"`, indexed
`files: [{ path, hash }]` and `uiDiscovery.discoveries`. Optional `packages`
carry `id`, `name`, `manifest`, `declarations`, `root`, `opaque` and public
`entryPoints: [{ importPath, file }]`; `packageIdentity` binds observations to
the same inspected public boundaries. Paths are project-relative
and hashes use `sha256:<hex>`. Only declared, hash-matching UTF-8 files are read;
symlinks and files over 4 MiB are rejected.

Each discovery supplies `id`, `adapter`, `surface`, `mode`, `registrations`,
`pageRoots` and `componentRoots`. Supported adapters are `jskit`,
`vue-registered-router` and `vue-filesystem-router`.

- Registered mode reads literal Vue Router `createRouter({ routes })` declarations
  from the registration files. Static local arrays and literal child routes work.
- Filesystem mode reads literal `VueRouter(...)` options from the registration
  files and uses Vue Router's own scanner with declarations and watchers disabled.
  Its actual `routesFolder` determines pages; a directory alone is not proof.
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
- An explicit `--http-scope shop --api-base-path /api` enables scoped literal
  `fetch` uses and receivers registered through JSKIT's `defineFeature` setup
  `http.router.register`. Use `--alias @=src` for declared project aliases.
- Actual `CrudListScreen` / `CrudAddEditScreen` uses whose bound screen comes from
  the matching JSKIT composable can connect to exported `defineCrudJsonApiFeature`
  controller declarations. The resource must resolve through indexed imports and
  named re-exports to a literal `defineCrudResource` namespace and enabled
  operations. Scope includes the explicit HTTP application identity, declared
  surface and API suffix; the key uses `jskit.crud` resource operations rather
  than claiming a fully expanded runtime URL. Custom clients, transport/resource
  overrides, dynamic operations and disabled routes do not create guessed links.
  This shows declared entry points; runtime provider activation is not proven.

Dynamic routing, template component tokens, runtime placement predicates,
application request wrappers and dispatcher conventions require more evidence or
an application-owned inspector. They remain partial or unsupported, never
guessed. This command does not claim complete runtime call analysis. Protocols
other than HTTP can use the same observation contract through their own inspector.

Example consumer-owned Stack operation:

```markdown
## Architecture inspection

### Inspector `vue`: Inspect Vue pages

- Runtime: `nodejs`
- Directory: `.`
- Command: `node` `node_modules/@jskit-ai/shell-web/src/architecture/cli.js` `--alias` `@=src`
- Timeout seconds: `30`
- Max output bytes: `4194304`
```

The consumer owns command admission, runtime selection, cancellation, publication
and validation against the indexed snapshot. It must retain the last valid
snapshot when an inspector fails or source changes.
