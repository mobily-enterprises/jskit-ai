# @jskit-ai/workspace-fastify-routes

Fastify route/controller/schema wiring for workspace APIs.

## Provider runtime (new path)

- `WorkspaceRouteServiceProvider` is exported for provider/kernel runtime boot.
- Required container bindings:
  - `authService`
  - `consoleService`
  - `actionExecutor`
- Optional bindings:
  - `aiTranscriptsService`
  - `realtimeEventsService`
