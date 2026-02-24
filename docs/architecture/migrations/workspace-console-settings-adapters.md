# Workspace, Console, Settings, Console Errors Adapter Migration

## Extracted Packages

- `@jskit-ai/workspace-fastify-adapter`
- `@jskit-ai/console-fastify-adapter`
- `@jskit-ai/settings-fastify-adapter`
- `@jskit-ai/console-errors-fastify-adapter`

## App Wiring Pattern

- App wrappers provide thin configuration only:
  - `resolveSurfaceFromPathname`
  - realtime topic/event maps (workspace adapter)
  - avatar upload policy (settings adapter)
- Controller/routes/schema behavior is package-owned.

## Extension Points For New Apps

- Override only adapter options/configuration.
- Avoid copying controller/route/schema logic into app modules.
