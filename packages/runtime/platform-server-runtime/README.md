# @jskit-ai/platform-server-runtime

Helpers to compose platform and app feature bundles into a server runtime assembly.

## What this package is for

Use this package to build a runtime container from modular definitions.

A runtime container is the assembled set of repositories, services, and controllers your app can resolve at startup.

## Key terms (plain language)

- `bundle`: a package of runtime registrations (repositories/services/controllers).
- `dependency injection`: passing dependencies into modules instead of creating them inline.
- `runtime assembly`: the final composed runtime object used by the server.

## Public API

- `createPlatformRuntimeBundle({ repositoryDefinitions, serviceDefinitions, controllerDefinitions, runtimeServiceIds })`
  - Creates an immutable (read-only) bundle descriptor.
  - Real example: platform code declares shared DB repositories and core services once.
- `createServerRuntime({ bundles, dependencies })`
  - Builds runtime assembly from one or more bundles plus concrete dependencies.
  - Real example: app startup passes config/logger/db handles and gets back resolved services.
- `createServerRuntimeWithPlatformBundle({ platformBundle, appFeatureBundle, dependencies })`
  - Convenience helper for the common case: always include platform bundle and optionally one app bundle.
  - Real example: product app adds custom features on top of standard platform runtime.

## How apps use this package (and why)

Typical flow:

1. Define `platformBundle` with shared modules.
2. Define optional `appFeatureBundle` with app-specific modules.
3. Call `createServerRuntimeWithPlatformBundle` at startup.
4. Use runtime assembly in route registration and workers.

Why apps use it:

- predictable startup composition
- clean layering between shared platform and app-specific logic
