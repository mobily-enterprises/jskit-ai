# Server Common

This directory is for server-only code shared by multiple feature slices in `users-core`.

Subdirectories:
- `routes/`: shared server route schema maps used by multiple route adapters.
- `repositories/`: low-level repository helpers shared by multiple repositories.

Do not put feature-specific actions, services, repositories, or contributors here.
