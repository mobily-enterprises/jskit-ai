# `repositories/`

Use this directory for persistence boundaries shared by more than one server feature slice.

What belongs here:
- database repositories
- repository helpers that are part of persistence logic

Examples:
- `workspacesRepository`
- `workspaceMembershipsRepository`
- `workspaceInvitesRepository`

Do not put these here:
- business logic
- action definitions
- transport validation
- feature-specific response mapping

Rule:
- repositories read and write data
- they do not decide permissions
- they do not shape HTTP payloads
- they do not contain feature workflow logic
