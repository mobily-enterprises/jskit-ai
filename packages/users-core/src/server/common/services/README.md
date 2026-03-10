# `services/`

Use this directory for server services shared by more than one feature slice.

What belongs here:
- cross-slice domain services
- reusable server services that several features depend on

Examples:
- a `workspaceService` used by bootstrap, pending invitations, and workspace administration slices

Do not put these here:
- feature-local services such as `workspaceSettingsService`
- repositories
- action definitions
- provider wiring

Rule:
- if a service exists only for one slice, keep it in that feature folder
- move a service here only when multiple feature folders depend on it
