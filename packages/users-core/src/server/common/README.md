# Server Common

This directory is for server-only code shared by multiple feature slices in `users-core`.

Subdirectories:
- `contributors/`: shared runtime contributors such as action context contributors.
- `repositories/`: persistence boundaries used by multiple slices.
- `services/`: cross-slice server services.
- `support/`: low-level server-only helpers that do not belong to one feature.

Do not put feature-specific actions or services here.
