# Package Extension Points For Future Apps

Use package configuration, not code copy:

1. Communications: configure `communications-core` providers and adapter options.
2. Auth: configure provider-core options; reuse `auth-fastify-adapter` routes.
3. Billing: configure provider selection/secrets and policy knobs; reuse service/worker/http packages.
4. Workspace/Console/Settings: inject surface resolver + policy constants into adapter wrappers.
5. Runtime: compose bundles via `@jskit-ai/platform-server-runtime`; keep app-specific features in app feature bundle only.

Rule: app layer should be configuration + wiring only.

See also: [app variability matrix](./app-variability-matrix.md).
