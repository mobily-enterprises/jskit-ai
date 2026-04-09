# JSKIT Manual: Chapter 4 Hardcore Package Developer (Stub)

This chapter is intentionally a stub for now.

Its purpose will be to cover advanced package/runtime authoring topics that are not needed for daily feature development.

Runnable chapter example package:

- `docs/examples/04.kernel-advanced`

## Full Kernel Class Map (Public Exports)

Non-error classes:

- `Application` (`@jskit-ai/kernel/server/kernel`)
- `ServiceProvider` (`@jskit-ai/kernel/server/kernel`)
- `Container` (`@jskit-ai/kernel/server/container`)
- `HttpRouter` (`@jskit-ai/kernel/server/http`)
- `ContainerCoreServiceProvider` (`@jskit-ai/kernel/server`)
- `HttpFastifyServiceProvider` (`@jskit-ai/kernel/server`)
- `KernelCoreServiceProvider` (`@jskit-ai/kernel/server`)
- `PlatformServerRuntimeServiceProvider` (`@jskit-ai/kernel/server`)
- `ServerRuntimeCoreServiceProvider` (`@jskit-ai/kernel/server`)
- `SupportCoreServiceProvider` (`@jskit-ai/kernel/server`)
- `SurfaceRoutingServiceProvider` (`@jskit-ai/kernel/server`)

Error classes:

- `KernelError` (`@jskit-ai/kernel/server/kernel`)
- `ProviderNormalizationError` (`@jskit-ai/kernel/server/kernel`)
- `DuplicateProviderError` (`@jskit-ai/kernel/server/kernel`)
- `ProviderDependencyError` (`@jskit-ai/kernel/server/kernel`)
- `ProviderLifecycleError` (`@jskit-ai/kernel/server/kernel`)
- `ContainerError` (`@jskit-ai/kernel/server/container`)
- `InvalidTokenError` (`@jskit-ai/kernel/server/container`)
- `InvalidFactoryError` (`@jskit-ai/kernel/server/container`)
- `DuplicateBindingError` (`@jskit-ai/kernel/server/container`)
- `UnresolvedTokenError` (`@jskit-ai/kernel/server/container`)
- `CircularDependencyError` (`@jskit-ai/kernel/server/container`)
- `HttpKernelError` (`@jskit-ai/kernel/server/http`)
- `RouteDefinitionError` (`@jskit-ai/kernel/server/http`)
- `RouteRegistrationError` (`@jskit-ai/kernel/server/http`)
- `AppError` (`@jskit-ai/kernel/server/runtime`)

## Planned Chapter 4 Sections

- Direct `Container` usage and when to avoid it
- Advanced token design and collision-proof naming
- `scoped` and `createScope` for per-request/per-job boundaries
- Tag-based plugin/contributor architectures
- Building runtime capabilities with kernel core service providers
- `createProviderRuntimeApp` and `createProviderRuntimeFromApp` in custom bootstraps
- Provider graph diagnostics and lifecycle timing analysis
- Hardcore failure handling and error taxonomy in infrastructure code

Reference note:

- Complete API listings moved to Chapter 7 to keep this chapter focused on advanced concepts and patterns.
