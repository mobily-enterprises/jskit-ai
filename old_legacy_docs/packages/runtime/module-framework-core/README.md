# @jskit-ai/module-framework-core

Composition kernel primitives for descriptor-driven module loading.

## What this package is for

Use this package to:

- define and validate module descriptors
- resolve module dependency and capability graphs
- resolve configurable URL mounts
- compose server/client hook outputs deterministically
- surface strict/permissive diagnostics for startup policy

## Public API

- `defineModule(descriptor)`
- `validateModuleDescriptor(descriptor)`
- `validateModuleDescriptors(descriptors)`
- `resolveDependencyGraph({ modules, mode, context, diagnostics })`
- `resolveCapabilityGraph({ modules, mode, diagnostics })`
- `resolveMounts({ modules, overrides, reservedPaths, mode, diagnostics })`
- `resolveConflicts({ modules, routes, actions, topics, mode, diagnostics })`
- `composeServerModules({ modules, mode, context, mountOverrides, reservedMountPaths })`
- `composeClientModules({ modules, mode, context, mountOverrides, reservedMountPaths })`
- `createDiagnosticsCollector()`

## Behavior modes

- `strict`: fail fast and throw on dependency/capability/mount/conflict errors.
- `permissive`: disable offending modules/contributions and return diagnostics.
