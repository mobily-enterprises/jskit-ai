# Module Capabilities

Capability contracts are the runtime compatibility layer between server modules. They avoid hardcoding every module-to-module dependency through IDs alone.

## Catalog

Canonical IDs live in `shared/framework/capabilities.js`.

| Capability ID | Default version | Primary provider |
| --- | --- | --- |
| `cap.auth.identity` | `1.0.0` | `auth` |
| `cap.auth.cookies` | `1.0.0` | `auth` |
| `cap.rbac.permissions` | `1.0.0` | `auth` |
| `cap.http.route-policy` | `1.0.0` | `auth` |
| `cap.http.contracts` | `1.0.0` | `observability` |
| `cap.workspace.selection` | `1.0.0` | `workspace` |
| `cap.workspace.membership` | `1.0.0` | `workspace` |
| `cap.realtime.publish` | `1.0.0` | `workspace` |
| `cap.realtime.subscribe` | `1.0.0` | `workspace` |
| `cap.action-runtime.execute` | `1.0.0` | `actionRuntime` |
| `cap.billing.entitlements` | `1.0.0` | `billing` |

## Server Module Mapping

Server module descriptors in `server/framework/moduleRegistry.js` now declare:

- `version`
- `dependsOnModules`
- `requiresCapabilities`
- `providesCapabilities`

Composition uses the same graph resolution for runtime services, routes, actions, realtime policies, Fastify plugin registration, and background runtime orchestration.

## Strict vs Permissive

- `strict` (default): startup/composition fails on missing dependency, capability mismatch, or capability provider conflict.
- `permissive`: affected modules are disabled; diagnostics are returned with warning severity.

Server bootstrap currently pins `strict` mode.
Composition utilities and `framework:deps:check` accept explicit mode overrides (`strict`/`permissive`) for diagnostics and compatibility validation.

## Install-Time Validation Command

Use:

```bash
npm run framework:deps:check
npm run framework:extensions:validate -- --module ./path/to/extension.js
```

Optional flags:

- `--mode strict|permissive`
- `--enabled moduleA,moduleB`
- `--profile web-saas-default`
- `--packs +social,+billing`
- `--json`
