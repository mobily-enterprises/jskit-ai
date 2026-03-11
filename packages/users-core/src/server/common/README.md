# Server Common

This directory contains server-only runtime pieces reused by multiple slices in `users-core`.

Use these folders:
- `repositories/`: shared repositories and repository-only helpers.
- `services/`: shared domain services consumed by multiple slices.
- `contributors/`: shared action-context/bootstrap contributors.
- `validators/`: shared request/response validators used by multiple adapters.
- `formatters/`: shared payload formatters/projections for transport output.
- `routes/`: shared route schema maps used by more than one route adapter.

Keep these files here:
- `diTokens.js`: shared DI tokens used across slices.
- `registerCommonRepositories.js`: shared repository bindings.
- `registerUsersCoreApi.js`: shared API metadata registration.

Do not put these in `common/`:
- feature-only actions/services/repositories/controllers
- one-off route payload shapes used by a single feature
- UI/client code
