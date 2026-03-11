# `repositories/`

Use this directory for persistence code shared by more than one server slice.

What belongs here:
- repository helpers that are part of persistence logic
- shared repositories used by multiple features/slices

Examples:
- SQL/date/JSON helper functions reused by several repositories
- `workspaceMembershipsRepository`
- `workspaceInvitesRepository`

Do not put these here:
- repositories used by only one feature
- business logic
- action definitions
- transport validation
- feature-specific response mapping

Rule:
- if a helper is reused by multiple repository files, it can live here
- if a repository is reused by multiple slices, keep it here
- if a repository is owned by one slice only, keep it in that slice folder
